import type { ObjectStore, MailAttachment } from '@vendorlink/core';
import { sha256Hex, type DocumentKind, type VendorDocument } from '@vendorlink/core';

/**
 * Attachment assembly.
 *
 * §5.4 caps the total at 10 MB, because large attachments tank deliverability
 * and a packet that lands in spam is worse than one that arrives with links.
 * Above the cap we attach the two documents every PM actually requires — the
 * W-9 and the COI — and send signed links for the rest.
 */

export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const OVERFLOW_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Attached first; these are what an application is rejected for missing. */
const PRIORITY_ORDER: readonly DocumentKind[] = [
  'W9',
  'COI',
  'LICENSE',
  'PRICEBOOK',
  'CAPABILITY_STATEMENT',
  'REFERENCES',
  'SAFETY_MANUAL',
  'BANK_LETTER',
  'VOIDED_CHECK',
  'OTHER',
];

export interface AssembledAttachments {
  readonly attachments: readonly MailAttachment[];
  readonly overflowLinks: ReadonlyArray<{ label: string; url: string }>;
  readonly totalBytes: number;
  /** Documents that could not be read; surfaced as a task event, not silently dropped. */
  readonly failed: ReadonlyArray<{ documentId: string; label: string; error: string }>;
}

function priorityOf(kind: DocumentKind): number {
  const index = PRIORITY_ORDER.indexOf(kind);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

function filenameFor(document: VendorDocument): string {
  const base = document.label.replace(/[^A-Za-z0-9._ -]/g, '').trim() || document.kind;
  const extension = document.mime === 'application/pdf' ? '.pdf' : '';
  return base.toLowerCase().endsWith('.pdf') || extension === '' ? base : `${base}${extension}`;
}

export async function assembleAttachments(
  documents: readonly VendorDocument[],
  store: ObjectStore,
  opts: { maxTotalBytes?: number } = {},
): Promise<AssembledAttachments> {
  const cap = opts.maxTotalBytes ?? MAX_TOTAL_ATTACHMENT_BYTES;
  const ordered = [...documents]
    .filter((d) => d.is_current)
    .sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind));

  const attachments: MailAttachment[] = [];
  const overflowLinks: Array<{ label: string; url: string }> = [];
  const failed: Array<{ documentId: string; label: string; error: string }> = [];
  let totalBytes = 0;

  for (const document of ordered) {
    // Once the cap is reached, everything remaining becomes a link — including
    // documents that would individually have fit, so the ordering stays
    // predictable rather than depending on file sizes.
    if (totalBytes + document.bytes > cap) {
      try {
        overflowLinks.push({
          label: document.label,
          url: await store.presignGet(document.r2_key, {
            expiresInSeconds: OVERFLOW_LINK_TTL_SECONDS,
            downloadFilename: filenameFor(document),
          }),
        });
      } catch (err) {
        failed.push({
          documentId: document.id,
          label: document.label,
          error: err instanceof Error ? err.message : 'could not sign a download link',
        });
      }
      continue;
    }

    try {
      const content = await store.get(document.r2_key);
      // Verify what we are about to send is what was uploaded. A silently
      // corrupted COI is worse than a missing one: it gets the vendor rejected
      // and nobody knows why.
      const digest = sha256Hex(content);
      if (digest !== document.sha256) {
        failed.push({
          documentId: document.id,
          label: document.label,
          error: `stored bytes do not match the recorded digest (${digest.slice(0, 12)}… vs ${document.sha256.slice(0, 12)}…)`,
        });
        continue;
      }

      attachments.push({
        filename: filenameFor(document),
        content,
        contentType: document.mime,
      });
      totalBytes += content.byteLength;
    } catch (err) {
      failed.push({
        documentId: document.id,
        label: document.label,
        error: err instanceof Error ? err.message : 'could not read the stored document',
      });
    }
  }

  return { attachments, overflowLinks, totalBytes, failed };
}

/** `reply+{runId}@inbound.{domain}` — threads a reply back to its run. */
export function replyToAddress(runId: string, inboundDomain: string): string {
  return `reply+${runId}@${inboundDomain}`;
}

/** Recover the run id from a Reply-To subaddress. */
export function runIdFromReplyTo(address: string): string | null {
  const match = /^reply\+([0-9a-f-]{36})@/i.exec(address.trim());
  return match?.[1] ?? null;
}
