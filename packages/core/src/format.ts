import { US_STATE_NAMES, type UsState, US_STATES } from './enums';

/**
 * Value transforms.
 *
 * These exist because the profile stores one canonical representation and PM
 * forms want a dozen different ones: cents vs "$85.00" vs "85", "GA" vs
 * "Georgia", "Yes" vs a checked box, `2026-08-02` vs `08/02/2026`. Engine #2's
 * transform layer is built out of these, and they are pure so they can be
 * tested exhaustively without a browser.
 */

// --------------------------------------------------------------------------
// Money
// --------------------------------------------------------------------------

export function centsToDollarString(cents: number, opts?: { symbol?: boolean }): string {
  const dollars = (cents / 100).toFixed(2);
  return opts?.symbol === false ? dollars : `$${dollars}`;
}

/** Whole dollars when the amount is exact, for forms that reject decimals. */
export function centsToWholeDollars(cents: number): string {
  return String(Math.round(cents / 100));
}

/** "$1,000,000" — how insurance limits read in a packet email. */
export function centsToDisplayLimit(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export function parseCurrencyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// --------------------------------------------------------------------------
// Phone
// --------------------------------------------------------------------------

export type PhoneFormat = 'dashes' | 'parens' | 'dots' | 'plain' | 'e164';

export function formatPhone(input: string, format: PhoneFormat = 'dashes'): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return input;
  const area = local.slice(0, 3);
  const prefix = local.slice(3, 6);
  const line = local.slice(6);
  switch (format) {
    case 'parens':
      return `(${area}) ${prefix}-${line}`;
    case 'dots':
      return `${area}.${prefix}.${line}`;
    case 'plain':
      return local;
    case 'e164':
      return `+1${local}`;
    case 'dashes':
    default:
      return `${area}-${prefix}-${line}`;
  }
}

// --------------------------------------------------------------------------
// Dates
// --------------------------------------------------------------------------

export type DateFormat = 'iso' | 'us' | 'us_dash' | 'long';

/** Input is an ISO date (`YYYY-MM-DD`); parsed as calendar, not UTC instant. */
export function formatDate(iso: string, format: DateFormat = 'us'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  switch (format) {
    case 'iso':
      return `${y}-${m}-${d}`;
    case 'us_dash':
      return `${m}-${d}-${y}`;
    case 'long': {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const monthName = monthNames[Number.parseInt(m, 10) - 1] ?? m;
      return `${monthName} ${Number.parseInt(d, 10)}, ${y}`;
    }
    case 'us':
    default:
      return `${m}/${d}/${y}`;
  }
}

export function daysUntil(iso: string, from: Date = new Date()): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}

/** Credential-expiry nag thresholds from §7.4. */
export const EXPIRY_NAG_DAYS = [45, 30, 14, 7] as const;

// --------------------------------------------------------------------------
// States
// --------------------------------------------------------------------------

export function stateToFullName(state: UsState): string {
  return US_STATE_NAMES[state];
}

const STATE_BY_NAME = new Map<string, UsState>(
  US_STATES.map((s) => [US_STATE_NAMES[s].toLowerCase(), s]),
);

/** Accepts "GA", "ga", "Georgia", " georgia " — anything a form might offer. */
export function normalizeState(input: string): UsState | null {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if ((US_STATES as readonly string[]).includes(upper)) return upper as UsState;
  return STATE_BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

// --------------------------------------------------------------------------
// Booleans
// --------------------------------------------------------------------------

export type BooleanFormat = 'yes_no' | 'true_false' | 'y_n' | 'one_zero';

export function formatBoolean(value: boolean, format: BooleanFormat = 'yes_no'): string {
  switch (format) {
    case 'true_false':
      return value ? 'True' : 'False';
    case 'y_n':
      return value ? 'Y' : 'N';
    case 'one_zero':
      return value ? '1' : '0';
    case 'yes_no':
    default:
      return value ? 'Yes' : 'No';
  }
}

// --------------------------------------------------------------------------
// Fuzzy option matching
// --------------------------------------------------------------------------

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein, bounded by the shorter string; used only on short labels. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

export interface OptionMatch<T> {
  option: T;
  score: number;
}

/**
 * Match one of a form's own `<option>` labels against a set of candidate
 * phrases (a trade's aliases, say). Exact and containment matches win outright;
 * edit distance only decides near-misses, so "Plumbing" never matches
 * "Painting".
 */
export function bestOptionMatch<T>(
  options: readonly T[],
  labelOf: (option: T) => string,
  candidates: readonly string[],
  minScore = 0.72,
): OptionMatch<T> | null {
  const normalizedCandidates = candidates.map(normalizeForMatch).filter((c) => c.length > 0);
  if (normalizedCandidates.length === 0) return null;

  let best: OptionMatch<T> | null = null;

  for (const option of options) {
    const label = normalizeForMatch(labelOf(option));
    if (label.length === 0) continue;

    let score = 0;
    for (const candidate of normalizedCandidates) {
      if (label === candidate) {
        score = 1;
        break;
      }
      if (label.includes(candidate) || candidate.includes(label)) {
        // Containment is strong but not exact; longer overlap scores higher.
        const overlap = Math.min(label.length, candidate.length) / Math.max(label.length, candidate.length);
        score = Math.max(score, 0.8 + 0.15 * overlap);
        continue;
      }
      const distance = editDistance(label, candidate);
      const similarity = 1 - distance / Math.max(label.length, candidate.length);
      score = Math.max(score, similarity);
    }

    if (score >= minScore && (best === null || score > best.score)) {
      best = { option, score };
    }
  }

  return best;
}

// --------------------------------------------------------------------------
// Text
// --------------------------------------------------------------------------

/** Truncate to a form's `maxlength` without cutting mid-word where avoidable. */
export function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const hard = text.slice(0, maxLength);
  const lastBreak = hard.lastIndexOf(' ');
  return lastBreak > maxLength * 0.6 ? hard.slice(0, lastBreak) : hard;
}

export function titleCase(input: string): string {
  return input.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
