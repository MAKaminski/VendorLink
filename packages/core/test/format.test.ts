import { describe, expect, it } from 'vitest';
import {
  bestOptionMatch,
  centsToDisplayLimit,
  centsToDollarString,
  centsToWholeDollars,
  daysUntil,
  formatBoolean,
  formatDate,
  formatPhone,
  normalizeState,
  parseCurrencyToCents,
  truncateToLength,
} from '../src/format.js';
import { TRADES } from '../src/trades.js';

describe('money', () => {
  it('renders cents in the shapes forms ask for', () => {
    expect(centsToDollarString(8500)).toBe('$85.00');
    expect(centsToDollarString(8500, { symbol: false })).toBe('85.00');
    expect(centsToWholeDollars(8500)).toBe('85');
  });

  it('renders insurance limits the way a packet email states them', () => {
    expect(centsToDisplayLimit(100_000_000)).toBe('$1,000,000');
    expect(centsToDisplayLimit(200_000_000)).toBe('$2,000,000');
  });

  it('parses currency back out of arbitrary form text', () => {
    expect(parseCurrencyToCents('$1,000,000.00')).toBe(100_000_000);
    expect(parseCurrencyToCents('85')).toBe(8500);
    expect(parseCurrencyToCents('')).toBeNull();
    expect(parseCurrencyToCents('n/a')).toBeNull();
  });
});

describe('phone', () => {
  it('formats to each shape a form might require', () => {
    expect(formatPhone('4045551234', 'dashes')).toBe('404-555-1234');
    expect(formatPhone('4045551234', 'parens')).toBe('(404) 555-1234');
    expect(formatPhone('4045551234', 'dots')).toBe('404.555.1234');
    expect(formatPhone('4045551234', 'plain')).toBe('4045551234');
    expect(formatPhone('4045551234', 'e164')).toBe('+14045551234');
  });

  it('strips a leading country code and existing punctuation', () => {
    expect(formatPhone('1 (404) 555-1234')).toBe('404-555-1234');
  });

  it('returns the input unchanged when it is not a 10-digit US number', () => {
    expect(formatPhone('555-1234')).toBe('555-1234');
  });
});

describe('dates', () => {
  it('formats an ISO date without timezone drift', () => {
    // A naive `new Date('2026-01-01')` in a negative-offset zone renders as
    // Dec 31; parsing the components avoids putting a wrong date on a form.
    expect(formatDate('2026-01-01', 'us')).toBe('01/01/2026');
    expect(formatDate('2026-01-01', 'us_dash')).toBe('01-01-2026');
    expect(formatDate('2026-01-01', 'iso')).toBe('2026-01-01');
    expect(formatDate('2026-01-01', 'long')).toBe('January 1, 2026');
  });

  it('counts days to an expiry', () => {
    const from = new Date('2026-08-02T18:00:00Z');
    expect(daysUntil('2026-08-16', from)).toBe(14);
    expect(daysUntil('2026-08-02', from)).toBe(0);
    expect(daysUntil('2026-07-30', from)).toBe(-3);
  });
});

describe('states', () => {
  it('normalizes codes and full names in any casing', () => {
    expect(normalizeState('GA')).toBe('GA');
    expect(normalizeState('ga')).toBe('GA');
    expect(normalizeState('Georgia')).toBe('GA');
    expect(normalizeState('  georgia ')).toBe('GA');
  });

  it('returns null for something that is not a state', () => {
    expect(normalizeState('Ontario')).toBeNull();
  });
});

describe('booleans', () => {
  it('renders each form convention', () => {
    expect(formatBoolean(true)).toBe('Yes');
    expect(formatBoolean(false)).toBe('No');
    expect(formatBoolean(true, 'true_false')).toBe('True');
    expect(formatBoolean(true, 'y_n')).toBe('Y');
    expect(formatBoolean(false, 'one_zero')).toBe('0');
  });
});

describe('fuzzy option matching', () => {
  const options = [
    'Heating & Air Conditioning',
    'Plumbing',
    'Electrical',
    'Landscaping / Grounds',
    'Janitorial',
  ];

  it("matches a trade to a form's own wording", () => {
    const match = bestOptionMatch(options, (o) => o, TRADES.hvac.aliases);
    expect(match?.option).toBe('Heating & Air Conditioning');
  });

  it('matches when the form label is a superset of the alias', () => {
    const match = bestOptionMatch(options, (o) => o, TRADES.landscaping.aliases);
    expect(match?.option).toBe('Landscaping / Grounds');
  });

  it('does not confuse similarly spelled trades', () => {
    // "Plumbing" and "Painting" are 4 edits apart; a naive distance threshold
    // would cross-match them and put a painter in the plumbing pool.
    const match = bestOptionMatch(['Painting'], (o) => o, TRADES.plumbing.aliases);
    expect(match).toBeNull();
  });

  it('returns null when nothing clears the threshold', () => {
    expect(bestOptionMatch(options, (o) => o, TRADES.elevator.aliases)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(bestOptionMatch(options, (o) => o, [])).toBeNull();
  });
});

describe('truncateToLength', () => {
  it('leaves short text alone', () => {
    expect(truncateToLength('short', 100)).toBe('short');
  });

  it('breaks on a word boundary when one is reasonably close', () => {
    const result = truncateToLength('the quick brown fox jumps over', 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith(' ')).toBe(false);
    expect(result).toBe('the quick brown fox');
  });

  it('hard-cuts when no word boundary is near the limit', () => {
    expect(truncateToLength('aaaaaaaaaaaaaaaaaaaaaa', 10)).toHaveLength(10);
  });
});
