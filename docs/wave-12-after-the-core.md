# Wave 12: what code can still close after the core (decisions D395 onward)

The contract for wave 12, written on 2026-10-29 after wave 11 (D380 to D394), from the parity tracker as rated that day (`docs/parity/rows`:
201 core rows, **88.8 %** weighted, **87.8 %** with app-only features) and the open PSI follow-ups (`docs/audits/psi-followups.md`).
Every gap named below was checked against the code that day. Code, tests and texts follow this file; a unit that changes course says so
here first.

## Where things stand

- **57 rows are short of Full.** Most wait on something outside the code:
  - **people:** an accountant, a lawyer, an accessibility auditor, the PCI attestation (bucket D);
  - **partners and accounts:** Kaizena Flow's Mollie app, carriers' production services, a real Supabase two-step sign-in, Stripe
    test-mode runs on a real store (bucket B);
  - **the owner's decisions** (bucket C, `docs/wave-11-core-and-psi.md` section 4, unchanged): the app directory, SMS marketing, POS,
    theme code access, followed theme updates, the deploy waiting for checks.
- **What code alone can still close** is small and spread over weight-2 rows. This wave builds it, plus the PSI's engineering
  follow-ups, which move no row but keep the code honest.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows or items |
|---|---|---|---|
| A | D395 | Saved reports emailed on a schedule | `analytics.scheduled-report-emails` (missing) |
| B | D396 | Pre-orders: a variant sold before its release, kept apart from what can be sent | `catalogue.pre-orders` |
| C | D397 | Stock per location in the product editor; the locations row re-read | `orders.multi-location-inventory-and-routing` |
| D | D398 | The storefront API's cart kept by Kaizena Flow, and its contract as a published document | `platform.storefront-api-and-headless` |
| E | D399 | Checkout rules that reorder delivery options, and the rules and questions through the Admin API | `checkout.checkout-extensibility-ui-extensions-functions` |
| F | D400 | The PSI's engineering follow-ups: `log()`, typed money reads, writers that refresh their own tags | PSI REL-02, CODE-02, DATA-02 |

## 2. The units

### A. Saved reports emailed on a schedule (D395)

**Built (D395).** As designed, with two changes: a schedule runs the saved report's own period (as of the day it is sent) instead of a period
of its own, so the email shows what the report's page shows; and a schedule claims its store day in `last_run_on` rather than a table of runs.

**What is missing.** Only the autopilot's weekly report is emailed; an owner cannot have a saved report (D345) sent to them.

**Design.**
- A saved report gets a schedule (`commerce.report_schedules`: the report, `daily`, `weekly` with a weekday or `monthly` with a day,
  the hour on the store's clock, the period it shows (`yesterday`, `last_7_days`, `last_week`, `last_month`, `month_to_date`), the members
  it goes to, on or off), written only by `src/server/report-schedules.ts` (`analytics:write`, recipients only members whose role reads
  analytics, at most five schedules a store).
- `sendScheduledReports()` in the five-minute dispatcher claims a run per schedule and period (`report_schedule_runs`, once), runs the
  report through `runReport()` only, reads each recipient's membership again before sending, and emails the table (the first 50 rows, the
  totals, a link to the report) with the CSV attached; a run that finds nothing says so, never an empty table without words.
- Words in the `customReports` catalogue (en, nb) and the staff email in the recipient's admin language.

### B. Pre-orders (D396)

**What is missing.** A variant cannot be sold before it exists: there is no release date, nothing says *pre-order*, and such an order is
not kept apart from what can be sent.

**Design.**
- A physical goods variant may be on pre-order (`product_variants.preorder_until`, a date; pre-order while it is in the future), sold
  without stock up to an optional limit (`preorder_limit`), paid in full at checkout (no deposit: a deposit is a second payment the order
  does not have).
- Every place that shows or sells it says so (`m.preorder`, four languages by hand, `HAND_WRITTEN_ONLY` for the legal review of the
  delivery promise): the card, the product page, the cart line, the checkout, the order and the confirmation email name the expected date.
- The order line keeps the date (`order_lines.preorder_until`); *To send* leaves out a line until its date, the Orders list filters
  pre-orders by date, and the shopper's withdrawal period counts from receipt as ever.
- `cartSummary()` and `placeOrder()` treat it as goods; a scenario in `checkout-kinds.int.test.ts`, euro included.

**As built (D396).** A pre-order is a variant that keeps selling at zero with a release date (`preorder_until`), so it reuses the backorder
path end to end (the claim, `backorder_quantity`, restocks) and only the words, the dates and *To send* differ. Left for later: the limit
(`preorder_limit`), a CSV column and the AI manager's field. Cards say it from the cached catalogue (the earliest date of the product's variants),
so a card may say it for up to the cache's day past the date; the product page reads the stock per request. The line's date is kept as sold and is not frozen, so a later "move the release date" can change it on purpose.

### C. Stock per location in the product editor (D397)

**What is missing.** With several locations, a variant's stock is edited only on the Inventory page or by file. The row's other gaps were
closed by D383 (transfers, nearest routing, locations kept out of online orders, the plan-based perf test, the e2e); its text is out of date.

**Design.** The product editor shows one stock field per active location when there is more than one, saved through `saveProduct()`'s
stock path (`StockMode.loaded`, so a sale since the editor opened is not written back) with a movement per changed location; a test, and
the row's gap re-read against its criteria.

**As built (D397).** As designed, through the editor's own save (no `StockMode` is needed: each figure carries what was read beside it).
A new variant opens where it was given stock. The total stays the sum of the locations' fields; the Inventory page and the file still edit
the same levels.

### D. The storefront API's cart (D398)

**What is missing.** The cart is quoted and handed over, not kept and changed through the API; a quote does not say how many may be
bought; the contract is listed on a settings page only.

**Design.**
- `POST /carts`, `GET /carts/{id}`, `POST /carts/{id}/lines`, `PATCH`/`DELETE /carts/{id}/lines/{line}`: a real cart of the store
  (`carts.source = 'api'`), changed only through the cart's own functions (`changeLine()`), its id a secret the token holder keeps, its
  checkout the store's own page through the existing hand-over.
- A line says `available` (what `sellableQuantity()` allows).
- The contract is a page (`/developers/storefront-api`, versioned, English), its routes from `STOREFRONT_ROUTES`.

**As built (D398).** As designed, with two changes: a cart is named by a key kept as a hash (never its id, which is also a cookie's
value), and the contract is an OpenAPI document at `/api/storefront/v1/openapi.json` made from the routes, not a page of Kaizena Flow's site
(a page would take a reserved address and a Norwegian twin). `available` existed already in the quote.

### E. Checkout rules that reorder, and rules through the API (D399)

**What is missing.** Rules hide and rename options but cannot order them; the rules and questions have no Admin API route.

**Design.** An effect `order_delivery` (the options named first, the rest after in their own order) in `checkout-rules.ts` through
`rulesOnOffer()`; Admin API routes `checkout_rules` and `checkout_fields` (read and write, scope `checkout`) over the same writers.

### F. The PSI's engineering follow-ups (D400)

- REL-02: every remaining `console.error` in `src/server` moves to `log()`.
- CODE-02: the remaining money reads in analytics, payouts, refunds and tax reports go through `typedRows()`.
- DATA-02: the listed writers refresh their own tags.

## 3. Rules for every unit

The house rules of `docs/wave-11-core-and-psi.md` section 3 hold: one writer per table, audited; `COPY_RULES`, the personal-data register
and the export for a new table; a euro scenario for a new money read; hand-written shopper words flagged for review; `log()` and
`typedRows()` for new server code; an integration test, a signed-in e2e where a unit adds a screen; parity rows re-rated with history;
a decision row; migration versions recorded after CI.

## 4. Waiting on the owner

The decisions of `docs/wave-11-core-and-psi.md` section 4, and the agents' eval recording: run it once on Platform → AI so its recording
can be committed and CI's replay goes live (D391).

New in this wave: whether the storefront API may say how many of a variant a line can hold (D398). Today a line's `available` and a
variant's `stock.max` are the store's own capped figures (the stock up to the line's most), as its quantity picker and cart show them; the
parity row's criterion 3 asks for no more than an available flag. Narrowing it to a flag is a small change, at the cost of a front end
that cannot cap its own quantity field.
