import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stableHash } from '../crypto.js';
import { LlmSchemaError, type LlmClient, type LlmJsonRequest, type LlmJsonResponse } from './types.js';

/**
 * LLM access.
 *
 * The model is only ever asked to *choose* — which harvested email is the
 * vendor inbox, which profile path a form field maps to, which class a reply
 * falls into. It never supplies a value that ends up in a form or an email
 * body. That constraint is enforced by `LlmJsonRequest.parse`, which every
 * call site implements with a Zod schema, and by forcing tool use so the model
 * cannot reply with prose.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';

export interface AnthropicLlmClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  name: string;
  input: unknown;
}

interface AnthropicResponseBody {
  model?: string;
  content?: Array<{ type: string } & Partial<AnthropicToolUseBlock>>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Real client, over the Messages API.
 *
 * Structured output is obtained with a single tool plus `tool_choice`, which
 * is the only way to get a schema-conformant object rather than JSON-in-prose.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(opts: AnthropicLlmClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for AnthropicLlmClient');
    this.apiKey = apiKey;
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? ANTHROPIC_API_URL;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    const payload = {
      model: this.model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      tools: [
        {
          name: 'respond',
          description: 'Return the structured answer. This is the only way to reply.',
          input_schema: req.jsonSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'respond' },
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const detail = await res.text();
          // 4xx other than rate limiting will not improve on retry.
          if (res.status < 500 && res.status !== 429) {
            throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 400)}`);
          }
          throw new RetryableError(`Anthropic API ${res.status}`);
        }

        const body = (await res.json()) as AnthropicResponseBody;
        const toolUse = body.content?.find(
          (b): b is AnthropicToolUseBlock => b.type === 'tool_use' && b.input !== undefined,
        );
        if (!toolUse) {
          throw new LlmSchemaError('model did not return a tool_use block', req.operation);
        }

        return {
          value: req.parse(toolUse.input),
          model: body.model ?? this.model,
          inputTokens: body.usage?.input_tokens ?? 0,
          outputTokens: body.usage?.output_tokens ?? 0,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable = err instanceof RetryableError || err instanceof LlmSchemaError;
        if (!retryable || attempt === this.maxRetries) break;
        await sleep(250 * 2 ** attempt);
      }
    }
    throw lastError ?? new Error('LLM call failed');
  }
}

class RetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cache key for a call: stable across runs, so fixtures are reusable. */
export function llmFixtureKey(operation: string, system: string, user: string): string {
  return `${operation}-${stableHash(system, user).slice(0, 16)}`;
}

/**
 * Fixture-backed client.
 *
 * Tests and the golden set run against recorded replies so they are
 * deterministic, free and offline. A missing fixture is a loud failure with
 * the exact filename to create, never a silent fallback that would let a test
 * pass for the wrong reason.
 */
export class FixtureLlmClient implements LlmClient {
  constructor(private readonly fixtureDir: string) {}

  async json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    const key = llmFixtureKey(req.operation, req.system, req.user);
    const path = join(this.fixtureDir, `${key}.json`);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      throw new Error(
        `No LLM fixture for operation "${req.operation}".\n` +
          `Expected: ${path}\n` +
          `Record it by running with ANTHROPIC_API_KEY set and LLM_RECORD=1.`,
      );
    }
    const parsed = JSON.parse(raw) as { value: unknown; model?: string };
    return {
      value: req.parse(parsed.value),
      model: parsed.model ?? 'fixture',
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/**
 * Records real responses into the fixture directory as it proxies them, so the
 * fixture set can be regenerated deliberately rather than hand-written.
 */
export class RecordingLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly fixtureDir: string,
  ) {}

  async json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    const result = await this.inner.json(req);
    const key = llmFixtureKey(req.operation, req.system, req.user);
    await mkdir(this.fixtureDir, { recursive: true });
    await writeFile(
      join(this.fixtureDir, `${key}.json`),
      JSON.stringify({ operation: req.operation, value: result.value, model: result.model }, null, 2),
      'utf8',
    );
    return result;
  }
}

/**
 * Client driven by an in-test queue or handler. Used where a test wants to
 * assert behaviour against a specific model reply, including malformed ones.
 */
export class StubLlmClient implements LlmClient {
  readonly calls: Array<{ operation: string; system: string; user: string }> = [];

  constructor(private readonly handler: (req: { operation: string; user: string }) => unknown) {}

  async json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    this.calls.push({ operation: req.operation, system: req.system, user: req.user });
    const raw = this.handler({ operation: req.operation, user: req.user });
    return { value: req.parse(raw), model: 'stub', inputTokens: 0, outputTokens: 0 };
  }
}

/**
 * Refuses every call. Wired in wherever an LLM must not be reachable — the
 * deterministic-only paths — so a regression surfaces as a test failure rather
 * than a quiet API bill.
 */
export class DisabledLlmClient implements LlmClient {
  async json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>> {
    throw new Error(
      `LLM call "${req.operation}" attempted but the LLM is disabled in this context`,
    );
  }
}
