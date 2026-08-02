import type { Mailer, ObjectStore } from '@vendorlink/core';
import type { VendorProfile } from '@vendorlink/core/domain';
import { assembleAttachments, replyToAddress } from './attachments';
import { renderPacketEmail } from './template';
import { evaluateSendGate, failureClassFor, type SendGateInput } from './send-gate';

/**
 * Send one packet.
 *
 * The gate runs first and the result is returned rather than thrown, because
 * "blocked" is an ordinary outcome the Connection Console has to display with
 * a reason — not an exception.
 *
 * This function performs exactly one external side effect, and only after
 * every check has passed. The caller writes the audit rows either side of it.
 */

export interface SendPacketInput {
  readonly profile: VendorProfile;
  readonly pmCompanyName: string;
  readonly recipient: string | null;
  readonly ccRecipient?: string | null;
  readonly runId: string;
  readonly fromAddress: string;
  readonly inboundDomain: string;
  readonly senderPostalAddress: string;
  readonly optOutUrl: string;
  readonly trackingPixelUrl?: string;
  readonly gate: Omit<SendGateInput, 'recipient'>;
}

export type SendPacketResult =
  | {
      sent: true;
      providerMessageId: string;
      sentAt: Date;
      subject: string;
      bodyHtml: string;
      recipient: string;
      attachments: Array<{ filename: string; bytes: number }>;
      overflowLinkCount: number;
      warnings: string[];
    }
  | {
      sent: false;
      reason: string;
      failureClass: string;
      detail: string;
      retryAfter?: Date;
    };

export async function sendPacket(
  input: SendPacketInput,
  deps: { mailer: Mailer; store: ObjectStore },
): Promise<SendPacketResult> {
  const gate = evaluateSendGate({ ...input.gate, recipient: input.recipient });
  if (!gate.allowed) {
    return {
      sent: false,
      reason: gate.reason,
      failureClass: failureClassFor(gate.reason),
      detail: gate.detail,
      ...(gate.retryAfter ? { retryAfter: gate.retryAfter } : {}),
    };
  }

  const recipient = input.recipient as string;

  const assembled = await assembleAttachments(input.profile.documents, deps.store);
  const rendered = renderPacketEmail({
    profile: input.profile,
    pmCompanyName: input.pmCompanyName,
    senderPostalAddress: input.senderPostalAddress,
    optOutUrl: input.optOutUrl,
    ...(assembled.overflowLinks.length > 0 ? { overflowLinks: assembled.overflowLinks } : {}),
    ...(input.trackingPixelUrl ? { trackingPixelUrl: input.trackingPixelUrl } : {}),
  });

  const result = await deps.mailer.send({
    from: input.fromAddress,
    fromName: input.profile.legal_name,
    to: recipient,
    // §5.5: one recipient per message, at most one CC. No BCC blasting.
    ...(input.ccRecipient ? { cc: [input.ccRecipient] } : {}),
    replyTo: replyToAddress(input.runId, input.inboundDomain),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [...assembled.attachments],
    headers: {
      // Honest headers, and a machine-readable opt-out for clients that offer
      // one — both CAN-SPAM expectations.
      'List-Unsubscribe': `<${input.optOutUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: { run_id: input.runId },
  });

  return {
    sent: true,
    providerMessageId: result.providerMessageId,
    sentAt: result.sentAt,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    recipient,
    attachments: assembled.attachments.map((a) => ({
      filename: a.filename,
      bytes: a.content.byteLength,
    })),
    overflowLinkCount: assembled.overflowLinks.length,
    // Documents that could not be read are reported, never silently dropped:
    // a vendor whose COI failed to attach needs to know before the PM does.
    warnings: assembled.failed.map((f) => `${f.label}: ${f.error}`),
  };
}
