import Link from 'next/link';

const STEPS = [
  { href: '/onboarding/company', label: 'Company' },
  { href: '/onboarding/contact', label: 'Contact & hours' },
  { href: '/onboarding/trades', label: 'Trades' },
  { href: '/onboarding/service-area', label: 'Service area' },
  { href: '/onboarding/insurance', label: 'Insurance' },
  { href: '/onboarding/licenses', label: 'Licences' },
  { href: '/onboarding/pricing', label: 'Pricing' },
  { href: '/onboarding/documents', label: 'Documents' },
];

export function OnboardingNav() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Vendor profile</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Enter this once. Every connection reuses it.
      </p>
      <nav className="flex flex-wrap gap-1 border-b border-line pb-3">
        {STEPS.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            className="rounded-md px-3 py-1.5 text-sm text-ink-muted transition hover:bg-surface hover:text-ink"
          >
            {step.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
