import { sha256Hex } from '../crypto';
import type { ObjectStore, PresignOptions, PutObjectInput, StoredObject } from './types';

/**
 * Supabase Storage implementation of `ObjectStore`.
 *
 * The local filesystem store cannot work on a serverless host: the filesystem
 * is read-only apart from `/tmp`, and `/tmp` does not survive between
 * invocations, so an uploaded document would vanish before anyone could read
 * it back.
 *
 * This talks to Supabase Storage's REST API with `fetch` rather than pulling in
 * the AWS S3 SDK. Storage's own signing endpoint gives us exactly the
 * time-limited URLs §10 requires, and avoiding a ~2 MB SDK in a serverless
 * bundle is worth more than the abstract portability — the `ObjectStore`
 * interface is already where portability lives.
 *
 * The service role key is used because these objects are private and the app
 * has already authorized the request through its own tenant-scoped session. It
 * must never reach the browser.
 */

export interface SupabaseStorageOptions {
  /** e.g. https://abcdefg.supabase.co */
  url?: string;
  serviceRoleKey?: string;
  bucket?: string;
}

export class SupabaseObjectStore implements ObjectStore {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly bucket: string;

  constructor(opts: SupabaseStorageOptions = {}) {
    const url = opts.url ?? process.env.SUPABASE_URL;
    const key = opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = opts.bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? 'vendorlink-documents';

    if (!url) throw new Error('SUPABASE_URL is required for SupabaseObjectStore');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for SupabaseObjectStore');

    this.baseUrl = url.replace(/\/$/, '');
    this.key = key;
    this.bucket = bucket;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.key}`,
      apikey: this.key,
      ...extra,
    };
  }

  private objectUrl(key: string): string {
    // Each path segment is encoded separately so `/` keeps its meaning as a
    // separator while a `#` or `?` inside a filename does not break the URL.
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${encoded}`;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const digest = sha256Hex(input.body);
    if (input.sha256 && input.sha256 !== digest) {
      throw new Error(
        `sha256 mismatch for ${input.key}: expected ${input.sha256}, computed ${digest}`,
      );
    }

    const res = await fetch(this.objectUrl(input.key), {
      method: 'POST',
      headers: this.headers({
        'content-type': input.contentType,
        // Overwrite rather than fail: document ids are unique, so a repeat PUT
        // is a retry of the same upload, not a collision.
        'x-upsert': 'true',
      }),
      body: new Uint8Array(input.body),
    });

    if (!res.ok) {
      throw new Error(`Supabase Storage upload failed (${res.status}): ${await res.text()}`);
    }

    return {
      key: input.key,
      bytes: input.body.byteLength,
      contentType: input.contentType,
      sha256: digest,
    };
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Supabase Storage download failed (${res.status}) for ${key}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await fetch(this.objectUrl(key), { method: 'HEAD', headers: this.headers() });
    if (!res.ok) return null;

    const bytes = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
    return {
      key,
      bytes: Number.isFinite(bytes) ? bytes : 0,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      // Storage does not return our digest; the recorded value on the
      // `documents` row remains the source of truth for integrity checks.
      sha256: '',
    };
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), { method: 'DELETE', headers: this.headers() });
    // A missing object is already in the desired state.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase Storage delete failed (${res.status}) for ${key}`);
    }
  }

  /**
   * Supabase Storage has no presigned-upload-URL equivalent that matches the
   * S3 semantics here, and the app uploads server-side anyway (the route
   * handler receives the file and calls `put`). Returning the app's own
   * storage route keeps the interface honest rather than handing back a URL
   * that would not work.
   */
  async presignPut(key: string, contentType: string, opts: PresignOptions): Promise<string> {
    const params = new URLSearchParams({
      method: 'PUT',
      contentType,
      expires: String(Math.floor(Date.now() / 1000) + opts.expiresInSeconds),
    });
    return `/api/storage/${encodeURI(key)}?${params.toString()}`;
  }

  /** A time-limited download URL, signed by Storage itself. */
  async presignGet(key: string, opts: PresignOptions): Promise<string> {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${encoded}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ expiresIn: opts.expiresInSeconds }),
    });

    if (!res.ok) {
      throw new Error(`Supabase Storage signing failed (${res.status}) for ${key}`);
    }

    const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = body.signedURL ?? body.signedUrl;
    if (!signed) throw new Error('Supabase Storage returned no signed URL');

    const url = new URL(`${this.baseUrl}/storage/v1${signed.replace(/^\/storage\/v1/, '')}`);
    if (opts.downloadFilename) url.searchParams.set('download', opts.downloadFilename);
    return url.toString();
  }
}

/** True when the environment is configured for Supabase Storage. */
export function hasSupabaseStorage(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
