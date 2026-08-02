'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { entityTypeSchema, usStateSchema } from '@vendorlink/core';
import { apiContext } from '@/lib/context';

export interface ProfileFormState {
  error?: string;
  /** Completeness score after the save, echoed back to the form. */
  ok?: number;
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v));

const optionalInt = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number.parseInt(v, 10)))
  .refine((v) => v === null || Number.isFinite(v), 'Enter a number.');

const schema = z.object({
  legalName: z.string().trim().min(2, 'Enter your legal business name.'),
  dba: optionalText,
  entityType: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || entityTypeSchema.safeParse(v).success, 'Pick a valid entity type.'),
  ein: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine(
      (v) => v === null || /^\d{2}-?\d{7}$/.test(v),
      'An EIN is nine digits, e.g. 12-3456789.',
    ),
  website: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || z.string().url().safeParse(v).success, 'Enter a full URL.'),
  yearFounded: optionalInt,
  employeeCount: optionalInt,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || usStateSchema.safeParse(v).success, 'Pick a state.'),
  postal: optionalText,
  county: optionalText,
});

export async function saveCompany(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await apiContext();
  if (!ctx) return { error: 'Your session expired. Sign in again.' };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const data = parsed.data;
  await ctx.repos.profile.update({
    legalName: data.legalName,
    dba: data.dba,
    entityType: data.entityType as never,
    // `undefined` leaves the stored EIN alone; `null` would clear it. A blank
    // field means "unchanged", which is why it is not sent at all.
    ...(data.ein !== null ? { ein: data.ein } : {}),
    website: data.website,
    yearFounded: data.yearFounded,
    employeeCount: data.employeeCount,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    state: data.state as never,
    postal: data.postal,
    county: data.county,
    backgroundCheckConsent: formData.get('backgroundCheckConsent') === 'on',
  });

  // A profile edit legitimately allows a re-send, so the version moves and the
  // run idempotency key changes with it.
  await ctx.repos.profile.bumpVersion();
  const score = await ctx.repos.profile.refreshCompleteness();

  revalidatePath('/onboarding/company');
  revalidatePath('/dashboard');
  return { ok: score };
}
