# Rules: The admin's frame, accounts, security and the platform

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md keeps one line per rule pointing here; each rule is under that line as its heading.

## The admin's three levels (D107, `docs/admin-navigation.md`)

- The admin's three levels (D107, `docs/admin-navigation.md`): platform
  (`/admin/platform`), the store owner's control center (`/admin`,
  `/admin/stores`, `/admin/account/…`) and a store (`/admin/{store}`), all in
  one shell, `AdminFrame`: the level switcher and account menu in the header
  (`LevelSwitcher`, `AdminAccountMenu`), the level's daily sections as `tabs`,
  the rest as sidebar `groups`. A level's layout supplies only those; a new
  page goes in exactly one level's tabs or groups and in `ADMIN_PAGES`. The
  platform's sections (D144) and their sidebars are `src/lib/platform-nav.ts` (a new platform page goes in one section's items, or in a section with no sidebar, and in `ADMIN_PAGES`; a test fails otherwise) and the shell takes them as `areas` (`NavArea`) with `wide`. The store (D147) and the owner's level are built the same way: `src/lib/store-nav.ts` (Orders, Products, Customers, Marketing, Website, Bookings, Settings; a new store page goes in one section's items, or Home's, and in `ADMIN_PAGES`, whose `group` follows the section; Website and Settings open on pages of cards) and `src/lib/owner-nav.ts` (Home, Stores, Work, Account); pages use the whole width, so no `max-w-*xl` on a page's root. The owner's overview is `controlCenter()` (`src/server/control-center.ts`, pure
  parts in `src/lib/control-center.ts`); the platform's is `platformOverview()`.
  Owner pages go under `/admin/account/…`, never a new `/admin/{word}`, which
  would take a store address. A layout's auth check does not stop its page
  streaming: every page checks for itself.

## The admin's look (D149, D217–D232, `src/app/admin/admin.css`, `docs/admin-style.md`)

- The admin's look (D149, D217–D232, `src/app/admin/admin.css`, `docs/admin-style.md`): admin pages are written in the colour roles (`bg-card`, `bg-sunken`, `bg-canvas`, `border-line`, `border-edge`, `text-ink`, `text-ink-2`, `text-muted`, `divide-line`, `bg-brand text-brand-ink` for the main action, `bg-inverse text-inverse-ink`, `bg-{signal}-soft`/`-solid`, `text-{signal}-text`, `border-{signal}-line` with signals `positive`, `warning`, `danger`, `neutral`, `insight`), never the older names (`bg-background`, `bg-surface`, `border-border`, `bg-foreground`, which `admin.css` still maps for what draws a store's look) and never a fixed palette colour (D224, `admin-type.scan.test.ts`), so they follow the scheme, in light and dark, for free. The main action is a `bg-brand text-brand-ink` pill (lifts on hover); a field is an `input`/`select`/`textarea` (brand ring on focus, whatever its border class); a form that works sets `aria-busy` on itself (`ActionForm` does) and its disabled submit button shows a spinner; a loading placeholder is `animate-pulse rounded-lg bg-background` (it sweeps). Everything that restyles an element carries `:not(:is([data-theme-canvas], [data-theme-preview]) *)`, so a store's page previewed in the admin keeps the store's look, and every motion has a `prefers-reduced-motion` stop (`admin-css.test.ts` holds the scoping). Its successor is designed in `docs/admin-style.md` (colour schemes as roles, `meadow` first, and named layouts, `rail` first). Step 1 is built (D217): a scheme is `src/app/admin/schemes/{id}.css` setting every role of `ADMIN_ROLES` (`src/lib/admin-schemes.ts`) in light and dark, imported by the admin's root layout before `admin.css`, which reads roles only (never a colour; the old token names map onto roles) and `admin-schemes.test.ts` holds each scheme to `CONTRAST_RULES`; new admin code may use the role names (`bg-canvas`, `bg-card`, `bg-sunken`, `text-ink`, `text-ink-2`, `border-edge`, `bg-brand text-brand-ink`, `bg-{signal}-soft text-{signal}-text`). A new role goes in `ADMIN_ROLES`, every scheme and the `@theme`. Step 2 (D218): the admin's components are `src/components/admin/ui/` (`Button`/`ButtonLink`, `Chip`, `TrendChip`, `CountBadge`, `Card`, `KpiTile`, `ShareBar`, `ScoreBar`, `InsightPanel`, `List`/`ListRow`, `PageHeader`) with the type scale and shapes as Tailwind names (`text-display`, `text-title`, `text-body-strong`, `text-caption`, `text-eyebrow`, `rounded-card`, `rounded-pill`, …); a new admin page uses them, and they stay in the roles only (`ui.test.ts`). Step 3 (D219): layouts are `ADMIN_LAYOUTS` (`src/lib/admin-layouts.ts`, `classic` and `rail`) chosen per level by `LEVEL_LAYOUTS` and drawn by `AdminFrame`'s `layout`, which renders only a layout's regions; a store's admin, the platform (`platformTabs()`) and the owner's level (`ownerTabs()`) are `rail` (`AdminRail`: the sections as icon tiles, Settings or Account at the foot by `foot`; D220), hosting `classic`; a new level's sections are its tabs, which the rail draws. Step 5 (D221): the schemes are `meadow` (default) and `indigo`, chosen per account on Your account (`SchemeField`, `accounts.admin_scheme`, `kaizen_admin_scheme` in the browser, `adminSchemeScript()` before paint, `AdminSchemeSync`); a new scheme is a file, an `ADMIN_SCHEMES` entry, an import in the admin's root layout and the `accounts_admin_scheme` check widened in a migration. Pages are moving to the components (D223): the admin uses no `font-semibold`/`font-bold`, a page's title is `text-display text-ink` (better: `PageHeader`), a section's card `rounded-card`, buttons pills (every `button`, `Link` and `a`, D231), section titles `text-title text-ink`, figures `text-metric`, labels `text-eyebrow`, boxes within a card `rounded-panel` and a white box on the canvas a card (`CARD_CLASS`, D232) (`admin-type.scan.test.ts`; the builder's stand-ins, the theme editor's preview, store previews, packing slips and print routes keep their own look); `Stat`/`Attention`/`Section` in `overview-parts.tsx` are drawn with the components. A signed-in page is titled by `PageHeader` (`back`, `title`, `status`, `meta` for facts, `description` for a sentence, `actions`; D225, the scan test refuses a page's own `h1`) and a section is a `Card` (`title`, `description`, `aside` for its action; D226: a box named another way keeps its element with `CARD_CLASS`, never `rounded-card border border-line bg-card`); a list of records (things you open, a few facts each, nothing edited or compared down a column) is a `List` in a `Card` with `ListRow`, `RowLead`, `RowFact`, `RowActions`, a `Chip` for status and `RowAmount` (D227), and a table stays for figures compared, rows edited or selected, a document's lines and values to copy. A page before a person is let in (sign-in, two-step, forgotten password, OAuth consent) is drawn by `FocusFrame` (the `focus` layout, D228: Kaizen's mark and one card, `FocusHeading` where the title depends on what the page finds), never a `main` or `h1` of its own. A signed-in page that is one task on its own is drawn in `focus` within its level by `AdminFrame`'s `focus` (D229: addresses as a pattern, a way back, a title; no rail, sidebar, menu or actions), as the store's setup wizard is. A tool with columns of its own (a page editor, the media library, a support inbox) is drawn in `workspace` by the level's `fullWidth` pattern (D230: the rail narrowed to 64 px, no sidebar, the whole width), or `workspaceLinks` when its section's pages must stay in reach (the inbox: they become links in the top bar, `AreaLinks`). The scheme preview page is `/admin/account/appearance` (D222, `SchemePreview`): a scheme's file also styles `[data-scheme-preview="{id}"]` (and `[data-preview-mode="dark"]`), so look at a new scheme there before offering it.

## `/admin` has its own root layout

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

## `/admin` lists the account's stores; `/admin/{store}/…` is one store

- `/admin` lists the account's stores; `/admin/{store}/…` is one store. Pages
  and server actions call `requirePermission(storeSlug, key)` (D158; it 404s for stores the
  account is not a member of and for a member whose role lacks the key), never a bare
  `requireMember()`. Actions take the store slug as a bound first
  argument. Owners manage staff and payment keys. Changes are written to
  `commerce.audit_log` with the store id.

## Sign-up and setup (`docs/platform.md`)

- Sign-up and setup (`docs/platform.md`): `/sign-up` stores an access request;
  platform admins approve at `/admin/platform`, which calls
  `commerce.approve_access_request()` (account + `clone_store()` + decision in
  one transaction) and emails a sign-in link. Owners of a store that is not
  open yet land in the setup wizard, `/admin/{store}/setup/{step}`; progress is
  derived from data in `src/server/setup.ts`, never stored separately.

## `src/server/*.int.test.ts` are integration tests against a real database (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them

- `src/server/*.int.test.ts` are integration tests against a real database
  (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them. Pass
  inputs through the same validation the app uses.

## Forms use `ActionForm`, which keeps what was typed when validation fails

- Forms use `ActionForm`, which keeps what was typed when validation fails.
  Server actions that change a store call `updateTag()` for its store and
  catalogue tags.

## Plans and billing (`src/server/billing.ts`, decision D18)

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

## Usage and limits (D314, `docs/capacity.md`; the cells of phase 5 are a proposal in `docs/cells.md`)

- **Usage and limits (D314, `docs/capacity.md`; the cells of phase 5 are a proposal in `docs/cells.md`)**: what each store used per UTC
  day and metric (`USAGE_METRICS` in `src/lib/usage-metrics.ts`) is `commerce.store_usage_daily`, written only by `measureDay()`
  (`src/server/usage-meter.ts`, the daily `/api/cron/usage`) and, for requests and server errors, by Vercel's log drain
  (`/api/usage/drain`, `src/lib/usage-drain.ts`, `src/server/usage-traffic.ts`), which keeps no IP address, user agent, path or query;
  a metric no source wrote is *not measured*, never zero (bandwidth today). The counts behind gauges and checks are written once in
  `src/server/usage-sql.ts`. A limit (`LIMITS` in `src/lib/limits.ts`; numbers are only rows of `plan_limits` and `limit_overrides`,
  written only by `src/server/limits-admin.ts`) is the store's override, else its plan's while on it (`ON_PLAN_STATUSES`), else the
  platform default (`plan_id` null), else unlimited, read only through `storeLimits()`/`limitFor()`/`ownerLimitFor()` (a one-minute
  memo; a writer calls `forgetLimits()`); templates and demo stores are never limited. Hard limits refuse only a person's costly action
  through `checkLimit()`/`checkOwnerStores()`/`storageRefusal()` with `limitRefusal()`'s words: uploads, a new product, an invitation,
  a domain, another store, a broadcast or automation past the month's marketing emails, and AI on Kaizena Flow's key (`aiFor()` gives
  no AI); the platform's own copies (templates, themes, demo content, store copies, Compress) are never refused, transactional and
  legal emails are never limited, and traffic is a soft limit that only warns: never take a storefront offline for it. A new costly
  action that a plan should limit is a key in `LIMITS` (and the checks of both tables, by `sqlList()`), its count in `usage-sql.ts`, a
  check at its writer with a test in `limits-enforce.int.test.ts`, and words in the `capacity` catalogue. The read replica
  (`replicaDb()`, `setBasedReplica()`, off without `READ_DATABASE_URL`) is only for the modules `replica-readers.scan.test.ts` lists:
  never a read after a write, a cache refill, checkout, stock, payments or tax reports. Budgets on costly public endpoints are
  `takeBudget()` (`src/server/request-budget.ts`), never on a page load, the cart, checkout, payment or a webhook.

## The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`)

- The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`): the gap to Shopify is `docs/parity/rows/*.json`, and `docs/shopify-parity.md`'s tables are generated from it (`pnpm parity:write`; never edit between the `parity:generated` markers). A row is Full only with existing evidence files and a test (or `untested: true`, counted as debt), a rating change needs a `history` entry, a claim about Shopify is `fetched: true` only when the page was read (with its date), and a new Shopify feature is one row, never repeated in two domains. A finished feature updates its rows in the same change and runs `pnpm parity:write`; `pnpm parity:check` and `src/lib/parity.test.ts` hold it. Waves start from `.claude/workflows/parity-wave.js`.

## Accessibility (D158)

- **Accessibility (D158)**: `pageIssues()` (`src/lib/page-a11y.ts`) is the one checker (it reads the colours the site's and the page's CSS give class names, `classColours()`, so a caller passes `siteCss`, D390); `savePage()` re-runs it and publishing with a blocking issue needs `acknowledgedIssues` and writes `page.published_with_issues`. The statement (`src/lib/a11y-statement.ts`) never says "conforms" without an audit entry; `ENFORCEMENT_BODIES` entries carry `verified`. CI: `e2e/a11y.spec.ts` (axe, tags up to `wcag22aa`, fails on serious and critical; signed-out admin pages only); the Stripe form and signed-in admin are checked by hand. An audit is the company's, never counted by code.

## Staff security (D158)

- **Staff security (D158)**: `getAccount()` is the *assured* account (null for an enrolled `aal1` session and for a platform admin without `aal2`); `getSessionAccount()` is for the sign-in and two-step pages only. Enrolment is read from the signed `aal` claim or a server-side `getUser()` for `aal1`, **never the cookie's `user`**; `accounts.two_step_since` is a display mirror. Recovery codes are `account_recovery_codes` (HMAC, single use, ten per set); using one deletes the account's factors with `SUPABASE_SECRET_KEY`. A try is reserved under a per-account advisory lock before a code is checked (`reserveAttempt()`). `ADMIN_TWO_STEP=off` is the break-glass. Password sign-in has the admin's own limit per email (PSI SEC-02, `src/server/sign-in-limit.ts`: `SIGN_IN_TRIES` wrong tries per `SIGN_IN_WINDOW_MINUTES`, `chat_usage` rows with no store keyed by a keyed hash of the address, never the address; every address counted alike so the answer never says which have access). Two-step pages live under `/admin/sign-in/two-step` and `/admin/account`.

## Permissions (D158)

- **Permissions (D158)**: every store admin page, action, route and helper asks `requirePermission(slug, key)`, `checkPermission`, `requireOwnerRole`, `requireAnyPermission`/`checkAnyPermission` or `requirePageTypeAccess`/`checkPageTypeAccess` (`src/server/permissions.ts`, names in `src/lib/permission-guards.ts`); Work's screens ask `settings:*`; nothing else compares `role` with `"owner"` or calls `requireMember`/`getMembership` (`permissions.scan.test.ts`, against `permissions.baseline.json`). A page's key is its navigation section (`sectionOf`), `/staff…` is `staff`, `/billing` is `billing`; owner-only pages need `owner`; `staff:write` and `billing:write` are owner-held. Roles are `store_roles` made by `ensureStoreRoles()`; a custom-role member has the enum `admin` and a `role_id`. A new page: one nav item, `ADMIN_PAGES`, a guard with its area. A new owner tool: a row in `TOOL_PERMISSIONS`. Collaborators are members with `kind = 'collaborator'` and `expires_at`: any reader of `commerce.store_members` ignores an expired one (`store-members-expiry.test.ts`), and Home and the control center show only the figures a member's role may read (`StoreFigures.hides`).

## Audit log (D158)

- **Audit log (D158)**: `audit()` keeps its signature and takes an optional `{ area, target, changes }`; `auditChange()` writes allowlisted diffs (`ALLOWED_FIELDS`), never secrets; a new action needs an area in `AUDIT_AREAS` (a scan test). The log is append-only, deletable only after 24 months by `pruneAuditLog()` (`commerce.guard_audit_log()`); `/admin/{store}/activity` shows an owner everything and others their readable areas; the CSV is owners'.

## Personal data (D162, `docs/wave-1g-gdpr.md`)

- **Personal data (D162, `docs/wave-1g-gdpr.md`)**: every table that can hold a person's data is in `PERSONAL_DATA` (`src/lib/personal-data.ts`) with how it links to them, the export section that carries it and what erasure does (`delete`, `anonymise`, `restrict`, `keep`), or in `NOT_PERSONAL` with a reason; `src/db/privacy.test.ts` fails for a table with `customer_id`, `email`, `phone`, `address`, `*_name` or postal-code columns, a foreign key to a shopper anchor, or a free-text or payload column that is in neither, and a new kind of `sendEmail()` must be in `EMAIL_KINDS`. A new table of shopper data therefore needs a register entry, an export section in `exportCustomerData()`, an erasure step in `eraseSubject()`, a retention rule if it grows, and a `COPY_RULES` decision. The export (`src/server/privacy-export.ts`) is one JSON file by `store_id`, never emailed, amounts in the order's own currency; staff need `customers:write` (a POST, same site), the shopper a fresh sign-in (`customer_sessions.verified_at`, 10 minutes) and at most `EXPORTS_PER_HOUR`; both are audit-logged with ids and counts and never an email or a name. `resolveSubject()` gives a shopper only the account's own proven email: never match emails, forms, codes or carts by an address a person typed. Erasure (`src/server/privacy-erasure.ts`) never deletes an order (D141): a sale is restricted (`orders.restricted_at`, `customer_id` null) and anonymised by `commerce.anonymise_order()` when the seller's country's period ends (`commerce.retention_rules`, read only through `retentionRule()`, written only by `set_retention_rule()`); unpaid orders are cancelled through `cancel_unpaid_order()` after `closeSession()` and then anonymised; every query that matches orders to a person by email adds `restricted_at is null` (`restricted-orders.scan.test.ts`), and `sendEmail()` refuses an email for a restricted or anonymised order; late writers (`saveCustomer()`, `updateOrderContact()`) skip an anonymised order. The anonymising SQL functions contain no `DELETE`; deletions are application code (`runRetention()` in the daily cron, `src/server/retention.ts`). The one-month request clock is `privacyDeadline()`. Consumer wording is `src/lib/privacy-text.ts` (hand-written nb, sv, da, en, needs legal review, never in `i18n.ts`). An audit entry for any of this never holds personal data.

## Closing a store (D171, `docs/store-closure.md`)

- **Closing a store (D171, `docs/store-closure.md`)**: `stores.status` is `active`, `suspended` or `closed`; the steps are the database's (`stores_status_rules()`), and a store that is not open takes no order (`orders_store_open()`, even a renewal) and is a 404 on the storefront. Nothing is deleted (orders, invoices and the audit log cannot be, almost no foreign key cascades): a closed store stays for its members, and `memberCan()` is the one place that limits every role there to `orders`, `customers`, `analytics`, `billing:read`, `staff:read` and the owner's key (`allowedWhenNotOpen()`), so a new key a closed store may use is added to that list on purpose. The owner closes from `/admin/{store}/settings/close` (`closeStore()`: a sign-in from the last ten minutes, `signedInRecently()`; the address typed in; blocked by paid unsent goods, subscriptions and weekly deliveries, `closureBlockers()`), reopens for 30 days (`ownerMayReopen()`); the platform suspends, closes (forced) and reopens at `/admin/platform/stores/{store}`. Closing ends the plan at period end *first*, cancels orders waiting for payment, releases the domains and emails the owners (`store.status`). A new job that emails shoppers, calls a model or syncs something per store skips a store that is not open with `commerce.store_is_active()`. Counts of what is open are only `storeObligations()`.

## Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`, `/admin/{store}/settings/features`)

- **Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`, `/admin/{store}/settings/features`)**: a master switch for the online shop (`shop`; off, the store is a website) and a switch per feature (`subscriptions`, `boxes`, `appointments`, `bookings`, `countries`, `languages`, `currencies`, `business`, `bonus`, `referrals`). `stores.features` holds what the owner keeps on; what is *on* is only `featureOn(store, id)` (kept, with everything in its `needs`; SQL `commerce.feature_on()`), so a feature's switch is remembered while the shop is off; never test `store.features.includes()` for "on". `store.bookingsOn`/`deliveriesOn` are derived from it, and `stores.modules`' `bookings`/`deliveries` follow it by trigger (`stores_features_sync()`, both ways) for older code. Only owners switch, through `setFeature()` (needs enforced, `featureBlockers()` refuse where customers would be hit, `featureWarnings()` need `confirmed`, audited `store.feature`); nothing is deleted, history and shoppers' after-sale links stay. Off means hidden in the admin (a `feature` on its `STORE_SECTIONS` item and `ADMIN_PAGES` entry, held equal by `store-nav.test.ts`; `requireFeature(member, feature)` from `components/admin/feature-off.tsx` after a gated page's permission check; `TOOL_FEATURES` for AI manager tools, refused in `runOwnerTool()` and listed per store over MCP), and, from later steps, in the storefront and refused by the server. A new feature is an id in `FEATURE_IDS` and an entry in `STORE_FEATURES` (needs transitively complete), the `stores_features` check and `commerce.feature_needs()` in a migration, a backfill for stores that use it, its counts in `FeatureFacts`/`featureFacts()` with its blockers, warnings and `featureInUse()`, and `feature` tags on its pages and tools. The Selling group (step 3, `docs/store-features.md` 4c): a product is offered to shoppers only while its kind's feature is on (an appointment Appointments, a stay or rental Stays and rentals, one sold only as a subscription Subscriptions), asked only through `OFFERED` (`commerce.kind_offered()`, `kindOffered()`), and a purchase option only through `plansOffered()` (`selling-readers.scan.test.ts`); a booking's times only while its feature is on (`loadOffer()`, `loadRange()`), a resource's changes and calendars by its kind's feature (`resourceFeatureOn()`); `saveProduct()` refuses making a product of a kind that is off and keeps purchase options as stored while Subscriptions is off; a shop component that serves shoppers' links to what they already have is `afterSale` (still drawn, left out of the palette). Never read `stores.modules` for bookings or boxes: ask the feature. Hiding a feature's parts (step 2, `docs/store-features.md` 4a): admin parts ask `featureOn()` and show `FeatureOffNote`, storefront routes resolve with `resolveFeatureShop()` (404 while off), builder parts carry a `feature` tag (`STORE_PARTS`/`STORE_PIECES`, `SITE_PART_FEATURES`, `PRODUCT_PART_FEATURES`, read by `partFeatureOn()`: not drawn, not in the palette, "Switched off" on the canvas), and a `KNOWN_COOKIES` entry may carry `feature`. The Customers group (4b): who a store sells to is only `effectiveAudience()` (`store.audience`; the owner's choice is `chosenAudience`, edited on the Company page) and `commerce.store_audience()`/`STORE_AUDIENCE` in SQL (`audience-readers.scan.test.ts`): with `business` off the store sells to consumers; a product for one kind of buyer is offered only where the store sells to that kind (`OFFERED`/`commerce.product_offered()` on every shopper-facing product read, the cart and `placeOrder()`); switching it off clears open carts' company and VAT number. The bonus program works when the feature and `bonus_settings.enabled` are on (`commerce.bonus_program_on()`, `BonusProgram.on`); expiry pauses while it is off (`bonus_settings.paused_at`, `bonus_resume()` moves the dates that passed). The referral program works when its feature, its switch and the bonus program are on (`affiliate_program_on()`); an order attributed while it was on is still rewarded when paid. The Countries and languages group (step 4, 4d): the store's own country is `homeMarket(store)` (`store.markets[0]`, SQL `commerce.home_market()`); `store.markets` is the countries *offered* (`offeredMarkets()`: its own alone with `countries` off), `keptMarkets` every active one, `allMarkets` every one it had; `store.localization` follows `languages` and `currencies` (`languageChoice`/`currencyChoice`, `languageChoices()`, `marketChoices()`; `locales` in use, `keptLocales` all kept, `rates` every kept currency's, for history). A save writes only what its editor shows and keeps the rest (hidden countries' prices, fees and amounts, hidden languages' texts): a new per-country or per-language save does the same. Storefront pages resolve with `resolveShop()` and, finding none, call `marketMoved()` (308 to `movedMarketSlug()`; a page that streams calls `pageShopOrMoved()` before its `<Suspense>`); after-sale routes use `resolveAfterSaleShop()` (a new after-sale route too), pay and change links stay strict; carts, `placeOrder()` and drafts ask `commerce.market_offered()`; WordPress uses `offeredMarketIn()`, page parts `marketIn()`. Website mode (step 5, 4e): with `shop` off nothing is offered (`OFFERED` asks `feature_on(store, 'shop')`; the database refuses new orders, `orders.shop_off`), the shop's pages call `sellingPageOr404()` (the 404 or a manual redirect) and its actions and routes resolve with `resolveSellingShop()`, and the admin's selling pages carry `feature: "shop"`; the pages of what was sold (`AFTER_SALE_ADMIN_PATHS`) ask `requireShopOrAfterSale()`, and the withdrawal link and the checkout's legal pages (`LEGAL_ROLE_NEEDS`, `legalRoleNeeded()`) stay while `afterSaleOf()` (`src/server/after-sale.ts`, judged by `lineEligibility()`) says an order can still be withdrawn from or a return is open; a new selling page, action or route does the same, and a new place that draws products, a cart or a price asks the shop. Onboarding (step 6, 4f): the setup wizard asks "What will you sell?" first; answers become features only through `featuresForAnswers()` (`src/lib/onboarding.ts`) and `setFeatures()` (a whole set, with `setFeature()`'s rules, used by the wizard and store templates' pages), the answer is known from a `store.features_chosen` activity entry, and the wizard's steps are `setupStepsFor(features)` (`src/lib/setup-steps.ts`: a new step that needs a feature says so in `stepApplies()`); the AI manager's `list_features` and `set_feature` (gated, warnings kept with the approval as `approved_warnings`) switch as the page does.

## Live drills (D406, `docs/consolidation.md`, `src/lib/live-drills.ts`, `src/server/live-drills.ts`)

- **Live drills (D406, `docs/consolidation.md`, `src/lib/live-drills.ts`, `src/server/live-drills.ts`)**: the platform runs a test-mode store's money paths for real (`commerce.live_drills`, requested by `requestDrills()`, run only by `runLiveDrills()` in the five-minute dispatcher) through the screens' own functions, only on orders paid on a test account to `DRILL_EMAIL_DOMAIN`; a new drill is a kind in `DRILL_KINDS` with its words and a case in `runOne()`, and never touches a payment `testPayment()` does not call a test. Whether a payment was a test is `testPayment()` (`src/server/payment-mode-sql.ts`): a Stripe payment's `test_mode` is always false (closing a store and switching off selling abroad still ask the flag, counting test orders as obligations on the safe side). Kaizena Flow's Stripe endpoints follow the site's address (`keepStripeWebhooksCurrent()`).

## Self-serve sign-up (wave 9 unit F, D359, `src/server/self-signup.ts`)

- **Self-serve sign-up (wave 9 unit F, D359, `src/server/self-signup.ts`)**: while `platform_settings.self_serve_signup` is on (written only by
  `setSelfServe()`), a sign-up is counted by `takeSignupSlot()` (keyed hashes only), kept by `createAccessRequest()` and marked `self_serve`
  with a link kept as its hash; a store is made only by `confirmSelfSignup()` from the press on `/sign-up/confirm/{token}` (never by opening
  the link), through `approveAccessRequest(null, …)`, and starts `store_billing.trial_ends_at`, which `choosePlan()` passes to Stripe as
  `trial_end` (`trialEndFor()`). A new way to make a store without an admin goes through the same path and audits `store.self_signup`.

## Notices of illegal content (D411, `docs/dsa.md`, `src/lib/content-reports.ts`, `src/server/content-reports.ts`, `src/server/content-moderation.ts`)

- **Notices of illegal content (D411, `docs/dsa.md`, `src/lib/content-reports.ts`, `src/server/content-reports.ts`, `src/server/content-moderation.ts`)**: the DSA's notice
  mechanism for content on stores. The public form is `/report` (`ReportRoute`), linked from every footer by `ReportContentLink`; a new
  footer keeps it. `commerce.content_reports` is written only by `src/server/content-reports.ts`; a platform admin decides each notice at
  `/admin/platform/reports` with a reason, and the sender is told (art. 16(5)); the store's owners get the statement of reasons when content
  was restricted (art. 17), never the sender's name. An AI reads and drafts (part 2, `src/server/content-moderation.ts`, prompts in
  `src/lib/content-moderation.ts`) and checks new and changed listings (source `screening`, switch `platform_settings.content_screening`),
  but never decides, restricts or emails a store or a sender by itself; when it took part `ai_used` is set and the emails say so. Its answer
  is kept only in the checked shape of `AiReading` and drawn as text; a new kind of AI action on content keeps a person deciding.

## The status page (wave 9 unit G, D360, `src/lib/status.ts`, `src/server/status.ts`)

- **The status page (wave 9 unit G, D360, `src/lib/status.ts`, `src/server/status.ts`)**: `/status` and `/no/status` read only
  `statusOverview()` (cached under `STATUS_TAG`); checks are written only by `runStatusChecks()` (the five-minute dispatcher), one row per part
  of `STATUS_COMPONENTS` its probe could measure (a probe with nothing to measure returns null: *Not measured*, never up), incidents and
  updates only by `postIncident()`/`updateIncident()`, subscribers only by that module. A new part is an id in `STATUS_COMPONENTS` (and the
  tables' checks), a probe in `PROBES` and its words in the `status` catalogue of both platform languages; a missing check is never drawn as passed.

## The installable admin and push (wave 9 unit H, D361, `src/lib/admin-sw.ts`, `src/lib/push.ts`, `src/server/push.ts`)

- **The installable admin and push (wave 9 unit H, D361, `src/lib/admin-sw.ts`, `src/lib/push.ts`, `src/server/push.ts`)**: the service worker is
  only `adminServiceWorker()` at `/admin/sw.js` (scoped to `/admin/`): it caches the offline page and the icon only, never a signed-in page or
  data, and opens only admin addresses on its own site. A device's push subscription is written only by `src/server/push.ts`, for a member with
  `orders:read`, on a push service's host (`isPushEndpoint()`; the server POSTs there); a push carries no customer's data. A new notification
  is a sender there that reads the membership again before each device and removes a device gone (404, 410).

## Sign in with Google (wave 10 unit L, D375, `src/lib/google-sign-in.ts`, `src/server/google-sign-in.ts`)

- **Sign in with Google (wave 10 unit L, D375, `src/lib/google-sign-in.ts`, `src/server/google-sign-in.ts`)**: customers sign in with Google
  only through Kaizena Flow's own client on the platform's host (`/api/auth/google/start`, `/callback`) and a one-time hand-over on the store's
  host (`/api/shop/google/enter`); only an account the store already has, by Google's verified email (`checkIdToken()`), signs in, and nothing
  of the Google account is kept. Google's endpoints are constants, never configuration; a new provider follows the same shape.

## Leaving (wave 10 unit P, D377)

- **Leaving (wave 10 unit P, D377)**: an owner's or staff member's own account is erased only by `eraseOwnAccount()`
  (`src/server/account-erasure.ts`): the row is made anonymous in place (never deleted, many tables name it), what is only theirs is deleted,
  and it is refused for a platform admin, a store's last current owner, a host or a domain's holder; a new table of an account's own data
  (keyed by `account_id`) gets a line there and a register entry. The whole store as one file is only `storeExport()`
  (`src/server/store-export.ts`): a new store-owned table of site or settings goes in `STORE_EXPORT_TABLES`, and a secret column is named so
  `SECRET_COLUMN` leaves it out (a column naming a person, `PERSON_COLUMN`); any other store table is left out with its reason in
  `STORE_EXPORT_LEFT_OUT` (`src/lib/store-export-scope.ts`), and `store-export.scan.test.ts` fails on a table in neither.

## Content packs (D257, `docs/theme-showcase-phase-1.md` step 2)

- **Content packs (D257, `docs/theme-showcase-phase-1.md` step 2)**: demo stores per trade written as data (`CONTENT_PACKS`, `src/lib/content-packs.ts`; change one by raising its `version`), each a store template (D175) marked by `store_starters.pack_key` at `/s/pack-{key}`, written by `syncContentPacks()` (`src/server/content-packs.ts`) and nothing else: English only, the template's products archived, the pack's categories, its products through `saveProduct()` (never SQL: prices go through the editor's save with their entry), menus, and its pages (`packHomePage()` as the front page, `packAboutPage()`, `packProductsPage()`, in the core section styles) through `savePage()`. Pictures are `makeNextPackPicture()` only, one at a time (Kaizena Flow's picture model, feature `content_pack`, `packPicturePrompt()`: no words, logos or faces; a photograph marked `people` shows invented models' faces, `PEOPLE_RULES`, D282; every other shows no people, `PICTURE_RULES`, D283), placed before `pack_pictures` records them, and made by the job (D271: *Make the pictures* only asks, `askForPackPictures()`; `runPackPictures()` from `/api/cron/pack-pictures` every minute and `after()` the press, in the asker's name, one per pack and two packs at once, held by `picture_claimed_until`, stopping after `PICTURE_TRIES` failures with `picture_problem`), never by a page waiting for each; `publishStarter()` refuses a pack with pictures to make (`picturesMissing()`). A new pack is a key in `PACK_KEYS` with its data, free of claims (`content-packs.test.ts`).

## Hosts (D71, `src/server/hosts.ts`)

- Hosts (D71, `src/server/hosts.ts`): a store lists stays and rentals for
  outside hosts (`commerce.hosts`, added by owners at `/admin/{store}/hosts`
  with a commission). Hosts are never store members: store pages keep
  `requireMember()`, and the host area `/admin/hosting/{store}` uses
  `requireHost()` and shows only the host's listings (`products.host_id`),
  rooms and items (`booking_resources.host_id`) and their bookings
  (`listBookings(..., hostId)`). Host actions check the resource is the
  host's (`hostOwnsResource()`). Shared panels such as `ResourceCalendar`
  take their actions as props (`CalendarActions`, and `ConnectActions` for
  `StripeConnect`). A host not VAT registered sells without VAT (trigger
  `products_host_vat`). Paying hosts (`src/server/host-payments.ts`): an
  order is for one seller (`orders.host_id`; `placeOrder` refuses a mix as
  `host_mix`); `startCheckout` charges a host's order on the host's account
  (`hostCheckoutAccount()`) with Kaizen's fee plus `commissionOf()` as the
  application fee; `applySession` records the commission
  (`recordHostCommission()`; a no-show fee's through
  `recordNoShowCommission()` from `markNoShow()`), one per payment, sent by
  `payHostCommissions()` (also from the five-minute cron) and reduced by
  `reverseHostCommission()` after a refund of that payment.
  Queries joining a payment's `provider_account` to its store and mode use
  `commerce.connected_accounts` (stores' and hosts' accounts), never
  `stripe_accounts` alone.
  DAC7 (`src/server/dac7.ts`, `src/lib/dac7.ts`): hosts give their tax
  details (`host_tax_details`) and homes' addresses in their area; the
  store's report (`dac7Report()`, `/admin/{store}/hosts/dac7`, CSV for
  owners only) counts orders by the quarter of their `order.paid` event in
  the store's time zone. Text for spreadsheets goes through `toCsv()`.

## Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`, `src/lib/gravatar.ts`)

- Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`,
  `src/lib/gravatar.ts`): accounts and customers have `avatar_path` in the
  public `avatars` bucket, set with `AvatarPicker`. Draw anyone with
  `<Avatar avatar={avatarFor(person)} />`: their picture, else their
  Gravatar through the signed `/api/gravatar/{hash}` proxy (never link to
  Gravatar from a page), else their initials.

## Secrets in the database (Kaizen's webhook secrets, old per-store keys) are encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and…

- Secrets in the database (Kaizen's webhook secrets, old per-store keys) are
  encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and never
  sent to the browser.
