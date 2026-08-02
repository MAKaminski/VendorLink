import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { AnthropicLlmClient, DisabledLlmClient, safeEqual, type LlmClient } from '@vendorlink/core';
import { classifyDeterministic, classifyReply, runIdFromReplyTo, signalForClassification } from '@vendorlink/email';
import {
  DirectoryRepository,
  connectionRuns,
  emailMessages,
  pmReplies,
  repositoriesFor,
} from '@vendorlink/db';
import { db } from '@/lib/context';

/**
 * Inbound replies.
 *
 * A reply arrives at `reply+{runId}@inbound.{domain}`, which is what threads it
 * back to the run without any fuzzy matching on subject lines. The
 * classification then feeds `GlobalContactSignal`, so a PM confirming the
 * address improves resolution for every other tenant.
 */

export const dynamic = 'force-dynamic';

interface InboundPayload {
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  headers?: Record<string, string>;
}

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, header.replace(/^sha256=/, ''));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get('x-inbound-signature'))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = JSON.parse(rawBody) as InboundPayload;
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to ?? ''];
  const runId = recipients.map((r) => runIdFromReplyTo(r)).find((id): id is string => Boolean(id));

  if (!runId) {
    // Not a reply to one of our runs; acknowledge so the provider stops
    // retrying rather than treating it as an outage.
    return NextResponse.json({ received: true, matched: false });
  }

  const database = db();
  const [run] = await database
    .select()
    .from(connectionRuns)
    .where(eq(connectionRuns.id, runId))
    .limit(1);
  if (!run) return NextResponse.json({ received: true, matched: false });

  const repos = repositoriesFor(database, run.tenantId);
  const directory = new DirectoryRepository(database);

  const input = {
    fromEmail: (payload.from ?? '').trim().toLowerCase(),
    subject: payload.subject ?? '',
    bodyText: payload.text ?? '',
    ...(payload.headers ? { headers: payload.headers } : {}),
  };

  // Deterministic first; the model only sees replies a human wrote, and only
  // when a key is configured.
  const llm: LlmClient = process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlmClient()
    : new DisabledLlmClient();

  let result;
  try {
    result = await classifyReply(input, llm);
  } catch {
    // Losing the model must not lose the reply.
    result = classifyDeterministic(input) ?? {
      classification: 'other' as const,
      confidence: 0,
      method: 'deterministic' as const,
      evidence: null,
      extracted: {},
    };
  }

  await database.insert(pmReplies).values({
    pmCompanyId: run.pmCompanyId,
    tenantId: run.tenantId,
    runId: run.id,
    fromEmail: input.fromEmail,
    subject: input.subject,
    bodyText: input.bodyText,
    classification: result.classification,
    extracted: { ...result.extracted, method: result.method, evidence: result.evidence },
  });

  // Mark the originating message replied-to, for the reply-rate metric.
  const tasks = await repos.tasks.listForRun(run.id);
  const emailTask = tasks.find((t) => t.kind === 'EMAIL');
  if (emailTask) {
    await database
      .update(emailMessages)
      .set({ repliedAt: new Date() })
      .where(eq(emailMessages.taskId, emailTask.id));

    await repos.events.append({
      taskId: emailTask.id,
      eventType: 'email.reply_received',
      message: `Reply from ${input.fromEmail} classified as ${result.classification}`,
      data: { classification: result.classification, confidence: result.confidence },
    });
  }

  // The compounding effect: this tenant's reply changes what every other
  // tenant's resolver sees for this address.
  const signal = signalForClassification(result.classification);
  if (signal) {
    await directory.recordSignal({
      email: input.fromEmail,
      pmCompanyId: run.pmCompanyId,
      signal,
      sourceTenantId: run.tenantId,
      detail: result.evidence ?? result.classification,
    });
  }

  return NextResponse.json({ received: true, matched: true, classification: result.classification });
}
