import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import {
  MAPPING_RULES,
  isSecretPath,
  redactionMarkerFor,
  resolveFieldValue,
  type FieldWrite,
  type FormField,
  type ResolveContext,
} from '@vendorlink/adapters';
import { sha256Hex, type ObjectStore } from '@vendorlink/core';
import type { VendorDocument } from '@vendorlink/core/domain';

/**
 * Fill a discovered form.
 *
 * Every write produces a `FieldWrite` recording what went into which selector
 * and why. That table is the explainability surface §4.3 calls for — an
 * operator has to be able to see exactly what the automation typed.
 *
 * Secret values are typed into the browser but never recorded literally; the
 * audit row gets a redaction marker instead, per §10.
 */

export interface MaterializedDocument {
  readonly kind: string;
  readonly path: string;
  readonly filename: string;
}

export interface FillResult {
  readonly writes: readonly FieldWrite[];
  /** Fields we had nothing for; the gate has already decided this is survivable. */
  readonly skipped: readonly string[];
}

function ruleFor(path: string | null) {
  if (!path) return null;
  return MAPPING_RULES.find((r) => r.path === path) ?? null;
}

export async function fillForm(
  page: Page,
  fields: readonly FormField[],
  context: ResolveContext,
  documents: readonly MaterializedDocument[],
): Promise<FillResult> {
  const writes: FieldWrite[] = [];
  const skipped: string[] = [];

  for (const field of fields) {
    if (!field.mapsTo) {
      skipped.push(field.label || field.selector);
      continue;
    }

    // File inputs are matched to a materialized document by kind.
    if (field.type === 'file') {
      const kind = field.mapsTo.startsWith('document.')
        ? field.mapsTo.slice('document.'.length)
        : null;
      const document = kind ? documents.find((d) => d.kind === kind) : undefined;
      if (!document) {
        skipped.push(field.label || field.selector);
        continue;
      }
      await page.locator(field.selector).setInputFiles(document.path);
      writes.push({
        selector: field.selector,
        label: field.label,
        valueWritten: document.filename,
        sourceField: field.mapsTo,
        confidence: field.mapConfidence,
        wasLlmMapped: field.mappedBy === 'llm',
        isRedacted: false,
      });
      continue;
    }

    const resolved = resolveFieldValue(field, ruleFor(field.mapsTo), context);
    if (!resolved) {
      skipped.push(field.label || field.selector);
      continue;
    }

    const control = page.locator(field.selector);

    switch (field.type) {
      case 'select':
        await control.selectOption(resolved.value);
        break;
      case 'checkbox':
        if (resolved.value === 'true') await control.check();
        else await control.uncheck();
        break;
      case 'radio':
        await page.locator(`${field.selector}[value="${resolved.value}"]`).check();
        break;
      default:
        await control.fill(resolved.value);
        break;
    }

    const secret = resolved.secret || isSecretPath(field.mapsTo);
    writes.push({
      selector: field.selector,
      label: field.label,
      // The value goes into the browser but never into the audit table.
      valueWritten: secret ? redactionMarkerFor(field.mapsTo) : resolved.value,
      sourceField: field.mapsTo,
      confidence: field.mapConfidence,
      wasLlmMapped: field.mappedBy === 'llm',
      isRedacted: secret,
    });
  }

  return { writes, skipped };
}

/**
 * Materialize documents from object storage to disk for upload.
 *
 * The digest is verified on the way out. Uploading a corrupted COI gets the
 * vendor rejected by the PM and nobody learns why, so a mismatch is a hard
 * failure rather than a warning.
 */
export async function materializeDocuments(
  documents: readonly VendorDocument[],
  store: ObjectStore,
): Promise<MaterializedDocument[]> {
  const directory = await mkdtemp(join(tmpdir(), 'vl-docs-'));
  const materialized: MaterializedDocument[] = [];

  for (const document of documents) {
    if (!document.is_current) continue;
    const content = await store.get(document.r2_key);
    const digest = sha256Hex(content);
    if (digest !== document.sha256) {
      throw new Error(
        `document ${document.label} failed its integrity check ` +
          `(${digest.slice(0, 12)}… vs ${document.sha256.slice(0, 12)}…)`,
      );
    }
    const filename = `${document.kind.toLowerCase()}.pdf`;
    const path = join(directory, filename);
    await writeFile(path, content);
    materialized.push({ kind: document.kind, path, filename });
  }

  return materialized;
}
