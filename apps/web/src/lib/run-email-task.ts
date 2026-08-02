import { and, eq, sql } from 'drizzle-orm';
import type { Mailer, ObjectStore } from '@vendorlink/core';
import { sendPacket } from '@vendorlink/email';
import {
  DirectoryRepository,
  emailMessages,
  sendCounters,
  tenants,
  type Database,
  type TenantRepositories,
} from '@vendorlink/db';

/**
 * Execute one EMAIL task.
 *
 * Every external side effect in this product has to be idempotent and has to
 * write an immutable audit row before and after execution. That shape is
 * literal here: an event is appended before the send, the send happens once,
 * and an event plus an `email_messages` row are appended after — whether it
 * succeeded, was blocked, or threw.
 */

export interface EmailTaskDeps {
  db: Database;
  repos: TenantRepositories;
  mailer: Mailer;
  store: ObjectStore;
  appBaseUrl: string;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Today's send count, used by the warm-up governor. */
async function sentToday(db: Database, tenantId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ sent: sendCounters.sent })
    .from(sendCounters)
    .where(and(eq(sendCounters.tenantId, tenantId), eq(sendCounters.day, utcDay(now))))
    .limit(1);
  return row?.sent ?? 0;
}

/**
 * Increment the counter atomically.
 *
 * A read-modify-write here would let two concurrent Batch Connect workers both
 * see the same count and exceed the cap, which is exactly the failure the
 * governor exists to prevent.
 */
async function incrementSendCount(db: Database, tenantId: string, now: Date): Promise<void> {
  await db
    .insert(sendCounters)
    .values({ tenantId, day: utcDay(now), sent: 1 })
    .onConflictDoUpdate({
      target: [sendCounters.tenantId, sendCounters.day],
      set: { sent: sql`${sendCounters.sent} + 1` },
    });
}

export async function runEmailTask(
  taskId: string,
  deps: EmailTaskDeps,
): Promise<{ ok: boolean; detail: string }> {
  const { repos, db } = deps;
  const now = new Date();

  const task = await repos.tasks.findById(taskId);
  if (!task) return { ok: false, detail: 'task not found' };

  const run = await repos.runs.findById(task.runId);
  if (!run) return { ok: false, detail: 'run not found' };

  await repos.tasks.markRunning(taskId);
  await repos.events.append({
    taskId,
    eventType: 'email.started',
    message: 'Preparing the vendor packet',
  });

  try {
    const directory = new DirectoryRepository(db);
    const [company, profile, tenantRow] = await Promise.all([
      directory.findById(run.pmCompanyId),
      repos.profile.get(),
      db.select().from(tenants).where(eq(tenants.id, repos.tenantId)).limit(1),
    ]);
    const tenant = tenantRow[0];

    if (!company || !profile || !tenant) {
      throw new Error('missing company, profile or tenant');
    }

    const allContacts = await directory.listContacts(company.id);
    const contact = task.resolvedContactId
      ? allContacts.find((c) => c.id === task.resolvedContactId)
      : await directory.bestContact(company.id);

    let recipient = contact?.email ?? null;
    let suppressed = recipient ? await directory.isSuppressed(recipient) : false;
    let hardBounced = contact?.hardBounced ?? false;

    // `bestContact` filters suppressed addresses out, so a company whose only
    // contact has bounced looks identical to one we never resolved. Those are
    // different problems — "it stopped working" vs "we never found anyone" —
    // and the operator needs to be told which. Re-check the full set so the
    // gate can report the accurate reason.
    if (!recipient && allContacts.length > 0) {
      const blocked = await Promise.all(
        allContacts.map(async (c) => ({
          contact: c,
          blocked: c.hardBounced || (await directory.isSuppressed(c.email)),
        })),
      );
      if (blocked.every((b) => b.blocked)) {
        const first = blocked[0]?.contact;
        if (first) {
          recipient = first.email;
          hardBounced = first.hardBounced;
          suppressed = true;
        }
      }
    }

    await repos.events.append({
      taskId,
      eventType: 'email.recipient_resolved',
      message: recipient
        ? `Sending to ${recipient} (${Math.round((contact?.confidence ?? 0) * 100)}% confidence)`
        : 'No deliverable contact resolved',
      data: { recipient, contactId: contact?.id ?? null },
    });

    const optOutUrl = `${deps.appBaseUrl}/opt-out/${run.id}`;

    const result = await sendPacket(
      {
        profile,
        pmCompanyName: company.name,
        recipient,
        runId: run.id,
        fromAddress: profile.primary_contact_email ?? `vendor@${tenant.sendingDomain ?? 'localhost'}`,
        inboundDomain: `inbound.${tenant.sendingDomain ?? 'localhost'}`,
        senderPostalAddress: [
          profile.legal_name,
          profile.address_line1,
          profile.address_line2,
          [profile.city, profile.state, profile.postal].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', '),
        optOutUrl,
        gate: {
          sendingDomainVerified:
            Boolean(tenant.sendingDomainVerifiedAt) || (await isLocalMailer(deps.mailer)),
          sendingFrozenAt: tenant.sendingFrozenAt,
          recipientSuppressed: suppressed,
          recipientHardBounced: hardBounced,
          sentToday: await sentToday(db, repos.tenantId, now),
          warmupStartedOn: tenant.sendingWarmupStartedOn
            ? new Date(tenant.sendingWarmupStartedOn)
            : null,
          now,
        },
      },
      { mailer: deps.mailer, store: deps.store },
    );

    if (!result.sent) {
      await repos.events.append({
        taskId,
        level: 'warn',
        eventType: 'email.blocked',
        message: result.detail,
        data: { reason: result.reason },
      });
      await repos.tasks.finish(taskId, {
        status: result.reason === 'daily_cap_reached' ? 'queued' : 'failed',
        failureReason: result.detail,
        failureClass: result.failureClass as never,
        ...(result.retryAfter ? { nextRetryAt: result.retryAfter } : {}),
      });
      await repos.runs.recomputeStatus(run.id);
      return { ok: false, detail: result.detail };
    }

    await incrementSendCount(db, repos.tenantId, now);

    await db.insert(emailMessages).values({
      taskId,
      tenantId: repos.tenantId,
      providerMessageId: result.providerMessageId,
      toEmail: result.recipient,
      subject: result.subject,
      bodyHtml: result.bodyHtml,
      attachments: result.attachments.map((a) => ({ filename: a.filename, bytes: a.bytes })),
      sentAt: result.sentAt,
    });

    for (const warning of result.warnings) {
      await repos.events.append({
        taskId,
        level: 'warn',
        eventType: 'email.attachment_problem',
        message: warning,
      });
    }

    await repos.events.append({
      taskId,
      eventType: 'email.sent',
      message: `Packet sent to ${result.recipient} with ${result.attachments.length} attachment(s)`,
      data: {
        providerMessageId: result.providerMessageId,
        overflowLinks: result.overflowLinkCount,
      },
    });

    await repos.tasks.finish(taskId, { status: 'succeeded' });
    await repos.runs.recomputeStatus(run.id);
    return { ok: true, detail: `sent to ${result.recipient}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    await repos.events.append({
      taskId,
      level: 'error',
      eventType: 'email.failed',
      message: detail,
    });
    await repos.tasks.finish(taskId, {
      status: 'failed',
      failureReason: detail,
      failureClass: 'internal_error',
    });
    await repos.runs.recomputeStatus(run.id);
    return { ok: false, detail };
  }
}

/**
 * The local mailer has no DNS to verify, so it reports its domain verified.
 * Reading that through the same interface keeps the gate honest: with Resend
 * configured, an unverified domain still blocks.
 */
async function isLocalMailer(mailer: Mailer): Promise<boolean> {
  const status = await mailer.getDomainStatus('localhost');
  return status?.verified === true;
}
