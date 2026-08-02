'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { resolveAttentionItem } from './actions';

/**
 * Close a parked item, capturing any correction as training data.
 *
 * The correction inputs are the point: an operator answering "the Internal
 * Sponsor Code field maps to nothing we have" once means every later tenant's
 * run against this form knows that, and never reaches this queue.
 */

const PROFILE_PATHS = [
  'profile.legal_name',
  'profile.dba',
  'profile.ein',
  'profile.primary_contact_name',
  'profile.primary_contact_title',
  'profile.primary_contact_email',
  'profile.primary_contact_phone',
  'profile.address_line1',
  'profile.city',
  'profile.state',
  'profile.postal',
  'profile.website',
  'profile.trades',
  'profile.service_area_summary',
  'profile.license_number',
  'profile.gl_each_occurrence',
  'profile.gl_aggregate',
  'profile.insurance_carrier',
  'profile.hourly_rate',
  'profile.payment_terms',
  'document.W9',
  'document.COI',
  'document.PRICEBOOK',
];

export function ResolveForm({
  taskId,
  unmappedLabels,
}: {
  taskId: string;
  unmappedLabels: string[];
}) {
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(outcome: 'submitted' | 'abandoned') {
    startTransition(async () => {
      setMessage(null);
      const result = await resolveAttentionItem({
        taskId,
        outcome,
        ...(confirmation.trim() ? { confirmationNumber: confirmation.trim() } : {}),
        corrections: Object.entries(corrections)
          .filter(([, path]) => path)
          .map(([label, path]) => ({ selector: label, label, mapsTo: path })),
      });

      if ('error' in result) {
        setMessage(result.error);
        return;
      }
      setMessage(
        result.learned > 0
          ? `Done. We learned ${result.learned} mapping(s) — the next run on this form won’t need you.`
          : 'Done.',
      );
      router.push('/attention');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">Finish up</h2>
        <p className="text-xs text-ink-muted">
          Anything you tell us here is remembered for every future run against this form.
        </p>
      </CardHeader>
      <CardBody className="space-y-5">
        {unmappedLabels.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Fields we could not work out
            </legend>
            {unmappedLabels.map((label) => (
              <Field key={label} label={label} htmlFor={`map-${label}`}>
                <Select
                  id={`map-${label}`}
                  value={corrections[label] ?? ''}
                  onChange={(e) =>
                    setCorrections((prev) => ({ ...prev, [label]: e.target.value }))
                  }
                >
                  <option value="">Leave unmapped</option>
                  {PROFILE_PATHS.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </fieldset>
        )}

        <Field
          label="Confirmation number"
          htmlFor="confirmation"
          hint="If the form gave you one, record it here."
        >
          <Input
            id="confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="VL-2026-004821"
          />
        </Field>

        {message && (
          <p role="status" className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            {message}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={() => submit('submitted')} disabled={pending}>
            {pending ? 'Saving…' : 'I submitted it'}
          </Button>
          <Button variant="secondary" onClick={() => submit('abandoned')} disabled={pending}>
            Not worth pursuing
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
