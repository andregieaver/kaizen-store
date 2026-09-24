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
| D12 | **Kaizen Store is a multi-purpose template**, not tied to one product category. | 2026-09-23 | VAT comes from a Stripe Tax code per product (with a per-variant override); every goods withdrawal exclusion is available; producer responsibility schemes are tracked per product with registrations per market; `commerce.missing_registrations` shows the gaps per store. Variants carry a customs tariff (HS) code and country of origin for export declarations. |
| D13 | **No extra monitoring or analytics accounts until there is a need.** | 2026-09-23 | Errors: Vercel's built-in logs. Speed: Vercel Speed Insights. Traffic: Vercel Web Analytics (cookieless). Business events: our own tables in Postgres. Experiments: assignment in our own code. Sentry, PostHog and GrowthBook are optional add-ons, not prerequisites. |
| D14 | **No non-essential cookies at launch.** | 2026-09-23 | Cart and session cookies are strictly necessary and need no consent, so the store needs no cookie banner. Adding marketing pixels or cookie-based analytics later brings back the consent requirement. Default set by Claude. |
| D15 | **Payment settings belong to the store owner, in the store's admin.** API keys and webhook secrets per payment provider, test or live mode, and an on/off switch per payment method (per market) are edited in store settings, not in Vercel environment variables. | 2026-09-24 | Needs an admin area with sign-in (Phase 1c). Secrets are stored encrypted in the database with a key held only in the server environment, never returned to the browser once saved, and every change is logged. The only payment-related environment variable is that encryption key. |
| D16 | **Checkout on Stripe's hosted page, with each store's own Stripe account.** Kaizen places the order and holds the stock, then hands over to Stripe Checkout; a webhook (created automatically in the owner's Stripe account when they save their secret key) confirms payment. | 2026-09-24 | Card data never touches Kaizen (PCI DSS SAQ A). Orders are numbered per store from 1001. Stock is held for 35 minutes (the session's 30 plus a margin). VAT shown on orders uses each country's standard rate until Stripe Tax is connected; reduced rates are not applied yet (see R6). |
| D17 | **Stripe Connect: each store sells through its own connected Stripe account, created by Kaizen.** Replaces the pasted keys of D15 and D16. Configured as Stripe advises for Shopify-like platforms: Accounts v2, full Stripe Dashboard for the store, Stripe collects its fees from the store and carries negative balances, direct charges (the store is the seller), onboarding with Stripe's embedded components in the admin. | 2026-09-24 | Stores no longer paste Stripe keys, and Kaizen stores no store secrets: only Kaizen's own platform keys (`STRIPE_SECRET_KEY_TEST`/`_LIVE`, `STRIPE_PUBLISHABLE_KEY_TEST`/`_LIVE`) in Vercel. Two platform webhooks per mode, created from the platform page: payment events from stores' accounts, and Accounts v2 events that keep each store's status (`stripe_accounts`) current. Kaizen takes a platform-wide fee per sale as an application fee (`platform_settings.sale_fee_bps`, 0 until set); monthly plans come next with Stripe Billing. Payment methods are chosen in each store's Stripe Dashboard (dynamic payment methods), so the per-market switches of D15 are gone. Optional invoice PDF per order (Stripe Invoicing). VAT stays Kaizen's own calculation for now; Stripe Tax per store waits for tax advice on Norway-to-EU sales. Old per-store keys and webhooks stay in the database only so payments started before the switch still complete. |
| D18 | **Kaizen's plans for stores are managed in Kaizen and billed with Stripe Billing.** Platform admins create plans (tiers) with monthly and yearly prices per currency, excluding VAT, and a fee per sale; saving copies them to Stripe as Products and Prices. Admins start, change and cancel each store's plan and can give a store its own fee. | 2026-09-24 | The subscription lives on Kaizen's Stripe account with the store's own connected account as the customer (`customer_account`); Stripe emails an invoice each period, due in 14 days (`send_invoice`), with 25 % Norwegian VAT for stores in Norway and none for others (reverse charge). Store owners see their plan under Plan and open Stripe's customer portal for invoices and card details. A third platform webhook keeps `store_billing` current. The fee on a sale is the store's own fee, else its plan's while it is on the plan, else the platform default. Prices never change in place: a new amount is a new Stripe Price, and stores keep the old one until moved. Taking fees straight from a store's Stripe balance is left for when Stripe offers it outside preview. |
| D19 | **Owners choose their own plan, and can own several stores.** On a store's Plan page the owner picks a plan (monthly or yearly, in the store's currency) and pays by card through Stripe Checkout; later changes apply at once with proration, and they can cancel at the end of the period. An owner can create more stores from All stores, each a copy of the demo with its own Stripe account and plan. | 2026-09-24 | Plans still belong to a store, not a person. Platform admins can still put a store on an invoiced plan (D18). Only people who already own a store, or run the platform, can create stores (up to 10 each), so the beta stays invite-only (P3). `stores` is a reserved store address. |

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

On 24 September 2026 Kaizen became multi-tenant (see [`platform.md`](platform.md)).
The single-store migrations were replaced by a fresh baseline. In production,
the old schema was not dropped: it was renamed to `commerce_legacy` and can be
removed once the platform schema has proved itself. Supabase's migration
history therefore still lists the nine single-store migrations, then:

| File | Recorded as |
|---|---|
| (no file: `ALTER SCHEMA commerce RENAME TO commerce_legacy`) | `20260924000447` retire_single_store_schema |
| `20260923235845_platform_schema.sql` | `20260924000725` |
| `20260923235847_platform_rules.sql` | `20260924060213` |
| `20260924061541_store_setup.sql` | `20260924063848` |
| `20260924061542_clone_store.sql` | `20260924064416` |
| `20260924065317_product_media_thumbnails.sql` | `20260924071204` |
| `20260924065318_product_media_bucket.sql` | `20260924071211` |
| `20260924072534_checkout.sql` | `20260924074159` |
| `20260924072554_checkout_rules.sql` | `20260924074241` |
| `20260924075026_reserve_account_slugs.sql` | `20260924081240` |
| `20260924083238_connect.sql` | `20260924085028` |
| `20260924083240_connect_rules.sql` | `20260924085032` |
| `20260924091504_plans.sql` | `20260924091925` |
| `20260924091505_plans_rules.sql` | `20260924091929` |

The template store was seeded from `supabase/seed.sql`, and the existing owner
account was carried over as platform admin and owner of the template store.

Supabase records each migration with the version it was applied at, not the
timestamp in the file name. This does not matter while migrations are applied
through Supabase's API. If the Supabase CLI is adopted later (for example for
branching), run `supabase migration repair` once to align the history.

## Open

### Required before the first sale

These come with selling online in these countries, whatever the platform:
WooCommerce and Shopify need them too.

| # | Item | Owner | Notes |
|---|---|---|---|
| R1 | Norwegian VAT (MVA) registration | You | Once Norwegian sales pass NOK 50,000 in 12 months. |
| R2 | Decide how EU VAT is collected: register for IOSS, or let the carrier collect from customers on delivery | You (+ accountant) | IOSS is the better customer experience. See above. |
| R3 | Terms of sale, withdrawal information and privacy policy in Norwegian, Swedish and Danish | Claude drafts, you review | Built into Phase 1. |
| R4 | Packaging producer responsibility in each market | You | Check whether your volumes trigger registration in Norway, Sweden and Denmark; record numbers in `commerce.producer_registrations` (per store). |
| R5 | Product-safety contact details per manufacturer, and an EU responsible person where needed | You | The database will not activate a product without them. |
| R6 | Check the standard VAT rates in `commerce.countries` and decide on Stripe Tax for reduced rates (food, books, children's clothing) | You (+ accountant) | Orders show VAT at the standard rate of the shopper's country until then. |
| R7 | Turn on customer receipts in Stripe (Settings → Customer emails → Successful payments) | Each store owner | Kaizen does not send emails yet; Stripe's receipt is the shopper's confirmation. |

### Not needed now

| Item | When it becomes relevant |
|---|---|
| Sentry, PostHog, GrowthBook accounts | Optional. Add one when Vercel's built-in tools stop being enough (D13). |
| Cookie-consent review per country | Only if non-essential cookies or pixels are added (D14). |
| Data protection impact assessment | Before the AI assistant launches (Phase 3). |
| Accountant review of the VAT setup | Recommended before launch, not legally required. |
| Data processing agreements with Vercel and Supabase | Account-level; if your team and organisation already have them, this project is covered. |
