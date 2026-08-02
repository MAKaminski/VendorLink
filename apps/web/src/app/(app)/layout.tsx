import Link from 'next/link';
import { requireContext } from '@/lib/context';
import { signOutAction } from '../(auth)/actions';
import { Button } from '@/components/ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/directory', label: 'PM Directory' },
  { href: '/connections', label: 'Connections' },
  { href: '/attention', label: 'Needs attention' },
  { href: '/onboarding/company', label: 'Profile' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session } = await requireContext();

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link href="/dashboard" className="text-sm font-semibold uppercase tracking-wide text-brand">
            VendorLink
          </Link>
          <nav className="flex flex-1 items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-muted">{session.membership.tenantName}</span>
            <form action={signOutAction}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
