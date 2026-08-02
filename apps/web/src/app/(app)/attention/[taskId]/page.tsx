import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { ResolveForm } from './ResolveForm';

export const dynamic = 'force-dynamic';

/**
 * Resume a parked run.
 *
 * Shows what the automation already filled — so the operator can see it is 95%
 * done rather than starting over — and collects the one answer it could not
 * work out. That answer is written back to the shared form schema.
 *
 * SCOPE NOTE: §7.3 describes an embedded live browser session. This ships the
 * review-and-correct half of that: the field writes, the reason it parked, and
 * the correction loop. The live co-browsing transport is not implemented; the
 * operator finishes the submission in their own browser via the form link.
 */
export default async function ResumePage({ params }: { params: Promise<{ taskId: string }> }) {
  const { repos } = await requireContext();
  const { taskId } = await params;

  const task = await repos.tasks.findById(taskId);
  if (!task) notFound();

  const [run, writes, events] = await Promise.all([
    repos.runs.findById(task.runId),
    repos.fieldWrites.listForTask(task.id),
    repos.events.listForTask(task.id),
  ]);

  const directory = new DirectoryRepository(db());
  const [company, channels] = await Promise.all([
    run ? directory.findById(run.pmCompanyId) : null,
    run ? directory.listChannels(run.pmCompanyId) : [],
  ]);
  const channel = channels.find((c) => c.id === task.pmChannelId);

  const unmapped = events
    .filter((e) => e.eventType === 'portal.fields_skipped')
    .flatMap((e) => e.message.replace(/^Could not fill:\s*/, '').split(', '))
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/attention" className="text-sm text-ink-muted hover:text-ink">
        ← Needs attention
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">{company?.name ?? 'Resume submission'}</h1>
        <p className="text-sm text-ink-muted">{task.failureReason}</p>
      </div>

      {channel?.url && (
        <Card>
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">Open the form</p>
              <p className="text-xs text-ink-muted">{channel.url}</p>
            </div>
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Open ↗
            </a>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-ink">What we already filled</h2>
          <p className="text-xs text-ink-muted">
            {writes.length} field{writes.length === 1 ? '' : 's'}. Secrets are shown redacted here
            but were entered in full.
          </p>
        </CardHeader>
        {writes.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">Nothing was filled before this run parked.</p>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Field</th>
                <th className="px-5 py-2 font-medium">Value</th>
                <th className="px-5 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {writes.map((write) => (
                <tr key={write.id}>
                  <td className="px-5 py-2 text-ink">{write.label || write.selector}</td>
                  <td className="px-5 py-2 text-ink-muted">
                    {write.isRedacted ? (
                      <Badge tone="neutral">redacted</Badge>
                    ) : (
                      write.valueWritten
                    )}
                  </td>
                  <td className="px-5 py-2">
                    <span className="text-xs text-ink-subtle">{write.sourceField}</span>
                    {write.wasLlmMapped && (
                      <Badge tone="warn" className="ml-2">
                        inferred
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ResolveForm taskId={task.id} unmappedLabels={unmapped} />
    </div>
  );
}
