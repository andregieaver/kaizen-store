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
| D20 | **Test payments need nothing from the store owner.** Kaizen sets up each store's test Stripe account itself, filled with Stripe's test values (date of birth 1901-01-01, address `address_full_match`, website `https://accessible.stripe.com`, test IBAN `NO9386011117947`) and Kaizen's acceptance of the service agreement, so test purchases land in the store's own test account straight away. Stripe's real identity checks happen only for the live account, before real money. New stores start with test payments on. | 2026-09-24 | Test accounts differ from live ones: no Stripe Dashboard, and Kaizen holds the fee and loss settings (Stripe allows this in test only because nothing real is at stake); live accounts stay as in D17. The account is created in the background when an owner opens the admin or Payments (the service agreement needs the owner's IP address); Stripe checks the test values within a minute or two, and a checkout in that window asks Stripe again rather than failing on an old status. Kaizen marks the accounts it made (`managed_by_kaizen`) and keeps Stripe's latest reasons (`requirements`, no personal data) so a stuck account can be explained. An older test account that waited for the owner's details is replaced; plans keep billing the account their subscription was started on. The storefront says when it is in test mode. |
| D21 | **Search and sharing are built in, for Kaizen and every store.** Every page has its title, description, canonical and hreflang links, Open Graph and X tags, and schema.org data: the store as an `OnlineStore` with its return policy, each market home as a `WebSite` and product list, each product as a `Product` (or a `ProductGroup` when variants differ by colour, size, material or pattern) with price, stock, shipping to the market, return policy and breadcrumbs. The site serves `robots.txt`, a sitemap index with one sitemap per open store (hreflang and pictures included), and `llms.txt` for Kaizen and for each store (terms, markets, shipping and every product with its price). Owners set their front page's title and description per language, a share picture, social profiles, AI crawler choices, extra crawler rules, their own llms.txt text and search console codes under Search; products get their own search title and description per language. Kaizen's own pages are set under Platform → Search. | 2026-09-24 | Everything is filled in from the store's data when the owner writes nothing; a page without a picture shares one Kaizen draws. Until stores have their own addresses (P2), crawlers read only the site's robots.txt, so each store's rules are added to it under the store's path, and the rules for everyone are repeated in each crawler's group (a crawler follows only its own group). AI assistants and AI search are welcome by default and can be turned off separately from AI training. Carts, order pages and the admin are left out; stores not yet opened, or hidden by their owner, are `noindex` and left out of sitemaps and llms.txt. The 14-day return policy states the legal right of withdrawal, with return costs on the shopper (the legal default) until stores can set their own terms (Phase 1d). A blog or other content types will use the same fields when they are built. |
| D22 | **Shoppers pay on Kaizen's own checkout page, with Stripe's payment form.** The cart's checkout button places the order as before and opens a Stripe Checkout Session with `ui_mode: "elements"` on the store's own Stripe account; the shopper then pays at `/{market}/checkout` on the store's site: Kaizen's order summary, then Stripe's express buttons (Apple Pay, Google Pay, Link, Klarna where offered), contact, delivery address and payment Elements, in the store's colours and the market's language. Paying leads to the order page as before. Stripe's hosted page stays as a platform-wide fallback (Platform → Stripe). | 2026-09-24 | Stripe's recommended way to build a custom checkout: the session still carries prices, shipping, Kaizen's fee, the invoice and the payment methods each store has turned on, and orders are still confirmed by Stripe's events, so nothing else changes. Card details go from the browser straight to Stripe. The session's client secret is kept with the payment so the page need not ask Stripe on every load; only the cart's own browser is shown it. Stripe needs each store's account to have the site's domain registered for Apple Pay, Google Pay, Link and Klarna; Kaizen does this at the first checkout on each domain and records it (`payment_domains`), and a failure only hides those methods. If the cart changes after the order was placed, or the 30 minutes run out, the page asks the shopper to continue again, which replaces the order. |
| D23 | **Every store's Stripe account asks for cards, Klarna, Link and MobilePay.** Kaizen requests these payment capabilities when it creates a store's account (test and live), and for older accounts in the background when the store's admin is opened or a checkout starts; it records what it asked for (`payment_methods_requested`). On the test accounts Kaizen makes, it also switches these on (with Apple Pay and Google Pay) in the account's display settings, which otherwise follow the platform's defaults for connected accounts (`payment_methods_shown`); owners of live accounts choose in their own Stripe Dashboard. Test accounts also carry Stripe's test Norwegian org number, which MobilePay asks for. Each order records the methods Stripe offered (`payment.started`), and each account keeps why a method is not on yet (`requirements`). | 2026-09-24 | Stripe then offers each method where it fits the shopper's country and currency (MobilePay in Denmark and Finland), and the store's own Stripe settings still decide. Swish and Vipps are in private preview at Stripe: Kaizen's platform account must be given access first, and Vipps is not yet available for Accounts v2; they are added to the list once possible. PayPal is not offered: Stripe does not allow it for platforms whose stores take direct charges on their own accounts. |
| D24 | **Every variant is either shipped or downloaded; a product sets the default.** As in Shopify (a per-variant "physical product" flag) and WooCommerce (Virtual and Downloadable), delivery is chosen per variant, so one product can sell a hardcover and an e-book; the editor asks once per product and offers per-variant choice behind a checkbox. Downloads have no stock, weight or customs details, need no shipping and no manufacturer (EU product-safety rules cover physical goods), and must have at least one file before they go on sale. Files are uploaded from the owner's browser straight to a private storage bucket (`digital-files`, one folder per store) and belong to every digital variant of the product or to one of them. When an order is paid, each digital line gets one personal link per file (`order_downloads`), limited by the product's downloads per file (5 by default) and days (30 by default), either of which can be off. The link counts a download in one statement and sends the shopper to a signed storage address that works for 60 seconds. Buying a download needs the shopper's tick at checkout: express consent to delivery straight away and acknowledgement that the right of withdrawal then ends (CRD art. 16(m); angrerettloven § 22 n). The time is kept on the order (`digital_consent_at`) and in its history; digital lines record the `digital_content` withdrawal exclusion and shipped lines never do. | 2026-09-24 | A basket of downloads only has no shipping, and the checkout form asks for no address. Download links show on the order page, which only the shopper has (it needs the Stripe session in its address); there is no order email yet, so it is the only place until emails exist. Files removed from a product stop new sales but keep working for earlier buyers. New stores copy the template's catalogue with each product's delivery, but not its files, so a download in the template arrives as a draft. Subscriptions (the next slice) will be purchase options on a product, as in Shopify's selling plans and WooCommerce's subscription options. |
| D25 | **Subscriptions are purchase options on a product, charged by Stripe Billing on the store's own account.** As Shopify's selling plans and WooCommerce's subscription options: a product gets up to five purchase options (every 1–52 weeks, 1–12 months or 1–3 years, with a subscriber's discount in whole percent), and can be sold only by subscription. Shoppers choose on the product page between buying once and an option; the prices follow. One checkout starts at most one subscription, so a cart holds one schedule (items bought once can join it). The checkout then runs in Stripe's subscription mode, with Kaizen's fee as `application_fee_percent`; the shopper ticks that they agree to the renewal amount and schedule, and that they can cancel any time. Kaizen keeps the subscription and what each renewal holds (`subscriptions`, `subscription_lines`), at the prices agreed at the start. Each paid renewal (`invoice.paid`, `subscription_cycle`) becomes a paid order: stock is drawn and downloads made as for any order, once per invoice. Stripe's subscription events keep the status, next renewal and cancellation in step. Shoppers cancel from a link on their order page, without an account (as easy as subscribing), effective at the end of the paid period, and can take it back; staff can also cancel at once. | 2026-09-24 | Stripe takes no shipping options in subscription mode, so shipping is a line: a subscription with something to ship pays shipping on every delivery, worked out on what each delivery holds (free above the store's threshold), and items bought once travel with the first delivery. Without such a subscription the usual rule applies. Options taken off a product are switched off, not deleted, so carts, orders and subscriptions keep pointing at them. Kaizen's existing webhook for stores' accounts is updated with the subscription events at the first subscription checkout, without replacing it. Stripe sends its own invoice for every charge. Not yet: trials, sign-up fees, pausing, skipping or swapping a delivery, changing quantities, a minimum number of renewals, renewal reminders by email (no emails yet), and Stripe's customer portal. |
| D26 | **Kaizen sends shoppers' emails through Amazon SES in the EU, in the store's name.** Chosen as the plan's EU-hosted option (D10): the sender is Kaizen's verified address with the store's name, and replies go to the store's contact address. Every email is written to `email_messages` before it is sent (who, why, subject, the email itself, and whether it was sent), so staff can read exactly what a shopper got: stores under Orders → Emails to customers, and each order's history; Kaizen under Platform → Emails. Emails are plain HTML with a text version, in the order's language, with the store's legal details at the foot. A key per event (such as `order-confirmation:{order}`) makes each email go once, however often a webhook arrives. | 2026-09-24 | Until `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `EMAIL_FROM` are set in Vercel, emails are only recorded (`logged`), and nothing else waits on them. The SES account needs the sending domain verified (DKIM) and production access (out of the sandbox). The first emails: the order confirmation, for new orders and each subscription renewal, with the download and subscription links. Sign-in codes, shipping, refunds and subscription reminders follow. Stripe's own receipts can stay on as well (R7). |
| D27 | **Staff manage the whole order from its page.** Mark it sent with carrier and tracking number (Posten, Bring, PostNord, DHL, UPS build their tracking link; others take a pasted one), with an email to the customer; more parcels can follow (`shipments`). Refund any amount up to what is left, through Stripe on the store's own account, with Kaizen's fee on the refunded part returned to the store (`refund_application_fee`); choose which items go back in stock, with or without money back; the customer is emailed. Cancel a paid order before it is sent: everything left is refunded, all items go back in stock and download links stop. Correct the customer's email and delivery address, keep notes only staff see, print a packing slip in the customer's language, and send the confirmation again. The history shows every event and every email the customer got. | 2026-09-24 | Refunds of subscription orders refund that payment only; the subscription goes on until cancelled on its page. Orders cancelled after payment stay in the order list, marked "Cancelled and refunded"; a "To send" filter lists paid orders with something to ship. Refunds made directly in Stripe's Dashboard are not yet read back into Kaizen. Items go back to the store's first stock location. |

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
| `20260924102825_reserve_stores_slug.sql` | `20260924103331` |
| `20260924112911_test_payments_on.sql` | `20260924114012` |
| `20260924114622_stripe_account_details.sql` | `20260924115422` |
| `20260924120045_seo.sql` | `20260924122250` |
| `20260924130711_custom_checkout.sql` | `20260924131522` |
| `20260924134429_payment_methods.sql` | `20260924135246` |
| `20260924135903_payment_methods_shown.sql` | `20260924140745` |
| `20260924163005_digital_products.sql` | `20260924165727` |
| `20260924163034_digital_products_rules.sql` | `20260924170147` |
| `20260924171038_subscriptions.sql` | `20260924173027` |
| `20260924171040_subscriptions_rules.sql` | `20260924173148` |
| `20260924175024_emails.sql` | `20260924175231` |
| `20260924175025_emails_rules.sql` | `20260924175235` |
| `20260924175930_order_management.sql` | `20260924181207` |
| `20260924175931_order_management_rules.sql` | `20260924182019` |

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
| R7 | Turn on customer receipts in Stripe (Settings → Customer emails → Successful payments) | Each store owner | Optional since D26: Kaizen sends its own order confirmation once SES is set up; Stripe's receipt is a second copy. |

### Not needed now

| Item | When it becomes relevant |
|---|---|
| Sentry, PostHog, GrowthBook accounts | Optional. Add one when Vercel's built-in tools stop being enough (D13). |
| Cookie-consent review per country | Only if non-essential cookies or pixels are added (D14). |
| Data protection impact assessment | Before the AI assistant launches (Phase 3). |
| Accountant review of the VAT setup | Recommended before launch, not legally required. |
| Data processing agreements with Vercel and Supabase | Account-level; if your team and organisation already have them, this project is covered. |
