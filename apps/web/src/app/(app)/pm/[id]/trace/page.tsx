import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { ResolveNowButton } from './ResolveNowButton';

export const dynamic = 'force-dynamic';

interface ScoreComponent {
  reason: string;
  delta: number;
}

/**
 * The resolution trace.
 *
 * §5.1 requires that we can show an operator every URL fetched and every
 * candidate scored, with reasons. This page is the difference between "we
 * picked this address" and "we picked this address *because*" — and it is what
 * makes an unattended send reviewable after the fact rather than opaque.
 */
export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  await requireContext();
  const { id } = await params;

  const directory = new DirectoryRepository(db());
  const company = await directory.findById(id);
  if (!company) notFound();

  const [contacts, channels] = await Promise.all([
    directory.listContacts(company.id),
    directory.listChannels(company.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/pm/${company.id}`} className="text-sm text-ink-muted hover:text-ink">
        ← Back to {company.name}
      </Link>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">How we resolved this company</h1>
          <p className="text-sm text-ink-muted">
            {company.lastCrawledAt
              ? `Last resolved ${company.lastCrawledAt.toLocaleString()}.`
              : 'This company has not been resolved yet.'}
          </p>
        </div>
        <ResolveNowButton pmCompanyId={company.id} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Ranked contacts</h2>
          <p className="text-xs text-ink-muted">
            Always a ranked list, never one address — so you can pick a different one.
          </p>
        </CardHeader>
        {contacts.length === 0 ? (
          <EmptyState
            title="No contacts resolved"
            body="We haven’t found a vendor-onboarding address for this company yet."
          />
        ) : (
          <ul className="divide-y divide-line">
            {contacts.map((contact) => {
              const breakdown = (contact.scoreBreakdown ?? []) as ScoreComponent[];
              return (
                <li key={contact.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-ink-subtle">#{contact.rank}</span>
                    <span className="font-medium text-ink">{contact.email}</span>
                    <Badge
                      tone={
                        contact.confidence >= 0.6
                          ? 'ok'
                          : contact.confidence >= 0.35
                            ? 'warn'
                            : 'bad'
                      }
                    >
                      {Math.round(contact.confidence * 100)}% confidence
                    </Badge>
                    {contact.kind && <Badge>{contact.kind.replace(/_/g, ' ')}</Badge>}
                    {contact.hardBounced && <Badge tone="bad">hard bounced</Badge>}
                    {contact.mxValid === false && <Badge tone="bad">no MX record</Badge>}
                  </div>

                  {contact.personName && (
                    <p className="mt-1 text-sm text-ink-muted">
                      {contact.personName}
                      {contact.title ? `, ${contact.title}` : ''}
                    </p>
                  )}

                  {contact.sourceUrl && (
                    <p className="mt-1 text-xs text-ink-subtle">
                      Found on{' '}
                      <span className="font-mono">{contact.sourceUrl}</span>
                      {contact.discoveryMethod ? ` via ${contact.discoveryMethod.replace(/_/g, ' ')}` : ''}
                    </p>
                  )}

                  {breakdown.length > 0 && (
                    <table className="mt-3 w-full max-w-lg text-xs">
                      <tbody className="divide-y divide-line">
                        {breakdown.map((component, index) => (
                          <tr key={`${component.reason}-${index}`}>
                            <td className="py-1 pr-4 text-ink-muted">{component.reason}</td>
                            <td
                              className={`w-16 py-1 text-right font-medium ${
                                component.delta > 0
                                  ? 'text-ok'
                                  : component.delta < 0
                                    ? 'text-bad'
                                    : 'text-ink-subtle'
                              }`}
                            >
                              {component.delta > 0 ? '+' : ''}
                              {component.delta}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-line">
                          <td className="py-1 pr-4 font-medium text-ink">Total</td>
                          <td className="py-1 text-right font-semibold text-ink">
                            {contact.score}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">Channels detected</h2>
        </CardHeader>
        {channels.length === 0 ? (
          <EmptyState title="No channels detected" body="No application form or portal was found." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Kind</th>
                <th className="px-5 py-2 font-medium">Platform</th>
                <th className="px-5 py-2 font-medium">URL</th>
                <th className="px-5 py-2 font-medium">Gates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td className="px-5 py-2.5">
                    <Badge>{channel.kind?.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-ink-muted">
                    {channel.platformSlug?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td className="max-w-xs truncate px-5 py-2.5 font-mono text-xs text-ink-subtle">
                    {channel.url ?? '—'}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {channel.requiresAccount && <Badge tone="warn">account</Badge>}
                      {channel.feeCents ? (
                        <Badge tone="warn">${(channel.feeCents / 100).toFixed(0)}/yr</Badge>
                      ) : null}
                      {channel.captchaKind && channel.captchaKind !== 'none' && (
                        <Badge tone="bad">{channel.captchaKind.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
