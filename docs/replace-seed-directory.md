# Replacing the seed directory with sourced data

`packages/db/seeds/pm-companies.seed.ts` ships **50 synthetic** property
management companies on `.example` domains. They exist so the directory, the PM
card, and the Connect flow are demonstrable end to end. They are not real
companies and must be replaced before the product sends a single message to a
real recipient.

## Why it ships synthetic

This product's purpose is to send real email to the addresses in this table and
submit real forms on the sites it links to. Seeding real company names against
invented domains, portfolio sizes, and contacts would mean shipping fabricated
records about identifiable businesses — and the first Batch Connect would
deliver mail based on them. A wrong `.example` row sends nothing; a wrong real
row sends the wrong thing to a real inbox.

## What to do before launch

§9 names the sources. Each row must carry the `source` it came from.

1. **NARPM and IREM member listings** — public member directories. Capture the
   company name, city, state, and website. `source: 'narpm'` / `source: 'irem'`.
2. **State real-estate licence registries** — public registries confirm the
   legal entity name and that the company is currently licensed. Use this to
   populate `legal_name` and to verify a company still trades.
3. **Google Places** — query "property management" by metro for coverage of the
   long tail. `source: 'google_places'`. Places gives the website, which is all
   Engine #1 needs as an entry point.

For each row: set `verified: false`, let the nightly enrichment cron run Engine
#1 against it, and promote to `verified: true` only through the §9.4 admin
review queue after a human has seen the resolved contacts.

## Ordering constraint

Do not enable sending against sourced rows until:

- the tenant's sending domain is verified (SPF/DKIM/DMARC green), and
- the warm-up governor is active, and
- the global suppression list is wired to the Resend bounce webhook.

Those three are what separate this from a spam cannon. They are implemented in
P2; the check that enforces them lives in the send gate, not in the UI.

## Fixture mode

With `FIXTURES_BASE_URL` set, seed rows that name a `websitePath` point at the
local fixture server instead of their `.example` domain, which is how the E2E
suite exercises resolution and submission without touching a live site.
