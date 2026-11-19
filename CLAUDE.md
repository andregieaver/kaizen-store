@AGENTS.md

# Kaizena Flow

Kaizena Flow (formerly Kaizen Store; the code keeps `kaizen` in its names) is an AI-native online store selling EU-wide, built from scratch. How it is
built is in `docs/platform.md`: read it before architectural work (`docs/plan.md` is older research: open a cited section only).

## Workflow

- Commit and push straight to `main`, which deploys to production (D5): no
  feature branches or pull requests. Development is fast and tested in
  production, so run lint, typecheck and the tests before every push.
- Production is deployed by CI (`docs/ci-migrations.md`): a push without a new migration deploys after a quick gate
  (lint, the type check and the money tests, D526) and the full checks report beside it; one with a migration waits for every check,
  applies it, then deploys. Pushes
  of `*.md` and `docs/**` alone run nothing, except the docs portal's articles under `content/` (D442), which are
  checked and deployed like code. Each deploy then waits until `/api/health` reports the commit (D389,
  `scripts/await-deploy.mjs`), then requests two pages (`SMOKE_PAGES`) and every challenge store's front page and cart (`/api/health/smoke`, D625), and fails the job when the commit does not arrive or a page does not answer 200.
- The owner loves to see frequent screenshots and graphics of what is built: send screenshots of new or changed
  screens (and a diagram where it explains how something works) as the work goes, not only at the end.

## Stack

- Next.js 16.4 (App Router, `cacheComponents` on), React 19, TypeScript, Tailwind 4, pnpm. Next.js carries one patch
  (`patches/next.patch`, D423: its router no longer sends a Safari visitor back to a page they were leaving), applied to any
  version; an upgrade that changes the patched lines fails the install until the patch is moved or dropped, and `e2e/store-pages.spec.ts` says which.
  Two router settings are written in `next.config.ts` (D592): `optimisticRouting: false` (the `@drawer/[...rest]` slot made an endless prefetch;
  `e2e/prefetch.spec.ts` says when it may go) and `partialPrefetching: false` (a recorded choice).
- Supabase project "Kaizen Store" (`ybsozesfuxuitoacntfo`, eu-west-1 Ireland).
- Vercel functions pinned to `dub1` (Dublin) in `vercel.json` to sit next to the
  database. Keep data processing in the EU when adding any vendor.

## Commands

```bash
pnpm dev         # local dev server
pnpm lint
pnpm typecheck
pnpm test        # Vitest unit tests (src/**/*.test.ts)
pnpm test:int    # integration tests against DATABASE_URL (src/**/*.int.test.ts)
pnpm build
pnpm test:e2e    # Playwright against `pnpm start`; build first
pnpm db:generate # write a migration after changing src/db/schema.ts
pnpm db:check    # fails if migrations and schema disagree (runs in CI)
node scripts/db-setup.mjs --seed  # migrations + demo catalogue on an empty DATABASE_URL
```

On Vercel the build skips the type check and runs with one worker and no Turbopack cache, to fit its 8 GB machine (D378, `docs/build-memory.md`); keep Tailwind's `@source` lines in `globals.css` pointed at code, never at data or snapshots.

`pnpm build` and the storefront need a database: product lists are prerendered
from it. Locally, point `DATABASE_URL` at an empty Postgres and run
`scripts/db-setup.mjs --seed` first; CI does the same with a Postgres service.

In a sandbox with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` instead
of running `playwright install`.

The admin as signed-in people see it is tested in `e2e/signed-in/` (D234, how: `.claude/rules/e2e.md`). Never add a bypass to the
app's sign-in for a test: the stand-in (`e2e/fixtures/auth-stub.mjs`) is the only fake, and only it is told it is one.

## Database

- Commerce tables live in the private `commerce` schema (`src/db/schema.ts`),
  which Supabase does not expose through its Data API. Server code reaches it
  through `db()` in `src/db/client.ts` (needs `DATABASE_URL`).
- Migrations are generated into `supabase/migrations`. Rules Drizzle cannot
  express (functions, triggers, reference data) go in a custom migration:
  `pnpm exec drizzle-kit generate --custom --name <name>`.
- New migrations reach production through CI (`docs/ci-migrations.md`): push the file with the change; the
  `release` job applies it (a direct Postgres connection, so `DROP` and `DELETE` inside functions run as
  written) after the checks pass, and the deploy follows. **Never apply a migration to production by hand
  first**: CI would apply the file again. After the deploy, check the security and performance advisors
  (Supabase project `ybsozesfuxuitoacntfo`) and record the file's version in `docs/decisions/migration-versions.md`. A migration must keep the code that is still running working until the deploy finishes (add,
  never rename or drop in the same change).
- `src/db/commerce.test.ts` applies every migration to PGlite and tests the
  invariants. Add a test with any new rule.
- Money is integer minor units plus an ISO 4217 code (`src/lib/money.ts`).
  Prices are VAT-inclusive per market and only change through
  `commerce.set_price`; advertised reductions use `prior_30d_minor` from
  `commerce.current_prices`. A product's VAT rate is
  `commerce.vat_rate(country, products.vat_category)` (D65: `standard`,
  `accommodation`, `exempt`; reduced rates in `commerce.vat_rates`, falling
  back to the standard rate); shipping takes the standard rate. Never read
  `countries.standard_vat_rate` for a product.
- Baselines, snapshots, indexes on the hot tables and statement limits: `.claude/rules/database.md`, loaded when
  you open `src/db` or `supabase`. Read it before writing a migration.

## Rules by area

Each part's rules are in full in these files. Read the rule of a part before changing it.

- `docs/rules/storefront.md`: stores as shoppers see them (stores and markets, languages, catalogue reads, search, prices, the cart, consent).
- `docs/rules/admin/platform.md`: the admin's frame, accounts, security and the platform (`/admin/platform`).
- `docs/rules/admin/ai.md`: the AI manager, the autopilot and AI that builds.
- `docs/rules/admin/commerce.md`: orders, payments, tax, shipping and selling.
- `docs/rules/admin/marketing.md`: customers, marketing and analytics.
- `docs/rules/admin/website.md`: the website, the builder, themes and the docs portal.
- `docs/rules/admin/integrations.md`: data in and out, APIs and integrations.
- Find a rule: search `docs/rules` for the file's path, the component's name or the table's name (`rg -n "cart.ts" docs/rules`).
- List an area's rules: `rg -n "^## " docs/rules/admin/commerce.md`.
- Read one rule: from its heading's line to the next heading, not the whole file.
- How-to that loads by folder: `.claude/rules/` (`database.md`, `e2e.md`, `server.md`, `ai-prompts.md`).

## Conventions

- Every screen a person uses serves two people (Homer and Lisa: System 1 and System 2). The default view is for Homer: simple,
  intuitive and distraction free, one clear main action, sensible defaults chosen for him, words for what he gets rather than
  settings, and nothing to understand before pressing the obvious button. Lisa's depth (every setting, per screen size, own CSS,
  versions, what changes, undo) is one deliberate step away (Customise, Advanced) and never in Homer's way. A new screen passes
  when Homer can finish without reading anything and Lisa can still reach every setting.
- Whatever is built for stores and their owners is built for the platform too (the owner, 6 November 2026): Kaizena Flow's own site
  and store, and the platform admin (`/admin/platform`; the platform's rows are `store_id is null` or `platform_*` tables), get the
  same feature in the same change, or as its next step named in the decision. A feature stays store-only only where it cannot apply to
  Kaizena Flow (it sells plans through Stripe, not goods: no stock, parcels or returns), and its decision says why. Before calling a
  store feature done, check the platform has it. `docs/platform-parity.md` lists what the platform still lacks; tick a row there when a
  change brings it.
- The platform's name is Kaizena Flow (D240) in every string a person or an assistant reads, and its domain `kaizenaflow.com`; `Kaizen` stays in code names, cookie names, the webhook headers and Kaizen Life (another product). `src/lib/brand.scan.test.ts` fails on the old name or an old domain in any string.
- Environment variables are validated in `src/lib/env.ts` (the two public ones in `src/lib/public-env.ts`, without zod, for the browser) when used, not at
  import, so builds and tests run without secrets.
- Server-only modules import `server-only`.
- Every budget (baseline file, scan test, script) has a row in `docs/rules/budgets.md`; its numbers only fall.
- Typed rows, the code ratchet, logs and cron jobs: `.claude/rules/server.md`, loaded when you open `src/server` or `src/app/api`. The eval and
  prompt versions: `.claude/rules/ai-prompts.md`.
- AI features must stay grounded: the model never states a price, stock level or
  product it was not given by a tool; arithmetic happens in code; model output is
  rendered as text, never as HTML. Every system prompt carries the rule in
  `src/lib/prompt-safety.ts` (`UNTRUSTED_TEXT`, or `RULES_STAND` where the input is
  meant to steer); `prompt-safety.scan.test.ts` fails for a new prompt without it.
- A new page for Kaizena Flow's own site (kaizenaflow.com) is built from `docs/site-design.md`: the owner's theme, palette, classes
  and row recipes, read from production. Save it as a draft for the owner to publish, and correct that file when the site's look changes.
- Working plans in `docs/audits/`: `psi-followups.md` (Open), `code-review-2026-11.md`, `bloat-review-2026-11.md` and
 `ecosystem-2026-11.md`. Find a step's row by id; in the same change set it to Done with date and commit.
- Claim a decision's number with `node scripts/claim-decision.mjs "title"` before citing it, never from the file.
- Searches skip dated reports, evidence folders and `supabase/archive`: name the path to search one.
