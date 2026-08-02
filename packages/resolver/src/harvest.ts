import type { DiscoveryMethod } from './types';

/**
 * S3 — harvest.
 *
 * Everything here is deterministic. §5.2 is explicit that the LLM interprets
 * ambiguity and never performs extraction, and the reason is practical: an
 * address that a regex found provably exists in the page, whereas an address a
 * model produced might not. De-mangling `name [at] domain [dot] com` is regex
 * work, so it is done with regexes.
 */

export interface HarvestedEmail {
  readonly email: string;
  readonly method: DiscoveryMethod;
  /** Surrounding text, used for scoring context and as evidence. */
  readonly context: string;
  /** True when the only occurrence was inside a <footer>. */
  readonly footerOnly: boolean;
  /** Adjacent person name and title, when the markup makes them obvious. */
  readonly personName: string | null;
  readonly title: string | null;
}

export interface HarvestedPage {
  readonly url: string;
  readonly title: string;
  readonly h1: string;
  readonly emails: readonly HarvestedEmail[];
  readonly forms: readonly HarvestedForm[];
  readonly iframes: readonly string[];
  readonly links: readonly { href: string; text: string }[];
  /** Whole-page text, used to verify LLM evidence quotes. */
  readonly text: string;
}

export interface HarvestedForm {
  readonly action: string | null;
  readonly method: string;
  readonly fieldCount: number;
  readonly hasFileInput: boolean;
  readonly captchaHint: string | null;
  /** Text near the form, to tell a vendor form from a newsletter signup. */
  readonly context: string;
}

// --------------------------------------------------------------------------
// HTML utilities
// --------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&#64;': '@', '&commat;': '@', '&period;': '.',
  '&#46;': '.',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&[a-z#0-9]+;/gi, (entity) => {
      const named = HTML_ENTITIES[entity.toLowerCase()];
      if (named) return named;
      const numeric = /^&#(\d+);$/.exec(entity);
      if (numeric) return String.fromCodePoint(Number.parseInt(numeric[1] as string, 10));
      const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
      if (hex) return String.fromCodePoint(Number.parseInt(hex[1] as string, 16));
      return entity;
    });
}

export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  return match?.[1] ? stripTags(match[1]) : '';
}

// --------------------------------------------------------------------------
// Email extraction
// --------------------------------------------------------------------------

/**
 * Deliberately not RFC 5322. Addresses on marketing pages are ordinary, and a
 * permissive pattern drags in image filenames and version strings.
 */
const EMAIL_RE = /\b([a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?)@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,24})+)\b/gi;

/** Extensions that show up as `something@2x.png` and are not addresses. */
const NON_EMAIL_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'json']);

function isPlausibleEmail(email: string): boolean {
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;
  const tld = domain.split('.').pop()?.toLowerCase();
  if (!tld || NON_EMAIL_TLDS.has(tld)) return false;
  // `user@2x.png` style artefacts and sentinel addresses.
  if (/^\d+x$/.test(domain.split('.')[0] ?? '')) return false;
  if (/(example|test|domain|yourdomain|email)\.(com|org|net)$/i.test(domain)) return false;
  if (/^(your|my|the)?(name|email|address)$/i.test(local)) return false;
  return true;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().replace(/^mailto:/, '').split('?')[0] ?? '';
}

/**
 * Undo the common obfuscations.
 *
 * These patterns are what sites actually use to dodge naive scrapers:
 * `name [at] domain [dot] com`, `name (at) domain (dot) com`, spaced-out
 * separators, and HTML entity encoding. Each is a distinct, testable rule
 * rather than one clever mega-regex.
 */
export function deobfuscate(text: string): string {
  return (
    text
      // `name [at] domain [dot] com` and the (at)/{at}/ AT  variants.
      .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, '@')
      .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, '.')
      // Bare " at " / " dot " only between word characters, so ordinary prose
      // like "look at dot com pricing" is not mangled into an address.
      .replace(/([a-z0-9._%+-])\s+at\s+([a-z0-9-]+\s+dot\s+[a-z]{2,})/gi, '$1@$2')
      .replace(/([a-z0-9-])\s+dot\s+([a-z]{2,})/gi, '$1.$2')
      // ` -at- ` / ` _at_ `
      .replace(/\s*[-_]at[-_]\s*/gi, '@')
      .replace(/\s*[-_]dot[-_]\s*/gi, '.')
  );
}

/**
 * Addresses assembled in JavaScript, e.g.
 *   var user = 'vendors'; var host = 'oakwood.com';
 *   document.write(user + '@' + host)
 * Only the simple, common two-variable shape is handled; anything more is left
 * to S4, which must still produce a quote that appears in the page.
 */
export function extractJsAssembled(html: string): string[] {
  const results: string[] = [];
  const assignments = new Map<string, string>();

  const varRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]{1,80})['"]/g;
  for (const match of html.matchAll(varRe)) {
    assignments.set(match[1] as string, match[2] as string);
  }

  const concatRe = /([A-Za-z_$][\w$]*)\s*\+\s*['"]@['"]\s*\+\s*([A-Za-z_$][\w$]*)/g;
  for (const match of html.matchAll(concatRe)) {
    const local = assignments.get(match[1] as string);
    const domain = assignments.get(match[2] as string);
    if (local && domain) {
      const candidate = normalizeEmail(`${local}@${domain}`);
      if (isPlausibleEmail(candidate)) results.push(candidate);
    }
  }

  // The `'vendors' + '@' + 'oakwood.com'` literal form.
  const literalRe = /['"]([a-z0-9._%+-]+)['"]\s*\+\s*['"]@['"]\s*\+\s*['"]([a-z0-9.-]+\.[a-z]{2,})['"]/gi;
  for (const match of html.matchAll(literalRe)) {
    const candidate = normalizeEmail(`${match[1]}@${match[2]}`);
    if (isPlausibleEmail(candidate)) results.push(candidate);
  }

  return [...new Set(results)];
}

function contextAround(haystack: string, needle: string, radius = 160): string {
  const index = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return '';
  return haystack.slice(Math.max(0, index - radius), index + needle.length + radius).trim();
}

const PERSON_NEAR_EMAIL_RE =
  /([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2})\s*[,–—-]?\s*((?:Senior |Sr\.? |Junior |Jr\.? |Regional |Assistant )?(?:Vice President|VP|Director|Manager|Coordinator|Supervisor|Specialist|Administrator|Analyst|Lead)(?:\s+of\s+[A-Za-z ]{3,40})?)/g;

/**
 * Find the person and title attached to a specific address.
 *
 * Anchored to the text immediately *preceding* the address, and takes the
 * nearest match rather than the first one in a window. A symmetric window
 * around the address picks up the previous person on a staff listing — which
 * silently attributed "Director of Vendor Relations" to the leasing manager
 * listed underneath them, and then ranked her first.
 */
/** Block-level boundaries; a person's details never span one. */
const BLOCK_BOUNDARY_RE = /<\/?(?:p|li|td|tr|div|section|article|h[1-6]|br)\b[^>]*>/gi;

/**
 * Text immediately before an address, bounded to its own block element.
 *
 * Flattening the whole document first is what let "Contact Our Team" bleed
 * into the name of the first person listed under that heading.
 */
function blockTextBefore(html: string, email: string): string | null {
  const index = html.toLowerCase().indexOf(email.toLowerCase());
  if (index === -1) return null;

  const window = html.slice(Math.max(0, index - 400), index);
  let lastBoundaryEnd = 0;
  for (const match of window.matchAll(BLOCK_BOUNDARY_RE)) {
    lastBoundaryEnd = (match.index ?? 0) + match[0].length;
  }
  return stripTags(window.slice(lastBoundaryEnd));
}

function personNearEmail(
  haystack: string,
  email: string,
): { name: string; title: string } | null {
  const index = haystack.toLowerCase().indexOf(email.toLowerCase());
  if (index === -1) return null;

  let before = haystack.slice(Math.max(0, index - 140), index);

  // A staff listing flattens to one line, so the window must not reach back
  // past the *previous* address — otherwise the person above inherits their
  // title to the person below. Truncate at the last email in the window.
  let lastEmailEnd = -1;
  for (const prior of before.matchAll(EMAIL_RE)) {
    lastEmailEnd = (prior.index ?? 0) + prior[0].length;
  }
  if (lastEmailEnd > -1) before = before.slice(lastEmailEnd);

  let nearest: { name: string; title: string } | null = null;
  for (const match of before.matchAll(PERSON_NEAR_EMAIL_RE)) {
    nearest = { name: match[1] as string, title: match[2] as string };
  }
  return nearest;
}

/** Extract every address from one page, with how it was found. */
export function harvestEmails(html: string, opts: { footerHtml?: string } = {}): HarvestedEmail[] {
  const byEmail = new Map<string, HarvestedEmail>();
  const pageText = stripTags(html);
  const footerText = opts.footerHtml ? stripTags(opts.footerHtml) : '';

  const record = (raw: string, method: DiscoveryMethod, searchIn: string) => {
    const email = normalizeEmail(raw);
    if (!isPlausibleEmail(email)) return;

    const context = contextAround(searchIn, email) || contextAround(pageText, email);
    const inFooter = footerText.toLowerCase().includes(email.toLowerCase());
    // "Footer only" means it appears in the footer and nowhere else. The
    // footer is itself part of the page text, so the body check has to be made
    // against the page with the footer removed.
    const footerOnly = inFooter && !inBodyOutsideFooter(pageText, footerText, email);

    const existing = byEmail.get(email);
    // A mailto: link is stronger provenance than a bare text match, so keep
    // the strongest method seen for a given address.
    const strength: Record<DiscoveryMethod, number> = {
      cache: 0, plain_text: 1, deobfuscated: 2, json_ld: 3,
      mailto: 4, llm_interpreted: 0, manual: 5,
    };
    if (existing && strength[existing.method] >= strength[method]) {
      // Keep the stronger provenance, but let a non-footer sighting clear the
      // footer-only flag.
      if (!footerOnly) byEmail.set(email, { ...existing, footerOnly: false });
      return;
    }

    // Prefer the address's own block element; fall back to the flattened text
    // for markup that offers no block structure to bound the search with.
    const block = blockTextBefore(html, email);
    const person =
      (block ? personNearEmail(`${block}${email}`, email) : null) ??
      personNearEmail(searchIn, email) ??
      personNearEmail(pageText, email);

    byEmail.set(email, {
      email,
      method,
      context,
      footerOnly,
      personName: person?.name ?? null,
      title: person?.title ?? null,
    });
  };

  // 1. mailto: hrefs — the strongest signal.
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    record(decodeEntities(match[1] as string), 'mailto', pageText);
  }

  // 2. JSON-LD contactPoint blocks.
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    for (const found of (match[1] ?? '').matchAll(EMAIL_RE)) {
      record(found[0], 'json_ld', match[1] as string);
    }
  }

  // 3. Plain text in the rendered page.
  for (const match of pageText.matchAll(EMAIL_RE)) {
    record(match[0], 'plain_text', pageText);
  }

  // 4. Obfuscated forms, de-mangled deterministically.
  const deobfuscated = deobfuscate(pageText);
  for (const match of deobfuscated.matchAll(EMAIL_RE)) {
    const email = normalizeEmail(match[0]);
    // Only record if it was *not* already plainly present, so the method
    // recorded reflects how it actually had to be recovered.
    if (!byEmail.has(email)) record(match[0], 'deobfuscated', deobfuscated);
  }

  // 5. Entity-encoded addresses that only appear in raw HTML.
  const decodedHtml = decodeEntities(html);
  for (const match of decodedHtml.matchAll(EMAIL_RE)) {
    const email = normalizeEmail(match[0]);
    if (!byEmail.has(email)) record(match[0], 'deobfuscated', stripTags(decodedHtml));
  }

  // 6. JavaScript-assembled addresses.
  for (const email of extractJsAssembled(html)) {
    if (!byEmail.has(email)) record(email, 'deobfuscated', pageText);
  }

  return [...byEmail.values()];
}

function inBodyOutsideFooter(pageText: string, footerText: string, email: string): boolean {
  if (!footerText) return true;
  const withoutFooter = pageText.replace(footerText, ' ');
  return withoutFooter.toLowerCase().includes(email.toLowerCase());
}

// --------------------------------------------------------------------------
// Forms, iframes, links
// --------------------------------------------------------------------------

const CAPTCHA_HINTS: Array<[RegExp, string]> = [
  [/g-recaptcha|recaptcha\/api\.js|grecaptcha/i, 'recaptcha_v2'],
  [/recaptcha\/api\.js\?render=/i, 'recaptcha_v3'],
  [/hcaptcha\.com|h-captcha/i, 'hcaptcha'],
  [/challenges\.cloudflare\.com|cf-turnstile/i, 'turnstile'],
];

export function detectCaptcha(html: string): string | null {
  // v3 is checked first: its script URL also matches the v2 pattern.
  if (/recaptcha\/api\.js\?render=/i.test(html)) return 'recaptcha_v3';
  for (const [pattern, kind] of CAPTCHA_HINTS) {
    if (pattern.test(html)) return kind;
  }
  return null;
}

export function harvestForms(html: string): HarvestedForm[] {
  const forms: HarvestedForm[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    // Match the whole tag, not just its name: the filter below inspects the
    // `type` attribute, which is not in the tag name.
    const fieldCount = [...inner.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].filter(
      (m) => !/type\s*=\s*["'](hidden|submit|button|image|reset)["']/i.test(m[0]),
    ).length;

    forms.push({
      action: /action\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? null,
      method: (/method\s*=\s*["'](\w+)["']/i.exec(attrs)?.[1] ?? 'get').toLowerCase(),
      fieldCount,
      hasFileInput: /<input[^>]+type\s*=\s*["']file["']/i.test(inner),
      captchaHint: detectCaptcha(match[0]),
      context: stripTags(inner).slice(0, 400),
    });
  }
  return forms;
}

export function harvestIframes(html: string): string[] {
  return [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(
    (m) => decodeEntities(m[1] as string),
  );
}

export function harvestLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1] as string);
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) continue;
    links.push({ href, text: stripTags(match[2] ?? '').slice(0, 120) });
  }
  return links;
}

function extractFooter(html: string): string | undefined {
  const match =
    /<footer\b[^>]*>([\s\S]*?)<\/footer>/i.exec(html) ??
    /<div[^>]+(?:class|id)\s*=\s*["'][^"']*footer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  return match?.[1];
}

/** Harvest one fetched page in full. */
export function harvestPage(url: string, html: string): HarvestedPage {
  const footerHtml = extractFooter(html);
  return {
    url,
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    h1: firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    emails: harvestEmails(html, footerHtml ? { footerHtml } : {}),
    forms: harvestForms(html),
    iframes: harvestIframes(html),
    links: harvestLinks(html),
    text: stripTags(html),
  };
}
