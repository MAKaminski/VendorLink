import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalMailer, LocalObjectStore, sha256Hex } from '@vendorlink/core';
import { assembleAttachments, runIdFromReplyTo, replyToAddress } from '../src/attachments';
import { sendPacket, type SendPacketInput } from '../src/send-packet';
import { completeProfile } from './fixtures/profile';

/**
 * The P2 gate: one-click send works end to end against a fixture inbox.
 *
 * The assertions are made against the serialized RFC-822 message the mailer
 * actually wrote, not against a spy recording that `send` was called — so a
 * malformed MIME structure or a missing compliance header fails the test.
 */

const RUN_ID = '11111111-2222-4333-8444-555555555555';

let storeRoot: string;
let inboxDir: string;
let store: LocalObjectStore;
let mailer: LocalMailer;

beforeAll(async () => {
  storeRoot = await mkdtemp(join(tmpdir(), 'vl-mail-store-'));
  inboxDir = await mkdtemp(join(tmpdir(), 'vl-inbox-'));
  store = new LocalObjectStore({ root: storeRoot, signingKey: 'test-key' });
  mailer = new LocalMailer({ inboxDir });

  // Store bytes for the profile's two documents so attachment assembly has
  // something real to read and verify.
  for (const document of completeProfile().documents) {
    const body = Buffer.from(`%PDF-1.7\n${document.kind} contents\n`);
    await store.put({ key: document.r2_key, body, contentType: document.mime });
  }
});

afterAll(async () => {
  await rm(storeRoot, { recursive: true, force: true });
  await rm(inboxDir, { recursive: true, force: true });
});

/**
 * The fixture declares placeholder digests and sizes; align both with the
 * bytes actually written to the store. Size matters because assembly decides
 * what fits from the *declared* size — so it never downloads a large document
 * only to discover it has to be a link instead.
 */
function profileWithRealDigests() {
  const profile = completeProfile();
  return {
    ...profile,
    documents: profile.documents.map((d) => {
      const body = Buffer.from(`%PDF-1.7\n${d.kind} contents\n`);
      return { ...d, sha256: sha256Hex(body), bytes: body.byteLength };
    }),
  };
}

/** Subjects are RFC 2047 encoded when they contain non-ASCII (an em dash here). */
function decodeSubject(raw: string): string {
  const match = /^Subject: (.*)$/m.exec(raw);
  const value = match?.[1]?.trim() ?? '';
  const encoded = /^=\?UTF-8\?B\?(.*)\?=$/i.exec(value);
  return encoded ? Buffer.from(encoded[1] as string, 'base64').toString('utf8') : value;
}

function sendInput(over: Partial<SendPacketInput> = {}): SendPacketInput {
  return {
    profile: profileWithRealDigests(),
    pmCompanyName: 'Oakwood Residential',
    recipient: 'vendors@oakwood.example',
    runId: RUN_ID,
    fromAddress: 'dana@peachtreegrounds.example',
    inboundDomain: 'inbound.peachtreegrounds.example',
    senderPostalAddress: '1180 Marietta St NW, Suite 210, Atlanta, GA 30318',
    optOutUrl: 'https://vendorlink.app/opt-out/abc',
    gate: {
      sendingDomainVerified: true,
      sendingFrozenAt: null,
      recipientSuppressed: false,
      recipientHardBounced: false,
      sentToday: 0,
      warmupStartedOn: new Date('2026-01-01T00:00:00Z'),
      now: new Date('2026-08-02T12:00:00Z'),
    },
    ...over,
  };
}

describe('one-click send', () => {
  it('delivers a well-formed message to the fixture inbox', async () => {
    const result = await sendPacket(sendInput(), { mailer, store });
    expect(result.sent).toBe(true);
    if (!result.sent) return;

    const inbox = await mailer.readInbox();
    expect(inbox.length).toBeGreaterThan(0);
    const raw = inbox.at(-1)!.raw;

    expect(raw).toContain('To: vendors@oakwood.example');
    expect(raw).toContain('From: Peachtree Grounds & Landscape LLC <dana@peachtreegrounds.example>');
    expect(decodeSubject(raw)).toMatch(/^Vendor application — Peachtree Grounds/);
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('multipart/alternative');
  });

  it('threads replies back to the run via a Reply-To subaddress', async () => {
    const inbox = await mailer.readInbox();
    const raw = inbox.at(-1)!.raw;
    const replyTo = `reply+${RUN_ID}@inbound.peachtreegrounds.example`;
    expect(raw).toContain(`Reply-To: ${replyTo}`);
    expect(runIdFromReplyTo(replyTo)).toBe(RUN_ID);
  });

  it('carries the machine-readable opt-out headers', async () => {
    const raw = (await mailer.readInbox()).at(-1)!.raw;
    expect(raw).toContain('List-Unsubscribe: <https://vendorlink.app/opt-out/abc>');
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });

  it('attaches the W-9 and the COI', async () => {
    const raw = (await mailer.readInbox()).at(-1)!.raw;
    expect(raw).toMatch(/Content-Disposition: attachment; filename="w-9[^"]*"/i);
    expect(raw).toMatch(/Content-Disposition: attachment; filename="coi[^"]*"/i);
  });

  it('sends to exactly one recipient and at most one CC', async () => {
    const withCc = await sendPacket(
      sendInput({ ccRecipient: 'procurement@oakwood.example' }),
      { mailer, store },
    );
    expect(withCc.sent).toBe(true);
    const raw = (await mailer.readInbox()).at(-1)!.raw;
    expect(raw).toContain('Cc: procurement@oakwood.example');
    // No BCC blasting, ever.
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw.match(/^To:/gim)).toHaveLength(1);
  });
});

describe('blocked sends produce no message', () => {
  async function assertNoNewMessage(input: SendPacketInput) {
    const before = (await mailer.readInbox()).length;
    const result = await sendPacket(input, { mailer, store });
    expect(result.sent).toBe(false);
    expect((await mailer.readInbox()).length).toBe(before);
    return result;
  }

  it('does not send when the domain is unverified', async () => {
    const result = await assertNoNewMessage(
      sendInput({ gate: { ...sendInput().gate, sendingDomainVerified: false } }),
    );
    if (!result.sent) expect(result.failureClass).toBe('send_blocked_unverified_domain');
  });

  it('does not send to a suppressed recipient', async () => {
    const result = await assertNoNewMessage(
      sendInput({ gate: { ...sendInput().gate, recipientSuppressed: true } }),
    );
    if (!result.sent) expect(result.failureClass).toBe('send_blocked_suppressed');
  });

  it('does not send past the daily cap', async () => {
    const result = await assertNoNewMessage(
      sendInput({ gate: { ...sendInput().gate, sentToday: 500 } }),
    );
    if (!result.sent) expect(result.failureClass).toBe('send_blocked_rate_limit');
  });

  it('does not send with no resolved recipient', async () => {
    const result = await assertNoNewMessage(sendInput({ recipient: null }));
    if (!result.sent) expect(result.failureClass).toBe('no_contact_found');
  });
});

describe('attachment assembly', () => {
  it('verifies each document against its recorded digest', async () => {
    const profile = profileWithRealDigests();
    const assembled = await assembleAttachments(profile.documents, store);
    expect(assembled.attachments).toHaveLength(2);
    expect(assembled.failed).toHaveLength(0);
  });

  it('refuses a document whose bytes no longer match its digest', async () => {
    // A silently corrupted COI is worse than a missing one: it gets the
    // vendor rejected and nobody knows why.
    const profile = completeProfile();
    const assembled = await assembleAttachments(profile.documents, store);
    expect(assembled.attachments).toHaveLength(0);
    expect(assembled.failed).toHaveLength(2);
    expect(assembled.failed[0]?.error).toMatch(/do not match the recorded digest/);
  });

  it('reports unreadable documents rather than dropping them', async () => {
    const profile = profileWithRealDigests();
    const missing = {
      ...profile,
      documents: [
        ...profile.documents,
        {
          id: 'missing',
          kind: 'PRICEBOOK' as const,
          label: 'Pricebook',
          r2_key: 'tenants/x/documents/gone/pricebook.pdf',
          mime: 'application/pdf',
          bytes: 100,
          sha256: 'f'.repeat(64),
          is_current: true,
        },
      ],
    };
    const assembled = await assembleAttachments(missing.documents, store);
    expect(assembled.failed.map((f) => f.label)).toContain('Pricebook');
  });

  it('attaches the W-9 and COI first and links the rest past the cap', async () => {
    const profile = profileWithRealDigests();
    // A cap that fits only the first document forces the rest to links.
    const firstDocBytes = profile.documents[0]!.bytes;
    const assembled = await assembleAttachments(profile.documents, store, {
      maxTotalBytes: firstDocBytes,
    });
    expect(assembled.attachments).toHaveLength(1);
    expect(assembled.attachments[0]?.filename.toLowerCase()).toContain('w-9');
    expect(assembled.overflowLinks).toHaveLength(1);
    expect(assembled.overflowLinks[0]?.url).toContain('/api/storage/');
  });

  it('skips documents that are not current', async () => {
    const profile = profileWithRealDigests();
    const superseded = profile.documents.map((d) => ({ ...d, is_current: false }));
    const assembled = await assembleAttachments(superseded, store);
    expect(assembled.attachments).toHaveLength(0);
  });
});

describe('reply-to round trip', () => {
  it('recovers the run id', () => {
    expect(runIdFromReplyTo(replyToAddress(RUN_ID, 'inbound.example'))).toBe(RUN_ID);
  });

  it('returns null for an unrelated address', () => {
    expect(runIdFromReplyTo('vendors@oakwood.example')).toBeNull();
    expect(runIdFromReplyTo('reply+not-a-uuid@inbound.example')).toBeNull();
  });
});
