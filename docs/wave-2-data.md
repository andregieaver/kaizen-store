# Wave 2: data in and out (CSV for products, orders and customers; reports; bulk product editing). Decision D165 proposed

The contract for the first run of wave 2 of `docs/parity-plan.md` ("Import and export pipeline: CSV for products, orders and customers,
reports, bulk product editing"). It closes five tracker rows. Code, tests and texts follow this file, and a disagreement is settled here
first. **This file is documentation only: nothing here is built yet.** The model for the shape is `docs/returns.md` (D153) and
`docs/wave-1c-reports.md` (D161, whose CSV export route, log and formula-safe `toCsv()` this run builds on).

This run builds **one job pipeline** (`commerce.data_jobs`) and four things on it: a product import and export, an order export, a customer
export and a bulk product editor, and it adds a CSV download to every analytics table. It does not build the Shopify and WooCommerce
migration importers beyond reading a Shopify *product* file, the redirect manager, scheduled report emails or accounting exports (section 7):
those are other rows of wave 2, for later runs that reuse the job table made here.

Nothing here is legal advice. Every rule that comes from a law is written with its source and marked where a person should still read it
(section 8). The admin is English only, so this run adds **no consumer-facing text**; the staff-facing warnings it adds are listed in
section 8 for a read all the same.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Bucket | What this run does | Honest rating when the run is done |
|---|---|---|---|---|
| `catalogue.bulk-product-import-and-export-csv` | 4 | A | All four criteria: export of every product and variant (as a job for large stores), import of a Kaizen file and a Shopify file with a dry run and a resumable apply through `saveProduct()` and `commerce.set_price`, a round trip that changes nothing, size limits and an audit entry, archived variants switched off and never deleted. | **full**. Caveat said in the row's history: the Shopify reader is held to Shopify's published template and its documentation (section 1.2), not to every file a Shopify store can produce. |
| `catalogue.bulk-editing` | 3 | A | All three criteria: a multi-select list with confirmed bulk actions, a grid with preview and undo, per-request limits, one audit entry per batch, failures listed with their reason. | **full**. |
| `orders.order-export-to-csv` | 4 | A | All four criteria: orders of a date range or a selection (by order numbers, section 2.4), one row per line, order currency and main currency, VAT split out; a large export as a job delivered by a link; formula-safe; one store only. | **full**. The word "selection" is met by a pasted list of order numbers and an *Export this order* button, not by tick boxes in the order list (that list is wave 3's, section 7). |
| `analytics.export-reports-to-csv` | 4 | A | All four criteria: a CSV for every analytics table for the chosen period and comparison, orders and customers as store-scoped exports, `toCsv()`, no access without the role. The VAT, OSS and IOSS files of D161 stay as they are and count. | **full**, held by a scan test that fails for an analytics table with no export (section 6.4). |
| `platform.product-customer-and-order-csv` | 4 | A | Criteria 1, 2 and 4 in full (a round trip with custom fields; dry run then resumable job; `toCsv()`), and criterion 3 except the customers' **marketing-consent state**. | **partial**, not full, and the reason is not code: Kaizen records no marketing consent today (no column, no table; the only list is `email_opt_outs`, which holds people who unsubscribed from cart reminders). Wave 5 builds the subscriber list with consent (`docs/parity-plan.md` section 3). Inventing a consent flag in an export would be a legal statement the store cannot back, so the file says `not_recorded` (section 2.5). The lead decides under criteria changes (section 6.5): reword criterion 3, or hold the row at partial until wave 5. This spec recommends rewording and rating **full** after that reword; without it, **partial**. |

None of the five rows is bucket B, C or D, none needs an owner decision from `docs/parity-plan.md` section 5, and no credential stops the work
(storage is Supabase's, in the existing EU project; no new vendor, no new secret). Ratings are changed by `history` entries and
`pnpm parity:write` at the end of the run, from what the tests hold. The rows are not edited in this spec.

Two of the five rows overlap with another: `catalogue.bulk-product-import-and-export-csv` and `platform.product-customer-and-order-csv` are
the same Shopify feature ("CSV import/export of products") in two domains, and the platform row also repeats the orders, customers and
analytics rows. `docs/parity/README.md` rule 8 says one Shopify feature is one row. Section 6.5 proposes the merge; this run does not edit rows.

### 1.2 What Shopify does (read 2026-10-05 unless stated)

- **Product CSV** (<https://help.shopify.com/en/manual/products/import-export/using-csv>, fetched): products are matched by URL handle; an import
  can "overwrite products with matching handles"; non-required blank columns overwrite existing values and omitted columns keep them; the file is
  UTF-8; CSV cannot delete products in bulk. At most 3 options, 250 images and 250 tags per product. Current column names include Title, URL handle,
  Description, Vendor, Product category, Type, Tags, Published on online store, Status, SKU, Barcode, Option1 name / value / Linked To (to 3), Price,
  Compare-at price, Cost per item, Charge tax, Tax code, Unit price total measure and base measure (with units), Inventory tracker, Inventory
  quantity, Continue selling when out of stock, Weight value (grams), Weight unit for display, Requires shipping, Fulfillment service, Product image
  URL, Image position, Image alt text, Variant image URL, Gift card, SEO title, SEO description, Google Shopping columns, `Price / {Market}`,
  `Compare At Price / {Market}`, `Included / {Market}` and product metafields (variant metafields are not supported). "Inventory quantity" applies to
  single-location stores only. Older files use other names (Handle, Body (HTML), Image Src, and so on); Shopify "maintains backward compatibility".
  The page states **no file size or row limit and shows no preview**. The real header row and two data rows were read from Shopify's template
  <https://help.shopify.com/csv/product_template.csv> (fetched 2026-10-05): one row per variant, the handle repeated, product-level cells empty on
  continuation rows, extra pictures as rows carrying only the handle and a picture.
- **Order export** (<https://help.shopify.com/en/manual/orders/export-orders>, fetched): by date, current page, selected orders (up to 50 download at
  once) or all; more than 50 are emailed to the staff member and the store owner; complete order data or transaction histories; 70+ columns (order,
  dates, prices, line items, addresses, payment, tags, notes); an export of 100,000 items "might complete in under an hour". The page names no
  permission and no time-zone rule.
- **Customer export and import** (<https://help.shopify.com/en/manual/customers/import-export-customers>, fetched): current page, all, selected or a
  segment; under 50 download, more are emailed; import file at most 15 MB, UTF-8, duplicates by email or phone skipped, an overwrite option;
  columns include Accepts Email Marketing / SMS / WhatsApp (yes/no), addresses, Note, Tags, Tax Exempt; Total Spent and Total Orders are not importable.
- **Report export** (<https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/finances-report>, read by the row on
  2026-10-03): reports export for spreadsheets and "all reports support CSV export beyond on-screen row limits". The page
  <https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/export-shopify-reports> was fetched on 2026-10-05 and says nothing about
  formats, limits or email.
- **Bulk editor** (<https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-editing>, fetched): select items, open the bulk editor, a
  table with a column per property, edit cells and save; invalid values (a missing SKU) stop the save; multi-variant inventory is edited from the
  Inventory page; CSV is recommended for large volumes. The page mentions no undo and no item limit.

Where Kaizen goes further, on purpose: a **dry run** that lists every row's problem before anything is written, a job that stops and goes on,
formula safety written into the pipeline, an audit entry per job, an **undo** for the bulk grid, and a file that carries only the member's own store.
Where Kaizen stays behind, on purpose: no Shopify-style email of the file (a link to the signed-in member instead, section 2.3) and no import of
customers or orders (section 7).

### 1.3 Sources and what was not read

| Source | Used for | Read |
|---|---|---|
| The Shopify pages above | The Shopify side, the Shopify column names, the 15 MB figure | 2026-10-05 (the report-export page: nothing on exports) |
| OWASP, *CSV Injection* <https://community.owasp.org/attacks/CSV_Injection> | Which leading characters make a spreadsheet run a cell: `=`, `+`, `-`, `@`, tab (0x09), carriage return (0x0D), line feed (0x0A); mitigations: prefix with a single quote, or quote the field | 2026-10-05 |
| Regulation (EU) 2016/679 (GDPR) Art. 5(1)(c) minimisation, 5(1)(e) storage limitation, 5(1)(f) and 32 security, 25 data protection by design | Why a customer or order file has a *minimal* profile by default, expires, is private and is never emailed | known text, not re-read; section 8 |
| Directive 98/6/EC Art. 6a (inserted by Directive (EU) 2019/2161, the Omnibus Directive) | An announced price reduction is compared with the lowest price of the previous 30 days; Kaizen derives that from price history (`prior_30d_minor`), so a bulk price change must go through `commerce.set_price` | known text, not re-read; the code side is `CLAUDE.md` "Money is integer minor units… advertised reductions use `prior_30d_minor`" |
| Regulation (EU) 2023/2854 (Data Act) Chapter VI, Art. 23 to 26, applying from 12 September 2025 | Providers of data processing services must let a customer switch and port "exportable data" in a structured, commonly used, machine-readable format, and keep a register of the formats. Whether Kaizen is such a provider, and what its register must say, is **not decided here** (section 8). The exports of this run are the practical answer in any case. | search result only (<https://www.springlex.eu/en/packages/data-act/data-act-regulation/article-25/> and others), not the EUR-Lex text; EUR-Lex CELEX:32023R2854 could not be fetched |
| RFC 4180 (CSV) | Quoting, CRLF, one header row | known text |
| Existing code | `src/lib/dac7.ts` `toCsv()`/`decimalAmount()`, `src/server/products.ts`, `src/lib/product-input.ts`, `src/server/tax-report-exports.ts`, the analytics views, the store-copy job | read for this spec |

---

## 2. Behaviour

Everything below is staff-side or platform-side. **There is no shopper-facing surface in this run** and nothing a shopper can reach changes,
except that products written by an import or a bulk edit appear on the site through the same cache tags as the editor's saves (section 5.3).

### 2.1 Product export

Page `/admin/{store}/products/export` (needs `products:read`; a link *Export* on the products list).

1. The member chooses: **which products** (all, the current status filter active/draft/archived, or the products of a category or tag), **the file's
   dialect** (section 2.7), and whether to **include pictures' addresses** (default yes). *Export* starts it.
2. A store with at most `DIRECT_EXPORT_MAX_ROWS` (2,000) variant rows gets the file at once as a download (POST, same site, section 5.2). Larger
   stores get a **job**: the page says "Preparing your file", shows rows done and total, and keeps working if the member leaves (the open page
   asks for the next step, the five-minute cron takes over, as the store copy does, section 5.3). When the job is done the page shows the
   file(s) with their size, row count and the time they expire (7 days) and a **Download** button per file.
3. The file has **one row per variant**, grouped by product, the product's cells on the first row of the product only (as Shopify's file is), and
   extra pictures as rows that carry the handle and a picture only. It is in the Kaizen layout of section 4.1 and re-imports as it is.
4. What is **not** in the file, and the page says so: purchase options (subscriptions), download files, booking settings, staff and seasons of an
   appointment, stay or rental, and custom fields of types that are not plain values (section 4.1.4). They are neither written nor removed by an
   import (section 2.2 rule 9).

### 2.2 Product import

Page `/admin/{store}/products/import` (needs `products:write`) and `/admin/{store}/products/import/{jobId}`.

1. **Upload.** The member chooses a `.csv` file (at most `IMPORT_MAX_BYTES`, 15 MiB). The browser uploads it straight to the private `imports`
   bucket with a signed upload address (as download files are, `startFileUpload()`), then the page registers it. The server reads it, detects the
   **format** from the header row (Kaizen or Shopify, current or older names; neither: the problem *This is not a product file we know* with the
   header it found and the two accepted layouts) and the **delimiter** (comma, semicolon or tab, because Excel in Norwegian, Swedish and Danish
   saves with semicolons and decimal commas) and the **encoding** (UTF-8, with or without a byte order mark; a file that is not valid UTF-8 is read as
   Windows-1252 and says so as a warning, so æ, ø and å survive a file saved from Excel's plain *CSV*).
2. **Options** (a form on the same page, defaults in bold): *What to do*: **create new and update existing** / only create / only update.
   *A product that cannot be published* (no picture, no manufacturer for physical goods, no price): **save it as a draft and list why** / skip it.
   *Manufacturer for new physical products with none in the file*: **none** or one of the store's economic operators (so a Shopify file, which has
   a Vendor and no GPSR manufacturer, can become active at once). *Variants of an existing product that are not in the file*: **keep** / switch
   off. For a Shopify file: *Do the prices in the file include VAT?* (no default; the member must choose, section 4.3) and, when the file has
   market prices, a note of which Kaizen market each column was matched to.
3. **Dry run.** *Check the file* runs the whole import without writing a product. It is a job like any other (a large file takes minutes). The
   result page shows: the counts (**to create**, **to update**, **unchanged**, **with problems**), then a table of every row's finding: row
   number(s), the product's handle, SKU, severity, the stable code (section 4.4) and a plain sentence, filterable by severity, downloadable as a CSV
   of problems (`toCsv()`). Severities: **error** (the product is skipped: nothing of it is written), **warning** (written, with a note), **info**
   (a column that was ignored and why). Nothing has changed in the store.
4. **Apply.** *Import* is offered only for a job whose dry run finished on **the same file** (the SHA-256 is stored and checked) and whose
   options have not changed since. A confirmation says the counts and "Products are saved one at a time; a product with an error is left as it
   was. You cannot undo an import as a whole; a bulk edit can be undone (section 2.6)." The job then runs in steps, one product per database
   transaction. **Each product is checked again at write time** (the dry run is advice: stock, prices, SKUs and categories may have changed).
   Progress shows done / total and the running counts.
5. **Result.** When done, the same table of findings with the outcome of each product (**created**, **updated**, **unchanged**, **skipped**,
   **saved as draft**, **failed**), the number of prices that changed, pictures fetched, and the audit entry's reference. A *Download problems* CSV.
6. **Resume.** A job that stops (the server restarted, a time limit) is taken up again by the next tick from where it was (the cursor is a
   product index; a product that was written but not yet recorded is recorded as **unchanged** on the second look, which is true). After
   `DATA_JOB_MAX_ATTEMPTS` (6) attempts without progress the job is **failed** with a plain reason and keeps what was written.
7. **Cancel.** A running job can be cancelled; it stops after the current product and says how many were written.

Import rules (each has a test, section 6):

1. **Match.** A product is matched by `handle` within the store. A variant is matched by `variant_id` when the column is there (Kaizen format) and
   belongs to this store's product, else by `sku` within the product. A SKU that belongs to **another** product of the store (active or not:
   `product_variants_store_sku_key` is unique per store) is an error for that product (`sku.in_other_product`), never a move of the variant.
   The same handle on two products in the file, or the same SKU twice in the file, is an error for the file's later rows.
2. **Never delete, never move a URL.** No product, variant, price or picture row of a product *outside the file* is touched. A product's **handle is
   never changed** by an import (there is no redirect manager yet, section 7): a file whose `variant_id` or SKU lands on a product with another handle is
   `handle.mismatch`, an error. An existing variant not in the file is kept, or with the option on is **switched off, never deleted** (the editor's
   own rule: `saveVariants()` sets `active = false`).
3. **Blank means clear, absent means keep.** A column that is in the file and empty for a row clears that value (an empty price cell ends the
   price in that market, an empty `title:sv-SE` removes that translation, as the editor does); a column that is **not in the file** is not touched.
   The dry run counts what would be cleared as a warning (`value.cleared`) so a blank never surprises.
4. **Through the editor's own door.** An existing product is read with `getProductForEdit()` into the editor's `ProductInput`, the file's values
   are laid over it, and the result is saved with `saveProduct()` (so `productProblems()`, the unit-price rules, the VAT-category check, the
   publishing triggers and `commerce.set_price` apply unchanged and the parts the file does not carry, section 2.1 point 4, are kept by
   construction). A new product starts from `emptyProduct()`. No import code writes `products`, `product_variants`, `prices` or
   `inventory_levels` itself (a scan test, section 6.1).
5. **Unchanged is not saved.** When the laid-over `ProductInput` equals the stored one after normalisation, nothing is written: no `updated_at`
   change, no price row, no search or embedding refresh. This is what makes the round trip (section 6.1) hold.
6. **Prices.** Prices are read as the editor reads them: `parsePrice(text, market.currency)`, in the **country's own currency**, never converted;
   the file's decimal mark may be a point or a comma. In a store selling only to businesses the editor types prices **without VAT**; the Kaizen file
   says which basis it holds in a `price_basis` column (`incl_vat` / `excl_vat`) and an import whose basis differs from the store's current one is
   a file-level error. A price that equals the stored one is not written (no `set_price` call, no new price history row). **A "compare-at" price
   is never imported:** Kaizen derives an advertised reduction only from its own price history (Directive 98/6/EC Art. 6a, see section 4.5), so the
   column is ignored with an info finding that says why.
7. **Stock.** `stock` is set on the store's one active location through `saveProduct()` (the editor's rule). Digital variants keep none. Since wave 3
   (D172) a store can have several locations: with more than one **active** location the `stock` column is the total of them and is **not imported** (it cannot
   say which location a count is for): the finding `inventory.multi_location_stock_ignored` (warning, once per product) says so and the rest of the row is imported.
   Counts per location are the stock file (`docs/wave-3-inventory.md` 2.4). `stock_policy`, `backorder_days` and `low_stock_threshold` are read per variant: an
   empty policy or days cell keeps what the variant has, `deny` drops the days, `continue` needs days from 1 to 90 (`backorder_days.required`), an empty warning
   level switches the warning off, and a download, service or booking takes none of the three (`stock_policy.not_goods`, `low_stock_threshold.invalid`). A
   settings change moves no stock and writes no movement.
8. **Pictures.** A picture address in the file that is not already one of the store's own pictures is **fetched by the server** with `safeFetch()`
   (never a plain `fetch` of an address a person typed: `CLAUDE.md` replicator rule), at most 10 MB, `image/jpeg|png|webp|gif|avif` only, shrunk
   with `sharp` to a 1,600 px WebP and a 480 px thumbnail, stored in the store's media library (`uploadToLibrary()`, the name from the address) and
   written to the product as the library's address; the product never points at the original site. A picture that cannot be fetched is left out
   with a warning (`media.fetch_failed`), and a product that is then left with none and is to be active becomes a draft. Fetched pictures are
   remembered per job by address (`data_job_assets`, section 3), so a resumed job does not fetch twice. A product has at most `MAX_MEDIA` (12)
   pictures; more are an error for the product (`media.too_many`), because Shopify allows 250 and cutting silently would hide the loss.
9. **What an import does not carry.** Subscriptions, download files, booking settings and custom fields of non-plain types are neither read nor
   written. Importing a **new** product of kind `appointment`, `stay` or `rental` is refused (`kind.not_importable`: create it in the editor, which asks
   who does it); an existing one is updated in the plain columns only.
10. **Terms.** `categories` and `tags` are matched by name within the store (a category path `Parent / Child`); one that does not exist is
    **created** when the job applies (`createTerm()`, the dry run says how many), never merged by guess. Shopify's `Product category` (its own standard
    taxonomy), `Type` and `Vendor` are ignored with an info finding; `Vendor` is **never** turned into the GPSR manufacturer (that is a legal
    designation the owner makes on purpose).
11. **Size and rate.** At most `IMPORT_MAX_PRODUCTS` (5,000) products and `IMPORT_MAX_ROWS` (60,000) rows per import; a larger file is refused at the
    upload with the numbers and "split it". One import and `DATA_EXPORTS_ACTIVE_MAX` (3) exports run per store at a time. Another store's job is
    never visible (every query carries the store id).
12. **Audit.** Entries per job, not per product: `products.import_started` when the apply starts and `products.import_applied` when it ends (counts, job id,
    format, file name, never a cell); the dry run writes nothing but the job row. The per-product entries of `saveProduct(…, actor)` are **not** written during a
    job (a 5,000-product import would bury the activity log); the job's items (section 3) are the record of which product changed, and the price
    history is in `commerce.prices`.

### 2.3 Order export

Page `/admin/{store}/orders/export` (needs the **owner** role, section 5.4), linked from the orders list (*Export*) and from an order's page
(*Export this order*, which fills the selection).

1. The member chooses **what**: a **date range** (first and last day, the store's days in `stores.time_zone`, by the day the order was placed) or a
   **selection** (a pasted list of order numbers, at most 500, with unknown numbers listed back); **which orders**: *paid orders* (default: those with
   a captured payment, cancelled-but-paid ones included, as analytics counts a paid order, `PAID` in `src/server/analytics-sql.ts`) or *all
   orders including unpaid checkouts*; **layout**: *one row per order line* (default, the criterion) or *one row per order*; **profile**:
   *Accounting* (default: no contact details) or *Full* (adds the buyer's email and the addresses); whether to **include copied history** (default off, 2.3.5);
   and the dialect (2.7).
2. At most 2,000 rows: the file downloads at once. More: a job, delivered like 2.1. Whichever way, **nothing is emailed with the file**. When a job
   is done the requester gets one email (`data_job.ready`, to staff, never with the file or a link that works without signing in: a link to the
   admin page, which asks for the sign-in) and the page shows the Download button. The download is a short-lived signed address (60 s) made when the
   button is pressed (POST) and logged; there is no standing public link.
3. The file's columns are in section 4.2. Every amount is an **integer minor unit turned into a decimal by `decimalAmount()`** (never a float), in
   the **order's own currency**; the **main currency** columns are given as well, converted at the store's rate in force *when the file is made* (the
   same rule as analytics, `toMain()`), with the rate used in the file, and are blank, with `main_converted = no_rate`, for a currency the store has
   no rate for. They are indicative, not for a tax return (OSS and IOSS use the ECB rate and the documents, D161).
4. **VAT split out.** Each line has its rate, its net and its VAT as stored on the order line (`tax_rate`, `total_minor - tax_minor`, `tax_minor`).
   The order's shipping VAT is the order's `tax_minor` less the lines' (never recomputed); a reverse-charge order shows `vat_kind = reverse_charge`
   and the VAT not charged (`vat_relief_minor`).
5. **Special orders.** A **copied** order (`copied_from` set, number `C-…`) is history, not sales: it is left out unless included, and then every
   row carries `copied = true` and the number says `C-`. A **host's** order (`host_id` set) is included and carries `host_order = true` with the store's
   commission in `commission`. An order **paid in Stripe's test mode** (the test `commerce.invoice_eligibility()` makes: a payment on the store's test account, or a venue payment made while the store was in test mode) is included, as analytics counts it, and carries `test_payment = true`: it is a try-out, not a sale, and has no invoice, so the VAT reports leave it out; the page says an accountant's file should not include `test_payment = true` rows. An order whose person was erased (`restricted_at` or `anonymised_at` set, D162) is exported **without any personal
   field** whatever the profile (email, names, phone, addresses, company and VAT number are `[removed]` or empty, country stays): the bookkeeping
   duty keeps the order, but a fresh file is not the place to copy a person's data again. An appointment, stay or rental order is exported like any
   order; its time is not in this file.
6. **Refunds.** `refunded` is the sum of the order's **succeeded** refunds in the order's currency, with the count and the last refund's date; a
   line-level refund split is not in this file (refunds are order-level in the data).
7. The file is **not** a statement of account, an invoice register or a return: the VAT, OSS and IOSS files of D161 and the invoice and credit note
   CSV of D159 stay the accountant's documents. The page says so.

### 2.4 Customer export

Page `/admin/{store}/customers/export` (needs the **owner** role). One row per customer as the Customers page lists them: everyone with an account and
every guest with a paid order, **one per email** (case-insensitive). A customer's row never carries a password hash, an auth id, a session, a sign-in
code, an avatar path, a referral code or a token. An email that belongs only to an erased person's order is not a customer. Columns in section 4.3,
including the custom fields staff entered about customers (`field:{name}`), read in **one batch** (section 5.3), and the two consent columns of
section 2.5. Same delivery as 2.3. The page says: "This file contains personal data. Keep it only as long as you need it; it is deleted from here
after 7 days."

### 2.5 What the customer file says about marketing consent

The file has `email_opt_out` (`true` when the address is on the store's unsubscribe list, `commerce.email_opt_outs`) and `marketing_consent`, which
is **always the word `not_recorded`**. Kaizen has no record of a customer's consent to marketing yet; a blank or a `false` would claim one. The
page says "Kaizen does not record marketing consent yet. Do not treat this file as a mailing list." Wave 5's subscriber list changes this column to
the recorded state and its source and date; the header name stays (section 4.3).

### 2.6 Bulk editing

**The list.** The products list (`/admin/{store}/products`) gets a tick box per row, a *select the whole page* box, and *Select all N matching* (the
current search or status filter) capped at `BULK_MAX_PRODUCTS` (500) per request, said in words when more match. With any selected, a bar offers:
**Set status** (draft, active), **Archive** and **Unarchive**, **Add to category / tag**, **Remove from category / tag**, **Change price** (a
percentage or an amount, per market, section 4.5), **Set stock**, and **Edit in a grid** (at most `BULK_GRID_MAX_PRODUCTS` (50) products, with their
variants). Every action ends in **one confirmation** that says what will happen to how many products and, for a price, shows the first five
before and after figures and the sentence "Lowering a price shows shoppers a reduction against the lowest price of the last 30 days." Applying runs
in chunks of 25 products, each product in its own transaction, and then shows the result.

**The rules of every bulk action.**

1. It goes through the editor's door: `getProductForEdit()`, the change laid over, `saveProduct()` (so a bulk change is validated exactly as an editor
   save and prices only change through `commerce.set_price`). A product the editor could not save (an active product that has lost its picture, say)
   **fails with the editor's sentence** and is listed; the others are done. There is no half-saved product.
2. **Archive and unarchive** use `setArchived()` (no editor save). Unarchive returns a product as a **draft**, as the editor's button does.
3. **Set status to active** is the editor's publish check; a product that cannot be published fails with the reason.
4. **Change price** applies to the chosen **markets** (default: the store's main market, so a percentage never silently rewrites every country's
   price): by a **percentage** (-90 to +500, two decimals) or by an **amount** in the chosen market's currency (several markets with different
   currencies need one amount each; one amount is never applied across currencies). Arithmetic is on integer minor units, half up (section 4.5). A result below
   0 is a failure for that variant (`price.negative`); a variant with no price in the market is left alone. The amount is the price **as the editor types it** (so a business-only store changes its
   prices without VAT).
5. **Set stock** sets a number (0 to 1,000,000) or adjusts by a signed number (a result below 0 fails); digital variants are skipped with the reason.
6. **Limits per request:** `BULK_MAX_PRODUCTS` 500 for a list action, 50 for the grid; a request over it is refused with the numbers.
7. **One audit entry per batch** (`products.bulk_edited`: action, count of products, succeeded, failed, the batch id; never a title or a price per
   product), plus the batch's items in `bulk_edit_items` (section 3) which carry before and after per product and field.
8. **The result lists every failure** (product title or handle, SKU where it applies, and the reason) and the count of changed, unchanged and
   failed products.

**The grid** (`/admin/{store}/products/bulk?ids=…`, needs `products:write`): a table, one row per variant, columns **Product**, **Options**, **SKU**, one
**price** column per chosen market (default the main market, up to 4), **Stock**, **Cost** (main currency, without VAT). Cells are typed text (prices as the
editor types them). The page keeps the edits in the browser until *Review changes*: a list of every changed cell with before and after, the
number of products and variants, and what is invalid (in red, with the editor's own sentence: an unreadable price, a SKU already in use). Nothing is
written until *Apply*. Each row carries the value it was loaded with; if the stored value changed in the meantime the cell is a **conflict** and is
not overwritten (listed, with the current value). After *Apply* the page shows the result and **Undo this change** for `BULK_UNDO_DAYS` (7): undo puts
each cell back to its **before** value **only where the current value is still the batch's after value** (a cell changed since is left and listed as a
conflict). An undo is a batch of its own, with its own audit entry (`products.bulk_undone`), and a price undone is a new price row in the history, as
any price change is (Omnibus: the history is what is true). SKU edits go through `saveProduct()` too; a SKU in use elsewhere fails as the editor says.

### 2.7 The file dialects

Every export form offers: **Standard** (comma, decimal point, UTF-8 without a byte order mark: for other systems and for the Kaizen and Shopify
import) and **Excel (Nordic)** (semicolon, decimal comma, UTF-8 with a byte order mark, so Excel in Norwegian, Swedish and Danish opens æøå and
numbers as numbers). Defaults: Standard for products, Excel (Nordic) for orders, customers and analytics tables (spreadsheet use). Dates are always
ISO 8601 (`2026-10-05`, `2026-10-05T14:22:05Z`). An import reads any delimiter and either decimal mark in a price, never in the file's other
numbers (a quantity is an integer).

### 2.8 Analytics tables

Every table of every analytics page (`/admin/{store}/analytics/…`) gets a **Download CSV** button beside it (needs `analytics:write`, as the VAT export does,
because an export is logged), and so does every chart's data table. The file is the table **as the page shows it for the period and comparison in the address**:
the same rows in the same order (the page's sort), the same figures (they come from the same loaders, not a second query), the period's first and last day
in `period_from` / `period_to` columns, the main currency in a `currency` column where the table has amounts, and, where the page shows a comparison, a
`{column}_previous` column for each compared figure and `previous_from` / `previous_to`. Header names are English snake_case, one per column, fixed per table
(`ANALYTICS_TABLES`, section 5.1). Amounts are decimals without VAT in the store's main currency (the analytics definition, `docs/analytics.md`). A currency with
no rate is left out of the table and counted on the page; the button's label repeats that ("Download CSV: 3 orders in SEK left out, as on this page") and
the audit entry records it, so the file never states more than the page. The VAT, OSS and IOSS tables keep the four files of D161 (their own button and log).
A table that is **not** exportable (a form, for example) is listed in `NOT_EXPORTED` with a reason, and a test fails for any other. Orders and customers are not
tables of the analytics pages: they are the exports of 2.3 and 2.4.

### 2.9 Failure behaviour

| Situation | What happens |
|---|---|
| A file that is not a CSV, is empty, has no header, is over the size or row limit, or is not UTF-8 or Windows-1252 | Refused at the upload with a sentence naming the limit or the problem; nothing is stored beyond the file in the private bucket, which is deleted. |
| A storage upload that did not finish | The register step says "the file did not arrive; choose it again". |
| A product with an error | Skipped, listed with its code; the others go on. |
| The database refuses a product at commit (a trigger) | The product fails with `saveProduct()`'s own sentence; the job goes on. |
| A picture address that is not public, is private (an internal address) or is not an image | Left out with `media.fetch_failed` (the fetch refuses private addresses, section 2.2 rule 8). |
| An export with more than the row limit | Refused before it starts, naming the limit and asking for a narrower period or filter. |
| The storage service is down | The job is retried by the next tick; after the attempts limit it is failed with "storage was not available". An export is never served from memory when storage is down. |
| The audit entry could not be written | A **direct** export is not served (as the D161 route does); a job's entry is written at its start and its end, and a job whose start entry fails does not start. |
| A member without the permission, or a store they are not in | A 404 (a page or a route), and a server action answers the refusal sentence; never a file. |
| Two members start the same export | Allowed up to the active limit; each job is its own file. |

### 2.10 Copied orders, host orders, other currencies, other languages

- **Copied orders** (D129): never counted as sales; in the order export only by option and always marked (2.3.5). A customer who exists only in a
  copy is exported with `copied = true`. Copied products are ordinary products.
- **Host orders** (D71) and the store's hosts' products: in the order export and marked; a product of a host is exported as any product and its `host`
  is **not** a column (a host is not set by import; an existing product keeps its host).
- **Other currencies** (D109): a price column `price:{COUNTRY}` is in that country's own currency (the editor's market columns), never a converted figure;
  an order's amounts are in the order's own currency; the main-currency columns are labelled and may be blank. A new money read gets a **euro
  scenario**: `src/server/checkout-kinds.int.test.ts` gains a scenario that places an order in a euro view of a store whose main currency is not euro
  and holds the exported row (section 6.2).
- **Other languages:** the product file has one set of text columns per store language (`title:sv-SE`, section 4.1.2), written and read through the editor's
  own `translations`; a column for a language the store does not offer is ignored with an info finding. The admin is English only.

---

## 3. Data

Three new tables and three buckets. Every table has `store_id` and every query of them carries it. Migrations are additive.

### 3.1 `commerce.data_jobs`: one row per import or export

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `store_id` | uuid not null → `stores` | composite unique `(store_id, id)` |
| `kind` | text not null | `product_import`, `product_export`, `order_export`, `customer_export`; later waves add `redirect_import`, `redirect_export` (the pipeline is generic) |
| `status` | text not null | `uploaded`, `checking`, `checked`, `queued`, `running`, `done`, `failed`, `cancelled`, `expired` |
| `phase` | text | `check` or `apply` for an import; `write` and `assemble` for an export |
| `format` | text | `kaizen`, `shopify` (imports); `kaizen` for exports |
| `options` | jsonb not null default `{}` | the member's choices (filters, dialect, profile, import options): never a cell and never an email |
| `requested_by` | uuid not null → `accounts` | |
| `input_path`, `input_name`, `input_bytes`, `input_sha256` | text / int / text | an import's file in the `imports` bucket (`{store}/{uuid}/{safe name}`) |
| `rows_total`, `rows_done` | int | |
| `counts` | jsonb not null default `{}` | `created`, `updated`, `unchanged`, `skipped`, `drafted`, `failed`, `warnings`, `prices_changed`, `pictures_fetched`, `terms_created` |
| `cursor` | jsonb not null default `{}` | where to go on (product index; export key and chunk number) |
| `files` | jsonb not null default `[]` | an export's parts: `[{ path, name, rows, bytes, sha256 }]` in the `exports` bucket |
| `problem` | text | the plain reason a job failed |
| `attempts` | int not null default 0 | |
| `claimed_until` | timestamptz | one run at a time (a claim with an expiry, as `store_copies`) |
| `created_at`, `updated_at`, `started_at`, `finished_at` | timestamptz | |
| `expires_at` | timestamptz | an export's files are deleted at this time (`finished_at + 7 days`); an import's file at `finished_at + 30 days` |
| `purged_at` | timestamptz | when the files were removed |

Constraints: `status` and `kind` checks; `rows_done between 0 and rows_total` when both set; `input_bytes <= 15728640`; an export has `files` and no
`input_path`; **one active import per store** (`unique (store_id) where kind = 'product_import' and status in ('uploaded','checking','checked','queued','running')`);
the active export limit is checked in the start function (a count under a lock), not by an index. A **trigger** forbids a backwards status move (a
`done`, `failed`, `cancelled` or `expired` job never runs again) and any change of `store_id`, `kind`, `requested_by` or the file hash once `checked`
(an apply cannot be pointed at another file). Deletion of the files is application code (`pruneDataJobs()`), never SQL.

### 3.2 `commerce.data_job_items`: one row per product (import) or per finding

`(job_id, seq)` primary key; `store_id`; `kind` (`product`, `file`), `ref` (the handle, or null), `rows` int[] (the file's row numbers), `outcome`
(`created`, `updated`, `unchanged`, `skipped`, `drafted`, `failed`, `checked`), `messages` jsonb (a list of `{ severity, code, column, text }`; a
sentence may name a handle, a SKU or a column, **never quote a cell**), `changes` jsonb (a short summary: `{ prices: n, fields: [names], stock: bool }`).
`on conflict (job_id, seq) do update` makes a resumed job idempotent. Kept 90 days after the job ends (`pruneDataJobs()`), then deleted.

### 3.3 `commerce.data_job_assets`: pictures fetched by an import

`(job_id, source_url)` primary key, `store_id`, `library_url` (null when it failed), `reason`. Deleted with the job's items.

### 3.4 `commerce.bulk_edit_batches` and `commerce.bulk_edit_items`: the bulk editor's record, for the undo

`bulk_edit_batches`: `id`, `store_id`, `requested_by`, `action` (`status`, `archive`, `unarchive`, `terms_add`, `terms_remove`, `price`, `stock`, `grid`,
`undo`), `params` jsonb (the percentage or amount, the markets, the term ids; no free text), `undo_of` (a batch id or null), `counts` jsonb,
`created_at`, `undone_at`. `bulk_edit_items`: `batch_id`, `store_id`, `product_id`, `variant_id` (null for a product-level field), `field` (`status`,
`archived`, `terms`, `price:{COUNTRY}`, `stock`, `cost`, `sku`), `before` jsonb, `after` jsonb, `outcome` (`changed`, `unchanged`, `failed`), `reason`
(the failure's sentence). Rows are append-only (a trigger refuses update except `undone_at` on the batch and `outcome` on an undone item). Kept
90 days; the undo window is 7. A product that is gone cannot be undone (`product_id` has no cascade; the undo reports it). `before` and `after` are
figures and codes; no personal data.

### 3.5 Buckets (private, in the existing EU project)

- `imports`: an import's CSV. Created by a migration like the `documents` bucket (`INSERT INTO storage.buckets … public = false`, file size limit 15 MiB,
  allowed type `text/csv`, `text/plain`, `application/vnd.ms-excel`), no storage policy for the browser except the signed upload the server makes.
- `exports`: an export's chunks and parts. Private, no public read, written and read only by the server with the secret key (like `documents`,
  `src/server/invoice-storage.ts`). Path `{store}/{job}/part-{n}.csv`.
- Nothing is public and nothing is a cookie. A download is `createSignedUrl(path, 60, { download: name })` made on a POST.

### 3.6 What is private, what is copied

- Everything above is private to the store and to staff who pass the guards. No new table is reachable from the storefront or the public Data API (the
  `commerce` schema is not exposed).
- **COPY_RULES** (`src/lib/store-copy-rules.ts`): `data_jobs`, `data_job_items`, `data_job_assets`, `bulk_edit_batches`, `bulk_edit_items` are all **`never`**
  (a job and a batch belong to the store and the person that ran them; a copy starts with none). No new settings table, so nothing is `settings`.
  `clone_store()` and `duplicate_store()` are **not** patched. `src/db/commerce.test.ts` fails until the five names are in `COPY_RULES`.
- **PERSONAL_DATA / NOT_PERSONAL** (`src/lib/personal-data.ts`, D162): `data_jobs`, `data_job_items`, `data_job_assets`, `bulk_edit_*` are **`NOT_PERSONAL`** with
  the reason "holds staff account ids, counts, handles and SKUs; never a shopper's data; the customer and order files it points to are the
  storage entry". `storage:exports` is a **`PERSONAL_DATA`** entry (subject `shopper`, `export: null` with the reason "a store-wide file the owner made, not one
  person's section", `erasure: "delete"`, link `none`): see retention. `storage:imports` is `NOT_PERSONAL`-like (product files only; the entry says
  so, and an import has no order or customer data). `src/db/privacy.test.ts` must pass without a new detector.
- **Erasure** (`eraseSubject()`, `src/server/privacy-erasure.ts`): a step deletes the store's **ready customer and order export files** (`kind in
  ('customer_export','order_export')`, not yet purged) and marks the jobs purged. The owner exports again if they need a file without the person.
  The step is a test in `privacy-erasure.int.test.ts` (section 6.3).

### 3.7 Retention (all in application code, in the daily cron `runRetention()`-style `pruneDataJobs()`, batched, never throws)

| What | Kept | Then |
|---|---|---|
| An export's files (`exports` bucket) | 7 days after the job is done | files removed, `purged_at` set, status `expired` |
| An import's file (`imports` bucket) | 30 days after the job ends (a job that was never applied: 30 days after upload) | file removed |
| `data_job_items`, `data_job_assets` | 90 days after the job ends | deleted |
| `data_jobs` rows | 12 months after the job ends | deleted (counts and options only, no personal data) |
| `bulk_edit_batches`, `bulk_edit_items` | 90 days (undo window 7 days) | deleted |
| The audit entries | 24 months (D158: `pruneAuditLog()`) | unchanged |

### 3.8 Rules the database itself enforces

The table checks and triggers above; the one-active-import index; the no-backwards-status trigger; the immutable-after-checked trigger; the append-only
bulk items. Everything else (limits, formula safety, permissions, file contents) is application code with tests, because the database cannot
see a CSV. **No SQL function in this run contains `DELETE` or `DROP`.** The migrations apply through CI (`docs/ci-migrations.md`).

---

## 4. Rules and law

### 4.1 The Kaizen product file

**4.1.1 Format.** CSV, RFC 4180 quoting, UTF-8, a header row. Export: comma, CRLF (the `toCsv()` rule), no byte order mark in the Standard dialect. Import reads LF
or CRLF, any of `, ; tab`, with or without a byte order mark. Row order: products in handle order, each product's variants in the editor's order (`active`
first, then creation), then its extra picture rows.

**4.1.2 Columns, in this order** (the header names are the contract; a change is a change to this file first):

`handle`, `status` (`draft`, `active`, `archived`), `kind` (`goods`, `appointment`, `stay`, `rental`), `vat_category` (a code from `commerce.vat_categories`), `title`,
`description`, `safety_information`, `seo_title`, `seo_description` (the primary language), then for each other store language `title:{locale}`,
`description:{locale}`, `safety_information:{locale}`, `seo_title:{locale}`, `seo_description:{locale}`; `categories` (names, a path as `Parent / Child`,
joined with ` | `), `tags` (joined with ` | `); `option1_name`, `option1_value`, `option2_name`, `option2_value`, `option3_name`, `option3_value`; `variant_id`,
`sku`, `gtin`, `active` (`true`/`false`), `delivery` (`physical`, `digital`, `service`), `weight_grams`, `hs_code`, `origin_country`, `cost` (main
currency, without VAT, `decimalAmount()`), `stock`, `stock_policy` (`deny`, `continue`; goods only), `backorder_days` (1 to 90, only with `continue`), `low_stock_threshold` (the owner's warning
level, goods only; wave 3, D172), `measure_amount`, `measure_unit`, `measure_base` (the unit price, D160), `price_basis`
(`incl_vat` / `excl_vat`), then one `price:{COUNTRY}` per market of the store (`price:NO`, `price:SE`); `image_url`, `image_position`, `image_alt`,
`variant_image_url`; and `field:{name}` per plain custom field (4.1.4). A product-level cell is on the product's first row only.

**4.1.3 Round trip.** Export then import with the same options changes nothing (`unchanged` for every product, no write, section 2.2 rule 5). The cell
escape of `toCsv()` (a leading `'` before `= + - @ tab CR`) is **undone on import** (one leading `'` is removed when the next character is one of those),
and text that really starts with `'` followed by one of them is written with a second `'` on export, so the pair is exact (`src/lib/csv.ts`, property-tested over
random text including such cells, newlines, quotes, commas, semicolons and tabs).

**4.1.4 Custom fields.** Only fields whose value is plain text in a cell are in the file: the types for which `fieldValueText()` and a parse back exist
(text, textarea, number, boolean, select, radio, buttons, date, url, email, measurement, money; the foundation agent lists the exact set from
`FIELD_TYPES` and the doc comment records it). Group, repeater, flexible content, gallery, file, rich text and relations are **not**: neither read nor
written, and the export page lists them. The header is `field:{name}` (the field's `name`, for people: ids stay inside). A `name` shared by two groups, or a
name that is not unique, is an import error for that column (`field.ambiguous`). Translatable text fields use `field:{name}:{locale}`. Variant fields use
`variant_field:{name}`. Values go through `saveProduct(…, fields, variantFields)` in its own shape (`FieldChanges`: a `null` removes a value); an import
that has no `field:` columns passes none (a test shows `undefined` leaves every value as it was). The customer export reads customers' fields in a
batch (section 5.3).

**4.1.5 Not in the file** (section 2.1 point 4), by design.

### 4.2 The order file

Fixed English snake_case header, no totals row, formula-safe, `decimalAmount()` for amounts, ISO dates. **Lines layout**, in order:

- Identity: `order_number`, `placed_at` (UTC, `…Z`), `placed_on` (the store's day), `status`, `payment_status`, `paid_at`, `market` (country), `currency`, `locale`,
  `copied`, `host_order`, `test_payment`, `invoice_number` (the issued invoice's number or empty).
- Buyer, **Accounting profile**: `customer_type` (`private`, `business`), `company_name`, `buyer_vat_number` (reverse-charge orders and business buyers only),
  `billing_country`, `shipping_country`. **Full profile** adds `email`, `billing_name`, `billing_line1`, `billing_line2`, `billing_postal_code`, `billing_city`,
  `shipping_name`, `shipping_line1`, `shipping_line2`, `shipping_postal_code`, `shipping_city`, `shipping_phone`, `discount_code`.
- Order amounts (**on the order's first line row; empty on the others**, so a column sums correctly): `subtotal`, `shipping`, `shipping_vat`, `discount_total`,
  `member_discount`, `campaign_discount`, `credit_used`, `referral_discount`, `vat_relief`, `vat_kind`, `tax_total`, `total`, `refunded`, `refund_count`, `last_refund_at`,
  `balance_due_at_venue`, `commission`, `delivery_service`, and the main-currency block `main_currency`, `main_rate`, `main_converted` (`true`, `false`, `no_rate`),
  `subtotal_main`, `tax_total_main`, `total_main`, `refunded_main`.
- Line: `line_number`, `sku`, `title`, `quantity`, `unit_price` (as sold, VAT included), `line_discount`, `line_total`, `line_tax_rate`, `line_net`, `line_tax`,
  `unit_cost_main` (when known), `gift` (`true`/`false`), `line_delivery` (`physical`, `digital`, `service`).

**Orders layout** is the identity, buyer and order-amount columns once per order, with `line_count` and without the line block. Both layouts end with no totals row.

*As built (D173, D174, wave 3):* after the order amounts and before the line block, both profiles carry `tags`, `archived`, `source` (`checkout`, `draft`,
`copied`), `gift_order` (D173), then `fulfilment` (`none`, `unsent`, `partly_sent`, `sent`, `withdrawn`, `closed`: `commerce.order_fulfilment()`, empty for an order
not paid) and `edited` (`true`/`false`: staff changed the order after purchase, `orders.edited_at`) (D174, `docs/wave-3-fulfilment.md` 5.5); the Full profile
adds `gift_to`, `gift_from`, `gift_message`. An edited order's lines and amounts are as they are now (the lines layout lists the lines after the change), and
`refunded` never counts the refund of a change's lower total (its total is already the changed one; `docs/analytics.md`, *Refunds*).
The columns never include: client secrets, the order page's key, payment tokens, card data, a provider's internal id other than the payment reference, password
hashes or any session. `payment_reference` is the payment provider's id of the captured payment (a Stripe `pi_…`, which is a reference, not a credential) and
is in the lines layout only.

### 4.3 The customer file

`customer_id`, `email`, `name`, `phone`, `account` (`verified`, `unverified`, `none`), `locale`, `created_at`, `last_order_at`, `orders_paid`,
`address_line1`, `address_line2`, `address_postal_code`, `address_city`, `address_country` (the account's address, else the latest paid order's shipping address),
`company_name`, `organisation_number`, `customer_group`, `company`, `company_role`, `email_opt_out`, `marketing_consent` (`not_recorded`, section 2.5),
`copied`, then `field:{name}` per customer field (plain types). No total spent (it needs conversion, and Shopify does not import it either).

### 4.4 Findings (stable codes, the tests assert them)

`file.too_large`, `file.too_many_rows`, `file.empty`, `file.no_header`, `file.unknown_format`, `file.encoding_assumed` (warning), `file.delimiter`
(info), `price_basis.mismatch` (error), `price_basis.required` (error: a Shopify file with no choice), `row.handle_missing`, `row.handle_invalid`,
`handle.duplicate_in_file`, `handle.mismatch`, `sku.missing`, `sku.duplicate_in_file`, `sku.in_other_product`, `variant.unknown_id`, `options.mismatch`,
`options.too_many`, `price.unreadable`, `price.market_unknown` (info), `price.negative`, `cost.unreadable`, `stock.invalid`, `gtin.invalid`, `hs_code.invalid`,
`origin.invalid`, `measure.invalid`, `delivery.not_importable` (a Shopify "does not require shipping" product is read as physical, warning),
`kind.not_importable`, `status.unknown`, `status.draft_because_unpublished` (warning, Shopify `Published on online store = false`), `product.drafted`
(warning, with the editor's reasons), `value.cleared` (warning), `media.too_many` (error), `media.address_invalid`, `media.fetch_failed` (warning),
`term.created` (info), `field.unknown`, `field.ambiguous`, `field.invalid`, `column.ignored` (info, with the reason), `giftcard.not_supported` (error),
`inventory.continue_selling_ignored` (warning: backorders arrive in wave 3), `tax.ignored` (warning: "Charge tax" or a tax code was in the file; the product keeps
its VAT category, and **an import never sets the category `exempt`**), `compare_at.ignored` (info), `save.failed` (error, with the editor's sentence).

### 4.5 Money, rounding and the price rules

- Amounts are integer minor units end to end; text is turned into minor units by `parsePrice()` and back by `decimalAmount()` (a currency's own digits; zero-decimal
  currencies have none). No floating point carries an amount. Percentages are held as **basis points** (a typed `12.5` is 1,250, two decimals at most).
- **Percentage change** of a stored or typed minor amount `a`, by `bp` basis points (negative to lower): `new = floor((a × (10,000 + bp) × 2 + 10,000) / 20,000)`,
  i.e. **half up** to the minor unit, computed in `BigInt`. `new < 0` is `price.negative`. **Amount change**: `new = a + delta` with `delta` parsed in the market's currency;
  `new < 0` is `price.negative`. A change of `0` is `unchanged` and writes nothing.
- A price changes **only** through `commerce.set_price` (inside `saveProduct()`), which keeps the history. **Omnibus:** a lowered price is shown to shoppers as a reduction
  against the lowest price of the previous 30 days (`prior_30d_minor` from `commerce.current_prices`); neither the import nor the bulk editor writes a reduction in any other
  way, and a compare-at figure from a file is never used (Directive 98/6/EC Art. 6a). The bulk confirmation says this.
- **VAT for a Shopify file whose prices exclude VAT:** the member says so; each price becomes `withVat(price, rate)` where the rate is `commerce.vat_rate(country, product's
  vat_category)` of the market (`EditorContext.markets[].vatRates`), never `countries.standard_vat_rate`; `withVat()` is the one existing function (half up). A store selling
  only to businesses types prices without VAT already, so the answer there is "without VAT" and nothing is converted.
- **Main currency in the order file:** `main = toMain(amount, currency)` with the store's rates now; no rate gives blank and `no_rate`; the order's own amount is always there.

### 4.6 Formula safety

Every text cell in every file goes through the one pure CSV writer (`src/lib/csv.ts`), which implements OWASP's list: a text cell that starts with `=`, `+`, `-`, `@`, tab, CR or LF is
prefixed with `'` (a **number cell**, already formatted by `decimalAmount()` or an integer, is not a text cell and is never prefixed: `-12.50` stays `-12.50`), and a cell with
the delimiter, a quote or a line break is quoted. `toCsv()` in `src/lib/dac7.ts` keeps its behaviour and tests and **delegates** to the new writer for the comma dialect (or stays
as it is if delegation changes any existing output; the foundation agent decides and says so). A **test builds a store whose every text field starts with each of the seven
characters** and asserts no cell of any export starts with one unescaped (section 6). Analytics table cells are text or numbers by their declared column kind, never guessed.

### 4.7 Who may do what

| Action | Needs |
|---|---|
| Product export, see its jobs, download | `products:read` |
| Product import (upload, check, apply, cancel), bulk list actions, the grid, undo | `products:write` |
| Order export, customer export, their jobs and downloads | **owner** (the role: `requireOwnerRole()`) |
| Analytics table CSV | `analytics:write` (as D161: an export is logged) |
| Platform admins | no access to a store's files (they are not members) |

A custom role cannot hold `owner`, so a staff member's custom role never lets them export personal data. The orders row says "staff" and the platform row says "owner-only": the
stricter reading is built; section 6.5 asks the lead to confirm. A **collaborator** (an agency with an expiry) is a member and has what its role has, never `owner`.

### 4.8 Limits

`IMPORT_MAX_BYTES` 15 MiB, `IMPORT_MAX_ROWS` 60,000, `IMPORT_MAX_PRODUCTS` 5,000, `DIRECT_EXPORT_MAX_ROWS` 2,000, `EXPORT_MAX_ROWS` 500,000 (a job; parts of 100,000 rows each),
`EXPORT_PART_ROWS` 100,000, `DATA_EXPORTS_ACTIVE_MAX` 3, one active import, `BULK_MAX_PRODUCTS` 500, `BULK_GRID_MAX_PRODUCTS` 50, `BULK_UNDO_DAYS` 7, `ORDER_SELECTION_MAX` 500,
`DATA_JOB_MAX_ATTEMPTS` 6, `DATA_JOB_BUDGET_MS` 40,000 per run, `DATA_JOB_CLAIM_MINUTES` 5. All in `src/lib/data-limits.ts`, the numbers in tests, never in a component. They are
per store. (Per-plan limits are not built; the plan comparison of D132 gets a row naming the limits, section 5.5.)

---

## 5. Where things live

Areas: **foundation** (schema, migrations, database rules, pure libraries and the registries' data), **server** (`src/server`, routes, cron), **admin** (the pages and components of
products, orders, customers), **analytics-and-ai** (the analytics CSV, the AI manager's tools and skills, the plan features), and **shopper**: **nothing to build**. Areas share no
file except through the registries named in 5.5.

### 5.1 Foundation

- Migrations: `supabase/migrations/*_data_jobs.sql` (generated: the three tables of 3.1 to 3.3 and the two of 3.4, checks, the unique index, the status trigger via a
  custom migration `--custom --name data_jobs_rules`), `*_data_buckets.sql` (the two buckets). `pnpm db:generate`, `pnpm db:check`. `src/db/schema.ts` gets the five tables.
- `src/lib/csv.ts` (+ `.test.ts`): `parseCsv()` (delimiter and encoding detection helpers, BOM, quotes, embedded newlines, ragged rows reported), the writer
  `writeCsv(rows, dialect)` with `Cell = string | number | null | { num: string }`, `DIALECTS` (`standard`, `excel_nordic`), `escapeText()` / `unescapeText()`.
- `src/lib/data-limits.ts` (4.8), `src/lib/data-job.ts` (+ test): the lifecycle (`nextStatus()`, which transitions are legal), the stable finding codes and their sentences (4.4), the
  `Finding` type, `summariseCounts()`.
- Products: `src/lib/product-csv.ts` (columns, `productRowsOf(ProductInput, context)`, `inputsFromRows()`), `src/lib/product-csv-shopify.ts` (the header map of current and older
  names, `detectFormat()`, the Shopify to neutral mapping, `htmlToText()` which turns a Shopify description into **plain text** because product descriptions are plain text and
  HTML is never stored), `src/lib/product-import.ts` (neutral `ProductDraft`, `planImport()`: validate, diff against the stored `ProductInput`, the findings, no database), `src/lib/bulk-edit.ts`
  (percentage and amount rules of 4.5, stock rules, the diff and conflict logic, `undoPlan()`), `src/lib/order-csv.ts`, `src/lib/customer-csv.ts` (columns and row shapers from plain input rows;
  no SQL), `src/lib/analytics-export.ts` (the `ANALYTICS_TABLES` registry: id, page, caption, columns with kind and header, `NOT_EXPORTED`).
- Registries' data: `AUDIT_AREAS` (`src/lib/audit.ts`: prefix `products.` already exists; add exact or prefix entries for `products.import_*`, `products.bulk_*` (area `products`),
  the action names of 5.2 are chosen to match prefixes that already exist (`products.`, `order.`, `customer.`, `analytics.`), so **no new prefix** is needed and the scan test finds an area for each), `EMAIL_KINDS` (`"data_job.ready": "staff"`),
  `COPY_RULES`, `NOT_PERSONAL`, `PERSONAL_DATA` (3.6), `ALLOWED_FIELDS` is **not** extended (no `auditChange` diffs: job entries carry counts).

### 5.2 Server (`src/server`, routes, cron)

- `src/server/data-jobs.ts` (+ `.int.test.ts`): `startJob()`, `claim()`, `tick()`/`runJob()` (within `DATA_JOB_BUDGET_MS`), `cancelJob()`, `jobFor(storeId, id)`, `listJobs(storeId, kind)`,
  `pruneDataJobs()`, the storage helpers `dataStorage()` (like `documentStorage()`: upload, download, remove, `signedUrl(path, name)`), `startImportUpload()`. Every function takes the
  member or the store id and carries `store_id` in every statement.
- `src/server/product-import.ts` (check phase, apply phase, picture fetch through `safeFetch()` and `uploadToLibrary()`, term creation through `createTerm()`, `saveProduct()` per product),
  `src/server/product-export.ts`, `src/server/order-export.ts`, `src/server/customer-export.ts` (keyset-paginated reads; an order read carries the store id and the `PAID` /
  `copied_from` / `host_id` / `restricted_at` rules in one place), `src/server/bulk-edit.ts` (list actions, grid apply, undo; uses `getProductForEdit()` and `saveProduct()` from
  `src/server/products.ts`, **never** `commerce.set_price`: the existing `price-audit-scan.test.ts` still finds one caller).
- `src/server/field-entities.ts` gets `customerFieldExportMany(store, ids[])` (one query; `field-values-readers.test.ts` already lists this module's neighbours: if the new reader
  lives in a module not on its list, **that list is extended with a reason**, it is not bypassed). `src/server/custom-fields.ts` gets `getFieldDataMany(storeId, entity, ids[])` for products.
- Routes (all POST, `sameSite()` checked, a guard in the file; a person without the key gets a 404, as `analytics/tax/export/route.ts` does):
  `src/app/admin/(gated)/[store]/products/export/file/route.ts`, `.../orders/export/file/route.ts`, `.../customers/export/file/route.ts` (a direct file or the redirect to the job; and the
  download of a done job's part, which logs before the redirect to the signed address), `.../analytics/export/route.ts` (an analytics table, shared by all analytics pages).
- Cron: `runDataJobs()` is added to `src/app/api/cron/cart-reminders/route.ts` (the five-minute job: continues running jobs, never throws) and `pruneDataJobs()` to
  `src/app/api/cron/subscription-reminders/route.ts` (daily). `after()` starts a job at once, as `startStoreCopy()` does. The open job page asks for a step through a route under
  its own page (`products/import/[jobId]/tick`, `.../export/[jobId]/tick`), as `tickReplication()` does; it checks the member and the same site.
- Email: `src/server/data-job-emails.ts` sends `data_job.ready` (staff, English, a link to the admin page; no file, no row count of people) once per job, never throwing; it uses
  `sendEmail()` with the kind registered in `EMAIL_KINDS`.
- Audit: `audit(accountId, storeId, action, details, { area })` entries: `products.import_started`, `products.import_applied`,
  `products.import_cancelled`, `products.export_made`, `products.export_downloaded`, `products.bulk_edited`, `products.bulk_undone`, `order.exported`, `order.export_downloaded`,
  `customer.exported`, `customer.export_downloaded` (kind and job id, never a name or an address), `analytics.table_exported` (table id, period, rows, left-out count). `src/server/audit-coverage.int.test.ts` is extended.

### 5.3 Cache tags and what the site sees

An import's or a bulk edit's writes refresh the catalogue and fields tags (`catalogTag(store.id)`, `fieldsTag(store.id)`) once per chunk, **through `refreshTag()` (`src/server/refresh.ts`), never `updateTag()`
directly**: a job runs from the cron and from a tick route, where there is no server-action context (`CLAUDE.md`: admin functions refresh caches through `refreshTag()`). The editor's
save action calls `refreshStoreEmbeddings()` and the keyword search document after a save; the job does the same once per chunk, not per product.

### 5.4 Admin (pages, components)

| Page | File | ADMIN_PAGES id | Key |
|---|---|---|---|
| Product export | `src/app/admin/(gated)/[store]/products/export/page.tsx` | `products.export` | `products:read` |
| Product import | `.../products/import/page.tsx` | `products.import` | `products:write` |
| One import | `.../products/import/[jobId]/page.tsx` | `products.import.job` | `products:write` |
| Bulk grid | `.../products/bulk/page.tsx` | `products.bulk` | `products:write` |
| Order export | `.../orders/export/page.tsx` | `orders.export` | owner (`needs: "owner"`) |
| Customer export | `.../customers/export/page.tsx` | `customers.export` | owner (`needs: "owner"`) |

Components: `src/components/admin/data/` (job progress, the findings table with its filters, the dialect picker, `ExportForm`, `ImportForm`), the products list's selection bar and bulk
dialogs next to `products/page.tsx` and `src/components/admin/products-bulk.tsx`, the grid `src/components/admin/products-grid.tsx`. Forms use `ActionForm` (`aria-busy`, spinner), tokens
of `admin.css` only, no `max-w-*xl`, and every table has a caption. The orders list and an order's page get a link each (small edits to those pages; wave 3 owns their rebuild, section 7).
Store nav: the sub-pages sit under their section's existing item (`/products`, `/orders`, `/customers`) and need only `ADMIN_PAGES` entries, as `/products/categories` does; no new nav item. A
test fails for a page not in `ADMIN_PAGES` and for a route with no guard (`permissions.scan.test.ts`, `permissions.baseline.json` is updated by hand with the keys above).

### 5.5 Analytics and AI

- `<DataTable>` and the charts' data tables get an `exportId` prop that draws the **Download CSV** button (a small form POST to `analytics/export`); every analytics view passes one or
  `exportable={false}` with a reason. The registry `ANALYTICS_TABLES` (foundation) names the columns; `src/server/analytics-export.ts` calls the **same loaders** the page calls (the `*-data.ts`
  modules and `analyticsContext()`), so a figure cannot differ from the page's; the first version covers every table of: overview, finance, customers, products, inventory, marketing
  (and discounts), subscriptions, traffic (devices, cities, landing pages, searches), the refunds and returns sections, and the spend table. VAT, OSS and IOSS keep D161's.
- AI manager (`docs/admin-navigation.md`, D94): two **read-only** owner tools in `OWNER_TOOLS` (`src/lib/owner-tools.ts`, `HANDLERS` in `src/server/owner-tools.ts`, `TOOL_WORDS`, a row in
  `TOOL_PERMISSIONS`, served by the store's MCP server too because they are owner tools): `list_data_jobs` (kind, status, counts, the plain problem; `products:read` for product jobs, `owner` for the
  others: so the tool answers only what the member may see) and `explain_import_problems` (the findings of a job grouped by code with their sentences and the fix; from the stored items, no
  model-made number). There is **no tool that starts, applies, cancels or downloads** an import or export (the files hold personal data and an import writes the catalogue): the tools
  say where the page is. A playbook `import-products` in `ASSISTANT_SKILLS` (`src/lib/assistant-skills.ts`).
- Plan features (D132): one migration row each in `commerce.plan_features` (category *Data*): "Product CSV import and export", "Order and customer CSV export", "Bulk product editing", "CSV for every
  analytics table", described only (they enable nothing), seeded like `20260930214603_plan_features.sql`.
- Registries **not** touched (and why): `KNOWN_COOKIES` (no cookie, no storage item; the admin keeps nothing in the browser for this), store-translate (no new translatable text), sitemap and structured data
  (nothing public), i18n and `email-text.ts` consumer texts (none; the staff email is English in its own module), `store-nav` items (5.4).

### 5.6 What the areas may and may not touch

foundation: `src/db/**`, `supabase/**`, `src/lib/{csv,data-*,product-csv*,product-import,bulk-edit,order-csv,customer-csv,analytics-export}.ts` and the registries' data in 5.1. server: `src/server/**` and
`src/app/**/route.ts` and the cron routes. admin: `src/app/admin/**/page.tsx`, `loading.tsx`, `actions.ts` of the six pages and `src/components/admin/**` except analytics. analytics-and-ai:
`src/components/admin/analytics/**`, `src/app/admin/(gated)/[store]/analytics/**`, `src/server/analytics-export.ts`, `src/lib/owner-tools.ts` and its tools, the plan-feature migration. Shared registries
(`admin-map.ts`, `audit.ts`, `store-copy-rules.ts`, `personal-data.ts`, `permissions.baseline.json`) are edited only by small targeted additions by the area that owns the entry named above.

---

## 6. Acceptance criteria, row by row

Tests are named by layer: **unit** (`src/**/*.test.ts`), **PGlite** (`src/db/*.test.ts`, migrations applied), **int** (`src/server/*.int.test.ts` against a database), **e2e** (`e2e/*.spec.ts`).

### 6.1 `catalogue.bulk-product-import-and-export-csv`

| Criterion | Held by |
|---|---|
| 1. Export writes every product and variant (handle, translations, options, SKU, GTIN, prices per market, stock, cost, HS code, origin, media addresses, categories, tags) as a job for large stores | unit `product-csv.test.ts` (every column of 4.1.2 from a fixture product with 2 options, 3 variants, 3 languages, 2 markets, 4 pictures, a category and tags); int `product-export.int.test.ts` (a store over `DIRECT_EXPORT_MAX_ROWS` becomes a job, parts of `EXPORT_PART_ROWS`, files in the `exports` bucket fake, expiry set); e2e `data-export.spec.ts` (download a small export in the admin) |
| 2. Import reads a Shopify and a Kaizen file; dry run lists each row's problem; creates or updates by handle and SKU through `saveProduct()` and `commerce.set_price`; resumable after a failure | unit `product-csv-shopify.test.ts` (Shopify's real header row and two data rows, current and older names, `htmlToText()`, status and publish mapping, market price columns, each ignored column's `column.ignored`), `product-import.test.ts` (every code of 4.4 has a case); int `product-import.int.test.ts` (dry run writes no `products` row; apply creates and updates; a SKU in another product is `sku.in_other_product`; `price_basis`; a picture fetched through a stubbed `safeFetch`; **kill the run after N products** and `runJob()` again: the counts are right and no product is doubled; the second look records a written product as `unchanged`); scan test `product-import-writers.test.ts` (no import or bulk module contains `insert into commerce.products|product_variants|prices|inventory_levels` or `commerce.set_price`) |
| 3. Round trip changes nothing; cells escaped against formula injection | unit `csv.test.ts` (property test: random text including each leading character of 4.6, `'`+trigger pairs, newlines, quotes, delimiters survives `writeCsv` then `parseCsv` exactly); int `product-roundtrip.int.test.ts` (export, import, then: every product `unchanged`, **no `prices` row added, no `updated_at` changed**, search document unchanged), and the **injection canary** (a store whose titles, descriptions, tags, option values, field values and alt texts start with `=`, `+`, `-`, `@`, tab, CR, LF round-trips equal and no exported cell starts with an unescaped one) |
| 4. Per store, a size limit, an audit entry; archived variants switched off, never deleted | int `data-jobs.int.test.ts` (over `IMPORT_MAX_BYTES`/`ROWS`/`PRODUCTS` refused; another store's job is invisible and a guessed job id is a 404; one active import per store; the audit entry has counts and no cell); int (the "switch off" option sets `active = false` and the variant row and its prices remain); PGlite `data-jobs.test.ts` (checks, one-active-import index, no backwards status, immutable after checked); `audit-coverage.int.test.ts` extended |

Expected rating **full**.

### 6.2 `orders.order-export-to-csv`

| Criterion | Held by |
|---|---|
| 1. A date range or a selection as UTF-8 CSV, one row per line, order currency and main currency, VAT split out | unit `order-csv.test.ts` (every column of 4.2, first-line-only amounts, `main_converted` states, reverse-charge and IOSS and booking orders, `decimalAmount()` for a zero-decimal currency); int `order-export.int.test.ts` (the rows for a seeded store of every product kind from `checkout-kinds`' helpers; range by store day across a time-zone midnight and across both clock-change days of Europe/Oslo (a 23 and a 25 hour day, the end being the store's next local midnight, never a flat 24 hours); a test-mode order marked `test_payment`; selection by numbers with an unknown one listed; **the sum of `line_tax` plus `shipping_vat` equals `tax_total` and the sum of lines plus shipping minus discounts equals `total`, for every order**); **euro scenario**: `checkout-kinds.int.test.ts` gains an order placed in a euro view of a NOK-main store and the exported row is held (`currency = EUR`, `main_converted`, `*_main` by the store's rate) |
| 2. A large export is a job delivered by a link to the signed-in staff member, not emailed as an attachment | int `order-export.int.test.ts` (over `DIRECT_EXPORT_MAX_ROWS` a job; the `data_job.ready` email is sent to the requester, **contains no file and no attachment and no URL that works without signing in**, via a captured `sendEmail`; the download POST returns a redirect to a signed address of 60 s and writes `order.export_downloaded`); e2e (the job page shows the Download button) |
| 3. Fields starting with = + - @ escaped; copied history marked | unit `order-csv.test.ts` and `csv.test.ts`; int canary (customer name, company, SKU and title with each trigger character); int (a copied order is left out by default and, when included, `copied = true` and `C-` number; a host order `host_order = true`; an erased person's order has no personal field in either profile) |
| 4. Only the signed-in member's store | int `data-permissions.int.test.ts` (two stores, each with orders: store A's owner's file has none of store B's order numbers or emails; a member of A is a 404 for B's export route and a guessed job id; a non-owner member of A gets a 404 on the route and the page) |

Expected rating **full**.

### 6.3 `platform.product-customer-and-order-csv`

| Criterion | Held by |
|---|---|
| 1. Products with variants, prices per market, stock, translations and custom fields export and re-import unchanged; a customer's fields through `customerFieldExport()` are in the exports | int `product-roundtrip.int.test.ts` (a product with plain custom fields on the product, a variant and a translation; the **non-plain** field is kept untouched across the round trip); int `customer-export.int.test.ts` (`customerFieldExport()` now has a caller: the customer file's `field:{name}` columns equal it for the same customer; the batch reader reads once, held by a query counter) |
| 2. Dry run lists every row's problem, then a resumable job keyed on SKU or handle, per-store limits, never another store's rows | as 6.1 criteria 2 and 4 |
| 3. Orders export with totals, VAT, discounts and refunds in the store's currency; customers with marketing-consent state; no secrets or tokens; owner-only and audited | int `order-export.int.test.ts` (totals, VAT, each discount kind, a partial refund and a full one; `refunded` is succeeded refunds only); int `customer-export.int.test.ts` (`marketing_consent` is `not_recorded` for every row and `email_opt_out` is true for an address on `email_opt_outs`, **and the page says Kaizen records no consent**); **the secrets canary**: a store whose customers, orders and payments carry sentinel values in `password_hash`, `auth_user_id`, `avatar_path`, the order page key, `client_secret`, a session token and a referral code, and none appears in any export; int (a role with `orders:write` and `customers:write` but not `owner` is refused the routes and the pages; owners' exports and downloads write `order.exported`, `customer.exported`, `order.export_downloaded`, `customer.export_downloaded` with no name or address); int `privacy-erasure.int.test.ts` (an erasure deletes the store's ready customer and order export files and marks the jobs purged) |
| 4. Text goes through `toCsv()` so a formula cannot run | unit `csv.test.ts`; the existing `dac7.test.ts` stays green; a scan test `csv-writers.test.ts` (no module under `src/server` or `src/lib/*-csv.ts` joins cells with `","` or writes a CSV any other way than `writeCsv()`/`toCsv()`) |

Expected rating **partial** (criterion 3's consent state); **full** if the lead accepts the reworded criterion of 6.5.

### 6.4 `analytics.export-reports-to-csv`

| Criterion | Held by |
|---|---|
| 1. Every analytics table downloadable for the chosen period and comparison, matching what the page shows | unit `analytics-export.test.ts` (the registry is complete and has no duplicate header; **a scan test reads `src/components/admin/analytics/*-view.tsx`: every `<DataTable` and chart data table has an `exportId` that is in `ANALYTICS_TABLES` or `exportable={false}` with an entry in `NOT_EXPORTED`**); int `analytics-export.int.test.ts` (for each registered table, the CSV's rows equal the loader's rows and figures the page renders, including a previous-period column, a custom range and the left-out currency note; the file for a comparison `none` has no `_previous` column) |
| 2. Orders and customers as a store-scoped job, full export beyond screen limits, header row and the main currency stated | as 6.2 and 6.3 (the job beyond 2,000 rows; the `main_currency` column) |
| 3. Spreadsheet text through `toCsv()` | the canary of 6.1 criterion 3 extended to an analytics table (a product titled `=1+1` in the products table) |
| 4. Refuses members without access and never includes another store's rows | int `data-permissions.int.test.ts` (`analytics:read` without `write` is a 404; another store's table is empty of this store's rows) |

Expected rating **full**.

### 6.5 `catalogue.bulk-editing`

| Criterion | Held by |
|---|---|
| 1. The list selects many and applies status, archive, categories and tags, price (percentage or amount) or stock in one confirmed step | unit `bulk-edit.test.ts` (percentage half-up cases including `x.5` ties, a lowering to 0, `price.negative`, amount per market, a zero change is unchanged); int `bulk-edit.int.test.ts` (each action over 30 products; archive and unarchive-to-draft; terms add and remove; status active with one product that cannot be published fails alone with the editor's sentence); e2e `data-export.spec.ts` (tick two rows, *Change price*, confirm) |
| 2. A grid edits price, SKU, stock and cost across variants with a preview and undo; every change goes through the editor's validation and `commerce.set_price` | int `bulk-edit.int.test.ts` (the grid's apply writes a price row through `set_price` and the **price history shows both**; an unreadable price, a SKU in use and a negative stock fail as the editor's `productProblems()` does; a cell changed since load is a conflict and is not overwritten; **undo** restores a cell only where the stored value is still the batch's `after` and lists the rest; undo is its own batch) ; scan test (section 6.1) that no bulk code writes `prices` itself |
| 3. Limited per request, per store, one audit entry per batch, failures listed with why | int (501 products is refused; 51 for the grid; another store's product id in the selection is `not found` and never changed; **exactly one** `products.bulk_edited` entry for a batch of 25 products whatever the count of changed prices; the result lists each failure with its reason) |

Expected rating **full**.

### 6.6 Criteria changes (for the lead; the rows are not edited here)

1. **`platform.product-customer-and-order-csv` criterion 3, "customers export with their marketing-consent state"**, cannot be met: Kaizen holds no consent state. Proposed text:
   "customers export with the consent information the store holds (the unsubscribe list today, the recorded consent, its source and date, from wave 5), and say plainly when none is recorded".
   Until then the row is partial.
2. **"Owner-only" (platform row) against "Staff export" (orders row).** Built as owner-only (4.7). Proposed wording of the orders row: "The owner exports …".
3. **Overlap (README rule 8).** `catalogue.bulk-product-import-and-export-csv` and `platform.product-customer-and-order-csv` are one Shopify feature in two domains and the platform row also
   repeats orders, customers and analytics rows. Proposal: the catalogue row survives for products, the orders and analytics rows for theirs, `customers.customer-profiles-notes-csv-import-and-export`
   takes the customer export (it keeps the import, wave 5), and the platform row is deleted and named in its survivors' `gap`. Weights stay (README rule 6).
4. **`orders.order-export-to-csv` "or a selection"** is met by order numbers and *Export this order*, not tick boxes (the order list is wave 3's). Proposed wording: "…or a list of order numbers".
5. **`catalogue.bulk-product-import-and-export-csv` criterion 1 "media addresses"**: exported as the store's own library addresses; an import fetches and copies external ones. Not a change of the criterion; said here so the
   tester knows an exported picture address is the store's, never Shopify's.
6. **`analytics.export-reports-to-csv` criterion 2** ("orders and customers as a store-scoped job") duplicates 6.2 and 6.3; it is closed by them.

---

## 7. What is deliberately not done, and why

| Not done | Why | Taken by |
|---|---|---|
| Customer import (CSV or Shopify) | A customer file brings emails, phones and **consent** that the store must be able to back; Kaizen has no consent record yet | `customers.customer-profiles-notes-csv-import-and-export` (wave 5, with the subscriber list) |
| Order import, Shopify order and customer importers, WooCommerce product, order and customer importers, "migration wizard" | The Shopify *product* file is read here because the row asks; the rest are `platform.migration-from-other-platforms` | wave 2, a later run on the same `data_jobs` table |
| Redirect import and export, automatic redirect on a handle change | `storefront.url-redirect-manager` is its own row; for that reason an import **never changes a handle** | wave 2, later run |
| Scheduled report emails; accounting exports and a second connector next to Tripletex | `analytics.scheduled-report-emails`, `analytics.accounting-integrations` (bucket B) | wave 2, later runs |
| Inventory CSV with several locations, backorders | Done in wave 3 (D172): the stock file is its own job kind (`inventory_import`, `inventory_export`); this file carries `stock_policy`, `backorder_days` and `low_stock_threshold` and ignores `stock` with several active locations | done |
| Tick boxes and saved views in the orders list, bulk order actions | `orders.order-list-search-filters-saved-views-bulk` | wave 3 |
| Variants beyond 100, options beyond 3, pictures beyond 12 | `MAX_VARIANTS`, `MAX_OPTIONS`, `MAX_MEDIA` are the editor's limits; Shopify allows 250 pictures; the import refuses with `media.too_many` and `options.too_many` rather than cut | wave 6 (variant matrix) |
| Import of subscriptions, download files, bookings, hosts; custom fields that are not plain | Each has its own editor and rules (files in storage, staff, seasons) | not planned; the editor stays the way |
| Gift cards, compare-at prices, product reviews, Google Shopping columns, metafields other than Kaizen's own fields | `giftcard.not_supported`; `compare_at.ignored` (Omnibus, 4.5); gift cards and reviews are wave 5; feed columns are the wave 5 feed | wave 5 |
| Vendor to manufacturer mapping, "Charge tax = false" to the exempt VAT category | Both are legal designations (GPSR, VAT) an owner makes on purpose; a guess in either direction is a legal error | never automatic |
| Emailing the file | A file with personal data in an email is the leak the link avoids (GDPR Art. 5(1)(f), 32) | not planned |
| Per-plan limits, a platform admin's override of a store's limits | Constants first; the plan comparison names them | later, with plans work |
| An import as a whole undone | A bulk edit has an undo because it records before and after; an import's before is not kept (a file can be 5,000 products). The job's items say what changed | not planned |
| A public API or webhooks for the same data | Wave 9 | wave 9 |
| An AI tool that starts or applies an import or an export | Files hold personal data; an import writes the catalogue | not planned |
| Platform-level (Kaizen's own) exports | There is no platform CSV need in these five rows | wave 8 if wanted |

---

## 8. Needs human legal review

This run adds **no consumer-facing text** and no consumer legal text. These staff-facing statements and rules are hand-written and need a person to read them before real use; none is
machine-translated, none is in the AI catalogue.

1. The warning on the customer and order export pages ("This file contains personal data. Keep it only as long as you need it; it is deleted from here after 7 days.") and the line
   "Kaizen does not record marketing consent yet. Do not treat this file as a mailing list." (GDPR Art. 5(1)(c), (e), (f), 6, 7; ePrivacy marketing consent).
2. The **minimal default profile** of the order file and the rule that an erased person's order is exported with no personal field (2.3.5), and the owner-only access (4.7): a data-protection
   judgement for the store's adviser, GDPR Art. 5, 25, 32.
3. The retention of a customer or order file: 7 days, and its deletion on an erasure (3.6, 3.7).
4. The bulk price confirmation sentence "Lowering a price shows shoppers a reduction against the lowest price of the last 30 days." and the rule that no compare-at price is ever imported
   (Directive 98/6/EC Art. 6a): a pricing lawyer should read it.
5. The Data Act (Regulation (EU) 2023/2854, Chapter VI): whether Kaizen is a "provider of data processing services", whether its stores' exports meet the "exportable data" duty and whether the register of
   data structures and formats (Art. 26) must name the files of section 4. The text was **not** read from EUR-Lex (section 1.3). The files here are built to be a good answer either way.
6. Order file and VAT: `shipping_vat` and the VAT split are the stored order's, not a tax return; an accountant should confirm the columns suit the national bookkeeping (Norway: bokføringsloven, Sweden, Denmark).
7. The main-currency columns are indicative; the sentence on the export page saying so needs a read.
8. The sentence on the order export page about test-mode orders ("…marked test_payment = true. They are try-outs, not sales: leave those rows out of anything you give your accountant.") and the rule that an erasure removes only the files that can hold the person (13.4): a data-protection reading of whether keeping the others is enough under GDPR Art. 17.

---

## 9. For the lead

### 9.1 Blockers

None. No owner decision from `docs/parity-plan.md` section 5 is needed and no credential stops the work. Two **questions** (not blockers) for the lead before the run starts, with the default the run will take
if nothing is said: (a) owner-only access for the order and customer files (default: yes, 4.7); (b) the platform row's consent criterion (default: reword, 6.6.1; rating partial until then).

### 9.2 Migrations expected

Additive only, so the old code runs against the new schema until the deploy ends.

1. `*_data_jobs.sql` (generated): `data_jobs`, `data_job_items`, `data_job_assets`, `bulk_edit_batches`, `bulk_edit_items`, their checks, indexes and foreign keys (composite on `(store_id, …)`).
2. `*_data_jobs_rules.sql` (custom): the one-active-import unique index, the status and immutability triggers, the bulk items' append-only trigger. **No `DELETE` or `DROP` inside a function**: none is needed.
3. `*_data_buckets.sql`: the `imports` and `exports` buckets (private), as `order_invoices_rules.sql` did for `documents`.
4. `*_data_plan_features.sql`: four `plan_features` rows with grants as the seed did.
5. `PERSONAL_DATA`/`COPY_RULES` need no SQL.

Production applies them through CI (`docs/ci-migrations.md`); the `ownerStatements` of the old flow are empty. After the deploy, check the **security advisors** (RLS on the new tables as for the other `commerce` tables, the buckets private, no
public policy) and the **performance advisors** (the foreign key indexes on `store_id`/`job_id`, the keyset indexes the export reads use: `orders (store_id, placed_at, id)` exists as `orders_store_placed_idx`; check `customers`).

### 9.3 Decision row, draft

`D165` (the number is the next free one: `docs/decisions.md` ends at D163 and `CLAUDE.md` already cites D164 for the replicator's rows kept as pictures, which has no row; use the next free number):

> **Data in and out: CSV for products, orders and customers, and bulk editing (wave 2, first run).** `docs/wave-2-data.md` is the contract. One job table (`commerce.data_jobs`) runs a product import (a dry run that lists every row's problem, then a resumable apply through `saveProduct()` and `commerce.set_price`, Kaizen and Shopify files, pictures fetched through `safeFetch()` into the media library, never a delete, never a handle change), a product export, an order export (one row per line, VAT split out, order and main currency, copied history marked, an erased person's order without personal fields), a customer export (consent is `not_recorded`: Kaizen has no consent record yet) and, in the products list, bulk actions and a grid with a preview and an undo (`bulk_edit_batches`). Large exports are jobs delivered by a signed link to the signed-in member, never emailed; files are private and deleted after 7 days or at erasure. Every analytics table has a CSV for the period and comparison on the page (a scan test holds it). All text goes through one formula-safe writer (`src/lib/csv.ts`), with Excel (Nordic) as a dialect. Rows: `catalogue.bulk-product-import-and-export-csv`, `catalogue.bulk-editing`, `orders.order-export-to-csv`, `analytics.export-reports-to-csv` full; `platform.product-customer-and-order-csv` partial (consent, wave 5).

Migration versions go in `docs/decisions.md` (Migration versions) after CI applies them, as for D161.

### 9.4 CLAUDE.md bullet, draft (Admin section)

> - **Data in and out (wave 2, D165, `docs/wave-2-data.md`)**: imports and exports are `commerce.data_jobs` (`src/server/data-jobs.ts`: claimed, resumable, run in ticks by `after()`, the open page and the five-minute cron; a job is a row, its files are in the private `imports` and `exports` buckets and are deleted after 7 days by `pruneDataJobs()`). Every CSV is written and read only by `src/lib/csv.ts` (`writeCsv()`: OWASP's formula characters escaped, `toCsv()` delegates; Excel (Nordic) is a dialect); never join cells by hand (`csv-writers.test.ts`). A product import goes only through `getProductForEdit()` and `saveProduct()` (so `commerce.set_price` and the editor's checks apply; `product-import-writers.test.ts`), never deletes, never changes a handle, never imports a compare-at price, never turns `Vendor` into a manufacturer or `Charge tax` into the exempt VAT category, and fetches pictures only through `safeFetch()`. A bulk action does the same and records before and after in `bulk_edit_items` for the undo; one audit entry per batch or job, never per product. Order and customer files are owner-only, minimal by default, mark copied (`C-`) and host orders, carry no personal field of an erased person's order, never a secret or token (canary tests), are never emailed, and an erasure deletes the ready ones; the customer file's `marketing_consent` is `not_recorded` until wave 5 records consent. Amounts are `decimalAmount()` of integers; main-currency columns are indicative and blank without a rate; a new money read needs a euro scenario in `checkout-kinds.int.test.ts`. Every analytics table is in `ANALYTICS_TABLES` with a CSV button (`analytics-export.test.ts` fails for a table with none); the figures come from the page's own loaders. New tables are `never` in `COPY_RULES`.

### 9.5 Other for the hand-over

- Plan comparison (D132): the four rows of 5.5. AI manager: `list_data_jobs`, `explain_import_problems`, the `import-products` skill.
- Fixtures: do **not** commit Shopify's template file; write a small file with the same header row (the header names are facts) and a few made-up products, so no Shopify text is copied.
- The e2e needs a signed-in member: use the helper of `e2e/admin.spec.ts`. The Chromium and `outputFileTracingIncludes` rules do not apply (no route here launches a browser).
- `pnpm parity:write` after the rows are re-rated; `docs/shopify-parity.md` is generated.

---

## 10. Foundation notes: where the built contract differs from sections 1 to 9

Written by the foundation step of the run (schema, migrations, pure libraries). Each point changes the spec above where they disagree.

1. **Amounts are written by `amountCell()` (`src/lib/csv.ts`), not `decimalAmount()`** (4.2, 4.5, 2.3.3). `decimalAmount()` of `src/lib/dac7.ts` reads Intl's *display* digits, which give HUF none, while storage counts every currency in hundredths (`minorUnitDigits()`); it would write a HUF amount a hundred times too large. `amountCell()` uses `minorUnitDigits()`, like `amountText()` of `field-money.ts`. `decimalAmount()` is left as it is for the D161 files.
2. **`toCsv()` is not delegated to `writeCsv()`** (4.6). The two differ for a string that looks like a number (`toCsv` leaves `"-12.50"` as it is, `writeCsv` escapes a text) and for text that starts with `'`. `toCsv()` keeps its output and its tests; both are allowed by `csv-writers.test.ts`.
3. **Bulk edit: the status moves** (3.1). A `checked` import may go back to `checking` when its options change (the dry run is made again): the only move back, held by `commerce.data_job_move_allowed()`. A job stamps `finished_at` itself when it ends, and refuses a changed file (`input_sha256`, path, size) once registered, changed options of an export, and changed figures of an ended job. An import starts `uploaded`, an export `queued`.
4. **`commerce.start_export_job(store, kind, requested_by, options, max)`** counts the active exports under a lock and inserts the job (`data_job.too_many_exports`), so the limit of 3 holds when two requests come at once (3.1 left it to "the start function"). A product import's one-active rule is the unique index.
5. **Bulk records** (3.4): `bulk_edit_items` has `seq` (primary key `(batch_id, seq)`) and the outcome `undone`; a batch is undone once (unique index on `(store_id, undo_of)`), within 7 days, never an undo of an undo, and is marked `undone_at` only when its undo exists. `product_id` and `variant_id` have no foreign key (history; a product that is gone cannot be undone).
6. **More finding codes** (4.4): `file.too_many_products`, `file.ragged_row`, `weight.invalid`, `product.exists`, `product.missing`, `product.not_published` (error: "skip it" for an unpublishable product), `vat_category.unknown`, `active.invalid`. `delivery.not_importable` is a warning for Shopify's "does not require shipping" and an error when a variant's delivery would change.
7. **Blank means clear, with exceptions that cannot be cleared**: status, SKU, stock (a blank stock cell keeps the stock), `active` and `delivery` keep their value when blank. A new product's handle is the file's; an existing product's is never changed.
8. **An archived product**: the editor's save makes a draft of it, so the plan says `archiveAfter: true` and the server calls `setArchived(true)` after the save. A file whose status is `active` or `draft` for an archived product un-archives it.
9. **A file can also be UTF-16** (a byte order mark decides) besides UTF-8 and Windows-1252: Excel's "Unicode text" saves that way.
10. **Plain custom fields** (4.1.4): `text, textarea, number, measurement, email, url, phone, select, radio, buttons, checkbox, boolean, date, datetime, time, color, money` (`PLAIN_FIELD_TYPES`, `src/lib/field-csv.ts`). Choices are written by key, a measurement as `250 g`, money as `12.50 NOK`, a checkbox list as `a | b`. Variant fields: `variant_field:{name}[:{locale}]`.
11. **Analytics** (2.8, 5.5): the registry has about fifty entries (every `DataTable`, chart's data table and hand-made table of the views). A view says `exportId="…"`, or `exportable={false} exportReason="…"` with the reason in `NOT_EXPORTED`; a hand-made `<table>` says `data-export-id`. `analytics-export-views.test.ts` is red until the analytics area's views carry the props.
12. **Order numbers** pasted for a selection are matched as typed (trimmed, not upper-cased): a prefix may be lower case.

---

## 11. Admin notes: where the built pages differ from sections 2 and 5.4

Written by the admin step of the run (the pages and components of products, orders and customers). Each point changes the spec above where they disagree.

1. **A page asks `read`, the action asks `write`** (5.4): `permissions.scan.test.ts` holds a page to its area's `read` key, so the import page, an import's page and the bulk grid ask `products:read` and then answer a 404 (`notFound()`) to a member without `products:write`; every server action of those pages asks `products:write`. The order and customer export pages ask the owner role, as the spec says.
2. **No cancel for an export.** The pipeline has `cancelJob()` for any job, but an export finishes by itself and its files go after 7 days; a Cancel button would need a `write` key on a read-only page. An import has Cancel (on its page, while it is being checked or applied, and next to Import).
3. **The grid page also lists the store's recent bulk changes** (`/products/bulk` without `?ids=`, and under a grid), with Undo for each change inside the seven days, so an undo does not depend on the page that made it still being open.
4. **"Select all N matching"** is built on the server's `matchingProductIds()` (capped at 500, said in words), but the products list shows every product of the filter (it is not paged until wave 3), so *Choose all products shown* and *Choose all N listed products* choose the same; the second is the server's answer and its cap.
5. **The bulk bar is on the Current and Archived views**, not on *Needs content*; Archived offers only Unarchive.
6. **Order numbers for a selection** come from an order's page (*Export this order*, the owner only) or are pasted; *Check the numbers* (an owner-only action) lists which are the store's and which are not before a file is made.
7. **End-to-end:** the repository has no signed-in admin fixture (D158), so `e2e/data-export.spec.ts` holds that the new pages and routes give a visitor without a session nothing; the signed-in paths of 6.1 to 6.5 are held by the view tests and the integration tests, which call the functions the pages call.
8. **Files:** `src/lib/data-admin.ts` (the sentences and the pure rules of the pages), `src/lib/bulk-admin.ts` (the bulk panels' requests and the grid's changed rows), `src/components/admin/data/*` (forms, job views, findings table, import flow, tracker), `src/components/admin/products-bulk.tsx`, `products-grid.tsx`, `bulk-result.tsx`, `bulk-recent.tsx`.

## 12. Analytics and AI notes: where the built tables, tools and plan rows differ from sections 2.8 and 5.5

Written by the analytics-and-ai step of the run. Each point changes the spec above where they disagree.

1. **The button is a form in a scope** (2.8). A page wraps what it draws in `<ExportScope base query owner canExport>` (`src/components/admin/analytics/export-scope.tsx`, the only client component of the area), and a table or chart with an `exportId` draws `<ExportButton>` inside it: a POST form to `/admin/{store}/analytics/export` carrying the table's id and the page's address parameters (`queryText()`: `period`, `compare`, `from`, `to`, `sort`, `dir`, `limit`, `status`, nothing else). Without a scope (a table drawn on its own, in a test) or for a member without `analytics:write` no button is drawn. A chart's button is under its data (the *Data table* disclosure), a table's beside it; a table with no rows and a chart with nothing to draw have none.
2. **Owner-only tables** (4.7, 6.4). Besides `analytics:write`, the **top customers** (`customers.top`: it lists names and emails, and the customer file is the owner's) and the **targets** (`settings.targets`: the owner-only settings page) need the owner role (`OWNER_ONLY_TABLES`); the button is not drawn for anyone else and the route answers 404. The spec asked only for `analytics:write`.
3. **Registry corrections** (the foundation's list was read from the views' column definitions, not from the loaders): `products.table` compares only revenue and units (the loader has no previous orders, margin or refund rate: they were `previous` by mistake) and has `handle` where it had `sku` (the page lists products, not variants); `overview.channels` is the page's five columns (channel, revenue, orders, conversion, ROAS); the cohort tables have the columns the table has (`month_0`, `1`, `2`, `3`, `6`, `12`, not thirteen months); a chart series' first column is `bucket` (the bucket's first day, not `period`, which the `period_from` and `period_to` columns already name); `overview.factors` is a decimal in percent, not an amount; `finance.revenue_profit` compares only net revenue, as its chart does.
4. **Same loaders, same rows, no totals** (2.8). `src/server/analytics-export.ts` calls the page's loaders with the page's arguments and shapes the rows the page draws with the views' own exported helpers (`sortProducts()`, `sortVariants()`, `countryRows()`, `bridgeRows()`, `bridgeBars()`, `factorRows()`, `trendMonths()` and so on), so the order, the labels and the figures are the page's. A footer or totals row of a table is not in the file (a column sums). A table is the whole of its rows: the products table has every product, not the page's first 50, and the inventory table every variant of the page's filter. The advertising-spend table is the one place the file has more than the page: the page lists the latest 25 entries, the file every entry of the chosen period (up to 1,000), from the same reader (`listSpend()`).
5. **The days** (2.8): `period_from` and `period_to` are the first and the last day (inclusive), `previous_from` and `previous_to` likewise; a table with no period (the inventory today, the targets) says the day it was made in both. The file's name is the table's id and the two days.
6. **The log entry** (5.2): `analytics.table_exported` with `table`, `from`, `to`, `compared`, `rows`, `leftOutOrders` and `leftOutCurrencies`, written before the file is handed back (no entry, no file). The entry holds no cell, no name and no amount.
7. **The AI manager** (5.5): two read-only owner tools, `list_data_jobs` and `explain_import_problems` (`src/server/data-job-tools.ts`, `src/lib/data-job-help.ts`), both `products:read` (the first narrows the kinds to what the member may use: order and customer files are the owner's and are refused in words, never answered with an empty list), served by the store's MCP server like every owner tool, ungated. `explain_import_problems` groups the stored findings by code in code (`groupFindings()`), with what to do for each (`FIX_FOR`, typed over every finding code, so a new code is a compile error until it says what to do) and up to five handles; it never quotes a cell and gives no file name, path or link. There is no tool that starts, applies, cancels or downloads, and a test fails if one is added. The playbook is `import-products` (`src/lib/assistant-skills.ts`).
8. **Plan rows** (5.5, 9.2): migration `*_data_plan_features.sql` adds the four rows in the new category **Data**, positions 501 to 504, described only and in no plan; no `DELETE` or `DROP`.
9. **Not built:** a CSV for the VAT, OSS and IOSS tables (they keep D161's four files, listed in `NOT_EXPORTED`); a per-plan limit; a scheduled email of a table (wave 2, `analytics.scheduled-report-emails`).

## 13. Review fixes: where the built contract differs after the first review

Written by the fix step. Each point changes the spec above where they disagree.

1. **The last day of an order range** (2.3.1, 6.2). The range is from the first day's local midnight up to the local midnight AFTER the last day: the next day is added to the DATE and then made a moment in `stores.time_zone`. An interval added to a timestamp adds a flat 24 hours in the database session's zone (UTC) and was wrong on the two clock-change days (an order at 00:30 on 30 March was in 29 March's file, and one at 23:30 on 25 October was in no file). `countOrderExportRows()` shares the filter.
2. **Test-mode orders** (2.3.5, 4.2). The order file has a column `test_payment` (after `host_order`): true for an order paid in Stripe's test mode, by the same test as `commerce.invoice_eligibility()`. Such orders stay in the file (analytics' `PAID` counts them too, so the file still ties to Finance) and are marked, never silently left out.
3. **No file is left in the bucket that no row names** (3.7, 8.3). A run writes a chunk or a part a moment before it records it. When the record cannot be saved (the job was cancelled, or an erasure took it) the run removes what it just stored; every removal of an export's files (a cancel, a failure, an erasure, the nightly retention) LISTS the job's folder `{store}/{job}/` (`DataStorage.list()`, `exportFolderFiles()`) instead of trusting the row's cursor, and the nightly job sweeps the exports bucket for the folder of a job that is purged or has no row (`sweepOrphanExports()`, at most 500 folders a night). An erasure stops the job first and removes the files after, so a run still writing fails its next save.
4. **An erasure takes only the files that can hold the person** (3.7, 8.3, `storage:exports`). `removePersonalExports(storeId, deps, scope)` takes an `ExportScope` (when the person's customer record began, when their first order was placed, read BEFORE the rows change and kept in the request's `steps.exportScope` for a resumed run). An order file can hold them only through their orders and a customer file through their record or their orders, and only if it was finished after that; a stranger who opened an account and deleted it takes nothing. A queued job has read nothing and is left to run (its readers skip an erased person); a running one may have a batch with the person in the air and is cancelled. This changes 3.7's "queued or running jobs are cancelled": only a running one that can hold the person.
5. **Stock is not written from a stale read** (2.2, 2.6). `saveProduct()` takes an optional `StockMode` (`{ loaded, relative? }`: the stock each existing variant had when the caller read it). A variant whose stock is unchanged is left alone (a sale paid since the read stays paid; the editor passes no mode and writes as before); a changed one is written as given, or, with `relative`, as the change applied to what is there now (`greatest(0, on_hand + (stock - loaded))`). The product import fetches pictures and makes categories FIRST and reads the store again and plans from that fresh state immediately before `saveProduct()` (before, the snapshot read before a fetch of seconds was written back); the bulk stock "adjust" action is relative.
