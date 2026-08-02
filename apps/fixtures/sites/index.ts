/**
 * Twelve deterministic mock PM sites (§11).
 *
 * Every E2E test runs against these and never against a live PM site. That is
 * not only politeness — a test suite that depends on someone else's marketing
 * page is a test suite that fails on their redesign.
 *
 * The set is chosen to cover the shapes that actually decide whether a run can
 * complete unattended: eight that should auto-submit, and four that must park
 * for a human. Those four are the point of the confidence gate, so they are as
 * important as the eight.
 */

export interface FixtureSite {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** What the run is expected to do — asserted by the E2E suite. */
  readonly expectation: 'auto_submit' | 'parks_for_attention' | 'email_only';
  readonly pages: Readonly<Record<string, string>>;
}

const layout = (title: string, body: string, opts: { nav?: boolean } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:2rem;max-width:52rem;line-height:1.5}
  label{display:block;margin:.75rem 0 .25rem;font-weight:600;font-size:.875rem}
  input,select,textarea{width:100%;padding:.5rem;border:1px solid #cbd5e1;border-radius:4px;font:inherit}
  button{margin-top:1rem;padding:.6rem 1.2rem;background:#0f766e;color:#fff;border:0;border-radius:4px;font:inherit;cursor:pointer}
  .req::after{content:" *";color:#b91c1c}
  nav a{margin-right:1rem}
</style></head><body>
${opts.nav === false ? '' : '<nav><a href="{{base}}/">Home</a><a href="{{base}}/vendors">Vendors</a><a href="{{base}}/contact">Contact</a></nav>'}
${body}
</body></html>`;

/** Standard vendor-application fields, shared by several fixtures. */
const standardFields = `
  <label for="company" class="req">Company Name</label>
  <input id="company" name="company" required>

  <label for="contact" class="req">Contact Person</label>
  <input id="contact" name="contact" required>

  <label for="email" class="req">Email Address</label>
  <input id="email" name="email" type="email" required>

  <label for="phone" class="req">Business Phone</label>
  <input id="phone" name="phone" type="tel" required>

  <label for="address">Street Address</label>
  <input id="address" name="address">

  <label for="city">City</label>
  <input id="city" name="city">

  <label for="state">State</label>
  <select id="state" name="state">
    <option value="">Select…</option>
    <option value="FL">Florida</option>
    <option value="GA">Georgia</option>
    <option value="TX">Texas</option>
  </select>

  <label for="zip">Zip Code</label>
  <input id="zip" name="zip">

  <label for="ein" class="req">Federal Tax ID</label>
  <input id="ein" name="ein" required>

  <label for="trade" class="req">Trade</label>
  <select id="trade" name="trade" required>
    <option value="">Select…</option>
    <option value="hvac">Heating &amp; Air Conditioning</option>
    <option value="landscaping">Landscaping / Grounds</option>
    <option value="plumbing">Plumbing</option>
    <option value="janitorial">Janitorial</option>
  </select>

  <label for="gl">General Liability Each Occurrence</label>
  <input id="gl" name="gl">

  <label for="license">Contractor License Number</label>
  <input id="license" name="license">

  <label for="w9">W-9</label>
  <input id="w9" name="w9" type="file">

  <label for="coi">Certificate of Insurance</label>
  <input id="coi" name="coi" type="file">
`;

const thankYou = layout(
  'Thank you',
  `<h1>Application received</h1>
   <p>Thank you. Your vendor application has been received.</p>
   <p>Confirmation number: <strong id="confirmation">VL-2026-004821</strong></p>`,
  { nav: false },
);

export const FIXTURE_SITES: readonly FixtureSite[] = [
  // ---- 1-8: should auto-submit unattended --------------------------------
  {
    slug: 'plain-form',
    name: 'Oakwood Residential',
    description: 'Plain HTML vendor application',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Oakwood Residential', '<h1>Oakwood Residential</h1><p>Managing communities since 1998.</p>'),
      '/vendors': layout(
        'Become a Vendor | Oakwood',
        `<h1>Become an Oakwood Vendor</h1>
         <p>Questions? <a href="mailto:vendors@oakwood.fixture">vendors@oakwood.fixture</a></p>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">${standardFields}
           <button type="submit">Submit Application</button>
         </form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'gravity-forms',
    name: 'Peachtree Property Partners',
    description: 'Gravity Forms markup',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Peachtree Property Partners', '<h1>Peachtree Property Partners</h1>'),
      '/vendors': layout(
        'Vendor Application | Peachtree',
        `<h1>Vendor Application</h1>
         <div class="gform_wrapper gravity-theme" id="gform_wrapper_3">
           <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data" id="gform_3">
             ${standardFields}
             <button type="submit" id="gform_submit_button_3">Submit</button>
           </form>
         </div>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'wpforms',
    name: 'Sunset Boulevard Management',
    description: 'WPForms markup',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Sunset Boulevard Management', '<h1>Sunset Boulevard Management</h1>'),
      '/vendors': layout(
        'Vendors | Sunset Blvd',
        `<h1>Vendor Registration</h1>
         <div class="wpforms-container wpforms-container-full">
           <form class="wpforms-form" action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">
             ${standardFields}
             <button type="submit" class="wpforms-submit">Send</button>
           </form>
         </div>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'nav-link-form',
    name: 'Southline Communities',
    description: 'Form reachable only through a nav link',
    expectation: 'auto_submit',
    pages: {
      // No mention of the application on the homepage body; discovery has to
      // follow the nav link.
      '/': layout(
        'Southline Communities',
        '<h1>Southline Communities</h1><p>Multifamily management across the Southeast.</p>',
      ),
      '/partners': layout(
        'Partner With Us | Southline',
        `<h1>Partner With Southline</h1>
         <p>We work with qualified service providers across our portfolio.</p>
         <a href="{{base}}/partners/vendor-application">Vendor application form</a>`,
      ),
      '/partners/vendor-application': layout(
        'Vendor Application | Southline',
        `<h1>Vendor Application</h1>
         <form action="{{base}}/partners/submit" method="post" enctype="multipart/form-data">${standardFields}
           <button type="submit">Apply</button></form>`,
      ),
      '/partners/submit': thankYou,
    },
  },
  {
    slug: 'multi-step-wizard',
    name: 'Lone Star Residential',
    description: 'Three-step wizard',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Lone Star Residential', '<h1>Lone Star Residential</h1>'),
      '/vendors': layout(
        'Vendor Application — Step 1 | Lone Star',
        `<h1>Vendor Application</h1>
         <p>Step 1 of 3 — Company</p>
         <form action="{{base}}/vendors/step2" method="post">
           <label for="company" class="req">Company Name</label>
           <input id="company" name="company" required>
           <label for="ein" class="req">Federal Tax ID</label>
           <input id="ein" name="ein" required>
           <label for="website">Website</label>
           <input id="website" name="website">
           <button type="submit">Next</button>
         </form>`,
      ),
      '/vendors/step2': layout(
        'Vendor Application — Step 2 | Lone Star',
        `<h1>Vendor Application</h1>
         <p>Step 2 of 3 — Contact</p>
         <form action="{{base}}/vendors/step3" method="post">
           <label for="contact" class="req">Contact Person</label>
           <input id="contact" name="contact" required>
           <label for="email" class="req">Email Address</label>
           <input id="email" name="email" type="email" required>
           <label for="phone" class="req">Business Phone</label>
           <input id="phone" name="phone" type="tel" required>
           <button type="submit">Next</button>
         </form>`,
      ),
      '/vendors/step3': layout(
        'Vendor Application — Step 3 | Lone Star',
        `<h1>Vendor Application</h1>
         <p>Step 3 of 3 — Credentials</p>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">
           <label for="trade" class="req">Trade</label>
           <select id="trade" name="trade" required>
             <option value="">Select…</option>
             <option value="landscaping">Landscaping / Grounds</option>
             <option value="hvac">Heating &amp; Air Conditioning</option>
           </select>
           <label for="gl">General Liability Each Occurrence</label>
           <input id="gl" name="gl">
           <label for="coi">Certificate of Insurance</label>
           <input id="coi" name="coi" type="file">
           <button type="submit">Submit Application</button>
         </form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'jotform',
    name: 'Desert Ridge Management',
    description: 'JotForm embed',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Desert Ridge Management', '<h1>Desert Ridge Management</h1>'),
      '/vendors': layout(
        'Vendors | Desert Ridge',
        `<h1>Vendor Application</h1>
         <div class="jotform-form">
           <form action="{{base}}/vendors/submit" method="post" class="jotform-form">
             ${standardFields}
             <button type="submit">Submit</button>
           </form>
         </div>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'trade-inboxes',
    name: 'Front Range Communities',
    description: 'Trade-specific inboxes plus an application form',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Front Range Communities', '<h1>Front Range Communities</h1>'),
      '/vendors': layout(
        'Vendor Contacts | Front Range',
        `<h1>Vendor Trade Contacts</h1>
         <ul>
           <li>HVAC: hvac@frontrange.fixture</li>
           <li>Landscaping: landscaping@frontrange.fixture</li>
           <li>Plumbing: plumbing@frontrange.fixture</li>
         </ul>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">${standardFields}
           <button type="submit">Apply</button></form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'regional-inboxes',
    name: 'Great Lakes Property Management',
    description: 'Regional inboxes plus an application form',
    expectation: 'auto_submit',
    pages: {
      '/': layout('Great Lakes Property Management', '<h1>Great Lakes Property Management</h1>'),
      '/vendors': layout(
        'Regional Vendor Contacts | Great Lakes',
        `<h1>Vendor Contacts by Region</h1>
         <ul>
           <li>Atlanta: atlantavendors@greatlakes.fixture</li>
           <li>Chicago: chicagovendors@greatlakes.fixture</li>
         </ul>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">${standardFields}
           <button type="submit">Apply</button></form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },

  // ---- 9-12: must park for a human ---------------------------------------
  {
    slug: 'recaptcha-wall',
    name: 'Bayou City Management',
    description: 'reCAPTCHA v2 on the application form',
    expectation: 'parks_for_attention',
    pages: {
      '/': layout('Bayou City Management', '<h1>Bayou City Management</h1>'),
      '/vendors': layout(
        'Vendor Application | Bayou City',
        `<h1>Vendor Application</h1>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">
           ${standardFields}
           <div class="g-recaptcha" data-sitekey="fixture-site-key"></div>
           <script src="https://www.google.com/recaptcha/api.js" async defer></script>
           <button type="submit">Submit</button>
         </form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },
  {
    slug: 'login-portal',
    name: 'Cascade Property Group',
    description: 'Application behind a login',
    expectation: 'parks_for_attention',
    pages: {
      '/': layout('Cascade Property Group', '<h1>Cascade Property Group</h1>'),
      '/vendors': layout(
        'Vendor Portal | Cascade',
        `<h1>Vendor Portal</h1>
         <p>Vendor applications are managed through our credentialing partner.</p>
         <p><a href="https://app.netvendor.com/register">Register with NetVendor</a></p>
         <p>An account and a $99 annual vendor fee are required.</p>`,
      ),
    },
  },
  {
    slug: 'pdf-packet',
    name: 'Rose City Rentals',
    description: 'Downloadable PDF packet, no online form',
    expectation: 'parks_for_attention',
    pages: {
      '/': layout('Rose City Rentals', '<h1>Rose City Rentals</h1>'),
      '/vendors': layout(
        'Vendors | Rose City',
        `<h1>Vendor Information</h1>
         <p>Download our vendor packet, complete it, and return it by mail.</p>
         <p><a href="{{base}}/files/vendor-packet.pdf">Vendor application packet (PDF)</a></p>`,
      ),
    },
  },
  {
    slug: 'unknown-required-field',
    name: 'Inland Empire PM Group',
    description: 'Form with a required field we cannot map',
    expectation: 'parks_for_attention',
    pages: {
      '/': layout('Inland Empire PM Group', '<h1>Inland Empire PM Group</h1>'),
      '/vendors': layout(
        'Vendor Application | Inland Empire',
        `<h1>Vendor Application</h1>
         <form action="{{base}}/vendors/submit" method="post" enctype="multipart/form-data">
           ${standardFields}
           <label for="sponsor" class="req">Internal Sponsor Code</label>
           <input id="sponsor" name="sponsor" required>
           <button type="submit">Submit</button>
         </form>`,
      ),
      '/vendors/submit': thankYou,
    },
  },

  // ---- email-only shapes, for Engine #1 E2E ------------------------------
  {
    slug: 'obfuscated-email',
    name: 'Buckhead Asset Management',
    description: 'Obfuscated address, no form',
    expectation: 'email_only',
    pages: {
      '/': layout('Buckhead Asset Management', '<h1>Buckhead Asset Management</h1>'),
      '/vendors': layout(
        'Vendors | Buckhead',
        `<h1>Vendor Inquiries</h1>
         <p>Email vendors [at] buckhead [dot] fixture with your credentials.</p>`,
      ),
    },
  },
  {
    slug: 'info-only',
    name: 'Hill Country Homes PM',
    description: 'Only a general info@ address',
    expectation: 'email_only',
    pages: {
      '/': layout('Hill Country Homes PM', '<h1>Hill Country Homes PM</h1>'),
      '/contact': layout(
        'Contact | Hill Country',
        `<h1>Contact Us</h1><p>General enquiries: info@hillcountry.fixture</p>`,
      ),
    },
  },
  {
    slug: 'contact-form-no-email',
    name: 'Inland Coastal Properties',
    description: 'Contact form with no address anywhere',
    expectation: 'email_only',
    pages: {
      '/': layout('Inland Coastal Properties', '<h1>Inland Coastal Properties</h1>'),
      '/contact': layout(
        'Contact | Inland Coastal',
        `<h1>Contact Us</h1>
         <form action="{{base}}/contact/submit" method="post">
           <label for="name">Name</label><input id="name" name="name">
           <label for="message">Message</label><textarea id="message" name="message"></textarea>
           <button type="submit">Send</button>
         </form>`,
      ),
    },
  },
];

export const SITES_BY_SLUG = new Map(FIXTURE_SITES.map((s) => [s.slug, s]));
