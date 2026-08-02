import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Column-level encryption for the two secrets §10 says must never sit in
 * plaintext: the EIN and bank/remittance details.
 *
 * AES-256-GCM with a random 96-bit IV per value. The stored form is
 * `v1.<iv>.<tag>.<ciphertext>`, all base64url, so the version prefix leaves
 * room to rotate the scheme without a migration guess.
 *
 * In production the key comes from a KMS; here it is read from
 * `VENDORLINK_ENCRYPTION_KEY` (base64, 32 bytes).
 */

const SCHEME = 'v1';
const IV_BYTES = 12;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      'VENDORLINK_ENCRYPTION_KEY is not set. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    this.name = 'MissingEncryptionKeyError';
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

function resolveKey(explicit?: Buffer): Buffer {
  if (explicit) {
    if (explicit.length !== 32) throw new Error('encryption key must be 32 bytes');
    return explicit;
  }
  const raw = process.env.VENDORLINK_ENCRYPTION_KEY;
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('VENDORLINK_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string, key?: Buffer): string {
  const k = resolveKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(encoded: string, key?: Buffer): string {
  const k = resolveKey(key);
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new DecryptionError('unrecognized ciphertext format');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Deliberately opaque: a padding/tag failure must not become an oracle.
    throw new DecryptionError('failed to decrypt value');
  }
}

/** Last four digits of an EIN, safe to store and display in plaintext. */
export function einLast4(ein: string): string {
  const digits = ein.replace(/\D/g, '');
  if (digits.length < 4) throw new Error('EIN too short');
  return digits.slice(-4);
}

export function formatEin(ein: string): string {
  const digits = ein.replace(/\D/g, '');
  if (digits.length !== 9) return ein;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time string comparison for webhook signatures and tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Stable hash for the idempotency key in §4.3 and for caching generated essay
 * answers per (tenant, question).
 */
export function stableHash(...parts: readonly string[]): string {
  return sha256Hex(parts.join('|'));
}
