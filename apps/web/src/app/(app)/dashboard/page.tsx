import Link from 'next/link';
import { computeCompleteness, daysUntil, EXPIRY_NAG_DAYS } from '@vendorlink/core';
import { requireContext } from '@/lib/context';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CompletenessRing,
  EmptyState,
  LinkButton,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

interface ExpiringCredential {
  label: string;
  kind: string;
  expiresOn: string;
  days: number;
}

export default async function DashboardPage() {
  const { repos } = await requireContext();
  const profile = await repos.profile.get();
  if (!profile) {
    return <EmptyState title="No profile yet" body="Something went wrong creating your workspace." />;
  }

  const completeness = computeCompleteness(profile);
  const runs = await repos.runs.listRecent({ limit: 10 });
  const attention = await repos.tasks.listNeedingAttention();

  /**
   * Expiring credentials.
   *
   * §7.4 calls this a retention feature rather than a nicety, and the reason
   * is in the failure mode: an expired COI silently invalidates the vendor at
   * every PM they have already joined. Nobody gets told. So this table sorts
   * by urgency and surfaces even already-expired items.
   */
  const expiring: ExpiringCredential[] = [
    ...profile.documents
      .filter((d) => d.expires_on)
      .map((d) => ({
        label: d.label,
        kind: d.kind,
        expiresOn: d.expires_on as string,
        days: daysUntil(d.expires_on as string),
      })),
    ...profile.insurance
      .filter((i) => i.expires_on)
      .map((i) => ({
        label: `${i.policy_type} — ${i.carrier}`,
        kind: 'INSURANCE',
        expiresOn: i.expires_on as string,
        days: daysUntil(i.expires_on as string),
      })),
    ...profile.licenses
      .filter((l) => l.expires_on)
      .map((l) => ({
        label: `${l.license_type} (${l.issuing_state})`,
        kind: 'LICENSE',
        expiresOn: l.expires_on as string,
        days: daysUntil(l.expires_on as string),
      })),
  ]
    .filter((c) => c.days <= Math.max(...EXPIRY_NAG_DAYS))
    .sort((a, b) => a.days - b.days);

  const stats = [
    { label: 'PM companies connected', value: new Set(runs.map((r) => r.pmCompanyId)).size },
    { label: 'Submissions in flight', value: runs.filter((r) => r.status === 'running').length },
    { label: 'Needs attention', value: attention.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="text-sm text-ink-muted">
          Your profile drives every connection. Complete it once; reuse it everywhere.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Profile completeness</h2>
          </CardHeader>
          <CardBody className="flex gap-5">
            <CompletenessRing score={completeness.score} />
            <div className="min-w-0 flex-1">
              {completeness.missing.length === 0 ? (
                <p className="text-sm text-ok">Everything a PM application needs is on file.</p>
              ) : (
                <>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    {completeness.blockers.length > 0
                      ? `${completeness.blockers.length} blocking ${completeness.blockers.length === 1 ? 'gap' : 'gaps'}`
                      : 'Still missing'}
                  </p>
                  <ul className="space-y-1">
                    {completeness.missing.slice(0, 5).map((item) => (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className="text-sm text-ink-muted underline-offset-2 hover:text-brand hover:underline"
                        >
                          {item.blocking && <span className="mr-1 text-bad">•</span>}
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-6 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardBody>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  {stat.label}
                </p>
                <p className="mt-2 text-3xl font-semibold text-ink">{stat.value}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Expiring credentials</h2>
            <p className="text-xs text-ink-muted">
              An expired COI silently invalidates you at every PM you have already joined.
            </p>
          </div>
        </CardHeader>
        {expiring.length === 0 ? (
          <EmptyState
            title="Nothing expiring soon"
            body="No documents, policies or licences expire within the next 45 days."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Credential</th>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 font-medium">Expires</th>
                <th className="px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {expiring.map((item) => (
                <tr key={`${item.kind}-${item.label}`}>
                  <td className="px-5 py-2.5 text-ink">{item.label}</td>
                  <td className="px-5 py-2.5 text-ink-muted">{item.kind}</td>
                  <td className="px-5 py-2.5 text-ink-muted">{item.expiresOn}</td>
                  <td className="px-5 py-2.5">
                    {item.days < 0 ? (
                      <Badge tone="bad">Expired {Math.abs(item.days)}d ago</Badge>
                    ) : item.days <= 14 ? (
                      <Badge tone="bad">{item.days}d left</Badge>
                    ) : (
                      <Badge tone="warn">{item.days}d left</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent connections</h2>
          <LinkButton href="/directory" size="sm">
            Browse PM directory
          </LinkButton>
        </CardHeader>
        {runs.length === 0 ? (
          <EmptyState
            title="No connections yet"
            body="Find a property manager in the directory and click Connect. We handle the email and the application form."
            action={<LinkButton href="/directory" variant="primary">Open the directory</LinkButton>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center justify-between px-5 py-3">
                <Link href={`/connections/${run.id}`} className="text-sm text-ink hover:text-brand">
                  {run.createdAt.toLocaleString()}
                </Link>
                <Badge
                  tone={
                    run.status === 'succeeded'
                      ? 'ok'
                      : run.status === 'failed'
                        ? 'bad'
                        : run.status === 'needs_attention'
                          ? 'warn'
                          : 'neutral'
                  }
                >
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
