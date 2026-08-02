import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardBody, CardHeader, EmptyState, type Tone } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TASK_TONE: Record<string, Tone> = {
  succeeded: 'ok',
  submitted_unconfirmed: 'warn',
  needs_attention: 'warn',
  failed: 'bad',
  cancelled: 'neutral',
  skipped: 'neutral',
  running: 'brand',
  queued: 'neutral',
};

const LEVEL_TONE: Record<string, string> = {
  error: 'text-bad',
  warn: 'text-warn',
  info: 'text-ink-muted',
  debug: 'text-ink-subtle',
};

/**
 * One run, with the live two-track timeline.
 *
 * The timeline is rendered straight from `task_events`, which is append-only —
 * so what an operator reads here is the record of what happened, not a
 * summary something else wrote afterwards.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { repos } = await requireContext();
  const { id } = await params;

  const run = await repos.runs.findById(id);
  if (!run) notFound();

  const [tasks, company] = await Promise.all([
    repos.tasks.listForRun(run.id),
    new DirectoryRepository(db()).findById(run.pmCompanyId),
  ]);

  const events = await Promise.all(
    tasks.map(async (task) => ({ task, events: await repos.events.listForTask(task.id) })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/connections" className="text-sm text-ink-muted hover:text-ink">
        ← All connections
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{company?.name ?? 'Connection'}</h1>
          <p className="text-sm text-ink-muted">Started {run.createdAt.toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          {tasks.map((task) => (
            <Badge key={task.id} tone={TASK_TONE[task.status ?? 'queued'] ?? 'neutral'}>
              {task.kind === 'EMAIL' ? 'Email' : 'Portal'} · {task.status}
            </Badge>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="No tracks queued" body="This run has no tasks." />
      ) : (
        events.map(({ task, events: taskEvents }) => (
          <Card key={task.id}>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">
                  {task.kind === 'EMAIL' ? 'Email track' : 'Portal track'}
                </h2>
                {task.failureReason && (
                  <p className="text-xs text-bad">{task.failureReason}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {task.attempt > 0 && (
                  <span className="text-xs text-ink-subtle">
                    attempt {task.attempt}/{task.maxAttempts}
                  </span>
                )}
                <Badge tone={TASK_TONE[task.status ?? 'queued'] ?? 'neutral'}>{task.status}</Badge>
              </div>
            </CardHeader>
            <CardBody>
              {taskEvents.length === 0 ? (
                <p className="text-sm text-ink-muted">Waiting to start…</p>
              ) : (
                <ol className="space-y-2">
                  {taskEvents.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="w-20 shrink-0 font-mono text-xs text-ink-subtle">
                        {event.ts.toLocaleTimeString()}
                      </span>
                      <span className={LEVEL_TONE[event.level ?? 'info'] ?? 'text-ink-muted'}>
                        {event.message}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
