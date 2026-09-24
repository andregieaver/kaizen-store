@AGENTS.md

# Kaizen Store

An AI-native online store selling EU-wide, built from scratch. The research and
phased build plan are in `docs/plan.md`; read it before architectural work.

## Stack

- Next.js 16.3 (App Router, `cacheComponents` on), React 19, TypeScript, Tailwind 4, pnpm.
- Supabase project "Kaizen Store" (`ybsozesfuxuitoacntfo`, eu-west-1 Ireland).
- Vercel functions pinned to `dub1` (Dublin) in `vercel.json` to sit next to the
  database. Keep data processing in the EU when adding any vendor.

## Commands

```bash
pnpm dev         # local dev server
pnpm lint
pnpm typecheck
pnpm test        # Vitest unit tests (src/**/*.test.ts)
pnpm build
pnpm test:e2e    # Playwright against `pnpm start`; build first
pnpm db:generate # write a migration after changing src/db/schema.ts
pnpm db:check    # fails if migrations and schema disagree (runs in CI)
node scripts/db-setup.mjs --seed  # migrations + demo catalogue on an empty DATABASE_URL
```

`pnpm build` and the storefront need a database: product lists are prerendered
from it. Locally, point `DATABASE_URL` at an empty Postgres and run
`scripts/db-setup.mjs --seed` first; CI does the same with a Postgres service.

In a sandbox with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` instead
of running `playwright install`.

## Database

- Commerce tables live in the private `commerce` schema (`src/db/schema.ts`),
  which Supabase does not expose through its Data API. Server code reaches it
  through `db()` in `src/db/client.ts` (needs `DATABASE_URL`).
- Migrations are generated into `supabase/migrations`. Rules Drizzle cannot
  express (functions, triggers, reference data) go in a custom migration:
  `pnpm exec drizzle-kit generate --custom --name <name>`.
- `src/db/commerce.test.ts` applies every migration to PGlite and tests the
  invariants. Add a test with any new rule.
- Money is integer minor units plus an ISO 4217 code (`src/lib/money.ts`).
  Prices are VAT-inclusive per market and only change through
  `commerce.set_price`; advertised reductions use `prior_30d_minor` from
  `commerce.current_prices`.

## Storefront

- Kaizen is multi-tenant (`docs/platform.md`). `/` is the platform's home
  page; each store lives at `/s/{store}`, a country chooser that suggests but
  never redirects (unless the store has one market), and `/s/{store}/{market}`
  (`no`, `se`, `dk`, …), each market its own root layout with its own
  `<html lang>`. Build links with `marketPath()` / `storeBase()` from
  `src/lib/paths.ts`, never by hand: stores move to subdomains later.
- Stores and their markets come from the database (`getStore()`, cached per
  store; `resolveShop()` for URL params). Every catalogue, cart and settings
  query takes a store id; never query a store-owned table without it.
- Interface text lives in `src/lib/i18n.ts`, by language, with English as the
  fallback. Legal texts do not: they need
  human review.
- Catalogue reads in `src/server/catalog.ts` are cached (`'use cache'`, tag
  `catalog` and `catalog:{storeId}`); stock is read per request inside
  `<Suspense>`.
- Prices are shown with `<Price>`, which adds the VAT label and shows the
  30-day reference only for a genuine reduction.
- The template store's product pages are prerendered at build time, so their
  content is plain HTML; stock and add-to-cart stream in and need JavaScript.
- The cart (`src/server/cart.ts`) is per store and market, identified by an httpOnly
  cookie. Adding checks live stock and caps the quantity; stock is only held
  once checkout starts. Mutations are server actions that call `refresh()`.
- Payment credentials and payment-method switches are store settings edited in
  the admin, never environment variables (decision D15).

## Admin

- `/admin` has its own root layout. People sign in with a Supabase magic link
  (`/admin/sign-in` → email → `/auth/callback`); only accounts
  (`commerce.accounts`) that belong to a store or run the platform get a link.
  There is no proxy: `getAccount()` verifies the session on each request,
  `SessionKeeper` refreshes tokens in the browser, and `SessionRecovery`
  handles an expired token.
- `/admin` lists the account's stores; `/admin/{store}/…` is one store. Pages
  and server actions call `requireMember(storeSlug)`, which 404s for stores the
  account is not a member of. Actions take the store slug as a bound first
  argument. Owners manage staff and payment keys. Changes are written to
  `commerce.audit_log` with the store id.
- Sign-up and setup (`docs/platform.md`): `/sign-up` stores an access request;
  platform admins approve at `/admin/platform`, which calls
  `commerce.approve_access_request()` (account + `clone_store()` + decision in
  one transaction) and emails a sign-in link. Owners of a store that is not
  open yet land in the setup wizard, `/admin/{store}/setup/{step}`; progress is
  derived from data in `src/server/setup.ts`, never stored separately.
- Forms use `ActionForm`, which keeps what was typed when validation fails.
  Server actions that change a store call `updateTag()` for its store and
  catalogue tags.
- Payment secrets are encrypted with `SETTINGS_ENCRYPTION_KEY`
  (`src/lib/secret-box.ts`) and never sent to the browser; only a masked hint
  is shown. Checkout reads them with `getActiveStripeSecret()`.

## Conventions

- Environment variables are validated in `src/lib/env.ts` when used, not at
  import, so builds and tests run without secrets.
- Server-only modules import `server-only`.
- AI features must stay grounded: the model never states a price, stock level or
  product it was not given by a tool; arithmetic happens in code; model output is
  rendered as text, never as HTML.
