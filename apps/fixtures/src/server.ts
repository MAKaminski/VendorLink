import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FIXTURE_SITES, SITES_BY_SLUG } from '../sites/index';

/**
 * Fixture PM site server.
 *
 * Serves the twelve mock sites under `/{slug}/...` so the E2E suite has stable
 * targets. Also records every submission it receives, which is how the tests
 * assert what the worker actually posted rather than only that it navigated to
 * a thank-you page.
 */

const PORT = Number.parseInt(process.env.FIXTURES_PORT ?? '4321', 10);

export interface RecordedSubmission {
  readonly site: string;
  readonly path: string;
  readonly method: string;
  readonly fields: Record<string, string>;
  readonly files: string[];
  readonly receivedAt: string;
}

const submissions: RecordedSubmission[] = [];

function parseUrlPath(url: string): { slug: string; path: string } {
  const [pathname] = url.split('?');
  const parts = (pathname ?? '/').split('/').filter(Boolean);
  const slug = parts[0] ?? '';
  const rest = `/${parts.slice(1).join('/')}`;
  return { slug, path: rest === '/' ? '/' : rest.replace(/\/$/, '') };
}

/**
 * Minimal multipart and urlencoded body parsing.
 *
 * Enough to record what was submitted; this is a test fixture, not a server.
 */
function parseBody(body: string, contentType: string): { fields: Record<string, string>; files: string[] } {
  const fields: Record<string, string> = {};
  const files: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    const marker = boundary?.[1] ?? boundary?.[2];
    if (marker) {
      for (const part of body.split(`--${marker}`)) {
        const nameMatch = /name="([^"]+)"/.exec(part);
        if (!nameMatch) continue;
        const filenameMatch = /filename="([^"]*)"/.exec(part);
        const value = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n--$/, '').trim();
        if (filenameMatch && filenameMatch[1]) {
          files.push(filenameMatch[1]);
          fields[nameMatch[1] as string] = `<file: ${filenameMatch[1]}>`;
        } else {
          fields[nameMatch[1] as string] = value;
        }
      }
    }
  } else {
    for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
  }

  return { fields, files };
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/html') {
  res.writeHead(status, { 'content-type': `${contentType}; charset=utf-8` });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export const server = createServer(async (req, res) => {
  const { slug, path } = parseUrlPath(req.url ?? '/');

  // Index of every fixture, for a human poking around.
  if (slug === '') {
    return send(
      res,
      200,
      `<!doctype html><html><body><h1>Fixture PM sites</h1><ul>${FIXTURE_SITES.map(
        (s) =>
          `<li><a href="/${s.slug}/">${s.name}</a> — ${s.description} <em>(${s.expectation})</em></li>`,
      ).join('')}</ul></body></html>`,
    );
  }

  // Test-only endpoints for asserting what was submitted.
  if (slug === '__submissions') {
    if (req.method === 'DELETE') {
      submissions.length = 0;
      return send(res, 200, JSON.stringify({ cleared: true }), 'application/json');
    }
    return send(res, 200, JSON.stringify(submissions), 'application/json');
  }

  const site = SITES_BY_SLUG.get(slug);
  if (!site) return send(res, 404, '<h1>404 — no such fixture site</h1>');

  if (req.method === 'POST') {
    const body = await readBody(req);
    const { fields, files } = parseBody(body, req.headers['content-type'] ?? '');
    submissions.push({
      site: slug,
      path,
      method: 'POST',
      fields,
      files,
      receivedAt: new Date().toISOString(),
    });
  }

  const page = site.pages[path] ?? site.pages[`${path}/`];
  if (!page) {
    // A PDF link resolves to something downloadable so the channel detector
    // sees a real PDF rather than a 404.
    if (path.endsWith('.pdf')) {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end('%PDF-1.7\nfixture vendor packet\n%%EOF');
    }
    return send(res, 404, '<h1>404</h1>');
  }

  // Pages are authored with a {{base}} placeholder so every link and form
  // action carries the site's own path prefix. Without it an absolute action
  // like "/vendors/submit" escapes the fixture and 404s.
  return send(res, 200, page.replaceAll('{{base}}', `/${slug}`));
});

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.warn(`fixture PM sites listening on http://localhost:${PORT}`);
  });
}

export { submissions, PORT };
