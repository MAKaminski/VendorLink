import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  emailSuppressions,
  globalContactSignals,
  pmChannels,
  pmCompanies,
  pmContacts,
  pmRequirements,
  type NewPmContactRow,
  type PmChannelRow,
  type PmCompanyRow,
  type PmContactRow,
  type PmRequirementsRow,
} from '../schema/index';
import type { Database } from '../client';

/**
 * The PM directory.
 *
 * Not tenant-scoped, and that is the whole point: §5.3's cross-tenant learning
 * means one tenant's bounce suppresses an address for everyone and one
 * tenant's confirmed reply boosts it for everyone. This repository therefore
 * deliberately does *not* extend `TenantScopedRepository` — it takes a
 * `sourceTenantId` only for attribution on the signals it records.
 */
export class DirectoryRepository {
  constructor(private readonly db: Database) {}

  // ---- companies ---------------------------------------------------------

  async search(params: {
    q?: string;
    state?: string;
    platform?: string;
    minUnits?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: PmCompanyRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (params.q) {
      const pattern = `%${params.q}%`;
      const match = or(
        ilike(pmCompanies.name, pattern),
        ilike(pmCompanies.legalName, pattern),
        ilike(pmCompanies.domain, pattern),
      );
      if (match) conditions.push(match);
    }
    if (params.state) conditions.push(eq(pmCompanies.hqState, params.state as never));
    if (params.minUnits !== undefined) {
      conditions.push(sql`${pmCompanies.portfolioUnits} >= ${params.minUnits}`);
    }
    if (params.platform) {
      // Platform lives on the channel, so filter by existence of a matching one.
      conditions.push(
        sql`exists (
          select 1 from ${pmChannels}
          where ${pmChannels.pmCompanyId} = ${pmCompanies.id}
            and ${pmChannels.platformSlug} = ${params.platform}
        )`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(pmCompanies)
        .where(where)
        .orderBy(desc(pmCompanies.portfolioUnits), asc(pmCompanies.name))
        .limit(params.limit ?? 25)
        .offset(params.offset ?? 0),
      this.db.select({ count: sql<number>`count(*)::int` }).from(pmCompanies).where(where),
    ]);

    return { rows, total: countRow?.count ?? 0 };
  }

  async findById(id: string): Promise<PmCompanyRow | null> {
    const [row] = await this.db.select().from(pmCompanies).where(eq(pmCompanies.id, id)).limit(1);
    return row ?? null;
  }

  async findByDomain(domain: string): Promise<PmCompanyRow | null> {
    const [row] = await this.db
      .select()
      .from(pmCompanies)
      .where(eq(pmCompanies.domain, domain.toLowerCase()))
      .limit(1);
    return row ?? null;
  }

  /** Companies the nightly enrichment cron should warm. */
  async listStale(olderThanDays: number, limit = 50): Promise<PmCompanyRow[]> {
    return this.db
      .select()
      .from(pmCompanies)
      .where(
        or(
          sql`${pmCompanies.lastCrawledAt} is null`,
          sql`${pmCompanies.lastCrawledAt} < now() - make_interval(days => ${olderThanDays})`,
        ),
      )
      .orderBy(asc(pmCompanies.lastCrawledAt))
      .limit(limit);
  }

  async markCrawled(pmCompanyId: string, status: string): Promise<void> {
    await this.db
      .update(pmCompanies)
      .set({ crawlStatus: status, lastCrawledAt: new Date() })
      .where(eq(pmCompanies.id, pmCompanyId));
  }

  // ---- contacts ----------------------------------------------------------

  async listContacts(pmCompanyId: string): Promise<PmContactRow[]> {
    return this.db
      .select()
      .from(pmContacts)
      .where(eq(pmContacts.pmCompanyId, pmCompanyId))
      .orderBy(asc(pmContacts.rank));
  }

  /**
   * Replace the ranked contact set for a company.
   *
   * Upserted rather than deleted-and-reinserted so the accumulated bounce and
   * verification history on an address survives a re-resolution.
   */
  async upsertContacts(pmCompanyId: string, contacts: readonly NewPmContactRow[]): Promise<void> {
    if (contacts.length === 0) return;
    await this.db
      .insert(pmContacts)
      .values(contacts.map((c) => ({ ...c, pmCompanyId })))
      .onConflictDoUpdate({
        target: [pmContacts.pmCompanyId, pmContacts.email],
        set: {
          kind: sql`excluded.kind`,
          score: sql`excluded.score`,
          confidence: sql`excluded.confidence`,
          scoreBreakdown: sql`excluded.score_breakdown`,
          rank: sql`excluded.rank`,
          sourceUrl: sql`excluded.source_url`,
          discoveryMethod: sql`excluded.discovery_method`,
          mxValid: sql`excluded.mx_valid`,
          isRoleAccount: sql`excluded.is_role_account`,
          lastVerifiedAt: sql`excluded.last_verified_at`,
        },
      });
  }

  /** Best deliverable contact, honouring the global suppression list. */
  async bestContact(pmCompanyId: string): Promise<PmContactRow | null> {
    const [row] = await this.db
      .select()
      .from(pmContacts)
      .where(
        and(
          eq(pmContacts.pmCompanyId, pmCompanyId),
          eq(pmContacts.hardBounced, false),
          sql`not exists (
            select 1 from ${emailSuppressions}
            where ${emailSuppressions.email} = ${pmContacts.email}
          )`,
        ),
      )
      .orderBy(asc(pmContacts.rank))
      .limit(1);
    return row ?? null;
  }

  // ---- channels & requirements ------------------------------------------

  async listChannels(pmCompanyId: string): Promise<PmChannelRow[]> {
    return this.db
      .select()
      .from(pmChannels)
      .where(and(eq(pmChannels.pmCompanyId, pmCompanyId), eq(pmChannels.isActive, true)));
  }

  async upsertChannels(
    pmCompanyId: string,
    channels: ReadonlyArray<Omit<typeof pmChannels.$inferInsert, 'pmCompanyId'>>,
  ): Promise<void> {
    if (channels.length === 0) return;
    await this.db
      .insert(pmChannels)
      .values(channels.map((c) => ({ ...c, pmCompanyId })))
      .onConflictDoUpdate({
        target: [pmChannels.pmCompanyId, pmChannels.url],
        set: {
          kind: sql`excluded.kind`,
          platformSlug: sql`excluded.platform_slug`,
          requiresAccount: sql`excluded.requires_account`,
          requiresPayment: sql`excluded.requires_payment`,
          feeCents: sql`excluded.fee_cents`,
          captchaKind: sql`excluded.captcha_kind`,
          authKind: sql`excluded.auth_kind`,
          lastVerifiedAt: sql`excluded.last_verified_at`,
        },
      });
  }

  async getRequirements(pmCompanyId: string): Promise<PmRequirementsRow | null> {
    const [row] = await this.db
      .select()
      .from(pmRequirements)
      .where(eq(pmRequirements.pmCompanyId, pmCompanyId))
      .limit(1);
    return row ?? null;
  }

  async upsertRequirements(
    pmCompanyId: string,
    values: Omit<typeof pmRequirements.$inferInsert, 'pmCompanyId'>,
  ): Promise<void> {
    await this.db
      .insert(pmRequirements)
      .values({ ...values, pmCompanyId })
      .onConflictDoUpdate({
        target: pmRequirements.pmCompanyId,
        set: { ...values, extractedAt: new Date() },
      });
  }

  // ---- cross-tenant signals ---------------------------------------------

  /**
   * Record a terminal email outcome and apply its global consequence.
   *
   * This is the write that makes the directory compound: every tenant's
   * activity changes what every other tenant's resolver sees.
   */
  async recordSignal(input: {
    email: string;
    pmCompanyId?: string | null;
    signal: 'hard_bounce' | 'complaint' | 'confirmed' | 'wrong_department' | 'unsubscribe';
    sourceTenantId?: string | null;
    detail?: string;
  }): Promise<void> {
    const email = input.email.toLowerCase();
    await this.db.insert(globalContactSignals).values({
      email,
      pmCompanyId: input.pmCompanyId ?? null,
      signal: input.signal,
      sourceTenantId: input.sourceTenantId ?? null,
      detail: input.detail ?? null,
    });

    if (input.signal === 'hard_bounce') {
      await this.db
        .update(pmContacts)
        .set({ hardBounced: true, bounceCount: sql`${pmContacts.bounceCount} + 1` })
        .where(eq(pmContacts.email, email));
      await this.suppress(email, 'hard_bounce', input.detail);
    }
    if (input.signal === 'complaint') {
      await this.suppress(email, 'complaint', input.detail);
    }
    if (input.signal === 'unsubscribe') {
      await this.suppress(email, 'unsubscribe', input.detail);
    }
  }

  async suppress(
    email: string,
    reason: 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual',
    detail?: string,
  ): Promise<void> {
    await this.db
      .insert(emailSuppressions)
      .values({ email: email.toLowerCase(), reason, detail: detail ?? null })
      .onConflictDoNothing({ target: emailSuppressions.email });
  }

  async isSuppressed(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, email.toLowerCase()))
      .limit(1);
    return row !== undefined;
  }

  /** Signals for a set of addresses, folded into scoring by the resolver. */
  async signalsFor(emails: readonly string[]): Promise<Map<string, string[]>> {
    if (emails.length === 0) return new Map();
    const rows = await this.db
      .select({ email: globalContactSignals.email, signal: globalContactSignals.signal })
      .from(globalContactSignals)
      .where(inArray(globalContactSignals.email, emails.map((e) => e.toLowerCase())));

    const byEmail = new Map<string, string[]>();
    for (const row of rows) {
      const list = byEmail.get(row.email) ?? [];
      list.push(row.signal);
      byEmail.set(row.email, list);
    }
    return byEmail;
  }

  async suppressedAmong(emails: readonly string[]): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const rows = await this.db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, emails.map((e) => e.toLowerCase())));
    return new Set(rows.map((r) => r.email));
  }
}
