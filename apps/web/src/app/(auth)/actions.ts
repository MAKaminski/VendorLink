'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authProvider, db } from '@/lib/context';
import { SESSION_COOKIE, signIn, signUp } from '@/lib/auth';

export interface FormState {
  error?: string;
}

const signUpSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name.'),
  name: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(10, 'Use at least 10 characters.'),
});

async function establishSession(userId: string, tenantId: string): Promise<void> {
  const { token, expiresAt } = await authProvider().createSession(userId, tenantId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    companyName: formData.get('companyName'),
    name: formData.get('name') || undefined,
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const result = await signUp(db(), parsed.data);
  if ('error' in result) return result;

  await establishSession(result.userId, result.tenantId);
  redirect('/onboarding/company');
}

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const result = await signIn(db(), parsed.data.email, parsed.data.password);
  if ('error' in result) return result;

  await establishSession(result.userId, result.tenantId);
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await authProvider().destroySession(token);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
