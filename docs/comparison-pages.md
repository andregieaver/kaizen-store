# The comparison pages (Shopify, WooCommerce, Wix, BigCommerce, Shopware, Squarespace)

Kaizena Flow's own pages that compare it with another platform, one per platform, in Kaizena Flow's page builder content
(`/admin/platform/pages`). The `/compare` overview links them and is not made here (the owner's own page; left alone).

| Address | Page | Row id |
|---|---|---|
| `/kaizen-vs-shopify` | Kaizena Flow compared with Shopify | `df7280b5-51cf-494b-930d-b280801643aa` |
| `/kaizen-vs-woocommerce` | Kaizena Flow compared with WooCommerce | `d902ff9b-cf57-48cd-a819-ad0f9fb7ada7` |
| `/kaizen-vs-wix` | Kaizena Flow compared with Wix | `9bafa3e1-0003-4783-9ab2-8a158854ca26` |
| `/kaizen-vs-bigcommerce` | Kaizena Flow compared with BigCommerce | `822b5d76-1179-46cc-9442-3c3e28fe128b` |
| `/kaizen-vs-shopware` | Kaizena Flow compared with Shopware | `159255ee-4d2c-420e-9580-1e314f1519c9` |
| `/kaizen-vs-squarespace` | Kaizena Flow compared with Squarespace | `f510997e-1f97-42d1-ae3c-9c60295c0668` |

## Made again, 4 and 5 November 2026

The owner asked to recreate the pages "based on new capabilities of our system, and the new design", leaving `/compare` alone. The pages
of October (written 6 October, published 20 and 29 October) predate the design document and most of what Flow can do now: reviews,
back-in-stock emails, pre-orders, tiered discounts, scheduled reports, MobilePay, bundles, B2B accounts, email campaigns, the autopilot,
the Dream Factory and the one-button moves from Shopify and WooCommerce were missing or unbuilt then.

- **Each page's new version is saved as its draft** over the same row, as the editor's save does for a live page: `draft` and
  `updated_at`/`updated_by` only, a `saved` version in `commerce.page_versions` and a `platform.page_saved` entry in the activity log.
  **The live pages are unchanged until the owner publishes each one.** The address of each page is unchanged, so `/compare`, the front
  page's *Compare us to Shopify and others* and every link to them keep working.
- **The look** is `docs/site-design.md`'s: the hero (6.1), six reasons as cards (6.4), the comparison as a table in a white card (6.10),
  *Where {platform} is the better fit*, moving over (6.3), questions, the main action (6.7), and how we compared with every source.
- **The words about the other platform were read again** on its own pages on 4 and 5 November 2026, one research agent per platform,
  each told to follow the rules below: `docs/comparison-evidence/{platform}.md` (one line per topic with its status, a sentence, the
  address and how it was read, then the platform's strengths and the cautions for the copy). The October readings are in git history.
- **What changed on the other side since October** (the evidence files say each): Shopify has its own VAT invoices for EU and UK orders,
  groups stores into an organisation on any plan and emails a weekly summary; WooCommerce 11.1 has a withdrawal form in core; Wix's help
  centre now describes a do-it-yourself cancellation button and calls the VAT-number check released (through a third-party app); Shopware
  computes the advertised saving from the 30-day price since 6.7.16.0 and puts bundles in Evolve; BigCommerce's B2B Edition now comes with
  Performance; Squarespace reworded its pre-order page.

## Changed after publishing, 5 November 2026 (D458)

Shopify's page was published on 5 November. When Kaizena Flow gained DHL Paket in Germany, UPS and DHL Express across Europe and nShift's
many carriers, *Where Shopify is the better fit* no longer read true as *You ship from a country where Shopify sells labels itself, such as
Germany or France*: Flow books labels from those countries too. What stays Shopify's is that it sells the labels itself, so no carrier
agreement of the merchant's own is needed (T24a in `shopify.md`, the same source). The line is now *You want to buy labels from Shopify
itself, with no carrier agreement of your own, shipping from a country such as Germany or France*, in `data/shopify.json` and, as the
editor's draft save, in that one sentence of the page's draft (its two places: the list and *Where each line comes from*; the rest of the
draft is the published page). The generator checked it (no issues, no claims). **The live page keeps the old line until the owner publishes
the draft.** No other platform's *better fit* names labels or carriers. The Kaizena Flow column's carrier line is unchanged (it rests on
`orders.shipping-label-purchase-and-printing`, Partial until each carrier is verified against its production service).

## How the pages are made

One generator, `docs/comparison-evidence/pages/compare.test.ts`, and one data file per platform, `docs/comparison-evidence/pages/data/{platform}.json`.

- **The Kaizena Flow column** is `LINES` in the generator: one line per topic, each a Full row of `docs/parity/rows` or the built part of a
  Partial one (the row ids are beside the lines). It is the same on every page.
- **The other column** is the data file's `cells`: the words and the one address each rests on. A topic the reading did not settle has no
  cell, so its line is not in that platform's table: Shopify 23 lines, WooCommerce 23, Wix 23, BigCommerce 22, Shopware 22, Squarespace 16.
- Its `strengths`, `faq` additions and the moving section (`shopify`, `woocommerce` or `other`) are per platform too.
- Running `pnpm exec vitest run --config docs/comparison-evidence/pages/vitest.config.mts` builds each page, checks it with `pageInput` and the
  page checker (`pageIssues()`, the platform's theme and text styles) and the claims filter (`findClaims()` over the words), and writes
  `{platform}.page.json` and `{platform}.check.json` to the system's temporary folder (`kaizena-compare`). Each run makes new part ids.
  On 5 November all six had no issues and no claims found.
- Saving a page is the editor's draft save written as one statement (the draft, its `saved` version and the activity entry), guarded by the
  row's `updated_at` so an edit made meanwhile is never overwritten, then the stored draft's MD5 compared with the checked JSON's.

## Rules the copy follows

- **Comparative advertising** (Directive 2006/114/EC, the Norwegian Marketing Control Act): only what was *read* on the other platform's
  own help pages, documentation, pricing page or its official app or extension listings (wordpress.org for WooCommerce plugins), with the
  date in the table's caption and the footnote and every address in *Where each line comes from*. A blog, a review site or a competitor
  counts for nothing.
- **Found nothing is not missing.** A topic nobody could settle is left out of that page, and the footnote says so. *Through an app* (or
  extension, or plugin) says how the platform offers it without claiming it has nothing of its own; *Needs an app, says {platform}* and
  *Not possible …, says {platform}'s help centre* are used only where the platform's own page says it, and the source is named. Several of
  Wix's rest on its feature-request pages, which Wix closes without notice.
- **Fair is fair.** Where the other platform has it built in, its cell says so with a check, and where it is ahead (Shopify's several stores
  on any plan, Wix's own bookings and loyalty, BigCommerce's built-in pre-orders and bulk pricing), the page says that too; every page has *Where {platform} is the
  better fit* from its strengths.
- **No prices** of any kind: no plan prices, app prices, fees or *true cost* sums (they change monthly and none was re-read for this). No
  superlatives or price words: the EU's *lowest price of the last 30 days* is written *the 30-day reference price*, and *cheapest plan*
  became *every plan, Basic included*, so `findClaims()` finds nothing.
- **Kaizena Flow's plans:** the only Flow line that depends on a plan says so (several stores, from Grow: `plan_limits.stores_owned` is 1 on
  Basic). No Flow prices.
- The AI is described by what it does and what always waits for the owner's yes (`NEVER_AUTOMATIC`), never as safe or as advice; the legal
  parts as tools, never as legal advice.

## What the Kaizena Flow column rests on

| Line | Rows (and decisions) | State on 5 November 2026 |
|---|---|---|
| Legal invoices and credit notes | `international.legal-invoices-and-credit-notes-for-orders`, D159 | Built; the row is Partial until a person has reviewed the texts |
| The 30-day reference price on a sale | `customers.omnibus-30-day-lowest-price-reference` | Full |
| Withdrawal button, with exclusions | `international.eu-withdrawal-function-and-self-service-returns`, `international.withdrawal-exclusions-and-digital-waiver`, D153 | Full |
| Product safety details (GPSR) | `international.gpsr-safety-information` | Full |
| VAT by the buyer's country, OSS and IOSS | `checkout.oss-and-ioss-support`, `analytics.tax-and-vat-reports-by-rate-and-jurisdiction`, D157, D161 | Built; Partial until an accountant has read the rules |
| A business buyer's VAT number checked | `checkout.b2b-vat-id-reverse-charge-exemption`, D157 | Built; VIES behaviour needs an accountant's reading |
| Appointments, stays and rentals | `platform.bookings-appointments-rentals`, D65 | Full |
| Subscriptions | `catalogue.selling-plans-and-subscriptions` | Full |
| Bundles | `catalogue.bundles`, D322 | Full |
| Company accounts, price lists and payment terms | `catalogue.b2b-company-accounts`, `catalogue.b2b-catalogs-and-price-lists`, `checkout.b2b-payment-terms` | Full |
| Several stores under one owner | `platform.multi-store-management`, `plan_limits` | Full; from the Grow plan |
| Product reviews | `customers.product-reviews-and-ugc`, D301 | Full |
| Back-in-stock emails | `customers.back-in-stock-notifications` | Full |
| Pre-orders with a release date | `catalogue.pre-orders` | Full |
| Tiered and volume discounts | `customers.tiered-and-volume-discounts` | Full |
| Loyalty programme | `customers.loyalty-and-rewards`, D130 | Full |
| Refer-a-friend | `customers.customer-referral-program` | Full |
| Wishlists | `customers.wishlists` | Full |
| Email campaigns and automations | `customers.email-marketing-broadcasts-and-lifecycle-automations`, D297, D298 | Full |
| Report emails on a schedule | `analytics.scheduled-report-emails`, D345 | Full |
| An AI assistant in the admin | D94, D309, `NEVER_AUTOMATIC` in `src/lib/autopilot-autonomy.ts`; the Dream Factory D409 in the cards | Built |
| MobilePay at checkout | `checkout.mobilepay` | Full |
| Nordic carriers: labels and pickup points | `orders.shipping-label-purchase-and-printing`, `orders.pickup-points-and-lockers-at-checkout`, D134 to D138 | Built; Partial, bucket B: not yet verified against each carrier's production service |

Not claimed, on purpose: **Vipps** (through Mollie, built, but live payments wait for Kaizena Flow's Mollie app: `checkout.vipps`, bucket B),
DAC7 and hosts (only stays and rentals), point of sale (missing), an app store, SMS, and anything about another platform's data location
beyond what its own page states (the pages compare Flow's Dublin servers only in Flow's own words).

## Before each page is published

1. **Read the quoted lines on the live pages in a browser.** The agents read through a fetch tool that summarises pages; the evidence files
   mark what rests on a search excerpt. At least every *says {platform}* cell and every plan name: Wix's feature-request pages (credit
   notes, the 30-day price, volume discounts, MobilePay), BigCommerce's blog post of 1 July 2026 on withdrawal, Shopify's help pages on the
   30-day price, pre-orders and GPSR, Squarespace's VAT-exemption and pre-order pages.
2. **Shopware's bundles** were read on a docs page that search results title *Insider Previews*: check it is released before publishing
   *On the Evolve edition*.
3. Open the draft in the builder (`/admin/platform/pages`), look at it on a phone and in dark mode, and publish (publishing runs the page
   checker and refreshes the site's pages).
4. A person reads the legal-sensitive lines (withdrawal, VAT, invoices), which describe other platforms' compliance features.
5. If a page waits more than a few weeks, read its platform again: the pages say what was true on 4 and 5 November 2026.
