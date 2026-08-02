import type { CaptchaKind, PlatformSlug } from '@vendorlink/core/domain';
import type { HarvestedPage } from './harvest';
import type { DetectedChannel } from './types';

/**
 * Channel detection.
 *
 * Feeds Engine #2 and, just as importantly, the fee disclosure on the card:
 * §7.2 requires the vendor sees a credentialing platform's annual fee *before*
 * they click, because a surprise charge is a churn event.
 */

interface PlatformFingerprint {
  readonly slug: PlatformSlug;
  readonly hosts: readonly RegExp[];
  readonly markers: readonly RegExp[];
  readonly requiresAccount: boolean;
  readonly requiresPayment: boolean;
  /** Published vendor fee, where the platform charges one. */
  readonly feeCents: number | null;
  readonly label: string;
}

/**
 * Fees are the *published list price* and are shown as an estimate. They move,
 * and a stale number is still far better than surprising the vendor with a
 * charge they never saw.
 */
const PLATFORMS: readonly PlatformFingerprint[] = [
  {
    slug: 'netvendor',
    hosts: [/netvendor\.com/i],
    markers: [/netvendor/i],
    requiresAccount: true,
    requiresPayment: true,
    feeCents: 9900,
    label: 'NetVendor',
  },
  {
    slug: 'realpage',
    hosts: [/realpage\.com/i, /vendorcredentialing\.com/i],
    markers: [/realpage vendor credentialing/i, /compliance depot/i],
    requiresAccount: true,
    requiresPayment: true,
    feeCents: 12900,
    label: 'RealPage Vendor Credentialing',
  },
  {
    slug: 'yardi_vendorcafe',
    hosts: [/vendorcafe\.com/i, /vendorcafe\.yardi/i],
    markers: [/vendorcafe/i],
    requiresAccount: true,
    requiresPayment: true,
    feeCents: 10000,
    label: 'Yardi VendorCafe',
  },
  {
    slug: 'yardi_vendorshield',
    hosts: [/vendorshield\.com/i],
    markers: [/vendorshield/i],
    requiresAccount: true,
    requiresPayment: true,
    feeCents: 39900,
    label: 'Yardi VendorShield',
  },
  {
    slug: 'entrata',
    hosts: [/entrata\.com/i],
    markers: [/entrata/i],
    requiresAccount: true,
    requiresPayment: false,
    feeCents: null,
    label: 'Entrata',
  },
  {
    slug: 'appfolio',
    hosts: [/appfolio\.com/i],
    markers: [/appfolio/i],
    requiresAccount: false,
    requiresPayment: false,
    feeCents: null,
    label: 'AppFolio',
  },
  {
    slug: 'buildium',
    hosts: [/buildium\.com/i],
    markers: [/buildium/i],
    requiresAccount: false,
    requiresPayment: false,
    feeCents: null,
    label: 'Buildium',
  },
  {
    slug: 'propertyware',
    hosts: [/propertyware\.com/i],
    markers: [/propertyware/i],
    requiresAccount: false,
    requiresPayment: false,
    feeCents: null,
    label: 'Propertyware',
  },
  {
    slug: 'mri',
    hosts: [/mrisoftware\.com/i],
    markers: [/mri software/i],
    requiresAccount: true,
    requiresPayment: false,
    feeCents: null,
    label: 'MRI',
  },
  // Form builders: no account, no fee, and highly deterministic DOM shapes.
  { slug: 'gravity_forms', hosts: [], markers: [/gform_wrapper|gravity_form/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'Gravity Forms' },
  { slug: 'wpforms', hosts: [], markers: [/wpforms-form|wpforms-container/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'WPForms' },
  { slug: 'jotform', hosts: [/jotform\.com/i], markers: [/jotform/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'JotForm' },
  { slug: 'typeform', hosts: [/typeform\.com/i], markers: [/typeform/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'Typeform' },
  { slug: 'hubspot_form', hosts: [/hsforms\.(net|com)/i], markers: [/hbspt\.forms|hs-form/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'HubSpot Forms' },
  { slug: 'formstack', hosts: [/formstack\.com/i], markers: [/formstack/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'Formstack' },
  { slug: 'wufoo', hosts: [/wufoo\.com/i], markers: [/wufoo/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'Wufoo' },
  { slug: 'cognito_forms', hosts: [/cognitoforms\.com/i], markers: [/cognito ?forms/i], requiresAccount: false, requiresPayment: false, feeCents: null, label: 'Cognito Forms' },
];

const VENDOR_FORM_CONTEXT =
  /vendor|contractor|supplier|service provider|w-?9|certificate of insurance|\bcoi\b|trade/i;

const NEWSLETTER_CONTEXT = /newsletter|subscribe|mailing list|stay (?:up to date|informed)/i;

function identifyPlatform(haystacks: readonly string[]): PlatformFingerprint | null {
  for (const platform of PLATFORMS) {
    for (const haystack of haystacks) {
      if (platform.hosts.some((h) => h.test(haystack))) return platform;
      if (platform.markers.some((m) => m.test(haystack))) return platform;
    }
  }
  return null;
}

/**
 * Detect onboarding channels across the crawled pages.
 *
 * Distinguishing a vendor application from a newsletter signup matters: a
 * three-field form with "subscribe" next to it is not an onboarding channel,
 * and treating it as one would make Engine #2 submit junk.
 */
export function detectChannels(pages: readonly HarvestedPage[]): DetectedChannel[] {
  const channels = new Map<string, DetectedChannel>();

  const add = (channel: DetectedChannel) => {
    const key = `${channel.kind}:${channel.url ?? ''}`;
    const existing = channels.get(key);
    // Prefer the more specific classification when the same URL is seen twice.
    if (!existing || (existing.platformSlug === null && channel.platformSlug !== null)) {
      channels.set(key, channel);
    }
  };

  for (const page of pages) {
    const pageIsVendorPage =
      VENDOR_FORM_CONTEXT.test(page.url) ||
      VENDOR_FORM_CONTEXT.test(page.h1) ||
      VENDOR_FORM_CONTEXT.test(page.title);

    // Embedded credentialing platforms.
    for (const src of page.iframes) {
      const platform = identifyPlatform([src]);
      if (platform) {
        add({
          kind: 'PORTAL',
          url: src,
          platformSlug: platform.slug,
          requiresAccount: platform.requiresAccount,
          requiresPayment: platform.requiresPayment,
          feeCents: platform.feeCents,
          captchaKind: 'unknown',
          notes: `${platform.label} embedded on ${page.url}`,
        });
      }
    }

    // Links out to a credentialing platform.
    for (const link of page.links) {
      const platform = identifyPlatform([link.href]);
      if (platform && /vendor|supplier|contractor|register|apply/i.test(link.href + link.text)) {
        add({
          kind: 'PORTAL',
          url: link.href,
          platformSlug: platform.slug,
          requiresAccount: platform.requiresAccount,
          requiresPayment: platform.requiresPayment,
          feeCents: platform.feeCents,
          captchaKind: 'unknown',
          notes: `${platform.label} linked from ${page.url}`,
        });
      }
    }

    // Forms on the page itself.
    for (const form of page.forms) {
      const contextual = `${form.context} ${page.h1} ${page.title} ${page.url}`;
      if (NEWSLETTER_CONTEXT.test(form.context) && form.fieldCount <= 2) continue;

      const looksLikeVendorForm =
        pageIsVendorPage || VENDOR_FORM_CONTEXT.test(form.context) || form.hasFileInput;
      if (!looksLikeVendorForm) continue;

      const platform = identifyPlatform([contextual, form.action ?? '']);
      const captcha = (form.captchaHint ?? 'none') as CaptchaKind;

      add({
        // A form that takes file uploads on a vendor page is an application;
        // one that does not is more likely a general contact form.
        kind: form.hasFileInput || form.fieldCount >= 6 ? 'WEB_FORM' : 'CONTACT_FORM',
        url: form.action ? new URL(form.action, page.url).toString() : page.url,
        platformSlug: platform?.slug ?? 'custom',
        requiresAccount: platform?.requiresAccount ?? false,
        requiresPayment: platform?.requiresPayment ?? false,
        feeCents: platform?.feeCents ?? null,
        captchaKind: captcha,
        notes: `${form.fieldCount} fields on ${page.url}`,
      });
    }

    // A downloadable vendor packet is a channel too — it means the process is
    // paper, and the run should park rather than pretend to submit.
    for (const link of page.links) {
      if (!/\.pdf($|\?)/i.test(link.href)) continue;
      if (!VENDOR_FORM_CONTEXT.test(link.text + link.href)) continue;
      add({
        kind: 'PDF_PACKET',
        url: new URL(link.href, page.url).toString(),
        platformSlug: null,
        requiresAccount: false,
        requiresPayment: false,
        feeCents: null,
        captchaKind: 'none',
        notes: `vendor packet PDF linked from ${page.url}`,
      });
    }
  }

  return [...channels.values()];
}
