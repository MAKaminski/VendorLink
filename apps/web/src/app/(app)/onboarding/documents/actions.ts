'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { documentKindSchema, documentStorageKey, sha256Hex } from '@vendorlink/core';
import { apiContext, objectStore } from '@/lib/context';

const MAX_BYTES = 25 * 1024 * 1024;

const ACCEPTED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]);

export interface UploadState {
  error?: string;
  ok?: string;
}

/**
 * Upload a document.
 *
 * The bytes are hashed before they are stored and the digest is written to the
 * row, so the worker materializing a file to /tmp can verify it is handling
 * the document it thinks it is rather than a truncated or swapped object.
 */
export async function uploadDocument(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const ctx = await apiContext();
  if (!ctx) return { error: 'Your session expired. Sign in again.' };

  const kindResult = documentKindSchema.safeParse(formData.get('kind'));
  if (!kindResult.success) return { error: 'Pick a document type.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 25 MB.' };
  if (!ACCEPTED_MIME.has(file.type)) {
    return { error: `We can’t accept ${file.type || 'that file type'}. Use PDF, PNG, JPEG or XLSX.` };
  }

  const expiresOn = z
    .string()
    .date()
    .safeParse(formData.get('expiresOn'));
  const label = (formData.get('label') as string | null)?.trim() || file.name;

  const body = Buffer.from(await file.arrayBuffer());
  const digest = sha256Hex(body);
  const documentId = randomUUID();
  const key = documentStorageKey(ctx.repos.tenantId, documentId, file.name);

  await objectStore().put({ key, body, contentType: file.type, sha256: digest });

  const row = await ctx.repos.documents.insert({
    id: documentId,
    kind: kindResult.data,
    label,
    r2Key: key,
    mime: file.type,
    bytes: body.byteLength,
    sha256: digest,
    expiresOn: expiresOn.success ? expiresOn.data : null,
    uploadedBy: ctx.session.user.userId,
  });

  // One current document per kind: an ambiguous "which COI is live" is how a
  // vendor ends up submitting an expired certificate.
  await ctx.repos.documents.supersedePrevious(kindResult.data, row.id);
  await ctx.repos.profile.refreshCompleteness();

  revalidatePath('/onboarding/documents');
  revalidatePath('/dashboard');
  return { ok: `${label} uploaded.` };
}

export async function deleteDocument(documentId: string): Promise<void> {
  const ctx = await apiContext();
  if (!ctx) return;
  const doc = await ctx.repos.documents.findById(documentId);
  if (!doc) return;
  await objectStore().delete(doc.r2Key);
  await ctx.repos.documents.delete(documentId);
  await ctx.repos.profile.refreshCompleteness();
  revalidatePath('/onboarding/documents');
}

/** Short-lived link for viewing a stored document. */
export async function documentDownloadUrl(documentId: string): Promise<string | null> {
  const ctx = await apiContext();
  if (!ctx) return null;
  const doc = await ctx.repos.documents.findById(documentId);
  if (!doc) return null;
  return objectStore().presignGet(doc.r2Key, {
    expiresInSeconds: 15 * 60,
    downloadFilename: doc.label,
  });
}
