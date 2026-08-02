import { describe, expect, it } from 'vitest';
import {
  deobfuscate,
  detectCaptcha,
  extractJsAssembled,
  harvestEmails,
  harvestForms,
  harvestPage,
  stripTags,
} from '../src/harvest';

describe('de-obfuscation', () => {
  it('handles the bracketed at/dot form', () => {
    expect(deobfuscate('vendors [at] oakwood [dot] com')).toContain('vendors@oakwood.com');
    expect(deobfuscate('vendors (at) oakwood (dot) com')).toContain('vendors@oakwood.com');
    expect(deobfuscate('vendors {at} oakwood {dot} com')).toContain('vendors@oakwood.com');
  });

  it('handles the dashed and underscored forms', () => {
    expect(deobfuscate('vendors-at-oakwood-dot-com')).toContain('vendors@oakwood.com');
    expect(deobfuscate('vendors_at_oakwood_dot_com')).toContain('vendors@oakwood.com');
  });

  it('handles the spaced word form', () => {
    expect(deobfuscate('vendors at oakwood dot com')).toContain('vendors@oakwood.com');
  });

  it('does not mangle ordinary prose containing "at" and "dot"', () => {
    // A naive rule turns this into an address and poisons the candidate set.
    const prose = 'Look at our pricing page for details.';
    expect(deobfuscate(prose)).not.toMatch(/@/);
  });
});

describe('email harvesting', () => {
  it('prefers a mailto: link and records it as such', () => {
    const emails = harvestEmails('<a href="mailto:vendors@oakwood.com">Vendor inquiries</a>');
    expect(emails).toHaveLength(1);
    expect(emails[0]?.email).toBe('vendors@oakwood.com');
    expect(emails[0]?.method).toBe('mailto');
  });

  it('finds plain-text addresses', () => {
    const emails = harvestEmails('<p>Email procurement@oakwood.com to apply.</p>');
    expect(emails[0]?.email).toBe('procurement@oakwood.com');
    expect(emails[0]?.method).toBe('plain_text');
  });

  it('recovers an entity-encoded address', () => {
    const emails = harvestEmails('<p>vendors&#64;oakwood&#46;com</p>');
    expect(emails.map((e) => e.email)).toContain('vendors@oakwood.com');
  });

  it('recovers an obfuscated address and marks how it was found', () => {
    const emails = harvestEmails('<p>Write to vendors [at] oakwood [dot] com</p>');
    const found = emails.find((e) => e.email === 'vendors@oakwood.com');
    expect(found).toBeDefined();
    expect(found?.method).toBe('deobfuscated');
  });

  it('assembles an address split across JavaScript variables', () => {
    const html = `<script>
      var user = 'vendors'; var host = 'oakwood.com';
      document.write('<a href="mailto:' + user + '@' + host + '">Email us</a>');
    </script>`;
    expect(extractJsAssembled(html)).toContain('vendors@oakwood.com');
  });

  it('assembles an address from concatenated literals', () => {
    const html = `<script>document.write('vendors' + '@' + 'oakwood.com');</script>`;
    expect(extractJsAssembled(html)).toContain('vendors@oakwood.com');
  });

  it('rejects image filenames that look like addresses', () => {
    const emails = harvestEmails('<img src="logo@2x.png"><p>hero@3x.jpg</p>');
    expect(emails).toHaveLength(0);
  });

  it('rejects placeholder addresses', () => {
    const emails = harvestEmails('<p>e.g. name@example.com or you@yourdomain.com</p>');
    expect(emails).toHaveLength(0);
  });

  it('marks an address that only appears in the footer', () => {
    const html = `
      <main><p>Welcome to Oakwood.</p></main>
      <footer><p>info@oakwood.com</p></footer>`;
    const found = harvestEmails(html, {
      footerHtml: '<p>info@oakwood.com</p>',
    }).find((e) => e.email === 'info@oakwood.com');
    expect(found?.footerOnly).toBe(true);
  });

  it('does not mark an address that appears in both body and footer', () => {
    const html = `
      <main><p>Vendors: vendors@oakwood.com</p></main>
      <footer><p>vendors@oakwood.com</p></footer>`;
    const found = harvestEmails(html, {
      footerHtml: '<p>vendors@oakwood.com</p>',
    }).find((e) => e.email === 'vendors@oakwood.com');
    expect(found?.footerOnly).toBe(false);
  });

  it('picks up an adjacent person name and title', () => {
    const html = `<p>Marcus Webb, Director of Vendor Relations — mwebb@oakwood.com</p>`;
    const found = harvestEmails(html)[0];
    expect(found?.personName).toBe('Marcus Webb');
    expect(found?.title).toContain('Director');
  });

  it('de-duplicates the same address found several ways', () => {
    const html = `
      <a href="mailto:vendors@oakwood.com">Vendors</a>
      <p>or write to vendors@oakwood.com</p>`;
    const emails = harvestEmails(html);
    expect(emails).toHaveLength(1);
    // The strongest provenance wins.
    expect(emails[0]?.method).toBe('mailto');
  });
});

describe('form and captcha detection', () => {
  it('counts real fields and ignores hidden and submit inputs', () => {
    const forms = harvestForms(`
      <form action="/apply" method="post">
        <input type="hidden" name="csrf">
        <input type="text" name="company">
        <input type="email" name="email">
        <textarea name="notes"></textarea>
        <input type="submit" value="Send">
      </form>`);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.fieldCount).toBe(3);
    expect(forms[0]?.action).toBe('/apply');
    expect(forms[0]?.method).toBe('post');
  });

  it('notices a file input', () => {
    const forms = harvestForms('<form><input type="file" name="coi"></form>');
    expect(forms[0]?.hasFileInput).toBe(true);
  });

  it('distinguishes reCAPTCHA v3 from v2', () => {
    expect(detectCaptcha('<script src="https://www.google.com/recaptcha/api.js?render=KEY">')).toBe(
      'recaptcha_v3',
    );
    expect(detectCaptcha('<div class="g-recaptcha" data-sitekey="x"></div>')).toBe('recaptcha_v2');
  });

  it('detects hCaptcha and Turnstile', () => {
    expect(detectCaptcha('<div class="h-captcha"></div>')).toBe('hcaptcha');
    expect(detectCaptcha('<div class="cf-turnstile"></div>')).toBe('turnstile');
  });

  it('returns null when there is no captcha', () => {
    expect(detectCaptcha('<form><input name="a"></form>')).toBeNull();
  });
});

describe('page harvesting', () => {
  it('extracts title, h1, links and iframes', () => {
    const page = harvestPage(
      'https://oakwood.example/vendors',
      `<html><head><title>Vendor Application | Oakwood</title></head>
       <body>
         <h1>Become an Oakwood Vendor</h1>
         <a href="/vendor-application">Apply now</a>
         <a href="mailto:vendors@oakwood.example">Email</a>
         <iframe src="https://forms.netvendor.com/embed/123"></iframe>
       </body></html>`,
    );
    expect(page.title).toBe('Vendor Application | Oakwood');
    expect(page.h1).toBe('Become an Oakwood Vendor');
    expect(page.links.map((l) => l.href)).toEqual(['/vendor-application']);
    expect(page.iframes[0]).toContain('netvendor.com');
    expect(page.emails[0]?.email).toBe('vendors@oakwood.example');
  });

  it('strips script and style content from the text', () => {
    const text = stripTags(`
      <style>.a{content:"nothing@here.com"}</style>
      <script>var x = "also@hidden.com";</script>
      <p>Real content</p>`);
    expect(text).toBe('Real content');
  });
});
