import type { FetchResult, HttpFetcher } from './types.js';

/**
 * HttpFetcher over the platform `fetch`.
 *
 * Engine #1 crawls third-party sites, so this is deliberately conservative:
 * a short timeout, a capped body size, a redirect ceiling, an identifying
 * User-Agent, and non-HTML content refused before it is buffered. Failures
 * come back as a `FetchResult` with an `error` rather than throwing, because
 * the resolution trace has to record what we tried and what happened.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 3 * 1024 * 1024;

export interface NodeHttpFetcherOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export class NodeHttpFetcher implements HttpFetcher {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;

  constructor(opts: NodeHttpFetcherOptions = {}) {
    this.userAgent =
      opts.userAgent ??
      'VendorLinkBot/1.0 (+https://vendorlink.app/bot; vendor onboarding discovery)';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  }

  async fetch(url: string, opts?: { timeoutMs?: number }): Promise<FetchResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? this.timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const contentType = res.headers.get('content-type');
      // Refuse binaries before buffering: a PDF packet page is a channel
      // signal, not something to parse for emails.
      if (contentType && !/(text\/|application\/(xml|xhtml|json))/i.test(contentType)) {
        return {
          url,
          finalUrl: res.url || url,
          status: res.status,
          contentType,
          body: '',
          durationMs: Date.now() - started,
          error: `skipped non-text content-type: ${contentType}`,
        };
      }

      const body = await this.readCapped(res);
      return {
        url,
        finalUrl: res.url || url,
        status: res.status,
        contentType,
        body,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        url,
        finalUrl: url,
        status: 0,
        contentType: null,
        body: '',
        durationMs: Date.now() - started,
        error: aborted ? 'timeout' : err instanceof Error ? err.message : 'fetch failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Stop reading once the cap is hit rather than buffering a huge page. */
  private async readCapped(res: Response): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < this.maxBodyBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }
}

/**
 * In-memory fetcher backed by a URL→body map.
 *
 * This is what the golden-set tests and the E2E fixtures run against, so
 * Engine #1 never touches the network under test.
 */
export class MapHttpFetcher implements HttpFetcher {
  readonly requested: string[] = [];

  constructor(
    private readonly pages: Map<string, { body: string; status?: number; contentType?: string }>,
  ) {}

  async fetch(url: string): Promise<FetchResult> {
    this.requested.push(url);
    const normalized = url.replace(/#.*$/, '');
    const hit = this.pages.get(normalized) ?? this.pages.get(normalized.replace(/\/$/, ''));
    if (!hit) {
      return {
        url,
        finalUrl: url,
        status: 404,
        contentType: null,
        body: '',
        durationMs: 0,
        error: 'not found in fixture map',
      };
    }
    return {
      url,
      finalUrl: url,
      status: hit.status ?? 200,
      contentType: hit.contentType ?? 'text/html',
      body: hit.body,
      durationMs: 0,
    };
  }
}
