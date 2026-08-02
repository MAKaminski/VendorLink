import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_SITES } from '../../fixtures/sites/index';
import { server as fixtureServer } from '../../fixtures/src/server';
import { submitRun } from '../src/submit-run';
import type { MaterializedDocument } from '../src/fill-form';
import { completeProfile } from './fixtures/profile';

/**
 * The P3 gate.
 *
 *   Auto-submits 8 of 12 fixture sites unattended; the other 4 park correctly
 *   with a resumable session.
 *
 * Both halves matter. A run that submits everything is not passing this test —
 * it is failing the CAPTCHA and paywall bright lines. The four that park are
 * the confidence gate doing its job.
 */

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

let server: Server;
let docsDir: string;
let documents: MaterializedDocument[];

const SUBMIT_SITES = FIXTURE_SITES.filter((s) => s.expectation === 'auto_submit');
const PARK_SITES = FIXTURE_SITES.filter((s) => s.expectation === 'parks_for_attention');

beforeAll(async () => {
  server = fixtureServer.listen(PORT);
  await new Promise((resolve) => server.once('listening', resolve));

  docsDir = await mkdtemp(join(tmpdir(), 'vl-p3-docs-'));
  documents = [];
  for (const kind of ['W9', 'COI', 'PRICEBOOK'] as const) {
    const path = join(docsDir, `${kind.toLowerCase()}.pdf`);
    await writeFile(path, `%PDF-1.7\n${kind}\n`);
    documents.push({ kind, path, filename: `${kind.toLowerCase()}.pdf` });
  }
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(docsDir, { recursive: true, force: true });
});

async function clearSubmissions() {
  await fetch(`${BASE}/__submissions`, { method: 'DELETE' });
}

async function readSubmissions() {
  return (await fetch(`${BASE}/__submissions`).then((r) => r.json())) as Array<{
    site: string;
    fields: Record<string, string>;
    files: string[];
  }>;
}

/** The page a run starts from, per fixture. */
function entryUrl(slug: string): string {
  if (slug === 'nav-link-form') return `${BASE}/${slug}/partners/vendor-application`;
  if (slug === 'login-portal' || slug === 'pdf-packet') return `${BASE}/${slug}/vendors`;
  return `${BASE}/${slug}/vendors`;
}

async function run(slug: string, over: Partial<Parameters<typeof submitRun>[0]> = {}) {
  const site = FIXTURE_SITES.find((s) => s.slug === slug)!;
  return submitRun({
    url: entryUrl(slug),
    context: { profile: completeProfile() },
    documents,
    requireFirstSubmissionApproval: false,
    schemaSuccessCount: 10,
    // The login portal's channel facts come from discovery; the live page
    // cannot tell us it needs an account.
    ...(site.slug === 'login-portal'
      ? { channel: { requiresAccount: true, requiresPayment: true } }
      : {}),
    ...over,
  });
}

describe('gate: 8 sites auto-submit unattended', () => {
  it('has exactly 8 auto-submit fixtures and 4 parking fixtures', () => {
    expect(SUBMIT_SITES).toHaveLength(8);
    expect(PARK_SITES).toHaveLength(4);
  });

  for (const site of SUBMIT_SITES) {
    it(`submits ${site.slug} without a human`, async () => {
      await clearSubmissions();
      const result = await run(site.slug);

      expect(result.outcome.kind, `${site.slug}: ${JSON.stringify(result.outcome)}`).toBe(
        'submitted',
      );
      expect(result.gate?.proceed).toBe(true);
      expect(result.gate?.confidence).toBeGreaterThanOrEqual(0.85);

      const submissions = await readSubmissions();
      expect(submissions.length, `${site.slug} posted nothing`).toBeGreaterThan(0);
    }, 90_000);
  }
});

describe('gate: 4 sites park for a human', () => {
  for (const site of PARK_SITES) {
    it(`parks ${site.slug} instead of submitting`, async () => {
      await clearSubmissions();
      const result = await run(site.slug);

      expect(result.outcome.kind, `${site.slug}: ${JSON.stringify(result.outcome)}`).toBe(
        'needs_attention',
      );

      // Nothing was posted — parking means parking.
      expect(await readSubmissions()).toHaveLength(0);
    }, 90_000);
  }

  it('parks the CAPTCHA site for the right reason', async () => {
    const result = await run('recaptcha-wall');
    expect(result.outcome).toMatchObject({
      kind: 'needs_attention',
      reason: 'captcha_required',
    });
  }, 90_000);

  it('parks the paywalled portal for the right reason', async () => {
    const result = await run('login-portal');
    expect(result.outcome).toMatchObject({ kind: 'needs_attention' });
    if (result.outcome.kind === 'needs_attention') {
      expect(['account_required', 'payment_required', 'form_not_found']).toContain(
        result.outcome.reason,
      );
    }
  }, 90_000);

  it('parks on an unmapped required field and names it', async () => {
    const result = await run('unknown-required-field');
    expect(result.outcome).toMatchObject({
      kind: 'needs_attention',
      reason: 'unmapped_required_field',
    });
    expect(result.gate?.unmappedRequired.join(' ')).toMatch(/Sponsor/i);
  }, 90_000);
});

describe('a parked run arrives filled, so the operator has 30 seconds of work', () => {
  it('fills everything it could before parking on the CAPTCHA', async () => {
    const result = await run('recaptcha-wall');
    // The point of the assisted lane: the form is 95% complete when the
    // operator opens it.
    expect(result.writes.length).toBeGreaterThanOrEqual(8);
    expect(result.writes.some((w) => w.sourceField === 'profile.legal_name')).toBe(true);
  }, 90_000);

  it('fills the mappable fields before parking on the unknown one', async () => {
    const result = await run('unknown-required-field');
    expect(result.writes.length).toBeGreaterThanOrEqual(8);
  }, 90_000);
});

describe('what was actually submitted', () => {
  it('posts the profile values, correctly transformed', async () => {
    await clearSubmissions();
    await run('plain-form');
    const [submission] = await readSubmissions();

    expect(submission?.fields['company']).toBe('Peachtree Grounds & Landscape LLC');
    expect(submission?.fields['contact']).toBe('Dana Whitfield');
    expect(submission?.fields['email']).toBe('dana@peachtreegrounds.example');
    expect(submission?.fields['phone']).toBe('404-555-0142');
    expect(submission?.fields['city']).toBe('Atlanta');
    // The select matched the form's own option vocabulary.
    expect(submission?.fields['state']).toBe('GA');
    expect(submission?.fields['trade']).toBe('landscaping');
    // Cents rendered as the form expects, not as an integer.
    expect(submission?.fields['gl']).toBe('1000000.00');
  }, 90_000);

  it('uploads the W-9 and COI', async () => {
    await clearSubmissions();
    await run('plain-form');
    const [submission] = await readSubmissions();
    expect(submission?.files).toContain('w9.pdf');
    expect(submission?.files).toContain('coi.pdf');
  }, 90_000);

  it('records a field write for every value it typed', async () => {
    const result = await run('plain-form');
    const byField = new Map(result.writes.map((w) => [w.sourceField, w]));
    expect(byField.get('profile.legal_name')?.valueWritten).toBe(
      'Peachtree Grounds & Landscape LLC',
    );
    expect(byField.get('profile.primary_contact_phone')?.confidence).toBe(1);
  }, 90_000);

  it('redacts the EIN in the audit record while still submitting it', async () => {
    await clearSubmissions();
    const result = await run('plain-form');

    // The real value reached the form...
    const [submission] = await readSubmissions();
    expect(submission?.fields['ein']).toBe('58-1234567');

    // ...but the audit row carries a marker, never the number.
    const einWrite = result.writes.find((w) => w.sourceField === 'profile.ein');
    expect(einWrite?.isRedacted).toBe(true);
    expect(einWrite?.valueWritten).not.toContain('58-1234567');
    expect(einWrite?.valueWritten).toMatch(/redacted/);
  }, 90_000);
});

describe('confirmation capture', () => {
  it('captures the confirmation number when the page shows one', async () => {
    const result = await run('plain-form');
    expect(result.outcome.kind).toBe('submitted');
    if (result.outcome.kind === 'submitted') {
      expect(result.outcome.confirmation?.method).toBe('confirmation_number');
      expect(result.outcome.confirmation?.value).toBe('VL-2026-004821');
    }
  }, 90_000);
});

describe('first-submission approval', () => {
  it('holds a brand new schema when the tenant asked for review', async () => {
    await clearSubmissions();
    const result = await run('plain-form', {
      requireFirstSubmissionApproval: true,
      schemaSuccessCount: 0,
    });
    expect(result.outcome).toMatchObject({
      kind: 'needs_attention',
      reason: 'first_submission_approval',
    });
    expect(await readSubmissions()).toHaveLength(0);
  }, 90_000);
});
