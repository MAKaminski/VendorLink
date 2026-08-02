import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositoriesFor, runIdempotencyKey, type TenantRepositories } from '../src/repositories/index';
import { connectionTasks, pmCompanies } from '../src/schema/index';
import { createTestDatabase, seedTenant, type TestDatabase } from '../src/testing/harness';

/**
 * §11's idempotency requirement: fire the same Connect click five times
 * concurrently and get exactly one email and one submission.
 *
 * The guarantee is enforced by Postgres — a unique index plus
 * `ON CONFLICT DO NOTHING` — rather than by a check-then-insert in
 * application code, which would race across processes. These tests run the
 * calls genuinely concurrently so a check-then-insert implementation fails.
 */

let testDb: TestDatabase;
let repos: TenantRepositories;
let companyId: string;
let otherCompanyId: string;
let tenantId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const tenant = await seedTenant(testDb.db, { name: 'Idempotency Co' });
  tenantId = tenant.tenantId;
  repos = repositoriesFor(testDb.db, tenantId);

  const [a] = await testDb.db
    .insert(pmCompanies)
    .values({ name: 'Oakwood', domain: 'oakwood-idem.example' })
    .returning();
  const [b] = await testDb.db
    .insert(pmCompanies)
    .values({ name: 'Southline', domain: 'southline-idem.example' })
    .returning();
  companyId = a!.id;
  otherCompanyId = b!.id;
});

afterAll(async () => {
  await testDb?.close();
});

describe('concurrent Connect clicks', () => {
  it('collapses five simultaneous clicks into exactly one run', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        repos.runs.createIdempotent({ pmCompanyId: companyId, profileVersion: 1 }),
      ),
    );

    const runIds = new Set(results.map((r) => r.run.id));
    expect(runIds.size).toBe(1);

    // Exactly one caller may believe it created the run — that is the one that
    // goes on to queue the tasks.
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('creates exactly one email task and one portal task for that run', async () => {
    const { run, created } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 1,
    });
    expect(created).toBe(false);

    // Only the creating caller queues tasks, so a repeat click adds none.
    const tasks = await repos.tasks.listForRun(run.id);
    expect(tasks).toHaveLength(0);

    await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    await repos.tasks.createTask({ runId: run.id, kind: 'PORTAL' });

    const after = await repos.tasks.listForRun(run.id);
    expect(after.filter((t) => t.kind === 'EMAIL')).toHaveLength(1);
    expect(after.filter((t) => t.kind === 'PORTAL')).toHaveLength(1);
  });

  it('allows a new run once the profile version moves', async () => {
    // Editing the profile is a legitimate reason to re-send.
    const { run: v2, created } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 2,
    });
    expect(created).toBe(true);
    expect(v2.idempotencyKey).toBe(runIdempotencyKey(tenantId, companyId, 2));
  });

  it('keeps different PM companies independent', async () => {
    const { created } = await repos.runs.createIdempotent({
      pmCompanyId: otherCompanyId,
      profileVersion: 1,
    });
    expect(created).toBe(true);
  });

  it('derives a distinct key per tenant for the same company and version', async () => {
    const other = await seedTenant(testDb.db, { name: 'Another Co' });
    expect(runIdempotencyKey(tenantId, companyId, 1)).not.toBe(
      runIdempotencyKey(other.tenantId, companyId, 1),
    );

    const otherRepos = repositoriesFor(testDb.db, other.tenantId);
    const { created } = await otherRepos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 1,
    });
    expect(created).toBe(true);
  });
});

describe('duplicate portal submission', () => {
  it('refuses a second successful submission to the same channel', async () => {
    // §6.5: never submit the same form twice for the same tenant. Enforced by
    // a partial unique index so the database arbitrates, not the worker.
    const { pmChannels } = await import('../src/schema/index');
    const [channel] = await testDb.db
      .insert(pmChannels)
      .values({ pmCompanyId: companyId, kind: 'WEB_FORM', url: 'https://oakwood-idem.example/apply' })
      .returning();

    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 10,
    });

    const first = await repos.tasks.createTask({
      runId: run.id,
      kind: 'PORTAL',
      pmChannelId: channel!.id,
    });
    await repos.tasks.finish(first.id, { status: 'succeeded' });

    const second = await repos.tasks.createTask({
      runId: run.id,
      kind: 'PORTAL',
      pmChannelId: channel!.id,
    });

    await expect(repos.tasks.finish(second.id, { status: 'succeeded' })).rejects.toThrow(
      /duplicate key|unique/i,
    );
  });

  it('still allows a failed submission to be retried', async () => {
    const { pmChannels } = await import('../src/schema/index');
    const [channel] = await testDb.db
      .insert(pmChannels)
      .values({ pmCompanyId: otherCompanyId, kind: 'WEB_FORM', url: 'https://southline-idem.example/apply' })
      .returning();

    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: otherCompanyId,
      profileVersion: 20,
    });

    const first = await repos.tasks.createTask({
      runId: run.id,
      kind: 'PORTAL',
      pmChannelId: channel!.id,
    });
    await repos.tasks.finish(first.id, { status: 'failed', failureClass: 'timeout' });

    // A failure must not permanently poison the channel for this tenant.
    const retry = await repos.tasks.createTask({
      runId: run.id,
      kind: 'PORTAL',
      pmChannelId: channel!.id,
    });
    await expect(repos.tasks.finish(retry.id, { status: 'succeeded' })).resolves.toBeUndefined();
  });
});

describe('run status roll-up', () => {
  it('reports partial when one track succeeds and another fails', async () => {
    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 30,
    });
    const email = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    const portal = await repos.tasks.createTask({ runId: run.id, kind: 'PORTAL' });

    await repos.tasks.finish(email.id, { status: 'succeeded' });
    await repos.tasks.finish(portal.id, { status: 'failed', failureClass: 'captcha_required' });

    expect(await repos.runs.recomputeStatus(run.id)).toBe('partial');
  });

  it('reports needs_attention when a track parked', async () => {
    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 31,
    });
    const email = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    const portal = await repos.tasks.createTask({ runId: run.id, kind: 'PORTAL' });

    await repos.tasks.finish(email.id, { status: 'succeeded' });
    await repos.tasks.finish(portal.id, { status: 'needs_attention' });

    expect(await repos.runs.recomputeStatus(run.id)).toBe('needs_attention');
  });

  it('reports succeeded only when every track finished cleanly', async () => {
    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 32,
    });
    const email = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    await repos.tasks.finish(email.id, { status: 'succeeded' });
    expect(await repos.runs.recomputeStatus(run.id)).toBe('succeeded');
  });

  it('stays running while any track is still queued', async () => {
    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 33,
    });
    const email = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    await repos.tasks.createTask({ runId: run.id, kind: 'PORTAL' });
    await repos.tasks.finish(email.id, { status: 'succeeded' });
    expect(await repos.runs.recomputeStatus(run.id)).toBe('running');
  });

  it('counts a task row exactly once per run', async () => {
    const { eq } = await import('drizzle-orm');
    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 34,
    });
    await Promise.all(
      Array.from({ length: 3 }, () => repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' })),
    );
    // Three deliberate creates make three rows: the collapse happens at the
    // *run* level, which is why only the creating caller queues tasks.
    const rows = await testDb.db
      .select()
      .from(connectionTasks)
      .where(eq(connectionTasks.runId, run.id));
    expect(rows).toHaveLength(3);
  });
});
