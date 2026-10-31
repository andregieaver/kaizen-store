@AGENTS.md

# Kaizena Flow

Kaizena Flow (formerly Kaizen Store; the code keeps `kaizen` in its names) is an AI-native online store selling EU-wide, built from scratch. The research and
phased build plan are in `docs/plan.md`; read it before architectural work.

## Workflow

- Commit and push straight to `main`, which deploys to production (D5): no
  feature branches or pull requests. Development is fast and tested in
  production, so run lint, typecheck and the tests before every push.
- Production is deployed by CI (`docs/ci-migrations.md`): a push without a new migration deploys at once and
  the checks report beside it; one with a migration waits for the checks, applies it, then deploys. Pushes
  of `*.md` and `docs/**` alone run nothing. Each deploy then waits until `/api/health` reports the commit (D389,
  `scripts/await-deploy.mjs`), and fails the job when it does not.

## Stack

- Next.js 16.4 (App Router, `cacheComponents` on), React 19, TypeScript, Tailwind 4, pnpm.
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

The admin as signed-in people see it is tested in `e2e/signed-in/` (D234): only with `E2E_SIGNED_IN=1`, in a build whose
`NEXT_PUBLIC_SUPABASE_URL` is the Auth stand-in `e2e/fixtures/auth-stub.mjs` (`http://127.0.0.1:3912`, any publishable
key), as CI's `signed-in` job does; `auth.setup.ts` signs an owner and a Read-only member in through the real form and keeps
their browser states (`test.use({ storageState: OWNER.state })`); a platform admin (`ADMIN`, D254) signs in through the real two-step page, the stand-in checking a code from `e2e/fixtures/totp.mjs`. Never add a bypass to the app's sign-in for a test: the
stand-in is the only fake, and only it is told it is one.

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
  (Supabase project `ybsozesfuxuitoacntfo`) and record the file's version in `docs/decisions.md` (Migration
  versions). A migration must keep the code that is still running working until the deploy finishes (add,
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

## Storefront

Each rule is in full in `docs/rules/storefront.md` under the same words; read it before changing that part.

- Kaizen is multi-tenant (`docs/platform.md`)
- Stores and their markets come from the database (`getStore()`, cached per store; `resolveShop()` for URL params)
- Interface text lives in `src/lib/i18n.ts` (each hand-written language in `src/lib/messages/{lang}.ts`, D212: a visitor's client component reads…
- Language and currency are apart from the country (D109; offered only while Several languages and Several currencies are on, D178 step 4)
- Catalogue reads in `src/server/catalog.ts` are cached (`'use cache'`, tag `catalog` and `catalog:{storeId}`); stock is read per request inside…
- Search (D72, `src/server/search.ts`, pure parts in `src/lib/search.ts`)
- Search merchandising (wave 6 unit F, D324, `docs/wave-6-catalogue.md` Unit F)
- Videos and 3D in the product gallery (wave 6 unit G, D325, `docs/wave-6-catalogue.md` Unit G, `src/lib/product-media.ts`)
- Content types (wave 6 unit H, D326, `docs/wave-6-catalogue.md` Unit H)
- A standard product taxonomy (wave 6 unit I, D327, `docs/wave-6-catalogue.md` Unit I)
- Speed (wave 7 unit B, D336, `docs/analytics.md` Speed, `src/lib/picture-sizes.ts`, `src/lib/speed.ts`, `src/server/analytics-speed.ts`)
- Each country's own (wave 7 unit D, D338, `docs/wave-7-storefront.md` D)
- Private mode (wave 7 unit E, D339, `docs/wave-7-storefront.md` E)
- What is sold where (wave 7 unit A1, D335, `docs/wave-7-storefront.md` A.1)
- Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` H as built)
- Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` I as built)
- Prices worked out per country (wave 7 unit A2, D335, `docs/wave-7-storefront.md` A.2)
- Blogs in depth (wave 7 unit G, D341, `docs/wave-7-storefront.md` G)
- Themes from outside (wave 7 unit J, D344, `docs/wave-7-storefront.md` J)
- By the clock, and links to share (wave 7 unit F, D340, `docs/wave-7-storefront.md` F as built)
- Sorting and filtering listings (D78, `src/lib/listing-filters.ts`, `src/server/listing.ts`, `FilterDialog`, `ProductListing`)
- A model that sees pictures (D163, `src/lib/ai-vision.ts`, `src/server/ai-vision.ts`, `ai_providers.vision_model`, the *Model that sees pictures*…
- AI providers (D73, `src/server/ai.ts`, `src/lib/ai-provider.ts`)
- AI product texts (D76, `src/lib/product-writing.ts`, `src/server/product-writer.ts`, `AiWriter`)
- The chat agent (D81, `src/lib/chat.ts`, `src/server/chat-agent.ts`, `src/server/knowledge.ts`, `ChatWidget`)
- Support (D216, `docs/support.md`, built in steps; §11 says what each step found)
- Prices are shown with `<Price>`, which adds the VAT label and shows the 30-day reference only for a genuine reduction
- Choosing in the storefront (D82) uses `Dropdown` (`src/components/dropdown.tsx`, a themed select-only combobox with pictures), never a native…
- The template store's product pages are prerendered at build time, so their content is plain HTML; stock and add-to-cart stream in and need JavaScript
- The cart (`src/server/cart.ts`) is per store and market, identified by an httpOnly cookie
- Payment credentials and payment-method switches are store settings edited in the admin, never environment variables (decision D15)
- Cookie consent (D58, `src/lib/cookie-consent.ts`)

## Admin

Each rule is in full in `docs/rules/admin.md` under the same words (the admin, and the features and integrations built through it); read it before changing that part.

- The admin's three levels (D107, `docs/admin-navigation.md`)
- The admin's look (D149, D217–D232, `src/app/admin/admin.css`, `docs/admin-style.md`)
- `/admin` has its own root layout
- `/admin` lists the account's stores; `/admin/{store}/…` is one store
- Sign-up and setup (`docs/platform.md`)
- Products (`/admin/{store}/products`)
- Checkout (`src/server/checkout.ts`, decision D16)
- Order numbers (D141, `src/lib/order-numbers.ts`, `src/server/order-numbers.ts`) are one sequence per store, without gaps, as some countries require
- Shipping is one flat rate per market (`commerce.shipping_rates`), optionally free above a basket value; a store with a carrier connected can also…
- `src/server/*.int.test.ts` are integration tests against a real database (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them
- Forms use `ActionForm`, which keeps what was typed when validation fails
- Stripe Connect (`src/server/connect.ts`, `src/server/stripe.ts`)
- Plans and billing (`src/server/billing.ts`, decision D18)
- Usage and limits (D314, `docs/capacity.md`; the cells of phase 5 are a proposal in `docs/cells.md`)
- Pages (`/admin/platform/pages` for Kaizen, `/admin/{store}/pages` for a store; decisions D42, D53)
- Copying another website's page (D150, `docs/page-replicator.md`, `src/lib/replicate*.ts` pure, `src/server/replicate*.ts`, `ReplicatePanel` on…
- The AI manager (D94, D103; `src/server/owner-assistant.ts`, `AiManagerChat`, `AiManagerLauncher`)
- The AI manager's marketing tools (PSI AGT-01, D318, `src/server/marketing-tools.ts`)
- The AI manager's team and plan tools (PSI AGT-01, D318, `src/server/staff-tools.ts`, `src/server/billing-tools.ts`)
- The AI manager's order changes and exchanges (PSI AGT-01, D318, `src/server/order-change-tools.ts`, `src/server/exchange-tools.ts`)
- The AI manager's Work tools (PSI AGT-01, D318, `src/server/work-tools.ts`)
- The AI manager's follow-ups (PSI AGT-04, D318, `src/lib/follow-ups.ts`, `src/server/follow-ups.ts`, `src/server/follow-up-runner.ts`)
- The AI manager's notices and saved skills (wave 8 unit F, D350)
- AI in the builder and a store from one description (wave 8 unit G, D351)
- The autopilot's goals, plans and loop (D309, `docs/ai-autopilot.md` 7; built)
- The AI manager's design tools (D308, `docs/ai-autopilot.md` 6.1, `src/lib/design-tools.ts` pure, `src/server/design-tools.ts`)
- The agent's eyes (D310, `docs/ai-autopilot.md` 9, `src/lib/page-look.ts` pure, `src/lib/page-look-shoot.ts`, `src/server/page-looks.ts`)
- Legal pages by AI (D311 unit L, `docs/ai-autopilot.md` 8; L1 sources, L2 writer and L3 upkeep built)
- The autopilot (D309, D328, `docs/ai-autopilot.md` 7 and 12)
- Web research (D329, `docs/ai-autopilot.md` 13, `src/lib/web-search.ts`, `src/lib/web-page-text.ts`, `src/lib/research.ts`, `src/server/research.ts`)
- Brand and look (D330, `docs/ai-autopilot.md` 14, `src/lib/brand.ts`, `src/lib/brand-design.ts`, `src/server/brand.ts`, `src/server/brand-tools.ts`)
- The AI manager's catalogue tools (D308, `docs/ai-autopilot.md` 3, `src/lib/product-tools.ts` pure, `src/server/product-tools.ts`)
- The AI manager's website tools (D308, `docs/ai-autopilot.md` 4.1, `src/lib/site-tools.ts` pure, `src/server/site-tools.ts`)
- The AI manager's setup tools (D308, `docs/ai-autopilot.md` 5.1, `src/lib/setup-tools.ts` pure, `src/server/setup-tools.ts`)
- Store analytics (D152, `docs/analytics.md`, `/admin/{store}/analytics/…`, store section Analytics)
- Reports (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` 3, `docs/analytics.md` Reports)
- Withdrawals and returns (D153, `docs/returns.md`, `/s/{store}/{market}/withdraw`, `/admin/{store}/returns`)
- The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`)
- Custom grid items and the carousel (D155, `docs/content-grid-custom-items.md`, `src/lib/custom-grid.ts`, `src/lib/custom-picture.ts`,…
- Tax profile and VAT engine (D157, `docs/wave-1a-tax.md`, `src/lib/vat.ts`, `src/lib/vat-treatment.ts`, `src/lib/ioss.ts`,…
- Legal pages and terms at checkout (D158, `docs/wave-1-trust.md`)
- Accessibility (D158)
- Pay routes (D158, `docs/pci.md`)
- Checkout branding (wave 7 unit C, D337, `docs/wave-7-storefront.md` C)
- Staff security (D158)
- Permissions (D158)
- Audit log (D158)
- Invoices and credit notes for shop orders (D159, `docs/wave-1b-invoices.md`)
- Unit price (D160, `docs/wave-1d-unit-price.md`, `src/lib/unit-price.ts`, `unit-price-rules.ts`, `unit-price-text.ts`, `unit-price-editor.ts`)
- VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`, `/admin/{store}/analytics/tax?view=vat|oss|ioss`, `src/lib/tax-*.ts`, `oss-return.ts`,…
- Personal data (D162, `docs/wave-1g-gdpr.md`)
- Data in and out (wave 2, D165, `docs/wave-2-data.md`)
- Redirects and the 404 report (wave 2, D168, `docs/wave-2-redirects.md`)
- The WordPress plugin (D169, `docs/wordpress-plugin.md`, `wordpress-plugin/kaizen-store/`, `public/downloads/kaizen-store-wordpress.zip`)
- Closing a store (D171, `docs/store-closure.md`)
- Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`, `/admin/{store}/settings/features`)
- Inventory (wave 3, D172, `docs/wave-3-inventory.md`)
- Orders: list, tags, archive, drafts, gift (wave 3, D173, `docs/wave-3-orders.md`)
- Fulfilment and order editing (wave 3, D174, `docs/wave-3-fulfilment.md`)
- Shipping methods, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md`)
- Customer notifications, tracking and staff alerts (wave 3, D238, `docs/wave-3-notifications.md`)
- Exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md`)
- Payment facts, risk and disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3, `src/lib/payment-facts.ts`, `src/server/payment-facts.ts`,…
- Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4, `src/lib/capture.ts`, `src/server/payment-capture.ts`)
- Live and revenue after a search (wave 8 unit C, D347, `docs/analytics.md` Live)
- Targets, alert emails and the briefing (wave 8 unit D, D348, `docs/analytics.md` Alerts, targets, forecast)
- Campaigns and first visits (wave 5 unit I3, D303, `docs/wave-5-marketing.md` 12.4)
- Payouts and real fees (wave 4 unit C, D290, `docs/wave-4-payments.md` 5, `src/lib/payouts.ts`, `src/server/payouts.ts`,…
- Payment methods per country (wave 4 unit D, D291, `docs/wave-4-payments.md` 6, `src/lib/payment-methods.ts`, `src/server/payment-methods.ts`)
- Live drills (D406, `docs/consolidation.md`, `src/lib/live-drills.ts`, `src/server/live-drills.ts`)
- Express checkout and wallets (wave 10 unit J, D373, `src/lib/express-checkout.ts`, `src/server/express-checkout.ts`)
- Payment providers (wave 4 unit E, D292, `docs/wave-4-payments.md` 7, `src/lib/payment-providers.ts`, `src/server/payment-providers/`,…
- Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8, `src/lib/payment-terms.ts`, `src/server/payment-terms.ts`)
- The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3, `src/lib/marketing-consent.ts`, `src/server/marketing-subscribers.ts`)
- Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4, `src/lib/segments.ts`, `src/server/segments.ts`)
- Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5, `src/lib/broadcasts.ts`, `src/server/broadcasts.ts`)
- Marketing email from the store's own facts (wave 8 unit H, D352, `src/server/broadcast-facts.ts`)
- Email automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6, `src/lib/automations.ts`, `src/server/automations.ts`,…
- Discounts in depth (wave 5 unit E, D299, `docs/wave-5-marketing.md` 7, `src/lib/discounts.ts`, `src/server/discounts.ts`)
- Gift cards (wave 5 unit F, D300, `docs/wave-5-marketing.md` 8, built in steps; F1 the model, F2 selling, F3 spending, F4 the owner's screens and…
- Owed to customers (wave 11 unit B, D381)
- Product reviews (wave 5 unit G, D301, `docs/wave-5-marketing.md` 9, built in steps; G1 writing, G2 checking and showing)
- Shopping agents (wave 8 unit I, D353, `src/lib/shopping-agents.ts`, `src/server/shopping-agents.ts`)
- Events to an owner's own endpoints (wave 9 unit A, D354, `src/lib/webhook-signature.ts`, `src/server/webhook-endpoints.ts`)
- The Admin API (wave 9 unit B, D355, `src/lib/admin-api.ts`, `src/server/api-tokens.ts`, `src/server/admin-api.ts`)
- Checkout rules and questions (wave 9 unit D, D357, `src/lib/checkout-rules.ts`, `src/server/checkout-rules.ts`)
- Versions compared and staging (wave 9 unit E, D358, `src/lib/version-compare.ts`, `src/server/site-staging.ts`)
- Self-serve sign-up (wave 9 unit F, D359, `src/server/self-signup.ts`)
- The Dream Factory (D409, `docs/dream-factory.md`, `src/lib/dream-factory.ts`, `src/server/dream-factory.ts`)
- Notices of illegal content (D411, `docs/dsa.md`, `src/lib/content-reports.ts`, `src/server/content-reports.ts`)
- The status page (wave 9 unit G, D360, `src/lib/status.ts`, `src/server/status.ts`)
- The installable admin and push (wave 9 unit H, D361, `src/lib/admin-sw.ts`, `src/lib/push.ts`, `src/server/push.ts`)
- The storefront API (wave 9 unit I, D362, `src/lib/storefront-api.ts`, `src/server/storefront-api.ts`, `src/server/storefront-route.ts`)
- A custom app's tools (wave 9 unit J, D363, `src/lib/custom-apps.ts`, `src/server/custom-apps.ts`)
- Workflows (wave 9 unit C, D356, `src/lib/workflows.ts`, `src/server/workflows.ts`)
- Refund to store credit and customer accounts (wave 10 units A and B, D364, D365, `docs/wave-10-must-haves.md`)
- Customers in the admin (wave 10 unit C, D366, `src/server/customer-staff.ts`, `src/server/customer-merge.ts`, `src/server/customer-import.ts`)
- Creators (wave 11 unit G, D386, `src/lib/creators.ts`, `src/server/creators.ts`)
- Moving in from another shop (wave 11 unit E, D384, `src/lib/product-csv-woocommerce.ts`, `src/lib/order-history.ts`,…
- Sign in with Google (wave 10 unit L, D375, `src/lib/google-sign-in.ts`, `src/server/google-sign-in.ts`)
- Leaving (wave 10 unit P, D377)
- Ad tags and shop events (wave 5 unit I1, D303, `docs/wave-5-marketing.md` 12, `src/lib/shop-events.ts`)
- Product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13, `src/lib/feeds.ts` pure, `src/server/feeds.ts`, `src/server/feed-settings.ts`)
- Saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1, `src/lib/customer-addresses.ts`, `src/server/customer-addresses.ts`)
- Themes, one concept (D273, `docs/themes-unified.md`, `src/lib/theme-admin-paths.ts`)
- Store templates (D175, D177, `docs/store-templates.md`, `src/lib/store-starters.ts`, `src/server/store-starters.ts`,…
- Design profiles (D176, D177, `docs/design-profiles.md`, `src/lib/design-presets.ts`, `src/server/design-presets.ts`, `/admin/platform/themes`)
- Themes and the theme library (D241, `docs/theme-phase-1.md`, phase 1 of `docs/theme-store.md`)
- Section styles (D242, `docs/theme-phase-2.md` step 1, `src/lib/section-styles.ts`)
- Pages following the theme (D243, `docs/theme-phase-2.md` step 2, `src/server/theme-detach.ts`)
- Trying a theme (D244, `docs/theme-phase-2.md` step 3)
- Theme updates (D245, `docs/theme-phase-2.md` step 4, `src/lib/theme-update.ts`)
- Theme checks and launch themes (D246, `docs/theme-phase-2.md` step 5)
- The theme store (D247, `docs/theme-phase-3.md`, phase 3 of `docs/theme-store.md`)
- Kaizena Flow's own site on themes (D251, `docs/theme-phase-4.md`)
- Theme presets (D256, `docs/theme-showcase.md`, `docs/theme-showcase-phase-1.md`)
- Content packs (D257, `docs/theme-showcase-phase-1.md` step 2)
- A theme's own content (D275, `docs/themes-content-and-demo-stores.md`; replaces D258's showcase per look)
- Demo stores (D277, `docs/themes-content-and-demo-stores.md` section 4, `src/server/demo-stores.ts`, `src/lib/demo-stores.ts`)
- Starting from a preset (D259, `docs/theme-showcase-phase-1.md` step 4)
- A new store's demo content (D260, `docs/theme-showcase-phase-1.md` step 4b, `src/server/demo-content.ts`, `src/lib/demo-content.ts`)
- A demo store's home page (D261, `docs/theme-showcase-phase-1.md` step 4c, `src/server/home-takes.ts`)
- Theme photographs (D264, `docs/theme-showcase-phase-2.md` step 1)
- Premium themes (D286, `docs/theme-prices.md`, `src/lib/theme-prices.ts`, `src/server/theme-prices.ts`)
- Signature themes (D267, D269, D281, D287, `docs/signature-themes.md`; Orbit, Atelier, Arcade, Botanica, Kinetic, Meridian)
- Kaizen Life (D95, `src/server/kaizen-life.ts`)
- Templates (D125, `src/lib/templates.ts`, `src/lib/template-content.ts`, `src/server/templates.ts`, `TemplatesTab`/`TemplatesModal`)
- Page layouts and preview (D127, `src/lib/page-layout.ts`, `src/lib/page-layout-apply.ts`, `previewTemplate()`, `TemplatesPreview`,…
- Motion (D128, `src/lib/motion.ts`, `src/lib/motion-attrs.ts`, `src/lib/motion-runtime.ts`, `src/app/motion.css`, `src/lib/motion-plan.ts`,…
- Duplicating a store (D129, `docs/store-copy.md`, `src/lib/store-copy.ts`, `src/lib/store-copy-rules.ts`, `src/server/store-copy.ts`,…
- The bonus program (D130, `docs/bonus.md`, `src/lib/bonus.ts`, `src/server/bonus.ts`, SQL `commerce.bonus_*`)
- The affiliate program (D131, `docs/referrals.md`, `docs/affiliates.md`)
- Kaizen's plans on its own pages (D142, `src/lib/plan-offer.ts` pure, `src/server/public-plans.ts`, `PlansView`/`PlansSection`, block `plans`)
- Kaizen's own front page, blog and 404 page (D143, `src/lib/platform-roles.ts`, `src/server/platform-roles.ts`, `commerce.platform_page_roles`,…
- The plan comparison (D132, `src/lib/plan-features.ts`, `src/server/plan-features.ts`, `PlanFeatureTable`, `/admin/platform/plans/features`)
- Shipping carriers (D133, `docs/shipping-carriers.md`, `src/lib/shipping-carriers.ts`, `src/server/shipping-carriers.ts`,…
- Posten / Bring (D134, `src/lib/bring.ts`, `src/server/carriers/bring.ts`, `src/server/bring-shipping.ts`)
- Delivery options at checkout (D135, `src/lib/delivery-options.ts`, `src/server/delivery-options.ts`, `src/server/delivery-choice.ts`,…
- PostNord (D136, `src/lib/postnord.ts`, `src/server/carriers/postnord.ts`)
- Porterbuddy (D137, `src/lib/porterbuddy.ts`, `src/server/carriers/porterbuddy.ts`, `src/server/porterbuddy-shipping.ts`)
- Helthjem (D138, `src/lib/helthjem.ts`, `src/server/carriers/helthjem.ts`, `src/server/helthjem-shipping.ts`)
- Product recommendations (D139, `docs/recommendations.md`, `src/lib/recommendations.ts` pure, `src/server/recommend.ts` engine,…
- A/B tests of pages (D148, `docs/ab-testing.md`, `src/lib/experiments.ts`, `src/server/experiments.ts`, `experiment-admin.ts`,…
- Responsive editing (D179, `docs/responsive-editing.md`, phases 1 to 4 built)
- Theme elements, content width and resizing (D182, `docs/theme-elements.md`)
- The Theme tab and the site (D195)
- Themes on every row, rows that meet, shadows, sidebars and the rail (D262)
- Saved colours and gradients (D183, `docs/theme-elements.md`)
- Lines of columns in a row (D187)
- Nested columns (D294, `ColumnsBlock` in `src/lib/page-content.ts`)
- Editing words where they are (D191, D192, D193)
- Undo, redo and versions (D305), CSS on the live site (D306)
- Find and replace (D307)
- Table component (D194, `src/components/table-view.tsx`, `src/lib/table-edit.ts`)
- Brands (D204, `src/components/brands-view.tsx`, `src/components/brands-carousel.tsx`, `src/lib/brands.ts`)
- Hover timing, button hover effects and logo colours (D206, `src/lib/hover-timing.ts`, `src/components/admin/hover-fields.tsx`)
- Menu hover and active (D207, `src/lib/menu-hover.ts`, `src/components/menu-glide.tsx`, `MenuHoverFields`)
- Components in an FAQ's answers (D208)
- Gallery (D209, `src/lib/gallery.ts`, `src/components/gallery-view.tsx`, `src/components/gallery-lightbox.tsx`)
- What a visitor loads (D211, `docs/performance.md`)
- Compressing pictures and videos (D213, `docs/media-compression.md`)
- Icon list gradient (D199)
- Text styles (D393, `docs/text-styles.md`, `src/lib/text-styles.ts`, `src/server/text-styles.ts`, `src/components/admin/text-styles.tsx`)
- Text on a part's own background (D390, `src/lib/background-surface.ts`)
- Text colour (D180, `docs/text-colour.md`)
- Duplicating pages (D126, `src/lib/page-duplicate.ts`, `src/server/page-duplicate.ts`, `DuplicateButton`)
- Product layouts (D79, `src/lib/product-layout.ts`, `src/components/product-parts.tsx`, `src/server/product-layouts.ts`)
- Custom fields (D118, `docs/custom-fields.md`, `src/lib/custom-fields.ts`, `src/server/custom-fields.ts`)
- Modals (D121, `src/lib/page-modal.ts`, `src/components/page-modal.tsx`, `ModalFields`)
- Work (D122, D123, `docs/work.md`, module `work` switched on per store in the owner's Work settings, at the store OWNER's level
- Headers and footers (D80, `src/lib/site-layout.ts`, `src/components/site-parts.tsx`, `src/server/site-layouts.ts`)
- Design themes (D60, `src/lib/theme.ts`, `src/server/themes.ts`)
- Fonts (D59, `src/lib/fonts.ts`, `src/server/fonts.ts`)
- Categories and tags (D50, `src/lib/taxonomy.ts`, `src/server/taxonomy.ts`)
- Campaigns (D114, `src/lib/campaigns.ts`, `src/server/campaigns.ts`, `/admin/{store}/campaigns` under Sales)
- Customer groups and company accounts (D108, `src/lib/customer-tiers.ts`, `src/server/customer-tiers.ts`, `src/server/companies.ts`)
- B2B in depth (wave 6 unit C, D321, `docs/wave-6-catalogue.md` C.4 to C.6)
- Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1 to D.6)
- Quantity rules (wave 6 unit E1, D323, `docs/wave-6-catalogue.md` E.1, `src/lib/quantity-rules.ts`)
- Selling to businesses (D63, `src/lib/b2b.ts`, `src/server/b2b.ts`)
- Bookings (D65, `docs/bookings.md`)
- Hosts (D71, `src/server/hosts.ts`)
- Demo products
- Kaizena Flow's own site in more than one language (D312, `docs/platform-admin-i18n.md`, `src/lib/platform-lang.ts`)
- Sites' icons (D62) are `navigation.favicon` (a 512 and a 64 pixel PNG made in the browser by `squareIcon()`), linked by `siteIcons()` in every…
- Menus (D85, `commerce.menus`, `src/server/menus.ts`, `MenuEditor`)
- The theme store's pages (D285, `src/lib/theme-store-parts.ts`, `src/components/theme-store-section.tsx`, `src/components/theme-page-parts.tsx`)
- Pictures by prompt (D283, `src/lib/picture-direction.ts`, `src/server/picture-maker.ts`, `src/server/picture-route.ts`, `picture-maker.tsx`)
- Pictures made and edited in the library (wave 8 unit E, D349, `src/lib/picture-edit.ts`, `src/server/picture-editor.ts`)
- The media library (D88, `src/server/media-library.ts`, `MediaLibrary`)
- Kaizen's own header and footer (`/admin/platform/navigation`) use the store's `NavigationEditor` (logos, icon, which menus, and business details);…
- Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`, `src/lib/gravatar.ts`)
- Light and dark (D99, `src/lib/color-mode.ts`)
- Owners' own CSS (D100, `src/lib/custom-css.ts`, `CssPanel`)
- Slack (D101, `src/lib/slack.ts`, `src/server/slack.ts`)
- Subscription boxes (D102, named so in every text shoppers and staff read; `src/lib/standing-orders.ts`, `src/server/standing-orders.ts`,…
- Secrets in the database (Kaizen's webhook secrets, old per-store keys) are encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and…

## Conventions

- Every screen a person uses serves two people (Homer and Lisa: System 1 and System 2). The default view is for Homer: simple, intuitive and distraction free, one clear main action, sensible defaults chosen for him, words for what he gets rather than settings, and nothing to understand before pressing the obvious button. Lisa's depth (every setting, per screen size, own CSS, versions, what changes, undo) is one deliberate step away (Customise, Advanced) and never in Homer's way. A new screen passes when Homer can finish without reading anything and Lisa can still reach every setting.
- The platform's name is Kaizena Flow (D240) in every string a person or an assistant reads, and its domain `kaizenaflow.com`; `Kaizen` stays in code names, cookie names, the webhook headers and Kaizen Life (another product). `src/lib/brand.scan.test.ts` fails on the old name or an old domain in any string.
- Environment variables are validated in `src/lib/env.ts` when used, not at
  import, so builds and tests run without secrets.
- Server-only modules import `server-only`.
- New reads, and every read that carries money, describe their row with `col` and go through `typedRows()`/`typedRow()`
  (`src/server/typed-rows.ts`: each row checked with zod; a `bigint` sum is `col.minor`, a `char(3)` code `col.currency`; a row of
  another shape throws `RowShapeError`, naming the column, never the value; rows another runner fetched, such as analytics'
  `setBased()`, through `checkedRows()`); `coalesce()` a sum that may meet no rows. A writer of `commerce.stores` refreshes the store's
  tag itself (`refreshTag(storeTag(slug))`, `refreshStoreById()`; `store-writers.scan.test.ts`), which does nothing outside Next. Older
  `execute<Row>()` reads move over when touched (`gift-cards-admin.ts` is the first).
- New server code logs through `log(level, event, fields, error)` (`src/server/log.ts`: one JSON line, ids and counts, never a
  person's data or a secret, D400: no `console.error` is left in `src/server` but `log.ts`). Every cron route has a `maxDuration` and runs
  inside `trackedRoute()`/`tracked()`, and the five-minute dispatcher runs each job through `runJobs()` (`src/server/cron-runs.ts`):
  each run is kept in `commerce.cron_jobs`, a job that throws is logged and the others finish, and the platform home and
  Usage and limits say which job is late or failing (`src/lib/cron-health.ts`); `cron-routes.scan.test.ts` holds new routes to it.
- AI features must stay grounded: the model never states a price, stock level or
  product it was not given by a tool; arithmetic happens in code; model output is
  rendered as text, never as HTML. Every system prompt carries the rule in
  `src/lib/prompt-safety.ts` (`UNTRUSTED_TEXT`, or `RULES_STAND` where the input is
  meant to steer); `prompt-safety.scan.test.ts` fails for a new prompt without it.
  The agents' safety eval (`src/lib/agent-eval.ts`, run by `src/server/agent-eval.ts` from Platform → AI, kept per model in
  `commerce.ai_eval_runs`) plays the shopper chat and the AI manager with their real prompts and tools on scripted tool answers that
  hide instructions; run it after changing a prompt, a tool's description or the platform's model, and add a case with any new way
  outside text reaches a prompt (`agent-eval.test.ts` checks every tool a case names exists). Prompts are versioned (D391,
  `src/server/prompt-versions.ts`: each drawn with fixed inputs and hashed; a new agent's prompt gets a fixed drawing there and a version
  in `promptVersions()`), kept with every answer and eval run; CI replays the recording of a real run kept as
  `src/data/agent-eval-recording.json` (`agent-eval-replay.int.test.ts`), so a changed prompt or a new case needs a new run on
  Platform → AI and its recording committed. The AI manager's conversations go after the retention rule's period or the owner's own
  (`stores.assistant_keep_months`, `pruneAssistantConversations()`); the chat's notice says when an AI reads tone or summarises
  (`ChatWidgetProfile.aiUse`), so a new AI use of a customer's messages is said there too.
- Deferred work from the PSI audit is tracked in `docs/audits/psi-followups.md`: tick
  an item there when a change does it.
