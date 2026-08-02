import type {
  CaptchaKind,
  ChannelKind,
  ContactKind,
  PlatformSlug,
  TradeSlug,
} from '@vendorlink/core/domain';

/**
 * Engine #1 types.
 *
 * The output is always a *ranked list* rather than a single address. That is a
 * product requirement, not an implementation detail: the card has to be able
 * to say "sending to vendors@oakwood.com — not right? [choose another]", which
 * is impossible if the engine collapses to one answer.
 */

export interface ScoreComponent {
  readonly reason: string;
  readonly delta: number;
}

export interface RankedContact {
  readonly email: string;
  readonly kind: ContactKind;
  readonly personName: string | null;
  readonly title: string | null;
  /** 0–100 after clamping. */
  readonly score: number;
  /** score / 100. */
  readonly confidence: number;
  readonly rank: number;
  readonly sourceUrl: string | null;
  readonly discoveryMethod: DiscoveryMethod;
  readonly mxValid: boolean | null;
  readonly isRoleAccount: boolean;
  /** Every tier and modifier that produced the score, for the trace drawer. */
  readonly breakdown: readonly ScoreComponent[];
  /** Quote from the page that justified an LLM-interpreted candidate. */
  readonly evidenceQuote: string | null;
}

export type DiscoveryMethod =
  | 'cache'
  | 'mailto'
  | 'plain_text'
  | 'deobfuscated'
  | 'json_ld'
  | 'llm_interpreted'
  | 'manual';

export interface DetectedChannel {
  readonly kind: ChannelKind;
  readonly url: string | null;
  readonly platformSlug: PlatformSlug | null;
  readonly requiresAccount: boolean;
  readonly requiresPayment: boolean;
  readonly feeCents: number | null;
  readonly captchaKind: CaptchaKind;
  readonly notes: string | null;
}

export interface PmRequirementsExtract {
  readonly minGlEachOccurrenceCents: number | null;
  readonly minGlAggregateCents: number | null;
  readonly minAutoCents: number | null;
  readonly minUmbrellaCents: number | null;
  readonly requiresWc: boolean;
  readonly requiresAdditionalInsured: boolean;
  readonly additionalInsuredWording: string | null;
  readonly requiresW9: boolean;
  readonly requiresBackgroundCheck: boolean;
  readonly requiresLicense: readonly string[];
  readonly sourceUrl: string | null;
}

/** One fetch, recorded whether it succeeded or not. */
export interface TraceFetch {
  readonly url: string;
  readonly stage: 'S1_known_path' | 'S1_sitemap' | 'S2_crawl' | 'S2_nav';
  readonly status: number;
  readonly durationMs: number;
  readonly bytes: number;
  readonly error?: string;
  /** True when robots.txt disallowed it and we did not fetch. */
  readonly skippedByRobots?: boolean;
}

export interface TraceCandidate {
  readonly email: string;
  readonly foundOn: string;
  readonly method: DiscoveryMethod;
  readonly score: number;
  readonly breakdown: readonly ScoreComponent[];
  readonly rejected?: string;
}

/**
 * The full record of a resolution.
 *
 * §5.1 requires "every URL fetched, every candidate scored, why". This is what
 * the operator sees when they click a channel chip, and it is the difference
 * between "we picked this address" and "we picked this address *because*".
 */
export interface ResolutionTrace {
  readonly pmCompanyId: string;
  readonly website: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stagesRun: readonly string[];
  readonly fetches: readonly TraceFetch[];
  readonly candidates: readonly TraceCandidate[];
  readonly fetchBudgetUsed: number;
  readonly fetchBudgetLimit: number;
  readonly llmCalls: number;
  readonly shortCircuitedAt: string | null;
  readonly notes: readonly string[];
}

export interface ResolveInput {
  readonly pmCompanyId: string;
  readonly website: string;
  readonly trade?: TradeSlug;
  readonly market?: string;
  readonly cache?: 'prefer' | 'bypass';
}

export interface ResolveOutput {
  readonly contacts: readonly RankedContact[];
  readonly channels: readonly DetectedChannel[];
  readonly requirements: PmRequirementsExtract | null;
  readonly trace: ResolutionTrace;
}

/**
 * The fallback ladder from §5.3, as a discriminated union.
 *
 * Returning a union rather than a nullable address forces the caller to handle
 * every rung — including the one where we found nothing and have to show the
 * operator what we checked.
 */
export type ResolutionOutcome =
  | { kind: 'send'; contact: RankedContact }
  | { kind: 'send_low_confidence'; contact: RankedContact }
  | { kind: 'route_to_form'; channel: DetectedChannel }
  | { kind: 'route_to_portal'; channel: DetectedChannel }
  | { kind: 'needs_attention'; reason: string; trace: ResolutionTrace };

/** Prior knowledge the pipeline folds in: cache, bounces, confirmations. */
export interface ContactStore {
  /** Cached contacts, with their age, for the S0 short-circuit. */
  getCached(pmCompanyId: string): Promise<{
    contacts: RankedContact[];
    lastVerifiedAt: Date | null;
  } | null>;
  /** Cross-tenant signals keyed by email. */
  getSignals(emails: readonly string[]): Promise<Map<string, string[]>>;
  /** Globally suppressed addresses. */
  getSuppressed(emails: readonly string[]): Promise<Set<string>>;
  persist(
    pmCompanyId: string,
    result: {
      contacts: readonly RankedContact[];
      channels: readonly DetectedChannel[];
      requirements: PmRequirementsExtract | null;
      trace: ResolutionTrace;
    },
  ): Promise<void>;
}
