# Rules: Orders, payments, tax, shipping and selling

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md keeps one line per rule pointing here; each rule is under that line as its heading.

## Products (`/admin/{store}/products`)

- Products (`/admin/{store}/products`): `ProductEditor` is one client
  component holding the whole product; Save sends it as JSON to
  `saveProductAction`, which validates it with `productInput`
  (`src/lib/product-input.ts`, shared with the browser) and `saveProduct()`
  (`src/server/products.ts`), which writes everything in one transaction.
  Prices only change through `commerce.set_price`; variants taken out are
  switched off, never deleted. Pictures are shrunk to WebP in the browser
  (1600 px plus a 480 px thumbnail) and uploaded with `uploadImageAction`.

## Checkout (`src/server/checkout.ts`, decision D16)

- Checkout (`src/server/checkout.ts`, decision D16): `placeOrder()` turns an
  open cart into a `pending_payment` order at current prices and holds stock
  under row locks (`inventory_reservations`); `startCheckout()` then opens a
  Stripe Checkout session as a direct charge on the store's connected account
  (`{ stripeAccount }`, decision D17), with Kaizen's fee as
  `application_fee_amount`. The Connect webhook
  (`/api/stripe/connect/{mode}`, which finds the store from `event.account`)
  and the order page (`getShopperOrder`, which asks Stripe if the webhook is
  late) both go through `applySession()`. `/api/stripe/webhook/{storeId}` only
  serves payments started with stores' own keys before Connect. Paying and cancelling are single SQL
  functions: `commerce.complete_order_payment` and
  `commerce.cancel_unpaid_order`.

## Order numbers (D141, `src/lib/order-numbers.ts`, `src/server/order-numbers.ts`) are one sequence per store, without gaps, as some countries require

- Order numbers (D141, `src/lib/order-numbers.ts`, `src/server/order-numbers.ts`) are one sequence per store, without gaps, as some countries require: only `placeOrder()` and the subscription renewal insert an order, and each takes its number from `commerce.next_document_number(store, 'order')` in the same transaction (a unit test scans the source for this). The database refuses to renumber or delete an order, or to lower, skip or re-prefix an issued series; never write code that deletes an order (cancel it) or numbers one another way, and a test that needs fewer orders cancels them. Copied orders (`C-…`) are outside it. `commerce.order_number_audit()` checks a store, and `store_checkup` reports a broken sequence.

## Shipping is one flat rate per market (`commerce.shipping_rates`), optionally free above a basket value; a store with a carrier connected can also…

- Shipping is one flat rate per market (`commerce.shipping_rates`), optionally
  free above a basket value; a store with a carrier connected can also offer its
  services at checkout next to it (D135).

## Stripe Connect (`src/server/connect.ts`, `src/server/stripe.ts`)

- Stripe Connect (`src/server/connect.ts`, `src/server/stripe.ts`): Kaizen's
  platform keys come from `STRIPE_SECRET_KEY_{TEST,LIVE}` and
  `STRIPE_PUBLISHABLE_KEY_{TEST,LIVE}` (`platformStripe(mode)`). Each store
  gets an Accounts v2 account (full Dashboard, Stripe-owned fees and losses,
  merchant + customer configurations) in `commerce.stripe_accounts`, whose
  copied status (`card_payments`, `requirements_due`) decides whether checkout
  is on. Owners onboard with Stripe's embedded components
  (`StripeAccountPanel`, loaded only on the pages that show it); the thin
  account webhook (`/api/stripe/connect/{mode}/accounts`) keeps the status
  current. Never pass `payment_method_types`: stores choose methods in their
  own Stripe Dashboard. In test mode the owner does nothing: `ensureTestAccount()`
  creates the store's test account with Stripe's test values (decision D20),
  in the background from the store admin layout, on the Payments page, or at
  checkout.

## Withdrawals and returns (D153, `docs/returns.md`, `/s/{store}/{market}/withdraw`, `/admin/{store}/returns`)

- Withdrawals and returns (D153, `docs/returns.md`, `/s/{store}/{market}/withdraw`, `/admin/{store}/returns`): the withdrawal function is two steps and a durable-medium acknowledgement (`src/server/withdrawals.ts`, `confirmWithdrawal()` sends the email in the same request; a failed email never undoes the withdrawal), the physical return is `returns` (`src/server/returns.ts`: lifecycle in `src/lib/return-status.ts` and mirrored by the database's rules, forward only; a withdrawal return is never declined or cancelled), eligibility and the 14-day clock are only `lineEligibility()`/`withdrawalWindow()` (`src/lib/withdrawal.ts`: the period counts from a recorded receipt, never an estimate), and the refund amount is only `refundFor()` (`src/lib/return-refund.ts`) paid through `refundOrder()`, never a second Stripe path (claimed on the return first). Never ask a reason for a withdrawal, never email an address the shopper typed (the order's own address), never answer differently for a wrong email or order number, set no cookie or storage there, and count abuse by hashed keys in the database, not by IP. `placeOrder()` keeps who pays return shipping and the standard delivery cost on the order (so refunds agree with what was shown); a new money read here needs a euro scenario. Every consumer text is hand-written and needs legal review; new tables are `never` in `COPY_RULES` except `return_settings`. A booked service keeps the right unless its product is `dated_service` (D407): its 14 days count from the order (`serviceEligibility()`), withdrawing cancels its booking, the express request is `orders.service_request_at` (recorded, never required by the server) and a part already provided is `serviceShare()`.

## Tax profile and VAT engine (D157, `docs/wave-1a-tax.md`, `src/lib/vat.ts`, `src/lib/vat-treatment.ts`, `src/lib/ioss.ts`,…

- Tax profile and VAT engine (D157, `docs/wave-1a-tax.md`, `src/lib/vat.ts`, `src/lib/vat-treatment.ts`, `src/lib/ioss.ts`, `src/lib/tax-profile.ts`, `src/server/tax-treatment.ts`, `src/server/vat-checks.ts`, `src/server/vies.ts`, `src/server/vat-admin.ts`, `/admin/platform/vat`, `/admin/{store}/settings/tax`): VAT categories are rows (`commerce.vat_categories`; a product's `vat_category` is a foreign key); rates are `commerce.vat_rates` with validity dates, source, checked-on date and a verified flag, written only by `commerce.set_vat_rate()` (audit-logged, never edited in place) and read only through `commerce.vat_rate(country, category, at)` (`vat-readers.test.ts` scans the source); no row means the standard rate, and shipping takes the standard rate unless a person verified a country's rule (`shipping-vat.ts`). Never read `vat_rates` or `countries.standard_vat_rate` elsewhere. The store's registration is `store_tax_profile` (settings in `COPY_RULES`; `duplicate_store()` blanks the numbers, `clone_store()` copies none). What VAT an order carries is only `vatTreatment()` (pure, one reason code per refusal) through `decideTax()` in `tax-treatment.ts`, which `cartSummary()` and `placeOrder()` both call; a new money read needs a euro scenario in `checkout-kinds.int.test.ts`. Reverse charge: a private buyer, the seller's own country, a booking, subscription or host listing, goods sent from outside the EU or from the delivery country, a seller number not checked valid, a stale check or a number for another country all charge VAT; the VAT not charged is `orders.vat_relief_minor` inside `discount_minor` (like D130 credits), the order keeps `vat_kind`, the check and both numbers, and Stripe gets net amounts at quantity 1 with no coupon. IOSS marks only private buyers' shipped goods of at most 150 EUR sent from outside the EU to a listed market; downloads are no consignment. VIES (`vies.ts`) is reached only through an injectable fetch with the one constant host, 4 s, one retry; never call it while placing an order; its failure never blocks and never exempts; limits are taken atomically from `commerce.chat_usage` (buckets `vies:*`: cart 10, client 20, store 60 plus a reserve of 30, owner pool 20, per clock hour); answers are logged in `vat_checks` (24 h cache), and `pruneVatChecks()` clears carts' numbers 30 days after the cart ends, then old checks. A buyer's number and VIES's answer never appear in anything public. Consumer VAT texts (`vat-text.ts`) are hand-written nb/sv/da/en, flagged for legal review, and kept out of the AI catalogue.

## Legal pages and terms at checkout (D158, `docs/wave-1-trust.md`)

- **Legal pages and terms at checkout (D158, `docs/wave-1-trust.md`)**: a store's terms, privacy, returns, shipping, withdrawal-information, imprint and accessibility pages are *linked roles* (`LEGAL_ROLES` in `src/lib/legal-roles.ts`, rows of `page_roles`, served at their own address, in the sitemap when published, never A/B tested, `isLegalPage()`); starters are made as drafts from `legalFacts()` by `legalStarter()` (`src/lib/legal-starters/{nb,sv,da,en}.ts`, hand-written, never AI, each with the `legal-review-notice` row and `[[placeholders]]`, which the builder's checker blocks publishing over, in every language of the page). Never link the EU ODR platform (repealed). `stores.terms_at_checkout` (`link`, `checkbox`, `off`) draws the `checkout_terms` piece (and `CheckoutPayment` when the page has none); the pay press calls `recordTermsAcceptance()` before Stripe's `confirm`, writing `order_terms` and the immutable `legal_snapshots` (never columns on `orders`; copied orders refuse). A new legal kind is a role, a starter in each language with its `REQUIRED_TOPICS`, and an entry in `LEGAL_REVIEW_MANIFEST`. Where no payment page follows (an order on terms, gift cards that pay it all, a booking paid wholly at the venue, D379) the cart shows the sentence and records it through `startCheckout()`'s `recordTerms` before the order is confirmed; a subscription's renewal reads its first order's record (`termsForOrder()`), and the order confirmation links each accepted text (`termsBlocks()`). Every text needs human review; the row stays partial until one has.

## Pay routes (D158, `docs/pci.md`)

- **Pay routes (D158, `docs/pci.md`)**: `/cart`, `/checkout` and `/order` send `checkoutCsp()` (`next.config.ts` `headers()`, every address shape, with and without the market (D181); `CSP_ENFORCE` is the one-line Report-Only fallback), draw nothing from `OffPayRoutes` (consent manager, owner code, chat, affiliate capture, business popup), and are entered by full page loads (`PayRouteGuard`, a scan test); the checkout page may not hold an `html` or embed-video block. A test fails if the layout or a pay route imports a module in `FORBIDDEN_ON_PAY_ROUTES`. Never add a script origin to the policy without a reason in `docs/pci.md`. Keep zod out of the pay routes' client bundle (its JIT probe is reported as a CSP violation) or set it jitless there; the SAQ A is the company's. Every path also sends the site-wide `Content-Security-Policy-Report-Only` (D389, `siteReportOnlyCsp()`, no nonce: the pages are prerendered), reported to `/api/csp-report` and counted as `csp.violation` log lines only (`cspViolations()`: directive, blocked origin, area), so a new origin a page loads is named there; the failing-job alert is `alertFailingJob()` (`src/server/cron-alerts.ts`), and security events (`admin_sign_in.*`, `auth.permission_refused`) are `log()` lines with ids only.

## Checkout branding (wave 7 unit C, D337, `docs/wave-7-storefront.md` C)

- **Checkout branding (wave 7 unit C, D337, `docs/wave-7-storefront.md` C)**: Stripe's payment form is drawn only by `stripeAppearance()`/`stripeFonts()` (`src/lib/checkout-appearance.ts`: no zod, types only from the theme, held by `pay-routes.graph.test.ts`) from the plain data `checkoutAppearanceFor()` (`src/lib/checkout-look.ts`) works out on the server from the theme: each colour set's colours, the body font's stack and our own stylesheet (`/api/fonts/css/{slug}?…&for=stripe`, on the page's own origin, never a font host's), the fields' corners from the theme's field corners and the buttons' from its button corners, in pixels. The checkout's own choices are `ThemeSettings.checkout` (`CheckoutLook`; the logo's switch is `mark`, as a theme holds no `logo`), edited in the theme editor's *Checkout look* card and saved with the theme; the page's pay button reads them through `themeCss()`'s `--checkout-*` variables under `.checkout-look` (globals.css), which the checkout section draws around the payment form. A new checkout choice is a key of `CheckoutLook` and its schema, read in `checkoutAppearanceFor()` (and `themeCss()` where the page draws it), a field in the card, words in the `design` catalogues and a case in `checkout-appearance.test.ts`; never a new origin in the pay routes' policy for it.

## Invoices and credit notes for shop orders (D159, `docs/wave-1b-invoices.md`)

- Invoices and credit notes for shop orders (D159, `docs/wave-1b-invoices.md`): an invoice is issued **only** by `commerce.issue_order_invoice()` inside `commerce.complete_order_payment()` (a sub-block: a failure rolls back only itself and never stops the payment) and a credit note **only** by `commerce.issue_credit_note()`, which a deferred constraint trigger runs at commit for every refund that becomes `succeeded`, by any path (`refundOrder()`, the Stripe `refund.created`/`refund.updated` handler `applyStripeRefund()`, D153 returns, a refund made in Stripe, raw SQL), and for a return refunded outside; never write code that inserts into `invoices` or `credit_notes` (a scan test), numbers one another way, or deletes or edits one (the database refuses; only a one-time `pdf_path` and `anonymise_expired_documents()` may change a row). A new refund path needs no call but must be listed in the enumeration of spec 2.6 and tested. Documents are the snapshot (`src/lib/invoice-snapshot.ts`: `buildInvoiceSnapshot()` is the oracle `invoice-parity.test.ts` holds the SQL to), drawn only from it by `OrderDocumentView`; a credit note never exceeds the invoice per rate (`creditAllocation()`, `creditVatConverted()`, `src/lib/credit-allocation.ts`) and a refund of a payment that is not on the invoice (a no-show fee) gets none (`payment_on_invoice()`). Copied (`C-…`), host, Stripe-test-mode (`payments.test_mode`) and invoicing-off orders get none; a store with incomplete details, a non-VAT-registered seller whose order charged VAT, or no exchange rate waits (`invoice_eligibility()`, `issueWaitingInvoices()`, the five-minute job). The VAT in the seller's currency is `vatHome` (`homeVatRequirement()`); `vatMain` and `buckets[*]` are what unit 1c reads. A new money read here needs a euro scenario in `checkout-kinds.int.test.ts` (it checks the invoice and its credit notes). A PDF is `renderToStaticMarkup()` of the same view loaded into Chromium with every request refused (`src/server/invoice-pdf.ts`; Chromium only there, the two PDF routes and `/api/cron/document-pdfs`, each in `outputFileTracingIncludes`), stored once in the private `documents` bucket, the print page the fallback. The hosted page is `/s/{store}/{market}/account/documents/{token}` (token `inv_`/`crn_`, no cookie, noindex, no tracking or chat extras: `isNoExtrasPath()`). Admin: `/admin/{store}/invoices` (`orders:read`; CSV and *Check again* `orders:write`), `/admin/{store}/settings/invoices` (owner). Invoicing is off for stores with live history until the owner turns it on. All consumer wording is `src/lib/invoice-text.ts`: hand-written, flagged for review, never in `i18n.ts` or the AI catalogue. A document as EN 16931
  UBL (D403) is only `invoiceUbl()`/`creditNoteUbl()` (`src/lib/einvoice.ts`) over its snapshot, never a figure worked out again: one that would not
  add up is refused with its reason (`documentUbl()`).

## Unit price (D160, `docs/wave-1d-unit-price.md`, `src/lib/unit-price.ts`, `unit-price-rules.ts`, `unit-price-text.ts`, `unit-price-editor.ts`)

- Unit price (D160, `docs/wave-1d-unit-price.md`, `src/lib/unit-price.ts`, `unit-price-rules.ts`, `unit-price-text.ts`, `unit-price-editor.ts`): a goods variant's `measure_amount`/`measure_unit`/`measure_base` (the pack's total and the owner's preferred base) become the price per kg, litre, metre, m2 or piece beside every price. The per-measure figure is **only** worked out by `unitPrice()` (BigInt, half up to the minor unit) and asked for through `unitPriceShown()`, from the price **as the surface shows it** (after `shown()` for the currency and the VAT display, `withoutVat()` first for a business buyer). It is never converted from another currency's unit price and never taken from `referenceMinor`. It is `null` when it equals the price, the price is 0 or it rounds to nothing, and it never changes a total. `checkout-kinds.int.test.ts` holds it in every scenario through `expectUnitPrices()`, euro included, and `unit-price-readers.test.ts` keeps the arithmetic in one file. `order_lines.measure_*` is a frozen snapshot copied by `placeOrder()`, the subscription renewal and `copy_orders()`, so the order page, checkout, emails and subscription page never read the variant; the cart reads the variant live. Naming: `unitPriceMinor` is the price per item; the per-measure figure is `unit` or `measure`, never `unitPrice` as a field. Which base a market shows is `effectiveBase()` from `UNIT_PRICE_COUNTRY_RULES`: no country allows 100 g or 100 ml today (Germany, Norway and Sweden read, Denmark unread and closed), and the market's country decides, not its language or currency. Tests open a country with `allowSmallBase()` and restore it. Required: `commerce.unit_price_required()` (product `sold_by_measure`, or a product category or ancestor with `requires_unit_price`) and the deferred trigger `check_unit_price()` refuse an active product without a measure on an active physical goods variant, and a measure on a service or download; a category marked later grandfathers, reported by `productsNeedingMeasure()`. Basket-level reductions never change the line's unit price. Draw it with `<Price>` (its unit line), never by hand; a new surface that shows a price per item shows the unit price too, and a new money read needs a euro scenario. JSON-LD uses `priceSpecification` (`UnitPriceSpecification`, `referenceQuantity`, `valueReference`), not `unitPricingMeasure` (a feed attribute, wave 5). Words are in `m.unitPrice` (nb, sv, da and en by hand). No new table, so nothing new in `COPY_RULES`; `clone_store()`, `duplicate_store()` and `copy_orders()` are patched. Every rule that comes from a law is flagged for review.

## VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`, `/admin/{store}/analytics/tax?view=vat|oss|ioss`, `src/lib/tax-*.ts`, `oss-return.ts`,…

- **VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md`, `/admin/{store}/analytics/tax?view=vat|oss|ioss`, `src/lib/tax-*.ts`, `oss-return.ts`, `ecb-history.ts`, `src/server/tax-reports.ts`, `tax-reconciliation.ts`, `tax-report-exports.ts`, `ecb-rates.ts`)**: the owner's data for their accountant, never a tax return or a filing; the page and every file say so. Reports read documents only (invoices and credit notes, D159) through the one reader `commerce.tax_document_groups()`; never recompute VAT from orders. An order with no document (invoicing off, waiting, test mode) is counted and itemised in the reconciliation by cause, never added. Delivery country is `orders.market_code`. Dispatch country, seller country and member state of identification are frozen on `orders.vat_treatment` (`dispatchCountry`, `sellerCountry`, `ossMemberState`; a live-profile fallback is counted as assumed), so editing the store later never moves a filed period. Where a sale is reported is only `classify()` (`tax-classes.ts`: Union 2a, 2b, 2d, non-Union NU, IOSS, national, or a named reason it is in no return); a non-EU market is the store's national return only when the store is established there, else `non_eu_market_foreign`. Euro figures of OSS and IOSS convert from the document's own currency, once per group in BigInt, at the ECB reference rate of the period's last day or the next publication day (`commerce.ecb_reference_rates`, append-only, filled by the daily job; the owner's audited override in `tax_rate_overrides`); never at today's rate and never through `vatMain`, which is used only for the main-currency VAT table. A missing rate makes the return incomplete and the return CSV is refused. Books mode counts a credit note in its own period; filing mode nets same-quarter credits and makes later ones Part 3 corrections of the original period, and negative Part 4 balances are not in Part 5. Part 2b and 2d are totalled per Member State of dispatch. The reconciliation ties the report to Finance's `periodTotals().vatMinor` and to sum(`tax_minor`) of PAID orders by named, counted causes, exact per currency; the page, the AI tools and exports read it in one REPEATABLE READ snapshot (`taxSnapshot()`). CSV layouts are fixed (`tax-csv.ts`, formula-safe, the reconciliation has a direction column); exports are POST with `analytics:write`, logged in `tax_report_exports` with a drift line; ECB rate fetch and override are owner-only, and ECB fetches are limited to 10 an hour per store and 60 in all (`takeEcbSlot()`, `chat_usage` bucket `ecb:fetch`). The AI manager's `vat_report` and `oss_return_data` are read-only and ungated. A new part of a return is a case in `classify()` with a test and a row in spec 4.3; a new money read gets a euro scenario. The classify() rules, the dating by payment day (Directive Art. 63 and 65, not 66a) and the euro conversion need an accountant before real use. The EC Sales List and national return mapping are not built (wave 2). Scheme users keep records 10 years (`retentionCutoff(..., { scheme })`).

## Inventory (wave 3, D172, `docs/wave-3-inventory.md`)

- **Inventory (wave 3, D172, `docs/wave-3-inventory.md`)**: stock is `inventory_levels` per variant and location, and every change of it is an append-only row of `inventory_movements` written by a trigger (reason, source, account, order, return), with the why passed by `withStockContext()` (`src/server/stock-context.ts`; `stock-writers.scan.test.ts` fails for a writer without it). Never write a level another way, and never edit or delete a movement (the guard refuses; only `pruneInventoryMovements()` removes any older than 24 months, and the newest of each level stays). Stock is read only through `commerce.variant_availability` (`getVariantStock()`), never `available_stock` directly (`inventory-readers.test.ts`); `in_stock` floors each location at zero as `allocate()` does. A variant with `stock_policy = 'continue'` (physical only, `backorder_days` 1 to 90 required) may go below zero and nothing else may (trigger). `placeOrder()` allocates with `allocate()` (`src/lib/stock-routing.ts`: keep an order together, else by location rank, the backordered remainder at the first location that stocks the variant) and locks level rows in (variant, location) order. `commerce.draw_order_stock()` (inside `complete_order_payment()`) keeps each checkout's physical claim (`inventory_reservations.backorder_quantity` is the part beyond stock) and writes `order_lines.backorder_quantity`. Refunds, cancels and returns restock through `restockPlan()`/`restockRoom()` (never above what the order took) to the original location or one staff choose. Backorder wording is `m.backorder.*` and `emailText().backorder`: hand-written nb, sv, da and en, flagged for legal review, never machine-translated (`HAND_WRITTEN_ONLY` in `src/lib/ui-catalog.ts`); policy and days are read per request, never in a `'use cache'` function; a gift or a weekly box is never backordered (`noBackorder`). Locations: staff add, rename and rank, owners deactivate (`locationImpact()` first; refused while checkouts hold stock there or for the last active one), never delete one. Low-stock level per variant: `stock_alerts` and `sendLowStockNotices()` (one digest email per store per run, one per crossing; a variant created or set at or below its level is a crossing at once, read as not yet told by `untold()`/`UNTOLD_SQL`, D370). Stock files are D165 jobs (`inventory_import`, `inventory_export`); `on_hand_was` (written by the export, D370) makes a row a conflict when the stock moved. Transfers and purchase orders (wave 11 unit D1, D383) are written only by `src/server/stock-transfers.ts` and `src/server/purchase-orders.ts` (movements `transfer_out`/`transfer_in` and `received`, the document as `job_id`; the database moves both only forward, `stock_documents_rules()`); a variant's cost changes are kept by the trigger `variant_cost_keep()` in `variant_cost_history` (a writer naming its source sets `kaizen.cost_source`); a location with `fulfils_online` off is left out of `variant_availability` and `allocate()`, so a new reader of a store's sellable locations asks `active and fulfils_online`. Which location an order takes from first is `allocateStock()`'s `order_settings.stock_routing` (`rank`, or `nearest` through `routingOrder()` given the delivery country); a new caller passes the market's country. A read of a cart's or an order's lines takes the cart's lines first (`cartLinesFirst()`), never a filter the planner may scan the catalogue for. New money reads here need a euro scenario in `checkout-kinds.int.test.ts`; a new stock reason widens the `inventory_movements` check and `MOVEMENT_REASONS`; `inventory-perf.int.test.ts` guards the reads and the 20-line order (note: flaky on a busy or long-lived database). A pre-order (D396) is a variant that keeps selling with a release date (`preorder_until`): whether it is one is only `variant_availability`'s `preorder_until` (the date while in the future) through `availabilityOf()`, its words only `m.preorder` with `releaseDate()`, the order line keeps the date, and *To send* leaves out what waits for it (`PREORDER_WAITING`), so a new place that shows a variant's stock or an order line's backorder asks the same. With several active locations the product editor sets each one's level (D397, `VariantInput.locationStock`, each figure beside what was read): `writeStock()` writes only a changed figure to an active location of the store's own, so a new writer of a variant's levels from a form sends what it read too.

## Orders: list, tags, archive, drafts, gift (wave 3, D173, `docs/wave-3-orders.md`)

- **Orders: list, tags, archive, drafts, gift (wave 3, D173, `docs/wave-3-orders.md`)**: the Orders page's state is its address, parsed only by `parseOrderListParams()` (`src/lib/order-list.ts`; unknown keys dropped, invalid values ignored) and turned into SQL only by `orderListWhere()` (`src/server/order-list-sql.ts`: the list, the count, the bulk "all matching", saved views and the AI tool); never build a list condition elsewhere. Search matches number, email, name, line title and SKU, tag and tracking number, with `restricted_at is null` on email and name (D162) and every `LIKE` word escaped and bound; paging is keyset, and the total sort compares converted totals (`valueFactors()`), never `total_minor` across currencies. Saved views are `order_views` (the store's, 30 at most, `title` not `name`); bulk actions (`runBulk()`, 250 at most) run order by order and report each refusal; the actions behind the screen are `list-actions.ts` and `ops-actions.ts` (`orders:write`, held by `order-actions.int.test.ts`). Tags are `order_tags` (`normaliseTag()`: 40 code points, 250 per order, case-folded key; the history event carries the words in `data.note` so erasure covers it); archive is `orders.archived_at`, a visibility flag set only by `src/server/order-archive.ts` under `archiveBlock()`; both work on copied orders (the two copied-order guard functions allow exactly `archived_at` and three event types). **Orders are inserted and numbered only in `src/server/order-insert.ts`** (called by `placeOrder()`, the renewal and `placeDraftOrder()`; a scan test). A draft (`draft_orders`) is priced only by `priceDraft()` (`src/lib/draft-order.ts`, built from `decideTax()`, `basketShipping()`, `allocate()` and half-up rounding; equal to `cartSummary()` for the same goods) and becomes an order when **sent** (order `pending_payment`, `source = 'draft'`, stock held to the draft's expiry, tags carried over); sells goods and custom service items only (a custom item is for businesses until the legal review, `custom_consumer`; the delivery address must be in the market's country). The buyer pays through `/s/{store}/{market}/account/pay/{token}` (token kept only as a hash, only under the order's own market, Stripe's **hosted** session with an idempotency key per press, `isNoExtrasPath()`); `applySession()` never cancels a draft's order on a session expiry, `expireDrafts()` does at the draft's expiry; a Stripe session is closed only when Stripe says it is gone (`settleOrderSessions()`). Money taken outside Kaizen is a `payments` row with `provider = 'manual'`, a method and `received_on` (owner-only unless `order_settings.staff_mark_paid`; cash ceilings are data in `cash-limits.ts`, `verified: false`), the invoice says `paid_outside` and a staff discount is its own invoice kind, and a refund of it is a `refunds` row recorded `succeeded` with no Stripe call, capped under the order lock and by `refunds_manual_cap`; never add a reader of `payments.provider` outside `payment-readers.scan.test.ts`'s list. No campaigns, codes, credits or VAT-number checks on a draft; no AI tool records a payment; the gated `send_draft_order` sends only the version the owner was shown. A staff-made order counts everywhere except conversion, the funnel and channels (`docs/analytics.md`). Gift messages (`order_settings.gift_messages`, default off): `carts` and `orders` carry `is_gift`, `gift_to`, `gift_from`, `gift_message`, cleaned by `cleanShopperText()` (`src/lib/gift.ts`, no zod: the cart is a pay route), refused not cut, frozen by a trigger, shown to the buyer, staff and the price-free slip, never in `sendShipped()` and never emailed to anyone but `order.email` (`gift-shipping.int.test.ts`). New words are hand-written and flagged (`HAND_WRITTEN_ONLY`); consumer texts need legal review.

## Fulfilment and order editing (wave 3, D174, `docs/wave-3-fulfilment.md`)

- **Fulfilment and order editing (wave 3, D174, `docs/wave-3-fulfilment.md`)**: shipments are written only by `markSent()`, which always writes `shipment_lines` (no lines = everything still to send; older shipments are `legacy`), and the database refuses a parcel that is not legacy and has no lines at commit (`shipments_have_lines`, a deferred constraint trigger: write a shipment and its lines in one transaction). Units still to send are read only through `toSend()`/`commerce.line_to_send()` (quantity − shipped − withdrawn − closed: withdrawal returns only, `withdrawn_quantity()`; units staff closed as never to be sent, `commerce.unsent_closures`, append-only, written by `refundOrder({ notSent })`), never computed elsewhere; a closed unit is counted as taken for withdrawals (`loadFacts()`). An order stays `paid` while *Partly sent* and becomes `fulfilled` only through `refresh_fulfilment()`; `markDelivered()` needs it sent in full, and each parcel has its own email listing its lines. A parcel is undone, never deleted, only by `undoShipment()` (`commerce.undo_shipment()`, under the order's lock; refused after a return or withdrawal made since the parcel, while a change waits for payment, on a copy or an order that is not paid or sent): an undone parcel (`shipments.undone_at`) counts nowhere (what is sent, the order's state, slips, labels, emails, the list, the shopper's page, the AI tools: a new reader of `shipments` filters `undone_at is null`), a `fulfilled` order goes back to `paid`, the receipt date is cleared, and a carrier's booking is not cancelled at the carrier (staff are told) nor is the customer emailed. An order's lines and amounts change after `pending_payment` **only** inside `applyOrderEdit()` and the change payment (`src/server/order-edits.ts`, edit context `kaizen.order_edit`; triggers refuse anything else; `order-edit-writers.scan.test.ts`): sold units keep their price and discounts (`splitLine()`), added goods are priced by `priceOrderEdit()` with `shown()` and `decideTax()` and equal `cartSummary()`, a lower total is claimed under the order lock before Stripe is asked and refunded through `refundOrder({ within: tx })`, a higher total applies only when the customer pays the link (`/s/{store}/{market}/account/change/{token}`, Stripe's hosted page; `applySession()` branches on `payments.order_edit_id`) or staff record it paid outside Kaizen under D173's cash ceiling (`checkEditCash()`). Never charge a saved card for a change and never renumber (D141). `refundOrder()` splits any refund over the order's captured payments (`splitRefund()`); a new refund path goes through it. Only orders `editBlock()` allows are edited. What a change's failed refund still owes is only `EDIT_REFUND_OWED_SQL` (the order page, the checkup, the control center's `editRefundsOwed` and the Orders filter `ship=edit_refund_owed`, D392). A carrier booking (Bring, Helthjem, Porterbuddy) takes the order's booking lock without waiting (`oneBookingAtATime()` in `src/server/carrier-booking.ts`, D372), checks the parcel under it (`bookingPrecheck()`, with the fulfilment the page showed as `seen`) before the carrier is asked or paid, and sends the parcel's own reference (`parcelReference()`, Porterbuddy's idempotency key); *Book labels* on the Orders list (D374, `src/server/bulk-labels.ts`) books through the same functions only, and a new carrier's booking does the same. A change issues documents only through `commerce.issue_edit_documents()` (an edit credit note and a `kind = 'order_edit'` invoice referring to the original); the order's documents are one pool for later credits; a change's refund gets no credit note and is not a refund in analytics; a late change payment is refunded in full and moves no bonus or affiliate credit (`commerce.payment_of_order()`). Slips print what is still to send (`packingSlipData()`) or one parcel (`parcelSlipData()`); the pick list is `pickList()` (`src/lib/pick-list.ts`). The change emails, the pay page, the parcel words and the edit documents are hand-written nb, sv, da and en (`HAND_WRITTEN_ONLY`), never tell a business buyer of a statutory withdrawal right, and need legal review.

## Shipping methods, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md`)

- **Shipping methods, pickup and local delivery (wave 3, D237, `docs/wave-3-shipping-methods.md`)**: **Methods.** A market's shipping is its methods (`shipping_methods`, rates in `shipping_method_rates` per zone and profile), priced only by `methodPrice()`/`deliveryOffer()` in `src/lib/shipping-methods.ts`. Tiers count the minimum and not the maximum, a mixed basket pays the sum per method, a zone with no rate for a profile offers no method, and goods without a weight weigh the store's default per unit (`shipping_settings`). **Flat rate.** The flat rate (`shipping_rates`) is the fallback, and the only shipping of subscriptions, weekly boxes (`placeOrder({ flatRateOnly })`) and drafts. **Zones, pickup, local areas.** Zones are postal patterns (`src/lib/postal-patterns.ts`, most specific wins). Pickup is per place (`pickup_options`). Local delivery is per area (`local_delivery_areas`); a radius is measured between `postal_points` centres, never by calling a geocoder. **The cart's choice.** The cart holds one choice. `chosenDelivery()` is still the one reader for `cartSummary()` and `placeOrder()` and re-prices on every read; `delivery-readers.scan.test.ts` lists who may read the rate tables. A new money read here needs a euro scenario in `checkout-kinds.int.test.ts`. **Refunds.** The standard delivery for refunds is `standardShippingMinor(offer)`, the cheapest option actually offered. **Handovers.** A handover is a `shipments` row of method `pickup` or `local`, written through `markSent()` by `markCollected()` (which also sets `delivered_at`; today before noon means now) and `markOutForDelivery()`. Pickup and local orders are never in *To send*. **Postal-code mismatch.** Never re-charge a postal-code mismatch: `flagDeliveryMismatch()` sets `orders.delivery_mismatch_at`. The event's codes are personal data, which `anonymise_order()` removes. **Places and copying.** A place with a pickup option or an area is not deleted while orders wait at it. New tables are `settings` in `COPY_RULES`. **Legal texts.** The legal starters show an `[[Add: …]]` placeholder for a market that methods price, never the fallback flat rate alone.

## Customer notifications, tracking and staff alerts (wave 3, D238, `docs/wave-3-notifications.md`)

- **Customer notifications, tracking and staff alerts (wave 3, D238, `docs/wave-3-notifications.md`)**: the order and return emails are `NOTIFICATIONS` (`src/lib/notifications.ts`); every sender of one asks `notificationOn()` (`src/server/notifications.ts`, the only reader of `notification_settings` and `email_templates`) before an automatic or `notify` send, and required ones (confirmation, renewal, change, withdrawal acknowledgement, return decisions) cannot be off, also in the database; a refund email switched off still lets its credit note go out (`sendPendingDocumentNotices()`, `refundEmailOffSql()`). Owner text is only the subject, heading and intro of a notification per language, applied by `withTemplate()` with placeholders filled by `fillTemplate()` (`src/lib/email-template.ts`) after `templateProblems()` (named placeholders only, no web address by shape, no claim), checked again at send; the blocks the law and the money need stay the code's, and a missing slot is the fixed text of the order's language, amounts in the order's own currency; copied with a store only with *Email texts* (copy group `emails`). A new notification is an id in `NOTIFICATIONS`, `EMAIL_KINDS`, the database checks and its sender's `notificationOn()`. Carrier events are polled into `shipment_tracking` (`pollTracking()`, five-minute cron; parcels older than 30 days stopped, events pruned 90 days after), mapped by `phaseOf()` (`src/lib/tracking-phases.ts`: only a `verified` code, Bring's today, sends an email or records a delivery; a Bring consignment of several packages is delivered only when all are, `parseTracking()`), and shown to shoppers from the stored rows (`ParcelTracking`), never fetched while a page renders (the order page is a pay route); `delivered_at` from a carrier is written only by `commerce.record_carrier_delivery()` (sent in full, every parcel delivered, never before the order or over a date), and every writer of `delivered_at` sets `delivered_source`. Parcel emails and `m.tracking.*` are `HAND_WRITTEN_ONLY` until their legal review. Staff alerts read `store_events` (queued by triggers in the paying transaction, once per event, also for an order paid after it was cancelled) and go to `alertRecipients()` (members whose role may read the email, or the contact address; owners by default), with no shopper's name, email, phone or address; amounts are what was charged, with a venue balance as its own row. Rules (`order_rules`, a closed list in `src/lib/order-rules.ts`, at most 50) run once per event and log `order_rule_runs`; a held order (`orders.held_at`) cannot get a shipment (`shipments_not_held()`).

## Exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md`)

- **Exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md`)**: **What an exchange is.** A D153 return whose credit pays for a new order: `return_exchanges` and `return_exchange_lines`, with the lifecycle in the database. **Pricing and credit.** Replacements are priced only by `priceExchange()` (over `priceDraft()`, equal to `cartSummary()`, in the original order's market view, no order-level discount). The credit is only `refundFor()`'s and is never lowered. **Agreement.** It is the customer's own press on `/account/exchange/{token}` (a no-extras path; a token kept as a hash). Staff may record agreement for a voluntary return only. A withdrawal's proposal goes only by email to the order's own address, with no share link (`link_withdrawal`), and is refused once staff changed the order's email after the withdrawal (`email_changed`, `emailChangedSinceReturn()`). The once-shown share link is held by `ExchangeLinkHolder` (`exchange-link.tsx`), above the builder, so the refresh after a proposal keeps it on screen. **Processing.** `processExchange()`, offered where the refund would be, makes the order through `insertOrder()` (`source = 'exchange'`, D141), and only then is stock held. **Moving the money.** The credit moves as a `refunds.kind = 'transfer'` row and an `exchange` payment, with no Stripe call. The rest goes through `refundOrder()`'s exchange option, whose `restockIf` puts stock back once, or through a pay link to Stripe's hosted page (`applySession()` branches on `payments.exchange_id`), or is recorded as paid outside Kaizen. **Documents.** One `return_exchange` credit note per exchanged return, none for its refunds. **Later refunds.** A refund of the `exchange` payment is made at the original order's Stripe payment. A return's refund split over several payments (D174) is recorded by its first part with every part named in `kaizen.return_refund_parts` (D392), so a new writer of `returns.refund_id` that records a split refund does the same. The bonus and affiliate refund triggers count `exchange` payments in the paid base. **Return labels.** `bookReturn?()` on `ShippingCarrierAdapter` (feature `return_labels`, Bring only), booked from the return's page or by `bookPendingLabels()` for withdrawals with `label_auto`, one booking at a time under an advisory lock. The booking is kept as `returns.label_*`. The shopper's label is fetched by `/returns/{token}/label` from the carrier's own host with the store's keys, and is never stored or attached. **Label cost.** It is recorded at booking and taken off only at refund, through `labelDeduction()`: when staff confirm the parcel came with the label, the shopper pays, it is never above the cost and never for a test label. **Words and money reads.** New words are hand-written (`HAND_WRITTEN_ONLY`) and need legal review. A new money read here needs a euro scenario. **Pages that read the time.** A storefront page that reads the time calls `await connection()` inside its `<Suspense>`.

## Payment facts, risk and disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3, `src/lib/payment-facts.ts`, `src/server/payment-facts.ts`,…

- **Payment facts, risk and disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3, `src/lib/payment-facts.ts`, `src/server/payment-facts.ts`, `src/server/payment-disputes.ts`)**: what a Stripe payment was (`payments.method_type`, `wallet`, `card_brand`, `risk_level`, `risk_score`, `charge_reference`, `facts_read_at`) is read once from its charge through the store's connected account by `readPaymentFacts()` (in `after()` from `applySession()`, and `readMissingPaymentFacts()` in the five-minute job), kept as Stripe gave it through `factsOfCharge()`; an unread payment is *Unknown*, never guessed, and other providers have none (a check). A payment's method in words is only `methodGroup()`/`methodWords()`. Disputes are `commerce.payment_disputes`, written only by `applyStripeDispute()` from `charge.dispute.*` (`DISPUTE_EVENTS`, in `WEBHOOK_EVENTS`), one row per provider reference, identity fixed and a closed one kept as it closed by a trigger, never deleted; staff hear through the staff alert event `dispute` (`sendDisputeAlert()`, once per recipient, and `sendDueDisputeReminders()` three days before the deadline), never with a shopper's name or address. A lost dispute is money out in the Finance bridge (`Totals.lostDisputesMinor`, line `lostDisputes`, in the period it closed, without VAT plus the fee where known), never a refund, a credit note or a restock. Stripe's risk is shown only when elevated or highest (`riskShown()`), filtered by `pay=elevated_risk`/`pay=disputed` and the rule condition `risk` (never met while unread; `ruleFacts()` reads the charge first). *Payments by method* is a Finance section (`paymentMethodsReport()`, `paymentsByMethod()`, with VAT as the money moved, CSV `finance.payment_methods`). A new reader of `payments.provider` goes in `payment-readers.scan.test.ts`.

## Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4, `src/lib/capture.ts`, `src/server/payment-capture.ts`)

- **Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4, `src/lib/capture.ts`, `src/server/payment-capture.ts`)**: when the card is charged is the owner's `order_settings.capture` (`at_checkout`, `when_sent`, `by_hand`); which orders may wait is only `captureModeFor()`, kept on the order as `orders.capture_mode` by `prepareCapture()` in `startCheckout()` (the only session made with `captureLater`; drafts, pay links, changes, exchanges and boxes never are). A held card's order is `authorized` (between `pending_payment` and `paid`, with `capture_before`), made only by `commerce.authorize_order_payment()` from `authorizeFromSession()`; it is not a paid order anywhere (no captured payment), so a reader that means "bought" keeps asking for a captured payment or `paid`. It becomes paid only through `capturePayment()` (Stripe first, then `complete_order_payment()`; less than held is a `refunds.kind = 'release'` row for the rest, succeeded, no provider reference, credited like any refund), and ends only through `voidAuthorization()`, `applyIntentCanceled()` or `runCaptureJobs()` (`cancel_unpaid_order()`). Anything that sends or hands over goods calls `captureForSending()` first and records nothing when it fails; a carrier booking waits for the capture. A trigger that acts on `pending_payment → paid` acts on `authorized → paid` too. The order page reads `orderCapture()` (stored rows), never Stripe.

## Payouts and real fees (wave 4 unit C, D290, `docs/wave-4-payments.md` 5, `src/lib/payouts.ts`, `src/server/payouts.ts`,…

- **Payouts and real fees (wave 4 unit C, D290, `docs/wave-4-payments.md` 5, `src/lib/payouts.ts`, `src/server/payouts.ts`, `src/server/payouts-report.ts`)**: a store's Stripe payouts (`commerce.payouts`) and their balance transactions (`payout_lines`) are written only by `applyPayout()` (the `payout.*` webhook events, `PAYOUT_EVENTS`) and `runPayoutJobs()` (daily per store through `payout_reads`, in the five-minute dispatcher), for the store's own account in `stripe_accounts` only (never a host's); append-only by trigger (no delete, identity fixed, a line's tie set once, a line in its payout's currency). Whether a payout adds up is only `reconcilePayout()` (lines' net against its amount; money not tied to an order named; a manual, unpaid or incomplete payout says so, never guessed). A payment's real fee (`payments.provider_fee_minor`, `application_fee_minor`, `fee_currency`) is written once, by `writeFee()`, from the charge's balance transaction; Finance's payment fees take it for each order whose every captured Stripe payment has one in a convertible currency and the estimate for the rest (`Totals.realFeeOrders`; the label says *estimated* unless all are real), as *Payments by method* does per payment. Analytics → Payouts and one payout's page show each payout in its own currency, totals of paid live payouts in the main one (`payoutReportOf()`, a currency without a rate left out and counted); the CSV `payouts.list` has a currency per row (`rowCurrency`). A new money read here needs a euro case in `payouts.int.test.ts`.

## Payment methods per country (wave 4 unit D, D291, `docs/wave-4-payments.md` 6, `src/lib/payment-methods.ts`, `src/server/payment-methods.ts`)

- **Payment methods per country (wave 4 unit D, D291, `docs/wave-4-payments.md` 6, `src/lib/payment-methods.ts`, `src/server/payment-methods.ts`)**: the methods are `PAYMENT_METHODS` (a new one is an entry there with its Stripe type and capability); an account is made with `BASE_CAPABILITIES` and `ensureStorePaymentMethods()` asks for the rest, one at a time when refused together; Stripe's state of each is `stripe_accounts.method_states` (`capabilityStates()` in `saveStatus()`), shown by `PaymentMethodsCard`. The owner's switch is `commerce.payment_methods` (`enabled = false` is off, no row is on, cards always on), written only by `saveMethodChoices()`, and a country's checkout leaves out only `excludedPaymentMethods()` in `excluded_payment_method_types` (`openPaymentSession()`, for the order's own country); never pass `payment_method_types`. A completed unpaid session with no card held is a bank payment on its way: only `awaitBankPayment()`/`commerce.await_bank_payment()` makes the order wait (`orders.awaiting_bank_since`, stock and booked times held `BANK_WAIT_DAYS`), and it stays `pending_payment`, not a sale, until `async_payment_succeeded`; `OrderView.awaitingBank` is what pages say.

## Express checkout and wallets (wave 10 unit J, D373, `src/lib/express-checkout.ts`, `src/server/express-checkout.ts`)

- **Express checkout and wallets (wave 10 unit J, D373, `src/lib/express-checkout.ts`, `src/server/express-checkout.ts`)**: the express area on a
  product page and in the cart (`ExpressArea`) is a button until pressed; the press is only `expressCheckoutAction()` (a product page's variant put
  in the cart by `addToCart()`), then `startExpress()`: `expressFits()` (goods sent by post, bought once), `deliveryReady()`, and the order and
  session made by `startCheckout()`, never another path; Stripe's element (`express-panel.tsx`) loads only then and confirms after the checkout
  page's steps. It is offered only where `expressOn()` says; Klarna's line (`KlarnaMessage`) only where `klarnaMessaging()` says. Each web
  address's wallets are `stripe_accounts.wallet_domains`, written only by `checkWalletDomains()` (Payments page, owners). A new place that offers
  express payment asks `expressOn()` and `expressFits()`, and a new kind of line a wallet's sheet cannot ask about is refused by `expressFits()`.

## Payment providers (wave 4 unit E, D292, `docs/wave-4-payments.md` 7, `src/lib/payment-providers.ts`, `src/server/payment-providers/`,…

- **Payment providers (wave 4 unit E, D292, `docs/wave-4-payments.md` 7, `src/lib/payment-providers.ts`, `src/server/payment-providers/`, `src/server/payment-outcome.ts`)**: what becomes of an order from its payment is decided once, for every provider: the provider's answer is a `PaymentAnswer` (`open`, `paid`, `unsettled`, `failed`, `expired`, who paid), `paymentFate()` decides and `applyPaymentAnswer()` acts (Stripe's `applySession()` only makes the answer, `stripeAnswer()`, and passes Stripe's own steps as hooks). Anything done to a payment already taken goes to its own provider through `providerOf()` (`refresh()` for the late read, `close()` for an open payment, `refund()` for each refund part); never call a provider's API for a payment from elsewhere, and a new provider is an id in `PAYMENT_PROVIDERS` and a `PaymentProvider`. Mollie (E2, `src/server/mollie.ts`, `src/server/payment-providers/mollie.ts`, `src/lib/mollie.ts`): a store's connection is `mollie_connections` (OAuth by the owner, tokens encrypted, written only by `src/server/mollie.ts`, which makes every call to Mollie through `mollieCall()` with an injectable fetch) and its checkout's provider per mode `checkout_providers` (`checkoutProviderOf()`); Mollie's page asks for no address, so a Mollie cart asks who pays first (`cleanPayer()`, no zod) and the order keeps it; a webhook names only an id and the payment is always fetched from Mollie (`handleMollieWebhook()`), its refunds through `applyRefundReport()` and chargebacks through `writeDispute()` (the writers Stripe's use); a Mollie payment keeps its mode in `payments.test_mode` (a test payment never gets an invoice number); what only Stripe does (subscriptions, deposits, hosts, boxes, pay links) stays Stripe's; never send Mollie card data or open a Mollie frame on a pay route.

## Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8, `src/lib/payment-terms.ts`, `src/server/payment-terms.ts`)

- **Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8, `src/lib/payment-terms.ts`, `src/server/payment-terms.ts`)**: who may buy on terms is only `termsOffer()` through `decideTerms()` (the business feature, a signed-in owner or employee of an active company with `payment_terms`, goods bought once only, the credit limit in `credit_currency` with what the company owes converted at the store's rates, never guessed); `placeOrder({ terms })` checks it again under the company's row lock and writes `order_payment_terms` (`due_on` fixed, claims and `paid_at` set once, by trigger) with the whole total as `balance_minor`, and `confirmOnTerms()` completes it with a pending `terms` payment (never money: the order page's key, so every reader of that key lists `'terms'`, and what a cancellation voids). An order on terms is `paid` as a shop status but no sale until a captured payment (`PAID` unchanged): it is paid only by `settleTerms()` (`applyPaymentAnswer()`'s `terms` purpose, any later Stripe payment of an order with terms that is not an edit's or exchange's) or `recordTermsPaidOutside()`, and cancelled unpaid only by `voidTerms()` from `cancelOrder()` (a `void` refund: its credit note, no money; `NOT_EDIT_REFUND` and every refund reader leave `kind = 'void'` out). The venue's *Mark paid* (`markBalancePaid()`), order changes (`terms_unpaid`) and the `balance_due` filter leave orders on terms out; a company that owes is not deleted (`releaseCompanyTerms()`). Reminders are `runTermsJobs()` in the five-minute payment jobs (`order.payment_due`, `order.payment_overdue`, the staff alert `payment_overdue`, never a customer's name in it). Shopper and email words are `m.paymentTerms` and `TERMS_EMAIL_TEXT`, hand-written nb, sv, da and en (`HAND_WRITTEN_ONLY`), and need legal review; the invoice's are `invoice-text.ts` (`dueDate`, `termsDays`, `toPayBy`). A new money read here needs a euro case in `checkout-kinds.int.test.ts`. Since D387 a balance may be paid in part (`applyTermsMoney()`: money outside with an amount, or a payment; paid when it reaches zero), *Pay now* goes through Mollie for a store whose checkout is Mollie's, and an order on terms counts as a sale when its balance is paid in full (`orders.sold_at`, written only by the trigger `order_payment_terms_sold()`; `infinity` until then): an analytics reader dates a sale by `SOLD_AT` and filters by `soldIn()` (`analytics-sql.ts`), never `placed_at` alone.

## Gift cards (wave 5 unit F, D300, `docs/wave-5-marketing.md` 8, built in steps; F1 the model, F2 selling, F3 spending, F4 the owner's screens and…

- **Gift cards (wave 5 unit F, D300, `docs/wave-5-marketing.md` 8, built in steps; F1 the model, F2 selling, F3 spending, F4 the owner's screens and figures)**: multi-purpose vouchers only. A card keeps no code (`code_hash`, `hashGiftCode()` in `src/server/gift-card-codes.ts`; a code is shown once, in its email or to the staff member who issues it), and its balance is only `commerce.gift_card_balance()` over `gift_card_entries`, written only by the `gift_card_*` SQL functions (issue, hold, release, spend, refund, adjust, expire, void; triggers refuse any other writer and keep cards and entries as written); never compute a balance in code or write a card or an entry another way; a delivered card's code changes only through `commerce.gift_card_new_code()` (D381, `sendNewGiftCardCode()`). A card is money, never a discount: it pays at checkout (F3). Selling one (F2): a product of kind `gift_card` (feature `gift_cards`, VAT category `voucher` and only it, every variant `digital`) is cartable like goods with who it is for on its line (`src/lib/gift-card-line.ts`: `cleanGiftCardRecipient()`, `giftCardKey()`, which the cart's forms send back as `giftCardKey`); nothing comes off a gift card line and it counts towards no threshold, in `cartSummary()` and `placeOrder()` alike (`voucher`), so a new discount or threshold skips it in both; it is no download (no tick, no downloads block). Cards are issued only by the database when the order is paid with a captured payment (`issue_order_gift_cards()`), codes are made and emailed only by `deliverGiftCards()` (the log keeps `[code]`, `sendEmail({ secrets })`), and a withdrawal voids only whole cards (`gift_card_withdraw()`). Spending one (F3): a card is found only by `findGiftCard()` and kept on a cart only by its id (`cart_gift_cards`, `addCartGiftCard()`, tries counted); what cards pay is only `giftCardsPay()` (`cartSummary()` and `placeOrder()` alike), each card a `payments` row of provider `gift_card`, held, spent, released and refunded by the database's triggers (`payments_gift_card()`, `orders_gift_card_payments()`, `refunds_gift_card()`), never a discount; a card never pays for a gift card, a subscription, a host's listing, terms, a change or an exchange; an order the cards pay in full is confirmed by `confirmPaidByGiftCards()`, who pays asked on the cart; a new list that finds an order by its payment's reference, a new test-mode rule or a new refund path includes `gift_card`. The owner's screens (F4, `src/server/gift-cards-admin.ts`, `src/lib/gift-card-admin.ts`, `/admin/{store}/gift-cards`): a card's state is only `cardState()`; issuing by hand (`issueGiftCard()`, `products:write`) shows the code once and keeps it nowhere; changing, deactivating and expiring (`expireGiftCards()`, daily) go through the ledger's functions. Finance leaves a gift card sold out of every sales figure (`GIFT_CARD_LINE`, `VOUCHER_NET` in `analytics-sql.ts`), so a new sales figure leaves it out too, and reports what customers hold per currency (`giftCardLiability()`, never converted or added across currencies, CSV `finance.gift_cards`); the invoice marks a gift card line `voucher` (SQL and `buildInvoiceSnapshot()` alike).

## Owed to customers (wave 11 unit B, D381)

- **Owed to customers (wave 11 unit B, D381)**: what bonus credit and gift cards owe is only `liabilityRows()` (`src/server/liabilities.ts`): each
  ledger's own sums before and at the end of the period with each kind's movement between (`rollForward()`, `COLUMN_OF` in
  `src/lib/liabilities.ts`), never a balance worked out in code; held now is `bonus_balance()` summed, and live delivered cards. A new kind of
  ledger entry is a column in `COLUMN_OF` (else it shows as *other*).

## Checkout rules and questions (wave 9 unit D, D357, `src/lib/checkout-rules.ts`, `src/server/checkout-rules.ts`)

- **Checkout rules and questions (wave 9 unit D, D357, `src/lib/checkout-rules.ts`, `src/server/checkout-rules.ts`)**: a store's rules
  (`commerce.checkout_rules`) and questions (`commerce.checkout_fields`) are written only by `src/server/checkout-rules.ts`; what the rules do to a
  basket is only `applyCheckoutRules()` through `checkoutRuleOutcome()`, read once by `cartSummary()` and by `placeOrder()` and handed to
  `resolveDelivery()` (`rules`), which lays it over the offer (`rulesOnOffer()`); every other reader of a cart's delivery passes the buyer
  (`customerId`). A new condition or effect is a kind in `CONDITION_KINDS`/`EFFECT_KINDS`, its schema in `checkout-rules-schema.ts`, its case in
  `conditionHolds()`/`goneIn()` and the editor, and a test; a rule never changes a product's price, VAT or a legal page, and prices a delivery
  option only as `delivery_price` (D402) through `pricedBy()` in `rulesOnOffer()`, never below zero. Payment methods a rule left out are
  `orders.rule_hidden_methods`, read by `excludedPaymentMethods()` given the order. A rule that orders delivery options (`order_delivery`, D399) only moves them (`orderedBy()`), never the default. The Admin API reaches rules and questions only through this module's writers (scopes `checkout:*`). Answers are kept on the cart through `cleanAnswers()` and copied
  by `placeOrder()` (`orders.checkout_answers`, read by `readAnswers()`): personal data, in the export, erasure, retention and `anonymise_order()`.

## Refund to store credit and customer accounts (wave 10 units A and B, D364, D365, `docs/wave-10-must-haves.md`)

- **Refund to store credit and customer accounts (wave 10 units A and B, D364, D365, `docs/wave-10-must-haves.md`)**: a refund to store
  credit is only `refundOrder({ toCredit })`: refunds of kind `store_credit` (no provider call, capped by the database) and ONE gift card issued
  only by `commerce.gift_card_issue_refund()` in the refund's transaction (source `refund`), its code emailed to the order's own address by
  `sendRefundCredit()`; a new reader of refunds counts it as a refund. Whether shoppers may, must or cannot have an account is
  `stores.customer_accounts`, written only by `saveAccountsMode()` and read only through `accountsMode()` (`src/lib/customer-accounts.ts`):
  `placeOrder()` refuses `sign_in_required`, so a new way to an order needs nothing more; a new account page reached only through the account
  is a segment of `ACCOUNT_ONLY_SEGMENTS` and asks `accountsShown()`, and a new feature that needs accounts goes in `FEATURES_NEEDING_ACCOUNTS`.
  A broadcast starts from `BROADCAST_TEMPLATES` (hand-written nb, sv, da, en, no claim; a new one is a key with all four) or the store's own
  `broadcast_templates`, written only by `src/server/broadcast-templates.ts` and read through `startingContent()` (D368).

## Shipping carriers (D133, `docs/shipping-carriers.md`, `src/lib/shipping-carriers.ts`, `src/server/shipping-carriers.ts`,…

- Shipping carriers (D133, `docs/shipping-carriers.md`, `src/lib/shipping-carriers.ts`, `src/server/shipping-carriers.ts`, `/admin/{store}/integrations/shipping/{carrier}`): Posten / Bring (D134), PostNord (D136), Porterbuddy (D137) and Helthjem (D138) are connected, each as far as its `available` features in the registry say: the store's own agreement (non-secret details, encrypted secrets with hints) is saved in `commerce.shipping_carriers`. A carrier's connection implements `ShippingCarrierAdapter`, gets its agreement only from `carrierContext()` (secrets never reach a page or an action), confirms its credential fields against the carrier's documentation, falls back to the flat rate when the carrier fails, and keeps `cartSummary()` and `placeOrder()` in agreement. A new carrier is an id in `CARRIER_IDS`, an entry in `CARRIERS`, the table's `carrier` check, a mark colour in `IntegrationMark`, and it stays out of store copies.

## Posten / Bring (D134, `src/lib/bring.ts`, `src/server/carriers/bring.ts`, `src/server/bring-shipping.ts`)

- Posten / Bring (D134, `src/lib/bring.ts`, `src/server/carriers/bring.ts`, `src/server/bring-shipping.ts`): the first carrier connection. Pure request/response code lives in `lib/bring.ts`; the adapter takes an injectable `fetch` and never throws raw errors to a page (plain sentences); orders are booked only through `bringBook()`, which in the store's test environment books a test shipment and does NOT mark the order sent, and otherwise marks it sent through `markSent()` with its `booking` (carrier id, consignment number, label address). Labels are fetched from Bring when printed and never stored; only `api.bring.com` addresses are fetched, with the agreement's keys, for staff. A new carrier connection follows the same shape and is registered in `carriers/index.ts` with its `available` features in the registry.

## Delivery options at checkout (D135, `src/lib/delivery-options.ts`, `src/server/delivery-options.ts`, `src/server/delivery-choice.ts`,…

- Delivery options at checkout (D135, `src/lib/delivery-options.ts`, `src/server/delivery-options.ts`, `src/server/delivery-choice.ts`, `DeliveryChoice`, piece `checkout_delivery`): the shopper gives a postal code, `quoteDelivery()` keeps the carrier's services for the cart as `commerce.delivery_quotes` (price = carrier price + the country's standard VAT + the store's percentage and amount, via `shopperPrice()`, in the country's own currency; shown with `shown()`), `chooseDelivery()` puts one on `carts.delivery_quote_id`, and `chosenDelivery()` is the only reader: a quote of the cart, its country, not expired, pickup point chosen when needed. `cartSummary()` and `placeOrder()` both use it as the basket's shipping rate in place of the flat rate (`commerce.shipping_rates`, which stays as the default and the fallback, so stores keep it set up), so they agree (scenarios in `checkout-kinds.int.test.ts`; a new delivery kind or price rule gets one, euro included). Never call a carrier while placing an order, and never read a quote's price from anywhere but `chosenDelivery()`. Subscriptions ignore the choice (flat rate on each delivery). The order keeps `orders.delivery` (`readOrderDelivery()`); name the service with `order.delivery?.label ?? m.shipping`, the pickup point with `pickupPointLine()`. A new carrier's checkout services add to `CHECKOUT_SERVICES`, `CHECKOUT_COUNTRIES` and its adapter's `rates`/`pickupPoints`.

## PostNord (D136, `src/lib/postnord.ts`, `src/server/carriers/postnord.ts`)

- PostNord (D136, `src/lib/postnord.ts`, `src/server/carriers/postnord.ts`): connected for the check, service points and tracking only; the adapter has no `rates` or `book`. A carrier's checkout services are priced by `CHECKOUT_PRICING`: `carrier` (its `rates()` plus `shopperPrice()`) or `store` (what the owner entered in `checkout_prices`, with VAT, per country: never add VAT or a markup to it). `quoteDelivery()` asks every active carrier (`activeCarriers()`) and lists their services together; a new carrier with its own price service is `carrier`, one without is `store`. Booking and labels for PostNord wait for its EDI specification.

## Porterbuddy (D137, `src/lib/porterbuddy.ts`, `src/server/carriers/porterbuddy.ts`, `src/server/porterbuddy-shipping.ts`)

- Porterbuddy (D137, `src/lib/porterbuddy.ts`, `src/server/carriers/porterbuddy.ts`, `src/server/porterbuddy-shipping.ts`): sells delivery *windows*. `rates()` is an availability request and returns options with a `window` (and `includesVat` for a price made for the shopper); at checkout each is a quote with `window_start/window_end` (read with `chosenDelivery()`, kept on `orders.delivery.window`, shown with `formatWindow()` in the store's time zone). Never book with the token the shopper saw: `porterbuddyBook()` asks again and uses the fresh one, and books nothing when the window is gone. Labels of every connected carrier are served by `carrierLabel()` (only the carrier's own hosts are fetched, never kept).

## Helthjem (D138, `src/lib/helthjem.ts`, `src/server/carriers/helthjem.ts`, `src/server/helthjem-shipping.ts`)

- Helthjem (D138, `src/lib/helthjem.ts`, `src/server/carriers/helthjem.ts`, `src/server/helthjem-shipping.ts`): `store`-priced like PostNord, with a weight limit per service (`CHECKOUT_SERVICES[...].maxWeightGrams`, checked against the cart's weight in `offersFrom()`). Our service ids are `home` and `collect`; what Helthjem books is the store's own transport solution for each (`solutionFor()`), never a fixed id in code. The token lives in a module-level cache (`forgetHelthjemTokens()` in tests). Only Helthjem's own hosts are sent the token (`isHelthjemUrl()`).

## Custom fields (D118, `docs/custom-fields.md`, `src/lib/custom-fields.ts`, `src/server/custom-fields.ts`)

- Custom fields (D118, `docs/custom-fields.md`, `src/lib/custom-fields.ts`,
  `src/server/custom-fields.ts`): a store's own groups of fields
  (`commerce.field_groups`, made at `/admin/{store}/fields` by
  `FieldGroupEditor`) and what was entered in them for products, pages and
  articles (`commerce.field_values`: one row per thing and language, `locale`
  empty for what is the same in all, keyed by the field's `id`, never its
  name). A group applies by its location rules (`groupApplies()`, OR of AND,
  evaluated in the browser as the thing changes and on the server when it is
  saved); a field shows by its conditional logic (`fieldShows()`), and a hidden
  one is kept but never required. The entry form is `FieldsForm`/`EntityFields`
  (`applicableGroups()`); values travel in the editor's own JSON (`fields`:
  `changesFrom()`, a `null` takes a value away) and are written by
  `saveFieldData()` in the same transaction, checked by `parseFieldChanges()`
  against the groups the finished thing gets. A new field type is a key in
  `FIELD_TYPES`, its case in `parseValue()`, `displayText()`, `FieldInput` and
  the renderer. Only texts are per language (`isTranslatable()`). Fields are
  private until the owner makes them public: the site reads only public ones
  through `shownFieldsFor()` (cached under `fieldsTag`, read inside the
  product page's own cached read), drawn by `CustomFieldsView` in the product
  layouts' `fields`/`field` parts and the page builder's `customField` block;
  any change to a group or to values calls `updateTag(fieldsTag())`. Never
  render a field's value as HTML.
  Phase 2 (D119): a **group** and a **repeater** hold `subFields`; their
  structure and non-text cells are in the shared row and only translatable sub
  fields' texts in the locale rows, each repeater row with a stable id
  (`newRowId()`) so a translation follows its row. Read and write a field only
  through `readField()`/`writeField()`/`parseStructural()`, never the storage
  shape (the form shows another language its own view, `ownView()`). **Link**
  (a page, product, category, tag or web address), **product/page/term**
  relations and **file** hold ids and addresses, never names: the server drops
  ids that are not the store's (`keepOwnRelations()`) and files outside
  `field-files/{storeId}/` (`isOwnFieldFile()`, uploaded straight from the
  browser to the public bucket by `startFieldFileUploadAction`), and
  `shownFieldsFor()` turns them into links in the shopper's market
  (`resolveRelations()`), leaving out what no longer exists; links are drawn
  only if `isSafeAddress()`. Things with fields (`FIELD_ENTITIES`): products,
  **variants** (`shownFieldsForVariants()`, `ProductDetail.variantFields`, drawn
  per variant by the `fields`/`field` parts through `VariantFields`, which
  follows the picker via `announceVariant()`; entered in the product editor by
  SKU as `variantFields`) and **categories and tags** (`term`,
  `saveTermFields()`, the Fields button in `TermsManager`, drawn on the term's
  page); their rules are `termKind`/`content`. A field with `filter`, `search`
  or `chat` (public fields only; the generator's Storefront tab) is a listing
  filter (`f.<name>` in the address, `listingFacets().fields`,
  `field-filters.ts`), part of keyword search (`commerce.field_search`, rebuilt
  by `refreshFieldSearch()` on every save and `refreshStoreFieldSearch()` when
  groups change; `matchingIds()` reads it), and a fact the chat agent may say
  (`chatDetails()`); public simple fields are also `additionalProperty` in the
  product's JSON-LD (`structuredProperties()`). A heading, rich text, image or
  button block can be **bound** to a field (`bind`, `src/lib/field-binding.ts`:
  `bindPage()` on product layouts, `bindForPlace()` on pages, only when the
  content has a binding). Field texts are in the store translation worklist
  (scope `fields`, `src/lib/field-translate.ts`) and the AI manager reads and
  fills them (`list_field_groups`, `get_fields`, `set_fields` and
  `create_field_group`, the last two gated). A new kind of thing with fields is
  an entry in `FIELD_ENTITIES`, `LOCATION_PARAMS`, `Facts` and `factsFor()`, a
  cleanup trigger, `clone_store()` and its own editor.
  Phase 3 (D120): **money** fields (`{ amountMinor, currency }`, only in a
  currency the store offers, `moneyCurrencies(store)`; shown converted to the
  market's currency at the store's rates by `convertMinor`, else in its own,
  never with a VAT label; never `chat`, never a structured-data property) and
  **flexible content** (`layouts`, each a named set of sub fields; rows are
  `{ id, layout, …cells }`, stored like a repeater's: use `rowFieldsOf()`,
  rows of a layout that is gone are dropped on save and skipped on read).
  The **store** (`entity 'store'`, id = the store's; edited at
  `/admin/{store}/fields/store`, shown by a `customField` block, a product
  part or a binding with `source: 'store'`, allowed in headers and footers only
  so) and **customers** and **orders** (`staffGroupProblem()`: groups only for
  those two, no rules, nothing public, no picture, gallery or file; never read
  on the shopper's side: `field-values-readers.test.ts` lists the modules that
  may read `field_values` and fails if another does; customer values go with
  the customer, `customerFieldExport()` is the export). A **field loop**
  (`fieldLoop` block, product part `loop`, `src/lib/field-loop.ts`) draws a
  repeater's rows as cards, a list, a grid or columns from slots (picture,
  title, text, link, badge) filled with the row's sub fields, never nested
  links. A content grid's `tileFields` (up to three plain fields) are read for
  all its items at once (`shownFieldsForItems()`, one batch, group rules
  honoured). A number or measurement field with `filter` is a range filter
  (`f.<name>.min`/`.max`, a measurement compared in its first unit only).

## Work (D122, D123, `docs/work.md`, module `work` switched on per store in the owner's Work settings, at the store OWNER's level

- Work (D122, D123, `docs/work.md`, module `work` switched on per store in the owner's Work settings, at the store OWNER's level: `/admin/account/work` is the combined view over all the account's stores (`src/server/work-owner.ts`, money per currency, never added across currencies) and one store's screens are `/admin/account/work/s/{store}/…`; build every Work link with `workBase()` from `src/lib/work-paths.ts`, never by hand; old `/admin/{store}/work…` addresses redirect; one running timer per person across stores): clients, assignments and tasks, time entries and timers, invoices and credit notes, ported from Kaizen Life's Work area. Tables are `commerce.work_*` (`db/schema.ts`), all with `store_id` and composite keys; money is integer minor units, hours integer minutes, invoice quantities hundredths of an hour: the maths is only in `src/lib/work-calc.ts` (BigInt, no floats), VAT in `work-vat.ts`, dates in the store's time zone in `work-dates.ts`, input schemas shared with the browser in `work-input.ts`. Servers: `src/server/work.ts` (clients, assignments, tasks), `work-time.ts` (entries, timers), `work-invoices.ts` (drafts, lines, issue, credit, payments, document data), `work-settings.ts`, `work-overview.ts`; refusals of the SQL rules are `work_*.reason` codes mapped to plain messages by `work-errors.ts` (`workGuard()`); actions are in `.../work/actions.ts`, `invoice-actions.ts`, `settings-actions.ts`, each behind `requireMember` and the module switch, owner-only for settings, credit notes and deletes. **An invoice is issued only by `commerce.issue_work_invoice()`** (gap-free number from series `work_invoice`, readiness checks, frozen snapshot; the server never computes an issued amount itself) and afterwards is immutable, corrected by `credit_work_invoice()` (the one exception is `imported = true`, WP15: history from Kaizen Life with its own number in `legacy_number`, shown as the `document_number` label, no series number, made only by `scripts/import-life-work.mjs`'s SQL under `commerce.work_importing`, never emailed); payments are append-only and set the status by trigger, which also writes the payment and invoice events (never write them again in code). Tasks and time keep their draft invoice line in step in the same transaction (`work-draft-sync.ts`). Documents are drawn from the snapshot by `InvoiceDocumentView` (print routes under the `(print)` route group, no admin chrome); the customer-facing texts are hand-written in `work-invoice-text.ts` and need review before real use. Sending and exports (`work-emails.ts`: `sendInvoiceEmail()` idempotent by key, the hosted page `/s/{store}/{market}/account/invoice/{token}` from `work_invoices.public_token`, CSVs in `work-exports.ts`); recurring invoices (`work-recurring.ts`, `prepareDueRecurringWork()` in the five-minute cron: drafts within 40 days, a deleted draft's period is skipped for good, auto-issue off by default and an email failure never undoes an issued invoice); reports (`work-reports.ts`: per currency, a fixed fee counts once in the period it is invoiced) and `workAttention()` feeding the control center. A client can be filled in from Brønnøysundregistrene's open register (D124: `src/lib/brreg.ts`, `src/server/brreg.ts`, `BrregLookup` on the client form and on a shop's company accounts (`CompanyFields`); a number or a name, only that is sent, nothing is saved from the lookup). Work's screens follow the account's language (D312 A10, the `work` catalogue, `workWords()` on the server); the invoice documents' words stay in `work-invoice-text.ts`.

## Categories and tags (D50, `src/lib/taxonomy.ts`, `src/server/taxonomy.ts`)

- Categories and tags (D50, `src/lib/taxonomy.ts`, `src/server/taxonomy.ts`):
  `commerce.terms` per owner (`store_id`, null for Kaizen) and kind of
  content (`page`, `article`, `product`); categories nest, tags are flat.
  Pages carry theirs in their content (`categories`, `tags`); products in
  `product_terms`. `TermsManager` and `TermPicker`
  (`src/components/admin/terms.tsx`) manage and choose them; changes
  `updateTag(termsTag(scope))`. Menus link to them by address (D52), to
  `/s/{store}/{market}/category|tag/{slug}` and Kaizen's `/category|tag/{slug}`.
  A store's product category or tag has its own page (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3): a description, a picture and its
  name and description in the other languages (`terms.texts`, read only through `termTextFor()`/`termsIn()` in `src/lib/term-texts.ts`: the
  language's own, else the main language's; a new place that shows a term's name to a shopper names it so), checked on the server by
  `checkedPage()`, in the translation worklist (`termUnit()`'s `page`); and the owner's order of its products (`product_terms.position`,
  written only by `setTermOrder()`, read through `manualPlace()`: `listGridProducts()` sort `manual`, the listing's `featured` with
  `orderTerm`). `saveProduct()` writes only the product terms it adds or removes, so a place survives a save; a term's picture is in
  `mediaUses()`, `rewriteAddresses()` and the store copy's picture step.
  A collection filled by rules (A2) is a term with `terms.rules` (`termRulesSchema`, `src/lib/term-rules.ts`), whose products are worked out
  when read by the one evaluator `commerce.product_matches_rules()`, never `product_terms` rows (triggers refuse them): every reader of a
  term's products asks `inTerms()` (`src/server/product-conditions.ts`) or the evaluator, campaigns and codes reach it through
  `termsOfProducts()`, a product or page is placed only in a term `scopedTermIds()` gives (never one filled by rules), and rules are saved
  only through `checkedRules()` (`src/server/term-rules.ts`: the store's own ids, never a term filled by rules). A new condition is a case
  in `conditionSchema`, `describeCondition()`, `newCondition()`, `TermRulesFields`, the SQL evaluator and the AI manager's
  `update_category` (`src/server/category-tools.ts`), with a test.

## Customer groups and company accounts (D108, `src/lib/customer-tiers.ts`, `src/server/customer-tiers.ts`, `src/server/companies.ts`)

- Customer groups and company accounts (D108, `src/lib/customer-tiers.ts`,
  `src/server/customer-tiers.ts`, `src/server/companies.ts`): a group is a
  fixed percentage (`customer_tiers`, `customers.tier_id`); a company
  (`customer_companies`, `customers.company_id`/`company_role`) has a group and
  the share of it its employees get. A customer's discount is always read from
  their membership by `memberDiscountFor()`, never copied, so leaving stops it
  at once. It comes off what is bought once, before any code: `cartSummary()`
  and `placeOrder()` both use `memberLineOff()`, and the order keeps its part
  (`member_discount_minor`, `member_label`, `member_percent`); a new kind of
  price or line that discounts must keep the two together
  (`checkout-kinds.int.test.ts`). Draw an order's discount row with
  `discountNote()`. Invitations and sign-in links keep only a hash of their
  token and act from a page with a button, never from opening the link;
  accepting goes through `acceptInvite()` only. Customer routes for these live
  under `/account/…`, as a new top-level `/s/{store}/{market}/{word}` would
  reserve a page address.

## B2B in depth (wave 6 unit C, D321, `docs/wave-6-catalogue.md` C.4 to C.6)

- **B2B in depth (wave 6 unit C, D321, `docs/wave-6-catalogue.md` C.4 to C.6)**: what a buyer pays is only `commerce.buyer_price()` (their
  lists: their group's, their company's and its group's; the lowest below the market price), joined into the cart's and checkout's own price
  reads under `LIST_PRICED` (goods and appointments bought once) and read by the buy part through `listPricesFor()`; a list-priced line takes no
  group percentage on top and is shown as *Your price*, never a reduction; lists are written only by `src/server/price-lists.ts`. A list marked
  exclusive hides its scope's products: `OFFERED` leaves them out of every read made for everyone, and a read made per request for a known buyer
  (the cart, checkout, *Your catalogue*) asks `offeredTo(customer)`; a change to a list refreshes `catalogTag`. Company locations and who buys
  at them are written only by `src/server/company-locations.ts`; `placeOrder()` checks the location and PO number (`buyerFacts()`) and decides
  an approval only by `needsApproval()`; a waiting order starts no payment and is decided only by `decideOrder()`, paid by
  `startApprovedPayment()` and cancelled by `expireApprovals()`; an order keeps its location, PO number and approval as placed (the database),
  and the PO number reaches the invoice only through `documents_po_number()` and `buildInvoiceSnapshot()` alike.

## Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1 to D.6)

- **Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1 to D.6)**: a product of kind `bundle` has one variant made of goods variants
  (`bundle_components`: a quantity each, the bundle's VAT category, at most 20; rules at commit by `commerce.bundle_problem()` when components or the
  bundle's own VAT category change; a change to a component is never refused, it makes the bundle unbuyable until put right), priced as its own or
  as its components' prices less a percentage, written only by the database through `set_price()` (`refresh_bundle_prices()`, at commit), and in
  stock only as far as its components allow, inside `variant_availability` (never on backorder; a level of a bundle's own is refused). A product
  never becomes or stops being a bundle. `placeOrder()` holds a bundle line's components (`bundleComponentsOf()`), `insertOrderLine()` writes
  them frozen (`order_line_components`), `draw_order_stock()` draws them and `planRestock()` puts them back (`expandBundleItems()`, the event's
  `restockedBundles` for the line's count); an order with a bundle is not changed (`editBlock()`'s `bundle`). A bundle is goods everywhere a shopper
  buys (cart, campaigns, codes, price lists, wishlists, WordPress) but never a free gift, a weekly box, a draft's or an exchange's line. A new place
  that reads a line's stock asks the components; a new place that shows an order line shows `components` (`componentsText()`).

## Quantity rules (wave 6 unit E1, D323, `docs/wave-6-catalogue.md` E.1, `src/lib/quantity-rules.ts`)

- **Quantity rules (wave 6 unit E1, D323, `docs/wave-6-catalogue.md` E.1, `src/lib/quantity-rules.ts`)**: a variant of goods or a bundle has a
  minimum, an optional maximum and a step (`product_variants.min_quantity`, `max_quantity`, `quantity_step`, whole steps by check), read only through
  `ruleOf()`/`ruleForKind()` (any other kind is `PLAIN_RULE`); a line holds at most `lineMax()` (its maximum, else twenty steps from the minimum,
  20 for the plain rule, never above `MAX_ORDER_QUANTITY`). Adding is `nextQuantity()` (the minimum, then whole steps), setting a quantity
  `quantityProblem()` refuses is refused (`changeLine()`'s `quantity`), a line the rule no longer allows has status `quantity` and blocks checkout,
  and `placeOrder()` refuses it (`quantity`); the WordPress quote and hand-over fit lines with `fitQuantity()`. A new way to put goods in a cart
  asks the rule the same way; drafts, order changes, exchanges and a subscription's later changes are staff's or the subscriber's and are not held to it.
  Price breaks (E2, `src/lib/price-breaks.ts`, `src/server/price-breaks.ts`): a product's `price_breaks` (from N units in one line, a percentage off or
  a unit price per market, one variant or every variant, at most 10) price a line only through `commerce.line_price()` (the lowest of the market
  price, the breaks the quantity reaches and the buyer's list offers; `buyer_price()` at one unit), read by `getCart()`, `orderLineRows()`, the
  product page's table (`priceBreaksFor()`) and the WordPress quote, so they agree; a break is the price at that quantity, never a reduction
  (no reference, no "save"), and a line it prices takes the group's percentage as any line does. A new place that prices a cart line by its
  quantity asks `line_price()`; a new money read here needs a euro scenario.
  A price list's own breaks and rules (E3, per variant: `price_list_breaks`, `price_list_quantity_rules`, written only by `setListBreaks()`/
  `setListRules()` in `src/server/price-lists.ts`) reach its buyers through `line_price()` and `commerce.quantity_rule()` (the buyer's lists'
  rule, the most open, else the variant's); every reader of a buyer's rule (the cart, the add, checkout, *Your catalogue*, the product page's
  `buyerRulesFor()`) asks it, and a reader with no buyer (the WordPress cart) takes the variant's own.

## Selling to businesses (D63, `src/lib/b2b.ts`, `src/server/b2b.ts`)

- Selling to businesses (D63, `src/lib/b2b.ts`, `src/server/b2b.ts`): stores
  sell to `consumers`, `businesses` or `both` (`stores.audience`). Prices are
  always kept and charged with VAT; businesses see them without it. Draw
  prices with `<Price>`/`VatAmount` (the catalogue's `PriceView` carries
  `vat`), never `formatMoney` of a price alone in the storefront; server-rendered
  per-request pages use `getBuyer()` and `shownAmount()`. In stores selling to
  both, the shopper's kind is the `buyer_{storeId}` cookie, marked on
  `<html data-buyer>` by the layout's first script; show things to one kind
  with `for-business`/`for-private` (`audienceClass()` for products). The
  cart refuses business-only products to private buyers and `placeOrder`
  needs the company (`companyRequired()`).

## Bookings (D65, `docs/bookings.md`)

- Bookings (D65, `docs/bookings.md`): a module stores switch on under
  Features (`stores.modules`, `store.bookingsOn`, `stores.time_zone`).
  Appointments are products of `kind` `appointment` whose variants are
  delivered as `service` (no stock, shipping or files; withdrawal
  `dated_service`), with `appointment_settings` and the staff who do them
  (`product_resources` → `booking_resources`, each with `OpeningHours` and a
  capacity; `src/server/bookings.ts`). Free times come from
  `slotsOn()` (`src/lib/booking-slots.ts`, pure, in the store's time zone);
  a time is only ever taken through `commerce.hold_booking()`, which checks
  capacity with buffers under a lock; bookings follow their order's status
  (trigger `orders_bookings_follow`; paid after its hold ran out, a time is
  kept only if still free, else `booking.lost`). Shoppers choose a time on
  the product page (`AppointmentPicker`, weeks from `appointmentSlots()` in
  `src/server/appointments.ts`, per request); a cart line then carries
  `starts_at` and an optional `resource_id`, always quantity 1, and must be
  a time the page would offer (`freeResourcesAt()`; the `bookable` SQL keeps
  goods without a time and appointments with one). `placeOrder` holds each
  time with `holdAppointment()` (the chosen person, or the first free) and
  undoes the whole order as `slot_taken` if one is gone. Order lines find
  their time through `bookings.order_line_id` (`OrderView` lines' `booking`);
  show times with `formatBookingTime()` in the store's time zone. Emails
  about bookings carry a calendar file (`src/lib/ics.ts`, one uid per
  booking so a cancellation replaces it; `attachments` on `sendEmail`): the
  confirmation, staff notices (`sendBookingStaffNotices`, from
  `applySession`), reminders (`stores.booking_reminder_hours`,
  `sendDueBookingReminders()` in the five-minute cron, claimed through
  `bookings.reminded_at`) and cancellations. A cancelled order gives up its
  times; the store cancels one from the week calendar (`cancelBooking()`,
  layout in `src/lib/booking-calendar.ts`) and refunds from the order.
  Stays and rentals (D67) are products of `kind` `stay` or `rental`, booked
  by whole nights or days over `booking_resources` of kind `unit` or `item`
  (no hours; `appointment_settings` holds check-in/out times and the
  shortest and longest). Their rules are pure in `src/lib/booking-ranges.ts`
  (`rangeSpan()`: a stay ends on check-out N days later, a rental on its last
  day), the server side is `src/server/ranges.ts` (`rangeDates()`,
  `freeUnitsFor()`, `holdRange()`); the cart line's quantity is the nights
  or days and `starts_at` the check-in, so prices and VAT need nothing new.
  A rental's variant is rented by `day`, `half_day` or `hour`
  (`product_variants.rental_period`, D69): `periodSpan()`/`periodProblem()`
  say what a start and quantity take, `rentalTimes()` offers a day's halves
  and hours, and capacity is counted at the busiest moment (`peakBusy()`,
  `commerce.resource_peak()`). Pass the line's period wherever a span is
  worked out (`checkRange()`, `holdRange()`, `rangeEndsAt()`).
  Stays and rentals are priced by `bookingPrice()` (D70,
  `src/lib/booking-prices.ts`): each night's or day's price changed by the
  product's `booking_seasons`, plus `appointment_settings.booking_fee`; the
  date picker works out its total with the same function. Show a season's
  name with `seasonName()` (its `names` by locale, else `name`).
  In the cart and orders such a booking is quantity 1 at its whole price;
  its nights, days or hours are `booking.count` (the cart line's own
  `quantity` column; the order line's `booked_count`), never the line's
  quantity. Anything comparing a cart with its order uses them.
  Show any booking with `bookingWhen()` (`src/lib/booking-text.ts`); stays
  and rentals are cancelled, never moved.
  Blocks (D68, `commerce.resource_blocks`) close a whole resource: set by
  the store, or read from other sites' iCal calendars (`calendar_feeds`,
  `syncDueFeeds()` in the five-minute cron, `src/server/calendar-sync.ts`).
  Anything that decides whether a resource is free counts them: `busyOn()`
  in code, `commerce.resource_blocked()` in SQL. A room's or item's own
  calendar is published at `/api/calendar/{calendar_token}.ics`, whole days
  marked only Booked or Blocked.
  How an appointment is paid (D66, `src/lib/pay-later.ts`): `now`,
  `deposit` or `venue` in `appointment_settings`; `venuePart()` gives each
  line's share for the venue, the same in the cart and `placeOrder`.
  Orders keep their full total, with `balance_minor` for the venue
  (`markBalancePaid()` in `order-admin.ts`); Stripe is sent only what is due
  now (`PlacedOrder.dueNowMinor`, line by line, no coupon or invoice), and
  refunds count only Stripe's payments. An order with nothing due online is
  confirmed by `confirmAtVenue()` with the shopper's contact details and a
  `venue` payment whose reference opens its order page. Shoppers cancel or
  move their own bookings until `cancel_hours` before (`selfServiceOpen()`)
  from the order page or My account (`OwnBookings`, `BookingChanges`,
  `src/server/booking-changes.ts`, access by the page's key or ownership):
  cancelling refunds what Stripe took for it and cancels an order left with
  nothing; moving goes through `commerce.move_booking()` (locked, raises
  `bookings.sequence`, which calendar files carry). Staff mark past
  bookings as no-shows from the calendar (`markNoShow()` in
  `src/server/no-show.ts`, `bookings.no_show_at`), charging the fee off
  session to the card saved with the deposit only when they tick it.

## Demo products

- Demo products: the template store has a clearly labelled demo product
  (`Demo: …`) of every kind, and new stores are copied with them
  (`clone_store()`). A new kind of product gets one in the same change: a
  function adding it to a store (as `commerce.add_demo_appointment()`,
  with whatever it needs to be bought, such as staff), called by the
  migration for production's template and by `supabase/seed.sql`, a picture
  in `public/demo/`, and `clone_store()` copying its new tables and columns.

## Subscription boxes (D102, named so in every text shoppers and staff read; `src/lib/standing-orders.ts`, `src/server/standing-orders.ts`,…

- Subscription boxes (D102, named so in every text shoppers and staff read; `src/lib/standing-orders.ts`, `src/server/standing-orders.ts`,
  `/s/{store}/{market}/deliveries`, `/admin/{store}/deliveries`): a module
  (`deliveries`). A shopper's standing list (`standing_orders`, lines in
  `standing_order_lines`) on a store's delivery day (`delivery_schedules`)
  becomes that delivery's order at the cutoff (`prepareDueDeliveries()` in the
  five-minute cron, `standing_deliveries` once per list and day), always
  through `placeOrder()` from a cart of its own; a change after a cutoff first
  makes that delivery (`prepareDueFor()`). The order waits for payment until
  sent: Mark sent calls `chargeDelivery()` (the card saved in Stripe's setup
  mode, off session) and only a paid order is marked sent; a refusal emails a
  pay link (`startDeliveryPayment()`), and `applySession()` neither cancels a
  delivery's order nor changes its address. Rounds and cutoffs come from
  `nextRound()`/`currentRound()` in the store's time zone.
