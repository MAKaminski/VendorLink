import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import { matchDeterministic } from '@vendorlink/adapters';
import type { CaptchaKind, PlatformSlug } from '@vendorlink/core/domain';
import type { FieldOption, FieldType, FormField, FormSchema } from '@vendorlink/adapters';

/**
 * Form discovery (§6.3 step 1).
 *
 * Label resolution is where most of the accuracy comes from, and PM forms use
 * every possible markup. The strategies are tried in order of how reliable
 * they are and the winner is recorded on the field, so when a mapping looks
 * wrong an operator can see *which* piece of markup produced the label.
 */

const CAPTCHA_SELECTORS: ReadonlyArray<[selector: string, kind: CaptchaKind]> = [
  ['script[src*="recaptcha/api.js?render="]', 'recaptcha_v3'],
  ['.g-recaptcha, iframe[src*="recaptcha"]', 'recaptcha_v2'],
  ['.h-captcha, iframe[src*="hcaptcha"]', 'hcaptcha'],
  ['.cf-turnstile, iframe[src*="challenges.cloudflare.com"]', 'turnstile'],
];

const PLATFORM_SELECTORS: ReadonlyArray<[selector: string, slug: PlatformSlug]> = [
  ['.gform_wrapper, form[id^="gform_"]', 'gravity_forms'],
  ['.wpforms-container, form.wpforms-form', 'wpforms'],
  ['.jotform-form, form.jotform-form', 'jotform'],
  ['[data-tf-widget], iframe[src*="typeform.com"]', 'typeform'],
  ['form.hs-form, [data-hs-forms-root]', 'hubspot_form'],
  ['form[action*="formstack.com"]', 'formstack'],
  ['form[action*="wufoo.com"]', 'wufoo'],
  ['form[action*="cognitoforms.com"]', 'cognito_forms'],
];

export async function detectCaptcha(page: Page): Promise<CaptchaKind> {
  for (const [selector, kind] of CAPTCHA_SELECTORS) {
    if ((await page.locator(selector).count()) > 0) return kind;
  }
  return 'none';
}

/**
 * Identify the form platform.
 *
 * A third-party fingerprint wins. Failing that, a form that posts back to the
 * page's own origin is the PM company's own form — `custom`, which the ToS
 * policy allows, because submitting it is the vendor's own action on the
 * vendor's behalf.
 *
 * `null` is reserved for a form posting somewhere we do not recognize. That is
 * a genuinely unknown third party, and it routes to the assisted lane.
 */
export async function detectPlatform(page: Page): Promise<PlatformSlug | null> {
  for (const [selector, slug] of PLATFORM_SELECTORS) {
    if ((await page.locator(selector).count()) > 0) return slug;
  }

  const form = page.locator('form').first();
  if ((await form.count()) === 0) return null;

  const action = await form.getAttribute('action');
  if (!action) return 'custom'; // Posts to itself.

  try {
    const target = new URL(action, page.url());
    return target.origin === new URL(page.url()).origin ? 'custom' : null;
  } catch {
    return null;
  }
}

function normalizeLabel(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[*\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[:：]\s*$/, '')
    .trim();
}

/**
 * Resolve a control's label.
 *
 * Ordered by reliability: an explicit `for` association is authoritative; a
 * `name` attribute is the last resort because it is often an abbreviation the
 * rules table cannot read.
 */
async function resolveLabel(
  page: Page,
  control: Locator,
): Promise<{ label: string; source: FormField['labelSource'] }> {
  const id = await control.getAttribute('id');

  if (id) {
    const forLabel = page.locator(`label[for="${cssEscape(id)}"]`);
    if ((await forLabel.count()) > 0) {
      const text = normalizeLabel(await forLabel.first().textContent());
      if (text) return { label: text, source: 'label_for' };
    }
  }

  const aria = normalizeLabel(await control.getAttribute('aria-label'));
  if (aria) return { label: aria, source: 'aria_label' };

  const ariaLabelledBy = await control.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const referenced = page.locator(`#${cssEscape(ariaLabelledBy)}`);
    if ((await referenced.count()) > 0) {
      const text = normalizeLabel(await referenced.first().textContent());
      if (text) return { label: text, source: 'aria_label' };
    }
  }

  // A wrapping <label> — common in older markup.
  const wrapping = control.locator('xpath=ancestor::label[1]');
  if ((await wrapping.count()) > 0) {
    const text = normalizeLabel(await wrapping.first().textContent());
    if (text) return { label: text, source: 'wrapping_label' };
  }

  // A table row's header cell, for grid-shaped forms.
  const headerCell = control.locator('xpath=ancestor::tr[1]/th[1] | ancestor::tr[1]/td[1]');
  if ((await headerCell.count()) > 0) {
    const text = normalizeLabel(await headerCell.first().textContent());
    if (text && text.length < 80) return { label: text, source: 'table_header' };
  }

  const placeholder = normalizeLabel(await control.getAttribute('placeholder'));
  if (placeholder) return { label: placeholder, source: 'placeholder' };

  // Nearest preceding text node.
  const preceding = control.locator(
    'xpath=preceding::*[self::label or self::span or self::div or self::p][normalize-space(text())!=""][1]',
  );
  if ((await preceding.count()) > 0) {
    const text = normalizeLabel(await preceding.first().textContent());
    if (text && text.length < 80) return { label: text, source: 'preceding_text' };
  }

  const name = await control.getAttribute('name');
  if (name) {
    // `contact_first_name` reads much better to the rules table than the raw
    // attribute does.
    return { label: normalizeLabel(name.replace(/[_-]+/g, ' ')), source: 'name_attribute' };
  }

  return { label: '', source: 'none' };
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

async function controlType(control: Locator): Promise<FieldType> {
  const tag = (await control.evaluate((el) => el.tagName.toLowerCase())) as string;
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  const type = ((await control.getAttribute('type')) ?? 'text').toLowerCase();
  const known: FieldType[] = [
    'text', 'email', 'tel', 'number', 'url', 'date', 'radio', 'checkbox', 'file', 'hidden',
  ];
  return (known as string[]).includes(type) ? (type as FieldType) : 'text';
}

async function readOptions(control: Locator, type: FieldType): Promise<FieldOption[]> {
  if (type !== 'select') return [];
  return control.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options)
      .filter((o) => o.value !== '')
      .map((o) => ({ value: o.value, label: (o.textContent ?? '').trim() })),
  );
}

/** Stable selector for a control, preferring id then name then position. */
async function selectorFor(control: Locator, index: number): Promise<string> {
  const id = await control.getAttribute('id');
  if (id) return `#${id}`;
  const name = await control.getAttribute('name');
  if (name) {
    const tag = await control.evaluate((el) => el.tagName.toLowerCase());
    return `${tag}[name="${name}"]`;
  }
  return `form :is(input,select,textarea):nth-of-type(${index + 1})`;
}

export interface DiscoverOptions {
  /** Restrict discovery to one form; defaults to the largest on the page. */
  readonly formSelector?: string;
}

export async function discoverSchema(
  page: Page,
  opts: DiscoverOptions = {},
): Promise<FormSchema | null> {
  const forms = page.locator(opts.formSelector ?? 'form');
  const formCount = await forms.count();
  if (formCount === 0) return null;

  // Pick the form with the most real inputs: a page often carries a search box
  // and a newsletter signup alongside the application.
  let bestIndex = 0;
  let bestCount = -1;
  for (let i = 0; i < formCount; i++) {
    const count = await forms.nth(i).locator('input:not([type=hidden]), select, textarea').count();
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }
  const form = forms.nth(bestIndex);

  const controls = form.locator('input, select, textarea');
  const controlCount = await controls.count();

  const fields: FormField[] = [];
  for (let i = 0; i < controlCount; i++) {
    const control = controls.nth(i);
    const type = await controlType(control);
    if (type === 'hidden') continue;

    const inputType = ((await control.getAttribute('type')) ?? '').toLowerCase();
    if (['submit', 'button', 'reset', 'image'].includes(inputType)) continue;

    const { label, source } = await resolveLabel(page, control);
    const required =
      (await control.getAttribute('required')) !== null ||
      (await control.getAttribute('aria-required')) === 'true' ||
      // Many forms mark required with a class on the label rather than the input.
      (await labelMarkedRequired(page, control));

    const maxLengthRaw = await control.getAttribute('maxlength');
    const maxLength = maxLengthRaw ? Number.parseInt(maxLengthRaw, 10) : null;

    const match = matchDeterministic(label);

    fields.push({
      selector: await selectorFor(control, i),
      label,
      labelSource: source,
      name: await control.getAttribute('name'),
      id: await control.getAttribute('id'),
      type,
      required,
      options: await readOptions(control, type),
      maxLength: Number.isFinite(maxLength) ? maxLength : null,
      mapsTo: match?.path ?? null,
      mapConfidence: match ? 1 : 0,
      mappedBy: match ? 'deterministic' : null,
      notes: null,
    });
  }

  const submitSelector = await findSubmitSelector(form);

  return {
    url: page.url(),
    fields,
    hash: hashSchema(fields),
    captchaKind: await detectCaptcha(page),
    platformSlug: await detectPlatform(page),
    submitSelector,
    stepCount: 1,
  };
}

async function labelMarkedRequired(page: Page, control: Locator): Promise<boolean> {
  const id = await control.getAttribute('id');
  if (!id) return false;
  const label = page.locator(`label[for="${cssEscape(id)}"]`);
  if ((await label.count()) === 0) return false;
  const className = (await label.first().getAttribute('class')) ?? '';
  return /\breq(uired)?\b/.test(className);
}

async function findSubmitSelector(form: Locator): Promise<string | null> {
  for (const selector of [
    'button[type=submit]',
    'input[type=submit]',
    'button:not([type])',
    'button',
  ]) {
    if ((await form.locator(selector).count()) > 0) return selector;
  }
  return null;
}

/**
 * Hash the form's *shape*, not its content.
 *
 * Field labels and values change constantly; what invalidates a cached schema
 * is a change to which controls exist. Hashing name+type+required means a
 * copy edit does not retire a working schema, but an added field does.
 */
export function hashSchema(fields: readonly FormField[]): string {
  const shape = fields
    .map((f) => `${f.name ?? f.selector}:${f.type}:${f.required ? 1 : 0}`)
    .sort()
    .join('|');
  return createHash('sha256').update(shape).digest('hex').slice(0, 32);
}
