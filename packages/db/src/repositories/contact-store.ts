import { eq } from 'drizzle-orm';
import type { ContactStore, RankedContact } from '@vendorlink/resolver';
import type { Database } from '../client';
import { pmCompanies, pmContacts } from '../schema/index';
import { DirectoryRepository } from './directory';

const DISCOVERY_METHODS: readonly RankedContact['discoveryMethod'][] = [
  'cache', 'mailto', 'plain_text', 'deobfuscated', 'json_ld', 'llm_interpreted', 'manual',
];

/**
 * Narrow a stored text value to the union.
 *
 * The column is text so the value set can grow without a migration; anything
 * unrecognized reads back as `cache`, which is accurate — it came from the
 * cache — rather than asserting a shape the data may not have.
 */
function asDiscoveryMethod(value: string | null): RankedContact['discoveryMethod'] {
  return DISCOVERY_METHODS.find((m) => m === value) ?? 'cache';
}

/**
 * Database-backed `ContactStore` for Engine #1.
 *
 * The resolver package stays pure: it declares the interface it needs, and
 * this adapter is the only thing that knows about Postgres. That is what lets
 * the whole pipeline be exercised in tests with an in-memory store while
 * running against the real directory in production.
 *
 * The dependency points adapter-to-interface: `@vendorlink/db` imports the
 * resolver's types, and the resolver imports nothing from here.
 */
export class DbContactStore implements ContactStore {
  private readonly directory: DirectoryRepository;

  constructor(private readonly db: Database) {
    this.directory = new DirectoryRepository(db);
  }

  async getCached(
    pmCompanyId: string,
  ): Promise<{ contacts: RankedContact[]; lastVerifiedAt: Date | null } | null> {
    const rows = await this.directory.listContacts(pmCompanyId);
    if (rows.length === 0) return null;

    const lastVerifiedAt = rows.reduce<Date | null>((latest, row) => {
      if (!row.lastVerifiedAt) return latest;
      return !latest || row.lastVerifiedAt > latest ? row.lastVerifiedAt : latest;
    }, null);

    return {
      lastVerifiedAt,
      contacts: rows
        // A hard-bounced address must never come back out of the cache.
        .filter((row) => !row.hardBounced)
        .map((row) => ({
          email: row.email,
          kind: row.kind ?? 'unknown',
          personName: row.personName,
          title: row.title,
          score: row.score,
          confidence: row.confidence,
          rank: row.rank,
          sourceUrl: row.sourceUrl,
          discoveryMethod: asDiscoveryMethod(row.discoveryMethod),
          mxValid: row.mxValid,
          isRoleAccount: row.isRoleAccount,
          breakdown: row.scoreBreakdown ?? [],
          evidenceQuote: null,
        })),
    };
  }

  async getSignals(emails: readonly string[]): Promise<Map<string, string[]>> {
    return this.directory.signalsFor(emails);
  }

  async getSuppressed(emails: readonly string[]): Promise<Set<string>> {
    return this.directory.suppressedAmong(emails);
  }

  async persist(
    pmCompanyId: string,
    result: {
      contacts: readonly RankedContact[];
      channels: readonly {
        kind: string;
        url: string | null;
        platformSlug: string | null;
        requiresAccount: boolean;
        requiresPayment: boolean;
        feeCents: number | null;
        captchaKind: string;
        notes: string | null;
      }[];
      trace: unknown;
    },
  ): Promise<void> {
    const now = new Date();

    if (result.contacts.length > 0) {
      await this.directory.upsertContacts(
        pmCompanyId,
        result.contacts.map((c) => ({
          pmCompanyId,
          email: c.email,
          kind: c.kind as never,
          personName: c.personName,
          title: c.title,
          sourceUrl: c.sourceUrl,
          discoveryMethod: c.discoveryMethod,
          confidence: c.confidence,
          score: c.score,
          scoreBreakdown: [...c.breakdown],
          mxValid: c.mxValid,
          isRoleAccount: c.isRoleAccount,
          rank: c.rank,
          lastVerifiedAt: now,
        })),
      );
    }

    if (result.channels.length > 0) {
      await this.directory.upsertChannels(
        pmCompanyId,
        result.channels.map((c) => ({
          kind: c.kind as never,
          url: c.url,
          platformSlug: c.platformSlug as never,
          requiresAccount: c.requiresAccount,
          requiresPayment: c.requiresPayment,
          feeCents: c.feeCents,
          captchaKind: c.captchaKind as never,
          lastVerifiedAt: now,
          notes: c.notes,
        })),
      );
    }

    await this.db
      .update(pmCompanies)
      .set({ crawlStatus: 'resolved', lastCrawledAt: now })
      .where(eq(pmCompanies.id, pmCompanyId));
  }

  /** Rank-1 contact for a company, ignoring bounced addresses. */
  async best(pmCompanyId: string) {
    const [row] = await this.db
      .select()
      .from(pmContacts)
      .where(eq(pmContacts.pmCompanyId, pmCompanyId))
      .orderBy(pmContacts.rank)
      .limit(1);
    return row ?? null;
  }
}
