import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../client';

/**
 * Tenant scoping.
 *
 * §10 requires that no query reach another tenant's rows. Enforcing that with
 * a convention ("remember the where clause") fails the first time someone is
 * in a hurry, so instead every tenant-owned table is reached through a
 * repository built on this base, and the base is what writes the predicate.
 *
 * The important consequence: a route handler cannot express a cross-tenant
 * query, because it never holds a table reference — only a repository already
 * bound to one tenant.
 */

/** A table that carries tenant ownership and a surrogate key. */
export type TenantOwnedTable = PgTable & {
  id: PgColumn;
  tenantId: PgColumn;
};

export interface RepositoryContext {
  db: Database;
  tenantId: string;
}

export class CrossTenantAccessError extends Error {
  constructor(table: string) {
    super(`refusing to write a row for a different tenant into ${table}`);
    this.name = 'CrossTenantAccessError';
  }
}

export abstract class TenantScopedRepository {
  constructor(protected readonly ctx: RepositoryContext) {
    if (!ctx.tenantId) {
      throw new Error('a tenant-scoped repository requires a tenantId');
    }
  }

  protected get db(): Database {
    return this.ctx.db;
  }

  get tenantId(): string {
    return this.ctx.tenantId;
  }

  /** The tenant predicate, ANDed with anything the caller supplies. */
  protected scoped(table: TenantOwnedTable, ...conditions: Array<SQL | undefined>): SQL {
    const clauses = [eq(table.tenantId, this.ctx.tenantId), ...conditions.filter(Boolean)];
    // `and` of a single clause is that clause; the cast is safe because the
    // tenant predicate is always present.
    return and(...(clauses as SQL[])) as SQL;
  }

  /**
   * Stamp the tenant onto a row being written, refusing any attempt to pass a
   * different one. Callers never supply `tenant_id`; if one appears and
   * disagrees, that is a bug worth failing loudly on.
   */
  protected withTenant<T extends Record<string, unknown>>(
    table: TenantOwnedTable,
    values: T,
  ): T & { tenantId: string } {
    const supplied = values['tenantId'];
    if (typeof supplied === 'string' && supplied !== this.ctx.tenantId) {
      throw new CrossTenantAccessError(String(table));
    }
    return { ...values, tenantId: this.ctx.tenantId };
  }
}

/**
 * Generic CRUD over one tenant-owned table.
 *
 * Concrete repositories extend this and add domain queries; the inherited
 * methods are already scoped, so the surface that could leak is limited to
 * what a subclass writes by hand — and those go through `scoped()` too.
 */
export abstract class TenantTableRepository<
  TTable extends TenantOwnedTable,
> extends TenantScopedRepository {
  protected abstract readonly table: TTable;

  async findById(id: string): Promise<TTable['$inferSelect'] | null> {
    const rows = await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.table, eq(this.table.id, id)))
      .limit(1);
    return (rows[0] as TTable['$inferSelect'] | undefined) ?? null;
  }

  async list(opts: { limit?: number; offset?: number } = {}): Promise<TTable['$inferSelect'][]> {
    return (await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(this.table))
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0)) as TTable['$inferSelect'][];
  }

  async insert(values: Omit<TTable['$inferInsert'], 'tenantId'>): Promise<TTable['$inferSelect']> {
    const payload = this.withTenant(this.table, values as Record<string, unknown>);
    // Drizzle derives `.values()` as a mapped type over a *concrete* table, so
    // it cannot be computed for a generic `TTable`. The cast is confined to
    // this one line; the public signature above is still checked against
    // `TTable['$inferInsert']`, and `withTenant` only adds `tenantId`.
    const rows = await this.db
      .insert(this.table)
      .values(payload as never)
      .returning();
    return rows[0] as TTable['$inferSelect'];
  }

  async update(
    id: string,
    values: Partial<Omit<TTable['$inferInsert'], 'tenantId' | 'id'>>,
  ): Promise<TTable['$inferSelect'] | null> {
    const rows = await this.db
      .update(this.table)
      .set(values as Record<string, unknown>)
      .where(this.scoped(this.table, eq(this.table.id, id)))
      .returning();
    return (rows[0] as TTable['$inferSelect'] | undefined) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(this.table)
      .where(this.scoped(this.table, eq(this.table.id, id)))
      .returning();
    return rows.length > 0;
  }

  async deleteAll(): Promise<number> {
    const rows = await this.db.delete(this.table).where(this.scoped(this.table)).returning();
    return rows.length;
  }
}
