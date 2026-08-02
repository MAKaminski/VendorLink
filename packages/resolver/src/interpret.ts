import { z } from 'zod';
import type { LlmClient } from '@vendorlink/core';
import { contactKindSchema } from '@vendorlink/core/domain';
import { normalizeEmail, type HarvestedPage } from './harvest';

/**
 * S4 — interpret.
 *
 * The model is shown addresses that a regex already found and is asked only
 * *which one* is the vendor-onboarding inbox. It cannot introduce an address:
 * `chooseVendorContact` rejects any reply whose email is not in the supplied
 * candidate set.
 *
 * It must also return an `evidence_quote` that appears literally in the
 * fetched text. That is the single most important check in this engine — it is
 * what makes a hallucinated justification fail closed rather than becoming a
 * confident wrong answer that we then email.
 */

const interpretationSchema = z.object({
  selections: z
    .array(
      z.object({
        email: z.string(),
        kind: contactKindSchema,
        evidence_quote: z.string().min(8),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().max(400).optional(),
      }),
    )
    .max(5),
});

export type Interpretation = z.infer<typeof interpretationSchema>;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selections'],
  properties: {
    selections: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'kind', 'evidence_quote', 'confidence'],
        properties: {
          email: {
            type: 'string',
            description: 'Must be copied exactly from the CANDIDATES list.',
          },
          kind: {
            type: 'string',
            enum: [
              'vendor_onboarding', 'procurement', 'ap', 'maintenance',
              'regional', 'general', 'unknown',
            ],
          },
          evidence_quote: {
            type: 'string',
            description:
              'A verbatim span copied from PAGE TEXT that justifies the choice. ' +
              'It is checked character-for-character against the page and the ' +
              'selection is discarded if it does not appear.',
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string', maxLength: 400 },
        },
      },
    },
  },
} as const;

const SYSTEM = `You identify which email address on a property management company's website is \
intended for a service vendor (HVAC, plumbing, landscaping, cleaning, etc.) seeking to join that \
company's approved vendor pool.

Rules:
- Only ever return an address that appears verbatim in the CANDIDATES list. Never construct, \
correct, complete or guess an address.
- Every selection must include an evidence_quote copied verbatim from PAGE TEXT. The quote is \
verified against the page; a selection whose quote is not found is discarded.
- If no candidate is plausibly a vendor-onboarding contact, return an empty selections array. An \
empty answer is correct and useful; a speculative one is not.
- Prefer an address whose surrounding text explicitly mentions vendors, suppliers, contractors, \
or becoming an approved service provider.
- Do not select recruiting (careers@, hr@), sales, leasing, or press addresses. Those are wrong \
departments, not weak matches.`;

export interface InterpretInput {
  readonly llm: LlmClient;
  readonly page: HarvestedPage;
  readonly candidates: readonly string[];
  readonly companyName?: string;
  /** Cap on page text sent to the model. */
  readonly maxTextChars?: number;
}

export interface InterpretedContact {
  readonly email: string;
  readonly kind: z.infer<typeof contactKindSchema>;
  readonly evidenceQuote: string;
  readonly confidence: number;
  readonly reasoning: string | null;
}

export interface InterpretResult {
  readonly selections: readonly InterpretedContact[];
  /** Selections thrown out, with why — surfaced in the trace. */
  readonly rejected: ReadonlyArray<{ email: string; reason: string }>;
  readonly called: boolean;
}

/**
 * Normalize text for quote checking.
 *
 * Whitespace is collapsed and case is folded so a model that reflows a quote
 * across lines is not punished for formatting. Nothing else is relaxed: the
 * words themselves must match.
 */
function normalizeForQuoteCheck(text: string): string {
  return text.toLowerCase().replace(/[\s ]+/g, ' ').trim();
}

export function quoteAppearsInText(quote: string, text: string): boolean {
  const needle = normalizeForQuoteCheck(quote);
  if (needle.length < 8) return false;
  return normalizeForQuoteCheck(text).includes(needle);
}

export async function interpretPage(input: InterpretInput): Promise<InterpretResult> {
  if (input.candidates.length === 0) {
    return { selections: [], rejected: [], called: false };
  }

  const maxChars = input.maxTextChars ?? 6000;
  const pageText = input.page.text.slice(0, maxChars);

  const user = [
    input.companyName ? `COMPANY: ${input.companyName}` : null,
    `PAGE URL: ${input.page.url}`,
    `PAGE TITLE: ${input.page.title}`,
    `PAGE H1: ${input.page.h1}`,
    '',
    'CANDIDATES (choose only from these, verbatim):',
    ...input.candidates.map((c) => `- ${c}`),
    '',
    'PAGE TEXT:',
    pageText,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const response = await input.llm.json({
    operation: 'resolver.interpret_contacts',
    system: SYSTEM,
    user,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => interpretationSchema.parse(raw),
    maxTokens: 1024,
  });

  const candidateSet = new Set(input.candidates.map((c) => normalizeEmail(c)));
  const selections: InterpretedContact[] = [];
  const rejected: Array<{ email: string; reason: string }> = [];

  for (const selection of response.value.selections) {
    const email = normalizeEmail(selection.email);

    // Guard 1: the address must be one we actually found on the page.
    if (!candidateSet.has(email)) {
      rejected.push({ email, reason: 'not in the candidate set — model invented or altered it' });
      continue;
    }

    // Guard 2: the justification must literally appear in the fetched text.
    // Checked against the full page text, not the truncated prompt slice, so a
    // legitimate quote near the cut-off is not falsely rejected.
    if (!quoteAppearsInText(selection.evidence_quote, input.page.text)) {
      rejected.push({
        email,
        reason: `evidence quote not found in page text: "${selection.evidence_quote.slice(0, 60)}"`,
      });
      continue;
    }

    selections.push({
      email,
      kind: selection.kind,
      evidenceQuote: selection.evidence_quote,
      confidence: selection.confidence,
      reasoning: selection.reasoning ?? null,
    });
  }

  return { selections, rejected, called: true };
}
