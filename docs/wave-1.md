# Wave 1: compliance and money correctness (D156, spec)

Closes the 18 tracker rows with `wave: 1` (`docs/parity/rows`, plan: `docs/parity-plan.md` section 3). It is seven build units in
two lanes, each one run of `.claude/workflows/parity-wave.js` (Spec is this file; each run starts at Foundation). This file is
the contract; a disagreement is settled here first.

**Nothing here is legal or tax advice.** Every rule that comes from a law is written with its source and the date it was read,
marked *needs review by an accountant or lawyer*, and kept in data or one pure function so a correction is a data change, not a
rewrite. Every consumer-facing legal text is hand-written in nb, sv, da and en and is never machine-translated.

## Rows and where they are closed

| Unit | Rows closed |
|---|---|
| **1a** Tax profile and VAT engine | `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates` (also 1b for the invoice and 1c for the report and reconciliation), `checkout.b2b-vat-id-reverse-charge-exemption`, part of `checkout.oss-and-ioss-support` and `international.ioss` (the number and the marking) |
| **1b** Invoices and credit notes | `orders.invoices-and-vat-receipts-for-orders`, `orders.credit-notes-for-refunds`, `international.legal-invoices-and-credit-notes-for-orders` |
| **1c** VAT, OSS and IOSS reports | `analytics.tax-and-vat-reports-by-rate-and-jurisdiction`, the reports of `checkout.oss-and-ioss-support` and `international.ioss` |
| **1d** Unit price | `international.unit-price-indication` |
| **1e** Legal starters, terms, accessibility, PCI | `international.legal-page-templates-and-policy-generator`, `international.accessibility-wcag-eaa-and-statement`, `storefront.accessibility-and-theme-quality-guarantees`, `international.pci-dss` |
| **1f** Staff security | `international.staff-two-step-authentication`, `international.staff-roles-and-permissions`, `platform.staff-accounts-and-roles`, `international.audit-log-of-admin-changes` |
| **1g** GDPR | `international.gdpr-data-export-and-erasure` |

Buckets that cap "Full": the IOSS and OSS rows are **B** (live only with a registration the owner holds: built and tested, said on the
screen when off), the accessibility row needs an independent audit (**D**, never counted by code), and every legal text needs review.

## Build order

Two lanes, because the money units share `checkout.ts`, `cart-summary.ts`, the order views and analytics, and must not run at once:

- **Money lane (in order):** 1a, then 1b (needs the VAT treatment on the order), then 1c (reads invoices and credit notes), then 1d.
- **Trust lane (free of the money paths, can run beside the money lane):** 1e and 1f together or in turn; 1g **after 1b** because
  erasure must respect the invoices' retention.

Shared registries are edited by one run at a time: `src/lib/page-content.ts`, `src/lib/i18n.ts`, `src/lib/email-text.ts`,
`src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `src/lib/store-copy-rules.ts`, `docs/parity/rows`, `CLAUDE.md`, `docs/decisions.md`.

## Standing rules (every unit)

Store id on every query; money in minor units with an ISO code; **a euro scenario in `checkout-kinds.int.test.ts` for every new money read**
(`shown()`, `convertedSql()`); new store-owned tables classified in `COPY_RULES` (and copied or not by `clone_store()`/`duplicate_store()`);
copied orders (`C-…`) and hosts' orders never invoice, credit, report or erase as a sale; refunds go through `refundOrder()` only; no cookie
or storage without a `KNOWN_COOKIES` entry; AI text passes `findClaims()`; a new translatable text goes in the translation worklist; new
admin pages go in one nav section and in `ADMIN_PAGES`; destructive statements inside SQL functions (`DELETE`, `TRUNCATE`) are cancelled by the
production migration tool: keep deletions in application code run by the cron where possible, and list any that must be SQL for the owner to
run in the SQL editor. Each unit ends with a decision row (D156 and onward), a CLAUDE.md bullet, and the tracker rows re-rated with evidence
(`pnpm parity:write`).

---

## 1a. Tax profile and VAT engine

### What exists

`commerce.vat_rates(country, category, rate)` with a check allowing only `accommodation`; `products.vat_category` in `standard | accommodation | exempt`
(check constraint); `commerce.vat_rate(country, category)` (standard rate, or the accommodation row, or none for exempt); shipping takes the standard
rate; prices are VAT-inclusive per market; a business sees prices without VAT but is charged it (D63); stores have a legal name, organisation number and
postal address but **no VAT number or registration facts**; reverse charge exists only in the Work module.

### Data

- `commerce.vat_categories (code pk, name_en, description, sort, active)`: seeded `standard`, `exempt`, `accommodation` plus the reduced-rate
  categories owners meet most: `food`, `books`, `periodicals`, `medicines`, `culture_events` (platform admins add more; owners only choose).
  `products.vat_category` becomes a foreign key to it (the three old values keep working).
- `commerce.vat_rates` widens to `(country_code, category, rate, valid_from, valid_to null, source, checked_on, verified_by null, verified_at null)`,
  key `(country, category, valid_from)`: rates have **history**, orders keep the rate they were charged at (`order_lines.tax_rate` already does).
  `commerce.vat_rate(country, category, at timestamptz default now())` is the only reader; **a missing row means the standard rate** (stated on the
  admin screen as "no reduced rate known here", never silently a different number). Seed the EU-27 and Norway for every seeded category from the
  European Commission's published VAT rates (TEDB) with `source` and `checked_on`; every row starts unverified and the admin lists unverified rows.
- Shipping: `commerce.shipping_vat_rules (country_code, rule)` with `standard` (today's behaviour, the default everywhere), `follows_goods` (all goods in
  the basket share one rate), `highest`. Only countries whose rule a person has verified are changed from `standard`.
- `commerce.store_tax_profile (store_id pk, vat_registered, vat_number, vat_number_checked_at, vat_number_valid, oss_scheme none|union|non_union, oss_number,
  oss_registered_on, ioss_number, ioss_intermediary, ioss_markets text[])`; `store_tax_profile` is a store setting (copied with a store except the numbers).
- `orders.vat_treatment jsonb`: `{ kind: 'standard' | 'reverse_charge' | 'ioss', sellerVatNumber, buyerVatNumber, viesResult, checkedAt, reason, iossNumber }`.
- `commerce.vat_checks (id, store_id, number, country, valid, name, address, requested_at, source)`: every VIES answer kept for audit (and cached 24 hours).

### Pure rules (`src/lib/vat-treatment.ts`, tested as a matrix)

`vatTreatment({ sellerCountry, sellerRegistered, buyerCountry, deliveryCountry, kind: goods|service|digital, buyer: consumer|business, buyerVat: valid|invalid|unknown|none, iossNumber, consignmentEur, shipsFromOutsideEu })`
returns `{ kind, rateFrom: 'destination', exempt: false, reverseCharge: boolean, reason }`. Rules, each with its source in a comment:

1. **Consumers** are charged the destination country's VAT (as today: Kaizen charges the buyer's country, which suits OSS sellers; the tax profile
   screen says plainly that a store not registered for OSS or in that country should ask its accountant, and that the threshold and origin-country
   rules are not applied).
2. **Reverse charge** (VAT taken off the order) only when the seller is established in an EU member state and VAT-registered, the buyer is a business with
   a **valid** VAT number in a **different** member state, and the goods or services are delivered to that member state. Never for consumers, never
   for the seller's own country, never when the seller is outside the EU.
3. A VIES answer of "unavailable" or "unknown" **never** exempts and **never** blocks the sale: the order charges VAT, says why, and the shopper is told.
4. IOSS: a consignment of at most 150 EUR (value without VAT) from outside the EU into an EU market by a store with an IOSS number is marked `ioss`
   (destination VAT is charged as always). Above 150 EUR it is not an IOSS sale and **pricing for it is not changed in this wave** (the buyer would pay
   import VAT at the border): the screen says so, and a store may switch the market off or accept the double-VAT risk knowingly.

### Checkout and carts

`cartSummary()` and `placeOrder()` both call `vatTreatment()` and the same net-of-VAT rounding helper (one `exVat()` rule: per line, remainder to the last
line, as the bonus and campaign shares), so they agree (`checkout-kinds.int.test.ts`). A business buyer gets a **VAT number field** (checkout piece
`checkout_company`, beside the organisation number of D63); the number is normalised, checked against **VIES** (the Commission's service, a fixed host,
4 s timeout, one retry, through the shared fetch rules, never blocking), and the check is kept on the order. With reverse charge the order's lines carry
tax 0 and the total is the net amount; Stripe is sent the order's own amounts. The order page, emails and (1b) invoice say "Reverse charge" with both
numbers in the order's language (hand-written, flagged).

### Admin

- Platform: `/admin/platform/vat` (Settings): categories and rates with history, the unverified list, coverage ("no reduced rate known" per category and
  country), edits audit-logged and applying to new carts only.
- Store: `/admin/{store}/settings/tax` (Settings, owners): registration, VAT number with a **Check now** button (VIES, or Brønnøysundregistrene for a
  Norwegian number through D124's lookup), OSS and IOSS numbers, the notes above. The product editor's VAT category select lists the active categories
  (`accommodation` only for stays and rentals).

### Acceptance (1a)

Pure matrix tests of `vatTreatment()` (every combination above, including the refusals); `vat_rate()` history (a rate change at a date, an order before and
after); the check constraint replaced by the foreign key without losing old products; a scenario per category in `checkout-kinds.int.test.ts` including a
reduced-rate product and a mixed basket, in the euro view; a reverse-charge scenario (valid, invalid, unavailable VIES with an injected fetch, own country,
consumer, non-EU seller); `cartSummary()` equals `placeOrder()` in each; the admin screens render; VIES failure never blocks (test); no VAT number appears in
anything public. E2E: a business enters a number at checkout in a test store with a stubbed VIES host (`REPLICATE_ALLOW_PRIVATE`-style test switch).

---

## 1b. Invoices and credit notes

### What exists

`commerce.invoices`, `commerce.credit_notes` and `commerce.document_series` exist in the first schema (series per store, `next_document_number()`
gap-free inside the issuing transaction, D141) and are **unused by shop orders**; the Work module issues invoices with `issue_work_invoice()` (snapshot,
readiness checks, immutable afterwards): the model to follow; an optional Stripe invoice per order (`orderInvoices`) with Stripe's numbering.

### Data

Extend `invoices` and `credit_notes` (migration): `snapshot jsonb not null` (seller, buyer, lines with quantity, unit price ex VAT, VAT rate and amount, shipping
line, discount rows, totals per rate, payments, treatment text, IOSS number, VAT total in the store's main currency at the rate of the day when the order
currency differs), `supply_date`, `public_token` (random), `pdf_path` (set once), `kind` (`order`), `order_id unique` per store for invoices, `invoice_id`+`refund_id`
for credit notes. Series `invoice` and `credit_note` per store with an owner-set prefix (default `F-`/`K-`). Triggers like the Work ones: immutable after issue except
`pdf_path` once; no delete; numbers cannot be skipped, lowered or re-prefixed; copied and host orders refused.

### Issuing (SQL functions, never application code)

- `commerce.issue_order_invoice(store, order)`: called **in the transaction that records the payment** (`complete_order_payment`), idempotent per order. Not
  issued for copied orders, host orders, unpaid orders; **a subscription's renewal order and a standing delivery's order are invoiced when paid**; an order
  paid partly at the venue (D66) is invoiced for its whole total with the online and venue parts shown. If the seller's details are incomplete (legal name,
  address, organisation number, VAT number when registered) the order still completes and the invoice waits in a queue (`/admin/{store}/invoices` shows
  "n orders waiting: complete your business details"); it is issued, with the **payment date as supply date**, as soon as the details are complete.
- `commerce.issue_credit_note(store, refund)`: for each refund that **succeeded** (the transition, however the status changes: check every path, webhook
  and `refundOrder()`), linked to the invoice. Lines: a return's refund (D153) uses the return's lines, deductions and delivery; any other refund is allocated
  over the invoice's rate buckets **pro rata to what is still uncredited**, remainder to the largest bucket (`creditAllocation()`, pure, deterministic,
  tested). A credit note can never exceed what the invoice left uncredited per rate. Bonus credit, code, campaign and group discounts are already in the lines.
- Stripe's invoice option (`orderInvoices`) is hidden and ignored when Kaizen invoicing is on (said on the settings page).

### Documents

`InvoiceDocumentView`-style presentational component drawn from the snapshot (never from live data), print routes in the `(print)` group for staff, and a
shopper page `/s/{store}/{market}/account/invoice/{token}`-style hosted page (token in the email; also reachable from the order page by the order's own key or
the signed-in owner). **PDF**: rendered from the print view by Chromium through `src/server/browser.ts` (already loaded only there; add the route to
`outputFileTracingIncludes`), on the first download and by the five-minute job, stored privately once (`documents` bucket, `pdf_path`), served by a signed
address; if Chromium fails the print page is the fallback and the failure is logged, never an order failure. The order confirmation, shipped and refund
emails link the invoice and the credit note (the refund email attaches the credit note PDF when it exists). Contents follow the EU VAT Directive's list and
the national rules of the store's country (sequential number, dates, both parties' names and addresses and VAT numbers, goods and services, VAT rate and
amount per rate, reverse-charge and IOSS statements, currency and, where required, the VAT in the national currency), hand-written texts in nb, sv, da, en
**flagged for review**.

### Admin and shopper

`/admin/{store}/invoices` (Orders section): invoices and credit notes, search, period filter, the waiting queue, reprint, **CSV export for the accountant**
(`toCsv()`: number, date, order, buyer, country, net, VAT per rate, gross, currency); the order page links its documents. The shopper's order page and My account
list their invoices and credit notes.

### Retention link

Documents are kept for the country's bookkeeping period (`retention_rules`, 1g); personal fields in a snapshot are anonymised only by
`anonymise_expired_documents()` after it (the one allowed exception to immutability, like Work's `work_importing`).

### Acceptance (1b)

DB tests (immutability, gap-free, no delete, one invoice per order, copied and host orders refused, credit note ≤ uncredited per rate, separate series, the
anonymisation function only after retention); integration scenarios in `checkout-kinds.int.test.ts` for every product kind in the euro view: invoice total = order
total, Σ invoice VAT per rate = order tax, credit notes Σ = refunds, bonus credit and code and campaign and group discounts, a venue-paid booking, a subscription
renewal, a reverse-charge order; return refund through D153 makes one credit note with its working; waiting-queue test (details completed later issues with the right
supply date); PDF generation e2e (Chromium) and the no-PDF fallback; shopper access by token, key and ownership, never another store's; CSV export formula-safe.

---

## 1c. VAT, OSS and IOSS reports

`/admin/{store}/analytics/tax` (Finance, D152) and CSV exports, one definition each in `docs/analytics.md` first:

- **VAT report**: per country and rate (shipping's rate included), for a period in the store's days: net sales, VAT, gross, orders, credit notes and refunds netted.
  It **reconciles to the Finance VAT total** and to Σ `orders.tax_minor` of the paid non-copied non-host orders (a test holds both).
- **OSS return view (quarterly)**: EU B2C sales by member state of consumption and rate: taxable amount and VAT, in euro. Two modes, stated on the screen:
  *books* (a refund or credit note counts in the period it was made, as D152) and ***filing*** (a credit note is attributed to the quarter of its **original
  invoice**, as an OSS return needs corrections by period). Conversion at the euro reference rate of the quarter's last day (ECB, fetched once per quarter and
  kept with its date; the owner can override with a reason, audit-logged). Reverse-charge and non-OSS-scheme sales are excluded and counted.
- **IOSS monthly view** (bucket B): per member state and rate for consignments marked `ioss`; live only with an IOSS number; says why when off.
- All figures are computed from invoices and credit notes where they exist and from the orders' lines otherwise, never twice; a currency with no rate is left out
  and counted (D152 rule); amounts say whether they are estimates; every export is formula-safe.

Acceptance: reconciliation tests (report = Σ order tax = Finance), a multi-currency euro scenario, refunds and credit notes in both modes with a refund in a later
quarter, copied and host orders excluded, reverse-charge excluded, the ECB rate fetch with an injected fetch and its failure (the report says "no rate"), CSV layout
test against the OSS return's fields, the view renders with a data table behind it (D152).

---

## 1d. Unit price (price per kg, litre, metre)

- Variant fields `measure_amount` (numeric) and `measure_unit` (`g, kg, ml, cl, l, cm, m, m2, piece`), product flag `sold_by_measure`, and the reference quantity
  (default 1 kg, 1 l, 1 m, 1 m2, 1 piece; 100 g or 100 ml where the rule allows for small quantities). Multi-pack: the measure is the pack's total.
- `unitPrice(shownMinor, measure, reference)` in `src/lib/unit-price.ts`: integer maths on the **shown** price (VAT treatment as shown, converted per market with
  `shown()`), half-up to the minor unit; a reduced price shows the unit price of the price **charged**.
- Shown wherever the price is: `<Price>` (a line under it), listing cards, cart lines, checkout, the order page and emails; JSON-LD `unitPricingMeasure` and
  `unitPricingBaseMeasure`. Refused: `sold_by_measure` without a measure. Not applied to appointments, stays, rentals and downloads.
- Editor: the measure fields with a live preview of the unit price; the category hint for goods usually requiring it (food, drink, cleaning) is a nudge, not a rule.

Acceptance: pure rounding table; the shown unit price equals the one computed from the charged price in a euro-view scenario, with a code, a campaign and a business
buyer; JSON-LD test; listing, cart, checkout, order and email render tests; the editor refuses a missing measure; subscriptions show the unit price per delivery.

---

## 1e. Legal starters, terms at checkout, accessibility, PCI hardening

**Legal starter pages.** A store creates **draft** starter pages for privacy, terms of sale, shipping, returns, withdrawal information and imprint, in nb, sv, da and
en, hand-written, each with a visible *draft: needs legal review before use* notice, filled from the store's own facts (legal name, address, organisation and VAT numbers,
contact, markets, shipping rates and times, return settings from D153, payment methods) as rich text through the builder's own save (`savePage` as a draft, never
published for the owner). Regenerating makes a new draft; it never overwrites. Starters stay out of the sitemap until published. New **page roles** (`terms`, `privacy`,
`returns_policy`, `shipping_policy`, `imprint`, D112 mechanism) name the page used for each place.

**Terms at checkout.** A checkout setting (`link` default, `checkbox`, `off`) shows "By ordering you accept the terms and the privacy statement" with links to the role pages
beside the order button (a checkout piece `checkout_terms`, D117), a required checkbox when chosen, and records on the order `terms_accepted_at` and a snapshot of the
pages as they were (`commerce.legal_snapshots`: store, content hash, page id, title, content, deduplicated by hash). Staff see the snapshot on the order page.

**Accessibility.** `@axe-core/playwright` (a dev dependency) runs in CI over the key storefront pages (front, product, cart, checkout, order, account, withdraw), light and
dark, and the admin's entry pages, failing on serious or critical issues. The page builder lists a draft's issues (picture without alt, heading order, empty link or button,
text over a background under 4.5:1) with a link to the block, and publishing with an unresolved blocking issue asks first and records the owner's choice in the audit log.
An **accessibility statement** generator (conformance status, known issues, contact, the enforcement body per country with its source and date, nb, sv, da, en, flagged for
review) makes a draft page. An independent audit is outside this row and never counted by code.

**PCI.** Card entry stays in Stripe's payment form; a strict Content-Security-Policy is sent on cart, checkout and order routes (the real policy is worked out against Stripe's
documented requirements and `cacheComponents`, noted in `docs/pci.md` with the SAQ A criteria as read from the PCI Security Standards Council's pages); the consent manager, the
owner's custom code and the chat widget are not drawn on those routes and a test fails if a checkout route imports them.

Acceptance: starter pages exist in four languages with merged facts and the notice, are drafts, are out of the sitemap, the role links resolve; terms at checkout in each mode with
the acceptance and snapshot recorded; axe in CI on all listed pages (a known-failing fixture proves it fails); builder issue checker unit tests; the statement generator; the CSP
header test and the import test.

---

## 1f. Staff security: two-step sign-in, roles, audit log

**Two-step sign-in.** Supabase Auth's TOTP MFA (enrol, challenge, verify; session assurance level 2) with our own **recovery codes** (`commerce.account_recovery_codes`,
hashed, single-use, regenerated on request): a recovery code removes the account's factors through the admin API, writes the audit log and forces re-enrolment at the next
sign-in. `getAccount()` exposes the assurance level; the admin layout and `requireMember()` hold a signed-in staff member without the needed level at the enrolment or
challenge page. Required for platform admins; an owner can require it for the store (`stores.require_two_step`), and a member without a factor is held at enrolment.
Passkeys are not in this wave (Supabase's MFA does not offer them as a second factor today; said in the doc). Enrolling, removing a factor, a failed second step and a
recovery-code use are audit-logged.

**Roles and permissions.** `commerce.store_roles (store_id, id, name, permissions text[])`, `store_members.role_id` (the enum roles `owner` and `admin` stay as system
roles: owner everything, admin as today). Permissions are `{section}:{read|write}` for the store-nav sections (orders, products, customers, marketing, website, bookings,
analytics, settings, billing, staff); a role template set (orders, products, marketing, content, analytics, read-only) is seeded per store by `clone_store()`. `ADMIN_PAGES`
already carries each page's group, so **the section is derived from the page's group** and a test fails when a page lacks one. `requirePermission(storeSlug, key)` replaces
the bare `requireMember()` in every admin page and server action: a member without it gets a 404 or a refusal; a test scans every admin `actions.ts` and page for it. The
navigation hides what a member cannot use. The AI manager's owner tools each declare a permission and the handlers check the signed-in member's (and the store's MCP server
checks the connected owner's). The store keeps one active owner (the trigger test stays). Collaborators: an invitation with a role and an **expiry** (`store_members.expires_at`,
`kind staff|collaborator`) sent to an agency's account, shown as a collaborator in the staff list, ended by the daily job.

**Activity log.** `audit_log` gains `area`, `target_type`, `target_id` and `changes jsonb` (changed fields, secrets never; a field allowlist per area), the existing entries
get `area` from their action prefix, and `auditChange(…)` writes the diff for products, prices, pages, discounts, shipping, staff and payment settings. `/admin/{store}/activity`
(Settings): who did what and when, filtered by person, area and period, paged, within the viewer's permissions; owners export CSV. Entries cannot be updated or deleted by the
app (database triggers refuse); pruning after the stated period (default 24 months, `docs/decisions.md`) is the one allowed deletion and lives in the cron's application code.

Acceptance: MFA flow tests with Supabase's test hooks or an injected client (enrol, challenge, wrong code, recovery code single-use, required-for-store hold, platform admin
required); a role matrix test (each seeded role against each page group and a sample of server actions); the scan tests; the AI tool permission test; collaborator expiry; the
log filters, CSV and the immutability triggers; another store's entries never appear.

---

## 1g. GDPR export, erasure and retention

- **Register**: `PERSONAL_DATA` (`src/lib/personal-data.ts`), every table or column that holds a customer's personal data with how it links to the customer (id or lowercase email),
  what the export contains, and what erasure does (delete, anonymise, restrict, keep for law). **A test fails when a table with `customer_id`, `email`, `phone`, `address` or `name`
  columns is not in it** (the `COPY_RULES` pattern).
- **Export**: `exportCustomerData(store, customer)` returns one JSON file (profile, addresses, orders with lines, payments' non-secret facts, refunds, returns and withdrawals,
  invoices and credit notes references, subscriptions, deliveries, bookings, wishlists, bonus ledger, referrals the customer made, consents, emails sent, custom-field values, company
  membership). The shopper downloads it from My account after a fresh sign-in; staff with `customers:write`/`export` download it from the customer page; both audit-logged. Another
  store's data is never included (a customer who shops in two stores has two exports).
- **Erasure**: staff and the shopper's own delete remove the account and personal profile as today and now also what the register says (sessions, carts, wishlists, standing
  orders, saved cards, addresses, consent rows' identifiers, email log bodies); **orders and invoices under the bookkeeping duty are restricted, not deleted**: they keep their
  personal fields until the retention period ends, then `anonymise_expired_documents()` and the retention job replace name, address and email with a marker, keep totals and VAT, and
  leave the gap-free numbers. The confirmation says what stays and why and for how long.
- **Retention schedule** (`commerce.retention_rules`, per kind and country, each with source and `checked_on`, flagged for accountant review: orders and invoices by the national
  bookkeeping act, emails, search queries 90 days (exists), carts, visits 25 months (exists), consents 12 months (exists), audit log 24 months, confirmed withdrawals with the order),
  run daily by `runRetention()` in application code; a test shows what it removes and what it keeps for a fixed clock.

Acceptance: the register test, an export of a customer with every kind of data (round-trip counts per section), multi-tenant isolation, an erasure scenario (before and after the
retention date), the anonymisation function leaves totals and numbers, the retention job's keep/remove table, audit entries for export and erasure, the shopper's download needs a
fresh sign-in.

---

## Decisions taken with defaults (say if one is wrong)

| Question | Default |
|---|---|
| Destination VAT for every consumer sale (as today), with a plain warning for non-OSS stores | kept; threshold and origin-country VAT not implemented |
| IOSS above 150 EUR (no VAT at checkout) | not in wave 1: marking and reports only |
| Reverse charge scope | EU-established VAT-registered seller, valid buyer number in another member state, delivery there |
| Missing reduced-rate row | standard rate, said on the admin screen |
| Shipping VAT | `standard` everywhere until a person verifies a country |
| Invoices | issued in the payment transaction; queued when the seller's details are incomplete |
| PDF | Chromium from the print view, stored privately once, print page as fallback |
| Credit note timing | when the refund has succeeded |
| Passkeys | not in wave 1 (TOTP only) |
| Audit log retention | 24 months, pruned in application code |
| Retention periods | seeded from each country's bookkeeping act with source and date, flagged for accountant review |
| New dev dependency | `@axe-core/playwright` only |
| Statutory texts | hand-written, flagged for legal review, never machine-translated |

## Risks

The VAT and invoice rules are where a wrong default costs real money: every rule has a source, a date and an owner-visible warning, and the pure functions are the single place to fix them.
Replacing `requireMember()` with permissions touches every admin action: the scan tests are what keep a forgotten one from being open. Credit notes depend on refund status transitions that
have several paths: the unit must enumerate and test them all. Chromium for PDFs adds a runtime dependency to a customer-facing download: the print-page fallback and the stored PDF keep it
off the critical path. The production migrations for this wave are several and some contain deletions in functions: expect the migration tool to cancel those and plan for the owner to run them.
