import { NextResponse } from 'next/server';
import { LocalObjectStore } from '@vendorlink/core';

/**
 * Presigned object access for the local store.
 *
 * Objects are never public. A request must carry an HMAC signature over
 * (method, key, expiry, nonce), which is verified here before any bytes move —
 * the same contract S3 presigning gives us, enforced in application code
 * because the local store has no signing service of its own.
 */

export const dynamic = 'force-dynamic';

const signingKey = process.env.LOCAL_STORAGE_SIGNING_KEY ?? 'dev-only-signing-key';

function verify(request: Request, key: string, method: 'GET' | 'PUT') {
  const url = new URL(request.url);
  const expires = Number.parseInt(url.searchParams.get('expires') ?? '', 10);
  const nonce = url.searchParams.get('nonce');
  const signature = url.searchParams.get('signature');

  if (!Number.isFinite(expires) || !nonce || !signature) {
    return { ok: false as const, status: 400, reason: 'missing signature parameters' };
  }

  const result = LocalObjectStore.verifySignature({
    signingKey,
    method,
    key,
    expires,
    nonce,
    signature,
  });

  if (!result.ok) {
    return {
      ok: false as const,
      status: result.reason === 'expired' ? 410 : 403,
      reason: result.reason,
    };
  }
  return { ok: true as const };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const key = (await params).key.map(decodeURIComponent).join('/');
  const check = verify(request, key, 'GET');
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const store = new LocalObjectStore();
  const meta = await store.head(key);
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await store.get(key);
  const filename = new URL(request.url).searchParams.get('filename');

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': meta.contentType,
      'content-length': String(meta.bytes),
      'cache-control': 'private, no-store',
      ...(filename ? { 'content-disposition': `attachment; filename="${filename}"` } : {}),
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const key = (await params).key.map(decodeURIComponent).join('/');
  const check = verify(request, key, 'PUT');
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status });

  const contentType =
    new URL(request.url).searchParams.get('contentType') ??
    request.headers.get('content-type') ??
    'application/octet-stream';

  const body = Buffer.from(await request.arrayBuffer());
  const stored = await new LocalObjectStore().put({ key, body, contentType });

  return NextResponse.json(stored, { status: 201 });
}
