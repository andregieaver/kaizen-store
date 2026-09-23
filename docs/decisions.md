# Decisions

The Phase 0 decision record. Each entry says what was decided, when, and what it
changes. Open items name who has to act. Background for every item is in
[`plan.md`](plan.md).

## Settled

| # | Decision | Date | Consequence |
|---|---|---|---|
| D1 | **Establishment: Scenario A.** An EU company ships from stock in its own member state. | 2026-09-23 | VAT through the Union One-Stop Shop (OSS) once EU distance sales pass €10,000 a year; no import VAT or customs; no IOSS. The member state is still open (O1). |
| D2 | **Launch in Norway, Sweden, Germany and Denmark.** | 2026-09-23 | These four markets are active; the other 24 (all EU) exist but are inactive. Currencies NOK, SEK, EUR, DKK; languages nb-NO, sv-SE, de-DE, da-DK. Norway is outside the EU, which has its own consequences (see below). |
| D3 | **Payments: Stripe.** Checkout Sessions with the Payment Element, Stripe Tax for VAT. | 2026-09-23 | Keeps card data off our servers (PCI DSS SAQ A). Local methods are configured per market in Stripe. `products.tax_code` holds the Stripe Tax code. |
| D4 | **Commerce core built from scratch**, not on an open-source platform. | 2026-09-23 | We own catalogue, pricing, carts, orders, returns and promotions. The plan's Medusa re-evaluation before Phase 5 is dropped unless promotions or returns prove too costly. |
| D5 | **Changes go straight to `main`**, which deploys to production. | 2026-09-23 | Fine while the site is a placeholder. Revisit before launch: switch to pull requests with preview deployments and a Supabase branch per pull request. |
| D6 | **Region: Ireland.** Supabase `eu-west-1`; Vercel functions pinned to `dub1`. | 2026-09-23 | Replaces the plan's Frankfurt assumption. Both are in the EU; functions sit next to the database. |
| D7 | **One Next.js app**, not a monorepo. | 2026-09-23 | Split into packages when a second deployable (such as the MCP server in Phase 4) needs shared domain code. |
| D8 | **Commerce data in a private `commerce` schema**, reached only by server code over a direct connection. | 2026-09-23 | Supabase's Data API never exposes it; row-level security is on with no policies as a backstop. Browser code never queries commerce tables. |
| D9 | **Drizzle schema is the source of truth**; migrations are generated into `supabase/migrations` and applied to Supabase by Claude as they land. | 2026-09-23 | CI fails if schema and migrations disagree. See the note on migration versions below. |
| D10 | **Data residency: EU vendors wherever an EU option exists at similar cost.** A US processor is acceptable only with a DPA and the EU–US Data Privacy Framework or standard contractual clauses, and only when no reasonable EU option exists. | 2026-09-23 | Default set by Claude pending your confirmation. Every vendor is listed in [`residency-register.md`](residency-register.md) before it touches production data. |
| D11 | **Build to WCAG 2.2 AA** whatever the company's size. | 2026-09-23 | Removes the need to decide microenterprise status for the European Accessibility Act. EN 301 549 v4.1.1 (WCAG 2.2) is published but not yet cited in the Official Journal. |
| D12 | **Kaizen Store is a multi-purpose template**, not tied to one product category. | 2026-09-23 | The data model stays category-neutral: VAT comes from a Stripe Tax code per product (with a per-variant override), every goods-relevant withdrawal exclusion is available, and producer responsibility schemes (packaging, electrical equipment, batteries, textiles, furniture, tyres) are tracked per product, with registrations per market. `commerce.missing_registrations` lists what is missing before a product can be sold in a market. |

### Selling to Norway from an EU company

Norway is in the EEA but outside the EU and its customs and VAT union. For an
EU company shipping from EU stock, that means:

- **VAT.** EU VAT and the One-Stop Shop do not cover Norway. Items under NOK
  3,000 go through Norway's VOEC scheme: once sales to Norway pass NOK 50,000 a
  year, the store registers and charges 25% Norwegian VAT at checkout. Items
  from NOK 3,000 up are ordinary imports, with VAT and any duty due at the
  border.
- **Customs.** Every parcel to Norway needs an EU export declaration and a
  Norwegian import declaration, usually handled by the carrier.
- **Law.** Norwegian consumer law applies to Norwegian customers: 14-day
  withdrawal under angrerettloven, and complaint periods under
  forbrukerkjøpsloven of two years, or five for goods meant to last much longer.
  The EU AI Act and the European Accessibility Act are not yet in force in
  Norway, but Norway's own universal-design rules require accessible websites.
- **To verify:** whether Stripe Tax handles VOEC registrations, and whether
  Stripe supports Vipps MobilePay for Norway.

If the company is Norwegian rather than an EU company, this reverses: Norway
becomes the home market and EU sales become exports. See O1.

### Migration versions

Supabase records each migration with the version it was applied at, not the
timestamp in the file name:

| File | Recorded as |
|---|---|
| `20260923125424_commerce_schema.sql` | `20260923130719` |
| `20260923125448_commerce_rules.sql` | `20260923130802` |
| `20260923131004_index_foreign_keys.sql` | `20260923131521` |
| `20260923134115_template_compliance.sql` | `20260923134238` |
| `20260923134127_launch_markets.sql` | `20260923134250` |

This does not matter while migrations are applied through Supabase's API. If
the Supabase CLI is adopted later (for example for branching), run
`supabase migration repair` once to align the history.

## Open

| # | Item | Owner | Needed by | Notes |
|---|---|---|---|---|
| O1 | Which country the company is established in, and where stock ships from | You | Phase 1 | D1 assumes an EU company with EU stock. With Norway as a launch market, confirm this: a Norwegian company would change the VAT and customs design. |
| O2 | ~~Launch countries~~ | Done | | Decided in D2. |
| O3 | ~~Product category~~ | Done | | Replaced by D12: the template handles any category. Each store built from it still has to register for the schemes its products fall under. |
| O4 | Accountant sign-off on the VAT route (OSS for Sweden, Germany and Denmark; VOEC for Norway) and invoicing | You + accountant | Phase 1 | Includes invoice numbering per series (`commerce.document_series`). |
| O5 | Packaging (PPWR) registration in each launch country, plus any other schemes the first products fall under | You | Before the first sale in each market | Record each one in `commerce.producer_registrations`; `commerce.missing_registrations` shows the gaps. |
| O6 | Product-safety (GPSR) contact details for each manufacturer, and an EU responsible person for any non-EU manufacturer | You | Before the first product is published | The database refuses to activate a product without them. |
| O7 | DPIA scoping and a per-country cookie-consent matrix | You + counsel | Phase 1 (consent), Phase 3 (DPIA) | Includes whether server-side experiment assignment is "strictly necessary". |
| O8 | Data processing agreements with Vercel and Supabase | You | Before production data | Account-level, not per project: if the HumanWebX team and organisation already have them, this project is covered. |
| O9 | Add `DATABASE_URL` in Vercel (Production and Preview) | You | Phase 1 | An environment variable, not a connector: Vercel → kaizen-store → Settings → Environment Variables. Value from Supabase → Connect → Transaction pooler. It is a secret; paste it into Vercel, not into chat. |
| O10 | Accounts for Sentry (EU region), PostHog (EU region) and GrowthBook | You | Phase 1 | Sentry and PostHog must be created in their EU regions; this cannot be changed later. |
