import Link from 'next/link';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardHeader, EmptyState, LinkButton, type Tone } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * The Needs-Attention queue (§7.3).
 *
 * Each item says *why* it parked, because the operator's next action is
 * entirely determined by that: a CAPTCHA needs thirty seconds of clicking, a
 * paywall needs a purchasing decision, and an unmapped field needs one answer
 * that then makes every other tenant's run automatic.
 */

const REASON_COPY: Record<string, { label: string; tone: Tone; action: string }> = {
  captcha_required: {
    label: 'CAPTCHA',
    tone: 'warn',
    action: 'Solve the CAPTCHA and submit. The form is already filled.',
  },
  account_required: {
    label: 'Account required',
    tone: 'warn',
    action: 'This portal needs an account before an application can be submitted.',
  },
  payment_required: {
    label: 'Vendor fee',
    tone: 'warn',
    action: 'This portal charges a fee. Decide whether it is worth it before proceeding.',
  },
  tos_restricted: {
    label: 'Terms restricted',
    tone: 'bad',
    action: 'This platform’s terms do not permit automated submission.',
  },
  low_confidence_mapping: {
    label: 'Low confidence',
    tone: 'warn',
    action: 'Check the pre-filled values before submitting.',
  },
  unmapped_required_field: {
    label: 'Unknown field',
    tone: 'warn',
    action: 'Answer the one field we could not work out. We’ll remember it.',
  },
  form_not_found: {
    label: 'No form found',
    tone: 'neutral',
    action: 'We could not find an application form on the page.',
  },
  first_submission_approval: {
    label: 'Awaiting your review',
    tone: 'brand',
    action: 'Your workspace holds the first submission to each new form.',
  },
};

export default async function AttentionPage() {
  const { repos } = await requireContext();
  const tasks = await repos.tasks.listNeedingAttention();
  const directory = new DirectoryRepository(db());

  const items = await Promise.all(
    tasks.map(async (task) => {
      const run = await repos.runs.findById(task.runId);
      return {
        task,
        run,
        company: run ? await directory.findById(run.pmCompanyId) : null,
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Needs attention</h1>
          <p className="text-sm text-ink-muted">
            Runs the automation could not finish on its own. Each one is already filled — most
            take under a minute.
          </p>
        </div>
        {items.length > 0 && <Badge tone="warn">{items.length} waiting</Badge>}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing needs your attention"
            body="Every run either completed or is still in flight."
            action={<LinkButton href="/connections">View connections</LinkButton>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map(({ task, run, company }) => {
            const copy = REASON_COPY[task.failureClass ?? ''] ?? {
              label: task.failureClass ?? 'Parked',
              tone: 'neutral' as Tone,
              action: task.failureReason ?? 'Review and finish this submission.',
            };
            return (
              <Card key={task.id}>
                <CardHeader className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      {company?.name ?? 'Unknown company'}
                    </h2>
                    <p className="text-xs text-ink-muted">
                      {task.kind === 'PORTAL' ? 'Application form' : 'Email'} ·{' '}
                      {task.finishedAt?.toLocaleString() ?? 'just now'}
                    </p>
                  </div>
                  <Badge tone={copy.tone}>{copy.label}</Badge>
                </CardHeader>
                <div className="space-y-3 px-5 py-4">
                  <p className="text-sm text-ink">{copy.action}</p>
                  {task.failureReason && (
                    <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
                      {task.failureReason}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {run && (
                      <LinkButton href={`/connections/${run.id}`} size="sm">
                        View trace
                      </LinkButton>
                    )}
                    {task.pmChannelId && (
                      <Link
                        href={`/attention/${task.id}`}
                        className="inline-flex items-center rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                      >
                        Resume
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
