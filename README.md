# Kaizena Flow

An AI-native online store platform for sellers in the EU: many stores on one deployment, each with its own markets, prices,
languages, pages and admin, and an AI manager that does work in the admin for its owner. It runs on Next.js on Vercel (Dublin)
and Postgres on Supabase (Ireland), and it is in production at `kaizenaflow.com`.

The code still says `kaizen` (packages, cookies, the database schema's functions); every word a person reads says Kaizena Flow
(D240).

## Start here

1. Read [`CLAUDE.md`](CLAUDE.md): the workflow, the stack, the commands and one line per rule. Each line points at the full
   rule in [`docs/rules/storefront.md`](docs/rules/storefront.md) or [`docs/rules/admin.md`](docs/rules/admin.md): read the
   rule before changing that part.
2. Skim [`docs/plan.md`](docs/plan.md) (why it is built this way) and [`docs/platform.md`](docs/platform.md) (stores,
   members, plans: how one deployment serves many stores).
3. Look up a decision by its number in [`docs/decisions.md`](docs/decisions.md) (`D16`, `D240`, …). Code comments cite them.
4. This Next.js has breaking changes from the one you may know: read the guide in `node_modules/next/dist/docs/` before
   writing Next code ([`AGENTS.md`](AGENTS.md)).

## Run it locally

Needs Node 22+, pnpm 10 and a Postgres 16 or 17 you can create databases on.

```bash
pnpm install
cp .env.example .env.local      # DATABASE_URL at an empty database; the rest can stay empty to start
DATABASE_URL=postgres://… node scripts/db-setup.mjs --seed   # every migration, then the demo catalogue
pnpm dev                        # http://localhost:3000
```

The demo store is at `/s/demo/no`. Product lists are prerendered from the database, so `pnpm build` needs one too.
Environment variables are checked when they are used, not at start (`src/lib/env.ts`), so the app and the tests run without
secrets and a feature needs its keys only when it is used. `.env.example` names every variable and what it is for.

Signing in to the admin needs Supabase Auth. Without a project of your own, run the stand-in the signed-in tests use
(`e2e/fixtures/auth-stub.mjs`, below) and build against it; never add a bypass to the app's sign-in.

For many databases at once (parallel test runs), `node scripts/db-template.mjs build` makes a template once and
`clone <name>` copies it in about a second.

## The checks

| Command | What it runs |
|---|---|
| `pnpm lint` | ESLint, no warning allowed |
| `pnpm typecheck` | Next's route types, then `tsc` (give Node about 7 GB: `NODE_OPTIONS=--max-old-space-size=7000`) |
| `pnpm test` | Vitest unit tests, `src/**/*.test.ts`, including the scan tests that hold the house rules (below) |
| `pnpm test:int` | Integration tests, `src/**/*.int.test.ts`, against `DATABASE_URL` after `db-setup.mjs --seed` |
| `pnpm db:check` | Fails if `src/db/schema.ts` and `supabase/migrations` disagree |
| `pnpm build` then `pnpm test:e2e` | Playwright against `pnpm start` |

The signed-in admin tests (`e2e/signed-in/`) run only with `E2E_SIGNED_IN=1`, in a build whose `NEXT_PUBLIC_SUPABASE_URL` is
the Auth stand-in (`AUTH_STUB_PORT=3912 node e2e/fixtures/auth-stub.mjs`), as CI's `signed-in` job does. With a preinstalled
Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` instead of running `playwright install`.

Run lint, the type check and the tests before every push.

## How a change reaches production

There are no branches or pull requests: a commit to `main` is a deploy (D5). CI (`.github/workflows/ci.yml`,
[`docs/ci-migrations.md`](docs/ci-migrations.md)) runs the checks on every push:

- a push without a new migration deploys at once, and the checks report beside it;
- a push with a migration waits for the checks, applies the migration to production (`scripts/db-migrate.mjs`), then deploys;
- each deploy waits until `/api/health` reports the commit, and fails the job when it does not.

So a migration is written to keep the code still running working (add a column, never rename or drop it in the same change),
is never applied to production by hand, and has its version recorded in `docs/decisions.md` afterwards. Pushes of `*.md` and
`docs/**` alone run nothing.

## Where things are

| Path | What is there |
|---|---|
| `src/app/s/[store]/[market]/…` | The storefront: a store's pages, cart, checkout and account, per market |
| `src/app/admin/…` | The admin: `/admin` lists the account's stores, `/admin/{store}/…` is one store, `/admin/platform/…` is the platform's own |
| `src/app/(platform)`, `(platform-nb)` | Kaizena Flow's own site, in English and Norwegian |
| `src/app/api/…` | Webhooks, cron routes, the storefront and Admin APIs, health |
| `src/server/` | Server-only code (each file imports `server-only`): reads and writes, the AI agents and their tools, payments, email |
| `src/lib/` | Pure code shared by server and browser: money, VAT, prices, page content, the rules each feature computes |
| `src/components/` | React components; the admin's are in `src/components/admin/` |
| `src/db/schema.ts` | The database in Drizzle: the private `commerce` schema, which Supabase does not expose |
| `supabase/migrations/` | Generated migrations (`pnpm db:generate`), and custom ones for functions, triggers and reference data |
| `e2e/` | Playwright tests; `e2e/signed-in/` for the admin as people see it |
| `docs/` | Plans, decisions, feature specifications, audits ([`docs/audits/`](docs/audits)) and runbooks ([`docs/runbooks/`](docs/runbooks)) |
| `wordpress-plugin/` | The WordPress plugin that shows a store's products on a WordPress site |

## The rules that are easy to break

The full set is in `CLAUDE.md`; these are the ones a first change most often trips on. Most are held by a test that fails.

- **Money** is integer minor units plus an ISO 4217 code (`src/lib/money.ts`). Prices include VAT per market and change only
  through `commerce.set_price`. A product's VAT rate is `commerce.vat_rate(country, vat_category)`.
- **Database reads** that are new, or carry money, describe their row and go through `typedRows()` (`src/server/typed-rows.ts`).
- **A writer of `commerce.stores`** refreshes the store's cache tag (`store-writers.scan.test.ts`).
- **Logging** goes through `log()` (`src/server/log.ts`): ids and counts, never a person's data or a secret.
- **Cron routes** have a `maxDuration` and run inside `trackedRoute()` (`cron-routes.scan.test.ts`).
- **AI** never states a price, stock level or product it was not given by a tool, and model output is shown as text. Every
  system prompt carries the rule in `src/lib/prompt-safety.ts` (`prompt-safety.scan.test.ts`). A changed prompt needs a new
  eval run and its recording committed (`CLAUDE.md`, Conventions).
- **Words** a person reads live in `src/lib/i18n.ts`, `src/lib/messages/` and `src/lib/admin-messages/`, and say Kaizena Flow,
  never the old name (`brand.scan.test.ts`).
- **Screens** serve two people: Homer's simple view by default, Lisa's every setting one step away
  ([`docs/admin-style.md`](docs/admin-style.md) 2.1).
- **Vendors** keep data processing in the EU.

## Running the platform

- Setting up a new deployment (Supabase Auth, pictures, Stripe Connect, the first platform admin):
  [`docs/runbooks/platform-setup.md`](docs/runbooks/platform-setup.md).
- Restoring the database: [`docs/runbooks/restore.md`](docs/runbooks/restore.md). A breach:
  [`docs/runbooks/breach.md`](docs/runbooks/breach.md). Changing the settings key:
  [`docs/runbooks/key-rotation.md`](docs/runbooks/key-rotation.md).
- Security and personal data: [`docs/security.md`](docs/security.md), [`docs/residency-register.md`](docs/residency-register.md).
- How the platform scores on product, security, privacy and code, and what is left to do:
  [`docs/audits/psi-2026-10-30.md`](docs/audits/psi-2026-10-30.md) and
  [`docs/audits/psi-followups.md`](docs/audits/psi-followups.md).
