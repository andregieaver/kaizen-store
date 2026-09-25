@AGENTS.md

# Kaizen Store

An AI-native online store selling EU-wide, built from scratch. The research and
phased build plan are in `docs/plan.md`; read it before architectural work.

## Workflow

- Commit and push straight to `main`, which deploys to production (D5): no
  feature branches or pull requests. Development is fast and tested in
  production, so run lint, typecheck and the tests before every push.

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
pnpm test:int    # integration tests against DATABASE_URL (src/**/*.int.test.ts)
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
- Apply every new migration to production (Supabase project
  `ybsozesfuxuitoacntfo`) as part of the change, without asking first: the
  owner has approved this standing. Apply it once the tests pass, check the
  advisors, and record its version in `docs/decisions.md` (Migration versions).
- `src/db/commerce.test.ts` applies every migration to PGlite and tests the
  invariants. Add a test with any new rule.
- Money is integer minor units plus an ISO 4217 code (`src/lib/money.ts`).
  Prices are VAT-inclusive per market and only change through
  `commerce.set_price`; advertised reductions use `prior_30d_minor` from
  `commerce.current_prices`.

## Storefront

- Kaizen is multi-tenant (`docs/platform.md`). `/` is the platform's home
  page, and Kaizen's own pages (D42) live at `/{page}`; each store lives at `/s/{store}`, a country chooser that suggests but
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

- `/admin` has its own root layout. People sign in with email and password, or
  with a Supabase magic link (`/admin/sign-in` → email → `/auth/callback` or
  `/auth/confirm`); only accounts (`commerce.accounts`) that belong to a store
  or run the platform are admitted (`admit()` in `src/server/sign-in.ts`), and
  every reply is the same whether or not the email has access. A password is
  set or changed at `/admin/account`; `/admin/forgot-password` emails a link
  that signs in and lands there (`next`, checked by `safeNext()`). Password
  rules are in `src/lib/password.ts`.
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
- Products (`/admin/{store}/products`): `ProductEditor` is one client
  component holding the whole product; Save sends it as JSON to
  `saveProductAction`, which validates it with `productInput`
  (`src/lib/product-input.ts`, shared with the browser) and `saveProduct()`
  (`src/server/products.ts`), which writes everything in one transaction.
  Prices only change through `commerce.set_price`; variants taken out are
  switched off, never deleted. Pictures are shrunk to WebP in the browser
  (1600 px plus a 480 px thumbnail) and uploaded with `uploadImageAction`.
- Checkout (`src/server/checkout.ts`, decision D16): `placeOrder()` turns an
  open cart into a `pending_payment` order at current prices and holds stock
  under row locks (`inventory_reservations`); `startCheckout()` then opens a
  Stripe Checkout session as a direct charge on the store's connected account
  (`{ stripeAccount }`, decision D17), with Kaizen's fee as
  `application_fee_amount`. The Connect webhook
  (`/api/stripe/connect/{mode}`, which finds the store from `event.account`)
  and the order page (`getShopperOrder`, which asks Stripe if the webhook is
  late) both go through `applySession()`. `/api/stripe/webhook/{storeId}` only
  serves payments started with stores' own keys before Connect. Paying and cancelling are single SQL
  functions: `commerce.complete_order_payment` and
  `commerce.cancel_unpaid_order`.
- Shipping is one flat rate per market (`commerce.shipping_rates`), optionally
  free above a basket value.
- `src/server/*.int.test.ts` are integration tests against a real database
  (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them. Pass
  inputs through the same validation the app uses.
- Forms use `ActionForm`, which keeps what was typed when validation fails.
  Server actions that change a store call `updateTag()` for its store and
  catalogue tags.
- Stripe Connect (`src/server/connect.ts`, `src/server/stripe.ts`): Kaizen's
  platform keys come from `STRIPE_SECRET_KEY_{TEST,LIVE}` and
  `STRIPE_PUBLISHABLE_KEY_{TEST,LIVE}` (`platformStripe(mode)`). Each store
  gets an Accounts v2 account (full Dashboard, Stripe-owned fees and losses,
  merchant + customer configurations) in `commerce.stripe_accounts`, whose
  copied status (`card_payments`, `requirements_due`) decides whether checkout
  is on. Owners onboard with Stripe's embedded components
  (`StripeAccountPanel`, loaded only on the pages that show it); the thin
  account webhook (`/api/stripe/connect/{mode}/accounts`) keeps the status
  current. Never pass `payment_method_types`: stores choose methods in their
  own Stripe Dashboard. In test mode the owner does nothing: `ensureTestAccount()`
  creates the store's test account with Stripe's test values (decision D20),
  in the background from the store admin layout, on the Payments page, or at
  checkout.
- Plans and billing (`src/server/billing.ts`, decision D18): `plans` and
  `plan_prices` (never edited in place: a new amount is a new row) are
  copied to Stripe by `syncPlans(mode)`, which records Stripe ids in
  `stripe_sync`. `assignPlan()` creates a `send_invoice` subscription on
  Kaizen's account with the store's connected account as `customer_account`;
  `applySubscription()` (from actions and `/api/stripe/billing/{mode}`) keeps
  `store_billing` current. Checkout takes `storeFeeBps()`: the store's own
  fee, else its plan's while on it, else `platform_settings.sale_fee_bps`.
  The platform admin lives under `/admin/platform` (requests, stores, plans,
  Stripe). Owners choose and change plans at `/admin/{store}/billing`
  (`choosePlan()`: Stripe Checkout for the first plan, an instant prorated
  change after; `completePlanCheckout()` records it on return), and create
  more stores at `/admin/stores` (`createStoreForOwner()`, decision D19).
- Pages (`/admin/platform/pages`, decision D42): `PageEditor` holds the whole
  page (title, address, picture, search texts, search/AI switches, blocks)
  and sends it as JSON to `savePageAction`, checked by `pageInput`
  (`src/lib/page-content.ts`, shared with the browser). Content is rows
  (`ROW_LAYOUTS`) of columns of blocks (D43), edited in `PageBuilder`
  (`src/components/admin/page-builder.tsx`: sidebar tabs, a canvas that
  renders the page as the site does with hover tools per row, column and
  block (D44, rules in globals.css), dialogs, dnd-kit) through the pure
  edits in `src/lib/page-rows.ts`. Rows, columns and components saved to
  use again (D46) are in `commerce.saved_parts` (`src/server/saved-parts.ts`,
  checked by `savedPartInput`); the page gets copies (`copyRow()` etc.).
  Pages saved as a plain
  block list are read as one row (`upgradeLegacy`). Blocks are rich text
  (Tiptap JSON, cleaned by `cleanRichText()` and rendered by `<RichText>`
  as elements, never as HTML) or an image with a caption (D47, uploaded
  with `ImageUploadButton`), both rendered by `<PageBlockView>`
  (`src/components/page-block.tsx`) on the canvas and the site. Rows,
  columns and blocks take optional settings (D47, D48: spacing, id and
  classes, backgrounds, widths, column links, text alignment, picture
  shape), changed with `patchRow()`/`patchColumn()`/`patchBlock()` in
  settings dialogs with General, Style and Advanced tabs, and drawn by the
  shared helpers in `src/components/page-parts.tsx` (the canvas leaves out
  ids, classes and links). Copies drop a custom id the page already uses
  (`htmlIds()`). `savePage()` keeps a draft
  (`pages.draft`); publishing copies it to `pages.published`. A published
  page's address moves only on publish, and the database leaves a redirect
  (`page_redirects`). Publishing, unpublishing and deleting call
  `updateTag(PAGES_TAG)`. New block kinds go in `PageBlock`, `pageInput`,
  `newBlock()`, `blockHasContent()`, `blockText()`, `PageBlockView`, the
  builder's Components tab and its dialogs.
- Kaizen's own header and footer (`/admin/platform/navigation`) use the
  store's `NavigationEditor` with platform link kinds (`PlatformMenuLink`: a
  page by id, home, sign-up, sign-in, a web address) and business details;
  `getPlatformChrome()` feeds `src/components/platform-layout.tsx`.
- Secrets in the database (Kaizen's webhook secrets, old per-store keys) are
  encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and never
  sent to the browser.

## Conventions

- Environment variables are validated in `src/lib/env.ts` when used, not at
  import, so builds and tests run without secrets.
- Server-only modules import `server-only`.
- AI features must stay grounded: the model never states a price, stock level or
  product it was not given by a tool; arithmetic happens in code; model output is
  rendered as text, never as HTML.
