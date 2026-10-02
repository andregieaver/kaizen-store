# Kaizen Store against Shopify: feature parity

Research date: October 2026 (written 2026-10-02). Shopify rows were researched from Shopify's documentation; Kaizen rows were rated against the code and decisions in this repository, and 15 rows were rechecked by a skeptic who changed the rating.

## 1. The answer

Kaizen Store has about **60% parity (59.5%)** with what Shopify ships natively on its Basic, Grow and Advanced plans, across 232 core features weighted by importance to an EU small or mid-size merchant, and **69.1% on the must-haves** (the 92 features with weight 4 or 5). The method is simple: a full match scores 1, a partial match 0.5, a missing feature 0, each multiplied by a weight from 1 to 5; the weights are my judgement, not data, and a different owner would set some differently (the unweighted figures are 56.0% overall and 67.9% for must-haves, so the picture does not hinge on them). The number measures how much of Shopify's native feature set Kaizen has caught up with. It does not measure where Kaizen is better (bookings, EU compliance, AI and analytics honesty, section 4), and it excludes anything Shopify only offers on Plus or through the App Store. That exclusion flatters Kaizen: Shopify's App Store (commonly cited at 13,000+ apps; one 2026 tracker in the data puts public apps at 18k to 25k) fills most remaining gaps for a Shopify merchant, while Kaizen has no app model at all, so the percentage understates the real gap in extensibility. Counting app-only features raises the denominator and gives 58.7%; counting Plus-only as well gives 58.5%. Kaizen is strongest on storefront and content (82.3%) and weakest on customers and marketing (50.0%), platform and extensibility (50.7%), and orders, shipping and returns (52.0%). Of the 232 core features, 80 are full, 100 partial and 52 missing, so half-built features, not absent ones, are the main shape of the gap.

| Measure | Features | Weighted parity | Unweighted parity | Full / partial / missing |
|---|---|---|---|---|
| Headline: core (Shopify native, Basic to Advanced) | 232 | **59.5%** | 56.0% | 80 / 100 / 52 |
| Must-have (core, weight 4 or 5) | 92 | **69.1%** | 67.9% | 46 / 33 / 13 |
| Core plus app-only features | 259 | 58.7% | 55.6% | 90 / 108 / 61 |
| Everything, including Plus-only | 266 | 58.5% | 55.3% | 91 / 112 / 63 |

## 2. Parity by domain

Counts are core features only. Weighted parity uses weights 1 to 5; must-have is weight 4 or 5.

| Domain | Core features | Full | Partial | Missing | Weighted parity | Must-have features | Must-have parity |
|---|---|---|---|---|---|---|---|
| Catalogue and products | 30 | 11 | 11 | 8 | 57.7% | 8 | 69.1% |
| Storefront, themes and content | 33 | 21 | 10 | 2 | 82.3% | 15 | 90.9% |
| Checkout and payments | 23 | 8 | 7 | 8 | 55.4% | 12 | 68.3% |
| Orders, shipping, fulfilment and returns | 29 | 7 | 13 | 9 | 52.0% | 14 | 65.6% |
| Customers, marketing and loyalty | 22 | 3 | 15 | 4 | 50.0% | 9 | 56.6% |
| Analytics, reporting and finance | 26 | 11 | 8 | 7 | 62.8% | 11 | 72.8% |
| International, compliance and trust | 21 | 6 | 11 | 4 | 56.4% | 13 | 59.6% |
| Platform, extensibility and operations | 23 | 4 | 14 | 5 | 50.7% | 7 | 58.6% |
| AI and automation | 25 | 9 | 11 | 5 | 59.8% | 3 | 66.7% |
| **Total** | **232** | **80** | **100** | **52** | **59.5%** | **92** | **69.1%** |

## 3. Biggest gaps

The 15 largest gaps among core features rated missing or partial with weight 4 or 5. Ordered by weight, then by my judgement of how often a merchant hits the gap in daily use. Where the same feature appears in several domains, the rows are combined into one entry (this also shows how the domain scores double count, see caveats). Weight 5 first.

| # | Gap | Rating and weight | What is lacking |
|---|---|---|---|
| 1 | EU withdrawal button and self-serve returns | Orders: missing, w5. International: partial, w5 (rechecked) | No shopper-side withdraw or return form, no acknowledgement email on a durable medium, no staff queue, no return deadline tracking. Shoppers must contact the store another way and staff refund by hand. The directive applies from 19 June 2026 and `docs/plan.md` calls it a launch blocker. |
| 2 | EU VAT depth and VAT reporting | Checkout: partial, w5. International: partial, w5. Analytics tax report: partial, w5 | Only standard, accommodation and exempt categories, so no reduced rates for food, books or children's items; rates live in migrations, not the admin; no VAT-by-country or OSS return report, no export. Related and missing: IOSS (w4 and w3), EU VAT ID check and reverse charge (w3). |
| 3 | Inventory management | Catalogue: partial, w5 | Stock is one number typed in the product editor. No inventory page, no adjustment history with reasons, no bulk stock update, no low-stock emails. Backorders (w3) are also missing. |
| 4 | Discount code depth | Customers: partial, w5 (the Checkout domain rates the same feature full, w4) | Scope is products only (no category or tag), no customer or segment eligibility, no minimum quantity, one code per order, no bulk code generation, no tiered codes. |
| 5 | CSV import and export of products, orders and customers | Catalogue: missing, w4. Orders: missing, w4. Customers: partial, w4. Analytics: missing, w4. Platform: missing, w4 | No product import or export, no order CSV, no customer CSV, no analytics table export. Blocks migration onto Kaizen and accountants getting a period's orders out. Bulk editing (w3) is also missing. |
| 6 | PayPal | Checkout: missing, w4 | Not offered; Stripe does not allow it for platforms taking direct charges (D23). `docs/plan.md` notes PayPal is a large share of German top-shop revenue. |
| 7 | Legal page templates and policy generator | International: missing, w4 | No starter privacy, terms, returns or shipping pages in any language, no terms-acceptance link at checkout. Owners write legal pages from scratch in the builder. |
| 8 | EU local payment methods (iDEAL, Bancontact, SEPA, BLIK, EPS, P24) | Checkout: partial, w4 (rechecked) | Reachable only if the owner enables them in their own Stripe Dashboard; Kaizen requests no capabilities for them, has no admin switch, per-market control or tests, and subscriptions and boxes are card-only. Klarna and Apple/Google Pay are partial for similar reasons (w4 each). Vipps and Swish are blocked on Stripe. |
| 9 | Email marketing: subscriber list, broadcasts, segments, lifecycle flows | Customers: partial, w4 (rechecked); signup forms partial, w4; segments partial, w3 | Only abandoned-cart reminders are real automation. Newsletter sign-ups are emailed to the owner and not kept (a deliberate choice, D93). No marketing-consent flag, no composer, no send to a segment. RFM groups are read-only analytics. |
| 10 | Google Merchant Center and channel product feeds | Catalogue: partial, w3 (rechecked). Customers: missing, w4. AI: missing, w4 | No feed route, no sync, no channel admin. JSON-LD and GTIN data exist, so a feed is a serializer, not a data-model job. Also blocks Meta, TikTok and AI shopping surfaces (w3). |
| 11 | Returns management in admin | Orders: partial, w4 (rechecked) | Refund-and-restock works and is tested, but there is no return object, status, reason, received condition, return fee or label. The `returns` tables in the schema are unused scaffolding. |
| 12 | Redirect manager | Storefront: partial, w4. Catalogue SEO: partial, w4. Customers: partial, w3 | Only pages get automatic redirects. A changed product or category address leaves a dead URL; no manual or bulk redirects, which a migration needs. |
| 13 | Order list search, filters and bulk actions | Orders: partial, w4 | Three tabs and the newest 200 orders; no text, date or status search, no saved views, no bulk fulfil or print, no tags or archive (w3). Draft orders (w3) are also missing. |
| 14 | Shipping rate tables, zones and profiles | Orders: partial, w4 (rechecked) | One flat rate per country plus a free-above threshold. No weight or basket-value tiers, no regions inside a country, no per-product profiles; weight only feeds carrier quotes. |
| 15 | Unit price (price per kg or litre) | International: missing, w4 | No field, display or structured data for goods sold by weight or volume, which the Price Indication Directive and Norwegian rules require. |

Next in line (also weight 4, not in the top 15): staff two-step authentication (missing), payouts and reconciliation (missing), shop-order invoices and credit notes (partial, Stripe's numbering), GDPR export and staff-triggered erasure (partial), fulfilment workflow with partial shipments (partial), shipping labels beyond Norway (partial), a variant limit of 100 against Shopify's 2,048 (partial), per-market fixed price rules (partial), accessibility audit evidence (partial), staff roles beyond owner and admin (partial), and the lack of a status page, support channel and self-serve sign-up (partial). Product reviews (w4) are missing too but are app-only on Shopify, so they sit outside the core score; merchants hit them constantly.

## 4. Where Kaizen is ahead

Merged from the nine domains' "Kaizen only" lists (about 80 entries, many repeated: Omnibus, bookings, A/B tests and AI translation each appeared three or four times). Each is checked against the rated rows. "Row-backed" means a rated row confirms Kaizen has it and says how Shopify stands. "Doc-only" means the claim rests on code and decision references with no rated Shopify counterpart, so I could not verify the Shopify side from the dataset.

| Area | What Kaizen has | Check against the rows |
|---|---|---|
| EU product compliance | GPSR safety fields, responsible person, withdrawal exclusions per product and per order line, digital-content waiver at checkout, producer-responsibility tags (D12, D24) | Row-backed: GPSR and withdrawal exclusions are full and app-only on Shopify. Producer-responsibility is only partial (no registration screen, nothing blocks selling). |
| Omnibus 30-day reference price | Prices change only through `commerce.set_price`; `<Price>` shows a reference only for a genuine reduction | Row-backed: full; app-only on Shopify. |
| Bookings, appointments, stays, rentals | Calendars, seasons, deposits, no-show fees, iCal in and out (D65 to D70) | Row-backed: full; app-only on Shopify. |
| Loyalty credits, customer referral, wishlists | Append-only bonus ledger, refer-a-friend with fraud guards, multi-list wishlists (D130, D131, D34) | Row-backed: all full; all app-only on Shopify. Affiliate and creator commissions are only partial. |
| Hybrid and AI search, recommendations with measurement | Keyword plus vector search, query understanding, held-out ranking comparison, offline replay (D72 to D77, D139) | Row-backed that Kaizen has them (full). Qualified: Shopify has native semantic search on its Shopify and Advanced plans and native recommendations, so the lead is query understanding, the built-in test and the no-AI fallback, not semantic search itself. Search merchandising (synonyms, boosts) is missing. |
| A/B testing of pages, parts, header, footer, checkout, with guardrails | D148 phases 1 to 11 | Row-backed (full), qualified: Shopify has native but limited Rollouts experiments (Grow and above, theme-wide, no custom goals). The claim "Shopify has no native A/B testing" in the source lists is contradicted by the Storefront row; the lead is depth, not existence. |
| Builder-made working pages | Cart, checkout, order, account and product layouts editable in the page builder (D79, D113, D117) | Row-backed: templates per page type full; the Plus-only extensibility row is partial. Shopify's non-Plus checkout is mostly closed. |
| Custom fields | Conditional logic, repeaters, flexible content, money and measurement types, listing filters, binding to blocks (D118 to D120) | Row-backed that Kaizen matches metafields (full). The extras are doc-only; Shopify's metafield filtering limits were not rated. |
| Multi-store control center | Up to 10 stores per owner, cross-store overview, store duplication (D107, D129) | Row-backed: full; Plus-only on Shopify. |
| Whole-store AI translation with review | Human-ticked suggestions, legal texts unticked, no language cap (D110, D111) | Row-backed: full; the International row notes Shopify's auto-translate covers 2 languages. |
| Analytics beyond COGS | Cookieless visit counting, profit past gross margin with coverage stated, plain-words diagnosis, analytics via the AI manager (D152) | Row-backed: profit, funnel and diagnosis are full (diagnosis is app-only on Shopify). Visit counting is off by default. D152 is uncommitted work. |
| AI governance | Per-feature usage and cost, own AI provider and key, claims filter on AI copy, approval-gated assistant actions, editable memory (D73, D94, D103, D106, D145) | Row-backed for usage, cost and switches (full). Own provider and claims filter are doc-only. The assistant itself is only partial against Sidekick (no product, page or menu editing tools), so the lead is control, not capability. |
| Cookie scan and consent log | Chromium scan builds the cookie list and banner from what the site sets (D58) | Row-backed that consent is full on both sides; the scan itself is doc-only. |
| AI crawler controls | `llms.txt`, per-bot switches for AI assistants and AI training bots (D21) | Row-backed (full) but qualified: one third-party report in the AI row says Shopify also serves `llms.txt`; the per-bot toggles are the clear difference. |
| Nordic carrier depth | Bring, PostNord, Porterbuddy, Helthjem: checkout services, pickup points, delivery windows, booking and labels (D133 to D138) | Qualified: the rows rate carrier rates, labels and pickup points only partial (Norway-centred, PostNord has no booking, nothing verified against real carrier servers). Ahead of Shopify for Nordic carriers, behind on carrier breadth. |
| Gap-free order numbers enforced in SQL | Database refuses renumbering or deletion (D141) | Doc-only. The research notes it did not verify whether Shopify guarantees gap-free numbering. |
| Hosting residency | EU-pinned hosting and a published vendor register | Partial: the row says DPAs are not yet recorded as accepted and some AI processing may leave the EU. |
| Page replicator, global parts, template marketplace, motion presets, deposits and no-show fees, subscription-box delivery rounds, hosts with DAC7, Work invoicing | D150, D98, D125, D128, D66, D102, D71, D122 | Doc-only. Caveats: Shopify's free Subscriptions app is native (so only the weekly round and charge-on-dispatch model differs); hosts cover stays and rentals only; the Work module serves service businesses, not shops. |

Not ahead despite appearing in the lists: multilingual order emails (language coverage is ahead, but owners cannot edit any email wording, a missing core row), and the grounded chat agent (strong on catalogue answers, partial against Shopify Inbox for lacking order lookup and human handoff).

## 5. Detail by domain

Legend. **Shopify**: Native = included on Basic to Advanced and scored in the headline; App = only through the App Store (not in the headline); Plus = Plus-only (not in the headline); the link is Shopify's page or the source used, and "knowledge" means the Shopify side was not fetched. **Kaizen**: Full, Partial or Missing as rated; "R" marks a row rechecked by the skeptic, with the original rating. **W** is the importance weight, 1 to 5. D-numbers are decisions in `docs/decisions.md`.

### 5.1 Catalogue and products

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Products with variants and options (limits) | Native, 3 options and 2,048 variants. [source](https://changelog.shopify.com/posts/we-ve-increased-the-product-variant-limit-to-2048) | Partial | 4 | Same 3 options but 100 variants, so large matrices do not fit. `src/lib/product-input.ts` (MAX_VARIANTS). |
| Product data fields (SKU, barcode, weight, cost, HS code, origin) | Native. knowledge | Full | 3 | `product_variants`: sku, gtin, weight_grams, cost_minor, hs_code, origin_country. |
| Collections, manual | Native. [source](https://help.shopify.com/en/manual/products/collections) | Full | 5 | Nested categories and tags, `commerce.terms` (D50); category and tag pages are page roles (D140). |
| Smart (rule-based) collections | Native. [source](https://help.shopify.com/en/manual/products/collections) | Missing | 3 | No rules fill a category or tag; terms are set by hand; shopper filters (D78) are not saved collections. |
| Bundles | Native, free Bundles app. [source](https://help.shopify.com/en/manual/products/bundles/shopify-bundles) | Partial | 3 | Only "buy N pay for M" campaigns (D114); no bundle product with components or stock sync. |
| Digital products and downloads | Native. [source](https://help.shopify.com/en/manual/products/digital-service-product/selling-services-or-digital-products) | Full | 3 | D24: delivery per variant, download limit and expiry, private bucket. |
| Gift cards | Native. [source](https://www.shopify.com/blog/gift-cards-all-plans) | Missing | 3 | No purchasable card, code, balance or redemption. Bonus credits (D130) are earned, not sold. |
| Sell when out of stock | Native. [source](https://help.shopify.com/en/manual/products/inventory/setup/continue-selling) | Missing | 3 | Cart caps quantity to live stock (`src/server/cart.ts`); no allow-oversell flag. |
| Pre-orders | App. [source](https://shopify.dev/docs/storefronts/themes/pricing-payments/preorder-tbyb) | Missing | 2 | No pre-order mode or back-in-stock list. |
| Product media: video and 3D | Native. [source](https://help.shopify.com/en/manual/products/product-media) | Partial | 2 | Pictures only, 12 max (MAX_MEDIA); video through a custom field or builder block; no 3D. |
| Metafields | Native. [source](https://help.shopify.com/en/manual/custom-data/metaobjects) | Full | 3 | D118 to D120, `docs/custom-fields.md`: 20+ types on products, variants, terms, pages, store, customers, orders. |
| Metaobjects | Native. [source](https://help.shopify.com/en/manual/custom-data/metaobjects) | Partial | 2 | Repeaters and relation fields exist; no standalone entries with their own list and pages. |
| Product reviews and ratings | App (Shopify's app discontinued 2024). [source](https://community.shopify.com/t/shopify-product-reviews-app-discontinued/262560) | Missing | 4 | None; only a Google Places widget (D91). Verified-purchase reviews are a Phase 1 item in `docs/plan.md`, unbuilt. |
| SEO fields: title, description, handle, sitemap, hreflang | Native. [source](https://help.shopify.com/en/manual/promoting-marketing/seo/url-redirect) | Partial | 4 | Per-locale SEO, hreflang sitemap, JSON-LD exist. A changed handle leaves the old address dead; no redirect manager (`page_redirects` is pages only). |
| Bulk product import and export (CSV) | Native. [source](https://help.shopify.com/en/manual/products/import-export/using-csv) | Missing | 4 | No product import or export route; products are made one at a time. |
| Bulk editing | Native. knowledge | Missing | 3 | No multi-select or grid editor; `setArchived()` is per product. |
| Inventory tracking with reservations | Native. [source](https://help.shopify.com/en/manual/products/inventory/setup/continue-selling) | Partial | 5 | Per-variant stock, row-locked reservations, restock on refund (D27), `/analytics/inventory`. No inventory page, adjustment history or low-stock alerts. |
| Multi-location inventory | Native. [source](https://help.shopify.com/en/manual/fulfillment/setup/locations/setup) | Partial | 2 | Schema and checkout allocate across locations; the editor writes one number to the first location. |
| Inventory transfers and purchase orders | Native. [source](https://help.shopify.com/en/manual/products/inventory/purchase-orders/creating-inventory-transfers) | Missing | 2 | None. |
| Selling plans and subscriptions | Native. [source](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/selling-plans) | Full | 3 | D25, D29 (Stripe Billing, trials, sign-up fees), D102 boxes. |
| Per-market pricing and currencies | Native. [source](https://help.shopify.com/en/manual/markets/pricing) | Full | 4 | `commerce.set_price`, D109, Omnibus reference. |
| B2B company accounts | Native. [source](https://changelog.shopify.com/posts/key-b2b-features-now-available-on-non-plus-plans) | Partial | 3 | D108, D63: companies, invites, group discount. No locations, buyer approvals, payment terms or PO checkout. |
| B2B catalogs and price lists | Native. [source](https://changelog.shopify.com/posts/key-b2b-features-now-available-on-non-plus-plans) | Partial | 3 | One fixed percentage per group; no price lists, per-group visibility or wholesale prices. |
| Volume pricing and quantity rules | Native. [source](https://changelog.shopify.com/posts/key-b2b-features-now-available-on-non-plus-plans) | Missing | 2 | No quantity breaks, minimums or increments. |
| Product recommendations | Native. [source](https://apps.shopify.com/search-and-discovery) | Full | 3 | D139, D140, `docs/recommendations.md`. |
| Storefront filtering and sorting | Native. [source](https://apps.shopify.com/search-and-discovery) | Full | 4 | D78: facets, custom-field filters, price as shown. |
| Search quality: type-ahead, typos, stemming | Native. [source](https://apps.shopify.com/search-and-discovery) | Full | 4 | D72, D74, D75: tsvector, trigram, vector fusion. |
| Search merchandising: synonyms, boosts, pins | Native. [source](https://apps.shopify.com/search-and-discovery) | Missing | 2 | `/admin/{store}/search` shows counts and zero-result queries only. |
| Search analytics | Native. [source](https://apps.shopify.com/search-and-discovery) | Full | 2 | `search_queries`, `search_clicks` (D72, D77). |
| Product feeds to Google and other channels | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/google/getting-setup/connect) | Partial (R, was missing) | 3 | No feed route, no channel admin, no sync. The recheck's own text says "partial leaning missing": credit is for GTIN data and JSON-LD only. Planned in `docs/plan.md` Phase 4. |
| Standard product taxonomy | Native. [source](https://help.shopify.com/en/manual/products/details/product-category) | Partial | 2 | Own categories and a Stripe tax code; no standard category list for channel mapping. |
| AI product descriptions | Native. [source](https://help.shopify.com/en/manual/products/details/product-descriptions/shopify-magic) | Full | 2 | D76 `AiWriter`, suggestion only, claims-filtered. |
| Combined listings | Plus. [source](https://help.shopify.com/en/manual/products/combined-listings-app) | Missing | 1 | None. |

### 5.2 Storefront, themes and content

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Theme store (free and paid themes) | Native. [source](https://help.shopify.com/en/manual/online-store/themes), secondary source for the Horizon claim | Partial | 3 | 3 built-in looks plus saved themes (D60); marketplace shares sections and page layouts (D125, D127), not whole themes. |
| Visual drag-and-drop editor | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections) | Full | 5 | D43 to D49, D91: rows, columns and about 25 block types. Nesting is fixed at three levels. |
| Templates per page type | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections) | Full | 4 | D79, D112, D113, D117 page roles including cart and checkout. |
| Global theme settings | Native. [source](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-settings/typography) | Full | 4 | D60 `ThemeEditor`, light and dark palettes. |
| Custom pages and front page selection | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections) | Full | 5 | D53, D54, D83, D126, D92. |
| Blog (multiple blogs, authors, comments, RSS) | Native. [source](https://help.shopify.com/en/manual/online-store/blogs) | Partial | 3 | D57 articles in the full builder. One blog per store, no comments, no RSS or Atom feed. |
| Navigation menus and mega menus | Native. [source](https://help.shopify.com/en/manual/online-store/menus-and-links), depth from knowledge | Full | 4 | D85, D87: three levels, mega menus with pictures. |
| Customizable header and footer | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections) | Full | 4 | D80, overlay header, modal rows for announcement bars (D121). |
| Theme code access (Liquid and files) | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/edit-theme-code) | Partial | 2 | Validated owner CSS (D100), sandboxed HTML block, consent-gated snippets (D61). No templating language or file access. |
| Fonts: library and custom fonts | Native. [source](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-settings/typography), library from knowledge | Full | 2 | D59, about 1,800 self-hosted Google families. No upload of own font files. |
| Animations and motion effects | Native. [source](https://themes.shopify.com/themes/horizon) | Full | 2 | D128, reduced-motion safe. |
| Mobile-responsive storefront, per-device editing | Native. [source](https://help.shopify.com/en/manual/online-store/themes), editor toggle from knowledge | Partial | 4 | Responsive with a few phone controls (hide, reverse, keep columns); no phone or tablet preview toggle in the builder. |
| Media library | Native. knowledge | Full | 3 | D88 to D90: uses tracking, alt texts, search by meaning. |
| Page speed: CDN, image optimisation, report | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/online-store-speed) (page returned no topic), knowledge | Partial | 4 | Prerendered Next.js, functions pinned to Dublin; no merchant speed report; images shrunk once in the browser, no per-device formats. |
| Headless: Storefront API, Hydrogen | Native. [source](https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals) | Missing | 2 | No public catalogue or cart API. |
| Customer account pages | Native. [source](https://changelog.shopify.com/posts/draft-unified-branding-customization-across-checkout-and-customer-accounts) | Full | 4 | `/account/*` as page roles (D113), D108, D66, D102. |
| Store-level A/B testing | Native (Grow and above, theme-wide). [source](https://changelog.shopify.com/posts/schedule-and-test-storefront-changes-with-rollouts) | Full | 2 | D148 phases 1 to 11, consent-only enrolment. |
| Scheduled storefront changes with auto-revert | Native. [source](https://changelog.shopify.com/posts/schedule-and-test-storefront-changes-with-rollouts) | Missing | 2 | Pages have draft and published only; scheduling exists for A/B tests and campaigns, not pages. |
| Version history, restore, shareable preview | Native. [source](https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/edit-theme-code), preview links from knowledge | Partial | 3 | Draft versus published and an admin-only preview; no revision history, undo stack or client-shareable link. |
| Per-page SEO fields | Native. [source](https://help.shopify.com/en/manual/promoting-marketing/seo/adding-keywords) | Full | 5 | `PageContent.seo`, noindex switch, product SEO fields. |
| Automatic sitemap.xml | Native. knowledge | Full | 5 | `src/server/seo.ts`: hreflang, x-default, image entries. |
| Structured data (JSON-LD) | Native. knowledge | Full | 4 | `src/lib/structured-data.ts`: Product, Offer, shipping, return policy, breadcrumbs, Article. |
| robots.txt control | Native. [source](https://gofishdigital.com/blog/shopify-robots-txt/), secondary | Full | 2 | `siteRobots()` with validated owner rules and AI bot switches. |
| URL redirect manager | Native. [source](https://help.shopify.com/en/manual/promoting-marketing/seo/url-redirect), page gave no detail, knowledge | Partial | 4 | `page_redirects` for pages only; no manual or CSV redirects; product and category changes leave none. |
| Favicon, logos, branding | Native. knowledge | Full | 3 | D62, dark logo variant, share image. |
| Popups and modal offers | Native. [source](https://apps.shopify.com/shopify-forms) | Full | 2 | D121: timer, exit intent, consent-gated frequency memory. |
| Signup and contact forms feeding customers and consent | Native. [source](https://apps.shopify.com/shopify-forms) | Partial | 3 | D93 forms email the owner with double opt-in; no subscriber or customer record, tags or segments. |
| Multilingual storefront content | Native. knowledge | Full | 5 | D55, D109, D110, D111. |
| Custom data rendered in the theme | Native. knowledge | Full | 3 | D118 to D120, block binding, filters and search from fields. |
| Cookie consent banner and log | Native. knowledge | Full | 5 | D58: Consent Mode v2, consent log, weekly scan. |
| AI store and page building | Native. [source](https://easysellapp.com/blogs/wiki/shopify-summer-2026-edition-updates-that-matter), secondary | Full | 2 | D92 page studio, D150 replicator, D94. Pages as drafts, not whole-store redesigns. |
| Storefront password or pre-launch page | Native. knowledge | Partial (R, was missing) | 2 | Unopened stores are viewable by URL, labelled "not open yet" and noindexed (`getOpenStore()`). No password, no coming-soon page, and no way to re-hide after launch. |
| Accessibility and theme quality guarantees | Native. knowledge | Partial | 3 | Alt texts (D89), reduced motion, WCAG 2.2 AA intent (D11). No checker for owner-built pages. |

### 5.3 Checkout and payments

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Checkout branding | Native. [source](https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility) | Full | 3 | D113, D117 checkout pieces, D60, D100. |
| Checkout extensibility (UI extensions, Functions) | Plus. [source](https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility) | Partial | 2 | Layout of checkout is editable and testable; no extension API, custom checkout fields or rules hook. |
| Guest checkout and optional account | Native. [source](https://help.shopify.com/en/manual/checkout-settings) | Full | 5 | D28, D32. |
| Accelerated checkout (Apple Pay, Google Pay, Shop Pay) | Native. [source](https://help.shopify.com/en/manual/payments/shop-pay) | Partial | 4 | Stripe express buttons incl. Link (D22, D23) on the checkout page only; depends on the Stripe account; smaller wallet network than Shop Pay. |
| Integrated payments provider in the Nordics and EU | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries) | Full | 5 | D17, D20 Stripe Connect Accounts v2, embedded onboarding. |
| Third-party and multiple payment gateways | Native. [source](https://www.shopify.com/pricing) | Partial (R, was missing) | 3 | Stripe only (`provider = 'stripe'`); several methods through it. No Mollie, Adyen, Nets, Paytrail or bank transfer; stores Stripe does not serve cannot sell. |
| Klarna | Native. [source](https://docs.klarna.com/platform-solutions/e-commerce-platforms/shopify/payments/shopify-payments) | Partial | 4 | D23 capability requested; no Kaizen-side method switch, no on-site Klarna messaging. |
| Vipps | App. [source](https://developer.vippsmobilepay.com/docs/plugins-ext/shopify) | Missing | 3 | Not yet available for Stripe Accounts v2 (D23). |
| MobilePay | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods) | Full | 3 | D23 capability requested, shown for Danish and Finnish shoppers. |
| Swish | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods) | Missing | 3 | In private preview at Stripe (D23). |
| iDEAL, Bancontact, SEPA, BLIK, EPS, P24 and other local methods | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods) | Partial (R, was missing) | 4 | Checkout omits `payment_method_types`, so methods the owner enables in Stripe can appear. No Kaizen capability requests, admin, per-market control or tests; subscriptions and boxes are card-only. |
| PayPal | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments) | Missing | 4 | Not allowed by Stripe for direct-charge platforms (D23). |
| Authorize then capture | Native. [source](https://help.shopify.com/en/manual/payments/payment-authorization) | Missing | 2 | Sessions capture automatically. |
| Fraud analysis and risk flags | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/fraud-protection) | Partial | 3 | Stripe Radar runs on the store's account; nothing shown on orders in Kaizen. |
| Chargeback and dispute handling | Native. [source](https://help.shopify.com/en/manual/payments/chargebacks) | Missing | 3 | Webhook handles no `charge.dispute.*` or refund events; disputes live only in Stripe. |
| Multi-currency pricing and checkout | Native. [source](https://help.shopify.com/en/manual/markets/pricing/exchange-rates) | Full | 4 | D109, ECB rates, rounding, euro scenarios in tests. |
| EU VAT by destination, VAT-inclusive prices, reduced rates | Native. knowledge (`help.shopify.com/en/manual/taxes`) | Partial | 5 | `commerce.vat_rate()` with three categories (D65); rates in migrations marked "to verify"; Stripe Tax not used. |
| OSS and IOSS support | Native. [source](https://community.shopify.com/t/setting-up-product-pricing-and-vat-for-the-eu-under-ioss/333926) | Missing | 4 | No IOSS number, no VAT-by-country report; only a documented open decision. |
| B2B VAT ID, reverse charge, exemption | Native. knowledge | Missing | 3 | D63: every order charges the market's VAT; no EU VAT ID or VIES. |
| B2B payment terms | Native. [source](https://help.shopify.com/manual/b2b/payment-terms) | Missing | 2 | Every store order is paid online at checkout. |
| Abandoned checkout recovery | Native. [source](https://help.shopify.com/en/manual/orders/abandoned-checkouts) | Full | 4 | D33: three steps, discount per step, one-click unsubscribe. |
| Order editing after purchase | Native. [source](https://help.shopify.com/en/manual/orders/edit-orders) | Partial | 3 | Only email and address change; no line or quantity edits. |
| Draft orders and payment links | Native. [source](https://help.shopify.com/en/manual/orders/create-orders) | Missing | 3 | Orders come only from carts and renewals. |
| Discount codes and automatic discounts | Native. [source](https://help.shopify.com/en/manual/discounts) | Full | 4 | D31, D38, D114 to D116. Rated partial (w5) in the Customers domain. |
| Refunds and cancellation | Native. knowledge | Full | 5 | D27: any amount through Stripe, restock, emails. |

### 5.4 Orders, shipping, fulfilment and returns

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Order list: search, filters, saved views, bulk | Native. [source](https://help.shopify.com/en/manual/fulfillment/setting-up-fulfillment/setting-up-local-pickup), knowledge | Partial | 4 | Three tabs, newest 200; no search, bulk actions or saved views (`listOrders()`). |
| Order statuses, timeline, notes | Native. [source](https://help.shopify.com/en/manual/orders/edit-orders), knowledge | Full | 4 | `order_events`, `addOrderNote()`. |
| Order tags and archiving | Native. [source](https://help.shopify.com/en/manual/orders/export-orders), knowledge | Missing | 3 | None. |
| Edit an order after placement | Native. [source](https://help.shopify.com/en/manual/orders/edit-orders) | Partial | 3 | Email and address only. |
| Cancel order with refund and restock | Native. [source](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns) | Full | 5 | `cancelOrder()`, D102. |
| Partial and full refunds with restocking | Native. [source](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns) | Full | 5 | `refundOrder()`; amount plus restock quantities, not per-line amounts; orders paid outside Kaizen's Stripe refund in Stripe. |
| Draft and manual orders | Native. [source](https://help.shopify.com/en/manual/orders/create-orders) | Missing | 3 | Staff cannot create an order or send a pay link. |
| Fulfilment workflow, partial fulfilment | Native. [source](https://help.shopify.com/en/manual/fulfillment/setting-up-fulfillment/setting-up-local-pickup) | Partial | 4 | Order flips to Sent on the first parcel; shipments not tied to lines; no bulk fulfil or pick lists. |
| Flat shipping rate with free threshold | Native. [source](https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-delivery) | Full | 5 | `commerce.shipping_rates` per market. |
| Weight or price rate tables, zones, profiles | Native. [source](https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-delivery) | Partial (R, was missing) | 4 | Flat rate, free-above, carrier-quoted weight pricing and per-service weight limits. No merchant tiers, regions or per-product profiles. |
| Carrier-calculated live rates | Native (Advanced or add-on). [source](https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/enabling-shipping-carriers) | Partial | 3 | D135: live Bring and Porterbuddy, Norway only; PostNord and Helthjem store-priced. |
| Shipping label purchase and printing | Native. [source](https://help.shopify.com/manual/shipping/shopify-shipping/shipping-labels) | Partial | 4 | D134, D137, D138 for Norway; no PostNord booking; nothing verified against real carrier servers; no bulk labels. |
| Pickup points and lockers at checkout | App. [source](https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-delivery) | Partial | 4 | Bring, PostNord, Helthjem (D135 to D138); Nordic only, no DPD, InPost, Packeta or GLS. |
| Local pickup at own location | Native. [source](https://help.shopify.com/en/manual/fulfillment/setting-up-fulfillment/setting-up-local-pickup) | Missing | 3 | No collect-from-store option or ready-for-pickup email. |
| Local delivery | Native. [source](https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-delivery) | Partial | 2 | Porterbuddy windows (D137) and delivery rounds (D102); no merchant zones. |
| Packing slips and pick lists | Native. [source](https://apps.shopify.com/shopify-order-printer) | Full | 3 | Single-order printable slip; no bulk print or pick list. |
| Shipping confirmation email with tracking | Native. [source](https://help.shopify.com/en/manual/orders/notifications/customer-notifications) | Full | 5 | `sendShipped()`. |
| Delivery-status notifications, tracking page | Native. [source](https://help.shopify.com/en/manual/orders/notifications/customer-notifications) | Partial | 3 | Tracking link shown; no out-for-delivery or delivered emails, no timeline for the shopper. |
| Editable notification email templates | Native. [source](https://help.shopify.com/en/manual/orders/notifications/customer-notifications) | Missing (R, was partial) | 3 | Wording and layout fixed in code (`email-text.ts`, `email-layout.ts`); switches are per action, not per event; no staff new-order email. |
| Staff alerts for new orders, order automation | Native. [source](https://help.shopify.com/en/manual/orders/notifications/customer-notifications) | Partial | 3 | Order events to Slack, Zapier, Make (D41, D101); no new-order email, no rule builder. |
| Self-serve withdrawal and return requests | Native. [source](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns) | Missing | 5 | Withdrawal and returns tables exist in the schema but nothing reads or writes them. The International-domain recheck says no such tables exist; the two reports disagree on that detail, not on the missing function. |
| Returns management (RMA, inspect, restock, fees) | Native. [source](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns) | Partial (R, was missing) | 4 | Refund-and-restock only, tested; no return object, reason, condition, fee or label. |
| Return labels | Native. [source](https://help.shopify.com/en/manual/shipping/shopify-shipping) | Missing | 3 | Carrier modules book outbound only. |
| Exchanges | Native. [source](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns) | Missing | 2 | Would be refund plus a new order. |
| 3PL and fulfilment network | App. [source](https://help.shopify.com/en/manual/fulfillment/setting-up-fulfillment/fulfillment-network) | Partial (R, was missing) | 2 | Only outbound order webhooks through Zapier or Make; nothing returns stock or tracking. Weak partial. |
| Customs and duties | Native. [source](https://help.shopify.com/en/manual/international/duties-and-import-taxes) | Partial | 3 | HS code and origin stored; no duty or import-VAT calculation, no customs data in bookings. |
| Multi-location inventory and routing | Native. [source](https://www.shopify.com/pricing) | Partial | 2 | One auto-created location; no locations UI or routing. |
| Inventory transfers | Native. [source](https://help.shopify.com/en/manual/products/inventory/transfers) | Missing | 1 | None. |
| Order export to CSV | Native. [source](https://help.shopify.com/en/manual/orders/export-orders) | Missing | 4 | No orders export; Tripletex is a proposal only (`docs/tripletex.md`). |
| Customer order status page and order history | Native. [source](https://help.shopify.com/en/manual/orders/notifications/customer-notifications) | Full | 4 | D113, D117, `/account/orders/[orderId]`. |
| Invoices and VAT receipts for orders | Native (via Order Printer app). [source](https://apps.shopify.com/shopify-order-printer) | Partial | 4 | Optional Stripe invoice with Stripe's numbering; gap-free order numbers (D141) but no Kaizen-issued invoice PDF. |
| Credit notes for refunds | App. [source](https://apps.shopify.com/shopify-order-printer) | Missing | 3 | Credit notes exist for Work invoices only. |
| Gift receipts and messages | App. [source](https://apps.shopify.com/shopify-order-printer) | Missing | 1 | None. |

### 5.5 Customers, marketing and loyalty

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Customer profiles, notes, CSV import and export | Native. knowledge | Partial | 4 | D35 `customer-admin.ts`: read-mostly; no add or edit, notes, tags, merge, CSV or staff GDPR tool. |
| Customer segments and tags | Native. [source](https://help.shopify.com/en/manual/customers/customer-segmentation) | Partial | 3 | RFM groups in analytics (D152) and discount groups (D108); no saved segment builder, nothing can target them. |
| Email marketing: broadcasts and lifecycle automations | Native. [source](https://apps.shopify.com/shopify-email) | Partial (R, was missing) | 4 | Only cart reminders are automated; no subscriber list, consent flag, composer or send to segments; the AI manager emails one customer at a time. |
| Workflow automation (Flow) | Native. [source](https://help.shopify.com/en/manual/shopify-flow) | Partial | 2 | Outbound event webhooks (D41, D101); no trigger-condition-action builder. |
| Abandoned checkout recovery emails | Native. [source](https://help.shopify.com/en/manual/orders/abandoned-checkouts) | Full | 4 | D33; email only. |
| SMS marketing | Native. [source](https://changelog.shopify.com/posts/create-sms-marketing-automations-in-shopify-messaging) | Missing | 2 | No SMS channel. |
| Signup forms and popups building a list | Native. [source](https://help.shopify.com/en/manual/promoting-marketing/create-marketing/forms-app) | Partial | 4 | D93, D121: sign-ups emailed, not stored; no signup incentive or tagging. |
| Discount codes | Native. [source](https://help.shopify.com/en/manual/discounts) | Partial | 5 | D31: product scope only, one code per order, no customer eligibility or bulk generation. |
| Automatic discounts | Native. [source](https://help.shopify.com/en/manual/discounts/discount-combinations) | Partial | 4 | D114 to D116 campaigns; no automatic fixed-amount or free-shipping discount, no spend tiers. |
| Buy X get Y | Native. [source](https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y) | Partial | 3 | Buy N pay M and basket-threshold gift only; no "buy X get Y at 50%". |
| Tiered and volume discounts | App. knowledge | Partial (R, was missing) | 3 | Overlapping multi-buy campaigns approximate a ladder; no true spend-more-save-more. |
| Discount stacking and customer-targeted discounts | Native. [source](https://help.shopify.com/en/manual/discounts/discount-combinations) | Partial | 3 | Fixed order in code; owner cannot choose combinations; codes not limited to groups. |
| Omnibus 30-day lowest-price reference | App. [source](https://apps.shopify.com/omnibus-price) | Full | 4 | `commerce.set_price`, `prior_30d_minor`, `<Price>`. |
| Gift cards | Native. [source](https://www.shopify.com/pricing) | Missing | 3 | Listed as a non-goal in `docs/bonus.md`. |
| Loyalty and rewards | App. [source](https://www.shopify.com/editions/winter2026) | Full | 3 | D130; purchase-based earn only, no tiers or action points. |
| Customer referral program | App. knowledge | Full | 2 | D131; rewards are bonus credits, no cash. |
| Affiliate and creator programme | Native. [source](https://apps.shopify.com/collabs) | Partial | 2 | No affiliate sign-up, money commissions or payouts. |
| Social channels (Facebook, Instagram, TikTok, Pinterest) | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/facebook) | Missing | 3 | Profile links only; no catalogue sync. |
| Google Shopping and Merchant Center feed | Native. [source](https://apps.shopify.com/google) | Missing | 4 | No feed endpoint or connection (rated partial in the Catalogue domain after recheck). |
| Ad pixels and conversion events | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/facebook) | Partial | 3 | GA4, GTM, Meta Pixel load after consent (D58) but send page views only; no purchase events or server-side API. |
| Marketing campaign tracking and attribution | Native. [source](https://help.shopify.com/en/manual/promoting-marketing/managing-marketing/marketing-campaigns) | Partial | 3 | D152 channels, CAC, ROAS; spend typed by hand, same-day attribution only. |
| Product reviews and UGC | App. [source](https://community.shopify.com/t/are-my-shopify-product-reviews-still-recoverable/326779) | Missing | 4 | None. |
| Wishlists | App. [source](https://community.shopify.com/t/will-shopify-launch-a-native-wishlist-app-soon/159761) | Full | 2 | D34; lists are private. |
| Back-in-stock notifications | App. [source](https://changelog.shopify.com/posts/create-sms-marketing-automations-in-shopify-messaging) | Missing | 3 | None. |
| Customer accounts | Native. [source](https://help.shopify.com/en/manual/customers/customer-accounts) | Partial | 4 | D28: one saved address, no social sign-in, no self-serve returns, no data export. |
| Blog and content marketing | Native. [source](https://help.shopify.com/en/manual/online-store/blogs) | Full | 3 | D57; no comments. |
| SEO fundamentals | Native. knowledge | Full | 5 | D21, `src/lib/seo.ts`, `src/lib/structured-data.ts`. |
| URL redirect manager | Native. knowledge | Partial | 3 | Pages only. |
| AI-assistant discoverability and agentic commerce | Native. [source](https://www.shopify.com/editions/winter2026) | Partial | 3 | `llms.txt`, bot switches, JSON-LD; no feed or shopper-facing MCP. |

### 5.6 Analytics, reporting and finance

D152 analytics is uncommitted work and is counted as built here.

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Dashboard with period comparison | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports) | Full | 4 | `/admin/{store}/analytics`; fixed layout, not owner-customisable. |
| Live View | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/live-view) | Missing | 2 | Visits are daily rows; nothing real-time. |
| Standard sales reports | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report) | Full | 5 | `docs/analytics.md`; no cut by vendor, payment method or shopper currency. |
| Custom report builder and ShopifyQL | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/custom-reports) | Missing | 3 | Reports are fixed pages; no saved reports or analytics API. |
| Natural-language analytics | Native. [source](https://changelog.shopify.com/posts/turn-business-questions-into-analytics-reports-with-natural-language-queries) | Partial | 2 | Fixed AI manager tools; no ad hoc cuts. |
| Conversion funnel and rate | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports) | Full | 4 | Cookieless counting, off by default. |
| Traffic by device, country, landing page | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports) | Full | 3 | Country and city only, no regions. |
| Marketing and channel attribution | Native. [source](https://www.shopify.com/analytics) | Partial | 4 | Visit tied to a cart the same day; no multi-touch, no ad-platform spend sync, no UTM builder. |
| Profit and margin reports | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/profit-reports) | Full | 4 | `cost_minor`, frozen `unit_cost_minor`, coverage stated. |
| Finance summary | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/finances-report) | Full | 4 | Gross-to-net bridge; refunds made in the Stripe Dashboard are not seen. |
| Tax and VAT reports by rate and jurisdiction | Native. [source](https://help.shopify.com/en/manual/taxes/eu/eu-tax-setup) | Partial | 5 | One VAT total; no VAT by country or rate, no OSS data, no export. |
| Payouts and reconciliation | Native. [source](https://help.shopify.com/en/manual/payments/shopify-payments/payouts/payout-reconciliation-report) | Missing | 4 | Payouts are in the owner's Stripe Dashboard; fees are estimated from a percentage. |
| Payments reports by method | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/finances-report) | Missing | 2 | Method mix not recorded. |
| Liabilities: gift card and store credit | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/finances-report) | Partial (R, was missing) | 2 | Outstanding bonus credit shown at `/admin/{store}/bonus`, not in Analytics; no gift cards, no roll-forward. |
| Customer reports: cohorts, repeat rate | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports) | Full | 4 | `analytics-customers.ts`. |
| Customer lifetime value | Native. [source](https://help.shopify.com/en/manual/customers/customer-segmentation/predicted-spend-tier) | Full | 3 | Store and cohort level, not per customer. |
| RFM segments and customer lists | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports) | Partial | 3 | Six groups as counts and advice; no member lists. |
| Dynamic segments for marketing | Native. [source](https://help.shopify.com/en/manual/customers/customer-segmentation) | Missing | 3 | No rule-based segment builder. |
| Inventory reports | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports) | Full | 3 | Days of stock, dead stock, sell-through. |
| Returns and refund analytics | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report) | Partial | 3 | No return reasons; Stripe-side refunds unseen. |
| Subscription analytics | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report) | Full | 2 | MRR, churn, failed renewals. |
| On-site search analytics | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports) | Partial | 2 | No revenue after a search. |
| Targets, alerts, forecasting | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/custom-reports/benchmarks) | Partial | 2 | Monthly revenue target only; alerts visible in admin, never emailed. |
| Explaining why sales changed | App. [source](https://apps.shopify.com/lifetimely-lifetime-value-and-profit-analytics) | Full | 2 | `explainChange()`, computed in code. |
| Export reports to CSV | Native. [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/finances-report) | Missing | 4 | No analytics, order or customer export. |
| Scheduled report emails | App. [source](https://apps.shopify.com/betterreports) | Missing | 2 | None. |
| Accounting integrations | App. [source](https://apps.shopify.com/advanced-reports) | Partial | 4 | Webhooks to Zapier or Make; Tripletex proposed only. |
| Third-party analytics and pixels with consent | Native. [source](https://www.shopify.com/analytics) | Full | 4 | D58, D61; no server-side events. |
| Industry benchmarks | Native (deprecated 19 May 2026). [source](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/custom-reports/benchmarks) | Missing | 1 | None. |
| Shopify Audiences | Plus. [source](https://help.shopify.com/en/manual/promoting-marketing/audiences) | Missing | 1 | Not available to EU merchants on Shopify either. |

### 5.7 International, compliance and trust

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Markets | Native. [source](https://help.shopify.com/manual/markets/managing-markets), plan limits from community sources | Full | 4 | `commerce.markets`, D109. |
| Market-specific catalogs | Native. [source](https://help.shopify.com/en/manual/markets/customizations/catalogs) | Partial | 3 | Availability is implied by having a price row; no catalog object or per-market switch. |
| Fixed per-market prices and adjustment rules | Native. [source](https://help.shopify.com/en/manual/international/pricing/currency-rounding) | Partial | 4 | Prices entered by hand per country; no percentage rule or bulk adjustment. |
| Domains and subfolders per market | Native. [source](https://help.shopify.com/en/manual/international/managing-international-domains) | Partial | 3 | Path-per-market; up to 5 domains per store, but a market cannot have its own ccTLD. |
| Multi-language storefront and AI translation | Native. [source](https://help.shopify.com/manual/markets/languages/translate-adapt-app) | Full | 5 | D55, D109 to D111. |
| Market-specific content adaptation | Native. [source](https://help.shopify.com/manual/markets/languages/translate-adapt-app) | Partial | 2 | Content varies by language, not by country. |
| Multi-currency display and checkout | Native. [source](https://help.shopify.com/en/manual/international/pricing/currency-rounding) | Full | 4 | D109, ECB rates. |
| Currency rounding rules | Native. [source](https://help.shopify.com/en/manual/international/pricing/currency-rounding) | Full | 2 | `ROUND_STEPS`. |
| Geolocation suggestion | Native. [source](https://help.shopify.com/en/manual/international/localization-tools/geolocation-app) | Partial | 2 | Suggestion on the country chooser only; never redirects, by design (Geo-blocking Regulation). |
| EU VAT per country, rates, OSS-ready | Native. [source](https://help.shopify.com/en/manual/taxes/eu/eu-tax-reference) | Partial | 5 | Three categories, no general reduced rates, no OSS report. |
| IOSS | Native. [source](https://help.shopify.com/en/manual/taxes/eu/eu-tax-reference) | Missing | 3 | Documented decision only. |
| B2B VAT-ID validation and reverse charge | App. [source](https://community.shopify.com/t/eu-business-tax-exemption-base-on-vat-validation-vies/166489/7) | Missing | 3 | Reverse charge exists only in the Work module. |
| Customs duties, HS codes, landed cost | Native. [source](https://help.shopify.com/manual/markets/markets-pro/overview) | Partial | 3 | Data stored, nothing calculated. |
| Legal page templates and policy generator | Native. [source](https://help.shopify.com/en/manual/checkout-settings/refund-privacy-tos) | Missing | 4 | Legal texts "need human review" (`src/lib/i18n.ts`); no starters, no terms checkbox. |
| Cookie consent banner and API | Native. [source](https://help.shopify.com/en/manual/privacy-and-security/privacy/customer-privacy-settings) | Full | 5 | D58. |
| GDPR data export and erasure | Native. [source](https://help.shopify.com/en/manual/your-account/privacy/processing-customer-data-requests) | Partial | 4 | Shopper self-deletion only; no export, no staff erase; order rows keep name and address. |
| EU withdrawal function and self-service returns | Native. [source](https://help.shopify.com/en/manual/compliance/legal/eu-right-of-withdrawal) | Partial (R, was missing) | 5 | Exclusion flags, 14-day policy in JSON-LD, staff refund and restock, booking self-cancel. No withdrawal button, acknowledgement or return flow for goods. |
| Withdrawal exclusions and digital waiver | App. knowledge | Full | 4 | D24, 10 statutory cases, consent at checkout. |
| Accessibility (WCAG, EAA) and statement | Native. [source](https://shopify.com/accessibility) | Partial | 4 | D11 intent and theme contrast checks; no audit result, no automated a11y test, no statement template. |
| GPSR safety information | App. [source](https://apps.shopify.com/gpsrkit) | Full | 4 | D12, publish blocked when missing. |
| Packaging and EPR registers | App. [source](https://ecommercegermany.com/blog/the-german-packaging-act-verpackg-how-to-get-your-online-shop-compliant) | Partial | 3 | Tags and an SQL view; no registration screen and nothing blocks selling. |
| Unit price indication | Native. knowledge | Missing | 4 | No field, display or JSON-LD. |
| Vipps and MobilePay | App. [source](https://developer.vippsmobilepay.com/docs/plugins-ext/shopify) | Partial | 3 | Only if Stripe offers it to the account. |
| Brønnøysund lookup and angrerett | App. knowledge | Full | 2 | D124. |
| EU data residency and sub-processors | Plus. [source](https://community.shopify.com/t/gdpr-data-processing-only-in-eu/266838), secondary | Partial | 3 | Pinned to Ireland and Dublin (D10); DPAs not yet recorded as accepted; some AI processing may leave the EU. |
| PCI DSS | Native. knowledge | Full | 5 | Stripe Payment Element, card data never reaches Kaizen. |
| Staff two-step authentication | Native. [source](https://help.shopify.com/en/manual/your-account/staff-accounts/create-staff-accounts) | Missing | 4 | Password or magic link only. |
| Staff roles and permissions | Native. [source](https://help.shopify.com/en/manual/your-account/staff-accounts/create-staff-accounts) | Partial | 3 | Owner and admin only. |
| Audit log of admin changes | Plus. knowledge | Partial | 2 | `commerce.audit_log` written; viewable only on the payments page. |
| Legal invoices and credit notes for orders | App. [source](https://sufio.com/blog/order-printer-apps-vs-invoicing-apps/), secondary | Partial | 4 | Gap-free order numbers, Stripe invoice; no Kaizen credit note. |
| DAC7 reporting | App. knowledge | Full | 1 | D71. |

### 5.8 Platform, extensibility and operations

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| App Store and ecosystem | Native. [source](https://www.appjubilee.io/shopify-app-store-report-2026) | Missing | 3 | No app model. Understated by the weight: this is the structural gap. |
| Public Admin API and custom apps | Native. [source](https://shopify.dev/docs/api/admin-rest) | Partial (R, was missing) | 3 | No merchant API or tokens; one-way events to Zapier, Make, Slack; `/api/mcp` serves Kaizen Life only. |
| Storefront API and headless | Native. [source](https://www.shopify.com/pricing) | Missing | 2 | Only Kaizen's own storefront renders a store. |
| Outgoing webhooks | Native. [source](https://shopify.dev/docs/apps/build/webhooks) | Partial | 3 | Only Zapier, Make and Slack hosts accepted; about 8 events; no signing secret. |
| Custom logic (Functions) | Plus. [source](https://shopify.dev/docs/apps/build/functions) | Partial | 2 | Built-in rule types only. |
| Workflow automation (Flow) | Native. [source](https://help.shopify.com/en/manual/shopify-flow) | Partial | 3 | Fixed automations and the AI manager; no builder. |
| Custom data (metafields) | Native. [source](https://help.shopify.com/en/manual/metafields/metaobjects) | Full | 3 | D118 to D120. |
| Metaobjects | Native. [source](https://help.shopify.com/en/manual/metafields/metaobjects) | Partial | 2 | No standalone entries. |
| Staff accounts and roles | Native. [source](https://help.shopify.com/en/manual/your-account/staff-accounts/staff-permissions) | Partial | 4 | Two fixed roles, no collaborators, no log viewer. |
| Multi-store management | Plus. [source](https://help.shopify.com/en/manual/your-account/shopify-mobile) | Full | 2 | D19, D107, up to 10 stores per owner. |
| Store duplication, staging, theme versions | Native. [source](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes) | Partial | 3 | D129 duplication; no revision history or rollback. |
| Themes and templates marketplace | Native. [source](https://help.shopify.com/en/manual/online-store/themes/managing-themes/duplicating-themes) | Partial | 3 | Parts and page layouts only; no third-party designers. |
| Developer access to storefront code | Native. [source](https://shopify.dev/docs/apps/build/functions) | Partial | 2 | CSS and snippets only; no CLI or templating. |
| Product, customer and order CSV | Native. [source](https://help.shopify.com/en/manual/products/import-export/using-csv) | Missing | 4 | CSV exists for Work, DAC7 and field groups only. |
| Migration from other platforms | Native. [source](https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-your-store/import-products) | Partial | 3 | Page replicator (D150) and store copy (D129); no catalogue, customer or order import. |
| POS and retail | Native. [source](https://www.shopify.com/pos) | Missing | 2 | No in-person selling. |
| B2B: companies, catalogs, terms | Native. [source](https://help.shopify.com/en/manual/b2b) | Partial | 3 | No price lists, terms, quotes or PO fields. |
| Marketplace and multi-vendor | App. [source](https://cartcoders.com/blog/shopify-marketplace/shopify-multi-vendor-marketplace-pros-cons/) | Partial | 1 | Hosts for stays and rentals only (D71). |
| Bookings, appointments, rentals | App. [source](https://apps.shopify.com/appointo) | Full | 2 | D65 to D70. |
| Mobile admin app | Native. [source](https://help.shopify.com/en/manual/shopify-admin/shopify-mobile-app) | Partial (R, was missing) | 3 | Responsive admin and phone-friendly voice assistant; no installable app, no order push (only via Slack). |
| Consumer network (Shop app, Shop Pay) | Native. [source](https://www.shopify.com/shop) | Missing | 2 | No cross-store shopper identity. |
| Admin AI assistant | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Full | 2 | D94, D103 to D106. Rated partial (w3) in the AI domain. |
| Custom domains and SSL | Native. [source](https://www.shopify.com/pricing) | Full | 5 | P7, P8. |
| Hosting, CDN, uptime, status page | Native. [source](https://www.shopify.com/status) | Partial | 4 | No status page, SLA or error tracking; single-region database; pushes go straight to production (D5). |
| Merchant support channels | Native. [source](https://www.shopify.com/pricing) | Partial | 4 | AI-first help; no ticketing or human channel found. |
| Transparent plans, fees and billing | Native. [source](https://www.shopify.com/pricing) | Full | 4 | D18, D19, D132, D142. |
| Self-serve sign-up and onboarding | Native. [source](https://www.shopify.com/pricing) | Partial | 4 | Invite-only beta with manual approval. |

### 5.9 AI and automation

| Feature | Shopify | Kaizen | W | Gap and evidence |
|---|---|---|---|---|
| Admin AI assistant that performs tasks | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Partial | 3 | About 55 owner tools with approval gates (D94); no tools to create or edit products, pages, menus, themes or segments; no background tasks. |
| Assistant voice mode | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Full | 1 | D104, D105; needs a speech or live model configured. |
| Assistant memory and saved skills | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Partial | 2 | Memory is solid; skills are fixed playbooks in code. |
| Proactive insights | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Partial | 2 | Alerts computed on read; no pushed briefing. |
| AI product descriptions and SEO text | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/shopify-magic) | Full | 4 | D76; one product at a time. |
| AI image generation | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/generate-content) | Partial | 2 | Only from the page studio; not in editor or library. |
| AI image editing | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/shopify-magic) | Missing | 2 | Text-to-image only. |
| AI alt text | Native. knowledge | Full | 3 | D89. |
| AI and semantic storefront search | Native. [source](https://changelog.shopify.com/posts/semantic-search-is-now-available-on-more-plans) | Full | 3 | D72 to D77. |
| Search merchandising | Native. [source](https://help.shopify.com/en/manual/online-store/search-and-discovery) | Partial | 3 | Filters yes; no synonyms, boosts or pins (the Catalogue domain rates this missing). |
| Product recommendations | Native. [source](https://help.shopify.com/en/manual/online-store/search-and-discovery) | Full | 3 | D139, D140. |
| AI customer-support chat agent | Native. [source](https://help.shopify.com/en/manual/inbox) | Partial | 3 | D81; no order or return lookup, no human handoff. |
| AI page and theme generation | Native. [source](https://www.progressiverobot.com/2026/10/02/shopify-canvas-build-online-store-chatting-with-ai/), secondary | Partial | 2 | Page drafts only; no whole-store redesign or conversational editing. |
| AI translation | Native. [source](https://apps.shopify.com/translate-and-adapt) | Full | 4 | D110, D111. |
| Natural-language analytics and custom reports | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/generate-content) | Partial | 3 | Fixed reports and tools. |
| AI or rule-based customer segmentation | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/generate-content) | Partial | 3 | No segment builder. |
| Workflow builder with AI generation | Native. [source](https://help.shopify.com/en/manual/shopify-flow/create/create-workflow) | Partial | 3 | Webhooks only. |
| Create discounts and campaigns from a prompt | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/generate-content) | Full | 2 | `create_discount`, `create_campaign`, gated. |
| AI-written marketing email | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/generate-content) | Partial (R, was missing) | 3 | Only a one-to-one drafted email through the AI manager; the report calls it "thin" and effectively missing for campaigns. |
| Agentic storefronts (ChatGPT, Gemini, Copilot) | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts) | Missing | 3 | No syndication; in-chat checkout deferred. |
| Agent-ready UCP or MCP endpoints | Native. [source](https://shopify.dev/docs/apps/build/storefront-mcp) | Missing | 2 | `/api/mcp` is owner-only. |
| AI discovery signals | Native. [source](https://nikhil.pro/shopify-quietly-rolled-out-agentic-commerce-and-llms-txt-on-every-store), secondary | Full | 3 | `llms.txt`, per-bot switches, JSON-LD. |
| Product feed to Merchant Center | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/google) | Missing | 4 | No feed. |
| Third-party apps extend the assistant | Native. [source](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick) | Missing | 1 | No app ecosystem. |
| AI controls, usage and cost visibility | Native. [source](https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts) | Full | 2 | D106, D145, D146. |

## 6. Caveats

- **Research date.** The Shopify side reflects documentation read in October 2026 (including the Summer '26 Edition). Shopify changes plan limits and app availability often, and some Shopify claims in the data come from secondary sources and recaps, which the tables mark as secondary.
- **Shopify side not fetched.** 36 of the 266 rows cite "knowledge" for their Shopify source (fully or in part), meaning the Shopify claim was not checked against a page. These are mostly basic features (sitemap, consent, refunds), so the risk is small, but they are unverified.
- **Weights are judgement.** Each row's 1 to 5 weight reflects an EU small or mid-size merchant, and I did not change any. Unweighted parity is 56.0% against the weighted 59.5%, so the weights move the result by a few points, not by tens.
- **Rechecks lifted the score.** 15 rows were rechecked: 14 went up (mostly from missing to partial) and 1 went down. By my arithmetic from the rechecked rows, the headline would be roughly 57% without the rechecks. Several upgraded reports say in their own text that the honest reading is "partial leaning missing" (Merchant Center feed, storefront password, 3PL, AI marketing email), so the true figure may sit nearer 57% than 60%.
- **Cross-domain double counting and disagreement.** The same Shopify feature appears in more than one domain (discount codes, gift cards, Merchant Center feed, URL redirects, metafields, blog, cookie consent, B2B, draft orders, search merchandising, admin AI assistant, withdrawal), so the 232 core features include repeats and the overall figure leans on those. Some repeats are rated differently: discount codes are full in Checkout and partial (w5) in Customers; the Merchant Center feed is partial in Catalogue and missing in Customers and AI; the admin AI assistant is full (w2) in Platform and partial (w3) in AI; search merchandising is missing in Catalogue and partial in AI. I kept each rating as researched. The two withdrawal reports also disagree on whether the unused `withdrawal_requests` and `returns` tables exist in the schema.
- **Kaizen ratings are from reading code, not running it.** Several carrier and payment items are noted as not verified against live services. Carrier features are rated as built but unproven against real carrier servers.
- **D152 analytics is uncommitted work and is counted as built.** The Analytics domain (62.8%) and several Customers and AI rows rest on it. If it is not shipped, those rows fall and the headline moves down.
- **Not counted in the headline.** Shopify's App Store ecosystem itself (only the 27 app-only rows that stand in for it appear, in the 58.7% figure) and Plus-only features (7 more rows, in the 58.5% figure). POS and the Shop app are native rows and are counted, as missing. For a merchant who would simply install apps on Shopify, Kaizen's real gap is wider than the 40 points the headline suggests.
- **"Where Kaizen is ahead" claims are unscored.** Doc-only items in section 4 were not verified on the Shopify side, and several source claims ("Shopify has no native X") are contradicted or narrowed by the rated rows, as noted there.

## 7. Suggested build order

Ordered by legal exposure first, then by how many gaps one piece of work closes. Sizes are rough and are my guess, not from the research.

1. **Withdrawal button, returns flow and legal page starters** (gaps 1, 7, 11). A legal obligation since 19 June 2026, the schema tables already exist, and it unlocks return reasons, labels and returns analytics. Include a terms-acceptance link at checkout and human-reviewed starter policy pages.
2. **VAT completeness and reporting** (gap 2). Editable reduced-rate categories, a VAT-by-country and rate report with export for OSS filing, EU VAT ID check with reverse charge, then shop-order invoices and credit notes in Kaizen's own gap-free series (the Work module already has the machinery).
3. **CSV import and export, bulk edit and redirects** (gaps 5, 12). One import and export pipeline for products, orders and customers, bulk product editing, and automatic redirects when a handle changes. This is also the migration path for any merchant arriving from Shopify or WooCommerce.
4. **Inventory and order operations** (gaps 3, 13, 14). An inventory page with adjustments and reasons, backorders, a locations screen, order search with tags and bulk actions, draft orders, shipping rate tables, and local pickup.
5. **Payments breadth** (gaps 6, 8). Show and request local methods (iDEAL, Bancontact, BLIK and so on) from Kaizen's own admin, add dispute and payout handling to the webhook, and decide whether a second provider adapter (Mollie or Adyen) is needed given that Stripe blocks PayPal for direct-charge platforms. Add Swish and Vipps when Stripe opens them.
6. **Marketing basics** (gaps 4, 9, 10). A subscriber list with consent, broadcast email to a saved segment, a segment builder, Merchant Center feed (the next planned step in `docs/plan.md`), richer discount-code scope, and product reviews.
7. **Platform trust and reach** (next-in-line list, App Store gap). Staff two-step authentication and per-section roles first, then a status page, a public API with tokens and open webhooks, and unit price. The API and webhooks are the first step toward any extension model, which is where Shopify's largest advantage sits.
