import { describe, expect, it } from 'vitest';
import { StubLlmClient } from '@vendorlink/core';
import { harvestPage } from '../src/harvest';
import { interpretPage, quoteAppearsInText } from '../src/interpret';

/**
 * S4's guards.
 *
 * The evidence-quote check is the single most important line of defence in
 * Engine #1: without it a confidently hallucinated address becomes a real
 * email to a real stranger. These tests exist to make removing it loud.
 */

const HTML = `<!doctype html><html><head><title>Vendors | Oakwood</title></head><body>
  <h1>Become an Oakwood Vendor</h1>
  <p>Qualified service providers should send their W-9 and certificate of insurance
     to vendors@oakwood.example for review by our vendor relations team.</p>
  <p>General enquiries: info@oakwood.example</p>
</body></html>`;

const page = harvestPage('https://oakwood.example/vendors', HTML);
const candidates = page.emails.map((e) => e.email);

describe('quote verification', () => {
  it('accepts a quote that appears verbatim', () => {
    expect(quoteAppearsInText('send their W-9 and certificate of insurance', page.text)).toBe(true);
  });

  it('accepts a quote whose whitespace was reflowed', () => {
    expect(quoteAppearsInText('send their W-9   and\n certificate of insurance', page.text)).toBe(
      true,
    );
  });

  it('accepts a quote in different casing', () => {
    expect(quoteAppearsInText('BECOME AN OAKWOOD VENDOR', page.text)).toBe(true);
  });

  it('rejects a quote that is not present', () => {
    expect(quoteAppearsInText('email our procurement department directly', page.text)).toBe(false);
  });

  it('rejects a trivially short quote that would match anything', () => {
    expect(quoteAppearsInText('the', page.text)).toBe(false);
  });
});

describe('interpretPage guards', () => {
  it('accepts a well-formed selection', async () => {
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'vendors@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'send their W-9 and certificate of insurance',
          confidence: 0.95,
        },
      ],
    }));

    const result = await interpretPage({ llm, page, candidates });
    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]?.email).toBe('vendors@oakwood.example');
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects an address that was never on the page', async () => {
    // The failure mode this prevents: a plausible-looking address the model
    // constructed from the domain, which we would then have emailed.
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'vendorrelations@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'send their W-9 and certificate of insurance',
          confidence: 0.99,
        },
      ],
    }));

    const result = await interpretPage({ llm, page, candidates });
    expect(result.selections).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/not in the candidate set/);
  });

  it('rejects a real address justified by a fabricated quote', async () => {
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'info@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'info@ is the preferred channel for all vendor applications',
          confidence: 0.9,
        },
      ],
    }));

    const result = await interpretPage({ llm, page, candidates });
    expect(result.selections).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/evidence quote not found/);
  });

  it('keeps the valid selection and drops the invalid one from the same reply', async () => {
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'vendors@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'Qualified service providers',
          confidence: 0.9,
        },
        {
          email: 'made-up@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'Qualified service providers',
          confidence: 0.9,
        },
      ],
    }));

    const result = await interpretPage({ llm, page, candidates });
    expect(result.selections.map((s) => s.email)).toEqual(['vendors@oakwood.example']);
    expect(result.rejected).toHaveLength(1);
  });

  it('verifies the quote against the whole page, not the truncated prompt', async () => {
    // The prompt is capped at maxTextChars; a legitimate quote sitting past
    // that cut-off must not be judged a hallucination.
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'info@oakwood.example',
          kind: 'general',
          evidence_quote: 'General enquiries',
          confidence: 0.5,
        },
      ],
    }));

    const result = await interpretPage({ llm, page, candidates, maxTextChars: 60 });
    expect(result.selections).toHaveLength(1);
  });

  it('does not call the model when there are no candidates', async () => {
    const llm = new StubLlmClient(() => {
      throw new Error('should not be called');
    });
    const result = await interpretPage({ llm, page, candidates: [] });
    expect(result.called).toBe(false);
    expect(result.selections).toHaveLength(0);
  });

  it('accepts an empty selection list as a valid answer', async () => {
    const llm = new StubLlmClient(() => ({ selections: [] }));
    const result = await interpretPage({ llm, page, candidates });
    expect(result.called).toBe(true);
    expect(result.selections).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects a reply that does not match the schema', async () => {
    const llm = new StubLlmClient(() => ({ selections: [{ email: 'x' }] }));
    await expect(interpretPage({ llm, page, candidates })).rejects.toThrow();
  });

  it('normalizes casing before checking the candidate set', async () => {
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'VENDORS@OAKWOOD.EXAMPLE',
          kind: 'vendor_onboarding',
          evidence_quote: 'Qualified service providers',
          confidence: 0.9,
        },
      ],
    }));
    const result = await interpretPage({ llm, page, candidates });
    expect(result.selections[0]?.email).toBe('vendors@oakwood.example');
  });

  it('sends only harvested candidates to the model', async () => {
    const llm = new StubLlmClient(() => ({ selections: [] }));
    await interpretPage({ llm, page, candidates });
    const prompt = llm.calls[0]?.user ?? '';
    expect(prompt).toContain('vendors@oakwood.example');
    expect(prompt).toContain('CANDIDATES');
  });
});
