/**
 * Golden set — 50 hand-labeled pages.
 *
 * §12's P1 gate: top-1 accuracy ≥ 90%, and a wrong answer must never score
 * above 0.6. The second half of that is the one that matters operationally —
 * being wrong is survivable if we know we are unsure, because a low-confidence
 * resolution routes to review instead of sending.
 *
 * Cases are written from the shapes that actually appear on PM sites:
 * dedicated vendor pages, contact pages where the vendor inbox sits among five
 * others, obfuscated addresses, footer-only addresses, careers pages that a
 * naive matcher would happily mail, and sites with no vendor contact at all.
 *
 * `expected: null` means "there is no correct answer here" — the engine should
 * find nothing above the send threshold. Those cases are as important as the
 * positive ones: a resolver that always produces an address is a spam cannon.
 */

export interface GoldenCase {
  readonly id: string;
  readonly description: string;
  readonly url: string;
  readonly html: string;
  /** The address a careful human would pick, or null if there is none. */
  readonly expected: string | null;
  /** Addresses that must never be chosen. */
  readonly mustNotChoose?: readonly string[];
  readonly trade?: 'hvac' | 'landscaping' | 'plumbing' | 'janitorial';
  readonly market?: string;
}

const page = (opts: {
  title: string;
  h1: string;
  body: string;
  footer?: string;
}) => `<!doctype html><html><head><title>${opts.title}</title></head><body>
<h1>${opts.h1}</h1>
${opts.body}
${opts.footer ? `<footer>${opts.footer}</footer>` : ''}
</body></html>`;

export const GOLDEN_CASES: readonly GoldenCase[] = [
  // ---- 1-10: dedicated vendor pages, the easy majority --------------------
  {
    id: 'vendor-page-mailto',
    description: 'Dedicated vendor page with a mailto link',
    url: 'https://oakwood.example/vendors',
    expected: 'vendors@oakwood.example',
    html: page({
      title: 'Become a Vendor | Oakwood Residential',
      h1: 'Become an Oakwood Vendor',
      body: `<p>We are always looking for qualified service providers. Send your W-9,
        certificate of insurance and pricebook to
        <a href="mailto:vendors@oakwood.example">vendors@oakwood.example</a>.</p>`,
      footer: '<a href="mailto:info@oakwood.example">info@oakwood.example</a>',
    }),
    mustNotChoose: ['info@oakwood.example'],
  },
  {
    id: 'vendor-relations-inbox',
    description: 'vendorrelations@ on a supplier page',
    url: 'https://southline.example/suppliers',
    expected: 'vendorrelations@southline.example',
    html: page({
      title: 'Suppliers | Southline Communities',
      h1: 'Supplier Information',
      body: `<p>Prospective suppliers should contact
        <a href="mailto:vendorrelations@southline.example">our vendor relations team</a>.</p>
        <p>Media inquiries: press@southline.example</p>`,
    }),
    mustNotChoose: ['press@southline.example'],
  },
  {
    id: 'vendor-onboarding-inbox',
    description: 'vendoronboarding@ alongside AP',
    url: 'https://trinity.example/vendor-application',
    expected: 'vendoronboarding@trinity.example',
    html: page({
      title: 'Vendor Application',
      h1: 'Vendor Application',
      body: `<p>New vendor packets: vendoronboarding@trinity.example</p>
        <p>Invoices and payment questions: ap@trinity.example</p>`,
    }),
    mustNotChoose: ['ap@trinity.example'],
  },
  {
    id: 'new-vendor-inbox',
    description: 'newvendor@ hyphenated variant',
    url: 'https://cascade.example/become-a-vendor',
    expected: 'new-vendor@cascade.example',
    html: page({
      title: 'Become a Vendor',
      h1: 'Join Our Vendor Network',
      body: `<p>Email <a href="mailto:new-vendor@cascade.example">new-vendor@cascade.example</a>
        with your credentials.</p>`,
    }),
  },
  {
    id: 'vendor-compliance-inbox',
    description: 'vendorcompliance@ with insurance requirements',
    url: 'https://milehigh.example/vendors',
    expected: 'vendorcompliance@milehigh.example',
    html: page({
      title: 'Vendor Requirements',
      h1: 'Vendor Requirements',
      body: `<p>All vendors must carry $2,000,000 general liability aggregate.
        Submit certificates to vendorcompliance@milehigh.example.</p>
        <p>Leasing: leasing@milehigh.example</p>`,
    }),
    mustNotChoose: ['leasing@milehigh.example'],
  },
  {
    id: 'contractors-inbox',
    description: 'contractors@ tier 2',
    url: 'https://frontrange.example/contractors',
    expected: 'contractors@frontrange.example',
    html: page({
      title: 'Contractors',
      h1: 'Information for Contractors',
      body: `<p>Reach our contractor desk at contractors@frontrange.example.</p>`,
    }),
  },
  {
    id: 'suppliers-inbox',
    description: 'suppliers@ tier 2',
    url: 'https://greatlakes.example/suppliers',
    expected: 'suppliers@greatlakes.example',
    html: page({
      title: 'Suppliers',
      h1: 'Supplier Registration',
      body: `<p>Register at suppliers@greatlakes.example.</p>
        <p>Careers: careers@greatlakes.example</p>`,
    }),
    mustNotChoose: ['careers@greatlakes.example'],
  },
  {
    id: 'vendor-page-with-form-and-email',
    description: 'Vendor page offering both a form and an inbox',
    url: 'https://lonestar.example/vendor-registration',
    expected: 'vendors@lonestar.example',
    html: page({
      title: 'Vendor Registration',
      h1: 'Vendor Registration',
      body: `<form action="/vendor-apply" method="post">
          <input name="company"><input name="email"><input type="file" name="coi">
          <input name="trade"><input name="phone"><input name="ein">
          <input type="submit">
        </form>
        <p>Prefer email? Send everything to vendors@lonestar.example.</p>`,
    }),
  },
  {
    id: 'vendor-management-inbox',
    description: 'vendormanagement@ variant',
    url: 'https://empirestate.example/vendors',
    expected: 'vendormanagement@empirestate.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Management',
      body: `<p>Contact vendormanagement@empirestate.example.</p>`,
    }),
  },
  {
    id: 'vendor-services-inbox',
    description: 'vendor.services@ dotted variant',
    url: 'https://baystate.example/work-with-us',
    expected: 'vendor.services@baystate.example',
    html: page({
      title: 'Work With Us',
      h1: 'Work With Us — Vendors',
      body: `<p>Our vendor services team: vendor.services@baystate.example</p>`,
    }),
  },

  // ---- 11-18: contact pages where the right inbox is among many -----------
  {
    id: 'contact-page-many-inboxes',
    description: 'Contact page listing six departments',
    url: 'https://peachtree.example/contact',
    expected: 'vendors@peachtree.example',
    html: page({
      title: 'Contact Us',
      h1: 'Contact Us',
      body: `<ul>
        <li>General: info@peachtree.example</li>
        <li>Leasing: leasing@peachtree.example</li>
        <li>Maintenance requests: maintenance@peachtree.example</li>
        <li>Vendors and suppliers: vendors@peachtree.example</li>
        <li>Accounts payable: ap@peachtree.example</li>
        <li>Careers: careers@peachtree.example</li>
      </ul>`,
    }),
    mustNotChoose: [
      'info@peachtree.example', 'leasing@peachtree.example',
      'careers@peachtree.example', 'ap@peachtree.example',
    ],
  },
  {
    id: 'contact-page-procurement-only',
    description: 'No vendor inbox, but procurement exists',
    url: 'https://queencity.example/contact',
    expected: 'procurement@queencity.example',
    html: page({
      title: 'Contact',
      h1: 'Contact Us',
      body: `<ul>
        <li>info@queencity.example</li>
        <li>procurement@queencity.example</li>
        <li>sales@queencity.example</li>
      </ul>`,
    }),
    mustNotChoose: ['sales@queencity.example'],
  },
  {
    id: 'contact-page-maintenance-only',
    description: 'Only maintenance@ is plausible',
    url: 'https://rosecity.example/contact',
    expected: 'maintenance@rosecity.example',
    html: page({
      title: 'Contact',
      h1: 'Get In Touch',
      body: `<p>Maintenance: maintenance@rosecity.example</p>
        <p>Leasing: leasing@rosecity.example</p>
        <p>Careers: jobs@rosecity.example</p>`,
    }),
    mustNotChoose: ['leasing@rosecity.example', 'jobs@rosecity.example'],
  },
  {
    id: 'contact-page-purchasing',
    description: 'purchasing@ tier 3',
    url: 'https://gateway.example/contact',
    expected: 'purchasing@gateway.example',
    html: page({
      title: 'Contact',
      h1: 'Contact',
      body: `<p>purchasing@gateway.example</p><p>marketing@gateway.example</p>`,
    }),
    mustNotChoose: ['marketing@gateway.example'],
  },
  {
    id: 'contact-page-workorders',
    description: 'workorders@ tier 4',
    url: 'https://bluffcity.example/maintenance',
    expected: 'workorders@bluffcity.example',
    html: page({
      title: 'Maintenance',
      h1: 'Maintenance',
      body: `<p>Submit work orders to workorders@bluffcity.example.</p>`,
    }),
  },
  {
    id: 'named-vendor-manager',
    description: 'Named human whose title is Vendor Relations Manager',
    url: 'https://twincities.example/about/contact',
    expected: 'mwebb@twincities.example',
    html: page({
      title: 'Our Team',
      h1: 'Contact Our Team',
      body: `<p>Marcus Webb, Director of Vendor Relations — mwebb@twincities.example</p>
        <p>Alice Chen, Leasing Manager — achen@twincities.example</p>`,
    }),
    mustNotChoose: ['achen@twincities.example'],
  },
  {
    id: 'vendor-inbox-beats-named-human',
    description: 'A role inbox outranks a named person on the same page',
    url: 'https://northstar.example/vendors',
    expected: 'vendors@northstar.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Information',
      body: `<p>Marcus Webb, Vendor Coordinator — mwebb@northstar.example</p>
        <p>Preferred: vendors@northstar.example</p>`,
    }),
  },
  {
    id: 'ap-only-fallback',
    description: 'Only accounts payable is listed',
    url: 'https://motorcity.example/contact',
    expected: 'accountspayable@motorcity.example',
    html: page({
      title: 'Contact',
      h1: 'Contact',
      body: `<p>accountspayable@motorcity.example</p>
        <p>press@motorcity.example</p>`,
    }),
    mustNotChoose: ['press@motorcity.example'],
  },

  // ---- 19-26: obfuscation ------------------------------------------------
  {
    id: 'obfuscated-bracket-at',
    description: 'vendors [at] domain [dot] com',
    url: 'https://buckhead.example/vendors',
    expected: 'vendors@buckhead.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Inquiries',
      body: `<p>Write to vendors [at] buckhead [dot] example</p>`,
    }),
  },
  {
    id: 'obfuscated-paren-at',
    description: 'vendors (at) domain (dot) com',
    url: 'https://alamo.example/vendors',
    expected: 'vendors@alamo.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Inquiries',
      body: `<p>vendors (at) alamo (dot) example</p>`,
    }),
  },
  {
    id: 'obfuscated-entities',
    description: 'HTML entity encoded address',
    url: 'https://pugetsound.example/vendors',
    expected: 'vendors@pugetsound.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Information',
      body: `<p>vendors&#64;pugetsound&#46;example</p>`,
    }),
  },
  {
    id: 'obfuscated-js-vars',
    description: 'Address assembled from JavaScript variables',
    url: 'https://willamette.example/vendors',
    expected: 'vendors@willamette.example',
    html: `<!doctype html><html><head><title>Vendors</title></head><body>
      <h1>Vendor Information</h1>
      <script>
        var u = 'vendors'; var d = 'willamette.example';
        document.write('<a href="mailto:' + u + '@' + d + '">Email us</a>');
      </script></body></html>`,
  },
  {
    id: 'obfuscated-js-literals',
    description: 'Address concatenated from string literals',
    url: 'https://goldengate.example/vendors',
    expected: 'vendors@goldengate.example',
    html: `<!doctype html><html><head><title>Vendors</title></head><body>
      <h1>Vendor Information</h1>
      <script>document.write('vendors' + '@' + 'goldengate.example');</script>
      </body></html>`,
  },
  {
    id: 'obfuscated-dashes',
    description: 'vendors-at-domain-dot-com',
    url: 'https://bayarea.example/vendors',
    expected: 'vendors@bayarea.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendors',
      body: `<p>vendors-at-bayarea-dot-example</p>`,
    }),
  },
  {
    id: 'obfuscated-among-plain',
    description: 'Obfuscated vendor inbox beside a plain general inbox',
    url: 'https://sunsetblvd.example/vendors',
    expected: 'vendors@sunsetblvd.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Applications',
      body: `<p>General: info@sunsetblvd.example</p>
        <p>Vendors: vendors [at] sunsetblvd [dot] example</p>`,
    }),
    mustNotChoose: ['info@sunsetblvd.example'],
  },
  {
    id: 'obfuscated-spaced-words',
    description: 'vendors at domain dot com in prose',
    url: 'https://pacificcoast.example/vendors',
    expected: 'vendors@pacificcoast.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Information',
      body: `<p>Please email vendors at pacificcoast dot example with your packet.</p>`,
    }),
  },

  // ---- 27-32: trade and market specific inboxes --------------------------
  {
    id: 'trade-inbox-hvac',
    description: 'Trade-specific inboxes; HVAC vendor should get hvac@',
    url: 'https://desertridge.example/vendors',
    expected: 'hvac@desertridge.example',
    trade: 'hvac',
    html: page({
      title: 'Trade Partners',
      h1: 'Vendor Trade Contacts',
      body: `<ul>
        <li>HVAC: hvac@desertridge.example</li>
        <li>Landscaping: landscaping@desertridge.example</li>
        <li>Plumbing: plumbing@desertridge.example</li>
      </ul>`,
    }),
  },
  {
    id: 'trade-inbox-landscaping',
    description: 'Same page, landscaping vendor should get landscaping@',
    url: 'https://desertridge.example/vendors',
    expected: 'landscaping@desertridge.example',
    trade: 'landscaping',
    html: page({
      title: 'Trade Partners',
      h1: 'Vendor Trade Contacts',
      body: `<ul>
        <li>HVAC: hvac@desertridge.example</li>
        <li>Landscaping: landscaping@desertridge.example</li>
        <li>Plumbing: plumbing@desertridge.example</li>
      </ul>`,
    }),
  },
  {
    id: 'trade-inbox-plumbing',
    description: 'Same page, plumbing vendor should get plumbing@',
    url: 'https://desertridge.example/vendors',
    expected: 'plumbing@desertridge.example',
    trade: 'plumbing',
    html: page({
      title: 'Trade Partners',
      h1: 'Vendor Trade Contacts',
      body: `<ul>
        <li>HVAC: hvac@desertridge.example</li>
        <li>Landscaping: landscaping@desertridge.example</li>
        <li>Plumbing: plumbing@desertridge.example</li>
      </ul>`,
    }),
  },
  {
    id: 'regional-inbox-atlanta',
    description: 'Regional inboxes; Atlanta vendor should get atlantavendors@',
    url: 'https://oakwood.example/vendors',
    expected: 'atlantavendors@oakwood.example',
    market: 'Atlanta',
    html: page({
      title: 'Regional Vendor Contacts',
      h1: 'Vendor Contacts by Region',
      body: `<ul>
        <li>Atlanta: atlantavendors@oakwood.example</li>
        <li>Dallas: dallasvendors@oakwood.example</li>
      </ul>`,
    }),
  },
  {
    id: 'regional-inbox-dallas',
    description: 'Same page, Dallas vendor should get dallasvendors@',
    url: 'https://oakwood.example/vendors',
    expected: 'dallasvendors@oakwood.example',
    market: 'Dallas',
    html: page({
      title: 'Regional Vendor Contacts',
      h1: 'Vendor Contacts by Region',
      body: `<ul>
        <li>Atlanta: atlantavendors@oakwood.example</li>
        <li>Dallas: dallasvendors@oakwood.example</li>
      </ul>`,
    }),
  },
  {
    id: 'trade-inbox-no-match-falls-back',
    description: 'Trade inboxes exist but not for this trade; generic wins',
    url: 'https://camelback.example/vendors',
    expected: 'vendors@camelback.example',
    trade: 'janitorial',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Contacts',
      body: `<ul>
        <li>HVAC: hvac@camelback.example</li>
        <li>All other trades: vendors@camelback.example</li>
      </ul>`,
    }),
  },

  // ---- 33-40: traps a naive matcher falls into ---------------------------
  {
    id: 'careers-page-trap',
    description: 'Careers page mentioning "vendors" in prose',
    url: 'https://lakeshore.example/careers',
    expected: null,
    html: page({
      title: 'Careers',
      h1: 'Join Our Team',
      body: `<p>We work with vendors and contractors across the region.
        Apply at careers@lakeshore.example or hr@lakeshore.example.</p>`,
    }),
    mustNotChoose: ['careers@lakeshore.example', 'hr@lakeshore.example'],
  },
  {
    id: 'sales-only',
    description: 'Only a sales inbox exists',
    url: 'https://prairiestate.example/contact',
    expected: null,
    html: page({
      title: 'Contact',
      h1: 'Contact Us',
      body: `<p>sales@prairiestate.example</p>`,
    }),
    mustNotChoose: ['sales@prairiestate.example'],
  },
  {
    id: 'noreply-only',
    description: 'Only a no-reply address is present',
    url: 'https://hudsonvalley.example/contact',
    expected: null,
    html: page({
      title: 'Contact',
      h1: 'Contact',
      body: `<p>Automated notices come from noreply@hudsonvalley.example.</p>`,
    }),
    mustNotChoose: ['noreply@hudsonvalley.example'],
  },
  {
    id: 'footer-info-only',
    description: 'Only a footer info@ with no vendor context',
    url: 'https://brooklynbridge.example/',
    expected: null,
    html: page({
      title: 'Brooklyn Bridge Management',
      h1: 'Welcome',
      body: `<p>Managing residential communities since 1998.</p>`,
      footer: `<p>info@brooklynbridge.example</p>`,
    }),
  },
  {
    id: 'placeholder-addresses',
    description: 'Form placeholders that look like addresses',
    url: 'https://liberty.example/contact',
    expected: null,
    html: page({
      title: 'Contact',
      h1: 'Contact Form',
      body: `<form><input type="email" placeholder="you@yourdomain.com"></form>
        <p>Example: name@example.com</p>`,
    }),
  },
  {
    id: 'image-filenames',
    description: 'Retina image filenames that resemble addresses',
    url: 'https://keystone.example/',
    expected: null,
    html: page({
      title: 'Keystone',
      h1: 'Keystone Residential',
      body: `<img src="/img/logo@2x.png"><img src="/img/hero@3x.jpg">`,
    }),
  },
  {
    id: 'support-is-not-vendor',
    description: 'support@ is a resident channel, not a vendor one',
    url: 'https://charlesriver.example/contact',
    expected: null,
    html: page({
      title: 'Support',
      h1: 'Resident Support',
      body: `<p>Residents: support@charlesriver.example</p>
        <p>Help: help@charlesriver.example</p>`,
    }),
    mustNotChoose: ['support@charlesriver.example', 'help@charlesriver.example'],
  },
  {
    id: 'newsletter-signup-not-a-form',
    description: 'Newsletter signup must not be read as a vendor form',
    url: 'https://sunshinestate.example/',
    expected: null,
    html: page({
      title: 'Sunshine State Rentals',
      h1: 'Welcome',
      body: `<form action="/subscribe"><input type="email" name="email">
        <input type="submit" value="Subscribe"></form>
        <p>Subscribe to our newsletter.</p>`,
    }),
  },

  // ---- 41-46: free providers, subdomains, edge shapes --------------------
  {
    id: 'free-provider-vendor-inbox',
    description: 'Vendor inbox on gmail — usable but penalised',
    url: 'https://gulfcoast.example/vendors',
    expected: 'gulfcoastvendors@gmail.com',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Information',
      body: `<p>Email gulfcoastvendors@gmail.com with your credentials.</p>`,
    }),
  },
  {
    id: 'subdomain-vendor-inbox',
    description: 'Address on a mail subdomain of the company',
    url: 'https://orangeblossom.example/vendors',
    expected: 'vendors@orangeblossom.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Registration',
      body: `<p>vendors@orangeblossom.example</p>`,
    }),
  },
  {
    id: 'vendor-inbox-plus-portal',
    description: 'Both an inbox and a credentialing portal are present',
    url: 'https://jacksonville.example/vendors',
    expected: 'vendors@jacksonville.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Onboarding',
      body: `<p>We use NetVendor for credentialing.
        <a href="https://app.netvendor.com/register">Register here</a>.</p>
        <p>Questions: vendors@jacksonville.example</p>`,
    }),
  },
  {
    id: 'uppercase-address',
    description: 'Address written in capitals',
    url: 'https://musiccity.example/vendors',
    expected: 'vendors@musiccity.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Information',
      body: `<p>VENDORS@MUSICCITY.EXAMPLE</p>`,
    }),
  },
  {
    id: 'address-in-json-ld',
    description: 'Address only present in a JSON-LD contactPoint',
    url: 'https://rtp.example/',
    expected: 'vendors@rtp.example',
    html: `<!doctype html><html><head><title>Research Triangle PM</title>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization",
       "contactPoint":[{"@type":"ContactPoint","contactType":"vendor relations",
       "email":"vendors@rtp.example"}]}
      </script></head><body><h1>Research Triangle PM</h1>
      <p>Vendor partnerships welcome.</p></body></html>`,
  },
  {
    id: 'vendor-inquiries-inbox',
    description: 'vendorinquiries@ variant',
    url: 'https://silverstate.example/vendors',
    expected: 'vendorinquiries@silverstate.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor Inquiries',
      body: `<p>vendorinquiries@silverstate.example</p>`,
    }),
  },

  // ---- 47-50: ambiguity that should resolve to low confidence ------------
  {
    id: 'office-inbox-on-vendor-page',
    description: 'Generic office@ but on an explicit vendor page',
    url: 'https://boulder.example/become-a-vendor',
    expected: 'office@boulder.example',
    html: page({
      title: 'Become a Vendor',
      h1: 'Become a Vendor',
      body: `<p>Send your vendor packet to office@boulder.example.</p>`,
    }),
  },
  {
    id: 'two-plausible-inboxes',
    description: 'vendors@ and procurement@ both present; vendors@ wins',
    url: 'https://inlandempire.example/vendors',
    expected: 'vendors@inlandempire.example',
    html: page({
      title: 'Vendors',
      h1: 'Vendor and Procurement',
      body: `<p>Vendors: vendors@inlandempire.example</p>
        <p>Procurement: procurement@inlandempire.example</p>`,
    }),
  },
  {
    id: 'no-contact-at-all',
    description: 'A page with a phone number and no addresses',
    url: 'https://copperstate.example/contact',
    expected: null,
    html: page({
      title: 'Contact',
      h1: 'Contact Us',
      body: `<p>Call us at (520) 555-0142, Monday to Friday.</p>`,
    }),
  },
  {
    id: 'vendor-word-without-inbox',
    description: 'Vendor page that only offers a form, no address',
    url: 'https://sandiego.example/vendor-application',
    expected: null,
    html: page({
      title: 'Vendor Application',
      h1: 'Vendor Application',
      body: `<form action="/apply" method="post">
        <input name="company"><input name="contact"><input name="email">
        <input name="phone"><input name="trade"><input type="file" name="coi">
        <input type="submit"></form>`,
    }),
  },
];
