# VendorLink

One click into any property manager's approved vendor pool.

A service company (HVAC, plumbing, landscaping, cleaning) enters their company
data and documents **once**. For any property management company in the
directory, one **Connect** click runs two tracks: it resolves the best
vendor-onboarding inbox and sends a packet email, and it locates, fills and
submits the vendor application form.

The product is the two resolver engines. Everything else is scaffolding.

## Running it

Nothing here needs a credential. The whole system runs and the full test suite
passes against a local Postgres and a local fixture server.

```bash
pnpm install
./scripts/dev-db.sh start          # local Postgres 16 on :55432
export DATABASE_URL="postgres://postgres@127.0.0.1:55432/vendorlink"
export VENDORLINK_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"

pnpm db:migrate
pnpm db:seed                       # 50 PM companies (synthetic — see below)
pnpm dev                           # http://localhost:3000
```

Fixture PM sites, used by the Engine #2 tests and for a full local demo:

```bash
pnpm --filter @vendorlink/fixtures dev   # http://localhost:4321
```

## Tests

```bash
pnpm test                                            # everything, 432 tests
pnpm --filter @vendorlink/resolver test:golden       # P1 gate: top-1 accuracy
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  pnpm exec vitest run --project worker              # P3 gate: real Chromium
```

Phase gates, all currently passing:

| Gate | Requirement | Result |
|---|---|---|
| P0 | Create a tenant, upload a W-9, see a PM card | 19 integration tests + 8 HTTP checks |
| P1 | Top-1 accuracy ≥ 90% on a 50-page golden set | **100%**, no wrong answer above 0.6 |
| P2 | One-click send end to end; a bounce suppresses globally | Both, against a real serialized message |
| P3 | 8 of 12 fixture sites auto-submit; 4 park correctly | 8 submit, 4 park, driven by real Chromium |

## Layout

```
apps/
  web        Next.js 15 app — directory, PM card, console, Needs-Attention
  worker     Playwright form discovery, filling and submission
  fixtures   15 deterministic mock PM sites for the E2E suite
packages/
  core       Domain types, canonical Vendor Profile, provider interfaces
  db         Drizzle schema, migrations, tenant-scoped repositories
  resolver   Engine #1 — the "next best listed email" resolver
  email      Packet template, send gate, reply classification
  adapters   Engine #2 — mapping rules, confidence gate, ToS policy
```

## The two engines

**Engine #1** (`packages/resolver`) takes a PM company and returns a *ranked
list* of contacts with confidence scores and full provenance. Extraction is
entirely deterministic; the LLM only ever chooses among addresses a regex
already found, and every choice must carry a quote that appears verbatim on the
page. Without that guard a confidently hallucinated address becomes real email
to a real stranger.

**Engine #2** (`packages/adapters` + `apps/worker`) discovers a form, maps its
fields against ~90 deterministic rules, and passes through a confidence gate
before filling anything. Runs that cannot proceed unattended — a CAPTCHA, a
paywall, restricted terms, an unmapped required field — are filled and parked
rather than submitted badly. A parked run is 30 seconds of operator work; a
wrongly-submitted one is bad data in a PM's vendor record under the vendor's
own name.

## Things to know before this goes near production

- **The seeded directory is synthetic.** 50 companies on `.example` domains.
  This product mails the addresses in that table, so shipping real company
  names against invented domains would mean acting on fabricated records. See
  `docs/replace-seed-directory.md` for the sourcing work that replaces them.
- **No external service is configured.** Auth, storage, mail, the queue and the
  LLM all sit behind interfaces in `packages/core/providers`, with local
  implementations selected when the corresponding env vars are absent. Adding a
  credential switches the implementation; no code changes.
- **The worker is not deployed.** `apps/worker/Dockerfile` and `fly.toml` are
  committed so the deployment shape is reviewable, but neither has been built
  or applied — there are no Fly credentials here.
- **`docs/DECISIONS.md`** records every ambiguity resolved during the build and
  why, including the deviations from the original brief.

## Environment notes

Postgres server binaries are present but there is no Docker daemon, and raw
TCP to :5432 is blocked by the egress proxy — so `scripts/dev-db.sh` runs a
local cluster as an unprivileged user, and that is what dev and every test use.
Chromium is pre-installed at `/opt/pw-browsers`; do not run
`playwright install`.
