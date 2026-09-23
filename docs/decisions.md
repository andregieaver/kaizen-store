# Decisions

The Phase 0 decision record. Each entry says what was decided, when, and what it
changes. Background for every item is in [`plan.md`](plan.md), which was written
before some of these decisions and assumes an EU company; where they differ,
this file wins.

## Settled

| # | Decision | Date | Consequence |
|---|---|---|---|
| D1 | **A Norwegian company shipping from Norway.** | 2026-09-23 | Norway is the home market. Sales to Sweden and Denmark are exports into the EU, with EU import VAT and customs on every parcel (see below). Replaces the earlier assumption of an EU company. |
| D2 | **Launch in Norway, Sweden and Denmark.** | 2026-09-23 | These three markets are active (NOK, SEK, DKK; nb-NO, sv-SE, da-DK). The other 25 exist but are inactive; Germany was dropped from the launch list and can be switched back on in one line. |
| D3 | **Payments: Stripe.** Checkout Sessions with the Payment Element, Stripe Tax for VAT. | 2026-09-23 | Keeps card data off our servers (PCI DSS SAQ A). Local methods are configured per market in Stripe. `products.tax_code` holds the Stripe Tax code. |
| D4 | **Commerce core built from scratch**, not on an open-source platform. | 2026-09-23 | We own catalogue, pricing, carts, orders, returns and promotions. |
| D5 | **Changes go straight to `main`**, which deploys to production. | 2026-09-23 | Fine while the site is a placeholder. Revisit before launch: switch to pull requests with preview deployments. |
| D6 | **Region: Ireland.** Supabase `eu-west-1`; Vercel functions pinned to `dub1`. | 2026-09-23 | Both in the EU/EEA; functions sit next to the database. |
| D7 | **One Next.js app**, not a monorepo. | 2026-09-23 | Split into packages when a second deployable (such as the MCP server in Phase 4) needs shared domain code. |
| D8 | **Commerce data in a private `commerce` schema**, reached only by server code over a direct connection. | 2026-09-23 | Supabase's Data API never exposes it; row-level security is on with no policies as a backstop. |
| D9 | **Drizzle schema is the source of truth**; migrations are generated into `supabase/migrations` and applied to Supabase by Claude as they land. | 2026-09-23 | CI fails if schema and migrations disagree. |
| D10 | **Data residency: EU/EEA vendors wherever a comparable option exists.** A US processor only with a DPA and the EU–US Data Privacy Framework or standard contractual clauses. | 2026-09-23 | Default set by Claude. Every vendor is listed in [`residency-register.md`](residency-register.md) before it touches production data. |
| D11 | **Build to WCAG 2.2 AA.** | 2026-09-23 | Meets Norway's universal-design rules and the European Accessibility Act for Swedish and Danish customers. |
| D12 | **Kaizen Store is a multi-purpose template**, not tied to one product category. | 2026-09-23 | VAT comes from a Stripe Tax code per product (with a per-variant override); every goods withdrawal exclusion is available; producer responsibility schemes are tracked per product with registrations per market; `commerce.missing_registrations` shows the gaps. Variants carry a customs tariff (HS) code and country of origin for export declarations. |
| D13 | **No extra monitoring or analytics accounts until there is a need.** | 2026-09-23 | Errors: Vercel's built-in logs. Speed: Vercel Speed Insights. Traffic: Vercel Web Analytics (cookieless). Business events: our own tables in Postgres. Experiments: assignment in our own code. Sentry, PostHog and GrowthBook are optional add-ons, not prerequisites. |
| D14 | **No non-essential cookies at launch.** | 2026-09-23 | Cart and session cookies are strictly necessary and need no consent, so the store needs no cookie banner. Adding marketing pixels or cookie-based analytics later brings back the consent requirement. Default set by Claude. |

### Selling from Norway to Sweden and Denmark

Norway is in the EEA but outside the EU's customs and VAT union, so a Norwegian
company shipping from Norway sells to Swedish and Danish customers as an
exporter. In practice:

- **Norwegian VAT (MVA).** Register once sales in Norway pass NOK 50,000 in 12
  months, and charge Norwegian VAT on Norwegian orders.
- **EU VAT on low-value parcels.** For orders worth up to €150, the store can
  register for the EU's Import One-Stop Shop (IOSS) and charge Swedish or
  Danish VAT (25% for standard goods) at checkout. Parcels then clear customs
  without the customer paying anything on delivery. To confirm with an
  accountant: Norway's VAT cooperation agreement with the EU is understood to let
  Norwegian companies register for IOSS without an EU intermediary.
- **Without IOSS**, the carrier collects VAT plus a handling fee from the
  customer on delivery. That is legal but a known reason for refused parcels
  and lost repeat customers.
- **EU customs duty.** Since 1 July 2026 the EU charges a flat €3 duty per item
  category on low-value parcels, which IOSS does not collect. Orders over €150
  pay normal duty and import VAT. The store should show these costs at checkout
  or ship duties-paid.
- **Customs declarations.** Every parcel needs a Norwegian export and an EU
  import declaration, normally filed by the carrier (Posten/Bring, PostNord)
  from the tariff code and country of origin now stored per variant.
- **Later option: stock in the EU.** With a warehouse in Sweden, EU sales
  become domestic and intra-EU: no customs per parcel, but a Swedish VAT
  registration and the EU One-Stop Shop. Worth reconsidering as EU volume grows.
- **Consumer law.** Norwegian customers are covered by angrerettloven and
  forbrukerkjøpsloven (complaints up to five years for goods meant to last).
  Swedish and Danish customers are covered by EU consumer law, including the
  withdrawal button and the 30-day prior-price rule. The store follows the
  stricter rule wherever the two differ.
- **Product safety.** Products sold to Swedish and Danish consumers fall under
  the EU General Product Safety Regulation, which needs an EU-based responsible
  person when the manufacturer is not in the EU. Norway is not in the EU for
  this purpose unless the regulation has been taken into the EEA Agreement
  (unverified).
- **To verify with Stripe:** that Stripe Tax covers Norwegian VAT and IOSS, and
  that Vipps MobilePay is available.

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
| `20260923214059_customs_fields.sql` | `20260923214747` |
| `20260923214100_ship_from_norway.sql` | `20260923214754` |

This does not matter while migrations are applied through Supabase's API. If
the Supabase CLI is adopted later (for example for branching), run
`supabase migration repair` once to align the history.

## Open

### Required before the first sale

These come with selling online in these countries, whatever the platform:
WooCommerce and Shopify need them too.

| # | Item | Owner | Notes |
|---|---|---|---|
| R1 | Norwegian VAT (MVA) registration | You | Once Norwegian sales pass NOK 50,000 in 12 months. |
| R2 | Decide how EU VAT is collected: register for IOSS, or let the carrier collect from customers on delivery | You (+ accountant) | IOSS is the better customer experience. See above. |
| R3 | Terms of sale, withdrawal information and privacy policy in Norwegian, Swedish and Danish | Claude drafts, you review | Built into Phase 1. |
| R4 | Packaging producer responsibility in each market | You | Check whether your volumes trigger registration in Norway, Sweden and Denmark; record numbers in `commerce.producer_registrations`. |
| R5 | Product-safety contact details per manufacturer, and an EU responsible person where needed | You | The database will not activate a product without them. |

### Not needed now

| Item | When it becomes relevant |
|---|---|
| Sentry, PostHog, GrowthBook accounts | Optional. Add one when Vercel's built-in tools stop being enough (D13). |
| Cookie-consent review per country | Only if non-essential cookies or pixels are added (D14). |
| Data protection impact assessment | Before the AI assistant launches (Phase 3). |
| Accountant review of the VAT setup | Recommended before launch, not legally required. |
| Data processing agreements with Vercel and Supabase | Account-level; if your team and organisation already have them, this project is covered. |
