'use client';

import { useActionState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { saveCompany, type ProfileFormState } from './actions';

const INITIAL: ProfileFormState = {};

export interface CompanyInitial {
  legalName: string;
  dba: string;
  entityType: string;
  einLast4: string;
  website: string;
  yearFounded: number | null;
  employeeCount: number | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postal: string;
  county: string;
  backgroundCheckConsent: boolean;
}

export function CompanyForm({
  initial,
  entityTypes,
  states,
}: {
  initial: CompanyInitial;
  entityTypes: Array<{ value: string; label: string }>;
  states: string[];
}) {
  const [state, action, pending] = useActionState(saveCompany, INITIAL);

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal business name" htmlFor="legalName">
          <Input id="legalName" name="legalName" required defaultValue={initial.legalName} />
        </Field>
        <Field label="DBA" htmlFor="dba">
          <Input id="dba" name="dba" defaultValue={initial.dba} />
        </Field>
        <Field label="Entity type" htmlFor="entityType">
          <Select id="entityType" name="entityType" defaultValue={initial.entityType}>
            <option value="">Select…</option>
            {entityTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="EIN"
          htmlFor="ein"
          hint={
            initial.einLast4
              ? `On file, ending ${initial.einLast4}. Leave blank to keep it.`
              : 'Nine digits. Encrypted at rest.'
          }
        >
          <Input
            id="ein"
            name="ein"
            inputMode="numeric"
            placeholder={initial.einLast4 ? `••-•••${initial.einLast4}` : '12-3456789'}
          />
        </Field>
        <Field label="Website" htmlFor="website">
          <Input id="website" name="website" type="url" defaultValue={initial.website} />
        </Field>
        <Field label="Year founded" htmlFor="yearFounded">
          <Input
            id="yearFounded"
            name="yearFounded"
            type="number"
            min={1800}
            max={2100}
            defaultValue={initial.yearFounded ?? ''}
          />
        </Field>
        <Field label="Employees" htmlFor="employeeCount">
          <Input
            id="employeeCount"
            name="employeeCount"
            type="number"
            min={0}
            defaultValue={initial.employeeCount ?? ''}
          />
        </Field>
      </div>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
          Business address
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" htmlFor="addressLine1">
            <Input id="addressLine1" name="addressLine1" defaultValue={initial.addressLine1} />
          </Field>
          <Field label="Suite / unit" htmlFor="addressLine2">
            <Input id="addressLine2" name="addressLine2" defaultValue={initial.addressLine2} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" defaultValue={initial.city} />
          </Field>
          <Field label="State" htmlFor="state">
            <Select id="state" name="state" defaultValue={initial.state}>
              <option value="">Select…</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ZIP" htmlFor="postal">
            <Input id="postal" name="postal" defaultValue={initial.postal} />
          </Field>
          <Field label="County" htmlFor="county">
            <Input id="county" name="county" defaultValue={initial.county} />
          </Field>
        </div>
      </fieldset>

      <label className="flex items-start gap-3 border-t border-line pt-5 text-sm">
        <input
          type="checkbox"
          name="backgroundCheckConsent"
          defaultChecked={initial.backgroundCheckConsent}
          className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand"
        />
        <span className="text-ink-muted">
          I consent to background checks where a property manager requires one as a condition of
          joining their vendor pool.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-ok">
          Saved. Profile is {state.ok}% complete.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
