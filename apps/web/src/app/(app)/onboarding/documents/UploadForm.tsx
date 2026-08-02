'use client';

import { useActionState } from 'react';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS } from '@vendorlink/core/domain';
import { Button, Field, Input, Select } from '@/components/ui';
import { uploadDocument, type UploadState } from './actions';

const INITIAL: UploadState = {};

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadDocument, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <Field label="Document type" htmlFor="kind">
        <Select id="kind" name="kind" defaultValue="W9" required>
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {DOCUMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="File" htmlFor="file" hint="PDF, PNG, JPEG or XLSX, up to 25 MB.">
        <Input
          id="file"
          name="file"
          type="file"
          required
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
        />
      </Field>

      <Field label="Label" htmlFor="label" hint="Defaults to the filename.">
        <Input id="label" name="label" placeholder="COI 2026" />
      </Field>

      <Field
        label="Expires on"
        htmlFor="expiresOn"
        hint="We’ll nag you at 45, 30, 14 and 7 days out."
      >
        <Input id="expiresOn" name="expiresOn" type="date" />
      </Field>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-ok">
          {state.ok}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Uploading…' : 'Upload'}
      </Button>
    </form>
  );
}
