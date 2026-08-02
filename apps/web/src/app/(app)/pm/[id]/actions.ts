'use server';

import { z } from 'zod';
import { DirectoryRepository } from '@vendorlink/db';
import { apiContext, db, mailer, objectStore } from '@/lib/context';
import { runEmailTask } from '@/lib/run-email-task';

const schema = z.object({
  pmCompanyId: z.string().uuid(),
  tracks: z.array(z.enum(['EMAIL', 'PORTAL'])).min(1),
});

/**
 * Dispatch a ConnectionRun.
 *
 * The run is created idempotently, so five concurrent clicks collapse to one;
 * tasks are only created when the run is new, which is what stops a repeat
 * click from queueing a second email against the same run.
 */
export async function createConnection(input: {
  pmCompanyId: string;
  tracks: Array<'EMAIL' | 'PORTAL'>;
}): Promise<{ runId: string } | { error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid request.' };

  const ctx = await apiContext();
  if (!ctx) return { error: 'Your session expired. Sign in again.' };

  const directory = new DirectoryRepository(db());
  const company = await directory.findById(parsed.data.pmCompanyId);
  if (!company) return { error: 'That company is no longer in the directory.' };

  const profileVersion = await ctx.repos.profile.currentVersion();
  const { run, created } = await ctx.repos.runs.createIdempotent({
    pmCompanyId: company.id,
    profileVersion,
  });

  if (created) {
    const [contact, channels] = await Promise.all([
      directory.bestContact(company.id),
      directory.listChannels(company.id),
    ]);
    const formChannel = channels.find(
      (c) => c.kind === 'WEB_FORM' || c.kind === 'CONTACT_FORM' || c.kind === 'PORTAL',
    );

    if (parsed.data.tracks.includes('EMAIL')) {
      await ctx.repos.tasks.createTask({
        runId: run.id,
        kind: 'EMAIL',
        resolvedContactId: contact?.id ?? null,
      });
    }
    if (parsed.data.tracks.includes('PORTAL') && formChannel) {
      await ctx.repos.tasks.createTask({
        runId: run.id,
        kind: 'PORTAL',
        pmChannelId: formChannel.id,
      });
    }
    await ctx.repos.runs.recomputeStatus(run.id);

    // Execute the email track inline. A durable queue (Inngest) owns this in
    // production; running it here keeps the one-click promise intact without a
    // queue, and the task's own state machine is what makes it resumable
    // either way.
    const emailTask = (await ctx.repos.tasks.listForRun(run.id)).find((t) => t.kind === 'EMAIL');
    if (emailTask) {
      await runEmailTask(emailTask.id, {
        db: db(),
        repos: ctx.repos,
        mailer: mailer(),
        store: objectStore(),
        appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
      });
    }
  }

  return { runId: run.id };
}
