import { TRADE_EMAIL_TOKENS, type ContactKind, type TradeSlug } from '@vendorlink/core/domain';
import type { ScoreComponent } from './types';

/**
 * S6 — scoring.
 *
 * This function *is* the definition of "next best listed email". It is pure
 * and every branch appends to a breakdown, so the trace can show an operator
 * exactly why one address outranked another.
 */

interface Tier {
  readonly base: number;
  readonly kind: ContactKind;
  readonly label: string;
  readonly patterns: readonly RegExp[];
}

/**
 * Ordered by §5.3. First match wins, so the more specific tiers come first:
 * `vendorcompliance` must land in tier 1 rather than being caught by a looser
 * later pattern.
 */
const TIERS: readonly Tier[] = [
  {
    base: 100,
    kind: 'vendor_onboarding',
    label: 'vendor-onboarding inbox',
    patterns: [
      /^vendors?$/,
      /^vendor[._-]?(relations|management|onboarding|application|compliance|services|inquiries|info|setup|registration)$/,
      /^(new|prospective)[._-]?vendors?$/,
    ],
  },
  {
    base: 90,
    kind: 'vendor_onboarding',
    label: 'supplier/contractor inbox',
    patterns: [/^suppliers?/, /^(sub)?contractors?/, /^serviceproviders?$/, /^service[._-]providers?$/],
  },
  {
    base: 80,
    kind: 'procurement',
    label: 'procurement inbox',
    patterns: [/^procurement/, /^purchasing/, /^sourcing/],
  },
  {
    base: 70,
    kind: 'maintenance',
    label: 'maintenance/operations inbox',
    patterns: [
      /^maintenance/, /^facilities/, /^workorders?$/, /^work[._-]orders?$/,
      /^service$/, /^repairs?$/, /^operations$/, /^ops$/,
    ],
  },
  {
    base: 55,
    kind: 'ap',
    label: 'accounts-payable inbox',
    patterns: [/^ap$/, /^accountspayable$/, /^accounts[._-]payable$/, /^accounting/, /^billing/, /^invoices?$/],
  },
  {
    base: 35,
    kind: 'general',
    label: 'general inbox',
    patterns: [/^info$/, /^contact$/, /^hello$/, /^admin$/, /^office$/, /^inquiries$/, /^general$/],
  },
];

/**
 * Tier 8 — excluded outright. Mailing a vendor packet to `careers@` or
 * `press@` is not a low-value send, it is a wrong send that trains the
 * recipient to mark us as spam.
 */
const EXCLUDED_PATTERNS: readonly RegExp[] = [
  /^sales/, /^leasing/, /^marketing/, /^careers?$/, /^hr$/, /^jobs?$/,
  /^press$/, /^media$/, /^legal$/, /^privacy$/, /^webmaster$/,
  /^no[._-]?reply/, /^donotreply/, /^unsubscribe$/, /^postmaster$/, /^abuse$/,
  /^support$/, /^help$/, /^newsletter$/, /^subscribe$/, /^events?$/,
  /^investor/, /^ir$/, /^security$/, /^dmca$/,
];

/** Tier 6 — a named human whose title puts them in the right function. */
const RELEVANT_TITLE_RE = /vendor|procurement|maintenance|facilit|purchas|supplier|contractor/i;

const FREE_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'aol.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'gmx.com',
  'mail.com', 'yandex.com', 'zoho.com',
]);

const ROLE_LOCAL_PARTS = new Set([
  'info', 'contact', 'admin', 'office', 'sales', 'support', 'help', 'hello',
  'vendors', 'vendor', 'procurement', 'purchasing', 'maintenance', 'ap',
  'accounting', 'billing', 'service', 'operations', 'ops', 'general',
]);

export interface ScoreInput {
  readonly email: string;
  /** URL of the page it was found on. */
  readonly sourceUrl: string;
  /** `<h1>` of that page. */
  readonly pageH1: string;
  /** True when the address only appeared in a footer with no vendor context. */
  readonly footerOnly: boolean;
  /** PM's apex domain, for the same-domain bonus. */
  readonly companyDomain: string | null;
  /** Tenant's primary trade, for the trade-token bonus. */
  readonly trade?: TradeSlug;
  /** Tenant's market, for the market-token bonus. */
  readonly market?: string;
  /** MX lookup result; null when not checked. */
  readonly mxValid: boolean | null;
  /** Cross-tenant signals for this address. */
  readonly signals?: readonly string[];
  /** Title of an adjacent named human, if any. */
  readonly title?: string | null;
}

export interface ScoreResult {
  /** Clamped to 0–100. This is what confidence is derived from. */
  readonly score: number;
  /**
   * The score before clamping, used only to break ties.
   *
   * Clamping is right for confidence — 135 does not mean "more than certain" —
   * but it flattens genuine differences in rank. A tier-1 `vendors@` and a
   * tier-3 `procurement@` on the same vendor page both clamp to 100, and
   * without this the tiebreak fell through to alphabetical order and put
   * procurement first.
   */
  readonly rawScore: number;
  readonly kind: ContactKind;
  readonly isRoleAccount: boolean;
  readonly excluded: boolean;
  readonly exclusionReason: string | null;
  readonly breakdown: readonly ScoreComponent[];
}

function localPartOf(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase();
}

function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase();
}

/** Apex domain, so `mail.oakwood.com` still counts as Oakwood's. */
export function apexDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  // Handles `co.uk`-style suffixes well enough for a scoring bonus.
  const twoLevelTlds = new Set(['co.uk', 'com.au', 'co.nz', 'co.za', 'com.br']);
  const lastTwo = parts.slice(-2).join('.');
  return twoLevelTlds.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** Normalize a local part for tier matching: `vendor-relations` → `vendorrelations`. */
function canonicalLocal(local: string): string {
  return local.replace(/[._-]/g, '');
}

export function scoreContact(input: ScoreInput): ScoreResult {
  const breakdown: ScoreComponent[] = [];
  const local = localPartOf(input.email);
  const canonical = canonicalLocal(local);
  const domain = domainOf(input.email);

  // --- exclusions ---------------------------------------------------------
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(local) || pattern.test(canonical)) {
      return {
        score: 0,
        rawScore: 0,
        kind: 'unknown',
        isRoleAccount: true,
        excluded: true,
        exclusionReason: `${local}@ is a wrong-department inbox (tier 8)`,
        breakdown: [{ reason: `excluded: ${local}@ is not a vendor channel`, delta: 0 }],
      };
    }
  }

  if (input.signals?.includes('hard_bounce')) {
    return {
      score: 0,
      rawScore: 0,
      kind: 'unknown',
      isRoleAccount: ROLE_LOCAL_PARTS.has(canonical),
      excluded: true,
      exclusionReason: 'previously hard-bounced (any tenant)',
      breakdown: [{ reason: 'hard bounced previously — excluded globally', delta: -100 }],
    };
  }

  // --- base tier ----------------------------------------------------------
  let base = 0;
  let kind: ContactKind = 'unknown';

  const tier = TIERS.find((t) =>
    t.patterns.some((p) => p.test(local) || p.test(canonical)),
  );

  if (tier) {
    base = tier.base;
    kind = tier.kind;
    breakdown.push({ reason: `${tier.label} (${local}@)`, delta: tier.base });
  } else if (input.title && RELEVANT_TITLE_RE.test(input.title)) {
    // Tier 6: a named person whose title is in the right function.
    base = 65;
    kind = 'procurement';
    breakdown.push({ reason: `named contact with relevant title: ${input.title}`, delta: 65 });
  } else {
    base = 20;
    kind = 'unknown';
    breakdown.push({ reason: `unrecognized inbox (${local}@)`, delta: 20 });
  }

  let score = base;

  // --- modifiers ----------------------------------------------------------
  const vendorContext = /vendor|contractor|supplier/i;
  if (vendorContext.test(input.sourceUrl) || vendorContext.test(input.pageH1)) {
    score += 25;
    breakdown.push({ reason: 'found on a vendor/contractor/supplier page', delta: 25 });
  }

  if (input.trade) {
    const tradeToken = TRADE_EMAIL_TOKENS.find(
      (t) => t.slug === input.trade && canonical.includes(t.token),
    );
    if (tradeToken) {
      score += 20;
      breakdown.push({ reason: `trade token "${tradeToken.token}" matches your primary trade`, delta: 20 });
    }
  }

  if (input.market) {
    const marketToken = input.market.toLowerCase().replace(/[^a-z]/g, '');
    if (marketToken.length >= 4 && canonical.includes(marketToken)) {
      score += 15;
      breakdown.push({ reason: `market token "${marketToken}" matches your service area`, delta: 15 });
    }
  }

  if (input.companyDomain && domain === apexDomain(input.companyDomain)) {
    score += 10;
    breakdown.push({ reason: 'on the company’s own domain', delta: 10 });
  }

  if (input.footerOnly) {
    score -= 15;
    breakdown.push({ reason: 'only appeared in a footer, with no vendor context', delta: -15 });
  }

  if (FREE_PROVIDERS.has(domain)) {
    score -= 25;
    breakdown.push({ reason: `free email provider (${domain})`, delta: -25 });
  }

  if (input.mxValid === false) {
    score -= 60;
    breakdown.push({ reason: 'domain has no MX record — probably undeliverable', delta: -60 });
  }

  if (input.signals?.includes('wrong_department')) {
    score -= 40;
    breakdown.push({ reason: 'a prior reply said this is the wrong department', delta: -40 });
  }

  if (input.signals?.includes('confirmed')) {
    score += 40;
    breakdown.push({ reason: 'confirmed correct by a prior reply', delta: 40 });
  }

  const clamped = Math.max(0, Math.min(100, score));
  if (clamped !== score) {
    breakdown.push({ reason: `clamped from ${score} to ${clamped}`, delta: clamped - score });
  }

  return {
    score: clamped,
    rawScore: score,
    kind,
    isRoleAccount: ROLE_LOCAL_PARTS.has(canonical),
    excluded: false,
    exclusionReason: null,
    breakdown,
  };
}

/** §5.3 thresholds, named so the ladder and the UI cannot drift apart. */
export const SEND_THRESHOLD = 60;
export const LOW_CONFIDENCE_THRESHOLD = 35;
