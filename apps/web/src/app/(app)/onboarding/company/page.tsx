import { ENTITY_TYPES, ENTITY_TYPE_LABELS, US_STATES } from '@vendorlink/core';
import { requireContext } from '@/lib/context';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { OnboardingNav } from '../OnboardingNav';
import { CompanyForm } from './CompanyForm';

export const dynamic = 'force-dynamic';

export default async function CompanyPage() {
  const { repos } = await requireContext();
  const profile = await repos.profile.get();

  return (
    <div className="space-y-6">
      <OnboardingNav />
      <Card className="max-w-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Company details</h2>
          <p className="text-xs text-ink-muted">
            Your EIN is encrypted at rest and is never sent to a language model.
          </p>
        </CardHeader>
        <CardBody>
          <CompanyForm
            initial={{
              legalName: profile?.legal_name ?? '',
              dba: profile?.dba ?? '',
              entityType: profile?.entity_type ?? '',
              einLast4: profile?.ein_last4 ?? '',
              website: profile?.website ?? '',
              yearFounded: profile?.year_founded ?? null,
              employeeCount: profile?.employee_count ?? null,
              addressLine1: profile?.address_line1 ?? '',
              addressLine2: profile?.address_line2 ?? '',
              city: profile?.city ?? '',
              state: profile?.state ?? '',
              postal: profile?.postal ?? '',
              county: profile?.county ?? '',
              backgroundCheckConsent: profile?.background_check_consent ?? false,
            }}
            entityTypes={ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_TYPE_LABELS[t] }))}
            states={[...US_STATES]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
