import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { sha256Hex, safeEqual } from '../../crypto.js';
import type {
  ObjectStore,
  PresignOptions,
  PutObjectInput,
  StoredObject,
} from '../types.js';

/**
 * Filesystem-backed ObjectStore.
 *
 * Stands in for R2 / Supabase Storage when no S3 credentials are configured.
 * The S3 implementation satisfies the same interface, so switching is an env
 * change rather than a code change.
 *
 * "Presigned" URLs are HMAC-signed relative paths that the web app's
 * `/api/storage/[...]` route verifies before streaming bytes — same contract as
 * S3 (time-limited, unguessable, no public objects), just enforced by us.
 */
export class LocalObjectStore implements ObjectStore {
  private readonly root: string;
  private readonly signingKey: string;

  constructor(opts?: { root?: string; signingKey?: string }) {
    this.root = resolve(opts?.root ?? process.env.LOCAL_STORAGE_ROOT ?? '.localstore');
    this.signingKey =
      opts?.signingKey ?? process.env.LOCAL_STORAGE_SIGNING_KEY ?? 'dev-only-signing-key';
  }

  /**
   * Resolve a key to a path, refusing anything that escapes the root.
   * Keys are caller-supplied, so `../` traversal is a real concern.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`object key escapes storage root: ${key}`);
    }
    return full;
  }

  private metaPathFor(key: string): string {
    return this.pathFor(key) + '.meta.json';
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });

    const digest = sha256Hex(input.body);
    if (input.sha256 && input.sha256 !== digest) {
      throw new Error(
        `sha256 mismatch for ${input.key}: expected ${input.sha256}, computed ${digest}`,
      );
    }

    await writeFile(path, input.body);
    const meta: StoredObject = {
      key: input.key,
      bytes: input.body.byteLength,
      contentType: input.contentType,
      sha256: digest,
    };
    await writeFile(this.metaPathFor(input.key), JSON.stringify(meta), 'utf8');
    return meta;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const raw = await readFile(this.metaPathFor(key), 'utf8');
      return JSON.parse(raw) as StoredObject;
    } catch {
      // Fall back to a stat when metadata is missing (object written directly).
      try {
        const s = await stat(this.pathFor(key));
        return {
          key,
          bytes: s.size,
          contentType: 'application/octet-stream',
          sha256: sha256Hex(await readFile(this.pathFor(key))),
        };
      } catch {
        return null;
      }
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
    await rm(this.metaPathFor(key), { force: true });
  }

  async presignPut(key: string, contentType: string, opts: PresignOptions): Promise<string> {
    return this.sign('PUT', key, opts, { contentType });
  }

  async presignGet(key: string, opts: PresignOptions): Promise<string> {
    return this.sign('GET', key, opts, { filename: opts.downloadFilename });
  }

  private sign(
    method: 'GET' | 'PUT',
    key: string,
    opts: PresignOptions,
    extra: Record<string, string | undefined>,
  ): string {
    const expires = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    const nonce = randomUUID();
    const signature = LocalObjectStore.computeSignature(
      this.signingKey,
      method,
      key,
      expires,
      nonce,
    );
    const params = new URLSearchParams({
      expires: String(expires),
      nonce,
      signature,
      method,
    });
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
    return `/api/storage/${encodeURI(key)}?${params.toString()}`;
  }

  static computeSignature(
    signingKey: string,
    method: string,
    key: string,
    expires: number,
    nonce: string,
  ): string {
    return createHmac('sha256', signingKey)
      .update([method, key, expires, nonce].join('\n'))
      .digest('base64url');
  }

  /** Used by the storage route to authorize a presigned request. */
  static verifySignature(params: {
    signingKey: string;
    method: string;
    key: string;
    expires: number;
    nonce: string;
    signature: string;
    nowSeconds?: number;
  }): { ok: true } | { ok: false; reason: 'expired' | 'bad_signature' } {
    const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (params.expires < now) return { ok: false, reason: 'expired' };
    const expected = LocalObjectStore.computeSignature(
      params.signingKey,
      params.method,
      params.key,
      params.expires,
      params.nonce,
    );
    return safeEqual(expected, params.signature) ? { ok: true } : { ok: false, reason: 'bad_signature' };
  }

  /** Absolute path of an object, for the worker materializing files to /tmp. */
  absolutePath(key: string): string {
    return this.pathFor(key);
  }

  storageRoot(): string {
    return this.root;
  }
}

/** Deterministic, tenant-scoped storage keys. */
export function documentStorageKey(tenantId: string, documentId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return join('tenants', tenantId, 'documents', documentId, safe);
}

export function artifactStorageKey(runId: string, taskId: string, name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return join('artifacts', runId, taskId, safe);
}
