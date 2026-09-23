# Decisions

The Phase 0 decision record. Each entry says what was decided, when, and what it
changes. Open items name who has to act. Background for every item is in
[`plan.md`](plan.md).

## Settled

| # | Decision | Date | Consequence |
|---|---|---|---|
| D1 | **Establishment: Scenario A.** An EU company ships from stock in its own member state. | 2026-09-23 | VAT through the Union One-Stop Shop (OSS) once EU distance sales pass €10,000 a year; no import VAT or customs; no IOSS. The member state is still open (O1). |
| D2 | **Launch in a few countries first**, not EU-wide on day one. | 2026-09-23 | All 27 EU markets exist in the database but are inactive. Launch countries are switched on by setting `commerce.markets.active`. Which ones is open (O2). |
| D3 | **Payments: Stripe.** Checkout Sessions with the Payment Element, Stripe Tax for VAT. | 2026-09-23 | Keeps card data off our servers (PCI DSS SAQ A). Local methods are configured per market in Stripe. `products.tax_code` holds the Stripe Tax code. |
| D4 | **Commerce core built from scratch**, not on an open-source platform. | 2026-09-23 | We own catalogue, pricing, carts, orders, returns and promotions. The plan's Medusa re-evaluation before Phase 5 is dropped unless promotions or returns prove too costly. |
| D5 | **Changes go straight to `main`**, which deploys to production. | 2026-09-23 | Fine while the site is a placeholder. Revisit before launch: switch to pull requests with preview deployments and a Supabase branch per pull request. |
| D6 | **Region: Ireland.** Supabase `eu-west-1`; Vercel functions pinned to `dub1`. | 2026-09-23 | Replaces the plan's Frankfurt assumption. Both are in the EU; functions sit next to the database. |
| D7 | **One Next.js app**, not a monorepo. | 2026-09-23 | Split into packages when a second deployable (such as the MCP server in Phase 4) needs shared domain code. |
| D8 | **Commerce data in a private `commerce` schema**, reached only by server code over a direct connection. | 2026-09-23 | Supabase's Data API never exposes it; row-level security is on with no policies as a backstop. Browser code never queries commerce tables. |
| D9 | **Drizzle schema is the source of truth**; migrations are generated into `supabase/migrations` and applied to Supabase by Claude as they land. | 2026-09-23 | CI fails if schema and migrations disagree. See the note on migration versions below. |
| D10 | **Data residency: EU vendors wherever an EU option exists at similar cost.** A US processor is acceptable only with a DPA and the EU–US Data Privacy Framework or standard contractual clauses, and only when no reasonable EU option exists. | 2026-09-23 | Default set by Claude pending your confirmation. Every vendor is listed in [`residency-register.md`](residency-register.md) before it touches production data. |
| D11 | **Build to WCAG 2.2 AA** whatever the company's size. | 2026-09-23 | Removes the need to decide microenterprise status for the European Accessibility Act. EN 301 549 v4.1.1 (WCAG 2.2) is published but not yet cited in the Official Journal. |

### Migration versions

Supabase records each migration with the version it was applied at, not the
timestamp in the file name. The first three were recorded as `20260923130719`
(`commerce_schema`), `20260923130802` (`commerce_rules`) and a later version for
`index_foreign_keys`. This does not matter while migrations are applied through
Supabase's API. If the Supabase CLI is adopted later (for example for
branching), run `supabase migration repair` once to align the history.

## Open

| # | Item | Owner | Needed by | Notes |
|---|---|---|---|---|
| O1 | Which member state the company is established in | You | Phase 1 | Sets the home VAT rate, invoice rules, the language of legal texts and where the warehouse is. |
| O2 | The launch countries (3–5), with languages and currencies | You | Phase 1 | Each needs translated legal texts, local payment methods, a consent review and delivery options. |
| O3 | Product category | You | Phase 1 | Drives reduced VAT rates, withdrawal exclusions, packaging, battery and electrical-waste registration, and whether AI try-on matters. The schema stays category-neutral until then. |
| O4 | Accountant sign-off on the OSS route and invoicing | You + accountant | Phase 1 | Includes invoice numbering per series (`commerce.document_series`). |
| O5 | Packaging (PPWR) and other producer-responsibility registrations per launch country | You | Phase 1 | Depends on O2 and O3. |
| O6 | Product-safety (GPSR) contact details for each manufacturer, and an EU responsible person for any non-EU manufacturer | You | Before the first product is published | The database refuses to activate a product without them. |
| O7 | DPIA scoping and a per-country cookie-consent matrix | You + counsel | Phase 1 (consent), Phase 3 (DPIA) | Includes whether server-side experiment assignment is "strictly necessary". |
| O8 | Accept the data processing agreements for Vercel and Supabase | You | Before production data | Both offer one in their dashboards. See the residency register. |
| O9 | Add `DATABASE_URL` in Vercel (Production and Preview) | You | Phase 1 | Supabase → Connect → Transaction pooler. It is a secret; paste it into Vercel, not into chat. |
| O10 | Accounts for Sentry (EU region), PostHog (EU region) and GrowthBook | You | Phase 1 | Sentry and PostHog must be created in their EU regions; this cannot be changed later. |
