'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Card, CardBody, Field, Input } from '@/components/ui';
import { signInAction, signUpAction, type FormState } from './actions';

const INITIAL: FormState = {};

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">VendorLink</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      </div>
      <Card>
        <CardBody>{children}</CardBody>
      </Card>
    </main>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, INITIAL);

  return (
    <Shell
      title="Create your workspace"
      subtitle="Enter your company details once. Then connect to any property manager in one click."
    >
      <form action={action} className="space-y-4">
        <Field label="Company name" htmlFor="companyName">
          <Input id="companyName" name="companyName" required placeholder="Peachtree Grounds LLC" />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" placeholder="Dana Whitfield" />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </Field>

        {state.error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  return (
    <Shell title="Sign in" subtitle="Welcome back.">
      <form action={action} className="space-y-4">
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>

        {state.error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-bad">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        New here?{' '}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create a workspace
        </Link>
      </p>
    </Shell>
  );
}
