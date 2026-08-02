import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeCompleteness,
  documentStorageKey,
  LocalObjectStore,
  sha256Hex,
} from '@vendorlink/core';
import { DirectoryRepository, repositoriesFor, type TenantRepositories } from '@vendorlink/db';
import { createTestDatabase, type TestDatabase } from '@vendorlink/db/testing';
import { LocalAuthProvider, signIn, signUp } from '../src/lib/auth';

/**
 * P0 gate.
 *
 * "Can create a tenant, upload a W-9, see a PM card." This drives the real
 * implementations behind those three things — signup, the object store plus
 * document repository, and the directory query — against a real Postgres.
 *
 * What it deliberately does not drive is the Next glue (server actions read
 * `cookies()` and only work inside a request). Those are covered separately by
 * HTTP checks against a running server; here the point is that the logic they
 * call is correct.
 */

let testDb: TestDatabase;
let storeRoot: string;
let store: LocalObjectStore;

beforeAll(async () => {
  testDb = await createTestDatabase();
  storeRoot = await mkdtemp(join(tmpdir(), 'vl-store-'));
  store = new LocalObjectStore({ root: storeRoot, signingKey: 'test-signing-key' });
  process.env.VENDORLINK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

afterAll(async () => {
  await testDb?.close();
  if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
});

describe('creating a tenant', () => {
  it('creates the user, tenant, membership and profile together', async () => {
    const result = await signUp(testDb.db, {
      email: 'dana@peachtree.example',
      password: 'correct-horse-battery-staple',
      name: 'Dana Whitfield',
      companyName: 'Peachtree Grounds LLC',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    const repos = repositoriesFor(testDb.db, result.tenantId);
    const profile = await repos.profile.get();
    expect(profile?.legal_name).toBe('Peachtree Grounds LLC');
  });

  it('rejects a duplicate email', async () => {
    const again = await signUp(testDb.db, {
      email: 'dana@peachtree.example',
      password: 'another-password-entirely',
      companyName: 'Second Attempt LLC',
    });
    expect(again).toEqual({ error: expect.stringContaining('already exists') });
  });

  it('signs in with the right password and rejects the wrong one', async () => {
    const ok = await signIn(testDb.db, 'dana@peachtree.example', 'correct-horse-battery-staple');
    expect('error' in ok).toBe(false);

    const bad = await signIn(testDb.db, 'dana@peachtree.example', 'wrong-password');
    expect(bad).toEqual({ error: 'Incorrect email or password.' });
  });

  it('gives the same error for an unknown address as for a wrong password', async () => {
    // Distinguishing the two would let anyone enumerate registered addresses.
    const unknown = await signIn(testDb.db, 'nobody@example.test', 'whatever');
    expect(unknown).toEqual({ error: 'Incorrect email or password.' });
  });

  it('mints a session that verifies, and stops verifying once destroyed', async () => {
    const signed = await signIn(testDb.db, 'dana@peachtree.example', 'correct-horse-battery-staple');
    if ('error' in signed) throw new Error('sign-in failed');

    const auth = new LocalAuthProvider(testDb.db);
    const { token } = await auth.createSession(signed.userId, signed.tenantId);

    const session = await auth.verifySession(token);
    expect(session?.membership.tenantId).toBe(signed.tenantId);
    expect(session?.membership.role).toBe('owner');

    await auth.destroySession(token);
    expect(await auth.verifySession(token)).toBeNull();
  });

  it('refuses to mint a session for a tenant the user does not belong to', async () => {
    const other = await signUp(testDb.db, {
      email: 'stranger@example.test',
      password: 'a-completely-different-password',
      companyName: 'Stranger Services LLC',
    });
    if ('error' in other) throw new Error('setup failed');
    const mine = await signIn(testDb.db, 'dana@peachtree.example', 'correct-horse-battery-staple');
    if ('error' in mine) throw new Error('setup failed');

    const auth = new LocalAuthProvider(testDb.db);
    await expect(auth.createSession(mine.userId, other.tenantId)).rejects.toThrow(/not a member/);
  });
});

describe('uploading a W-9', () => {
  let repos: TenantRepositories;
  let tenantId: string;

  beforeAll(async () => {
    const created = await signUp(testDb.db, {
      email: 'uploads@example.test',
      password: 'a-sufficiently-long-password',
      companyName: 'Upload Test LLC',
    });
    if ('error' in created) throw new Error('setup failed');
    tenantId = created.tenantId;
    repos = repositoriesFor(testDb.db, tenantId);
  });

  it('stores the bytes, records the digest, and raises completeness', async () => {
    const before = computeCompleteness((await repos.profile.get())!).score;

    const body = Buffer.from('%PDF-1.7\nfake w-9 content\n');
    const digest = sha256Hex(body);
    const documentId = '11111111-1111-4111-8111-111111111111';
    const key = documentStorageKey(tenantId, documentId, 'w9.pdf');

    await store.put({ key, body, contentType: 'application/pdf', sha256: digest });
    await repos.documents.insert({
      id: documentId,
      kind: 'W9',
      label: 'W-9 2026',
      r2Key: key,
      mime: 'application/pdf',
      bytes: body.byteLength,
      sha256: digest,
    });
    await repos.profile.refreshCompleteness();

    const stored = await store.get(key);
    expect(sha256Hex(stored)).toBe(digest);

    const row = await repos.documents.findById(documentId);
    expect(row?.sha256).toBe(digest);
    expect(row?.isCurrent).toBe(true);

    const after = computeCompleteness((await repos.profile.get())!).score;
    expect(after).toBeGreaterThan(before);
  });

  it('refuses bytes whose digest does not match the declared one', async () => {
    // The worker verifies sha256 when materializing a document to /tmp; the
    // store refusing a mismatch is what makes that check meaningful.
    await expect(
      store.put({
        key: 'tenants/x/documents/y/bad.pdf',
        body: Buffer.from('actual bytes'),
        contentType: 'application/pdf',
        sha256: sha256Hex(Buffer.from('different bytes')),
      }),
    ).rejects.toThrow(/sha256 mismatch/);
  });

  it('refuses a key that escapes the storage root', async () => {
    await expect(
      store.put({
        key: '../../etc/passwd',
        body: Buffer.from('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(/escapes storage root/);
  });

  it('supersedes the previous W-9 so exactly one stays current', async () => {
    const second = '22222222-2222-4222-8222-222222222222';
    const body = Buffer.from('%PDF-1.7\nnewer w-9\n');
    const key = documentStorageKey(tenantId, second, 'w9-v2.pdf');
    await store.put({ key, body, contentType: 'application/pdf' });
    await repos.documents.insert({
      id: second,
      kind: 'W9',
      label: 'W-9 2027',
      r2Key: key,
      mime: 'application/pdf',
      bytes: body.byteLength,
      sha256: sha256Hex(body),
    });
    await repos.documents.supersedePrevious('W9', second);

    const current = await repos.documents.listByKind('W9');
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(second);
  });

  it('issues a presigned URL that verifies, and rejects a tampered one', async () => {
    const url = await store.presignGet('tenants/a/documents/b/w9.pdf', { expiresInSeconds: 900 });
    const params = new URL(url, 'http://localhost').searchParams;

    expect(
      LocalObjectStore.verifySignature({
        signingKey: 'test-signing-key',
        method: 'GET',
        key: 'tenants/a/documents/b/w9.pdf',
        expires: Number(params.get('expires')),
        nonce: params.get('nonce')!,
        signature: params.get('signature')!,
      }),
    ).toEqual({ ok: true });

    // Same signature, different key: must not authorize a different object.
    expect(
      LocalObjectStore.verifySignature({
        signingKey: 'test-signing-key',
        method: 'GET',
        key: 'tenants/other/documents/z/secret.pdf',
        expires: Number(params.get('expires')),
        nonce: params.get('nonce')!,
        signature: params.get('signature')!,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('reports an expired presigned URL as expired', async () => {
    const url = await store.presignGet('tenants/a/documents/b/w9.pdf', { expiresInSeconds: 60 });
    const params = new URL(url, 'http://localhost').searchParams;
    expect(
      LocalObjectStore.verifySignature({
        signingKey: 'test-signing-key',
        method: 'GET',
        key: 'tenants/a/documents/b/w9.pdf',
        expires: Number(params.get('expires')),
        nonce: params.get('nonce')!,
        signature: params.get('signature')!,
        nowSeconds: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('seeing a PM card', () => {
  let directory: DirectoryRepository;

  beforeAll(async () => {
    directory = new DirectoryRepository(testDb.db);
    const { seedDirectory } = await import('@vendorlink/db/seeds');
    await seedDirectory(testDb.url);
  });

  it('lists the seeded directory', async () => {
    const { rows, total } = await directory.search({ limit: 25 });
    expect(total).toBe(50);
    expect(rows).toHaveLength(25);
  });

  it('filters by state', async () => {
    const { rows } = await directory.search({ state: 'GA', limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.hqState === 'GA')).toBe(true);
  });

  it('filters by search term across name and domain', async () => {
    const byName = await directory.search({ q: 'Oakwood' });
    expect(byName.rows[0]?.name).toContain('Oakwood');

    const byDomain = await directory.search({ q: 'peachtree-pp' });
    expect(byDomain.rows[0]?.domain).toBe('peachtree-pp.example');
  });

  it('filters by minimum portfolio size', async () => {
    const { rows } = await directory.search({ minUnits: 10_000, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => (r.portfolioUnits ?? 0) >= 10_000)).toBe(true);
  });

  it('marks every seeded row unverified so it stays out of the global list', async () => {
    const { rows } = await directory.search({ limit: 50 });
    expect(rows.every((r) => r.source === 'seed' && r.verified === false)).toBe(true);
  });

  it('returns a company by id for the card', async () => {
    const { rows } = await directory.search({ q: 'Oakwood' });
    const card = await directory.findById(rows[0]!.id);
    expect(card?.name).toContain('Oakwood');
    expect(card?.portfolioUnits).toBeGreaterThan(0);
  });

  it('re-seeding does not duplicate rows', async () => {
    const { seedDirectory } = await import('@vendorlink/db/seeds');
    await seedDirectory(testDb.url);
    const { total } = await directory.search({ limit: 1 });
    expect(total).toBe(50);
  });
});
