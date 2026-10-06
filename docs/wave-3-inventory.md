# Wave 3, run 1: the inventory page, adjustments with reasons, backorders and stock locations with routing (decision D172 proposed)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-inventory.md`. Code, tests and texts follow
it; a disagreement is settled here first (the agent that must deviate changes this file in the same edit and says so in its
report). It was written from the tracker rows, `docs/parity-plan.md`, CLAUDE.md and the code as it is on 2026-10-06 (commit
`4970ccf`), and it is the model of `docs/returns.md`. It builds on what exists (per-variant `inventory_levels`, `inventory_locations`,
row-locked `inventory_reservations`, `commerce.available_stock`, `complete_order_payment()`, `refundOrder()`, the inventory analytics
of D152) and invents no parallel stock system.

**What was found in the code that shapes everything below** (verified 2026-10-06):

- Stock is `commerce.inventory_levels (variant_id, location_id) -> on_hand` with the check `inventory_levels_on_hand_non_negative`.
  There is **no history of any change** (no movements table).
- Reservations (`inventory_reservations`) are taken only by `placeOrder()` when checkout starts, expire after `CHECKOUT_MINUTES + 5`
  and are released by `complete_order_payment()` / `cancel_unpaid_order()`. A cart holds nothing. **Paying draws `on_hand` down at
  once** (the SQL function; Kaizen has no "committed until sent" state: an order that is paid and not yet sent is already out of
  `on_hand`). `commerce.available_stock.available = on_hand - live reservations`.
- Every reader sums `available` or `on_hand` over `inventory_locations.active`: `cart.ts` (twice), `catalog.ts getAvailability()`,
  `product-conditions.ts inStockNow()`, `campaigns.ts giftItems()`, `wishlist-admin.ts`, `standing-orders.ts` (its own copy of the
  arithmetic, `greatest(on_hand, 0)`), `control-center.ts`, `owner-tools.ts`, `owner-insights.ts`, `analytics-inventory-data.ts`.
- Writers of `inventory_levels` outside tests: `saveVariants()` in `products.ts` (the editor, the CSV import and the bulk editor all go
  through it; one number, written to `stockLocation()`, the store's first active location by `created_at`), `putBack()` in
  `order-admin.ts` (refund, cancel and return restock, always to the first active location that has a level), `setStockTool()` in
  `owner-tools.ts`, `complete_order_payment()` (SQL, live definition patched last by `20261004125337_order_invoices_rules.sql`),
  `clone_store()` and `duplicate_store()` (SQL), the `add_demo_*()` functions and `supabase/seed.sql`.
- `complete_order_payment()` draws "first where the items were held, then anywhere stock is left", and a shortfall (a hold that
  expired and the stock sold meanwhile) is only an `order_events` row `stock.short`. Subscription renewals call it with no
  reservations, so they draw "anywhere".
- `src/lib/analytics-inventory.ts` already has `InventoryRow.tracked` and `lowStockThreshold`; `analytics-inventory-data.ts` always
  passes `tracked: true` and `lowStockThreshold: null` ("no per-variant warning level in the store's data").
- The repo has **no signed-in admin fixture** (D158): signed-in admin paths are held by `renderToString` view tests and server
  integration tests, never by a click-through e2e (see the honesty notes in 1.1).
- The "five-minute cron" is `/api/cron/cart-reminders/route.ts`; the daily clean-up is `runRetention()` in `src/server/retention.ts`.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `catalogue.inventory-tracking-with-reservations` | 5 | partial | A | **Partial, becoming Full** only when the signed-in screens have been checked by hand (9.7) and the skeptic accepts view tests plus server integration tests as the evidence for criteria 1 and 3. The history (criterion 2) and the low-stock crossing (criterion 4) are held by database and integration tests and can be Full on their own. D165's bulk editor was rated partial for exactly this reason (a screen the tests never click), so the expectation here is **partial** until that is settled. |
| `catalogue.sell-when-out-of-stock` | 3 | missing | A | **Full**, held by a storefront e2e (cart and product page), a database rule test and integration tests. The statements it adds about delivery time are listed in section 8; they are delivery-time information, not terms of sale, so the recommendation is Full once the tests pass and the lead has read them, but if the lead applies D158's "a row that rests on unreviewed text stays partial" to them it stays partial. The lead decides. |
| `orders.multi-location-inventory-and-routing` | 2 | partial | A | **Partial, becoming Full** on the same conditions as the first row (a locations screen no test clicks). The routing, the refund restock to a location, the deactivation report and the performance guard are all held by integration tests. |

No row of this run is bucket B, C or D. Nothing here needs a third party, a credential or an owner decision from
`docs/parity-plan.md` section 5, so `blockers` is empty. The weight of a row is not changed here (rule 6 of the tracker).

Not in this run although the Shopify feature is nearby (each with a reason in section 7): inventory transfers and purchase orders
(`catalogue.inventory-transfers-and-purchase-orders`), pre-orders with a release date (`catalogue.pre-orders`), local pickup from a
location (`orders.local-pickup-at-own-location`), back-in-stock notifications (wave 5), partial fulfilment (`orders.fulfilment-workflow-partial-fulfilment`).

### 1.2 What Shopify does (pages read on 2026-10-06; the three rows' own pages were read 2026-10-02 and 2026-10-03)

- **Inventory states** (https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states): *on hand* is every unit
  at a location and is the sum of *committed*, *unavailable* and *available*; committed units are set aside and cannot be sold (an
  unfulfilled order, a draft order); unavailable is damaged, quality control, safety stock or held by an app; *incoming* is stock on
  its way from transfers or purchase orders. A sale raises committed and lowers available; a cancellation reverses it; a refund
  raises available again when the returned items are received; editing on hand changes available by the same amount.
- **Continue selling when out of stock** (https://help.shopify.com/en/manual/products/inventory/setup/selling-when-out-of-stock): a
  per-product or per-variant setting in the Inventory section, available only while *Inventory tracked* is on; an item is out of stock
  when tracked and the level is zero or below; with the setting on, customers can buy at zero or negative levels. It does not apply to
  POS (staff are warned). With several locations only locations that fulfil online orders count for the online store. The page says
  nothing about how a backorder is worded to the customer, so Shopify's own docs give no wording to copy.
- **Adjusting quantities** (https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjusting-inventory-quantities):
  two methods, *Set to* (a counted figure) and *Adjust by* (add or subtract); reasons *Correction*, *Count*, *Received*, *Return
  restock*, *Damaged*, *Theft or loss*, *Promotion or donation*; states that can be adjusted include available, on hand and the
  unavailable reasons (damaged, quality control, safety stock, other); changes are pending until *Save*; adjustable from the
  Inventory page (many products and locations at once), the product page and the variant page.
- **Adjustment history** (https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjustment-history): date,
  activity, *created by* (staff member, app or channel) and, per state, the adjusted quantity and the new total; manual reasons
  appear as activities (inventory correction, counted, received), automatic ones too (reservation created, transfer created);
  **only the last 180 days are shown** per product or variant, older changes are in a report.
- **Locations and order routing** (https://help.shopify.com/en/manual/locations/enabling-locations,
  https://help.shopify.com/en/manual/fulfillment/setup/order-routing/setting-up-order-routing): a location is any place that stocks,
  sells or fulfils; the number of locations depends on the plan; a location can be kept from fulfilling online orders; order routing
  rules (ranked locations, closest location, minimise split fulfilments, custom rules by apps) decide per item which location fulfils;
  routing needs two or more fulfilment locations and **does not prevent overselling** (the order is let through and staff move stock or
  change the location before fulfilling).
- **Not read:** how Shopify deactivates a location (the page read did not say what happens to its stock; Kaizen's rule below is its own)
  and whether Shopify sends a low-stock notice (Kaizen's criterion 4 stands on its own).

What Kaizen matches: levels per location, reasons, an adjustment history with who and when, selling past zero per variant, ranked
locations and a stated routing rule. What it deliberately does not match in this run: *unavailable* and *incoming* as states, the
closest-location rule, transfers, purchase orders (section 7).

### 1.3 Terms used in this file

- **On hand** (`inventory_levels.on_hand`): units physically counted at a location and not yet drawn by a paid order. A paid order has
  already drawn its units, so this is Shopify's "available plus unavailable", not its "on hand including committed".
- **Committed** (a page word): units held by live checkout reservations (`inventory_reservations`, not released, not expired). Nothing
  else is committed: a cart holds nothing and a paid order has already drawn its units.
- **Available** (a page word): on hand minus committed. It can be negative for a variant that sells on backorder.
- **In stock** (a shopper word): the variant's available units summed over **active** locations, never below zero.
- **Backorder**: a sale of units that are not in stock, allowed only for a variant with `stock_policy = 'continue'`. The units the
  sale takes beyond what was on hand are *backordered units*; they drive `on_hand` below zero.
- **Owed**: backordered units on paid orders that are not yet sent (the page's figure for what the store must still receive).
- **Rank**: a location's order for routing: `priority` ascending, then `created_at`, then `id`.

---

## 2. Behaviour

### 2.1 Shopper side

**The one rule: nothing changes for a variant whose policy is `deny` (the default).** It sells up to its stock, refuses more (the
existing test `refuses more than is in stock`), and an order for it never touches a negative number.

**A variant with `stock_policy = 'continue'` (physical goods only):**

1. *Product page.* The variant picker and the buy part (they already stream in per request inside `<Suspense>`; policy and days are read
   in the per-request stock read, **never in a `'use cache'` function**, so the prerendered shell does not go stale) show:
   - stock above zero: the usual "In stock" / "Only n left";
   - stock zero or below: **"On backorder: expected to ship within {days} days"** (`m.backorder.page(days)`), and the add-to-cart
     button is enabled. Choosing a variant that is on backorder never shows "Sold out".
2. *Add to cart.* `changeLine()` accepts any quantity up to `MAX_LINE_QUANTITY` (20 per line, said when capped, as today). The
   outcome is `added`/`capped`, never `unavailable` because of stock. `sellableQuantity()` returns `{ available, inStock, backorderDays,
   policy }`; for `continue` the cap is the line maximum, not the stock.
3. *Cart (page and slide-out) and checkout.* A line whose quantity exceeds `inStock` carries a note: **"{n} on backorder: expected
   to ship within {days} days"** (`m.backorder.line(n, days)`); the status of such a line is `ok`, not `insufficient`. Totals, VAT,
   discounts and shipping are exactly what they are for any line (a backorder changes no price, no tax and no shipping; free shipping
   thresholds count the whole line). `cartSummary()` and `placeOrder()` keep agreeing (criterion B5).
4. *Placing the order.* `placeOrder()` takes the free units from the routed locations (2.5) and reserves the **whole** line, the part
   beyond stock included, at the location the rule names (2.5 step 4), and writes `order_lines.backorder_quantity` (what the shopper was told) and `backorder_days` (frozen from the variant at that
   moment). A reservation beyond stock exists only for `continue` variants, and it says how much of it is beyond stock
   (`inventory_reservations.backorder_quantity`, 3.13): the rest is the order's own physical claim.
5. *Order page, confirmation email, My account.* Each line with `backorder_quantity > 0` says "{n} of {quantity} on backorder:
   expected to ship within {days} days of your order" (`m.backorder.order(n, quantity, days)`; the same sentence in `email-text.ts`
   for the confirmation). The page and the email never promise a date, only "within {days} days", and never say "in stock".
6. *Structured data.* `Offer.availability` is `https://schema.org/InStock` when in stock, **`https://schema.org/BackOrder`** when the
   variant is on backorder (policy `continue`, nothing in stock), `OutOfStock` otherwise (`structured-data.ts`, now fed by the stock
   view instead of a number).
7. *Listings, search, recommendations.* The "in stock" filter (`inStockNow()`) means **physically in stock** and does not match a
   backorder-only product; its label is changed to say so ("In stock now", nb "På lager nå", sv "I lager nu", da "På lager nu"). Product cards
   and the chat agent state a backorder only from the stock read ("On backorder, ships within {days} days"), never from the model.
8. *Not backordered, ever:* a campaign's free gift line and a weekly subscription box (`standing-orders.ts`) are filled only from free
   stock, as today (a `continue` variant with nothing free is simply left out, with the existing "left out" message). A subscription
   plan's first order and its renewals may draw a `continue` variant below zero (the renewal has no reservation and `draw_order_stock()`
   handles it, 3.5); digital, service, appointment, stay and rental variants have no stock and no policy.
9. *Business buyers and other currencies:* identical. Backorder wording is by language of the market (`t()`); there is no money in it.
10. *No cookie or storage* is set for any of this (`KNOWN_COOKIES` is unchanged).

**A variant with a location that was deactivated** simply has less stock: only active locations count (as today).

### 2.2 Staff side: the Inventory page (`/admin/{store}/inventory`, Products section)

Needs `products:read` to look, `products:write` to change. Owners and staff with those keys only (`requirePermission`).

**The list.** One row per active physical goods variant of an active or draft product, paged 50 at a time (keyset on product handle and
SKU), with a search box (title, handle, SKU) and filters: *Location* (all, or one: the figures below then are that location's),
*Status* (all, low, out, on backorder, negative). Columns: product and options, SKU, **On hand**, **Committed**, **Available**, **Owed**,
*Policy* ("Stop selling at zero" / "Keep selling: {days} days"), *Low-stock level*. With *All locations* the figures are sums over
**active** locations; a store with several active locations has a *Locations* disclosure per row that lists each location's figures
(including inactive ones, marked). Above the list: counts of low, out, owed and negative variants (links that set the filter).

**Adjusting.** Each On hand cell is editable (a *Set to* number) and each row has *Adjust by* (a signed number); a *Reason* for
the whole save (received, correction, recount, damaged, theft or loss, promotion or donation: codes `received`, `correction`, `count`,
`damaged`, `lost`, `promotion`; default `correction`) and an optional *Note* (up to 200 characters; the page says "do not write
about a person"). Changes stay in the browser until **Save changes** (a review list of every changed row with before and after, like
the bulk grid); nothing is written before it. Each row remembers the figure it was loaded with: if the stored figure has changed since
(a sale, another person), that row is a **conflict**, is not written, and is listed with the current figure; the others are written.
"Set to" is worked out under the row lock as a change from the current figure (3.3), so a sale between the page load and Save is never
undone. The result lists written, unchanged and conflicting rows. A figure below 0 or above 1,000,000 is refused with a sentence; a
row can go below zero **only by a sale of a `continue` variant**, never by an adjustment.

**Policy and thresholds** are edited in the product editor (per variant: *Keep selling when sold out*, *Expected to ship within*
(1 to 90 days, required with the setting), *Warn me when stock is at or below*) and in bulk from this page (the selected rows:
*Keep selling when sold out*, *Stop selling when sold out*, *Set low-stock level*), each saved through `saveProduct()` (so the
editor's validation holds). Turning a variant back to *Stop selling* while its stock is negative is allowed (3.3).

**History** (`/admin/{store}/inventory/history`, also reached from a row's *History* link with `?variant=`): newest first, paged;
columns date and time (the store's time zone), product and options, SKU, location, **change**, **new on hand**, **reason**, **by**
(a staff member's name, "Order {number}", "Return {number}", "Checkout", "File import", "AI manager", "System"), note. Filters: variant
or SKU, location, reason, date range. The history is kept 24 months (3.6); the page says so.

**File** (`/admin/{store}/inventory/import`, `/admin/{store}/inventory/export`): see 2.4.

**Locations** (`/admin/{store}/inventory/locations`): see 2.3.

### 2.3 Staff side: stock locations

- A store has 1 to `LOCATIONS_MAX` (20) locations; every store has at least one **active** one at all times (the database refuses
  the last deactivation). The first is made with the store, as today ("Main warehouse").
- **Add** (name 1 to 60 characters, country as a two-letter code from `countries`; the new location goes last in rank), **rename**,
  change country, **move up / move down** (renumbers `priority` 1..n in one transaction; the order is the routing rank, shown as
  "Orders are taken from the top location first"). Two active locations of one store cannot have the same name (case-insensitively).
  Add, rename and move need `products:write`.
- **Deactivate** and **Reactivate** are owner-only (`requireOwnerRole`): they take stock off or put it back on sale. The deactivate
  dialog first shows `locationImpact()`: **units on hand and variants** at the location and the units committed to live checkouts
  there. It is refused with a sentence while live checkout holds exist at the location ("{n} units are held by checkouts in progress;
  try again in a few minutes") and for the last active location. On confirm (the dialog asks for the unit figure it showed; the server
  recomputes and refuses if it changed) the location becomes inactive, its stock no longer counts for the shop, the audit log gets
  `products.location_deactivated` with the counts, the page says "{units} units across {variants} variants are no longer for sale;
  reactivate the location to sell them again", and the Inventory page shows the variants that are now sold out. Staff can still count
  or adjust an inactive location's levels (to move stock out by hand), and it appears on the history. Reactivating restores sale at once.
- A location is never deleted (levels, movements and refunds refer to it).
- What a location's **country** does today: nothing but label it (it is kept for proximity routing and local pickup, later waves).

### 2.4 Staff side: stock by file (dry run, then apply)

Two new kinds of the D165 jobs (`commerce.data_jobs`, run by the same ticks, claims, limits, buckets and clean-up; no second pipeline):
`inventory_export` and `inventory_import`.

- **Export** (a button on the Inventory page): CSV, one row per active physical variant and location (a variant with no level at a
  location is listed there with 0 only for **active** locations): `sku`, `product`, `options`, `location`, `on_hand`, `committed`,
  `available`, `stock_policy`, `backorder_days`, `low_stock_threshold`. Written by `src/lib/csv.ts` only (formula characters
  escaped). A small store gets the file at once, a large one a job with a Download button, as in D165.
- **Import**: the owner uploads a CSV (at most 15 MB, as D165) with the columns `sku`, `location` (a location name, empty only when
  the store has exactly one active location), `on_hand` (the counted figure), and optionally `on_hand_was` (the figure the file was made
  from), `reason` (one of the manual codes, default `count`), `note`, `stock_policy` (`deny` or `continue`), `backorder_days`,
  `low_stock_threshold`. The **dry run** reads every row and lists, per row, the variant, location, current figure, new figure and
  change, and every problem, **and changes nothing**; then the owner presses *Import* and the same rows are applied. Apply rules:
  1. a row with `on_hand_was` that differs from the figure at apply time is a **conflict** (skipped, listed): the file is a count of
     the stock as it stood, and a sale since makes it stale; without `on_hand_was` the row sets the figure as given;
  2. every change is one movement with `source = 'file'` and the job id; one audit entry per job (`products.inventory_imported`, counts
     only), never per row;
  3. an unknown SKU, a SKU on a digital or service variant, a location that does not exist, a figure that is not a whole number from 0
     to 1,000,000, a reason not on the list, a `continue` without days, days outside 1 to 90, a threshold outside 0 to 1,000,000, or a
     duplicate (SKU, location) pair is a finding (stable codes in `src/lib/inventory-csv.ts`, never quoting a cell); the row is skipped
     and the others go on; a file with more than 20,000 rows is refused;
  4. it never creates a variant, a location or a product, never deletes anything, never writes a negative figure.
- Findings and files follow D165's rules (a finding names a SKU or a column and never quotes a cell; files kept 7 and 30 days).
- Owners and staff with `products:write` (as the product import).

### 2.5 Routing: which location an order's units come from

One stated rule, in one pure function (`allocate()` in `src/lib/stock-routing.ts`) that `placeOrder()` calls after it has locked the
level rows:

1. Candidates are the **active** locations in **rank** order. Free units of a variant at a location = `on_hand - live reservations`,
   never below 0.
2. **Keep an order together.** If one location can supply **every** physical line of the order in full from its free units, the order
   comes from the first such location in rank order.
3. Otherwise each physical variant, in the order of the lines, takes from the locations in rank order: as much as the location has free,
   then the next (the order is split; the units of one variant are taken from the fewest locations the ranking allows).
4. **The backordered remainder** (units beyond free stock, `continue` variants only) is taken at the first location in rank order that
   has a level row for the variant, else at the first location in rank order (a level row with 0 is made there).
5. A variant whose policy is `deny` with less than the wanted units free anywhere makes the order fail with the existing `stock`
   problem and writes nothing.

All level rows an operation needs are **locked in the order (variant id, location id)**, by every writer, so two checkouts cannot
deadlock; the allocation is worked out only after the locks are held. Paying draws as in 3.5. Nothing here calls a carrier or a map.

**What staff see.** The order page shows, per line, where its units were taken from ("Oslo 2, Bergen 1"), read from the order's
`sale` movements (3.2), and a **Backordered** badge with the units and days. The order list has a *Waiting for stock* chip (paid, not
sent, a line with backorder units) beside *To send*.

### 2.6 Refund, cancel and return restock

- `refundOrder()`'s restock item gains an optional `locationId`. **Default:** the units go back to the location(s) they were taken from,
  worked out by `restockPlan()` (`src/lib/stock-restock.ts`, pure) from the order's movements: per (variant, location) the `sale`
  quantity minus what already went back there for this order, filled from the highest-ranked location first, within what is left to
  restore there. **Staff may choose** another active location per item in the refund dialog ("Put back at"; the default text says where
  they came from). A chosen location must be active and the store's own.
- If a default location is no longer active, the default is the first active location in rank order and the dialog says so.
- A restock above the quantity taken (a hand-typed quantity larger than the line) is refused as today (`Only n of … can go back in stock`).
  Units that were backordered and never physically existed are restocked like any other: the level rises by them (it was negative),
  which is what a refund of an unsent backordered unit should do.
- `cancelOrder()` restocks every remaining physical line through the same plan. A **return** (D153) inspected with restock goes through
  `refundOrder()` as today, so it restocks the same way and its movement carries the return id (`reason = 'return_restock'`).
- The order event `order.refunded` / `order.restocked` keeps `restocked: [{ sku, quantity }]` (analytics reads exactly these two keys)
  and adds `locationId` to each item; nothing that reads the old shape breaks.

### 2.7 Low-stock notice

An owner sets a *Warn me when stock is at or below* level per variant (a whole number 0 to 1,000,000; empty means no warning). The
level is compared with **on hand summed over active locations**. A variant **crosses** when that sum goes from above the level to at
or below it. Each crossing produces **one** notice, however many sales follow; the sum must rise above the level again before the next
crossing can happen. Rules (the state machine is `commerce.stock_alerts`, 3.4):

- Setting a level on a variant that is already at or below it does **not** send a notice (it is recorded as already told).
- Raising the level above the current stock counts as a crossing at that moment; lowering or clearing it re-arms or switches it off.
- The notices are sent by the five-minute cron as **one email per store per run** to the store's **owners** listing the variants that
  crossed since the last run (at most 50 lines and "and {n} more"), kind `stock.low`; the email says the stock figure, the level, the
  SKU and links to the Inventory page. It says nothing about sales, customers or prices. Subject and body are English (staff emails are
  English, like `return.overdue`). A failure to send never stops the cron and is retried on the next run (`notified_at` is set only
  after the send succeeded; the idempotency key is the store plus the newest crossing time). A store that is not open
  (`commerce.store_is_active()` false) gets none.
- The control center's attention and the store Home count "variants at or below their level" (the number of `stock_alerts` rows in state
  `low`), linking to the Inventory page filtered to low.

### 2.8 Platform side, emails, other kinds of order, markets, languages

- **Platform:** no new platform page. The plan comparison (D132) gets a row (3.8). Nothing for platform admins to do per store.
- **Emails:** the only new email is `stock.low` (staff, English). Customer emails change only by the backorder sentence in the order
  confirmation (2.1.5). `EMAIL_KINDS` gets `"stock.low": "staff"`.
- **Copied orders (`C-…`)** never draw, restock, reserve or are backordered: the existing triggers refuse (`inventory_reservations_refuse_copied_order`),
  and the same refusal is added for `inventory_movements`; `refundOrder()` already refuses a copied order. `order_lines` of a copied
  order keep `backorder_quantity = 0`.
- **Host orders** are stays and rentals with no stock; nothing changes.
- **Other currencies:** stock is a count, not money; no amount is added to any page. Backordered goods lines are priced exactly like others in
  every currency (the euro scenario of B5).
- **Languages:** shopper texts are `m.backorder.*` in `src/lib/i18n.ts` and the confirmation sentence in `src/lib/email-text.ts`, nb, sv, da
  and en by hand, English fallback; other languages come from the catalogue. The count-dependent sentences choose by a number
  (one day or several, one unit or several) so they go in `CHOOSING` with cases in `ui-catalog.test.ts`; placeholders are `{name}` only.
  The admin is English only.
- **Stores that are closed or suspended:** adjustments and locations need `products:write`, which a closed store's members do not have
  (`memberCan()`); orders in a closed store are not taken, so nothing draws stock.

### 2.9 Failure behaviour

- A save that conflicts, or one row that fails, never blocks the others; each row reports its own result. Nothing is half-written inside
  one row: a level and its movement are one statement's effect (the trigger runs in the same transaction).
- The movement trigger and the alert refresh **never make a payment fail** (3.3, 3.4): a context that cannot be read is recorded as
  `system`, the alert refresh runs in a sub-block that turns an error into a warning, and the ledger test (3.3) is what would reveal a gap.
- A model or an email provider being down changes nothing here (no AI is needed; the low-stock email is retried).
- A race between two checkouts for the last unit: both lock the same level rows in the same order; the second sees the first's
  reservation and either backorders (`continue`) or fails with `stock` (`deny`). A race between a sale and an adjustment is a conflict
  or a correct delta, never a lost update.
- A location that is deactivated while a checkout holds stock at it is refused (2.3); a hold that expires meanwhile is released as today.
- The cron's clean-up (`pruneInventoryMovements()`) never throws and is batched.

---

## 3. Data

All new tables are in the private `commerce` schema, have `store_id` on every row and every query of them carries it, enable RLS
with no policies and grant nothing to `anon` or `authenticated` (as the other tables; the advisors are checked in 9.3). Migrations
are additive; the one relaxing change (the non-negative check) is replaced by a stricter rule in the same file.

### 3.1 Columns added to existing tables

`commerce.product_variants`:
- `stock_policy text not null default 'deny'`, check `in ('deny', 'continue')`; check `stock_policy = 'deny' or delivery = 'physical'`.
- `backorder_days integer null`, check `between 1 and 90`; check `stock_policy = 'continue' or backorder_days is null`; check
  `stock_policy <> 'continue' or backorder_days is not null`. **Days are required with the setting**: a delivery-time statement is
  never left blank (4.1).
- `low_stock_threshold integer null`, check `between 0 and 1000000`; check `low_stock_threshold is null or delivery = 'physical'`.

`commerce.inventory_locations`:
- `priority integer not null default 0` (the rank key; existing rows get 0 and are ranked by `created_at`, which is the order every
  reader uses today, so nothing moves on migration).
- `deactivated_at timestamptz null` (set and cleared by the server, for the report).
- A unique index on `(store_id, lower(name))` where `active`.

`commerce.order_lines`:
- `backorder_quantity integer not null default 0`, check `between 0 and quantity`.
- `backorder_days integer null`, frozen at placement; check `backorder_quantity = 0 or backorder_days is not null`.
- Read-only after insert except by `draw_order_stock()` (it may rewrite `backorder_quantity` for the order being paid, once); copied
  orders' lines are already read-only by trigger.

`commerce.data_jobs`, `data_job_items`: the `kind` checks are widened to `inventory_import` and `inventory_export` (drop and add the
constraint, as `20261005162057_redirects.sql` did: safe while the old code runs because it uses none of the new values); one active
`inventory_import` per store (a partial unique index like the product import's).

`commerce.inventory_levels`: the check `inventory_levels_on_hand_non_negative` is **dropped** and replaced by the trigger in 3.3.

### 3.2 `commerce.inventory_movements`: the history, append-only

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity pk | |
| `store_id` | uuid not null | composite foreign keys below |
| `variant_id` | uuid not null | foreign key `(store_id, variant_id)` to `product_variants` |
| `location_id` | uuid not null | foreign key `(store_id, location_id)` to `inventory_locations` |
| `delta` | integer not null | check `delta <> 0` |
| `on_hand_after` | integer not null | the level's figure after the change |
| `reason` | text not null | check in `received, correction, count, damaged, lost, promotion, sale, order_restock, return_restock, opening, system` |
| `source` | text not null | check in `inventory_page, editor, bulk, file, order, return, checkout, ai_manager, copy, system` |
| `actor_account_id` | uuid null | the staff account, an id only (the name is read from `accounts` when shown); null for the system |
| `order_id` | uuid null | foreign key `(store_id, order_id)` to `orders`; set for `sale`, `order_restock`, `return_restock` |
| `return_id` | uuid null | foreign key `(store_id, return_id)` to `returns` |
| `job_id` | uuid null | an import job or a bulk batch (no foreign key: those rows expire sooner) |
| `note` | text null | at most 200 characters; typed by staff on manual changes only |
| `created_at` | timestamptz not null default now() | |

Indexes: `(store_id, variant_id, id desc)`, `(store_id, created_at desc)`, `(store_id, order_id) where order_id is not null`,
`(store_id, location_id)`, `(store_id, return_id) where return_id is not null` (every composite foreign key has one).

### 3.3 What the database itself enforces (PGlite tests in `src/db/inventory.test.ts`, 6.4)

1. **Every change of `inventory_levels.on_hand` is a movement.** An `AFTER INSERT OR UPDATE OF on_hand OR DELETE` row trigger,
   `commerce.record_inventory_movement()`, writes `delta` (for an insert, `NEW.on_hand`; for a delete, `-OLD.on_hand`) and `on_hand_after`;
   a zero delta writes nothing. So **for every (variant, location) the movements add up to `on_hand`**, whoever wrote the level (the app,
   a SQL function, a migration, a test). The migration backfills one `opening` movement per existing level with `on_hand <> 0`, so the
   invariant holds from the first minute. `commerce.inventory_ledger_check(p_store uuid)` returns the (variant, location) pairs where it
   does not, and `store_checkup` reports them (as it reports a broken order sequence). (As built, 3.13: after the 24-month clean-up the
   check compares the level with the level before the oldest movement kept plus what the kept ones add up to; the newest movement of a
   level is never removed.)
2. **The context** (why, by whom, for which order) comes from `commerce.stock_context(p_reason, p_source, p_account, p_order, p_return, p_job, p_note)`,
   which stores a JSON in a transaction-local setting (`set_config('kaizen.stock', …, true)`); the trigger reads it. With no context an
   insert is recorded `opening` / `system` and an update `correction` / `system`. A context that cannot be parsed is recorded as
   `system` and never raises. The TypeScript helper is `withStockContext(tx, context)` (`src/server/stock-context.ts`); a scan test
   (`stock-writers.scan.test.ts`) fails if a module under `src/` other than the foundation's helper writes `inventory_levels` without
   calling it, or reads `commerce.available_stock` outside the one reader of 3.5.
3. **Negative only where allowed.** A trigger refuses a level whose `on_hand < 0` unless the variant's `stock_policy = 'continue'`, **or**
   the write raises the figure (`NEW.on_hand >= OLD.on_hand`, so a refund or a receipt on a variant switched back to `deny` while it was
   negative is always allowed). A level for a non-physical variant is refused.
4. **The history is append-only**: `UPDATE` is refused; `DELETE` only for a row older than 24 months (so the daily clean-up can run;
   the guard function is `commerce.guard_inventory_movements()`, like `guard_audit_log()`).
5. **Copied orders** never get a movement (`refuse_copied_order()` trigger on `order_id`, as for `inventory_reservations`).
6. **Locations:** a trigger refuses an update that leaves a store with no active location (it locks the store row first, so two
   deactivations cannot both pass) and one that deactivates a location holding live reservations (reason code `location_held`).
7. **Backorder consistency:** the three `product_variants` checks and the `order_lines` checks of 3.1.

### 3.4 `commerce.stock_alerts`: one row per variant with a level set

`store_id`, `variant_id` (pk together; composite foreign key to `product_variants`), `state text not null` (`off`, `ok`, `low`),
`crossed_at timestamptz null`, `notified_at timestamptz null`, `stock_at_crossing integer null`, `updated_at`.
`commerce.refresh_stock_alert(p_store, p_variant)` (called by the level trigger, by an update of a variant's threshold and by an update
of a location's `active`, always inside a sub-block that turns an error into a warning) computes the sum of `on_hand` over active
locations and moves the state: no threshold gives `off`; above gives `ok`; at or below gives `low`. `ok` to `low` sets `crossed_at = now()`
and clears `notified_at`; `off` to `low` (a level set on a low variant) sets `crossed_at` and `notified_at = now()` (already told);
`low` to `ok` clears `crossed_at`. The five-minute job reads the `low` rows with `notified_at is null`. Deleting rows is never needed
(a cleared threshold is state `off`).

### 3.5 Functions and the one stock reader

- `commerce.draw_order_stock(p_order_id uuid) returns integer` (units short for `deny`): the draw `complete_order_payment()` does today,
  moved into a function and extended. For each physical variant of the order (`order by variant_id`), levels locked in
  `(variant_id, location_id)` order, set the stock context (`sale`, `order`, the order id): (1) from the locations where the order's own
  reservations are, in rank order, taking its physical claim and, for a `deny` variant, no more than `greatest(on_hand, 0)`;
  (2) then from any active location with positive stock that no other live checkout holds, in rank order (a hold that expired, a
  renewal); (3) for a `continue` variant any remainder is drawn at the location 2.5 step 4 names, taking `on_hand` below zero; for a
  `deny` variant the remainder is short (the existing `stock.short` event). **Backordered units** of a draw are the units drawn
  beyond the order's claim (the backordered part of its holds, and the remainder of step 3); they are summed per variant and
  written to the order's lines of that variant (paid lines first, in `id` order) as `backorder_quantity`. **A checkout's claim is
  kept whatever the order of payment** (3.13; this replaces the first draft's "whoever pays first gets the stock", which let a
  later checkout take the stock an earlier one had been told was in stock), and an `order_events` row `stock.backordered`
  (`{ lines: [{ sku, quantity }] }`) is written when the total is above zero. The patch of `complete_order_payment()` replaces the old
  loop with a call to this function and is made on the **live definition** with `pg_get_functiondef` + `replace`, as
  `20261004125337_order_invoices_rules.sql` patched the same function, and raises if its anchors are not found.
- `commerce.variant_availability` (view, `security_invoker`): per variant `store_id`, `variant_id`, `in_stock` (the sum over active
  locations of `greatest(available, 0)`: each location's free units at no less than zero, as `allocate()` counts them, so a location
  that owes units takes none from one that holds stock), `raw_available` (the signed sum, can be negative), `stock_policy`, `backorder_days`, `can_buy` (`in_stock > 0 or stock_policy = 'continue'`).
  It is **the one reader of stock**: `cart.ts`, `catalog.ts` (a new `getVariantStock()` replaces `getAvailability()`; its callers are
  migrated, so a leftover caller is a compile error), `product-conditions.ts`, `campaigns.ts`, `wishlist-admin.ts`, `standing-orders.ts`,
  the chat agent and the WordPress routes read it, not `available_stock`. `commerce.available_stock` stays for the view and the
  inventory page's per-location figures. A unit test (`inventory-readers.test.ts`) scans `src` for other readers.
- `commerce.inventory_ledger_check(p_store uuid)`: 3.3.1.

### 3.6 Retention

`inventory_movements`: 24 months (the length of the audit log, D158; no law is claimed for it, 4.5), removed by `pruneInventoryMovements()`
in `runRetention()` (application code, batched; the SQL guard permits it), **except the newest movement of each (variant, location)**,
which stays however old: it is the baseline `inventory_ledger_check()` starts from once the older ones are gone (one small row per level,
no personal data; the guard refuses to remove it too). A movement holds no personal data (an account id, an order
id, a short note about stock), so an erasure or an anonymised order changes nothing in it. `stock_alerts` is one small row per variant, kept with
the variant. Import jobs and their files follow D165.

### 3.7 What is private, what is copied

- Everything here is staff-side. The shopper sees only the backorder sentence and the structured-data availability.
- `PERSONAL_DATA` / `NOT_PERSONAL` (`src/lib/personal-data.ts`): `inventory_movements` and `stock_alerts` go in **`NOT_PERSONAL`** with the reason
  "stock counts and the staff account that changed them; the note is staff text about stock"; `src/db/privacy.test.ts` forces the decision for the free-text
  `note` column. A new email kind `stock.low` is in `EMAIL_KINDS` (staff).
- **`COPY_RULES`** (`src/lib/store-copy-rules.ts`): `inventory_movements: never("The history of the original's stock; a copy starts with its own opening movements.")`,
  `stock_alerts: never("Recomputed from the copied levels and thresholds.")`. `inventory_locations` (settings) and `inventory_levels`
  (catalogue) stay as they are; `product_variants` (catalogue) now also carries the three new columns.
- **`clone_store()`** (new store from the template) and **`duplicate_store()`**: patched (on the live definitions, by `pg_get_functiondef` + `replace`,
  raising when an anchor is missing, as wave 1d patched them) so the variant inserts copy `stock_policy`, `backorder_days`, `low_stock_threshold` and the
  location inserts copy `priority`. The level inserts need no context (the trigger records them `opening` / `system`). `copy_orders()` needs no patch (the
  new `order_lines` columns default to 0 and a copied order backorders nothing). `deactivated_at` is not copied.
- Demo products (`add_demo_*`) and `supabase/seed.sql` keep working unchanged; the seed gets one demo variant with `continue` and 7 days so the e2e has a
  fixture.

### 3.8 Migrations expected (section 9.1)

Three files: `inventory` (generated: columns, the two tables, indexes, widened job checks, the dropped check), `inventory_rules` (custom: functions,
triggers, the view, backfill, the patched `complete_order_payment()`, `clone_store()` and `duplicate_store()`, RLS), `inventory_plan_features`
(an `INSERT ... WHERE NOT EXISTS` like `20261005171916_redirects_plan_features.sql`: "Inventory by location, adjustment history, backorders and
low-stock notices").

### 3.9 As built by the foundation (deviations and additions to 3.1 to 3.8; the spec above is changed by this paragraph)

The migrations are `20261006081000_inventory.sql` (generated), `20261006081019_inventory_rules.sql` (custom); the plan-features file is the analytics area's. Where the foundation differs from or adds to the text above:

- `data_job_items.kind` gains `stock` (one row of a stock file); the item kinds are `product`, `redirect`, `stock`, `file`. The finding codes of a stock file are in `FINDINGS` (`src/lib/data-job.ts`, prefix `stockfile.`, plus `file.not_inventory`), each with its line in `FIX_FOR` (`data-job-help.ts`), and listed in `INVENTORY_FINDING_CODES` (`src/lib/inventory-csv.ts`). `inventory.continue_selling_ignored` (the product import's warning) now says the setting is made per variant, with its delivery time. `JOB_KEY`: `inventory_import` is `products:write`, `inventory_export` is `products:read`.
- The two checks "days only with continue" and "continue needs days" are one check, `product_variants_backorder_days_policy` (`(stock_policy = 'continue') = (backorder_days is not null)`). `inventory_locations` also has `priority >= 0` and `length(name) between 1 and 60` checks. `order_lines.backorder_days` is `between 1 and 90`.
- `commerce.stock_context_clear()` exists (the TypeScript helper clears after its block), and the context also carries the helper `commerce.stock_context_uuid()`. A context that names an order or return that is not the store's is recorded without it (`system`), never raised.
- `commerce.variant_availability` has one more column, `delivery` (a download or a service has no stock row: `in_stock` 0 and `can_buy` false, so its reader asks `delivery` first, as readers always did).
- The level trigger refuses **a new level for a variant that is not goods** (`stock.not_goods`, on insert only: a level made while the variant was goods stays when it becomes a download, and may be changed, because stores and tests do exactly that; nothing reads it). So `clone_store()` and `duplicate_store()` copy levels of goods only, copy a **negative level as 0** (what is owed on orders that are not copied is not copied), and write their level inserts with the context `opening` / `copy`. The existing D129 test no longer gives a download a level; the movements of a copy are its own openings (the test of "nothing is copied by a `never` table" counts them as made by the level inserts).
- The deactivation trigger sets and clears `deactivated_at` itself (the server need not). `stock_alerts` has `ON DELETE CASCADE` to its variant. The two order-line columns' freeze is a trigger (`order_lines_backorder_frozen`): the units change only inside `draw_order_stock()` (marked by the transaction-local setting `kaizen.drawing`), the stated days never.
- The rules file starts with `LOCK TABLE commerce.inventory_levels IN SHARE ROW EXCLUSIVE MODE` and writes the opening movements as `on_hand - what the movements already sum to`, so a sale made by old code while the file runs cannot be counted twice. Because the generated file drops `inventory_levels_on_hand_non_negative` and the rules file adds the stricter trigger, the two files are applied one after the other by CI; old code never writes a negative figure in between.
- `stock.backordered` is written by `draw_order_stock()` itself, so it comes before `order.paid` in the order's events.
- `supabase/seed.sql` has a 4b demo product, `demo-termokopp` (SKU `DEMO-THERMOS`): stock 0, `continue`, 7 days, for the storefront e2e.

### 3.10 As built by the server area (deviations and additions; this paragraph changes the text above)

- **`getAvailability()` is kept** in `catalog.ts` as a number-only wrapper over `variantStockOf()` for two shopper surfaces that wait for their own migration (`product-parts.tsx`, the wishlist section); `inventory-readers.test.ts` lists them and fails for any other caller or for any read of `commerce.available_stock`. `SellableQuantity.available` is the cart's cap (the stock for `deny`, `MAX_LINE_QUANTITY` for `continue`); `inStock` is the real stock.
- **`stock-writers.scan.test.ts`** lists `checkout.ts` as the one app module that writes a level without a context: it adds a level of 0 for a `continue` variant that has none (a change of 0 is no movement), so a row exists to lock; the sale itself is written by `draw_order_stock()`.
- **Interface text and the confirmation email sentence** (`m.backorder.*`, `emailText().backorder`, the `CHOOSING` entries) were written by the server area, not the shopper area, because `placeOrder()`, the order view and the email need them; the shopper area uses them.
- **The WordPress routes** (`wordpress-shop.ts`) serve a backorder variant on the product page as `out` with a `backorder_days` figure (null for the rest, so a plugin before 1.2 shows it sold out), and a quote line carries `backorder: { units, days } | null`, all read from the same `variantStockOf()`; a quote and a handoff cart accept it up to the cart cap (`sellableQuantity()`).
- **`ledgerProblems(storeId)`** (`inventory.ts`) reads `inventory_ledger_check()`; the AI manager's `store_checkup` tool lists what it finds. A level that moved with no movement is a problem reported there, never repaired by code.
- **The product editor, the bulk stock action and the product import** write a level only for a store with exactly one active location (a correction, or an opening for a new variant); with several they write none and the import warns (`inventory.multi_location_stock_ignored`). The editor leaves a **negative** level untouched unless a different number is typed (a stale form cannot erase what is owed). The bulk grid's stock column refuses a store with several active locations with a plain sentence (`bulk-edit.ts`); the list's bulk stock action goes through the same check.
- **Owed units** (`InventoryRow.owed`, the count above the list) are the sum of `backorder_quantity` of **paid, not yet sent** orders' lines; a sent order no longer owes.
- **The stock file's export** writes the figure as it is (a negative level is exported as a negative number, so an owed backorder is visible) and has no `on_hand_was` column of its own beyond the one the page's own export writes; a file edited from an older export conflicts when the stored figure moved.
- **Reads on the Inventory page and its counts run through `setBased()`** (nested loops off, read only): without it a store of 5 000 variants with no planner statistics took 3 to 18 seconds for the first page and a search (found by `inventory-perf.int.test.ts`); with it 30 to 90 ms.
- **Product files** carry `stock_policy`, `backorder_days` and `low_stock_threshold` (`docs/wave-2-data.md` 4.1.2); findings `stock_policy.invalid`, `stock_policy.not_goods`, `backorder_days.invalid`, `backorder_days.required`, `low_stock_threshold.invalid` and `inventory.multi_location_stock_ignored` are in `FINDINGS` with their `FIX_FOR` lines.
- **Retention**: `pruneInventoryMovements()` is a step of `runRetention()` (24 months, in batches, never throws).
- **Store copy**: `store-copy.int.test.ts` holds that rank, policy, backorder days and warning level are copied, the copy's movements are its own openings (never the original's), its warning states are worked out again (`ok`), and a copied order reserves, backorders and writes no movement.

### 3.11 As built by the shopper area (deviations and additions; this paragraph changes the text above)

- **The product page** reads `getVariantStock()` (per request, inside the existing `<Suspense>`, never cached) and words it with `stockNote()` / `canOffer()` (`src/lib/stock-words.ts`): in stock, only n left, **on backorder with the days**, or sold out. A `continue` variant whose days are missing (the database makes that impossible) is *not* offered rather than sold without a delivery time. The phone's bar and the wishlist use the same `canOffer()`. `getAvailability()` has no caller left (`inventory-readers.test.ts` no longer allowlists the two surfaces); the wrapper and its allowlist entry in `catalog.ts` and that test can be deleted.
- **Structured data**: `productJsonLd()` takes `availability: (variantId) => 'in_stock' | 'backorder' | 'out_of_stock'` instead of `inStock`; `BackOrder` for a variant that keeps selling with nothing in stock.
- **Cart, slide-out cart and checkout** draw `<BackorderLine>` (`src/components/backorder-note.tsx`, `m.backorder.line()`, not an alert); the **order page and My account** draw `<BackorderOrderLine>` (`m.backorder.order()`). The confirmation email's sentence was written by the server area (`shopper-emails.ts`, from `m.backorder.order()` of the order's language); `backorder-email.int.test.ts` holds it.
- **One addition not in the spec: `m.backorder.capped(max)`** (nb, sv, da, en), said by the product page's add button and the phone's bar when a cart line of a `continue` variant is at the line maximum. The old sentence (`m.capped`, "your cart now holds all the stock we have") would be untrue for it, since the stock is no limit. The wishlist's own capped sentence was not changed (it still says "as many as are in stock"); it can only be reached for a `continue` variant at 20 in the cart.
- **Not done:** product cards in listings show no stock today, so they say nothing of backorder; the chat agent's cards are the server area's (`stockFacts()`).
- **e2e** `e2e/backorder.spec.ts` runs against the seeded demo store (`demo-termokopp`, `demo-bordlampe`).

### 3.12 As built by the admin area (deviations and additions; this paragraph changes the text above)

- **Pages** (all under `/admin/{store}/inventory`, each with `loading.tsx`, `products:read` to open, the actions `products:write`): the list, `history`, `locations`, `import`, `import/[jobId]` (with `tick` and `problems` routes) and `export` (with `file` and `[jobId]/tick` routes). `ADMIN_PAGES` has `inventory`, `inventory.history`, `inventory.locations`, `inventory.import`, `inventory.import.job` and **`inventory.export`** (not listed in 5.6, because 2.4 names the page). The Products section's sidebar has one item, *Inventory*; the other four are tabs of `InventoryHead`. `permissions.scan.test.ts` lists the two read-only export routes (`READ_ONLY_ROUTES`) and the locations actions file (`OWNER_ONLY_EXTRA`: it holds the owner-only deactivate and reactivate beside the `products:write` add, rename and move).
- **The list** (`InventoryTable`, a client component, `src/lib/inventory-admin.ts` for everything it decides): a person types *Set to* or *Adjust by* in a cell; *Review changes* lists each row before and after with the same `resultOf()` the server uses; *Save changes* sends one reason and one note. A figure is always one location's: with one active location (or a list filtered to a location) the row has the boxes, with several each row's *Locations* disclosure has one pair of boxes per location, and the summed figure is read-only. After a save the typed figures are cleared, the page refreshes, and a conflicting row is listed with the stored figure (the server's sentence). Selected rows can be set to keep selling (days required), to stop, or given a low-stock level (`setVariantPolicies()`).
- **Deactivating a location**: the page reads `locationImpact()` for each active location when it is drawn (owners only), the dialog shows the four figures and the confirm button *sends the unit figure it showed* rather than asking the owner to type it; if the server's figure has changed it answers with the new impact, the dialog shows it and asks again. Refused in the dialog (button disabled) for the last active location and while checkouts hold stock there.
- **Stock files**: `ExportPage` in `data-routes.ts` gained `"inventory"` (one line each in the type, the import and the `request` table; `requestInventoryExport()` was already there). **The export has no `on_hand_was` column** (the server area's decision, 3.10), so a file edited from an export has no conflict check unless the person copies `on_hand` into a new `on_hand_was` column first; the export page and the import page say so. That is a gap against 2.4, where the file is "the figure the file was made from": the cleaner fix is a server change that writes `on_hand_was` in the export. The import has no options (unlike the product import), so its page is `StockCheck` (one button) instead of an options form.
- **Orders**: `listOrders()` gained `waiting` (paid, not sent, a line with `backorder_quantity > 0`) and every row an `owed` figure (a small edit in `src/server/orders.ts`; the spec said the admin area edits no server file, but the chip needs the filter). The orders list has the *Waiting for stock* chip and shows owed units on a row; the order page has a *Waiting for stock* notice, a *Backordered: n of qty, to ship within d days* line, *Taken from Oslo 2, Bergen 1* (the order's own `sale` movements through `orderStockHistory()`), the event `stock.backordered`, and the location in the *back in stock* history line. The refund dialog's *Put back at* select (only with more than one active location) is the form field `restockAt:{lineId}`; empty means where the units were taken from, and the line says in words what that will be (`putBackWords()`, a sentence, never a promise: `restockPlan()` decides). The refund action passes `locationId` to `refundOrder()`, which refuses a place that is not an active location of the store.
- **The product editor**: each shipped variant has a *Stock rules* section (own `<details>`: *Keep selling when sold out*, *Expected to ship within (days)* required with it, the 30-day hint `BACKORDER_LONG_HINT` above 30, *Warn me when stock is at or below*) and, with two or more such variants, a product-wide switch (*Keep selling every variant when sold out* with one number of days) that sets the variants together; the data stays per variant. With several active locations the stock cell is the total, read-only, with *By location* to `/inventory?q={sku}`. A variant that stops being goods that are shipped loses its policy and level in the editor.
- **Not done by this area:** the store Home and control-center attention (5.5 gives them to the analytics-and-AI area), `store-translate.ts` (no new translatable store text), a return's own "put back at" choice (a return restocks as 2.6 says), and any e2e of a signed-in page (there is no admin fixture, D158): the screens are held by `renderToString` tests of `inventory-views.test.ts` and `product-editor-stock.test.ts`, the pure rules by `inventory-admin.test.ts`, and the order pages' reads by `inventory-admin.int.test.ts`. The click path is the by-hand check of 9.7 item 1.

### 3.13 As built by the review fixes (deviations and additions; this paragraph changes the text above)

Seven findings of the reviewers were fixed at their causes. The migrations are `20261006121245_inventory_reservation_backorder.sql` (generated: one
column) and `20261006121317_inventory_draw_claims.sql` (custom: `CREATE OR REPLACE` of `draw_order_stock()`), which sort after the column so old code
running while the files are applied never meets a function that names a column that is not there yet; the view, the ledger check and the movement
guard were changed in `20261006081019_inventory_rules.sql` itself (none of the files is applied anywhere yet).

- **A checkout's claim survives a later checkout paying first.** `inventory_reservations.backorder_quantity` (0 to `quantity`; default 0, so every
  other writer and old code holds nothing beyond stock) is the part of a hold beyond the stock that was there when the checkout started, written by
  `placeOrder()` from `allocate()`'s `backordered`. `draw_order_stock()` gives an order, at each location it holds, its physical part
  (`quantity - backorder_quantity`) whatever the order of payment, plus any of its backordered part that the stock now covers once the other live
  checkouts' claims are counted (an earlier checkout in full, a later one by its physical part: first come, first served; so the line's
  figure only goes DOWN for a live hold: a checkout ahead that let go frees the stock for the one behind it); the rest of the hold is drawn below the
  shelf and written as the line's backorder. An order with no live hold (it expired, or a renewal) takes only what no other live checkout holds, and
  is backordered (`continue`) or short (`deny`) for the rest. So the sentence a shopper read before paying (in stock, or "n on backorder") is what the
  order says after. Not rechecked at payment: a person who lowers a level below the live holds (a "damaged" count during open checkouts) makes the
  holders' orders go negative without a backorder note; the Inventory page shows that as negative available. A variant switched from `continue` to
  `deny` while a checkout holds a backordered part draws only what is on hand and records the rest as `stock.short`.
- **`in_stock` floors each location** (the view: `sum(greatest(available, 0))`), so the page, the cart and `placeOrder()` agree when one location owes units
  and another holds stock; `raw_available` stays the signed sum.
- **A cancellation, a refund's default and a return restock what the order took.** `OrderLineAdmin.restockable` is `min(quantity - restocked, what the order's
  sale movements took and nothing has put back)`, shared over a variant's lines in order (`restockRoom()`, `src/lib/stock-restock.ts`); `cancelOrder()`,
  `refundReturn()` and the refund dialog use it, and a hand-typed quantity above it is still refused. An order that took less than it was for (a hold
  that expired and the stock was sold meanwhile, `stock.short`) can therefore still be cancelled and refunded in full money.
- **The 24-month clean-up keeps the ledger check true.** `pruneInventoryMovements()` leaves the newest movement of each (variant, location) and the guard
  refuses to remove it; `inventory_ledger_check()` compares the level with `on_hand_after - delta` of the oldest movement kept plus the sum of the kept ones
  (0 plus the sum while the opening movement is there), so a pruned history still adds up and a level written without a movement is still a gap.
- **The backorder sentences are never machine-translated.** `ui:backorder.` and `email:backorder.` are in `HAND_WRITTEN_ONLY` (`src/lib/ui-catalog.ts`): left out of
  `catalogOf()` and never replaced by an overlay, so a store language other than nb, sv, da and en shows the English sentence (`ui-catalog.test.ts`). The
  three `CHOOSING` templates of them were removed.
- **The editor's reminder follows the 30 days to delivery.** `backorderMayPassAgreed(days)` (`src/lib/inventory.ts`): the reminder appears when days to ship plus
  `BACKORDER_TRANSIT_DAYS` (7, a stated assumption for the lawyer) pass 30, from 24 days; its words say the 30 days run until the goods are delivered.

---

## 4. Rules and law

### 4.1 Selling on backorder: what must be said before the purchase

- **Delivery time (EU).** Directive 2011/83/EU (Consumer Rights) Art. 6(1)(g) requires, before a distance contract, information on "the
  arrangements for payment, delivery, performance, the time by which the trader undertakes to deliver the goods or to perform the services"
  (text read at https://www.legislation.gov.uk/eudr/2011/83/article/6, the Directive as adopted). Art. 18 says that, unless the parties have
  agreed another delivery time, the trader delivers "without undue delay, but not later than 30 days from the conclusion of the contract", and
  that if the trader fails to, the consumer may call on him to deliver within an additional appropriate period and, failing that, terminate
  (https://www.legislation.gov.uk/eudr/2011/83/article/18). **So a backorder always states a number of days** (`backorder_days`, 1 to 90, required,
  shown on the page, the cart, the order page and the confirmation email, and frozen on the order line). Days above 30 are an agreed
  delivery time: the editor and the file say so ("above 30 days, the customer agrees to it by ordering; say it clearly"), and nothing is
  hidden. The wording is "expected to ship within {days} days", never a guarantee and never "in stock". **That wording is a forecast of dispatch, not the "time by which the trader undertakes to deliver" that Art. 6(1)(g) names, and the 30 days of Art. 18 run to delivery: whether it is enough is the first open question in section 8 (item 6), and the editor's reminder compares the days with 30 less the usual transport (3.13).**
- **Norway.** `angrerettloven § 8` (the information duty before a distance contract) lists arrangements for delivery and the delivery deadline
  (read at https://lovdata.no/dokument/NL/lov/2014-06-20-27: § 8 first paragraph letter g); `forbrukerkjøpsloven § 6`: "Tingen skal leveres uten unødig
  opphold og senest innen 30 dager etter kjøpet" unless otherwise agreed, with the buyer's remedies for delay in § 19 to § 24 and a reasonable additional
  period before cancelling in § 23 (read at https://lovdata.no/dokument/NL/lov/2002-06-21-34).
- **Misleading offers.** Directive 2005/29/EC (Unfair Commercial Practices) Annex I point 5 (bait advertising) blacklists inviting to purchase
  "without disclosing the existence of any reasonable grounds the trader may have for believing that he will not be able to offer for supply … those
  products … in quantities that are, reasonable" (https://www.legislation.gov.uk/eudr/2005/29/annex/I). Selling past stock is allowed, **disclosing it
  is the rule**: the product page says so before the cart, not only at checkout. The owner chooses the setting; the platform never turns it on itself.
- **Not read, for the lawyer:** the Nordic marketing acts that implement the Directive, any Norwegian rule on stock records or stock counting for the
  accounts, and how a consumer's right of withdrawal interacts with an order delivered in parts. The texts in section 8 are flagged.

### 4.2 Quantities and limits (integers only, no rounding anywhere)

| Thing | Rule |
|---|---|
| On hand written by a person | whole number, 0 to 1,000,000 ("Set to"); "Adjust by" a whole number from -1,000,000 to 1,000,000 whose result is 0 to 1,000,000 |
| On hand written by a sale | any whole number, below zero only for `continue` variants |
| Line quantity | 1 to `MAX_LINE_QUANTITY` (20), also on backorder |
| `backorder_days` | 1 to 90, required with `continue` |
| `low_stock_threshold` | 0 to 1,000,000 or empty |
| Locations per store | 1 to 20 active or not; at least one active |
| Note | at most 200 characters |
| Adjust rows in one save | at most 500 |
| Rows in an inventory file | at most 20,000 |

### 4.3 The routing rule and the restock rule

Exactly as 2.5 and 2.6; the rank is `priority`, `created_at`, `id`. `allocate()` and `restockPlan()` are pure, deterministic and
property-tested: the allocated units of a variant add up to the wanted units (backorder included); no location is asked for more than
its free units except by the backordered remainder; a `deny` variant with too little free stock yields a refusal and no allocation; whole-order
preference holds whenever one location suffices; the output does not depend on the input order of locations that have equal rank keys beyond
the stated tie-break. `restockPlan()` never returns more than what the order took at a location minus what already went back there, and the
sum of a plan is the quantity asked.

### 4.4 The crossing rule

The state machine of 2.7 and 3.4; `src/lib/stock-alerts.ts` holds the same transition table as a pure function (`nextAlertState()`) and a test runs
every transition against the database, as `return-status.ts` is held to its SQL.

### 4.5 Who may do what

| Action | Who |
|---|---|
| See inventory, history, locations | `products:read` |
| Adjust, import a file, change policy or threshold, add, rename, move a location | `products:write` |
| Deactivate or reactivate a location | owner only (`requireOwnerRole`) |
| Receive the low-stock email | the store's owners |
| AI manager: read stock and history | `products:read` (`TOOL_PERMISSIONS`) |
| AI manager: set stock, set backorder | `products:write`, gated (kept for the owner's yes) |

Every page and action checks for itself (`requirePermission` with the store slug as the bound first argument). No numeric law is claimed for
the 24-month retention; it is Kaizen's choice (the audit log's length) and the lead may change it.

---

## 5. Where things live

Areas do not share files except through the registries listed in 5.6.

### 5.1 Foundation (schema, migrations, pure libraries, shared types)

- `src/db/schema.ts`: the columns of 3.1, tables `inventoryMovements` and `stockAlerts`.
- `supabase/migrations/…_inventory.sql` (generated), `…_inventory_rules.sql` (custom), `…_inventory_plan_features.sql` (the plan comparison row; the analytics-and-ai
  area may write this one file).
- `src/lib/inventory.ts`: `ADJUST_REASONS`, `MOVEMENT_REASONS`, `MOVEMENT_SOURCES`, label functions, zod `adjustInput`, limits of 4.2.
- `src/lib/stock-routing.ts` (`allocate()`), `src/lib/stock-restock.ts` (`restockPlan()`), `src/lib/stock-alerts.ts` (`nextAlertState()`),
  `src/lib/stock-availability.ts` (`VariantStock` type, `settleWithBackorder()`, `backorderOf()`), `src/lib/inventory-csv.ts` (columns, `parseInventoryRow()`,
  finding codes), `src/lib/data-job.ts` (the two new kinds in `JOB_KINDS`, `IMPORT_KINDS`, `EXPORT_KINDS`).
- `src/lib/personal-data.ts` (`NOT_PERSONAL` entries, `EMAIL_KINDS` `stock.low`), `src/lib/store-copy-rules.ts` (`COPY_RULES`), `src/lib/permission-guards.ts` if a name is needed.
- Tests: 6.3 and 6.4.

### 5.2 Server (`src/server`, routes, cron)

- `src/server/stock-context.ts` (`withStockContext()`), `src/server/inventory.ts` (`inventoryPage()`, `adjustStock()`, `stockHistory()`, `locationImpact()`),
  `src/server/inventory-locations.ts` (`listLocations()`, `saveLocation()`, `moveLocation()`, `deactivateLocation()`, `reactivateLocation()`),
  `src/server/stock-alerts.ts` (`sendLowStockNotices()`, `pruneInventoryMovements()`), `src/server/inventory-jobs.ts` (the two job kinds on `data-jobs.ts`).
- Changes to existing modules: `cart.ts` (`sellableQuantity()`, the cart read, via `variant_availability`), `checkout.ts` (`placeOrder()`: lock order, `allocate()`,
  reservations beyond stock for `continue`, `backorder_*` on the lines), `catalog.ts` (`getVariantStock()`), `order-admin.ts` (`putBack()` replaced by `restockPlan()`,
  `locationId` on a restock item, `cancelOrder()`), `returns.ts` (the restock carries the return id), `products.ts` (`stockLocation()` becomes `defaultLocation()` by rank; `saveVariants()` writes
  the three new columns and sets the stock context; the single-location rule of 5.3), `standing-orders.ts` and `campaigns.ts` (read the one view), `product-import*.ts`
  and `product-export*.ts` (the three columns; `stock` is the total of active locations and is ignored on import with a warning when the store has several active locations),
  `retention.ts`, `store-copy.ts` (the locations count), `order-numbers.ts`/`store_checkup` (the ledger check).
- Routes: `/api/cron/cart-reminders/route.ts` calls `sendLowStockNotices()` (never throws, per store, only open stores); `runRetention()` calls `pruneInventoryMovements()`.
- The product editor's rule (the page is the admin area's, the rule is the server's): with exactly **one active location** the editor's stock number is that
  location's `on_hand` (written with context `correction` / `editor`); with **several** the editor shows the total, read-only, with a link to the Inventory page, and
  `saveVariants()` writes no level (a stale number in a saved form cannot overwrite a location). A new variant's first number is an `opening` movement at the default location.

### 5.3 Shopper

- `src/lib/i18n.ts` (`m.backorder.page|line|order`, the changed in-stock filter label, in nb, sv, da, en; `CHOOSING` and `ui-catalog.test.ts` cases), `src/lib/email-text.ts` (the confirmation sentence).
- `src/components/product-parts.tsx` (variant picker and buy part), `src/components/cart/*` and `cart-contents.tsx`, `checkout-section.tsx`, `order-section.tsx`
  (the line notes), `src/lib/structured-data.ts` (`BackOrder`), the cart line type in `src/lib/cart-types` or where `CartLine` lives (`backorder`).
- WordPress: `src/server/wordpress-shop.ts` serves `stock.level` unchanged and adds `backorderDays` for a backordered variant. **Minimum for this run:** the API
  serves a backorder variant at zero as level `out` (older plugin versions then show it sold out, which is safe); an updated plugin (1.2: `cart.js`,
  `class-kaizen-store-product.php`, rebuilt with `node scripts/build-wordpress-plugin.mjs`, both committed) shows the days and lets it be added. If the plugin
  change is not made, the API still must not serve such a variant as `in_stock`.
- e2e `e2e/backorder.spec.ts`.

### 5.4 Admin

- Pages: `src/app/admin/(gated)/[store]/inventory/page.tsx`, `…/inventory/history/page.tsx`, `…/inventory/locations/page.tsx`, `…/inventory/import/page.tsx`
  (and `import/[jobId]`), each with `loading.tsx`; actions beside them (`actions.ts`, thin, the slug bound first, `updateTag()` for the catalogue tags, audit entries
  `products.inventory_adjusted` (one per save: count of rows and the reason, never a SKU list), `products.inventory_imported`, `products.location_saved`,
  `products.location_deactivated`, `products.location_reactivated`, `products.stock_policy_changed` (the `products.` prefix is already in `AUDIT_AREAS`, so no change to
  `audit_area_of()` is needed)).
- Components in `src/components/admin/inventory/` (table, review list, history table, locations list, deactivate dialog) with `renderToString` tests; the refund dialog
  (`order-actions.tsx`) gets the "Put back at" select; the order page and list get the backorder badge and the *Waiting for stock* chip; the product editor
  (`product-editor.tsx` and `productInput` in `src/lib/product-input.ts`, which the foundation widens with `stockPolicy`, `backorderDays`, `lowStockThreshold`).
- Admin tokens only, never `max-w-*xl` on a page root.

### 5.5 Analytics and AI

- `docs/analytics.md` first: the inventory definitions gain "a negative on hand counts as 0 in value and in days of stock and is shown as owed", "the store's own low-stock level
  is the variant's `low_stock_threshold`", "a variant on backorder is `out` and says how many are owed". Then `src/lib/analytics-inventory.ts` (a `backorder`/`owed` figure, the
  threshold passed through), `src/server/analytics-inventory-data.ts` (read `stock_policy`, `low_stock_threshold`, owed units from open orders' `backorder_quantity`),
  `src/components/admin/analytics/inventory-view.tsx`.
- `src/server/control-center.ts` and store Home attention: "variants at or below their level" from `stock_alerts`, "units owed".
- AI manager: `src/lib/owner-tools.ts` and `src/server/owner-tools.ts`: `stock_levels` (read: by SKU or handle, per location, committed, available, policy, level), `stock_history`
  (read: last movements of a SKU), `set_stock` widened (`location` by name, `reason`, `note`; still gated `public`; ambiguous location refuses), `set_backorder` (SKU, `continue`/`deny`,
  days; gated `public`); each with a line in `TOOL_WORDS` (`src/lib/manager-tools.ts`), `TOOL_PERMISSIONS` (`src/lib/owner-tool-permissions.ts`), an entry in
  `owner-tool-permissions.test.ts`, the skill text in `src/lib/assistant-skills.ts` (the restocking skill), `restock_suggestions` counts owed units. Amounts and figures come from
  the tools, sums in code. Served to Kaizen Life through the store's MCP (owner tools are).
- The plan comparison row (D132) in `…_inventory_plan_features.sql`.

### 5.6 The registries, once more, and who edits each

| Registry | Edited by | What |
|---|---|---|
| `src/db/schema.ts`, `supabase/migrations/*` | foundation | 3.1, 3.2, 3.4 |
| `src/lib/store-copy-rules.ts`, `src/lib/personal-data.ts` | foundation | 3.7 |
| `src/lib/data-job.ts` | foundation | two job kinds |
| `src/lib/i18n.ts`, `src/lib/email-text.ts`, `ui-catalog.test.ts` | shopper | backorder words; the confirmation sentence |
| `src/lib/store-nav.ts`, `src/lib/admin-map.ts` (`ADMIN_PAGES`), `src/lib/audit.ts` (none needed) | admin | Products section items: `/inventory` ("Inventory"), reached from it: history, locations, import; ADMIN_PAGES keys `inventory`, `inventory.history`, `inventory.locations`, `inventory.import`, `inventory.import.job` (a `group` of "Main", keywords stock, locations, backorder, count, low stock) |
| `src/lib/owner-tools.ts`, `owner-tool-permissions.ts`, `assistant-skills.ts`, `manager-tools.ts` | analytics-and-ai | tools |
| `plan_features` | analytics-and-ai | its migration file |
| `KNOWN_COOKIES` | nobody | no cookie |
| `store-translate.ts` worklist | nobody | no new translatable store text |
| sitemap, `llms.txt` | nobody | no new public page |
| structured data | shopper | `BackOrder` |

The server area edits `cart.ts`, `checkout.ts`, `order-admin.ts`, `products.ts`, `catalog.ts`, `standing-orders.ts`, `campaigns.ts`; the shopper area edits no file under `src/server`
and the admin area none either (each asks the server area's functions). `checkout-kinds.int.test.ts` is the server area's; a scenario another area needs is requested in its report.

---

## 6. Acceptance criteria, row by row, mapped to tests

Layers: **unit** (`pnpm test`), **PGlite** (`src/db/inventory.test.ts`), **int** (`pnpm test:int`, real database), **view** (`renderToString`), **e2e** (storefront only: there is no signed-in admin fixture).

### 6.1 `catalogue.inventory-tracking-with-reservations`

| # | Criterion (row text kept) | Held by |
|---|---|---|
| A1 | An inventory page lists variants per location with on hand, committed (reserved) and available, and staff adjust a level with a reason (received, damaged, correction, recount). | int `inventory.int.test.ts` (`inventoryPage()` figures for several variants and locations with live reservations: committed is exactly the live holds, available the difference; `adjustStock()` writes the level and one movement with the reason; refuses out-of-range figures; conflict row not written); view `inventory-views.test.ts` (the table, review list, filters, empty store); `inventory-perf.int.test.ts` (A1 page under the bound). The screen's click path is by hand (9.7). |
| A2 | Every change to a level, from an adjustment, sale, cancellation, refund or return, is an append-only history row with who, when, reason and the order. | PGlite: the ledger trigger (insert, update, delete, zero delta writes nothing), sums equal `on_hand`, update refused, delete refused under 24 months and allowed over it, copied order refused, unreadable context never raises, backfill invariant. int `inventory-history.int.test.ts`: the paths in turn: an adjustment (actor and reason), a paid sale (`sale`, order id), a refund with restock (`order_restock`, order id, location), a cancelled paid order, a return restock (`return_restock`, return id), the editor and a bulk save (`editor`, `bulk`), the AI tool (`ai_manager`), a file (`file`, job id); `inventory_ledger_check()` empty after each. scan `stock-writers.scan.test.ts`. |
| A3 | Stock can be updated in bulk from the page or a file with a dry run. | int `inventory-jobs.int.test.ts`: export then import unchanged; dry run changes nothing and lists every problem class of 2.4.3; apply writes movements with the job id; `on_hand_was` conflict skipped; formula characters escaped; one active import; the page's multi-row save with a conflict row and a failing row; unit `inventory-csv.test.ts` (parse, finding codes, never quoting a cell). |
| A4 | A variant crosses its low-stock threshold once: the owner gets one notification per crossing, not one per sale. | PGlite: every transition of `refresh_stock_alert()` equals `nextAlertState()` (unit); int `stock-alerts.int.test.ts`: threshold 5, stock 10, sales to 6, 5, 4, 3 send **exactly one** email; running the job twice sends one; a receipt above the level re-arms and the next crossing sends one more; setting a level on a low variant sends none; a closed store sends none; one email per store listing several variants; a failed send is retried and `notified_at` stays null; idempotency key. |
| A5 | (this run's addition) Negative and zero stock are handled by the inventory analytics and the admin. | unit `analytics-inventory.test.ts` (negative on hand: status `out`, days 0, value 0, owed shown, alerts), int `analytics-inventory-data.int.test.ts` (a `continue` variant at -3 with owed units; a threshold turning `low`), control-center int (low and owed counts). |

Expected rating after the run: **partial**, Full when 9.7 item 1 is done and accepted (1.1).

### 6.2 `catalogue.sell-when-out-of-stock`

| # | Criterion | Held by |
|---|---|---|
| B1 | A variant (or product) can be set to keep selling at zero stock; the cart then accepts any quantity for it and the product page says it is on backorder (e2e). | e2e `e2e/backorder.spec.ts` (seeded demo variant with `continue` and 7 days: the product page shows "On backorder: expected to ship within 7 days" and an enabled button; add 3, the cart accepts 3 and shows the line note; a normal variant at zero shows "Sold out" and no add; the JSON-LD says `BackOrder`); int `backorder.int.test.ts` (`changeLine()` accepts up to 20, caps at 20, never `unavailable` for stock); view tests of the picker. "Or product": the editor sets all variants at once; the data is per variant (6.5). |
| B2 | An order for such a variant is placed and its lines are marked backordered; stock may go below zero only for flagged variants (database rule and integration test). | PGlite: the negative rule (refused for `deny`, allowed for `continue`, a rise allowed on a `deny` variant that is negative, refused for non-physical), `draw_order_stock()` drawing below zero, `backorder_quantity` set, `stock.backordered` event, an earlier checkout's claim kept when a later one pays first (two orders, partial backorder, the checkout ahead letting go, an order with no live hold), a `deny` shortfall still `stock.short`; int `backorder.int.test.ts`: `placeOrder()` with 3 in stock and 5 wanted: the line has `backorder_quantity` 2 and `backorder_days`, the reservation is 5 of which 2 beyond stock, paying leaves on hand at -2 and the line at 2, the order page reads the badge; two checkouts racing for the last unit. |
| B3 | Variants not flagged still refuse more than is in stock and write nothing (existing test `refuses more than is in stock`). | the existing test in `checkout.int.test.ts` stays and passes unchanged; plus a case with a `deny` variant and a `continue` one in one cart: the order fails with `stock`, nothing written. |
| B4 | Inventory analytics and the admin handle negative stock (days of stock, alerts) and `checkout-kinds.int.test.ts` has a scenario. | as A5, and the scenario of B5. |
| B5 | (the euro scenario the standing rules require) | `checkout-kinds.int.test.ts`: a goods variant on backorder bought in a krone market and in a euro market, partly in stock: the cart's totals equal the order's, the Stripe amounts equal the order's, the order lines carry the backorder, no amount changes against the same line in stock. |
| B6 | (the disclosure) | view tests: the sentences in nb, sv, da, en appear on the cart, order page and confirmation email with the right number and plural; `ui-catalog.test.ts` cases for `CHOOSING`; the confirmation email test. |

Expected rating: **full**, subject to the lead's reading of section 8 (1.1).

### 6.3 `orders.multi-location-inventory-and-routing`

| # | Criterion | Held by |
|---|---|---|
| C1 | An owner adds, renames and deactivates stock locations; each variant's stock is held per location and the storefront sells the sum of the active ones. | int `inventory-locations.int.test.ts` (add, rename, duplicate-name refusal, move renumbers, deactivate removes the location's stock from `variant_availability` and from the cart's available, reactivate restores, the last active refused, live holds refused, non-owner refused for deactivate/reactivate, a store's locations never touch another's); PGlite for the guards; view tests for the screen; the sum over active locations in `variant_availability` (PGlite). |
| C2 | An order's lines are assigned to locations by a stated rule (stock available, then priority) and holds are taken there under row locks. | unit `stock-routing.test.ts` (rule steps 1 to 5 as examples plus properties of 4.3); int `stock-routing.int.test.ts` (`placeOrder()` with two locations: whole-order preference, split by rank, backorder remainder at the named location; reservations at the allocated locations; two concurrent `placeOrder()` for the last unit with a deadlock-free lock order, exactly one wins; paying draws from the hold's locations; order page shows "taken from"). |
| C3 | A refund restocks to the location the line was taken from, or the one staff choose. | int `order-admin.int.test.ts` additions and `returns.int.test.ts`: refund, cancel and an inspected return restock to the original locations (split order restocked in the two places); a chosen active location is honoured; a chosen inactive or foreign one refused; a deactivated original falls back to the first active; unit `stock-restock.test.ts` (never above what was taken, sums equal the quantity). |
| C4 | Stock reads and holds stay within the existing performance guard. | the premise is wrong as worded (there is no existing guard for holds and stock reads, only `analytics-perf.int.test.ts`, which stays and passes): a **new** `inventory-perf.int.test.ts`: 5,000 variants x 3 locations and 3,000 movements seeded without `ANALYZE`, `inventoryPage()` and `variant_availability` for 200 ids and a 20-line `placeOrder()` each under a stated bound (3 s per read, as the analytics guard). |
| C5 | Deactivating a location removes its stock from what is sellable and tells the owner how much was held there. | int: `locationImpact()` units, variants and committed figures are exact; after deactivation the shop's stock excludes it; the audit entry carries the counts; the action's refusal when the figure changed; view test of the dialog and the notice. |

Expected rating: **partial**, Full on the same condition as 6.1 (1.1).

### 6.4 Database tests (`src/db/inventory.test.ts`, PGlite, all migrations applied)

Every rule of 3.3 and 3.4, `draw_order_stock()` (positions of the three steps, rank order, `backorder_quantity` attribution over two lines of one variant, a renewal with no reservation),
the view, `clone_store()` and `duplicate_store()` copying the new columns (and the old behaviour intact), the opening-movement backfill, `inventory_ledger_check()`, and that
`complete_order_payment()` still issues an invoice (the patch kept its last statement).

### 6.5 Cross-cutting tests

- `stock-writers.scan.test.ts` (3.3.2) and `inventory-readers.test.ts` (3.5); `store-copy-rules.test.ts` and `privacy.test.ts` (new tables classified); `admin-map` and `store-nav` tests (the new pages);
  `owner-tool-permissions.test.ts`; `audit.test.ts` (the new actions have an area); `ui-catalog.test.ts`; `wordpress.int.test.ts` (a backorder variant is served as `out` with days, a quote and a
  handoff cart accept it) and `wordpress-plugin.test.ts` if the plugin is rebuilt; `product-roundtrip.int.test.ts` (export then import with the three new columns changes nothing; `stock` ignored with a
  warning when several active locations); `standing-orders.int.test.ts` (a `continue` variant with nothing free is left out, not backordered); `campaigns.int.test.ts` (a gift is never backordered);
  `store-copy.int.test.ts` (policy, threshold and priority copied, no movements copied, a copied order draws nothing); `lint`, `typecheck`, `db:check`.
- Quick unit property tests use fast-check if the repo already has it (`csv` is property-tested); otherwise table-driven.

### 6.6 Criteria changes (for the lead; the rows are not edited here)

1. **A1, "committed (reserved)"**: in Kaizen a paid order has already drawn its units, so *committed* is the live checkout holds. Proposed text: "…on hand, committed to checkouts in progress, and available…". The honest difference from
   Shopify's *committed* is said in 1.3 and on the page.
2. **A3, "from the page or a file with a dry run"**: the page's multi-row save has a review step and conflict detection but is not a "dry run"; the file has the dry run. Proposed text: "…in bulk from the page (reviewed before it is saved) and from a file with a dry run."
3. **A4**: "one notification per crossing" is delivered as one digest email per store per run listing the variants that crossed; a variant appears once per crossing. The threshold is per variant (no store-wide default).
4. **B1, "variant (or product)"**: the data and the rule are per variant; the editor offers a product-wide switch that sets all its variants. Proposed text: "A variant can be set…".
5. **B2**: "marked backordered" means `order_lines.backorder_quantity` (units) and `backorder_days`; the figure is what the shopper was told at placement and is settled at payment, where for a live hold it can only go down (3.13).
6. **C4** is untestable as worded (there is no existing guard for stock reads and holds). Proposed text: "Stock reads and holds stay within a stated performance bound held by `inventory-perf.int.test.ts`."
7. **C5**: "how much was held there" is units on hand, variants and live checkout holds; the action is refused while checkouts hold stock there.

---

## 7. What is deliberately NOT done, and why

- **Unavailable and incoming states, safety stock** (Shopify's damaged, quality control, safety stock, other): damaged units are an adjustment that lowers on hand with a reason; there is no held-aside state. Incoming needs transfers and purchase orders
  (`catalogue.inventory-transfers-and-purchase-orders`, a later run of wave 3).
- **Transfers between locations and purchase orders:** moving stock is two adjustments for now; the movement reasons are a widened check away from `transfer_out`/`transfer_in`.
- **Untracked variants ("Track quantity" off):** a physical variant always counts stock; made-to-order goods use `continue`. `tracked` in analytics stays true. Later wave 3 or 6 with the catalogue rows.
- **Pre-orders with a release date and a different message** (`catalogue.pre-orders`; Shopify offers them through apps only): `backorder_days` is the nearest thing; a date and "ships from" need their own row and wording. Not started.
- **Closest-location and custom routing rules, routing by country, per-product or per-market locations, "does not fulfil online orders"** (Shopify's proximity and app rules): one rule, ranked, described in 2.5. The location's country is stored for this.
- **Local pickup stock at a location** (`orders.local-pickup-at-own-location`), **POS** (bucket C), **location-level backorder policy** (policy is per variant).
- **Back-in-stock notifications** to shoppers (wave 5, `customers.back-in-stock-notifications`): they will read `variant_availability` and the movements.
- **A store-wide default low-stock level, notices to staff other than owners, SMS or push:** staff alerts are `orders.staff-alerts-for-new-orders-order-automation` (wave 3 later).
- **Splitting a shipment by location in a label or carrier booking:** order lines show where units were taken from; labels and partial fulfilment are `orders.fulfilment-workflow-partial-fulfilment` and the carrier rows.
- **Per-line fulfilment of backordered units** ("2 of 5 shipped"): an order is *Waiting for stock* until staff send it; the existing parcels (`shipments`) allow several; real partial fulfilment is a later row.
- **Stock counts in the order file or the customer file, supplier data, costs per location:** not touched.
- **Editing the history, deleting a movement, a correction that rewrites the past:** a wrong adjustment is corrected by a new one; this is the point of the ledger.
- **A stock count mode (cycle count sessions):** *Set to* with reason `count` is the whole of it.
- **Changing the checkout hold length, or holding stock in carts:** unchanged.

---

## 8. Needs human legal review

Every text below is hand-written in nb, sv, da and en, never claimed to be legal advice, and flagged `// legal: needs review` in the source. They are statements of delivery time to a consumer before and after
a purchase, not terms of sale, but they carry the information duties of 4.1.

1. `m.backorder.page(days)`: "On backorder: expected to ship within {days} days" (product page).
2. `m.backorder.line(n, days)`: "{n} on backorder: expected to ship within {days} days" (cart, slide-out cart, checkout line).
3. `m.backorder.order(n, quantity, days)`: "{n} of {quantity} on backorder: expected to ship within {days} days of your order" (order page, My account) and the same sentence in the order
   confirmation email (`email-text.ts`).
4. The editor's hint under *Expected to ship within*: "The 30 days run until the goods are delivered, not until they are shipped. If shipping and transport can take it past 30 days, the customer agrees to a longer time by ordering. Say it clearly." (English admin text, still for review: it states a rule; it appears from 24 days because it assumes `BACKORDER_TRANSIT_DAYS` = 7 days of transport, a number nobody has checked.)
5. The label change of the listing filter to "In stock now" and its translations (not legal, but it changes what the filter promises).
6. **The wording itself.** Art. 6(1)(g) asks for "the time by which the trader undertakes to deliver the goods". The sentences say "expected to ship within {days} days"
   (nb "forventes sendt", sv "förväntas skickas", da "forventes afsendt"): a non-binding forecast of *dispatch*, not an undertaking to *deliver*, and Art. 18(1) and
   forbrukerkjøpsloven § 6 count the 30 days to delivery. With `backorder_days` close to 30 plus transport the default is overrun without any agreed longer time. The
   first draft chose "expected" and "ship" on purpose (never a guarantee); a reviewer found that this may not be what the law asks for. **It is left as written, for the
   lawyer to decide**: likely rewordings are "we deliver within {days} days" or "ships within {days} days and is delivered by …" (then the field's label becomes the same
   promise), and whether a figure of the store's own transport time should be asked for.
7. Open questions for the lawyer: whether a backorder of an item the store has not ordered from its own supplier needs more than a number of days; how the 14-day withdrawal period runs for an order
   delivered in parts (the app records one receipt date, D153); whether days above 30 need an explicit tick at checkout in a given country.

A row that rests on these stays at the lead's judgement (1.1). None of them is machine-translated: the keys of `m.backorder.*` are in `HAND_WRITTEN_ONLY` (3.13), so a language the
store offers other than nb, sv, da and en shows the English sentence, never an AI translation. (The first build did put them in the AI catalogue; a review found it.)

---

## 9. For the lead

### 9.1 Migrations expected

Three files (3.8), additive. Each runs in one transaction through CI (`docs/ci-migrations.md`) after the checks pass; none is applied by hand first. The old code (which writes levels with no context and
never goes below zero) keeps working against the new schema until the deploy finishes: the trigger records its writes as `system`, the columns have defaults, the dropped check is replaced by a
stricter trigger. The widened `data_jobs` kind checks are a drop and add of the constraint (as D168 did).

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

The migration tool cancels statements with `DELETE` or `DROP` inside function bodies; CI applies through a direct connection, so none of these needs the owner. For completeness:
- `commerce.guard_inventory_movements()` contains the text `'DELETE'` (it checks `TG_OP`); it deletes nothing.
- The patched `clone_store()` and `duplicate_store()` **already contain deletes** in their bodies (as for waves 1a, 1b, 1d); if the lead ever applies by hand, apply those two patch blocks as separate parts and check
  `position('stock_policy' in pg_get_functiondef(...))`.
- `ALTER TABLE ... DROP CONSTRAINT` (the non-negative check, the data job kind checks) is plain DDL.
- Anchors of the three SQL patches must match **production's** present definitions (`pg_get_functiondef` there): `complete_order_payment()` (last patched by `20261004125337`), `clone_store()` and
  `duplicate_store()` (last by `20261002143638_analytics_rules.sql` and the tax and invoice patches after it); a patch that finds no anchor raises, which fails the file.

### 9.3 Advisors to check after the deploy

Security: two new tables with RLS on and no policies; every new function `SET search_path = ''` and not granted to `anon`/`authenticated`; the view `security_invoker`. Performance: every composite foreign key of
`inventory_movements` and `stock_alerts` has an index (3.2); `inventory_levels` gets one new trigger (per row, small insert), so the payment path's cost is one extra insert per variant drawn; if the advisor lists an
unused index on `inventory_movements`, keep it until the history page has been used.

### 9.4 Decision row, draft (D172, the next free number at ship time)

> **Inventory with locations, an adjustment history, backorders and low-stock notices (wave 3, first run).** `docs/wave-3-inventory.md` is the contract. Every change of a stock level is a row of the append-only
> `commerce.inventory_movements` (a trigger, so every writer is covered; reason, source, staff account, order and return; 24 months), so the movements of a variant at a location add up to its level
> (`inventory_ledger_check()`). A variant can keep selling at zero (`stock_policy = 'continue'`, with `backorder_days` 1 to 90 stated on the product page, the cart, the order page and the confirmation, and frozen
> on the order line); only such a variant may go below zero, enforced by the database; a checkout's claim on the stock it was told was there is kept whatever the order of payment (a reservation records how much of it is beyond stock). Stock is read through one view, `commerce.variant_availability`. Locations have a rank
> (`priority`); `placeOrder()` allocates by `allocate()` (keep an order together, else by rank, the backordered remainder at the first location that stocks it) under row locks taken in one order;
> `complete_order_payment()` draws through `commerce.draw_order_stock()`; a refund, cancel or return restocks to the location the units came from or one staff choose. Locations are added, renamed
> and ranked by staff and deactivated by owners after a report of the units that stop being for sale. An Inventory page (levels, committed, available, owed, adjust with a reason, history) and a file with a dry run
> (D165's pipeline, kinds `inventory_import` and `inventory_export`). A variant's low-stock level sends the owners one email per crossing. `[Migration versions to record: …]`

### 9.5 CLAUDE.md bullet, draft (Admin section, after the bonus program or with the inventory analytics bullet)

> - **Inventory (wave 3, D172, `docs/wave-3-inventory.md`)**: stock is `inventory_levels` per variant and location and every change of it is an append-only row of `inventory_movements` written by a trigger (reason, source, account,
>   order, return), with the why passed by `withStockContext()` (`src/server/stock-context.ts`; `stock-writers.scan.test.ts` fails for a writer without it); never write a level another way and never edit or delete a movement. Stock is read
>   only through `commerce.variant_availability` (`getVariantStock()`), never `available_stock` directly. A variant with `stock_policy = 'continue'` (physical only, `backorder_days` required) may go below zero; nothing else may
>   (database rule); `placeOrder()` allocates with `allocate()` (`src/lib/stock-routing.ts`: keep an order together, else by location rank, the backordered remainder at the first location that stocks the variant), locks level rows
>   in (variant, location) order, and `commerce.draw_order_stock()` (inside `complete_order_payment()`) keeps each checkout's physical claim (`inventory_reservations.backorder_quantity` is the part beyond stock) and writes `order_lines.backorder_quantity`; refunds and returns restock through `restockPlan()` to the original location
>   or one staff choose. Backorder wording is `m.backorder.*` (hand-written, flagged); policy and days are read per request, never in a `'use cache'` function; a gift or a weekly box is never backordered. Locations: owners deactivate,
>   staff add and rank; never delete one. Low-stock level per variant: `stock_alerts` and `sendLowStockNotices()` (one email per crossing). Stock files are D165 jobs (`inventory_import`, `inventory_export`), `on_hand_was` makes a row a
>   conflict when the stock moved. New money reads in this area need a euro scenario in `checkout-kinds.int.test.ts`; a new stock reason widens the `inventory_movements` check and `MOVEMENT_REASONS`.

### 9.6 Merge notes

- Shared files other work may touch: `src/db/schema.ts`, `src/lib/i18n.ts`, `src/lib/email-text.ts`, `src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `src/lib/owner-tools.ts`, `src/server/checkout.ts`, `src/server/checkout-kinds.int.test.ts`,
  `src/server/products.ts`, `src/lib/product-input.ts`, `src/lib/data-job.ts`. Edits are small and local.
- Migration stamps must sort after the latest committed file (`20261006061215_store_closure_rules.sql`); rename before they are applied, never after.
- `docs/wave-2-data.md` 4.1.2 (the product file's columns) and `docs/analytics.md` (inventory definitions) are edited by the server and analytics areas in the same change.

### 9.7 Before pushing (the things CI cannot prove)

1. **By hand, signed in:** add a second location, rank it, adjust two variants with a reason and Save (and a conflict), look at the history, deactivate a location (read the figures), import a counted file (dry run, then apply), set a
   variant to keep selling and place a test order for more than its stock, refund it with a chosen location. Decide whether this lifts the two admin-heavy rows from partial to Full (1.1).
2. A person who reads Norwegian, Swedish and Danish reads the `m.backorder` sentences on a real product page, cart and confirmation email (section 8).
3. Look at the product page, cart and order page of a backordered line in a krone store and in a euro store once by eye.
4. Check the order of events in the payment path on a copy of production data: `complete_order_payment()` still issues the invoice and the movements are written (`inventory_ledger_check()` is empty).

### 9.8 Blockers and risks

No owner decision and no credential stops the work (`blockers` is empty). Risks: (1) the trigger and the patched `complete_order_payment()` run in every payment, so the PGlite and int tests
for payment (`checkout.int.test.ts`, `order-invoices`, subscriptions, standing orders, returns) must all stay green and the movement trigger must never raise; (2) the number of readers that move to the one
view (3.5); a missed one keeps the old behaviour, which the reader scan test catches; (3) the delivery-time wording (section 8); (4) the admin screens cannot be clicked in CI, so their evidence is views plus server tests
and one by-hand check.
