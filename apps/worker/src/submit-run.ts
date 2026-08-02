import { chromium, type Browser, type Page } from 'playwright';
import {
  evaluateGate,
  type Confirmation,
  type FormSchema,
  type GateDecision,
  type FieldWrite,
  type ResolveContext,
  type SubmissionOutcome,
} from '@vendorlink/adapters';
import { discoverSchema } from './discover-schema';
import { fillForm, type MaterializedDocument } from './fill-form';

/**
 * One portal submission run (§6.1).
 *
 * The shape that matters: discover → map → **gate** → fill → submit → confirm.
 * The gate sits between mapping and filling, so a run that cannot proceed
 * unattended is filled and parked rather than submitted badly. A parked run is
 * a 30-second job for an operator; a wrongly-submitted one is bad data in a
 * PM's vendor record under the vendor's name.
 */

export const WALL_CLOCK_MS = 10 * 60 * 1000;

/** Success phrasings, checked in §6.4's order after a confirmation number. */
const SUCCESS_TEXT = [
  /thank you/i,
  /application (?:has been )?(?:received|submitted)/i,
  /we(?:'| ha)ve received your/i,
  /submission (?:was )?successful/i,
  /successfully submitted/i,
];

/**
 * A confirmation number, not any capitalized word after "application".
 *
 * The qualifier (number/no/id/#) is mandatory and the captured token must
 * contain a digit. Without both, the case-insensitive flag made "Application
 * received" parse as confirmation number "received" — a false positive that
 * would report an unconfirmed submission as confirmed.
 */
const CONFIRMATION_NUMBER =
  /(?:confirmation|reference|ticket|application)\s*(?:number|no\.?|id|#)\s*[:#]?\s*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,})/i;

export interface SubmitRunOptions {
  readonly url: string;
  readonly context: ResolveContext;
  readonly documents: readonly MaterializedDocument[];
  readonly requireFirstSubmissionApproval: boolean;
  readonly schemaSuccessCount: number;
  /** Channel facts from discovery, which the live page may contradict. */
  readonly channel?: {
    requiresAccount?: boolean;
    requiresPayment?: boolean;
  };
  readonly onEvent?: (event: { type: string; message: string; data?: unknown }) => Promise<void>;
  /** Capture a screenshot; returns the artifact key. */
  readonly onScreenshot?: (name: string, png: Buffer) => Promise<string>;
  readonly headless?: boolean;
}

export interface SubmitRunResult {
  readonly outcome: SubmissionOutcome;
  readonly schema: FormSchema | null;
  readonly gate: GateDecision | null;
  readonly writes: readonly FieldWrite[];
  readonly screenshots: readonly string[];
}

export async function submitRun(opts: SubmitRunOptions): Promise<SubmitRunResult> {
  const browser: Browser = await chromium.launch({
    headless: opts.headless ?? true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  });

  const screenshots: string[] = [];
  const emit = async (type: string, message: string, data?: unknown) => {
    await opts.onEvent?.({ type, message, ...(data !== undefined ? { data } : {}) });
  };

  const shoot = async (page: Page, name: string) => {
    if (!opts.onScreenshot) return;
    const png = await page.screenshot({ fullPage: true });
    screenshots.push(await opts.onScreenshot(name, png));
  };

  try {
    // A fresh context per run: no cookies, no storage, nothing carried between
    // tenants.
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/131.0.0.0 Safari/537.36 VendorLinkBot/1.0',
      viewport: { width: 1280, height: 1024 },
    });
    const page = await context.newPage();

    await emit('portal.navigating', `Opening ${opts.url}`);
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissCookieBanners(page);
    await shoot(page, '01-landed');

    const schema = await discoverSchema(page);
    if (!schema || schema.fields.length === 0) {
      await emit('portal.no_form', 'No application form found on the page');
      return {
        outcome: { kind: 'needs_attention', reason: 'form_not_found', detail: 'No form on the page.' },
        schema: null,
        gate: null,
        writes: [],
        screenshots,
      };
    }

    await emit(
      'portal.schema_discovered',
      `Found ${schema.fields.length} fields, ${schema.fields.filter((f) => f.required).length} required`,
      { hash: schema.hash, platform: schema.platformSlug, captcha: schema.captchaKind },
    );

    const gate = evaluateGate({
      fields: schema.fields,
      captchaKind: schema.captchaKind,
      platformSlug: schema.platformSlug,
      requiresAccount: opts.channel?.requiresAccount ?? false,
      requiresPayment: opts.channel?.requiresPayment ?? false,
      requireFirstSubmissionApproval: opts.requireFirstSubmissionApproval,
      schemaSuccessCount: opts.schemaSuccessCount,
    });

    // Fill regardless of the gate: a parked run should arrive at the operator
    // 95% complete, which is what makes it a 30-second job.
    const { writes, skipped } = await fillForm(page, schema.fields, opts.context, opts.documents);
    if (skipped.length > 0) {
      await emit('portal.fields_skipped', `Could not fill: ${skipped.join(', ')}`);
    }
    await emit('portal.filled', `Filled ${writes.length} field(s)`);
    await shoot(page, '02-filled');

    if (!gate.proceed) {
      await emit('portal.parked', gate.detail, { reason: gate.reason });
      return {
        outcome: {
          kind: 'needs_attention',
          reason: gate.reason ?? 'low_confidence_mapping',
          detail: gate.detail,
        },
        schema,
        gate,
        writes,
        screenshots,
      };
    }

    await emit('portal.submitting', `Submitting (confidence ${gate.confidence.toFixed(2)})`);

    const beforeUrl = page.url();
    if (schema.submitSelector) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined),
        page.locator(schema.submitSelector).first().click({ timeout: 15_000 }),
      ]);
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);
    await shoot(page, '03-submitted');

    const confirmation = await detectConfirmation(page, beforeUrl);
    if (confirmation) {
      await emit(
        'portal.confirmed',
        `Confirmed via ${confirmation.method}: ${confirmation.value}`,
      );
    } else {
      // §6.4: without evidence, this is `submitted_unconfirmed`, not success.
      await emit(
        'portal.submitted_unconfirmed',
        'Submitted, but no confirmation evidence was found on the page',
      );
    }

    return { outcome: { kind: 'submitted', confirmation }, schema, gate, writes, screenshots };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    await emit('portal.failed', detail);
    return {
      outcome: { kind: 'failed', detail },
      schema: null,
      gate: null,
      writes: [],
      screenshots,
    };
  } finally {
    await browser.close();
  }
}

/** Cookie banners intercept clicks; dismissing them is not consent bypass. */
async function dismissCookieBanners(page: Page): Promise<void> {
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    '#onetrust-accept-btn-handler',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      await locator.click({ timeout: 2000 }).catch(() => undefined);
      return;
    }
  }
}

/**
 * §6.4's ordered evidence list.
 *
 * A submission is not "submitted" until there is evidence. Absent all of
 * these, the caller records `submitted_unconfirmed` and a follow-up job checks
 * inbound mail — claiming success without evidence would tell a vendor they
 * had applied somewhere they had not.
 */
export async function detectConfirmation(
  page: Page,
  beforeUrl: string,
): Promise<Confirmation | null> {
  const body = (await page.locator('body').textContent()) ?? '';

  const numberMatch = CONFIRMATION_NUMBER.exec(body);
  if (numberMatch?.[1]) {
    return { method: 'confirmation_number', value: numberMatch[1], screenshotKey: null };
  }

  for (const pattern of SUCCESS_TEXT) {
    const match = pattern.exec(body);
    if (match) {
      return { method: 'success_text', value: match[0], screenshotKey: null };
    }
  }

  const afterUrl = page.url();
  if (afterUrl !== beforeUrl && /thank|success|confirm|received|complete/i.test(afterUrl)) {
    return { method: 'url_transition', value: afterUrl, screenshotKey: null };
  }

  return null;
}
