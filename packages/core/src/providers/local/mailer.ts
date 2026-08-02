import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  DomainVerificationStatus,
  Mailer,
  SendMailInput,
  SendMailResult,
} from '../types.js';

/**
 * Mailer that writes RFC-822 `.eml` files to a directory instead of sending.
 *
 * This is what the P2 gate asserts against: "one-click send works end-to-end
 * against a fixture inbox" is a real assertion about a real serialized message
 * — headers, MIME parts, attachments — not a spy recording that `send` was
 * called. If the message we build is malformed, the test sees it.
 */
export class LocalMailer implements Mailer {
  private readonly inboxDir: string;

  constructor(opts?: { inboxDir?: string }) {
    this.inboxDir = resolve(opts?.inboxDir ?? process.env.FIXTURE_INBOX_DIR ?? '.fixture-inbox');
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const providerMessageId = `local-${randomUUID()}`;
    const sentAt = new Date();
    await mkdir(this.inboxDir, { recursive: true });
    const filename = `${sentAt.toISOString().replace(/[:.]/g, '-')}-${providerMessageId}.eml`;
    await writeFile(
      join(this.inboxDir, filename),
      serializeEml(input, providerMessageId, sentAt),
      'utf8',
    );
    return { providerMessageId, sentAt };
  }

  /**
   * With no provider there is no DNS to check, so the local mailer reports a
   * verified domain. Deliberate: it keeps the P2 send path exercisable in this
   * container. The Resend implementation does the real SPF/DKIM/DMARC check,
   * and the send-gate reads whichever mailer is configured.
   */
  async getDomainStatus(domain: string): Promise<DomainVerificationStatus> {
    return {
      domain,
      verified: true,
      spf: 'ok',
      dkim: 'ok',
      dmarc: 'ok',
      pendingRecords: [],
    };
  }

  inboxPath(): string {
    return this.inboxDir;
  }

  /** Read back what was "sent" — the assertion surface for E2E tests. */
  async readInbox(): Promise<Array<{ filename: string; raw: string }>> {
    let names: string[];
    try {
      names = await readdir(this.inboxDir);
    } catch {
      return [];
    }
    const messages = await Promise.all(
      names
        .filter((n) => n.endsWith('.eml'))
        .sort()
        .map(async (filename) => ({
          filename,
          raw: await readFile(join(this.inboxDir, filename), 'utf8'),
        })),
    );
    return messages;
  }
}

function encodeHeaderValue(value: string): string {
  // RFC 2047 for anything outside ASCII, so accented company names survive.
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function foldBase64(input: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < input.length; i += width) lines.push(input.slice(i, i + width));
  return lines.join('\r\n');
}

export function serializeEml(input: SendMailInput, messageId: string, sentAt: Date): string {
  const boundary = `----vendorlink-${messageId}`;
  const altBoundary = `----vendorlink-alt-${messageId}`;
  const hasAttachments = (input.attachments?.length ?? 0) > 0;

  const headers: string[] = [
    `Message-ID: <${messageId}@vendorlink.local>`,
    `Date: ${sentAt.toUTCString()}`,
    `From: ${input.fromName ? `${encodeHeaderValue(input.fromName)} <${input.from}>` : input.from}`,
    `To: ${input.to}`,
  ];
  if (input.cc?.length) headers.push(`Cc: ${input.cc.join(', ')}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  for (const [k, v] of Object.entries(input.headers ?? {})) headers.push(`${k}: ${v}`);
  for (const [k, v] of Object.entries(input.tags ?? {})) headers.push(`X-Tag-${k}: ${v}`);
  headers.push('MIME-Version: 1.0');
  headers.push(
    hasAttachments
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
  );

  const alternative = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(input.text, 'utf8').toString('base64')),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(input.html, 'utf8').toString('base64')),
    '',
    `--${altBoundary}--`,
  ].join('\r\n');

  if (!hasAttachments) {
    return `${headers.join('\r\n')}\r\n\r\n${alternative}\r\n`;
  }

  const parts: string[] = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    alternative,
    '',
  ];

  for (const attachment of input.attachments ?? []) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      foldBase64(attachment.content.toString('base64')),
      '',
    );
  }
  parts.push(`--${boundary}--`);

  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
}
