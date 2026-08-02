import type { HttpFetcher } from '@vendorlink/core';
import { harvestPage, type HarvestedPage } from './harvest';
import type { TraceFetch } from './types';

/**
 * S1 and S2 — discovery.
 *
 * §5.2 caps this at 25 fetches per company per run and requires that
 * `robots.txt` be honoured. Both are real constraints rather than politeness
 * theatre: discovery crawling is *our* traffic (unlike a form submission,
 * which the user initiates on their own behalf), and a resolver that hammers a
 * PM's site gets the whole product blocked.
 */

export const DEFAULT_FETCH_BUDGET = 25;

/** §5.2's probe list, in the order most likely to pay off. */
export const KNOWN_PATHS: readonly string[] = [
  '/vendors',
  '/vendor',
  '/vendor-application',
  '/become-a-vendor',
  '/vendor-signup',
  '/vendor-registration',
  '/vendor-onboarding',
  '/vendor-portal',
  '/suppliers',
  '/contractors',
  '/service-providers',
  '/work-with-us',
  '/partners',
  '/contact',
  '/about/contact',
  '/maintenance',
];

const VENDOR_LINK_RE = /vendor|contractor|supplier|service provider|partner/i;

// --------------------------------------------------------------------------
// robots.txt
// --------------------------------------------------------------------------

export interface RobotsRules {
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
  readonly sitemaps: readonly string[];
}

/**
 * Minimal robots.txt parser.
 *
 * Reads the `*` group plus any group naming our agent, and merges them. Not a
 * complete implementation of the spec, but it honours the directives that
 * actually appear on PM sites, and it errs toward *not* fetching.
 */
export function parseRobots(body: string, userAgent = 'vendorlinkbot'): RobotsRules {
  const disallow: string[] = [];
  const allow: string[] = [];
  const sitemaps: string[] = [];

  let applies = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = (rawKey ?? '').trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      applies = agent === '*' || userAgent.toLowerCase().includes(agent);
      continue;
    }
    if (!applies) continue;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
  }

  return { disallow, allow, sitemaps };
}

/** Longest-match wins, with Allow beating Disallow at equal length. */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const match = (patterns: readonly string[]) =>
    patterns
      .filter((p) => path.startsWith(p.replace(/\*$/, '')))
      .reduce((longest, p) => Math.max(longest, p.length), -1);

  const disallowed = match(rules.disallow);
  const allowed = match(rules.allow);
  if (disallowed === -1) return true;
  return allowed >= disallowed;
}

// --------------------------------------------------------------------------
// Crawl
// --------------------------------------------------------------------------

export interface CrawlResult {
  readonly pages: readonly HarvestedPage[];
  readonly fetches: readonly TraceFetch[];
  readonly budgetUsed: number;
  readonly robotsBlocked: number;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stripFragment(url: string): string {
  return url.replace(/#.*$/, '');
}

export interface CrawlOptions {
  readonly fetcher: HttpFetcher;
  readonly website: string;
  readonly budget?: number;
  readonly respectRobots?: boolean;
  /** Stop early once a page scores this well — saves the remaining budget. */
  readonly shouldStop?: (page: HarvestedPage) => boolean;
}

/**
 * Run S1 (known paths + sitemap) then S2 (nav/footer crawl, depth 2).
 *
 * Short-circuits as soon as `shouldStop` is satisfied, which is what keeps the
 * common case — a site with an obvious `/vendors` page — down to two or three
 * fetches rather than the full budget.
 */
export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const budget = opts.budget ?? DEFAULT_FETCH_BUDGET;
  const respectRobots = opts.respectRobots ?? true;

  const pages: HarvestedPage[] = [];
  const fetches: TraceFetch[] = [];
  const seen = new Set<string>();
  let used = 0;
  let robotsBlocked = 0;

  const origin = (() => {
    try {
      return new URL(opts.website).origin;
    } catch {
      return null;
    }
  })();
  if (!origin) {
    return { pages, fetches, budgetUsed: 0, robotsBlocked: 0 };
  }

  // robots.txt is fetched outside the budget: it is what tells us what we are
  // allowed to spend the budget on.
  let rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  if (respectRobots) {
    const res = await opts.fetcher.fetch(`${origin}/robots.txt`);
    if (res.status === 200 && res.body) rules = parseRobots(res.body);
  }

  const allowed = (url: string): boolean => {
    if (!respectRobots) return true;
    try {
      return isAllowed(rules, new URL(url).pathname);
    } catch {
      return false;
    }
  };

  const visit = async (
    url: string,
    stage: TraceFetch['stage'],
  ): Promise<HarvestedPage | null> => {
    const normalized = stripFragment(url);
    if (seen.has(normalized) || used >= budget) return null;
    seen.add(normalized);

    if (!allowed(normalized)) {
      robotsBlocked++;
      fetches.push({
        url: normalized,
        stage,
        status: 0,
        durationMs: 0,
        bytes: 0,
        skippedByRobots: true,
      });
      return null;
    }

    used++;
    const res = await opts.fetcher.fetch(normalized);
    fetches.push({
      url: normalized,
      stage,
      status: res.status,
      durationMs: res.durationMs,
      bytes: res.body.length,
      ...(res.error ? { error: res.error } : {}),
    });

    if (res.status !== 200 || !res.body) return null;
    const page = harvestPage(res.finalUrl || normalized, res.body);
    pages.push(page);
    return page;
  };

  // --- S1: homepage, sitemap, known paths ---------------------------------
  const home = await visit(origin, 'S1_known_path');
  if (home && opts.shouldStop?.(home)) {
    return { pages, fetches, budgetUsed: used, robotsBlocked };
  }

  for (const sitemapUrl of rules.sitemaps.slice(0, 2)) {
    if (used >= budget) break;
    const res = await opts.fetcher.fetch(sitemapUrl);
    used++;
    fetches.push({
      url: sitemapUrl,
      stage: 'S1_sitemap',
      status: res.status,
      durationMs: res.durationMs,
      bytes: res.body.length,
      ...(res.error ? { error: res.error } : {}),
    });
    if (res.status !== 200) continue;

    // Only follow sitemap entries that look vendor-related; a full sitemap can
    // list thousands of property pages and none of them help.
    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((m) => m[1] as string)
      .filter((loc) => VENDOR_LINK_RE.test(loc))
      .slice(0, 5);
    for (const loc of locs) {
      if (used >= budget) break;
      const page = await visit(loc, 'S1_sitemap');
      if (page && opts.shouldStop?.(page)) {
        return { pages, fetches, budgetUsed: used, robotsBlocked };
      }
    }
  }

  for (const path of KNOWN_PATHS) {
    if (used >= budget) break;
    const page = await visit(`${origin}${path}`, 'S1_known_path');
    if (page && opts.shouldStop?.(page)) {
      return { pages, fetches, budgetUsed: used, robotsBlocked };
    }
  }

  // --- S2: follow vendor-ish links from what we already have, depth 2 -----
  let frontier: string[] = home
    ? home.links
        .filter((l) => VENDOR_LINK_RE.test(l.text) || VENDOR_LINK_RE.test(l.href))
        .map((l) => absolute(l.href, home.url))
        .filter((u): u is string => u !== null && sameOrigin(u, origin))
    : [];

  for (let depth = 0; depth < 2 && frontier.length > 0 && used < budget; depth++) {
    const next: string[] = [];
    for (const url of frontier) {
      if (used >= budget) break;
      const page = await visit(url, 'S2_crawl');
      if (!page) continue;
      if (opts.shouldStop?.(page)) {
        return { pages, fetches, budgetUsed: used, robotsBlocked };
      }
      for (const link of page.links) {
        if (!VENDOR_LINK_RE.test(link.text) && !VENDOR_LINK_RE.test(link.href)) continue;
        const abs = absolute(link.href, page.url);
        if (abs && sameOrigin(abs, origin) && !seen.has(stripFragment(abs))) next.push(abs);
      }
    }
    frontier = next;
  }

  return { pages, fetches, budgetUsed: used, robotsBlocked };
}
