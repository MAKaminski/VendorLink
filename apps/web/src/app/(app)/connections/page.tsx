import Link from 'next/link';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardHeader, EmptyState, LinkButton, type Tone } from '@/components/ui';

export const dynamic = 'force-dynamic';

const RUN_TONE: Record<string, Tone> = {
  succeeded: 'ok',
  partial: 'warn',
  needs_attention: 'warn',
  failed: 'bad',
  running: 'brand',
  queued: 'neutral',
};

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'running', label: 'In flight' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'partial', label: 'Partial' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'failed', label: 'Failed' },
];

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { repos } = await requireContext();
  const { status } = await searchParams;

  const runs = await repos.runs.listRecent({ limit: 100, ...(status ? { status } : {}) });
  const directory = new DirectoryRepository(db());

  const rows = await Promise.all(
    runs.map(async (run) => ({
      run,
      company: await directory.findById(run.pmCompanyId),
      tasks: await repos.tasks.listForRun(run.id),
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Connections</h1>
          <p className="text-sm text-ink-muted">Every run, with its live status.</p>
        </div>
        <LinkButton href="/directory">Connect to another PM</LinkButton>
      </div>

      <Card>
        <CardHeader>
          <nav className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={filter.value ? `/connections?status=${filter.value}` : '/connections'}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  (status ?? '') === filter.value
                    ? 'bg-brand-subtle font-medium text-brand'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        </CardHeader>

        {rows.length === 0 ? (
          <EmptyState
            title="No connections yet"
            body="Pick a property manager from the directory and click Connect."
            action={<LinkButton href="/directory" variant="primary">Open the directory</LinkButton>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">PM company</th>
                <th className="px-5 py-2 font-medium">Tracks</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ run, company, tasks }) => (
                <tr key={run.id} className="hover:bg-surface-sunken">
                  <td className="px-5 py-3">
                    <Link
                      href={`/connections/${run.id}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {company?.name ?? 'Unknown company'}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tasks.map((task) => (
                        <Badge key={task.id} tone={RUN_TONE[task.status ?? 'queued'] ?? 'neutral'}>
                          {task.kind === 'EMAIL' ? 'Email' : 'Portal'}
                          {task.status === 'succeeded' ? ' ✓' : ''}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={RUN_TONE[run.status ?? 'queued'] ?? 'neutral'}>{run.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{run.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
