/**
 * Provider seams.
 *
 * Every external side effect the product has — storage, mail, queue, LLM,
 * network fetch, DNS, time — is reached through one of these interfaces. Two
 * things fall out of that:
 *
 *  1. The whole system runs and is testable with no credentials; the local
 *     implementations under `./local/` are selected when the corresponding env
 *     vars are absent.
 *  2. Both engines become deterministic under test, because `Clock`,
 *     `HttpFetcher` and `DnsResolver` are injected rather than imported.
 */

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test clock; `advance` moves it without waiting. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = d;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

// ---------------------------------------------------------------------------
// Object storage
// ---------------------------------------------------------------------------

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Bytes are hashed by the caller; the store verifies on read. */
  sha256?: string;
}

export interface StoredObject {
  key: string;
  bytes: number;
  contentType: string;
  sha256: string;
}

export interface PresignOptions {
  /** Seconds. §10 caps this at 15 minutes for reads. */
  expiresInSeconds: number;
  /** Filename offered to the browser on download. */
  downloadFilename?: string;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Time-limited URL for a browser to PUT directly. */
  presignPut(key: string, contentType: string, opts: PresignOptions): Promise<string>;
  /** Time-limited URL for a browser to GET. Never a public URL. */
  presignGet(key: string, opts: PresignOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendMailInput {
  from: string;
  fromName?: string;
  to: string;
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
  /** Threaded through to the provider so webhooks can be matched to a run. */
  tags?: Record<string, string>;
}

export interface SendMailResult {
  providerMessageId: string;
  sentAt: Date;
}

export interface DomainVerificationStatus {
  domain: string;
  verified: boolean;
  spf: 'ok' | 'missing' | 'invalid';
  dkim: 'ok' | 'missing' | 'invalid';
  dmarc: 'ok' | 'missing' | 'invalid';
  /** DNS records the operator still needs to add. */
  pendingRecords: Array<{ type: string; name: string; value: string }>;
}

export interface Mailer {
  send(input: SendMailInput): Promise<SendMailResult>;
  getDomainStatus(domain: string): Promise<DomainVerificationStatus | null>;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface QueueEvent<TName extends string = string, TData = unknown> {
  name: TName;
  data: TData;
  /** Provider-level dedupe; we also enforce idempotency in Postgres. */
  idempotencyKey?: string;
  delaySeconds?: number;
}

export interface Queue {
  send<TName extends string, TData>(event: QueueEvent<TName, TData>): Promise<{ eventId: string }>;
}

// ---------------------------------------------------------------------------
// HTTP fetching (Engine #1 discovery)
// ---------------------------------------------------------------------------

export interface FetchResult {
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  /** Wall-clock duration, recorded in the resolution trace. */
  durationMs: number;
  error?: string;
}

export interface HttpFetcher {
  fetch(url: string, opts?: { timeoutMs?: number }): Promise<FetchResult>;
}

// ---------------------------------------------------------------------------
// DNS (Engine #1 verification)
// ---------------------------------------------------------------------------

export interface MxRecord {
  exchange: string;
  priority: number;
}

export interface DnsResolver {
  resolveMx(domain: string): Promise<MxRecord[]>;
  resolveTxt(domain: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

/**
 * The LLM is only ever asked for structured output against a schema it cannot
 * escape. There is no free-text completion method on this interface by design:
 * §5 and §6 both require that the model select among supplied candidates
 * rather than generate values.
 */
export interface LlmJsonRequest<T> {
  /** Identifies the call site; also the fixture lookup key under test. */
  operation: string;
  system: string;
  user: string;
  /** Validates and narrows the model's reply. */
  parse: (raw: unknown) => T;
  /** JSON Schema handed to the model to constrain its output. */
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmJsonResponse<T> {
  value: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResponse<T>>;
}

/** Thrown when the model's reply cannot be coerced to the requested schema. */
export class LlmSchemaError extends Error {
  constructor(
    message: string,
    readonly operation: string,
  ) {
    super(message);
    this.name = 'LlmSchemaError';
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

import type { TenantRole } from '../enums.js';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string | null;
}

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  role: TenantRole;
}

export interface AuthSession {
  user: AuthenticatedUser;
  /** The tenant the request is acting within. */
  membership: TenantMembership;
}

export interface AuthProvider {
  /** Resolves the session from an opaque token (session cookie value). */
  verifySession(token: string): Promise<AuthSession | null>;
  createSession(userId: string, tenantId: string): Promise<{ token: string; expiresAt: Date }>;
  destroySession(token: string): Promise<void>;
}
