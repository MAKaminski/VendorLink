import { describe, expect, it } from 'vitest';
import { MapDnsResolver, MapHttpFetcher, DisabledLlmClient } from '@vendorlink/core';
import { resolveOnboardingContacts, chooseOutcome } from '../src/pipeline';
import { SEND_THRESHOLD } from '../src/scoring';
import { GOLDEN_CASES, type GoldenCase } from './golden/cases';

/**
 * The P1 gate.
 *
 * Two thresholds, and the second matters more than the first:
 *
 *   1. Top-1 accuracy ≥ 90%.
 *   2. A wrong answer never scores above 0.6.
 *
 * (2) is what makes the engine safe to run unattended. Being wrong is
 * survivable when we know we are unsure, because anything under the send
 * threshold routes to review instead of putting a message in someone's inbox.
 *
 * The run is deterministic: the LLM is *disabled*, so this measures the
 * deterministic rubric alone. If S4 were allowed to contribute, the gate would
 * be measuring the model rather than the scoring it is meant to protect.
 */

const TARGET_TOP1_ACCURACY = 0.9;
const MAX_WRONG_CONFIDENCE = 0.6;

/** Every domain in the golden set resolves MX; that is not what is under test. */
const dns = new MapDnsResolver(
  new Map(
    [
      ...new Set(
        GOLDEN_CASES.flatMap((c) =>
          [c.expected, ...(c.mustNotChoose ?? [])]
            .filter((e): e is string => Boolean(e))
            .map((e) => e.split('@')[1] as string),
        ),
      ),
      'gmail.com',
    ].map((domain) => [domain, [{ exchange: `mx.${domain}`, priority: 10 }]]),
  ),
);

async function runCase(testCase: GoldenCase) {
  const origin = new URL(testCase.url).origin;
  const pages = new Map<string, { body: string; status?: number }>([
    [testCase.url, { body: testCase.html }],
    // Homepage returns the same document when the case URL is not the root, so
    // discovery always has an entry point.
    [origin, { body: testCase.url === `${origin}/` ? testCase.html : minimalHome(testCase) }],
    [`${origin}/robots.txt`, { body: 'User-agent: *\nAllow: /\n', status: 200 }],
  ]);

  const fetcher = new MapHttpFetcher(pages);

  const result = await resolveOnboardingContacts(
    {
      pmCompanyId: testCase.id,
      website: origin,
      ...(testCase.trade ? { trade: testCase.trade } : {}),
      ...(testCase.market ? { market: testCase.market } : {}),
      cache: 'bypass',
    },
    { fetcher, dns, llm: new DisabledLlmClient() },
    { useLlm: false },
  );

  return { result, outcome: chooseOutcome(result) };
}

/** A homepage that links to the case page, so S2 can reach it. */
function minimalHome(testCase: GoldenCase): string {
  const path = new URL(testCase.url).pathname;
  return `<!doctype html><html><head><title>Home</title></head><body>
    <h1>Welcome</h1>
    <nav><a href="${path}">Vendors</a></nav>
    </body></html>`;
}

describe('golden set', () => {
  const results: Array<{
    testCase: GoldenCase;
    top1: string | null;
    top1Confidence: number;
    correct: boolean;
  }> = [];

  it('resolves every case without throwing', async () => {
    for (const testCase of GOLDEN_CASES) {
      const { result } = await runCase(testCase);
      const top = result.contacts[0] ?? null;
      const top1 = top?.email ?? null;

      results.push({
        testCase,
        top1,
        top1Confidence: top?.confidence ?? 0,
        // A null expectation is satisfied by finding nothing *sendable*, not
        // by finding literally nothing: a scored-but-weak candidate is fine
        // because it will not be sent.
        correct:
          testCase.expected === null
            ? top === null || top.score < SEND_THRESHOLD
            : top1 === testCase.expected,
      });
    }
    expect(results).toHaveLength(GOLDEN_CASES.length);
  });

  it(`achieves top-1 accuracy of at least ${TARGET_TOP1_ACCURACY * 100}%`, () => {
    const correct = results.filter((r) => r.correct);
    const accuracy = correct.length / results.length;

    if (accuracy < TARGET_TOP1_ACCURACY) {
      const failures = results
        .filter((r) => !r.correct)
        .map(
          (r) =>
            `  ${r.testCase.id}: expected ${r.testCase.expected ?? '(none sendable)'}, ` +
            `got ${r.top1 ?? '(none)'} @ ${r.top1Confidence.toFixed(2)}`,
        )
        .join('\n');
      throw new Error(
        `top-1 accuracy ${(accuracy * 100).toFixed(1)}% is below the ${TARGET_TOP1_ACCURACY * 100}% gate:\n${failures}`,
      );
    }

    expect(accuracy).toBeGreaterThanOrEqual(TARGET_TOP1_ACCURACY);
  });

  it(`never scores a wrong answer above ${MAX_WRONG_CONFIDENCE}`, () => {
    const overconfident = results
      .filter((r) => !r.correct && r.top1Confidence > MAX_WRONG_CONFIDENCE)
      .map(
        (r) =>
          `  ${r.testCase.id}: wrong answer ${r.top1} at confidence ${r.top1Confidence.toFixed(2)} ` +
          `(expected ${r.testCase.expected ?? 'none'})`,
      );

    expect(overconfident, `overconfident wrong answers:\n${overconfident.join('\n')}`).toEqual([]);
  });

  it('never chooses an address on a case’s forbidden list', () => {
    const violations = results
      .filter((r) => r.top1 && r.testCase.mustNotChoose?.includes(r.top1))
      .map((r) => `  ${r.testCase.id}: chose forbidden ${r.top1}`);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('reports the accuracy achieved', () => {
    const accuracy = results.filter((r) => r.correct).length / results.length;
    // eslint-disable-next-line no-console
    console.warn(
      `\n  golden set: ${results.filter((r) => r.correct).length}/${results.length} ` +
        `(${(accuracy * 100).toFixed(1)}%) top-1 accuracy\n`,
    );
    expect(accuracy).toBeGreaterThan(0);
  });
});

describe('fallback ladder', () => {
  it('sends when the best contact clears the threshold', async () => {
    const { outcome } = await runCase(GOLDEN_CASES[0] as GoldenCase);
    expect(outcome.kind).toBe('send');
  });

  it('routes to a form when no address is usable but a vendor form exists', async () => {
    const formOnly = GOLDEN_CASES.find((c) => c.id === 'vendor-word-without-inbox');
    const { outcome } = await runCase(formOnly as GoldenCase);
    expect(outcome.kind).toBe('route_to_form');
  });

  it('parks for attention when nothing at all is found, and shows the trace', async () => {
    const nothing = GOLDEN_CASES.find((c) => c.id === 'no-contact-at-all');
    const { outcome } = await runCase(nothing as GoldenCase);
    expect(outcome.kind).toBe('needs_attention');
    if (outcome.kind === 'needs_attention') {
      // The operator has to be able to see what we actually checked.
      expect(outcome.trace.fetches.length).toBeGreaterThan(0);
      expect(outcome.reason).toMatch(/No vendor contact found|below the/);
    }
  });
});
