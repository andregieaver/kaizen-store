# Plan: Shopify parity (target 100%)

Starting point: `docs/shopify-parity.md` (first written 2 October 2026), now generated from the tracker in `docs/parity/`.
The current score, the evidence still owed, and the score each wave would reach are produced by `pnpm parity` from that
data, so none of them is copied into this plan where it would go stale. Returns and withdrawal (D153) and the analytics
cockpit (D152) have shipped and are already in the figures. This plan is the route from there to "every core row Full",
and says honestly which rows cannot be got there by code.

## 1. What "100%" means (the scoring rule)

A row counts as Full only when it passes an **acceptance test written for that row**: a stated behaviour (the row's
"what is lacking" turned into criteria), a test in the repo (unit, integration or e2e), and a screen or API that a
merchant can use. "A table exists" or "code exists" is not Full. Every wave ends with a skeptic re-rating of the rows it
touched (as the parity check did: a different agent tries to show the row is still short), and the headline is
recomputed from a machine-readable tracker, not edited by hand.

Every row that is Partial or Missing sits in one of four buckets (the `bucket` field of its row; `pnpm parity` counts them
and shows how many headline points each holds). The first is the plan; the others need a decision or leave a ceiling.

| Bucket | What it means |
|---|---|
| **A. Build in-house** | Code, schema, screens, tests. Everything in waves 1 to 9. |
| **B. Build, but depends on a third party** | Needs an agreement, approval or credential Kaizen does not control: Klarna, Apple Pay and Google Pay domain verification, Google Merchant Center, Meta, TikTok and Pinterest catalogues, Swish and Vipps (blocked on Stripe, D23), carrier labels beyond Norway, an IOSS intermediary, accounting vendors. Built and tested against sandboxes; "Full" only once the live approval exists. |
| **C. Strategy decision first** | PayPal (needs a second payment provider), POS, extension/app platform, headless Storefront API, SMS, mobile admin app, marketplace. See section 5. |
| **D. Not reachable by code** | Support channel and uptime promise, recorded data-processing agreements, accessibility audit evidence, human legal review of every legal text, industry benchmarks and Shopify Audiences (need Shopify's own network data), the Shop app and Shop Pay consumer network (proprietary). These are done as far as software goes, then declared *equivalent or not applicable* with reasons. They never count as Full. |

Realistic ceiling: **all of A and B built, C as decided, D declared**. `pnpm parity` prints it from the data: the score
with every bucket A row Full and B, C and D as they are, and the score with B built and approved as well. The last
points are bucket D and Shopify's network effects, which no feature list closes. The plan reports both numbers: *built*
(rows passing tests) and *live* (also approved and operated).

## 2. Wave 0: before the first parity wave (about 2 workflow runs)

1. Ship D153 (returns and withdrawal) and finish its review and fixes. Ship D152 analytics. **Done.**
2. **Parity tracker as data** (**done**): `docs/parity/rows/*.json`, one file per domain, with an id, weight, rating,
   bucket, wave, acceptance criteria, evidence (files and tests) and a history of rating changes for every Shopify row,
   core and app-only. `src/lib/parity.ts` holds the rules and the arithmetic, and `pnpm parity` prints the headline, the
   per-domain scores, the evidence still owed and the projection per wave. `pnpm parity:check` and a unit test fail when a
   row breaks a rule (a Full row with no existing test file, a changed rating with no history) or when
   `docs/shopify-parity.md`, which `pnpm parity:write` generates from the rows, is out of date.
3. Re-fetch the rows whose Shopify side rests on memory, so the target itself is right. **Done**; the rows that still
   could not be read are counted by `pnpm parity`.
4. A **wave template**: the workflow used for D153 (spec, foundation, server, surfaces in parallel, gates, adversarial
   review in three lenses, fix, then production migration and push), saved as a named workflow so every wave starts the
   same way. **Done**: `.claude/workflows/parity-wave.js`, described in `docs/parity/WAVES.md`.

## 3. The waves

Order: legal exposure first, then how many rows one piece closes, then dependencies (data in and out before bulk tools;
payments abstraction before new methods; the extension model last because it rests on everything else). Sizes are in
**workflow runs** (one run is roughly one D-numbered feature, as D139 or D152 were), my estimate, not research.

The score each wave would reach is not written here: `pnpm parity` prints the projection per wave (every row planned for
waves 1 to N becoming Full, and the same with only the bucket A rows), computed from each row's `wave` and `bucket`, and
`docs/shopify-parity.md` carries the same table, generated. Moving a row between waves is an edit to its `wave`.

### Wave 1: Compliance and money correctness (6 to 8 runs)
- **VAT depth and reporting**: reduced-rate categories and rates editable in the admin (today they live in
  migrations), VAT by country and rate report with export for OSS filing, EU VAT ID check (VIES) with reverse charge and
  exemption, IOSS support for non-EU shipments (needs an intermediary: bucket B).
- **Invoices and credit notes for shop orders** in Kaizen's own gap-free series (the Work module's `issue_work_invoice`
  machinery is the model), legal invoice PDF, credit note per refund (also closes "credit notes for refunds").
- **Unit price indication** (price per kg or litre): field, display, structured data, per-category rules.
- **Legal page starters** (privacy, terms, returns, shipping, withdrawal information, imprint) in nb, sv, da, en, written
  by hand and **flagged for review**, plus a terms-acceptance link at checkout.
- **GDPR**: customer data export, staff-triggered erasure with the order-retention exceptions, retention schedule.
- **Staff security and roles**: two-step authentication, roles beyond owner and admin with per-section permissions, a
  complete audit log (also closes "staff accounts and roles" in two domains).
- Accessibility audit tooling (automated WCAG checks in CI, statement generator); the audit evidence itself is bucket D.

### Wave 2: Data in and out (4 to 5 runs)
- One **import and export pipeline** (jobs table, validation, dry run, resumable, per-store limits) for products, orders,
  customers, redirects and report tables; bulk product editing; **migration importers** for Shopify and WooCommerce
  exports (this is also the sales path for merchants arriving from them).
- **Redirect manager** (automatic on handle change for products, categories, pages; manual and bulk; 404 report).
- Scheduled report emails; accounting exports and a second accounting connector next to Tripletex.

### Wave 3: Inventory and order operations (7 to 9 runs)
- **Inventory page**: levels per location, adjustment history with reasons, bulk update, low-stock alerts, backorders and
  pre-orders, transfers and purchase orders, routing between locations.
- **Orders**: search, filters, saved views, tags, archive, bulk actions, **draft orders and payment links**, order editing
  after purchase (add and remove lines, reprice, re-take payment or refund the difference), **partial fulfilment**,
  gift receipts and messages, staff alerts, **editable notification email templates** (subject and body per event and language, with
  switches; legally required mails stay on) and order automation rules.
- **Shipping**: rate tables by weight and value, zones inside a country, per-product profiles, local pickup at a store
  location, local delivery by postal code, tracking page and delivery notifications, carrier labels for the carriers
  already connected (D133 to D138) with return labels (builds on D153), exchanges (refund plus new order, linked).

### Wave 4: Payments breadth (5 to 6 runs)
- **Payment-method control in the admin**: request and show iDEAL, Bancontact, SEPA, BLIK, EPS, P24 per market, subscription
  support where Stripe allows; Klarna; Apple Pay and Google Pay domain verification (bucket B).
- **Authorise then capture**, **disputes** (webhook, evidence deadline, order flag), fraud flags, **payouts and
  reconciliation**, payments reports by method, B2B payment terms (invoice due dates, net 30).
- **Payment-provider abstraction** (a `PaymentProvider` adapter next to the Stripe code) *if* section 5 decision 1 is yes:
  then PayPal through that provider, and Swish and Vipps where a provider offers them.

### Wave 5: Customers and marketing (8 to 10 runs)
- **Subscriber list with consent**, broadcasts, **dynamic segments** (RFM already computed in D152 becomes selectable),
  lifecycle automations (welcome, post-purchase, win-back, back-in-stock), forms and pop-ups that build the list.
- **Discounts depth**: scope by category and tag, customer eligibility, minimum quantity, several codes per order, bulk
  code generation, tiered and volume discounts, automatic discounts, richer buy-X-get-Y, stacking rules.
- **Gift cards** (with a liability report), **product reviews and UGC** (verified purchase, moderation, structured data),
  SMS (decision).
- **Channels**: Google Merchant Center feed and the Meta, TikTok and Pinterest catalogues from one normalised feed
  (`docs/plan.md` Phase 6 design), ad pixels and server-side conversion events behind consent, UTM-based campaign
  attribution on top of D152's visit counting.
- Customer accounts depth (several addresses, data export, order history search), affiliate depth.

### Wave 6: Catalogue (4 to 5 runs)
- Variant limit raised (100 to the thousands, with a real matrix editor), **smart collections** by rule, bundles,
  volume pricing and quantity rules, B2B catalogues and price lists, standard taxonomy and attributes, SEO fields
  completeness, search merchandising (synonyms, boosts, pins), video and 3D media, combined listings, metaobjects.

### Wave 7: Storefront and international (5 to 6 runs)
- Per-device editing in the builder, a **speed report**, image formats per device, scheduled changes with auto-revert,
  version history with shareable preview, storefront password, blog depth (several blogs, authors, comments, RSS),
  theme and template marketplace depth.
- **Markets**: fixed per-market prices and adjustment rules, market-specific catalogues and content, domains per market,
  geolocation suggestion, **customs, duties and landed cost** (HS codes exist; DDP quoting), producer-responsibility
  (EPR) registers that can block selling.

### Wave 8: Analytics and AI (5 to 6 runs)
- Live view, a **report builder** over a safe query layer (never free SQL), natural-language analytics on top of it,
  payments and attribution reports, targets and forecast completion, on-site search analytics depth.
- AI: image editing, the chat agent with **order and return lookup and human handoff**, the manager gaining product, page
  and menu editing tools (all gated), the AI half of the **workflow builder** (the engine itself is wave 9's Flow, so this row is tracked in wave 9), AI marketing
  email, agentic storefront endpoints (UCP/MCP and feeds for ChatGPT, Gemini and Copilot shopping).

### Wave 9: Platform and extensibility (6 to 8 runs, after the decisions in section 5)
- Public **Admin API** with scoped tokens, **outgoing webhooks** for every event with signing and retries, workflow
  automation (Flow equivalent: triggers, conditions, actions), custom logic hooks (sandboxed, pricing and shipping
  rules, not arbitrary code), store staging and theme versions, a **status page**, self-serve sign-up and onboarding, a
  mobile admin (installable app), and, if chosen, the app platform, headless Storefront API, POS and a marketplace.

Totals: about **55 to 70 workflow runs**. At the pace of the last weeks (several features per day, each verified and
shipped) that is a few weeks of work with the gates unchanged, not months, but the live and approval parts (bucket B and
D) run on other people's clocks.

## 4. How each wave runs (so quality does not erode as it gets bigger)

1. **Spec first**: a contract doc like `docs/returns.md` (behaviour, data, rules, where things live, what is deliberately
   not done), and the rows it closes with their acceptance criteria.
2. **Foundation then surfaces**: schema, migrations and DB rules and pure libraries first; then server; then shopper, admin and
   analytics/AI surfaces in parallel (they must not share files except through the registered lists: nav, admin map,
   i18n, COPY_RULES, plan features).
3. **Gates every time**: lint, typecheck, unit, integration against a fresh database, build, storefront e2e, `db:check`.
4. **Adversarial review in three lenses** (law/behaviour, security and privacy, money and data integrity), findings
   reproduced before fixing, regression test per fix.
5. **Ship**: production migration applied and recorded, advisors checked, push to `main`, a decision row (D154 onward),
   CLAUDE.md bullet, the plan-features comparison updated (D132), the AI manager's tools and skills for the new area.
6. **Re-rate** the touched rows with a skeptic, regenerate the parity tables, and publish the new headline.
7. **Standing rules for every wave**: multi-tenant (store id on every query), multi-currency (euro scenario for any money
   read), copy rules for every new table, no cookie without a consent entry, hand-written legal text flagged for review,
   AI features grounded with a no-AI fallback, performance budgets for anything on a hot storefront path.
8. **One wave edits the shared registries at a time**; two waves run in parallel only when their file areas are disjoint
   (for example wave 2 and wave 8).

## 5. Decisions needed from you

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **PayPal and a second payment provider** (Stripe does not allow PayPal for platforms taking direct charges, D23) | Stay Stripe-only and accept the PayPal row; add a provider adapter with Mollie (EU, many local methods, PayPal) or Adyen for stores that choose it | Add the adapter with Mollie as the first alternative; keep Stripe the default. PayPal is a large share of German top-shop revenue, and the adapter also unlocks Swish and Vipps. |
| 2 | **Extension platform** (Shopify's biggest advantage is its App Store) | Public API and webhooks only; or OAuth apps with scopes and a listing; or full UI extensions | API, webhooks and scoped custom apps first (wave 9); a public app directory only after there are outside developers asking. |
| 3 | **POS and retail** | Skip; later; build a simple tablet POS on the existing orders and Stripe Terminal | Defer. It is a weight-2 row and a large build (hardware, offline). Revisit after wave 9. |
| 4 | **Headless Storefront API** | Skip; GraphQL read API on the catalogue and cart | Cheap once the Admin API exists; do it in wave 9, weight 2. |
| 5 | **SMS marketing** | Skip; integrate a provider (EU-hosted) | Integrate one provider after email broadcasts; consent and quiet hours as for email. |
| 6 | **Mobile admin** | Responsive admin only; installable PWA; native apps | PWA with push notifications for orders; native apps are not worth it yet. |
| 7 | **Marketplace and multi-vendor** | Keep hosts (D71) only; full multi-vendor | Keep hosts; weight 1. |
| 8 | **Operational rows** (support channel, uptime promise, status page, DPAs, audit evidence) | Treat as company work, not software | Software provides the status page, support inbox and evidence checklist; the company provides the people and signatures. |
| 9 | **Is the goal the score or the merchant?** | Chase every row; or stop at rows that matter to an EU small or mid-size merchant | Build all of A and B; for weight 1 and 2 rows in C and D, do them last and decide per row. |

## 6. Risks

- **Scope growth in the core**: promotions, order editing and draft orders are where rebuild costs sit (`docs/plan.md`);
  they come with the largest test matrices (every kind of product through cart, checkout and order, in two currencies).
- **Admin and storefront weight**: more features mean slower pages. Each wave carries a budget and the existing
  performance guards (`analytics-perf.int.test.ts` style) for heavy reads.
- **Test-suite time**: already thousands of tests; keep the integration suite parallel-safe and fast, and watch CI minutes.
- **Legal text**: machine-drafted legal text is a liability; every legal starter is flagged and needs human review before
  real use, which is bucket D by definition.
- **Moving target**: Shopify ships every quarter. Re-fetch the Shopify side at the start of waves 5 and 9 and after
  each Edition; the tracker makes drift visible as new rows rather than a falling score nobody can explain.
- **Production-only workflow** (`main` deploys): every wave's migrations are additive and applied only after tests pass;
  destructive changes need a separate, reviewed step.

## 7. First three steps

1. Finish and ship D153 (done).
2. Wave 0: the tracker (done), the re-fetches (done), the saved wave workflow (`docs/parity/WAVES.md`).
3. Wave 1 starts with **VAT depth and reporting** and **invoices and credit notes** (one spec, one run each), because
   they are the largest weighted gap after returns and every later money feature (draft orders, order editing, gift
   cards, payouts) depends on correct VAT and invoicing.
