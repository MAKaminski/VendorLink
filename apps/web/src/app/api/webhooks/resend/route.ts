import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { safeEqual } from '@vendorlink/core';
import { DirectoryRepository, emailMessages, tenants } from '@vendorlink/db';
import { db } from '@/lib/context';

/**
 * Delivery, bounce and complaint webhooks.
 *
 * §5.5: a hard bounce suppresses the address globally and immediately, and a
 * complaint additionally freezes the tenant's sending pending review. Both are
 * applied here rather than in a batch job, because the next Batch Connect
 * could start seconds later.
 */

export const dynamic = 'force-dynamic';

interface ResendEvent {
  type: string;
  data?: {
    email_id?: string;
    to?: string[];
    bounce?: { type?: string; message?: string };
    tags?: Record<string, string>;
  };
}

/**
 * Verify the provider signature.
 *
 * A webhook that suppresses addresses globally is a denial-of-service lever if
 * anyone can call it, so an unsigned request is rejected outright rather than
 * processed optimistically.
 */
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured means no provider is wired; refuse rather than
    // accept unauthenticated mutations of global state.
    return false;
  }
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, header.replace(/^sha256=/, ''));
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get('svix-signature') ?? request.headers.get('x-resend-signature'))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const database = db();
  const directory = new DirectoryRepository(database);
  const providerMessageId = event.data?.email_id ?? null;

  const [message] = providerMessageId
    ? await database
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.providerMessageId, providerMessageId))
        .limit(1)
    : [];

  const recipient =
    message?.toEmail ??
    (Array.isArray(event.data?.to) ? (event.data?.to as string[])[0] : undefined) ??
    null;

  switch (event.type) {
    case 'email.delivered':
      if (message) {
        await database
          .update(emailMessages)
          .set({ deliveredAt: new Date() })
          .where(eq(emailMessages.id, message.id));
      }
      break;

    case 'email.opened':
      if (message && !message.openedAt) {
        await database
          .update(emailMessages)
          .set({ openedAt: new Date() })
          .where(eq(emailMessages.id, message.id));
      }
      break;

    case 'email.bounced': {
      const bounceType = event.data?.bounce?.type ?? 'unknown';
      if (message) {
        await database
          .update(emailMessages)
          .set({ bouncedAt: new Date(), bounceType })
          .where(eq(emailMessages.id, message.id));
      }
      // Only a *hard* bounce suppresses. A soft bounce is a full mailbox or a
      // transient failure, and suppressing on those would throw away good
      // addresses across every tenant.
      if (recipient && /hard|permanent/i.test(bounceType)) {
        await directory.recordSignal({
          email: recipient,
          signal: 'hard_bounce',
          sourceTenantId: message?.tenantId ?? null,
          detail: event.data?.bounce?.message ?? bounceType,
        });
      }
      break;
    }

    case 'email.complained': {
      if (recipient) {
        await directory.recordSignal({
          email: recipient,
          signal: 'complaint',
          sourceTenantId: message?.tenantId ?? null,
          detail: 'spam complaint',
        });
      }
      // Freeze the tenant: a complaint is a trust problem with how this
      // workspace is sending, not just with one recipient.
      if (message?.tenantId) {
        await database
          .update(tenants)
          .set({
            sendingFrozenAt: new Date(),
            sendingFrozenReason: 'Spam complaint received. Pending review.',
          })
          .where(eq(tenants.id, message.tenantId));
      }
      break;
    }

    default:
      // Unknown event types are acknowledged so the provider stops retrying.
      break;
  }

  return NextResponse.json({ received: true });
}
