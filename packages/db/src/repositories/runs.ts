import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { stableHash, type FailureClass, type TaskKind, type TaskStatus } from '@vendorlink/core';
import {
  connectionRuns,
  connectionTasks,
  portalFieldWrites,
  taskEvents,
  type ConnectionRunRow,
  type ConnectionTaskRow,
  type TaskEventRow,
} from '../schema/index';
import { TenantScopedRepository, TenantTableRepository } from './base';

export function runIdempotencyKey(
  tenantId: string,
  pmCompanyId: string,
  profileVersion: number,
): string {
  return stableHash(tenantId, pmCompanyId, String(profileVersion));
}

export interface CreateRunResult {
  run: ConnectionRunRow;
  /** False when an equivalent run already existed and was returned instead. */
  created: boolean;
}

export class ConnectionRunRepository extends TenantTableRepository<typeof connectionRuns> {
  protected readonly table = connectionRuns;

  /**
   * Create a run, or return the existing one for the same
   * (tenant, PM company, profile version).
   *
   * This is the idempotency guarantee behind the §11 test that fires five
   * concurrent Connect clicks and expects exactly one email. `ON CONFLICT DO
   * NOTHING` against the unique index means the database arbitrates, so it
   * holds across processes — a check-then-insert in application code would
   * not.
   */
  async createIdempotent(input: {
    pmCompanyId: string;
    profileVersion: number;
    initiatedBy?: string;
  }): Promise<CreateRunResult> {
    const idempotencyKey = runIdempotencyKey(
      this.tenantId,
      input.pmCompanyId,
      input.profileVersion,
    );

    const inserted = await this.db
      .insert(connectionRuns)
      .values(
        this.withTenant(connectionRuns, {
          pmCompanyId: input.pmCompanyId,
          initiatedBy: input.initiatedBy ?? null,
          idempotencyKey,
          status: 'queued' as const,
        }),
      )
      .onConflictDoNothing({ target: connectionRuns.idempotencyKey })
      .returning();

    if (inserted[0]) return { run: inserted[0], created: true };

    const [existing] = await this.db
      .select()
      .from(connectionRuns)
      .where(this.scoped(connectionRuns, eq(connectionRuns.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (!existing) {
      // The row exists but belongs to another tenant, which means the hash
      // collided across tenants — impossible for sha256 over the tenant id,
      // so this is a genuine invariant violation rather than a race.
      throw new Error('idempotency key collision across tenants');
    }
    return { run: existing, created: false };
  }

  async listRecent(opts: { limit?: number; status?: string } = {}): Promise<ConnectionRunRow[]> {
    return this.db
      .select()
      .from(connectionRuns)
      .where(
        this.scoped(
          connectionRuns,
          opts.status ? eq(connectionRuns.status, opts.status as never) : undefined,
        ),
      )
      .orderBy(desc(connectionRuns.createdAt))
      .limit(opts.limit ?? 50);
  }

  async listForCompany(pmCompanyId: string): Promise<ConnectionRunRow[]> {
    return this.db
      .select()
      .from(connectionRuns)
      .where(this.scoped(connectionRuns, eq(connectionRuns.pmCompanyId, pmCompanyId)))
      .orderBy(desc(connectionRuns.createdAt));
  }

  async setStatus(runId: string, status: ConnectionRunRow['status']): Promise<void> {
    await this.db
      .update(connectionRuns)
      .set({
        status,
        finishedAt: ['succeeded', 'failed', 'partial'].includes(status ?? '')
          ? new Date()
          : null,
      })
      .where(this.scoped(connectionRuns, eq(connectionRuns.id, runId)));
  }

  /**
   * Roll the run's status up from its tasks, so the two-pill card state and
   * the run state never disagree.
   */
  async recomputeStatus(runId: string): Promise<ConnectionRunRow['status']> {
    const tasks = await this.db
      .select({ status: connectionTasks.status })
      .from(connectionTasks)
      .where(this.scoped(connectionTasks, eq(connectionTasks.runId, runId)));

    const statuses = tasks.map((t) => t.status);
    let next: ConnectionRunRow['status'];

    if (statuses.length === 0) {
      next = 'queued';
    } else if (statuses.some((s) => s === 'running' || s === 'queued')) {
      next = 'running';
    } else if (statuses.some((s) => s === 'needs_attention')) {
      next = 'needs_attention';
    } else if (statuses.every((s) => s === 'succeeded' || s === 'skipped')) {
      next = 'succeeded';
    } else if (statuses.every((s) => s === 'failed')) {
      next = 'failed';
    } else if (statuses.some((s) => s === 'succeeded' || s === 'submitted_unconfirmed')) {
      // Some tracks worked and some did not: "partial" is the honest state,
      // and it is what lets the UI offer a re-run of just the failed track.
      next = 'partial';
    } else {
      next = 'failed';
    }

    await this.setStatus(runId, next);
    return next;
  }
}

export class ConnectionTaskRepository extends TenantTableRepository<typeof connectionTasks> {
  protected readonly table = connectionTasks;

  async listForRun(runId: string): Promise<ConnectionTaskRow[]> {
    return this.db
      .select()
      .from(connectionTasks)
      .where(this.scoped(connectionTasks, eq(connectionTasks.runId, runId)))
      .orderBy(asc(connectionTasks.kind));
  }

  async createTask(input: {
    runId: string;
    kind: TaskKind;
    pmChannelId?: string | null;
    resolvedContactId?: string | null;
    maxAttempts?: number;
  }): Promise<ConnectionTaskRow> {
    const [row] = await this.db
      .insert(connectionTasks)
      .values(
        this.withTenant(connectionTasks, {
          runId: input.runId,
          kind: input.kind,
          status: 'queued' as const,
          pmChannelId: input.pmChannelId ?? null,
          resolvedContactId: input.resolvedContactId ?? null,
          maxAttempts: input.maxAttempts ?? 3,
        }),
      )
      .returning();
    return row as ConnectionTaskRow;
  }

  async markRunning(taskId: string): Promise<void> {
    await this.db
      .update(connectionTasks)
      .set({
        status: 'running',
        startedAt: new Date(),
        attempt: sql`${connectionTasks.attempt} + 1`,
      })
      .where(this.scoped(connectionTasks, eq(connectionTasks.id, taskId)));
  }

  async finish(
    taskId: string,
    outcome: {
      status: TaskStatus;
      failureReason?: string | null;
      failureClass?: FailureClass | null;
      artifactBundleKey?: string | null;
      confirmationNumber?: string | null;
      runConfidence?: number | null;
      nextRetryAt?: Date | null;
    },
  ): Promise<void> {
    await this.db
      .update(connectionTasks)
      .set({
        status: outcome.status,
        finishedAt: new Date(),
        failureReason: outcome.failureReason ?? null,
        failureClass: outcome.failureClass ?? null,
        artifactBundleKey: outcome.artifactBundleKey ?? null,
        confirmationNumber: outcome.confirmationNumber ?? null,
        runConfidence: outcome.runConfidence ?? null,
        nextRetryAt: outcome.nextRetryAt ?? null,
      })
      .where(this.scoped(connectionTasks, eq(connectionTasks.id, taskId)));
  }

  /** The Needs-Attention queue. */
  async listNeedingAttention(): Promise<ConnectionTaskRow[]> {
    return this.db
      .select()
      .from(connectionTasks)
      .where(this.scoped(connectionTasks, eq(connectionTasks.status, 'needs_attention')))
      .orderBy(desc(connectionTasks.finishedAt));
  }

  async listByStatuses(statuses: readonly TaskStatus[]): Promise<ConnectionTaskRow[]> {
    if (statuses.length === 0) return [];
    return this.db
      .select()
      .from(connectionTasks)
      .where(this.scoped(connectionTasks, inArray(connectionTasks.status, [...statuses])));
  }
}

/**
 * Append-only writers.
 *
 * These deliberately expose no update or delete: the database refuses them,
 * and the repository should not offer a method that can only fail.
 */
export class TaskEventRepository extends TenantScopedRepository {
  async append(event: {
    taskId: string;
    level?: TaskEventRow['level'];
    eventType: string;
    message: string;
    data?: Record<string, unknown>;
  }): Promise<TaskEventRow> {
    const [row] = await this.db
      .insert(taskEvents)
      .values(
        this.withTenant(taskEvents, {
          taskId: event.taskId,
          level: event.level ?? 'info',
          eventType: event.eventType,
          message: event.message,
          data: event.data ?? null,
        }),
      )
      .returning();
    return row as TaskEventRow;
  }

  async listForTask(taskId: string): Promise<TaskEventRow[]> {
    return this.db
      .select()
      .from(taskEvents)
      .where(this.scoped(taskEvents, eq(taskEvents.taskId, taskId)))
      .orderBy(asc(taskEvents.ts));
  }

  /**
   * Incremental fetch for the SSE stream.
   *
   * Uses `gt` rather than a raw `sql` template: the postgres.js driver binds
   * parameters positionally and has no type mapper for a bare `Date`, so an
   * interpolated timestamp fails at bind time.
   */
  async listSince(taskId: string, since: Date): Promise<TaskEventRow[]> {
    return this.db
      .select()
      .from(taskEvents)
      .where(this.scoped(taskEvents, and(eq(taskEvents.taskId, taskId), gt(taskEvents.ts, since))))
      .orderBy(asc(taskEvents.ts));
  }
}

export class PortalFieldWriteRepository extends TenantScopedRepository {
  async appendMany(
    taskId: string,
    writes: ReadonlyArray<{
      selector: string;
      label?: string | null;
      valueWritten: string;
      sourceField?: string | null;
      confidence: number;
      wasLlmMapped: boolean;
      isRedacted?: boolean;
    }>,
  ): Promise<void> {
    if (writes.length === 0) return;
    await this.db.insert(portalFieldWrites).values(
      writes.map((w) =>
        this.withTenant(portalFieldWrites, {
          taskId,
          selector: w.selector,
          label: w.label ?? null,
          valueWritten: w.valueWritten,
          sourceField: w.sourceField ?? null,
          confidence: w.confidence,
          wasLlmMapped: w.wasLlmMapped,
          isRedacted: w.isRedacted ?? false,
        }),
      ),
    );
  }

  async listForTask(taskId: string) {
    return this.db
      .select()
      .from(portalFieldWrites)
      .where(this.scoped(portalFieldWrites, eq(portalFieldWrites.taskId, taskId)))
      .orderBy(asc(portalFieldWrites.createdAt));
  }
}
