import { describe, expect, it } from 'vitest';
import { renderPacketEmail, renderSubject, type PacketContext } from '../src/template';
import { completeProfile } from './fixtures/profile';

const context = (over: Partial<PacketContext> = {}): PacketContext => ({
  profile: completeProfile(),
  pmCompanyName: 'Oakwood Residential',
  senderPostalAddress: '1180 Marietta St NW, Suite 210, Atlanta, GA 30318',
  optOutUrl: 'https://vendorlink.app/opt-out/abc123',
  ...over,
});

describe('subject line', () => {
  it('follows the §5.4 format', () => {
    const subject = renderSubject(completeProfile(), 'Oakwood Residential');
    expect(subject).toMatch(/^Vendor application — Peachtree Grounds & Landscape LLC/);
    expect(subject).toContain('Landscaping & Grounds');
    expect(subject).toContain('45 miles around Atlanta');
  });
});

describe('packet body', () => {
  const rendered = renderPacketEmail(context());

  it('states insurance limits as plain numbers, not cents', () => {
    // A PM coordinator checks limits against a threshold; "10000000" would be
    // read as ten million and the vendor rejected for the wrong reason.
    expect(rendered.text).toContain('$1,000,000 each occurrence');
    expect(rendered.text).toContain('$2,000,000 aggregate');
    expect(rendered.text).not.toMatch(/100000000/);
  });

  it('lists licence numbers with their issuing state', () => {
    expect(rendered.text).toContain('GA-LC-88421');
    expect(rendered.text).toContain('(GA');
  });

  it('states trades and service area', () => {
    expect(rendered.text).toContain('Landscaping & Grounds');
    expect(rendered.text).toContain('45 miles around Atlanta');
  });

  it('states after-hours availability and the response-time commitment', () => {
    expect(rendered.text).toMatch(/respond to dispatch within 4 hours/i);
    expect(rendered.text).toMatch(/after-hours and emergency calls/i);
  });

  it('says so plainly when after-hours is not offered', () => {
    const noAfterHours = renderPacketEmail(
      context({ profile: completeProfile({ offers_after_hours: false }) }),
    );
    expect(noAfterHours.text).toMatch(/do not currently offer after-hours/i);
  });

  it('confirms the W-9', () => {
    expect(rendered.text).toMatch(/W-9/);
    expect(rendered.text).toContain('01/15/2026');
  });

  it('includes the portal one-liner from §5.4', () => {
    expect(rendered.text).toMatch(/if you use a vendor portal/i);
  });

  it('signs off from the primary contact', () => {
    expect(rendered.text).toContain('Dana Whitfield');
    expect(rendered.text).toContain('404-555-0142');
    expect(rendered.text).toContain('dana@peachtreegrounds.example');
  });

  it('addresses the PM company by name', () => {
    expect(rendered.text).toContain('Oakwood Residential');
  });
});

describe('CAN-SPAM compliance', () => {
  const rendered = renderPacketEmail(context());

  it('carries a physical mailing address', () => {
    expect(rendered.text).toContain('1180 Marietta St NW, Suite 210, Atlanta, GA 30318');
    expect(rendered.html).toContain('1180 Marietta St NW');
  });

  it('carries a plain-English opt-out in both parts', () => {
    expect(rendered.text).toMatch(/prefer not to receive/i);
    expect(rendered.text).toContain('https://vendorlink.app/opt-out/abc123');
    expect(rendered.html).toContain('unsubscribe');
    expect(rendered.html).toContain('https://vendorlink.app/opt-out/abc123');
  });
});

describe('overflow links', () => {
  it('lists documents that did not fit as expiring links', () => {
    const rendered = renderPacketEmail(
      context({
        overflowLinks: [
          { label: 'Pricebook 2026', url: 'https://storage.example/signed/pricebook' },
        ],
      }),
    );
    expect(rendered.text).toMatch(/links expire in 7 days/i);
    expect(rendered.text).toContain('https://storage.example/signed/pricebook');
    expect(rendered.html).toContain('Pricebook 2026');
  });

  it('omits the section entirely when everything was attached', () => {
    expect(renderPacketEmail(context()).text).not.toMatch(/links expire/i);
  });
});

describe('html safety', () => {
  it('escapes markup in profile values', () => {
    // Company names are user input and end up in a document the recipient's
    // client renders.
    const rendered = renderPacketEmail(
      context({
        profile: completeProfile({ legal_name: 'Ace <script>alert(1)</script> LLC' }),
      }),
    );
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('escapes quotes in the opt-out URL attribute', () => {
    const rendered = renderPacketEmail(context({ optOutUrl: 'https://x.example/"onload="evil()' }));
    expect(rendered.html).not.toContain('"onload="evil()');
  });

  it('includes the tracking pixel only when one is supplied', () => {
    expect(renderPacketEmail(context()).html).not.toContain('width="1"');
    expect(
      renderPacketEmail(context({ trackingPixelUrl: 'https://t.example/p.gif' })).html,
    ).toContain('width="1"');
  });
});

describe('sparse profiles', () => {
  it('renders without throwing when almost nothing is filled in', () => {
    const sparse = completeProfile({
      insurance: [],
      licenses: [],
      trades: [],
      service_areas: [],
      w9_signed_date: null,
      response_time_hours: null,
      primary_contact_title: null,
      website: null,
    });
    const rendered = renderPacketEmail(context({ profile: sparse }));
    expect(rendered.subject).toContain('Peachtree Grounds');
    expect(rendered.text.length).toBeGreaterThan(100);
    // No empty bullet points left behind by missing sections.
    expect(rendered.text).not.toMatch(/^\s*-\s*$/m);
  });
});
