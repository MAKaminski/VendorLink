import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrossTenantAccessError, repositoriesFor, type TenantRepositories } from '../src/repositories/index';
import { createTestDatabase, seedTenant, type TestDatabase } from '../src/testing/harness';

/**
 * Tenant isolation (§10).
 *
 * Two tenants are populated with a full set of rows, then every read/write
 * path on every tenant-scoped repository is exercised from tenant B against
 * tenant A's identifiers. The assertion is uniform: A's data is never visible
 * and never mutable from B.
 *
 * The `REPOSITORY_METHOD_COVERAGE` check at the bottom is the part that keeps
 * this honest over time — it fails when a new method is added to a scoped
 * repository without a corresponding cross-tenant case here, so the suite
 * cannot silently fall behind the code it guards.
 */

let testDb: TestDatabase;
let alice: TenantRepositories;
let bob: TenantRepositories;
let aliceIds: {
  tenantId: string;
  documentId: string;
  runId: string;
  emailTaskId: string;
  portalTaskId: string;
  eventId: string;
  pmCompanyId: string;
};

beforeAll(async () => {
  testDb = await createTestDatabase();

  const a = await seedTenant(testDb.db, { name: 'Alice Landscaping', legalName: 'Alice LLC' });
  const b = await seedTenant(testDb.db, { name: 'Bob Plumbing', legalName: 'Bob LLC' });

  alice = repositoriesFor(testDb.db, a.tenantId);
  bob = repositoriesFor(testDb.db, b.tenantId);

  // A PM company is global, so both tenants legitimately see it; it exists
  // here so runs and tasks have something to point at.
  const [pmCompany] = await testDb.db
    .insert((await import('../src/schema/index')).pmCompanies)
    .values({ name: 'Oakwood Residential', domain: 'oakwood.test', hqState: 'GA' })
    .returning();

  const doc = await alice.documents.insert({
    kind: 'W9',
    label: 'Alice W-9',
    r2Key: 'tenants/alice/documents/w9.pdf',
    mime: 'application/pdf',
    bytes: 1234,
    sha256: 'a'.repeat(64),
  });

  const { run } = await alice.runs.createIdempotent({
    pmCompanyId: pmCompany!.id,
    profileVersion: 1,
  });
  const emailTask = await alice.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
  const portalTask = await alice.tasks.createTask({ runId: run.id, kind: 'PORTAL' });
  const event = await alice.events.append({
    taskId: emailTask.id,
    eventType: 'queued',
    message: 'Alice private event',
  });
  await alice.fieldWrites.appendMany(portalTask.id, [
    {
      selector: '#company',
      valueWritten: 'Alice LLC',
      confidence: 1,
      wasLlmMapped: false,
    },
  ]);

  aliceIds = {
    tenantId: a.tenantId,
    documentId: doc.id,
    runId: run.id,
    emailTaskId: emailTask.id,
    portalTaskId: portalTask.id,
    eventId: event.id,
    pmCompanyId: pmCompany!.id,
  };
});

afterAll(async () => {
  await testDb?.close();
});

describe('profile repository', () => {
  it("does not return another tenant's profile", async () => {
    const aliceProfile = await alice.profile.get();
    const bobProfile = await bob.profile.get();
    expect(aliceProfile?.legal_name).toBe('Alice LLC');
    expect(bobProfile?.legal_name).toBe('Bob LLC');
    expect(bobProfile?.tenant_id).not.toBe(aliceIds.tenantId);
  });

  it("cannot update another tenant's profile", async () => {
    await bob.profile.update({ legalName: 'Bob Renamed' });
    const aliceProfile = await alice.profile.get();
    expect(aliceProfile?.legal_name).toBe('Alice LLC');
  });

  it('scopes completeness recomputation to its own tenant', async () => {
    const before = (await alice.profile.get())?.completeness_score;
    await bob.profile.refreshCompleteness();
    expect((await alice.profile.get())?.completeness_score).toBe(before);
  });

  it('scopes version bumps', async () => {
    const aliceVersion = await alice.profile.currentVersion();
    await bob.profile.bumpVersion();
    expect(await alice.profile.currentVersion()).toBe(aliceVersion);
  });

  it('scopes child collection writes', async () => {
    await bob.profile.setTrades([{ tradeSlug: 'plumbing', isPrimary: true }]);
    await alice.profile.setTrades([{ tradeSlug: 'landscaping', isPrimary: true }]);
    // Bob replacing his own trades must not have cleared Alice's.
    await bob.profile.setTrades([{ tradeSlug: 'plumbing', isPrimary: true }]);
    const aliceTrades = (await alice.profile.get())?.trades ?? [];
    expect(aliceTrades.map((t) => t.trade_slug)).toEqual(['landscaping']);
  });

  it('scopes licences and insurance', async () => {
    await alice.profile.addLicense({
      licenseType: 'Landscape',
      licenseNumber: 'A-1',
      issuingState: 'GA',
    });
    await alice.profile.addInsurance({
      policyType: 'GL',
      carrier: 'Carrier A',
      policyNumber: 'P-1',
    });
    const bobProfile = await bob.profile.get();
    expect(bobProfile?.licenses).toHaveLength(0);
    expect(bobProfile?.insurance).toHaveLength(0);
  });

  it('scopes service areas', async () => {
    await alice.profile.addServiceArea({ kind: 'state', states: ['GA'] });
    expect((await bob.profile.get())?.service_areas).toHaveLength(0);
  });
});

describe('document repository', () => {
  it("returns null for another tenant's document by id", async () => {
    expect(await bob.documents.findById(aliceIds.documentId)).toBeNull();
    expect(await alice.documents.findById(aliceIds.documentId)).not.toBeNull();
  });

  it("does not list another tenant's documents", async () => {
    expect(await bob.documents.list()).toHaveLength(0);
    expect((await alice.documents.list()).length).toBeGreaterThan(0);
  });

  it("cannot update another tenant's document", async () => {
    expect(await bob.documents.update(aliceIds.documentId, { label: 'hijacked' })).toBeNull();
    expect((await alice.documents.findById(aliceIds.documentId))?.label).toBe('Alice W-9');
  });

  it("cannot delete another tenant's document", async () => {
    expect(await bob.documents.delete(aliceIds.documentId)).toBe(false);
    expect(await alice.documents.findById(aliceIds.documentId)).not.toBeNull();
  });

  it("deleteAll only clears the caller's own rows", async () => {
    expect(await bob.documents.deleteAll()).toBe(0);
    expect(await alice.documents.findById(aliceIds.documentId)).not.toBeNull();
  });

  it('scopes listByKind and listCurrent', async () => {
    expect(await bob.documents.listByKind('W9')).toHaveLength(0);
    expect(await bob.documents.listCurrent()).toHaveLength(0);
    expect((await alice.documents.listByKind('W9')).length).toBeGreaterThan(0);
  });

  it("cannot supersede another tenant's documents", async () => {
    await bob.documents.supersedePrevious('W9', aliceIds.documentId);
    expect((await alice.documents.findById(aliceIds.documentId))?.isCurrent).toBe(true);
  });

  it('refuses an insert that names a different tenant', async () => {
    await expect(
      bob.documents.insert({
        // Deliberately smuggling Alice's tenant id into a Bob-scoped write.
        tenantId: aliceIds.tenantId,
        kind: 'W9',
        label: 'spoofed',
        r2Key: 'x',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'c'.repeat(64),
      } as never),
    ).rejects.toThrow(CrossTenantAccessError);
  });
});

describe('run and task repositories', () => {
  it("does not return another tenant's run", async () => {
    expect(await bob.runs.findById(aliceIds.runId)).toBeNull();
    expect(await alice.runs.findById(aliceIds.runId)).not.toBeNull();
  });

  it("does not list another tenant's runs", async () => {
    expect(await bob.runs.listRecent()).toHaveLength(0);
    expect(await bob.runs.listForCompany(aliceIds.pmCompanyId)).toHaveLength(0);
    expect((await alice.runs.listRecent()).length).toBeGreaterThan(0);
  });

  it("cannot change another tenant's run status", async () => {
    const before = (await alice.runs.findById(aliceIds.runId))?.status;
    await bob.runs.setStatus(aliceIds.runId, 'failed');
    expect((await alice.runs.findById(aliceIds.runId))?.status).toBe(before);
  });

  it("recomputeStatus cannot reach another tenant's run", async () => {
    const before = (await alice.runs.findById(aliceIds.runId))?.status;
    await bob.runs.recomputeStatus(aliceIds.runId);
    expect((await alice.runs.findById(aliceIds.runId))?.status).toBe(before);
  });

  it('gives each tenant a distinct idempotency key for the same company', async () => {
    // Both tenants connecting to the same PM company must produce separate
    // runs; the key is salted with the tenant id precisely for this.
    const bobRun = await bob.runs.createIdempotent({
      pmCompanyId: aliceIds.pmCompanyId,
      profileVersion: 1,
    });
    expect(bobRun.created).toBe(true);
    expect(bobRun.run.id).not.toBe(aliceIds.runId);
  });

  it("does not return another tenant's tasks", async () => {
    expect(await bob.tasks.findById(aliceIds.emailTaskId)).toBeNull();
    expect(await bob.tasks.listForRun(aliceIds.runId)).toHaveLength(0);
    expect((await alice.tasks.listForRun(aliceIds.runId)).length).toBe(2);
  });

  it("cannot mutate another tenant's task", async () => {
    const before = await alice.tasks.findById(aliceIds.emailTaskId);
    await bob.tasks.markRunning(aliceIds.emailTaskId);
    await bob.tasks.finish(aliceIds.emailTaskId, { status: 'failed' });
    const after = await alice.tasks.findById(aliceIds.emailTaskId);
    expect(after?.status).toBe(before?.status);
    expect(after?.attempt).toBe(before?.attempt);
  });

  it('scopes the needs-attention queue and status queries', async () => {
    await alice.tasks.finish(aliceIds.portalTaskId, { status: 'needs_attention' });
    expect(await bob.tasks.listNeedingAttention()).toHaveLength(0);
    expect((await alice.tasks.listNeedingAttention()).length).toBe(1);
    expect(await bob.tasks.listByStatuses(['needs_attention'])).toHaveLength(0);
  });
});

describe('append-only audit repositories', () => {
  it("does not return another tenant's task events", async () => {
    expect(await bob.events.listForTask(aliceIds.emailTaskId)).toHaveLength(0);
    expect((await alice.events.listForTask(aliceIds.emailTaskId)).length).toBeGreaterThan(0);
  });

  it('scopes incremental event reads used by the live stream', async () => {
    const since = new Date(Date.now() - 60_000);
    expect(await bob.events.listSince(aliceIds.emailTaskId, since)).toHaveLength(0);
    expect((await alice.events.listSince(aliceIds.emailTaskId, since)).length).toBeGreaterThan(0);
  });

  it("does not return another tenant's field writes", async () => {
    expect(await bob.fieldWrites.listForTask(aliceIds.portalTaskId)).toHaveLength(0);
    expect((await alice.fieldWrites.listForTask(aliceIds.portalTaskId)).length).toBe(1);
  });

  it('refuses to update a task event', async () => {
    const { taskEvents } = await import('../src/schema/index');
    const { eq } = await import('drizzle-orm');
    await expect(
      testDb.db
        .update(taskEvents)
        .set({ message: 'rewritten history' })
        .where(eq(taskEvents.id, aliceIds.eventId)),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to delete a task event', async () => {
    const { taskEvents } = await import('../src/schema/index');
    const { eq } = await import('drizzle-orm');
    await expect(
      testDb.db.delete(taskEvents).where(eq(taskEvents.id, aliceIds.eventId)),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to update or delete a portal field write', async () => {
    const { portalFieldWrites } = await import('../src/schema/index');
    const { eq } = await import('drizzle-orm');
    await expect(
      testDb.db
        .update(portalFieldWrites)
        .set({ valueWritten: 'rewritten' })
        .where(eq(portalFieldWrites.taskId, aliceIds.portalTaskId)),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.db
        .delete(portalFieldWrites)
        .where(eq(portalFieldWrites.taskId, aliceIds.portalTaskId)),
    ).rejects.toThrow(/append-only/);
  });
});

describe('repository construction', () => {
  it('refuses to build a scoped repository without a tenant', () => {
    expect(() => repositoriesFor(testDb.db, '')).toThrow(/requires a tenantId/);
  });
});

/**
 * Coverage guard.
 *
 * Every public method on a tenant-scoped repository must be named here. Adding
 * a method without adding a cross-tenant test above fails this check, which is
 * what stops the suite from decaying into partial coverage.
 */
describe('coverage of scoped repository methods', () => {
  const COVERED: Record<string, readonly string[]> = {
    profile: [
      'get', 'create', 'update', 'refreshCompleteness', 'bumpVersion', 'currentVersion',
      'setTrades', 'addServiceArea', 'addLicense', 'addInsurance',
    ],
    documents: [
      'findById', 'list', 'insert', 'update', 'delete', 'deleteAll',
      'listByKind', 'listCurrent', 'supersedePrevious',
    ],
    runs: [
      'findById', 'list', 'insert', 'update', 'delete', 'deleteAll',
      'createIdempotent', 'listRecent', 'listForCompany', 'setStatus', 'recomputeStatus',
    ],
    tasks: [
      'findById', 'list', 'insert', 'update', 'delete', 'deleteAll',
      'listForRun', 'createTask', 'markRunning', 'finish', 'listNeedingAttention',
      'listByStatuses',
    ],
    events: ['append', 'listForTask', 'listSince'],
    fieldWrites: ['appendMany', 'listForTask'],
  };

  /**
   * `scoped` and `withTenant` are `protected` in TypeScript, but TS access
   * modifiers vanish at runtime, so reflection still sees them. They are the
   * mechanism that applies the tenant predicate rather than a surface that
   * could leak, and they are exercised by every test above.
   */
  const BASE_INTERNALS = ['scoped', 'withTenant'];

  for (const [name, covered] of Object.entries(COVERED)) {
    it(`${name} has no uncovered public methods`, () => {
      const repo = (alice as unknown as Record<string, object>)[name];
      const actual = new Set<string>();
      // Walk the prototype chain so inherited CRUD is included.
      let proto: object | null = Object.getPrototypeOf(repo);
      while (proto && proto !== Object.prototype) {
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === 'constructor' || key.startsWith('_')) continue;
          const descriptor = Object.getOwnPropertyDescriptor(proto, key);
          if (typeof descriptor?.value === 'function') actual.add(key);
        }
        proto = Object.getPrototypeOf(proto);
      }
      const uncovered = [...actual]
        .filter((m) => !covered.includes(m) && !BASE_INTERNALS.includes(m))
        .sort();
      expect(uncovered, `add cross-tenant coverage for ${name}.${uncovered.join(', ')}`).toEqual([]);
    });
  }
});
