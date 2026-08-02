import type { DnsResolver, HttpFetcher, LlmClient } from '@vendorlink/core';
import { detectChannels } from './channels';
import { crawl, DEFAULT_FETCH_BUDGET } from './discovery';
import { harvestPage, type HarvestedEmail, type HarvestedPage } from './harvest';
import { interpretPage } from './interpret';
import { apexDomain, scoreContact, SEND_THRESHOLD, LOW_CONFIDENCE_THRESHOLD } from './scoring';
import type {
  ContactStore,
  RankedContact,
  ResolutionOutcome,
  ResolutionTrace,
  ResolveInput,
  ResolveOutput,
  TraceCandidate,
  TraceFetch,
} from './types';

/**
 * Engine #1 — `resolveOnboardingContacts`.
 *
 * Stages S0–S7 in order, short-circuiting once a high-confidence contact is in
 * hand. Everything it touches — HTTP, DNS, the LLM, the cache — is injected,
 * so the whole pipeline is exercised in tests without a network.
 */

export interface ResolverDeps {
  readonly fetcher: HttpFetcher;
  readonly dns: DnsResolver;
  readonly llm: LlmClient;
  readonly store?: ContactStore;
  /** Overridable for tests. */
  readonly now?: () => Date;
}

export interface ResolveOptions {
  readonly fetchBudget?: number;
  readonly respectRobots?: boolean;
  /** Skip S4 entirely; used by the deterministic-only golden-set pass. */
  readonly useLlm?: boolean;
  readonly companyName?: string;
  /** §5.2: cached contacts are reused for 45 days. */
  readonly cacheMaxAgeDays?: number;
}

const CACHE_MAX_AGE_DAYS = 45;

/** A contact this strong makes further crawling pointless. */
const SHORT_CIRCUIT_SCORE = 90;

export async function resolveOnboardingContacts(
  input: ResolveInput,
  deps: ResolverDeps,
  options: ResolveOptions = {},
): Promise<ResolveOutput> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const stagesRun: string[] = [];
  const notes: string[] = [];
  let llmCalls = 0;
  let shortCircuitedAt: string | null = null;

  const budget = options.fetchBudget ?? DEFAULT_FETCH_BUDGET;
  const maxAgeDays = options.cacheMaxAgeDays ?? CACHE_MAX_AGE_DAYS;

  // --- S0: cache ----------------------------------------------------------
  stagesRun.push('S0_cache');
  if (input.cache !== 'bypass' && deps.store) {
    const cached = await deps.store.getCached(input.pmCompanyId);
    if (cached && cached.lastVerifiedAt) {
      const ageDays = (now().getTime() - cached.lastVerifiedAt.getTime()) / 86_400_000;
      const usable = cached.contacts.filter((c) => c.score > 0);
      if (ageDays < maxAgeDays && usable.length > 0) {
        shortCircuitedAt = 'S0_cache';
        notes.push(`served from cache, ${Math.round(ageDays)} days old`);
        return {
          contacts: usable,
          channels: [],
          requirements: null,
          trace: {
            pmCompanyId: input.pmCompanyId,
            website: input.website,
            startedAt,
            finishedAt: now().toISOString(),
            stagesRun,
            fetches: [],
            candidates: usable.map((c) => ({
              email: c.email,
              foundOn: c.sourceUrl ?? 'cache',
              method: 'cache' as const,
              score: c.score,
              breakdown: c.breakdown,
            })),
            fetchBudgetUsed: 0,
            fetchBudgetLimit: budget,
            llmCalls: 0,
            shortCircuitedAt,
            notes,
          },
        };
      }
    }
  }

  // --- S1 + S2: discovery -------------------------------------------------
  stagesRun.push('S1_known_paths', 'S2_crawl');
  const companyDomain = safeHostname(input.website);

  const crawlResult = await crawl({
    fetcher: deps.fetcher,
    website: input.website,
    budget,
    ...(options.respectRobots !== undefined ? { respectRobots: options.respectRobots } : {}),
    // Stop as soon as a page yields an obvious tier-1 inbox: most sites with a
    // real vendor page are resolved in two or three fetches.
    shouldStop: (page) =>
      page.emails.some(
        (e) =>
          scoreContact({
            email: e.email,
            sourceUrl: page.url,
            pageH1: page.h1,
            footerOnly: e.footerOnly,
            companyDomain,
            mxValid: null,
            ...(input.trade ? { trade: input.trade } : {}),
          }).score >= SHORT_CIRCUIT_SCORE,
      ),
  });

  const fetches: TraceFetch[] = [...crawlResult.fetches];
  const pages = crawlResult.pages;
  if (crawlResult.robotsBlocked > 0) {
    notes.push(`${crawlResult.robotsBlocked} path(s) skipped because robots.txt disallowed them`);
  }
  if (crawlResult.budgetUsed >= budget) {
    notes.push(`fetch budget of ${budget} exhausted`);
  }

  // --- S3: harvest --------------------------------------------------------
  stagesRun.push('S3_harvest');
  const sightings = collectSightings(pages);
  if (sightings.size === 0) notes.push('no email addresses found on any fetched page');

  // --- S4: interpret ------------------------------------------------------
  const interpreted = new Map<string, { kind: string; quote: string }>();
  const traceRejections: TraceCandidate[] = [];

  if (options.useLlm !== false && sightings.size > 0) {
    stagesRun.push('S4_interpret');
    // Only worth asking when the deterministic rubric is undecided: if a
    // tier-1 inbox is already in hand, an LLM call adds latency and cost for
    // an answer we have.
    const bestSoFar = Math.max(
      ...[...sightings.values()].map(
        (s) =>
          scoreContact({
            email: s.email.email,
            sourceUrl: s.page.url,
            pageH1: s.page.h1,
            footerOnly: s.email.footerOnly,
            companyDomain,
            mxValid: null,
            ...(input.trade ? { trade: input.trade } : {}),
            ...(s.email.title ? { title: s.email.title } : {}),
          }).score,
      ),
    );

    if (bestSoFar < SHORT_CIRCUIT_SCORE) {
      const page = pickMostPromisingPage(pages);
      if (page) {
        const candidates = page.emails.map((e) => e.email);
        try {
          const result = await interpretPage({
            llm: deps.llm,
            page,
            candidates,
            ...(options.companyName ? { companyName: options.companyName } : {}),
          });
          if (result.called) llmCalls++;
          for (const selection of result.selections) {
            interpreted.set(selection.email, {
              kind: selection.kind,
              quote: selection.evidenceQuote,
            });
          }
          for (const rejection of result.rejected) {
            notes.push(`S4 rejected ${rejection.email}: ${rejection.reason}`);
            traceRejections.push({
              email: rejection.email,
              foundOn: page.url,
              method: 'llm_interpreted',
              score: 0,
              breakdown: [],
              rejected: rejection.reason,
            });
          }
        } catch (err) {
          // A model failure must not fail the resolution: the deterministic
          // rubric already has an answer, it is just less certain.
          notes.push(
            `S4 interpretation unavailable: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        }
      }
    } else {
      notes.push('S4 skipped — a high-confidence contact was already found deterministically');
    }
  }

  // --- S5: verify ---------------------------------------------------------
  stagesRun.push('S5_verify');
  const emails = [...sightings.keys()];
  const domains = [...new Set(emails.map((e) => e.split('@')[1] ?? ''))].filter(Boolean);
  const mxByDomain = new Map<string, boolean>();
  await Promise.all(
    domains.map(async (domain) => {
      const records = await deps.dns.resolveMx(domain);
      mxByDomain.set(domain, records.length > 0);
    }),
  );

  const signals = deps.store ? await deps.store.getSignals(emails) : new Map<string, string[]>();
  const suppressed = deps.store ? await deps.store.getSuppressed(emails) : new Set<string>();

  // --- S6: score and rank -------------------------------------------------
  stagesRun.push('S6_score');
  const traceCandidates: TraceCandidate[] = [...traceRejections];
  const scored: RankedContact[] = [];
  /** Unclamped scores, kept only to break ties between saturated candidates. */
  const rawScores = new Map<string, number>();

  for (const [email, sighting] of sightings) {
    if (suppressed.has(email)) {
      traceCandidates.push({
        email,
        foundOn: sighting.page.url,
        method: sighting.email.method,
        score: 0,
        breakdown: [],
        rejected: 'globally suppressed (bounced or complained for another tenant)',
      });
      continue;
    }

    const llmView = interpreted.get(email);
    const result = scoreContact({
      email,
      sourceUrl: sighting.page.url,
      pageH1: sighting.page.h1,
      footerOnly: sighting.email.footerOnly,
      companyDomain,
      mxValid: mxByDomain.get(email.split('@')[1] ?? '') ?? null,
      signals: signals.get(email) ?? [],
      ...(input.trade ? { trade: input.trade } : {}),
      ...(input.market ? { market: input.market } : {}),
      ...(sighting.email.title ? { title: sighting.email.title } : {}),
    });

    if (result.excluded) {
      traceCandidates.push({
        email,
        foundOn: sighting.page.url,
        method: sighting.email.method,
        score: 0,
        breakdown: result.breakdown,
        rejected: result.exclusionReason ?? 'excluded',
      });
      continue;
    }

    traceCandidates.push({
      email,
      foundOn: sighting.page.url,
      method: sighting.email.method,
      score: result.score,
      breakdown: result.breakdown,
    });
    rawScores.set(email, result.rawScore);

    scored.push({
      email,
      kind: (llmView?.kind as RankedContact['kind']) ?? result.kind,
      personName: sighting.email.personName,
      title: sighting.email.title,
      score: result.score,
      confidence: result.score / 100,
      rank: 0,
      sourceUrl: sighting.page.url,
      discoveryMethod: llmView ? 'llm_interpreted' : sighting.email.method,
      mxValid: mxByDomain.get(email.split('@')[1] ?? '') ?? null,
      isRoleAccount: result.isRoleAccount,
      breakdown: result.breakdown,
      evidenceQuote: llmView?.quote ?? null,
    });
  }

  // Rank by clamped score, then by the unclamped score so a tier-1 inbox still
  // outranks a tier-3 one when both saturate at 100, then by provenance
  // strength so a mailto: link beats a bare text sighting.
  const methodStrength: Record<string, number> = {
    mailto: 5, json_ld: 4, llm_interpreted: 3, deobfuscated: 2, plain_text: 1, cache: 0, manual: 6,
  };
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (rawScores.get(b.email) ?? 0) - (rawScores.get(a.email) ?? 0) ||
      (methodStrength[b.discoveryMethod] ?? 0) - (methodStrength[a.discoveryMethod] ?? 0) ||
      a.email.localeCompare(b.email),
  );
  const contacts = scored.map((c, index) => ({ ...c, rank: index + 1 }));

  // --- channels & requirements -------------------------------------------
  const channels = detectChannels(pages);

  // --- S7: persist --------------------------------------------------------
  stagesRun.push('S7_persist');
  const trace: ResolutionTrace = {
    pmCompanyId: input.pmCompanyId,
    website: input.website,
    startedAt,
    finishedAt: now().toISOString(),
    stagesRun,
    fetches,
    candidates: traceCandidates.sort((a, b) => b.score - a.score),
    fetchBudgetUsed: crawlResult.budgetUsed,
    fetchBudgetLimit: budget,
    llmCalls,
    shortCircuitedAt,
    notes,
  };

  const output: ResolveOutput = { contacts, channels, requirements: null, trace };
  if (deps.store) await deps.store.persist(input.pmCompanyId, output);
  return output;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

interface Sighting {
  readonly email: HarvestedEmail;
  readonly page: HarvestedPage;
}

/**
 * One entry per address, attributed to the page that makes the strongest case
 * for it. An address on `/vendors` and again in the homepage footer should be
 * scored as a vendor-page sighting.
 */
function collectSightings(pages: readonly HarvestedPage[]): Map<string, Sighting> {
  const sightings = new Map<string, Sighting>();
  const isVendorPage = (page: HarvestedPage) =>
    /vendor|contractor|supplier/i.test(`${page.url} ${page.h1} ${page.title}`);

  for (const page of pages) {
    for (const email of page.emails) {
      const existing = sightings.get(email.email);
      if (!existing) {
        sightings.set(email.email, { email, page });
        continue;
      }
      const upgrade =
        (isVendorPage(page) && !isVendorPage(existing.page)) ||
        (existing.email.footerOnly && !email.footerOnly);
      if (upgrade) sightings.set(email.email, { email, page });
    }
  }
  return sightings;
}

/** The page most likely to describe a vendor process, for the single S4 call. */
function pickMostPromisingPage(pages: readonly HarvestedPage[]): HarvestedPage | null {
  const withEmails = pages.filter((p) => p.emails.length > 0);
  if (withEmails.length === 0) return null;
  return (
    withEmails
      .map((page) => ({
        page,
        rank:
          (/vendor|contractor|supplier/i.test(page.url) ? 4 : 0) +
          (/vendor|contractor|supplier/i.test(page.h1) ? 3 : 0) +
          (/vendor|contractor|supplier/i.test(page.title) ? 2 : 0) +
          (page.forms.length > 0 ? 1 : 0),
      }))
      .sort((a, b) => b.rank - a.rank)[0]?.page ?? null
  );
}

function safeHostname(url: string): string | null {
  try {
    return apexDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * The fallback ladder from §5.3.
 *
 * Returns a union so the caller must handle every rung — including the last
 * one, where we found nothing and owe the operator the trace showing what we
 * actually checked.
 */
export function chooseOutcome(result: ResolveOutput): ResolutionOutcome {
  const [best] = result.contacts;

  if (best && best.score >= SEND_THRESHOLD) {
    return { kind: 'send', contact: best };
  }
  if (best && best.score >= LOW_CONFIDENCE_THRESHOLD) {
    return { kind: 'send_low_confidence', contact: best };
  }

  const form = result.channels.find((c) => c.kind === 'WEB_FORM' || c.kind === 'CONTACT_FORM');
  if (form) return { kind: 'route_to_form', channel: form };

  const portal = result.channels.find((c) => c.kind === 'PORTAL');
  if (portal) return { kind: 'route_to_portal', channel: portal };

  return {
    kind: 'needs_attention',
    reason:
      result.contacts.length === 0
        ? 'No vendor contact found and no application form detected.'
        : `Best candidate scored ${best?.score ?? 0}, below the ${LOW_CONFIDENCE_THRESHOLD} threshold.`,
    trace: result.trace,
  };
}

export { harvestPage };
