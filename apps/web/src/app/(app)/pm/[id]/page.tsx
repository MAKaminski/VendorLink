import Link from 'next/link';
import { notFound } from 'next/navigation';
import { centsToDollarString, computeFit, type FitResult } from '@vendorlink/core';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardBody, CardHeader, EmptyState, LinkButton } from '@/components/ui';
import { ConnectButton } from './ConnectButton';

export const dynamic = 'force-dynamic';

export default async function PmCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { repos } = await requireContext();
  const { id } = await params;

  const directory = new DirectoryRepository(db());
  const company = await directory.findById(id);
  if (!company) notFound();

  const [profile, contacts, channels, requirements, priorRuns] = await Promise.all([
    repos.profile.get(),
    directory.listContacts(company.id),
    directory.listChannels(company.id),
    directory.getRequirements(company.id),
    repos.runs.listForCompany(company.id),
  ]);

  const fit: FitResult = profile
    ? computeFit(profile, requirements)
    : { status: 'unknown', gaps: [], checked: 0 };

  const emailChannel = contacts[0];
  const formChannel = channels.find((c) => c.kind === 'WEB_FORM' || c.kind === 'CONTACT_FORM');
  const portalChannel = channels.find((c) => c.kind === 'PORTAL');
  const hasAnyChannel = Boolean(emailChannel || formChannel || portalChannel);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/directory" className="text-sm text-ink-muted hover:text-ink">
        ← Back to directory
      </Link>

      {/* 1. Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-lg font-semibold text-ink-muted">
          {company.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-ink">{company.name}</h1>
          <p className="text-sm text-ink-muted">
            {[company.hqCity, company.hqState].filter(Boolean).join(', ')}
            {company.portfolioUnits
              ? ` · ${company.portfolioUnits.toLocaleString()} units`
              : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {company.markets.map((market) => (
              <Badge key={market}>{market}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Fit banner — above the fold, because it prevents the wasted send. */}
      <FitBanner fit={fit} />

      {/* 3. Channels detected */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Channels detected</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {!hasAnyChannel ? (
            <p className="text-sm text-ink-muted">
              We haven’t resolved this company’s onboarding channels yet. Connecting will run
              discovery first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {emailChannel && (
                <Link
                  href={`/pm/${company.id}/trace`}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand"
                >
                  <span className="text-ink-muted">Email:</span>
                  <span className="font-medium text-ink">{emailChannel.email}</span>
                  <ConfidenceBadge confidence={emailChannel.confidence} />
                </Link>
              )}
              {formChannel && (
                <Link
                  href={`/pm/${company.id}/trace`}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand"
                >
                  <span className="text-ink-muted">Web form:</span>
                  <span className="font-medium text-ink">
                    {formChannel.url ? new URL(formChannel.url).pathname : 'found'}
                  </span>
                </Link>
              )}
              {portalChannel && (
                <Link
                  href={`/pm/${company.id}/trace`}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand"
                >
                  <span className="text-ink-muted">Portal:</span>
                  <span className="font-medium text-ink">
                    {portalChannel.platformSlug?.replace(/_/g, ' ') ?? 'portal'}
                  </span>
                  {/* Fee before the click, always — a surprise charge is a churn event. */}
                  {portalChannel.feeCents ? (
                    <Badge tone="warn">
                      {centsToDollarString(portalChannel.feeCents)}/yr vendor fee
                    </Badge>
                  ) : null}
                </Link>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 4. The button */}
      <ConnectButton
        pmCompanyId={company.id}
        pmCompanyName={company.name}
        recipient={emailChannel?.email ?? null}
        hasForm={Boolean(formChannel || portalChannel)}
        feeCents={portalChannel?.feeCents ?? null}
        blockedBy={fit.gaps.length > 0 ? fit.gaps.map((g) => g.label) : []}
      />

      {/* 7. History */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">History</h2>
        </CardHeader>
        {priorRuns.length === 0 ? (
          <EmptyState title="No prior connections" body="You haven’t contacted this company yet." />
        ) : (
          <ul className="divide-y divide-line">
            {priorRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/connections/${run.id}`} className="text-ink hover:text-brand">
                  {run.createdAt.toLocaleString()}
                </Link>
                <Badge tone={run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'bad' : 'neutral'}>
                  {run.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.6) return <Badge tone="ok">high confidence</Badge>;
  if (confidence >= 0.35) return <Badge tone="warn">low confidence</Badge>;
  return <Badge tone="bad">very low</Badge>;
}

function FitBanner({ fit }: { fit: FitResult }) {
  if (fit.status === 'unknown') {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <p className="text-sm text-ink-muted">
          This company hasn’t published vendor requirements we could read, so we can’t check your
          fit in advance.
        </p>
      </div>
    );
  }

  if (fit.status === 'meets') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm font-medium text-ok">
          You meet all {fit.checked} of this company’s stated requirements.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-warn">
        {fit.gaps.length} {fit.gaps.length === 1 ? 'gap' : 'gaps'} against this company’s stated
        requirements. Submitting anyway will likely be rejected.
      </p>
      <ul className="mt-2 space-y-1">
        {fit.gaps.map((gap) => (
          <li key={gap.key} className="text-sm">
            <Link href={gap.href} className="font-medium text-warn underline underline-offset-2">
              {gap.label}
            </Link>
            <span className="text-ink-muted"> — {gap.detail}</span>
          </li>
        ))}
      </ul>
      {fit.gaps.some((g) => g.fixableByAgent) && (
        <div className="mt-3">
          <LinkButton href="?agent-coi=1" size="sm">
            Email my agent for a corrected COI
          </LinkButton>
        </div>
      )}
    </div>
  );
}
