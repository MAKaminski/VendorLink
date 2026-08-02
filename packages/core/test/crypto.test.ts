import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  decryptSecret,
  einLast4,
  encryptSecret,
  formatEin,
  MissingEncryptionKeyError,
  safeEqual,
  stableHash,
} from '../src/crypto';

const KEY = randomBytes(32);

describe('column encryption', () => {
  it('round-trips a value', () => {
    const encrypted = encryptSecret('12-3456789', KEY);
    expect(decryptSecret(encrypted, KEY)).toBe('12-3456789');
  });

  it('produces different ciphertext for the same plaintext', () => {
    // A deterministic ciphertext would leak equality between tenants sharing
    // an EIN, which is exactly what a random IV per value prevents.
    const a = encryptSecret('12-3456789', KEY);
    const b = encryptSecret('12-3456789', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('rejects a value encrypted under a different key', () => {
    const encrypted = encryptSecret('secret', KEY);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow(DecryptionError);
  });

  it('rejects a tampered authentication tag', () => {
    const encrypted = encryptSecret('secret', KEY);
    const parts = encrypted.split('.');
    // Flip the tag; GCM must refuse rather than return garbage plaintext.
    parts[2] = Buffer.from(randomBytes(16)).toString('base64url');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(DecryptionError);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('secret value here', KEY);
    const parts = encrypted.split('.');
    const data = Buffer.from(parts[3] as string, 'base64url');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(DecryptionError);
  });

  it('rejects an unknown scheme version', () => {
    expect(() => decryptSecret('v9.a.b.c', KEY)).toThrow(/unrecognized ciphertext format/);
  });

  it('refuses a key of the wrong length', () => {
    expect(() => encryptSecret('x', randomBytes(16))).toThrow(/32 bytes/);
  });

  it('explains how to generate a key when none is configured', () => {
    const saved = process.env.VENDORLINK_ENCRYPTION_KEY;
    delete process.env.VENDORLINK_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow(MissingEncryptionKeyError);
    } finally {
      if (saved !== undefined) process.env.VENDORLINK_ENCRYPTION_KEY = saved;
    }
  });
});

describe('EIN handling', () => {
  it('extracts the last four digits regardless of formatting', () => {
    expect(einLast4('12-3456789')).toBe('6789');
    expect(einLast4('123456789')).toBe('6789');
  });

  it('formats a bare EIN with the conventional dash', () => {
    expect(formatEin('123456789')).toBe('12-3456789');
    expect(formatEin('12-3456789')).toBe('12-3456789');
  });

  it('leaves a malformed EIN untouched rather than corrupting it', () => {
    expect(formatEin('not-an-ein')).toBe('not-an-ein');
  });
});

describe('safeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(safeEqual('abcdef', 'abcdef')).toBe(true);
  });

  it('rejects different strings and different lengths', () => {
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('stableHash', () => {
  it('is stable across calls and order-sensitive', () => {
    expect(stableHash('a', 'b')).toBe(stableHash('a', 'b'));
    expect(stableHash('a', 'b')).not.toBe(stableHash('b', 'a'));
  });
});
