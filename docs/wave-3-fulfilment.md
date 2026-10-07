# Wave 3, run 3: editing an order after purchase, partial fulfilment, packing slips per parcel and pick lists (decision D174 proposed)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-fulfilment.md`. Code, tests and texts follow it; a disagreement is settled here
first (the agent that must deviate changes this file in the same edit, in a "3.x As built" paragraph, and says so in its report). It was written from the tracker rows,
`docs/parity-plan.md`, CLAUDE.md and the code as it is on 2026-10-06 (commit `bf329ec`), and follows the shape of `docs/returns.md`, `docs/wave-3-inventory.md` and
`docs/wave-3-orders.md`. It builds on what exists (`orders`, `order_lines`, `order_events`, `payments`, `refunds`, `shipments`, `markSent()`, `refundOrder()`,
`cancelOrder()`, `updateOrderContact()`, `runBulk()`, `packingSlipData()`, `openPaymentSession()`, `settleOrderSessions()`, `applySession()`, `decideTax()`, `allocate()`,
`planRestock()`/`applyRestock()`, D141's order numbers, D153's withdrawals and returns, D159's invoices and credit notes, D161's tax reports, D172's stock, D173's drafts, pay links,
bulk actions and slips) and invents no parallel order, payment, stock or document system.

**What was found in the code that shapes everything below** (verified 2026-10-06):

- **Editing today** is `updateOrderContact()` (email and delivery address of a non-pending, non-copied, non-anonymised order; event `order.edited` with the field *names* only) and notes.
  No line, quantity, price, shipping or money change exists after `placeOrder()`. Nothing in the database forbids writing an order line of a paid order (only copied orders' lines are
  read-only, `copied_order_lines_read_only()`), but several columns are frozen by triggers once the order leaves `pending_payment`: the VAT treatment (`orders_vat_frozen`: kind,
  relief, treatment, shipping rate, check), the origin and staff discount (`orders_origin_frozen`), the gift (`orders_gift_frozen`), a line's measure (`order_lines_measure_frozen`)
  and a line's backorder (`order_lines_backorder_frozen`, writable only under `kaizen.drawing`).
- **Sending today**: `markSent()` (`src/server/order-admin.ts`) inserts a `shipments` row (carrier, tracking, optional carrier booking) and sets the order `fulfilled` at the **first**
  parcel; a later parcel is a second row with nothing tying it to lines. It refuses an unpaid or copied order and one whose every physical unit was withdrawn before anything was sent
  (`withdrawnInFull()`, D153). It reopens a recorded receipt (`delivered_at = null`, event `order.delivery_reopened`). Its callers: the order page's send form
  (`orders/actions.ts`), bulk *Mark as sent* (`runBulk()`, D173, which sends whole orders and refuses ones with backordered units as `waiting_for_stock`), the carrier bookings
  (`bring-shipping.ts`, `porterbuddy-shipping.ts`, `helthjem-shipping.ts`) and the weekly boxes' dispatch. `sendShipped(storeId, orderId, shipment)` sends one email per shipment
  (key `order-sent:{shipment.id}`) with carrier and tracking, no lines.
- **D153 reads shipments at order level**: `NOTHING_SENT_SQL` (`src/server/return-sql.ts`) says a withdrawal has nothing to send back when *no* shipment of the order existed at
  confirmation; `markDelivered()` needs a first shipment; `return-facts.ts` reads the last shipment. `commerce.returned_quantity(line)` counts units on returns that are not cancelled or
  declined.
- **Slips today** (D173): `packingSlipData(storeId, ids)` (`src/server/packing-slips.ts`) prints every physical line of an order with its full quantity, in the order's language, no
  prices, with the gift block; single (`orders/[orderId]/packing-slip`) and bulk (`orders/packing-slips?ids=`, at most 100). There is **no pick list** and no per-parcel slip.
- **Invoices** (D159): one invoice per order (`invoices_order_key` unique on `(store_id, order_id)`, `invoices_kind` = `'order'`), issued only inside `complete_order_payment()`;
  credit notes only for a succeeded refund (`source = 'refund'`, a deferred constraint trigger) or a return refunded outside (`return_outside`); a refund not tied to a return is
  allocated over the invoice's VAT buckets in proportion (`creditAllocation()`); `payment_on_invoice()` says a payment made after the invoice (a no-show fee) is not the invoice's, and its
  refund gets no credit note. `docs/wave-1b-invoices.md` section 7 left "manual credit notes … a corrective invoice" **to wave 3 (order editing)**: this run takes that part.
- **Analytics** (`docs/analytics.md`): revenue is Σ `total − tax` of paid orders **dated by `placed_at`**, refunds are subtracted by their own date. If an edit lowered `total_minor` and
  its difference were also counted as a refund, the sale would be taken off twice; the definitions must change with this run (5.5).
- **Payments for a paid order** have no path today: `applySession()` calls `completeOrderPayment()` for any completed session of the store, and `complete_order_payment()` accepts a
  `pending_payment` or `cancelled` order only. A session for an order's *difference* needs its own branch (4.5).
- **Stock**: a paid order's units were drawn at payment (`commerce.draw_order_stock()`, movements `sale`/`order`); `planRestock()`/`applyRestock()` put units back to where they came from
  (D172), never more than the order took. `allocate()` and `allocateStock()`/`reserveStock()` (`src/server/order-insert.ts`) hold new units under the level rows' locks.
- **Orders are inserted and numbered only in `src/server/order-insert.ts`** (a scan test, D141/D173). An edit never inserts an order, so the number and the sequence cannot change.
- **Two of this run's rows are the same Shopify feature** (`orders.edit-an-order-after-placement` and `checkout.order-editing-after-purchase`, both from
  https://help.shopify.com/en/manual/orders/edit-orders): rule 8 of `docs/parity/README.md` says they must be merged (6.5). This spec holds the criteria of both.
- The repo has **no signed-in admin fixture** (D158): admin screens are held by `renderToString` view tests and server integration tests; the storefront is clicked by e2e against
  `pnpm start` without Stripe.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `orders.edit-an-order-after-placement` | 3 | partial | A | **Partial.** Every criterion is built and held by integration tests against a real database and the repo's fake Stripe (add, remove, change a quantity; totals, VAT, discounts and stock by the checkout's own functions, equal to `cartSummary()` for the added goods in a krone market and a euro view; a pay link for a higher total; a refund through `refundOrder()` for a lower one; one history event with before and after; the number unchanged; refusals). It stays **partial** until (a) the consumer texts of section 8 (the change email, the change pay page, the edit invoice and credit note wording) are read by a person, the same rule run 2 applied to drafts, and (b) one edit has been paid in Stripe test mode on a real store (9.7). |
| `checkout.order-editing-after-purchase` | 3 | partial | A | **The same feature as the row above** (rule 8): proposed for merging into it (6.5). Until the lead merges it, it is rated with its twin, **partial** for the same reasons; its criteria ("the customer is emailed a revised confirmation", "a host order cannot be edited") are held by this spec's tests. |
| `orders.fulfilment-workflow-partial-fulfilment` | 4 | partial | A | **Full** by the criteria: shipments tied to lines and quantities with a *Partly sent* state, each parcel with its own carrier, tracking and email, the shopper's order pages listing parcels with their lines (storefront e2e), bulk *Mark as sent* (built in D173, extended here), withdrawn units left out (integration tests). The staff screen is held by view tests and server tests, as D173's tags row was; the skeptic may hold it at partial for that, and the lead decides after 9.7. |
| `orders.packing-slips-and-pick-lists` | 3 | partial | A | **Full** by the criteria: bulk slips (D173, now with the units still to send), a pick list of the selected orders by product, variant and SKU (unit and integration tests), the gift block (D173), another store's orders never printed (integration test). Template choice is not a criterion and is not built (section 7); the skeptic should not hold the row for it. |

No row is bucket B, C or D, nothing needs a third party or a credential (the difference is paid through the Stripe the store already has, or recorded as paid outside Kaizen as
D173 allows), and no decision of `docs/parity-plan.md` section 5 touches this run, so **`blockers` is empty**. Weights are not changed (tracker rule 6).

Rows this run touches but does not close: `orders.editable-notification-email-templates` (the new emails are fixed texts), `orders.staff-alerts-for-new-orders-order-automation`
(nothing), `orders.order-list-search-filters-saved-views-bulk` (gains the `partly_sent` filter value and the pick list as a bulk action; its rating is the lead's after 9.7 of D173),
`catalogue.inventory-transfers-and-purchase-orders` (nothing).

### 1.2 What Shopify does (pages read on 2026-10-06)

- **Editing** (https://help.shopify.com/en/manual/orders/edit-orders): "add or remove products, adjust item quantities, and update shipping fees", "apply manual discounts to specific
  items or remove existing discounts"; "if additional payment is required, then you can send the customer an updated invoice"; "If the order total decreases, then you can issue a refund".
  **Considerations** (https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/considerations): "You can't remove fulfilled items or adjust their quantity";
  "If an order contains fulfilled line items, then you can't edit this order" (for taxes and duties); "Order level discounts can't be added, removed or updated"; discount codes, script
  and automatic discounts can't be edited; "Shipping methods and rates aren't recalculated when you edit an order"; "If you edit an order after the day the order was placed, then the edit
  displays as a separate order" (analytics); orders paid with Shop Pay Installments, local-delivery orders and imported orders cannot be edited; it needs the *Edit orders* permission.
  **Products** (https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/products): products and custom items can be added; "Products that you remove are
  automatically restocked to their original location" (staff may untick *Restock units*); "the discounts on an order don't automatically update. Review your order totals carefully";
  after editing, staff send an invoice with a link to the checkout page or accept payment, and the customer gets an *order edit* notification from an editable template.
- **Partial fulfilment** (https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment): "Enter the item quantities that you want to fulfill"; several tracking
  numbers; "each fulfillment in an order is fulfilled separately, so a customer can receive more than one shipping confirmation email"; a fulfilment can be cancelled. **Bulk**
  (https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/bulk-fulfillment): mark selected orders fulfilled with an optional notification; "If you select more than 250 orders
  for a bulk action, then some features might not be available".
- **Packing slips** (https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/packing-slips/printing-packing-slips): bulk print from the Orders page; "Packing slips
  include all the items that are sent in a specific shipment. If you have multiple shipments for an order, then you can print a separate packing slip for each shipment." The page does not
  state the bulk limit (the row's "up to 50" is the Order Printer's).
- **Pick lists** (https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/shopify-order-printer/pick-list, through the Order Printer app): "a list of items that need
  to be picked to fulfill your customer's order"; pick "by orders or by products"; sorts by quantity, SKU or variant (by product) or order ID (by order); include orders by fulfilment status;
  columns product image, product name, variant, order ID, SKU, quantity, fulfilment; an optional location; "You can print pick lists for up to 50 orders at a time".

What Kaizen matches: add, remove and change quantities of goods on a paid, unsent order; the discounts the order was sold with are kept on the units kept and never recalculated;
added goods priced at the market's price (or a price staff type), VAT by the checkout's own decision; shipping kept or set by staff; a pay link for a higher total, a refund for a
lower one, restock of removed units to where they came from; a notification to the customer; partial fulfilment by line quantities, each parcel with its own tracking and email, a
section per parcel on the order page; bulk mark as sent; slips per parcel and for what is still to send; a pick list by product or by order.
**Where Kaizen goes further on purpose:** the edit keeps the order's number and gap-free sequence (D141) and is documented by a credit note and an additional invoice that refer to
the original invoice (VAT Directive Art. 219), never by changing an issued invoice; a higher total is applied only when the customer has paid it (CRD Art. 22, express consent to an extra
payment). **What it deliberately does not match**: section 7.

### 1.3 Terms used in this file

- **Physical line**: an order line with `delivery = 'physical'` and a variant. **Unit**: one of its `quantity`.
- **Shipped units** of a line: Σ `shipment_lines.quantity` for it, plus, for an order with a **legacy shipment** (one recorded before this run, `shipments.legacy`), every unit of every
  physical line (3.3 point 2 back-fills those, so readers see one rule).
- **Withdrawn units** of a line: `commerce.returned_quantity(line)` (D153: units on returns not cancelled or declined).
- **Closed units** of a line: units staff took off what is still to send because they will not be sent (`commerce.closed_quantity(line)`, Σ `unsent_closures.quantity`; 3.16).
- **Units to send** of a line: `max(0, quantity − shipped − withdrawn − closed)` (4.2, 3.16). An order's units to send are the sum over its physical lines.
- **Fulfilment state** of an order (`fulfilmentState()`, pure, and `commerce.order_fulfilment(order)`, SQL, held equal by a test): `none` (no physical line), `unsent` (nothing
  shipped, units to send > 0), `partly_sent` (something shipped, units to send > 0), `sent` (something shipped, nothing left to send), `withdrawn` (nothing shipped, nothing left to send
  because it was withdrawn). Words: *Not sent*, *Partly sent*, *Sent*, *Withdrawn before sending*.
- **Edit** (an *order change* in every shopper-facing word): one set of changes to an order's goods and shipping, made by staff, numbered per order (`E1`, `E2`, …), recorded in
  `order_edits`. **Kept**, **removed**, **added** units: what stays, what the edit takes off, what it puts on. **Difference** `Δ = total after − total before`.
- **Awaiting payment**: an edit with `Δ > 0` that was sent to the customer and is not paid; the order is **unchanged** until it is paid. **Applied**: the order now carries the edit.
- **Edit context**: the transaction-local setting `kaizen.order_edit` set to the order's id by the one server function that applies an edit; the database lets the frozen and guarded
  columns change only under it (3.3).
- **Edit invoice** (`invoices.kind = 'order_edit'`) and **edit credit note** (`credit_notes.source = 'order_edit'`): the documents of an applied edit of an invoiced order.

### 1.4 Decisions this spec makes (the lead may veto any before the build; each is argued where it is used)

1. **A *Partly sent* order stays `status = 'paid'`**; it becomes `fulfilled` only when it has a shipment and no unit is left to send. No new enum value: every reader that treats
   `fulfilled` as "sent" stays right, and *To send* keeps partly sent orders in it, which is where the work is (4.2).
2. **Every new shipment names its lines and quantities** (`shipment_lines`); `markSent()` without lines sends **everything still to send**, so every existing caller keeps its
   meaning. Shipments recorded before this run are **legacy** and count as having sent everything (back-filled, 3.3).
3. **An edit is allowed only on a paid order with nothing sent** (no shipment at all, legacy or not), not copied, not a host's, with standard VAT (`vat_kind = 'standard'`), no
   subscription, weekly box, booking line or venue balance, no return or withdrawal, and in an open store (4.4). This is narrower than Shopify (which edits unfulfilled lines of
   partly fulfilled orders) and is the row's own criterion ("a paid, unsent order").
4. **What is kept is never re-priced.** Kept units keep their price, every discount part (campaign, group, code, credits, welcome discount, staff discount) and their VAT as sold,
   apportioned by the cumulative rule D153 uses for a return (`paidForUnits()`); added goods are priced at the market's price as shown (or a price staff type), VAT by `decideTax()` over
   the order's market, with no campaign, code, group discount or credit (Shopify: discounts don't update and codes and automatic discounts can't be edited) (4.3).
5. **A higher total is applied only when paid.** Until the customer pays the difference (a pay link, Stripe's hosted page, the D173 pattern) or staff record it as paid outside Kaizen,
   the order stays as it was and only the added units are held. A lower or equal total is applied at once; a lower one refunds the difference through `refundOrder()` in the same
   transaction as the change (4.5).
6. **An edit of an invoiced order issues documents, never changes one**: an edit credit note for what was removed (and a lower shipping charge) and an edit invoice for what was added (and a
   higher shipping charge), both referring to the original invoice; the refund of the difference gets **no** credit note of its own (the edit's covers it). Later refunds and returns are
   credited against the order's documents taken together (4.6).
7. **The order's own figures are the edited ones.** Revenue, VAT and units read the order as it now is, on the day it was placed; a refund that settles an edit is not a refund in
   analytics (it would take the sale off twice). The documents carry the change in the period it happened (D161) (4.7, 5.5).
8. **An edit is never deleted and keeps its before and after** (`order_edits`, `order_edit_lines`, one order event); a line the edit takes off entirely is deleted from `order_lines`
   (nothing can reference it on an unsent order without returns, 4.4), and its row is kept in `order_edit_lines.before`.
9. **The AI manager may read edits, shipments and pick lists, and may not edit, send or record anything here** (7).

---

## 2. Behaviour

### 2.1 Staff side: sending in parts (the order page, `/admin/{store}/orders/{orderId}`)

Needs `orders:write` (looking needs `orders:read`). The *Send* card replaces today's form:

- **The lines to send.** A table of the physical lines with, per line, *Ordered*, *Sent*, *Withdrawn* (D153, before sending), *To send*, and a number field *In this parcel* that starts
  at *To send* (0 for a line with nothing to send, which is shown greyed with the reason). Backordered units (D172) are marked "on backorder: check you have them". A line with units to
  send can be sent in part (1 to its units to send). Digital and service lines are not listed.
- **The parcel**: carrier (the D27 list), tracking number, tracking URL (as today), and *Tell the customer* (on by default, as today's single send).
- **Send this parcel** calls `markSent(storeId, orderId, input, accountId, booking?, lines)` with the chosen lines. The server checks again under the order's lock (4.2) and either
  records the shipment and its lines or refuses with a sentence (3.4). The order's state then reads *Partly sent* (units are left) or *Sent* (none left).
- **Shipments** are listed below in order: date, carrier, tracking (linked), the lines and quantities in it, *Packing slip* for that parcel (`?shipment={id}`), *Label* when a carrier
  booked it, *Email again* (`sendShipped(..., { resend: true })`). A legacy shipment says "Recorded before parcels listed their items: counts as everything sent".
- **Carrier bookings** (Bring, Porterbuddy, Helthjem): their forms gain the same *In this parcel* table; the weight estimate (`estimateWeightGrams()`) is of the chosen units. A booking
  without a choice sends everything still to send (today's meaning). A booking in the carrier's test environment books nothing and records no shipment (D134, unchanged).
- **Bulk *Mark as sent*** (D173, `runBulk()`): unchanged for orders with nothing sent; for a *Partly sent* order it sends **everything still to send** as one parcel; it still refuses
  backordered orders (`waiting_for_stock`: sent in parts from the order's page) and now also an order with an edit awaiting payment (`edit_pending`). The notification is per order, with
  the parcel's lines.
- **Withdrawn units.** Units withdrawn before sending (D153) are never offered: they are not in *To send*. A withdrawal confirmed after a part was sent takes its units from the unsent
  ones first (4.2), so "the customer withdrew 1 of 3, 1 already sent" leaves 1 to send and the withdrawn unit is not sent at all. When a withdrawal leaves nothing to send on a partly sent
  order, the order becomes *Sent* (`fulfilled`) in the same transaction as the confirmation (the withdrawal code calls `refreshFulfilment()`).
- **Receipt.** *Mark the goods as received* (D153, `markDelivered()`) is offered only when the order is *Sent*: goods ordered together and delivered separately are received when the
  last one is (CRD Art. 9(2)(b)), so a partly sent order has no receipt to record yet, and the button is replaced by "Record the receipt when the last parcel has arrived". A parcel
  recorded after a receipt still reopens it (D153, unchanged).
- **Cancel** on a *Partly sent* order is refused (`PARTLY_SENT_CANCEL`: refund the units that are not sent, put them back in stock and tick *These units were not sent*, 3.16);
  `cancelOrder()` refuses any order with a shipment.

### 2.2 Staff side: editing an order (`/admin/{store}/orders/{orderId}/edit`)

Needs `orders:write`. The order page shows *Edit items* when the order may be edited (4.4); otherwise it shows the reason in words (sent, partly sent, copied, a host's, a subscription,
a weekly box, a booking, a venue balance, reverse charge or IOSS, a return or withdrawal, an edit awaiting payment, the store is not open, waiting for payment).

**The editor** (one screen, English, full width): the order's lines as sold, each with a quantity field (0 to its quantity: **a kept line can only go down**; to sell more of a variant,
add it) and *Remove*; *Add a product* (search by title or SKU: active goods variants sellable in the order's market, the same picker as a draft's, D173), with a quantity (1 to 9,999) and
the price (the market's list price **as shown in the order's currency**, `shown()`, editable as a *custom price* that is the price charged, never a "was" price); *Shipping*: *Keep* (default)
or *Set a new price* (VAT included; refused when the order had a shipping discount, 4.3); *Put removed items back in stock* (on by default, as Shopify; off leaves them out, for goods
that were damaged; each removed variant can be untoggled); **Reason** (required): *The customer asked*, *Out of stock*, *Our mistake*, *Other*, with a note (up to 500 characters, staff
text, kept only in the history event's `data.note`, "do not write about a person"); *Tell the customer* (on, and **cannot be turned off** for an edit with `Δ > 0`, which asks them
to pay, or with removed units, which the customer must be told of).

**The summary** beside it is the server's (`previewOrderEdit()`, the same function the apply uses; the browser never works a total out): lines kept, removed, added; the order's
subtotal, discounts, shipping, VAT per rate and total **before and after**; the difference and what happens with it ("The customer will be asked to pay 149,00 kr", "149,00 kr is
refunded to the customer's card", "Nothing to pay or refund"); the documents it will issue ("Credit note for the removed items and an additional invoice for the added ones,
referring to invoice F-17"); stock problems (an added variant that stops at zero: blocking; on backorder: a note with its days, D172); and **problems** in words (4.4).

**Applying** (*Save the change*):

- **`Δ ≤ 0`**: one press applies the edit at once (4.5): the removed units go back in stock (if chosen), the added units are drawn from stock, the order's lines and totals change, the
  refund of `−Δ` goes through `refundOrder()` (Stripe on the store's account, Kaizen's fee on the refunded part returned; or recorded for a payment taken outside Kaizen, D173, by the
  owner or staff the owner allows), the documents are issued, one history event is written, and the customer is emailed (2.4). A refund Stripe refuses leaves **nothing** changed and says
  Stripe's sentence.
- **`Δ > 0`**: *Send the customer a pay link* creates the edit as **awaiting payment** (4.5): the added units are held until the link's end (`EDIT_PAY_DAYS` = 7 days), the order is
  unchanged, the customer is emailed the link; *Create a link to share* does the same without the email and shows the link once. Staff may instead *Record as paid outside Kaizen*
  (owner, or staff when `order_settings.staff_mark_paid` is on: the D173 rule), with a method, a reference and the day received, which applies the edit at once with a manual payment of `Δ`.
- **While an edit awaits payment**, the order page says so with the link's end and offers *Send again*, *Create a link to share*, *Record as paid outside Kaizen* and *Cancel the change*
  (which closes its Stripe session first, as D173 does, and releases the held units). Sending, refunding, cancelling the order, registering a return and another edit are refused until it
  is paid, cancelled or expired. **A customer's withdrawal is never refused**: confirming one cancels the awaiting edit (4.5).

### 2.3 Staff side: packing slips and the pick list

- **The order's slip** (`/orders/{orderId}/packing-slip`, D27/D173): prints **the units still to send** (a partly sent order's remainder), in the order's language, no prices, with the gift
  block (D173). For an order with nothing left to send it prints every physical unit as sold under a line *All items (already sent)* (a reprint). **A parcel's slip**
  (`?shipment={id}`) prints that shipment's lines and quantities and, when units remain, the words "More of this order follows in another parcel". A shipment of another order or store is a 404.
- **Bulk slips** (`/orders/packing-slips?ids=`, D173, at most 100): one per order, each on its own page, of the units still to send; orders with nothing to send are listed at the top as
  skipped (`already_sent`, `withdrawn`, beside today's `copied`, `nothing_to_ship`, `not_found`).
- **The pick list** (`/admin/{store}/orders/pick-list?ids=…&by=product|order`, `orders:read`; offered as a bulk action *Print pick list* beside *Print packing slips*, at most 100 orders, the
  ticked orders of a page as the slips are, D173 3.13): **by product** (default), one row per variant with product title, variant title, SKU, the number of orders and the **units to
  send**, summed over the selected orders, sorted by SKU then title (a choice: SKU, title, quantity high to low); **by order**, each order's number with its units to send per line. It leaves
  out digital and service lines, units already shipped and units withdrawn before sending, and lists skipped orders with the reason (`copied`, `not_found`, `unpaid` for an unfinished
  checkout, `nothing_to_send`, and `edit_pending` printed as a warning line, not skipped, because the order is unchanged until paid). One printable page, English (a staff document),
  no prices, no customer names or addresses (by order: the order number only). It changes no state.

### 2.4 Shopper side and emails

- **The order pages** (the order page `/s/{store}/{market}/order/{id}` drawn by `order-section.tsx`, and My account's order page) show the fulfilment state (*Partly sent*, *Sent*) and a
  section per parcel: the date, carrier and tracking link, and the lines and quantities in it; under them *Still to come*: the units still to send (with the backorder words of D172 for
  backordered units). A legacy shipment shows as today (carrier and tracking, no lines). The words are `m.fulfilment.*`.
- **The shipped email** (`sendShipped()`, one per parcel, key `order-sent:{shipment}` unchanged) lists the parcel's lines and quantities and, when units remain, "The rest of your order
  follows in another parcel", with the withdrawal block as today (D153: the right counts from the receipt of the last parcel; the sentence about that is hand-written, section 8).
- **An order change** (`order.changed`, a new email kind in `EMAIL_KINDS`, to `order.email` only, in the order's language, key `order-changed:{edit}` for the applied email and
  `order-change-pay:{edit}:{n}` for the pay-link email): subject "{store}: your order {number} has been changed"; what was removed and added (titles, quantities, line totals), the shipping
  if it changed, the new total, the reason in the customer's words (*At your request*, *An item was out of stock*, *We made a mistake*, or nothing for *Other*: never staff's note), then
  one of: the refund ("We have refunded {amount} to your original payment method"; for a payment taken outside Kaizen "{store} pays {amount} back to you"), the pay link with its end ("To
  confirm the change, pay {amount} by {date}. If you do not, your order stays as it was"), or "Nothing more to pay". It carries the order page link, the edit's documents (the edit credit
  note and edit invoice links, D159), and the withdrawal block for added goods (D153). The refund's own email (`sendRefunded()`) is **not** sent for an edit's refund (one email).
- **The change pay page** `/s/{store}/{market}/account/change/{token}` (the D173 pay page's pattern; `isNoExtrasPath()`, `noindex`, `Referrer-Policy: no-referrer`, no cookie, no
  tracking, chat or consent manager, valid only under the order's own country, a token of 32 random bytes kept only as a SHA-256 hash): the store and seller block, the order number, what
  changes (removed and added lines with quantities and line totals), the new total, **"Already paid"** and **"To pay now: {Δ}"**, a backorder sentence for added backordered units (D172),
  the right of withdrawal sentence for the added goods, a link to the store's terms (the order's acceptance stands; nothing is ticked again, section 8 item 4), and one button
  `m.pay(Δ)` that opens Stripe's **hosted** session for `Δ` (no Stripe.js, no new script origin; one idempotency key per press). States in plain sentences: *ready*, *paid* ("This
  change is paid and your order is updated"), *expired*, *cancelled* ("This link no longer works. Your order is unchanged. Ask the store if you still want the change", with the contact
  address), *payments off*. An unknown or malformed token is the same 404 as a missing page. After paying, Stripe returns the customer to the order page.
- **Withdrawal** (D153) is unchanged in law: the right covers the order **as it now is**; added goods carry it like any goods (14 days from the receipt of the last parcel).

### 2.5 Platform side, AI manager

- **Platform**: no new page. Three rows in the plan comparison (D132, 5.5) describe the features; they enable nothing.
- **AI manager** (read only in this run): `get_order` says the fulfilment state, each parcel's lines, the units still to send and the order's edits (number, date, difference, state:
  never staff's note); `list_orders` accepts the new filter value `ship=partly_sent` and `edit=pending`; a new ungated tool `pick_list` (orders by number, or "everything to send", at most
  100, by product or by order) answers from `pickListData()`. **No tool edits an order, marks one sent or records a payment** (7).

### 2.6 Copied orders, host orders, other kinds, other currencies, other languages, privacy, closed stores

- **Copied orders (D129)**: never sent, never edited, never on a pick list; every new table refuses them (`refuse_copied_order()` on `shipment_lines`, `order_edits`). `copy_orders()` copies
  an order as it is (its lines as edited), never its edits, shipments or shipment lines.
- **Hosts' orders (D71)**: never edited (the host is the seller and is paid on the host's own account; the commission and DAC7 figures would move). They have no physical lines, so
  partial fulfilment does not arise.
- **Subscriptions and renewals (D25), weekly boxes (D102), bookings (D65 to D70)**: never edited (their price, schedule or time is agreed elsewhere). A weekly box is sent whole (its
  dispatch charges first and marks sent; partial is refused, `delivery_box_whole`). Downloads and services on an order with goods stay as they are; an edit changes goods lines only.
- **Draft-made orders (D173)** are edited like any other once paid; the staff discount of their kept units is kept and apportioned (the frozen trigger allows it under the edit context only).
- **Other currencies (D109)**: the edit is in the order's currency; added goods are priced with `shown()` in the order's own market view (`{country}[-{lang}][-{currency}]` rebuilt from the
  order), never converted again; the difference is charged or refunded in the order's currency; every new money read has a **euro scenario** in `checkout-kinds.int.test.ts`.
- **Languages**: admin screens are English; everything the customer reads (the change email, the change pay page, the parcel words on the order pages and in the shipped email, the slip's
  "more follows" line, the edit documents' headings) is hand-written in nb, sv, da and en; the legal and legal-adjacent words are in `HAND_WRITTEN_ONLY` (no machine translation), and
  other languages show English for them.
- **Privacy (D162)**: shipment lines and edits hold no personal data (ids, SKUs, titles, quantities, amounts); staff's note is only in the history event's `data.note`, which the
  anonymising removes; an edit's pay token is a hash and is cleared when the edit ends. The customer's data export lists each order's parcels with their lines and its changes (number, date,
  difference, state). An erased person's order (`restricted_at`) can still be sent in parts, and **cannot be edited** (`restricted`: the person is cut loose; there is nobody to ask or email).
- **Closed or suspended store (D171)**: may send and print (the goods are paid for); **may not edit** (`store_closed`); an edit awaiting payment when the store closes is cancelled by the
  closing step (its session closed, its units released).

### 2.7 Failure behaviour

- **Sending**: a quantity above what is left, a line of another order, a withdrawn unit, a weekly box in part, an awaiting edit, a copied or unpaid order: refused with a sentence and
  nothing written (one transaction). Two staff sending at once are serialised by the order's row lock: the second sees what the first sent and is refused with `changed` if its quantities
  no longer fit.
- **Bulk send**: per order, as D173 (a refusal or failure on one never undoes another).
- **Edit, `Δ ≤ 0`**: the preview's base (the order's money columns and line quantities, `order_edits.base`) is compared with the order under its lock; anything moved (a refund, a
  withdrawal, a shipment, another edit) refuses with `changed` ("The order changed while you edited it: start again"). A stock shortage for an added variant that stops at zero refuses with
  `stock`. A Stripe refund that fails refuses the whole edit (nothing written); a refund Stripe answers `pending` (a bank method) applies the edit (the money is on its way).
- **Edit, `Δ > 0`**: the hold of the added units lapses at the link's end; `expireOrderEdits()` (the five-minute job) closes the Stripe session first and marks the edit `expired`; a
  session that turns out **paid or processing** is left to the webhook and the edit is not expired. **A payment that arrives for an edit that can no longer be applied** (the order was
  sent, withdrawn or refunded meanwhile through a path that did not cancel it, or the edit was cancelled while Stripe was still processing) is **refunded in full at once**
  (`refundOrder()` of that payment, reason "the order changed before the payment arrived"), recorded as event `order.edit_payment_refunded`, and the customer is emailed the refund;
  nothing else changes.
- **Documents**: issuing the edit's documents never blocks the edit or its money (D159's rule): a failure or a waiting reason (missing seller details, no exchange rate) leaves
  `order_edits.documents = 'waiting'`, and the five-minute job `issueWaitingInvoices()` issues them after the original invoice, in order.
- **Stripe minimum**: a difference below the provider's minimum cannot be paid by card; the pay link says "The amount is too small to pay by card" and staff are told on the edit to record it
  as paid outside Kaizen or change the added price.

---

## 3. Data

All new tables are in `commerce`, carry `store_id` with composite foreign keys `(store_id, …)` as every store-owned table does, have RLS on with no policy (the server reaches them through
`db()`), and are `never` in `COPY_RULES`.

### 3.1 Columns added to existing tables

| Table | Column | Meaning |
|---|---|---|
| `shipments` | `legacy boolean not null default false` | Recorded before this run: counts as every physical unit of the order sent. The migration sets it `true` for every existing row; nothing sets it afterwards. |
| `orders` | `edited_at timestamptz null` | When an edit was last applied (the list's *Edited* badge). Written only under the edit context. |
| `order_lines` | `order_edit_id uuid null` | The edit that added the line (null for lines placed with the order). Frozen after insert. |
| `payments` | `order_edit_id uuid null` (fk `(store_id, order_edit_id)`) | A payment of an edit's difference. `applySession()` routes by it (4.5). |
| `refunds` | `order_edit_id uuid null` (fk) | The refund of an edit's difference (or of an edit payment that could not be applied: `order_edit_id` set and the event says which). |
| `inventory_reservations` | `order_edit_id uuid null` (fk) | Units held for an edit awaiting payment; `draw_order_stock()` ignores them (3.3). |
| `invoices` | `order_edit_id uuid null` (fk) | Set exactly for `kind = 'order_edit'`. |
| `credit_notes` | `order_edit_id uuid null` (fk) | Set exactly for `source = 'order_edit'`. |

### 3.2 New tables

**`shipment_lines`**: `store_id`, `shipment_id`, `order_line_id`, `quantity int not null check (quantity > 0)`, `created_at`; primary key `(shipment_id, order_line_id)`; foreign keys
`(store_id, shipment_id)` → `shipments` and `(store_id, order_line_id)` → `order_lines` (restrict); index `(store_id, order_line_id)`.

**`order_edits`**: `id uuid pk`, `store_id`, `order_id` (fk restrict), `seq int not null` (per order from 1; `unique (store_id, order_id, seq)`), `status text` (`awaiting_payment`, `applied`,
`cancelled`, `expired`), `reason text` (`customer_request`, `out_of_stock`, `store_error`, `other`), `notify boolean not null`, `restock boolean not null`, `currency char(3)`, `base jsonb not null`
(the order's money columns and every line's id and quantity when it was previewed, for the stale check), `total_before`, `total_after`, `subtotal_delta`, `shipping_before`,
`shipping_after`, `discount_delta`, `tax_delta`, `difference_minor` (all `bigint`, the order's currency; `difference_minor = total_after − total_before`), `payment_id uuid null` (fk),
`refund_id uuid null` (fk), `pay_token_hash text null` (SHA-256, base64url, unique where not null), `expires_at timestamptz null`, `made_by uuid not null` (fk `accounts`),
`documents text not null default 'none'` (`none`, `issued`, `waiting`, `not_invoiced`), `applied_at`, `ended_at` (cancelled or expired), `created_at`; partial unique index: **one
`awaiting_payment` edit per order**; index `(store_id, status, expires_at)` for the job; `(store_id, order_id)`.

**`order_edit_lines`**: `store_id`, `order_edit_id` (fk cascade from nothing: never deleted), `n int` (position), `kind text` (`add`, `remove`, `reduce`), `order_line_id uuid null` (**no
foreign key**: a removed line is deleted), `variant_id uuid null` (fk restrict, may be null for a line whose variant is gone), `sku text`, `title text`, `quantity int > 0` (units added or
taken off), `unit_price_minor`, `list_price_minor null` (an added line's list price as shown, information only), `total_minor`, `discount_minor`, `tax_minor`, `tax_rate`, `parts jsonb` (the
discount parts taken off: member, campaign, bonus, referral, staff; for `add` all 0), `before jsonb null` (the whole order line as it was, for `remove` and `reduce`), `backorder_quantity int`
(for `add`: the units sold on backorder, with `backorder_days`), primary key `(order_edit_id, n)`.

**`unsent_closures`** (added by the review fix of 3.16): `id uuid pk`, `store_id`, `order_id` (fk `(store_id, order_id)` → `orders`, restrict), `order_line_id` (fk
`(store_id, order_line_id)` → `order_lines`, restrict), `quantity int not null check (quantity > 0)`, `refund_id uuid null` (fk `(store_id, refund_id)` → `refunds`, restrict: the refund the
units were closed with, null when nothing was refunded), `created_by uuid null` (fk `accounts`), `created_at`; indexes `(store_id, order_id)`, `(store_id, order_line_id)`, `(store_id,
refund_id) where refund_id is not null`, `(created_by)`. Append-only; RLS on with no policy; `never` in `COPY_RULES`; `PERSONAL_DATA` as `shipment_lines` (via the order, no personal field,
`keep`).

### 3.3 What the database itself enforces (PGlite tests in `src/db/fulfilment.test.ts`, 6.4)

1. **Shipment lines.** A line belongs to a physical line of the **same order and store** as its shipment; `Σ shipment_lines.quantity` per order line ≤ the line's `quantity` (checked
   under a `FOR NO KEY UPDATE` lock of the order line); rows are **append-only** (no update, no delete); a copied order refuses them (`refuse_copied_order()`). **A non-legacy shipment
   must have at least one line**: in this run that is held by `markSent()` (the only inserter, a scan test) and by a database check that is **not** in this run's migrations (the old code,
   which records a shipment without lines, runs against the new schema until the deploy ends, and CLAUDE.md requires it to keep working): the lead adds the deferred constraint trigger
   on `shipments` in a follow-up migration pushed after the deploy (9.1), with its PGlite test written now and skipped until then.
2. **Legacy back-fill.** The rules migration sets `shipments.legacy = true` for every existing row and inserts, for every order with shipments, one `shipment_lines` row per physical line of
   the order **in its first shipment** with the line's full quantity (so "shipped units" has one reading everywhere; the later legacy parcels of such an order have no lines and are allowed
   because they are legacy). It is a single `INSERT … SELECT` in the migration, not a function.
3. **Fulfilment functions.** `commerce.line_to_send(line_id)` = `greatest(0, quantity − shipped − returned_quantity(line))` for a physical line (0 otherwise),
   `commerce.order_fulfilment(order_id)` returns the state of 1.3, and `commerce.refresh_fulfilment(store, order)` sets `status = 'fulfilled'` when the order is `paid`, has a shipment and
   nothing left to send (it never moves an order back). `STABLE`/`VOLATILE` as fits, `SET search_path = ''`, not granted to `anon`/`authenticated`.
4. **An awaiting edit stops sending**: a `shipments` insert for an order with an `awaiting_payment` edit raises `edit_pending`.
5. **Settled orders change only through an edit.** A trigger on `order_lines` refuses, for an order whose status is not `pending_payment`, an `INSERT`, a `DELETE`, and an `UPDATE` of
   `quantity`, `unit_price_minor`, `total_minor`, `tax_minor`, `tax_rate`, `discount_minor` and its parts (`member_`, `campaign_`, `bonus_`, `referral_`, `staff_discount_minor`,
   `vat_relief_minor`), `variant_id`, `sku`, `delivery`, unless `kaizen.order_edit` equals the order's id; the copy path (`commerce.copying = 'on'`) and the draw (`kaizen.drawing`, backorder
   columns only, as today) keep their own exemptions. A trigger on `orders` does the same for `subtotal_minor`, `shipping_minor`, `discount_minor` and its parts, `tax_minor`,
   `total_minor`, `edited_at` (and never for `balance_minor`, `status`, addresses and the other columns their own code writes). **Before writing this guard the foundation greps every
   writer of these columns and lists them in 3.9**; a writer outside an exemption is a finding, not something to exempt silently.
6. **Frozen triggers learn the edit context** (anchored patches of the live definitions, idempotent, raising if the anchor is gone): `orders_origin_frozen()` lets
   `staff_discount_minor` go **down** under the edit context (the label never changes); `order_lines_backorder_frozen()` lets `backorder_quantity` go **down** under the edit context (never
   `backorder_days`, never up). `orders_vat_frozen()` is **not** patched: an edit never changes the treatment (only standard orders are edited).
7. **Edits.** The lifecycle `awaiting_payment → applied | cancelled | expired` and a direct insert as `applied`; `applied` is final and its money columns, lines and documents state (once
   `issued`) never change; `seq` is the next per order under the order's lock; an applied edit has `applied_at` and, when `difference_minor < 0`, a `refund_id` of the same order (a refund
   that is `failed` is not allowed to be linked); an awaiting edit has a token hash and `expires_at` (cleared, with the hash, when it ends); a `payment_id` is a payment of the same order with
   `order_edit_id` = this edit; `order_edit_lines` are inserted with their edit and never changed or deleted; nothing is ever deleted from either table.
8. **Stock.** `draw_order_stock()` is patched to ignore reservations with `order_edit_id` (anchored patch); a new `commerce.draw_edit_stock(edit_id)` draws the edit's added units from the
   edit's own reservations (or allocates afresh when they lapsed, writing the backorder of the added line), under the level rows' locks in (variant, location) order, writing movements
   `sale` with source **`order_edit`** (the `inventory_movements_source` check and `MOVEMENT_SOURCES` widen by that value); removed units go back through `applyRestock()` as
   `order_restock` with source `order_edit`.
9. **Documents** (patches of D159's functions, each anchored, idempotent and held by `invoice-parity.test.ts`):
   (a) `invoices_kind` becomes `kind in ('order', 'order_edit')` with `(kind = 'order_edit') = (order_edit_id is not null)`; the unique `invoices_order_key` is replaced by a **partial unique
   index on `(store_id, order_id) where kind = 'order'`** and `unique (store_id, order_edit_id) where kind = 'order_edit'`;
   (b) `credit_notes_source` widens to `order_edit` with `order_edit_id` set exactly for it and `unique (store_id, order_edit_id) where source = 'order_edit'`;
   (c) **`commerce.issue_edit_documents(edit_id)`** issues, for an applied edit of an order whose original invoice exists, the edit credit note (removed units and a lower shipping charge)
   and the edit invoice (added units and a higher shipping charge), each numbered from its own gap-free series by `next_document_number()` in the same transaction, each `> 0` or not
   issued, each with a snapshot that names the original invoice; an order with no invoice because it is not invoiced (`invoice_eligibility()` not `ok`) gets none (`not_invoiced`); an order
   whose invoice is waiting gets `waiting`, and `issueWaitingInvoices()` calls it after the original is issued;
   (d) **the order's documents are one pool for credits**: a credit note from a later refund or return still names the original invoice (`invoice_id`), but the uncredited amount per VAT
   bucket that `creditAllocation()` and the cap trigger read is **Σ over the order's invoices (`order` and `order_edit`) − Σ over all its credit notes**;
   (e) `make_credit_note()` issues **nothing** for a refund with `order_edit_id` (the edit's credit note covers it) and writes the order event `credit_note.covered_by_edit` once; the
   refund of an edit payment that could not be applied (2.7) is the exception: it has no edit documents, so its credit note is the ordinary one, from the edit invoice's pool if one exists,
   else none (a payment that was never invoiced, `payment_on_invoice()`);
   (f) `payment_on_invoice()` says a payment with `order_edit_id` belongs to that edit's invoice;
   (g) `document_audit()` and `store_checkup` count an edit refund without a credit note as covered, never as `credit_note_missing`.
10. **Copied orders**: `order_edits` and `shipment_lines` refuse them; the two copied-order guard functions are **not** patched (a copied order takes no new event type).
11. **Units that will not be sent** (3.16, `20261007042008_fulfilment_unsent_closures.sql`): `unsent_closures_rules()` locks the order row and refuses a closure of more units than
    `line_to_send()` at that moment, of a line that is not physical or not of the order, of an order that is not `paid`, of a copy, while a change waits for payment, or naming another
    order's refund; the rows are append-only (`guard_unsent_closures()`); after an insert `refresh_fulfilment()` runs; `shipment_lines_rules()` also refuses a parcel holding a closed
    unit (the line's parcels hold at most `quantity − closed`); `order_edits_unsent_closed()` refuses a change of an order with a closed unit.

### 3.4 Functions and the shared reads

- `markSent()` gains `lines?: { lineId: string; quantity: number }[]` (absent = everything still to send) and returns `{ ok: true, shipment } | { ok: false, reason }` with the reasons
  `not_found`, `copied`, `unpaid`, `nothing_to_send`, `too_many` (a quantity above what is left), `not_physical`, `withdrawn_in_full`, `edit_pending`, `delivery_box_whole`, `changed`; it
  inserts the shipment and its lines and calls `refresh_fulfilment()` in one transaction. Every caller is updated to the new return shape.
- `toSend(storeId, orderIds)` (one statement for many orders, used by the order page, slips, pick list, bulk send and the AI tools) returns per line `ordered`, `shipped`, `withdrawn`,
  `toSend`, `backordered`; it and `commerce.line_to_send()` are held equal by a test.

### 3.5 Indexes

`shipment_lines (store_id, order_line_id)`; `order_edits (store_id, order_id)`, the partial unique of 3.2, `(store_id, status, expires_at) where status = 'awaiting_payment'`;
`payments (store_id, order_edit_id) where order_edit_id is not null`; `refunds (store_id, order_edit_id) where …`; `inventory_reservations (store_id, order_edit_id) where …`; the
foreign keys to `accounts` (`order_edits.made_by`) have an index.

### 3.6 Retention

`shipment_lines`, `order_edits` and `order_edit_lines` are part of the order's bookkeeping record and are kept with it (never pruned; an anonymised order keeps them: they hold no personal
data). An awaiting edit's token hash and `expires_at` are cleared when it ends. No new step in `runRetention()`.

### 3.7 What is private, what is copied, and the registers

- **`COPY_RULES`**: `shipment_lines: never` ("Which units of the original's orders went in which parcel: copied orders have no parcels"), `order_edits: never` and
  `order_edit_lines: never` ("Changes made to the original's orders: a copied order is copied as it is, without its history"). `clone_store()`, `duplicate_store()` and `copy_orders()` are
  **not** patched (copied orders carry their lines as edited and no shipments).
- **`PERSONAL_DATA`** (`src/lib/personal-data.ts`): `shipment_lines` and `order_edits`, `order_edit_lines` as `shopper` via the order, no personal field, export section `orders`, erasure
  `keep` (bookkeeping record, D162), with that reason. `EMAIL_KINDS`: `order.changed` (class `shopper`). `privacy.test.ts` holds them.
- **Nothing public**: no sitemap, `llms.txt`, structured data, feed, WordPress API or chat agent change; the change pay page is `noindex` and not listed.

### 3.8 Migrations expected (9.1)

1. `{ts}_fulfilment.sql` (generated from `schema.ts`: the columns of 3.1, the tables of 3.2, checks, foreign keys and indexes).
2. `{ts}_fulfilment_rules.sql` (custom: 3.3 points 1 to 10, the back-fill, the check widenings, the patches).
3. `{ts}_fulfilment_plan_features.sql` (the analytics-and-ai area's: three plan-comparison rows).

4. **After the deploy, by the lead**: `{ts}_shipment_lines_required.sql` (the deferred "a shipment has lines" check, 3.3 point 1, 9.1).
5. `20261007041952_unsent_closures.sql` (generated: the `unsent_closures` table of 3.2) and `20261007042008_fulfilment_unsent_closures.sql` (custom: 3.3 point 11), added by
   the review fix of 3.16, pushed with the rest of this run (they only add).

Stamps must sort after `20261006185225_orders_ops_fix_rules.sql`.

### 3.9 As built

Each area appends a paragraph here after its work ("3.10 As built by the foundation", "3.11 … by the server area", and so on) listing every deviation from this file and every addition; a
paragraph changes the text above it.

### 3.10 As built by the foundation

Files: `src/db/schema.ts` (3.1, 3.2), `supabase/migrations/20261006235329_fulfilment.sql` (generated) and `20261006235336_fulfilment_rules.sql` (custom), `src/lib/fulfilment-limits.ts`,
`fulfilment.ts`, `pick-list.ts`, `order-edit.ts`, `order-edit-status.ts`, the edit oracles in `invoice-snapshot.ts` (`buildEditInvoiceSnapshot()`) and `credit-allocation.ts`
(`editCreditNote()`, `pooledBuckets()`, `creditNoteSnapshot({ others })`), `MOVEMENT_SOURCES` (`order_edit`), `order-ops-events.ts` (`FULFILMENT_EVENTS`, `FULFILMENT_AUDIT_ACTIONS`),
`COPY_RULES`, `PERSONAL_DATA`/`EMAIL_KINDS` (`order.changed`), the words (`m.fulfilment`, `m.slip`, `m.orderChange`, `emailText().orderChanged`, `emailText().shippedPart`,
`editDocumentText()` in `invoice-text.ts`), `HAND_WRITTEN_ONLY`; tests `src/db/fulfilment.test.ts` (PGlite, every point of 3.3), the edit fixtures in `src/db/invoice-parity.test.ts`
(both documents and a pooled refund held equal to the oracles), `src/db/order-edit-fixture.ts` (a change written as `applyOrderEdit()` will write it), and unit tests of every library.
Deviations and additions, each changing the text above:

1. **The settled-order guard (3.3 point 5) applies to orders that were paid** (`commerce.order_settled()`: not `pending_payment`, not a copy, and an `order.paid` event exists, which every
   path that pays writes), not to every order whose status is not `pending_payment`. Many test fixtures write orders straight into `paid` without a payment and then their lines; those are
   not orders the application makes, and the rule is unchanged for every real order. `vat_relief_minor` is left out of the **orders** guard (it is frozen after payment by
   `orders_vat_frozen()` already, whose message other tests expect); it stays in the lines' guard. The guard also refuses moving a paid order's line to another order and freezes
   `order_lines.order_edit_id`; a line inserted with an `order_edit_id` must name a change of its own order. **The grep of writers (3.3 point 5):** no application code writes a guarded
   column of a paid order (`placeOrder()`, the renewal and `placeDraftOrder()` write lines while the order is `pending_payment`; `copy_orders()` runs under `commerce.copying`; the draw
   writes only backorder columns; `analytics-settings.ts` writes `unit_cost_minor`, not guarded; `updateOrderContact()`, `cancelOrder()`, `markSent()`, `markBalancePaid()` and the
   webhooks write no guarded column). **Findings in other areas' tests**, which now meet the guard: `src/server/returns.int.test.ts` (`update commerce.order_lines set delivery = 'digital'`
   on a paid order, to make a download line) and `src/server/order-export.int.test.ts` (`set title = …, sku = …` on a paid order's line, to test formula escaping): the foundation
   changed each, in place, to run its update inside a transaction with `set_config('kaizen.order_edit', <order id>, true)` (a test may; the scan of 6.4 (a) is of application code), and
   both pass. `tax-reports.int.test.ts` already uses `session_replication_role = replica` and is not affected. With these two, every integration test passed against a database with the
   new migrations (2,811 tests), and every unit and PGlite test.
2. **The pay token's hash is kept when a change ends** (3.3 point 7, 3.6 and 2.6 said it is cleared): the change pay page must tell an *expired*, *cancelled* or *paid* link from an unknown
   one (2.4's states, e2e `order-change.spec.ts`), as D173's drafts keep theirs. The hash is not personal data; `expires_at` stays too. While a change waits, both may be replaced
   (*Send again* makes a new token); after it ends neither changes.
3. **A fifth documents state, `in_original`**: when the order's own invoice was waiting and is issued after a change was applied, it is built from the order as changed, so the change needs no
   documents of its own (issuing them would count the change twice). `make_edit_documents()` sets `in_original` when the order's invoice was issued after `applied_at`;
   `payment_on_invoice()` then counts the change's payment on the order's invoice. `ORDER_EDIT_DOCUMENTS` and the check list it.
4. **Edit documents in SQL**: `commerce.make_edit_documents(store, edit)` (raises) and `commerce.issue_edit_documents(store, edit)` (catches everything, leaves `waiting`, writes
   `invoice.failed` with `data.edit` at most once an hour) take the store as well as the edit; `issue_waiting_invoices()` issues waiting change documents after the orders' own invoices and
   before missing credit notes. The pool is `commerce.order_buckets_left(store, order)`. `make_credit_note()`, `document_insert_guard()`, `payment_on_invoice()`, `waiting_invoices()`,
   `issue_missing_credit_notes()` and `issue_waiting_invoices()` were defined once (20261004125337) and never patched, so they are **replaced whole** (`CREATE OR REPLACE`) rather than
   patched by anchors; `make_order_invoice()`, `orders_origin_frozen()`, `order_lines_backorder_frozen()`, `draw_order_stock()` and `record_inventory_movement()` (its own list of sources,
   which would have recorded `order_edit` as `system`) are patched by anchors. A change's credit note credits each removed unit at the rate and basis its invoice line had, a lower shipping
   charge by the shipping VAT the change moved (`tax_delta` less the lines' VAT moved), clamped per bucket to what the pool left (an adjustment row and `credit_capped` when it does not fit);
   its VAT in other currencies is at the **original** invoice's rate. The additional invoice's VAT in the seller's currency is at the rates of its own day (a supply of its own); a missing rate
   makes the change's documents wait. **Known imprecision:** after a change, the VAT in the seller's currency of later credit notes is converted cumulatively over the pool at the original
   invoice's rate, so it can differ by a minor unit from the sum of the order's invoices' own conversions; the document amounts themselves are exact.
5. **The deferred check of a change's money** (`order_edits_settled()`): an applied change with a higher total needs a **captured** payment of exactly the difference naming it; one with a
   lower total a refund that did not fail of exactly the difference naming it. The money rows name the change (`order_edit_money_ref()`: same order) and the change names them once.
6. **Edits on the database's side** also refuse, on insert: a store that is not open, an order that is not `paid`, has any shipment, is a host's, a copy or not `standard` VAT, a currency other
   than the order's, and a 21st change. `seq` is given by the trigger when left null. A change's lines must be written in the transaction that made it (`created_at = now()`), and an added
   line's `order_line_id` is written once, when the change is applied.
7. **Stock**: `draw_edit_stock(edit)` draws the change's holds, then free stock, then backorders (or reports units short for a variant that stops at zero: the server refuses the change
   then); a reservation with `order_edit_id` must also name its order. Removed units are taken off a line's backorder first (`splitLine()`: the customer waits for fewer units).
8. **Pure libraries**: `priceOrderEdit()` gives the whole order to the injected tax decision (kept lines at their kept totals, added lines, the shipping after), so a change cannot turn a
   standard order into IOSS by looking at the added goods alone; `money` is `charge`/`refund`/`none` and `mustNotify` is true for a higher total or anything taken off. `editBlock()`
   reads `fulfilled` or any parcel as `sent`; `moneyBlock()` is separate (`payments_off`, `test_mode` only matter when money moves through Stripe).
9. **Not done here**: the "a non-legacy shipment has lines" deferred trigger (the follow-up migration of 9.1; its PGlite test is written and skipped); `store_checkup`'s count of edit refunds
   (server code, `src/server/invoices.ts`); the `OrderDocumentView` words for `settled_by_order`, `reason.kind = 'order_edit'` and `invoiceKind = 'order_edit'` (the words exist in
   `editDocumentText()`; drawing them is the view's area).

### 3.11 As built by the server area

Files: `src/server/order-edits.ts` (`previewOrderEdit()`, `applyOrderEdit()`, `sendOrderEdit()`/`shareOrderEditLink()`, `resendOrderEdit()`, `cancelOrderEdit()`/`endOrderEdit()`,
`recordEditPaidOutside()`, `completeEditPayment()`, `markEditSessionEnded()`, `expireOrderEdits()`, `cancelEditsForWithdrawal()`, `cancelEditsForClosure()`, `orderEditability()`,
`getOrderEdit()`), `order-edit-pay.ts` (`changePageFor()`, `startEditPayment()`), `order-edit-emails.ts` (`sendOrderChanged()`, `sendOrderChangePayLink()`), `fulfilment.ts`, `pick-list.ts`
(`pickListData()`, `ordersToSend()`), `src/lib/order-edit-input.ts` (`orderEditInput`, `editPaidOutsideInput`), and the changes of 5.2. Deviations and additions, each changing the text above:

1. **One writer, named `writeEdit()`** (private in `order-edits.ts`): it alone sets `kaizen.order_edit`; `applyOrderEdit()`, `recordEditPaidOutside()` and `completeEditPayment()` reach it
   (`order-edit-writers.scan.test.ts` holds that no other module sets the context, inserts a change or inserts a shipment). A change paid outside Kaizen at creation is written waiting
   for a moment and applied in the same transaction (one path for every payment of a change). `applyOrderEdit()` refuses a higher total (`needs_payment`).
2. **A lower total**: `refundOrder()` gained `paymentId` and `whileEditPending` options; the change is written inside its `inTransaction` hook (the refund row first, then the change, then
   `refunds.order_edit_id` and `order_edits.refund_id`). Stripe is asked before the transaction (as for every refund): if the transaction then fails (the order moved in that instant, or a
   variant that stops at zero ran out), Stripe has refunded and Kaizen recorded nothing; the webhook adopts the refund as a refund made in Stripe. The base and the stock are checked before
   Stripe is called, so this needs two staff acting in the same second. **Known risk, not closed.**
3. **The pay token's hash is base64url SHA-256** (the check `order_edits_token`), not D173's hex; `hashEditToken()`. The Stripe session's `cancel_url` holds the pay page's address with its
   token, as D173's drafts do; the metadata never does.
4. **`edit=pending` is `ship=edit_pending`**, and `partly_sent` joins the fulfilment filters (`SHIP_FILTERS`), so no new address key was needed; the list row gains `edited` and `editPending`
   and the ship cell `partly_sent`. The admin's filter bar got the two labels (one-line edit in `filter-bar.tsx`).
5. **Skip reasons**: slips use the existing bulk reasons `already_sent` and `withdrawn_in_full` (not a new `withdrawn`); the pick list is a bulk action `print_pick_list` (`orders:read`, 100).
   `packingSlipData(storeId, ids, { reprint })` prints the remainder; the order's own slip page is to pass `reprint: true` (admin area); `parcelSlipData(storeId, orderId, shipmentId)` is a parcel's slip.
6. **A physical line has a variant** (the foundation's rule): the D173 test fixture `order-ops-fixture.ts` now gives its goods lines a variant, and its `tracking` shipment is `legacy`.
7. **Withdrawals**: `writeConfirmation()` cancels a waiting change and calls `refreshFulfilment()` in the confirmation's transaction; any withdrawal request (even one never confirmed, whose
   lines are referenced) blocks an edit as `return` (deleting a line it names would fail its foreign key).
8. **Receipt**: `markDelivered()` refuses a `paid` (partly sent) order with code `not_sent_in_full`. A later parcel can no longer reopen a receipt (nothing is left to send once it is
   `fulfilled`); the reopening code is kept and `returns-fixes.int.test.ts`'s case was rewritten to hold the new rule.
9. **Documents**: `getOrderDocuments()` gains `additionalInvoices`; `invoice-emails.ts` gains `{ ofEdit }`; every reader of an order's own invoice picks `kind = 'order'`; edit refunds count as
   covered (`credit_note.covered_by_edit`) in the waiting list and the five-minute job, which also picks up stores with waiting change documents.
10. **Owed** (4.7) is `least(backorder_quantity, line_to_send)` in `inventory.ts`, `stock-tools.ts`, `orders.ts` and the list; `analytics-sql.ts`'s `OWED_LINE`, `control-center.ts` and
    `owner-insights.ts` are the analytics area's and still count every backordered unit of a paid order.
11. **Audit**: the edit functions write their own audit entries (`order.edit_applied`, `order.edit_sent`, `order.edit_cancelled`, `order.edit_paid_outside`); the admin's actions must not
    write them again. `order.sent_part` is the send action's (`markSent()` writes none).
12. **Tests**: the euro scenario and the draft-made order with a staff discount are in `order-edit.int.test.ts` (not `checkout-kinds.int.test.ts`); `order-edit-pay.int.test.ts` and
    `order-edit-documents.int.test.ts` are sections of that file; `fulfilment.int.test.ts`, `packing-slips.int.test.ts`, `pick-list.int.test.ts` are as named.

### 3.12 As built by the shopper area

Files: `src/components/order-shipments.tsx` (`OrderShipments`, server-rendered, imports only types) and its view test; `order/[orderId]/order-section.tsx` and My account's order page draw it (the
account page's old list of shipments is replaced by it); `account/change/[token]/` (`page.tsx`, `actions.ts` with `startEditPaymentAction`, `change-view.tsx`, `change-form.tsx`,
`change-view.test.ts`); `src/lib/pay-routes.ts` (`isChangeLinkPath()`, part of `isNoExtrasPath()`) and its two tests; e2e `order-change.spec.ts`, `partial-shipment.spec.ts` and their rows
`e2e/fulfilment-fixtures.ts` (written with SQL as the server writes them; checked against a seeded database). Deviations and additions, each changing the text above:

1. **A new order piece, `order_parcels`** (D117: a key in `STORE_PIECES`, `OrderParcels` in the section, a case in `StorePartSection`, a place in the order starter beside the bookings),
   so a store's own order page built from pieces can show the parcels too. A store page saved before this run has no such piece and shows no parcels until the owner adds it.
2. **The order page reads the parcels only for a paid order with goods** (`order.ships`), and `OrderShipments` draws nothing before the first parcel; a legacy parcel shows carrier and
   tracking only. A tracking address is linked only when it is an `http(s)` address.
3. **The receipt sentence** (`m.fulfilment.receipt`) is shown only when the goods come in more than one parcel (or some are still to come) and never to a business buyer (no statutory
   right); the same rule hides the added goods' withdrawal sentence on the change page for a business buyer.
4. **The pay button's problems** (`processing`, `payment_error`, `limit`) are said with `m.orderChange.startFailed`; `paid`, `ended`, `payments_off`, `too_small` and `not_found` redraw the page.

### 3.13 As built by the admin area

Files: the order page (`orders/[orderId]/page.tsx`: the *Send* card, the parcels, *Change the items*, the history's words), `orders/actions.ts` (`sendOrderAction` reads the parcel,
`resendShippedAction`), `orders/[orderId]/edit/` (`page.tsx`, `actions.ts`, `loading.tsx`), `orders/[orderId]/packing-slip/page.tsx` (`?shipment=`, the reprint), `orders/pick-list/`
(`page.tsx`, `loading.tsx`), the carrier booking actions (`bring-actions.ts`, `porterbuddy-actions.ts`, `helthjem-actions.ts` take `lines`); components in `src/components/admin/orders/`
(`send-parcel.tsx`, `shipment-list.tsx`, `parcel-buttons.tsx`, `parcel-choice.tsx`, `order-edit-card.tsx`, `order-edit-editor.tsx`, `order-edit-parts.tsx`, `order-edit-summary.tsx`,
`pick-list-view.tsx`), `bring-booking.tsx` and `chosen-delivery-booking.tsx` (the parcel choice), the list's bulk bar and badges (`order-table.tsx`), `order-returns-card.tsx` (no receipt
while partly sent); pure `src/lib/parcel-form.ts` (`parcelLinesFromForm()`, `parcelLinesFromChoice()`, `unitsInChoice()`), `parcel-input.ts` (the actions' zod), `order-edit-form.ts`
(the editor's state to `orderEditInput`'s shape), `order-edit-view.ts` (`editSummaryView()`: the server's preview as rows, nothing priced), `fulfilment-events-text.ts` (the history's words);
`admin-map.ts` (`order.edit`, `orders.pick-list`, wider `order`, `orders`, `order.packing-slip`, `orders.packing-slips`). Tests: `src/lib/order-edit-view.test.ts`,
`src/components/admin/orders/fulfilment-views.test.ts`, `pick-list-view.test.ts`, `packing-slip-views.test.ts` (extended). Deviations and additions, each changing the text above:

1. **`EVENT_LABELS`** spreads `FULFILMENT_EVENT_LABELS`; `order.sent` and the change events are worded by `fulfilmentEventText()` (counts, labels, amounts, the method and `data.note` only).
   `permissions.baseline.json` needed no change: every new page and action asks `requirePermission()`/`checkPermission()` with `orders:read` or `orders:write`.
2. **The edit page opens with `orders:read`** (as every page of the orders section) and says that changing needs the right to change orders; every action asks `orders:write`. Recording money
   outside Kaizen is offered only when `mayRecordOutsidePayment()` says so, and the server checks it again.
3. **The order page shows *Change the items* for every order**, with `editBlockText()`'s reason for a copied, unpaid, sent or otherwise blocked one.
4. **Carrier bookings** take the same *In this parcel* choice (a controlled form; nothing lowered = everything still to send, so the old meaning holds) and are offered only while units are
   left to send and no change waits. **The weight is still the whole order's** (`estimateWeightGrams()` takes no lines): the form says to weigh a parcel that holds part of the order. A
   per-line weight is the server area's, if wanted.
5. **No store Home or control-center figure was added** here: 5.5 gives *Orders partly sent* and *changes waiting for payment* to the analytics-and-ai area.

---

### 3.14 As built by the analytics-and-ai area

Files: `docs/analytics.md` (rows *Refunds*, *Edited order*, *Owed*, *Reconciliation*, section *Order changes and parcels*), `docs/wave-2-data.md` 4.2 (an *As built* note),
`src/server/analytics-sql.ts` (`NOT_EDIT_REFUND`, `OWED_UNITS`), every refund reader of the analytics and the AI manager (`analytics-totals.ts`, `analytics-refunds-data.ts`,
`analytics-customers-data.ts`, `analytics-insights.ts`, `analytics-products-data.ts`, `owner-tools.ts`' `sales_summary`, `tax-reconciliation.ts`' refunds line), the owed readers
(`analytics-inventory-data.ts`, `owner-insights.ts`, `control-center.ts`), `src/lib/tax-reconciliation.ts` and `src/server/tax-reconciliation.ts`, `src/lib/analytics-finance.ts` (the
Finance note), `src/lib/control-center.ts` and `src/server/control-center.ts`, `src/lib/order-csv.ts` and `src/server/order-export.ts`, the AI manager (`owner-tools.ts` both,
`owner-tool-permissions.ts`, `manager-tools.ts`' `TOOL_WORDS`, `assistant-skills.ts`), the migration `20261007022211_fulfilment_plan_features.sql`, and the tests
`src/server/analytics-edits.int.test.ts`, `src/db/fulfilment-plan-features.test.ts`, `src/lib/fulfilment-tools.test.ts`, and new cases in `control-center.test.ts`,
`tax-reconciliation.test.ts`, `order-csv.test.ts`. Deviations and additions, each changing the text above:

1. **The reconciliation's new cause is four causes**, not one (4.7 said "changed by an edit in another period"): `edit_in` (an additional invoice dated in the period of an order
   placed in another, added), `edit_out` (one of this period's orders dated in another, taken away), `edit_credited` (added: Finance reads the order after the change, so the VAT a
   change removed is already out of Finance's figure, while the report's *VAT charged* never subtracts a credit note, which is in *VAT credited*; this cause appears even when the
   order and the change are in the same period) and `edit_waiting` (a change whose documents wait, by its `tax_delta`, which can be below zero). Finance's side of an edited order is
   split into its original invoice's part (the order's VAT less what its changes moved) and each change's documents, so each part bridges on its own; a residual is never hidden and
   says *Does not reconcile*. The Finance and invoice reads of the reconciliation now join only `invoices.kind = 'order'` for the order's own invoice (they would have counted an
   edited order twice). The report side counts distinct orders per cause.
2. **The order file's `refunded`** (and `refund_count`, `last_refund_at`, `refunded_main`) leaves the refund of a change's lower total out, as the analytics do (the total is already the
   changed one); `invoice_number` is the order's own invoice (`kind = 'order'`). `fulfilment` and `edited` are in both profiles, after `gift_order`.
3. **`analytics-returns-data.ts` needed no change**: the Returns figures read `returns`, never `refunds`, and a change is refused while the order has a return (4.4).
4. **The control center** counts a partly sent order's age from its **first parcel** (`oldestFirstParcelAt`), not from the placing; neither item is urgent (the orders are already in
   *waiting to be sent*). `EDIT_EXPIRING_DAYS` = 2 (`src/lib/control-center.ts`).
5. **`get_order`** adds `sending`, `still_to_send` (with the backordered part, `min(backorder, to send)`), each parcel's `contents` (a legacy parcel says so), and `changes` (label,
   made, status, reason, totals before and after, the difference in words, `pay_by` while waiting, `applied`); never staff's note and never who made it. **`pick_list`** takes order
   numbers or ids (unknown ones and another store's are *Not found*), or none for `ordersToSend()`, and returns the store's sums and a printable address of the Pick list page.
   `mark_order_sent`'s description now says it sends everything still to send (`markSent()` without lines); sending part of an order stays on the order's page.
6. **Plan comparison rows** are at positions 395 to 397 as specified; they quote `EDIT_PAY_DAYS` and `PICK_LIST_MAX`, and the test holds the numbers to the code.

### 3.15 As built by the review fixes

The adversarial review found ten problems; each was fixed at its cause, with a regression test (`src/server/order-edit-review-fixes.int.test.ts`, the reviewers' own
`order-edit-double-refund.int.test.ts` and `order-edit-money-review.int.test.ts`, `src/components/documents/order-document-view-edit.test.ts`, `src/lib/refund-split.test.ts`, a
new case in `src/db/fulfilment.test.ts`). Deviations and additions, each changing the text above:

1. **A change's documents are drawn as what they are** (`OrderDocumentView`): an additional invoice is titled *Additional invoice*, refers to the original with its date
   (`editDocumentText().amendsOf()`) and names the change; `settled_by_order` reads "Settled against the payment for invoice F-17", never "to pay at the venue"; its supply date is
   always printed, and its payment day is its supply date (`make_edit_documents()` dates the supply by the day the change was applied with its captured payment, or the
   day money recorded outside Kaizen was received), never the order's first payment day, so the snapshot needed no new field. A change's credit note gives the change as its
   reason and calls its rows *Removed from the order* and *Lower shipping charge*, never *Refund*, *Returned goods* or *Shipping refunded*. New words (`amendsOf`,
   `removedRow`, `shippingLoweredRow`, `supplyDatePaid`, `supplyDateSettled`) are hand-written in nb, sv, da and en (section 8 item 5).
2. **The pay-link email proposes the change** (CRD Art. 22): `emailText().orderChanged.proposedSubject`, `proposedHeading`, `proposedIntro`, `proposedRemoved`, `proposedAdded`,
   `proposedReasons`; "has been changed" is said only by the email of an applied change. `m.orderChange.intro` says the store *proposes* a change and nothing has changed yet.
3. **A business buyer is never told of a statutory right of withdrawal**: the parcel email's receipt sentence and the change emails' withdrawal sentence are left out when
   the order has a company (`withdrawBlocks()`'s rule), as the order page and the change page already did.
4. **The added goods' withdrawal sentence counts from the last parcel of the order** (2.4, CRD Art. 9(2)(b)) in the email and on the pay page, in all four languages.
5. **A lower total is written, checked and refunded in ONE transaction, in that order** (`refundChange()` in `order-edits.ts`, replacing 3.11 item 2's "known risk"): the
   change is written under the order's row lock first (base, eligibility, the added units drawn, the units taken off put back, the documents), then Stripe is asked (the
   change's own key), then the refund is recorded in a savepoint of the same transaction (`refundOrder(..., { within: tx })`) and named by the change. A second press of the
   same change waits for the lock and finds the order moved; a stock shortage refuses before Stripe is asked; a refund Stripe refuses or answers `failed` rolls everything back.
   The row lock is held while Stripe answers. What is left: the database failing between Stripe's answer and the commit, which the webhook records as a refund made in Stripe.
6. **A refund is split over the order's captured payments** (`splitRefund()`, `src/lib/refund-split.ts`): each payment gives back at most what it took less its refunds that did
   not fail, in the order the payments were made (the order's own first), one refund (and one Stripe call, with its own key: the caller's for the first part, the same key and
   the payment for the others) per payment. Cancelling an order with a paid change, a large goodwill refund, a D153 return and a later lower-total change all reach the change's
   payment. If Stripe refuses a later part after an earlier one went back, what went back is recorded as a refund of the order and staff are told. `inTransaction` gets
   `refundIds`; a change's lower total may be several refunds: they all name the change, the change names the first, and `order_edits_settled()` holds their SUM to the
   difference; `make_credit_note()` treats every refund that names an applied lower-total change as covered (not only `order_edits.refund_id`).
7. **A change's payment that was never applied is not the order's money** (`commerce.payment_of_order()`): `bonus_refund_applied()` and `affiliate_refund_applied()` (anchored
   patches) move nothing for its refund and leave it and its refunds out of the paid and refunded shares.
8. **Cash for a change is held to the country's cash ceiling** (D173's `checkCash()`, `cashLimitInCurrency()` exported from `draft-orders.ts`): the amount checked is the
   ORDER's cash for the transaction (every captured cash payment of the order recorded outside Kaizen plus the change's difference), under the order's lock, in both the waiting
   and the new-change path; `refuse` answers `cash_limit`, `warn` records with a notice. (Decision: a change belongs to its order's sale; the reading of "one transaction" is
   for the legal review, section 8.)
9. **A change refund that fails after the change was applied on `pending`** writes `order.edit_refund_failed` once (`applyStripeRefund()`); what the customer is still owed
   (`EDIT_REFUND_OWED_SQL`, `src/server/edit-refund-owed.ts`: the difference less the change's refunds that did not fail and the order's ordinary refunds made after the
   failure) is shown on the order page (an alert on the change card, `OrderEditSummary.refundOwedMinor`) and in the store checkup (`invoiceCheckupFindings()`, code
   `edit_refund_failed`, read by the AI manager's `store_checkup`). **Not done:** no control-center item (the checkup and the order page carry it).
10. **Units to send subtract withdrawals only** (`commerce.withdrawn_quantity()`: accepted units on returns of kind `withdrawal` not declined or cancelled), in
    `line_to_send()`, `toSend()`'s `withdrawn` and `withdrawnInFull()`. A return of kind `return` (voluntary or business, of goods received) no longer takes units off what is
    still to send, so it can never strand a partly sent order. 1.3's *Withdrawn units* is this function, not `returned_quantity()`.
11. **The change's pay link has a euro scenario** (`order-edit-review-fixes.int.test.ts`): an EUR order, the link in its own view (`no-eur`), the session opened under `no` and
    `no-eur` alike is in euros for exactly the difference, and the order and the additional invoice after payment are in euros. No code change was needed.

### 3.16 Closing units that will not be sent

A reviewer found that a partly sent order could be neither cancelled nor changed, that both refusals told staff to refund what was not sent instead, and that doing so left
the refunded units "to send": the order stayed *Partly sent*, its packing slip and the pick list printed them, bulk *Mark as sent* recorded a second parcel of them (both back in
stock and "sent"), and without that parcel the order never became *Sent*, so the receipt (D153) could never be recorded. Units to send could not be told apart from units
refunded and restocked, because a restock alone does not say whether a unit was never sent or was sent and came back. So the units that will not be sent are an **explicit
record**, `commerce.unsent_closures` (3.2, 3.3 point 11), never a guess from stock movements:

- **Units to send** = `max(0, quantity − shipped − withdrawn − closed)`, in `commerce.line_to_send()` (replaced with the same signature, so every reader follows: the order page's
  Send card, `packingSlipData()`, `pickListData()`, bulk *Mark as sent*, `markSent()`, the shipped email's "still to come", the backorder counts) and in `unitsToSend()`/`toSend()`
  (`closed` on `FulfilmentLine` and `ToSendLine`, read from `commerce.closed_quantity()`); `src/db/fulfilment.test.ts` holds the SQL and the code equal, the property test included.
  `OrderFulfilment.basis` carries the closed units too, so a parcel form that saw the order before a closure is refused as `changed`.
- **The only writer** is `refundOrder()` with `RefundInput.notSent`: each restocked unit of a physical line is first taken from that line's units still to send
  (`min(restocked, line_to_send)`), written with the refund's id (null when nothing was refunded, or when Stripe answered `failed`: the stock went back all the same) and the staff
  account, inside the transaction that writes the refund (`writeRefunds()` → `closeUnsent()`), under the order's row lock, and every condition the trigger holds is read there first
  so it never refuses after the money moved. One order event `order.unsent_closed` (`FULFILMENT_EVENTS.unsentClosed`: `{ units, lines: [{ lineId, sku, title, quantity }], refundId }`)
  and one audit entry `order.unsent_closed` (units and refund id, area `orders`) record it. A restock without the tick is stock going back and nothing more, as before.
- **The form**: the order page's Refund card shows *These units were not sent: take them off what is still to send*, ticked by default, whenever the order is `paid` and has units
  still to send and something can be put back (`RefundForm` `unitsToSend`, `refundOrderAction` reads `notSent=on`). A refund of 0 with a restock is allowed, so the same form
  closes units that will not be sent without money. `cancelOrder()`'s refusal for a partly sent order (`PARTLY_SENT_CANCEL`) and `EDIT_BLOCKS.sent` point at it.
- **States.** A partly sent order whose last units are closed becomes `fulfilled` (*Sent*) in the closure's own transaction (the table's after-insert trigger calls
  `refresh_fulfilment()`), so the receipt can be recorded. An order with **nothing sent** and nothing left because units were closed has the new state **`closed`** (*Will not be
  sent*; `withdrawn` stays "nothing sent, nothing left, and nothing closed"): it stays `paid` like an order withdrawn in full (cancelling is the way to end an unsent order), the bulk
  send and the slips skip it as `nothing_to_send`, and the order page says why. Words: `FULFILMENT_STATE_LABELS.closed` and `m.fulfilment.states.closed` (nb *Sendes ikke*, sv
  *Skickas inte*, da *Sendes ikke*, en *Will not be sent*; the shopper's parcel section is drawn only with a parcel, so a shopper sees it only in the order file's
  `fulfilment` column).
- **Changes.** An order with a closed unit cannot be changed (`editBlock()` reason `unsent_closed`, and `order_edits_unsent_closed()` in the database): its lines are no longer
  as sold.
- **Withdrawals.** A withdrawal takes unsent units first (4.2), but never a closed one: `NOTHING_SENT_SQL` and `unitsToSendBack()` (`closedBefore`) count the units in
  parcels **and** the units closed before the withdrawal was confirmed, so "1 of 3 sent, 2 closed, withdrew 1" asks the sent unit back instead of refunding it as never sent.
- **Tests**: `src/db/fulfilment.test.ts` ("units that will not be sent": lowers `line_to_send()`, refuses more than is left and every other case, append-only, serialised, refreshes
  to fulfilled, the `closed` state, a parcel never holds a closed unit, and the property test closes units at random); `src/server/unsent-closures.int.test.ts` (in kroner and in a
  euro view: 3 bought, 1 sent, 2 refunded with restock and *not sent* → Sent, slips, the pick list and bulk send leave them out, the receipt is recorded; without the tick they stay
  to send; 1 of 3 closed on an unsent order, then 2 sent → Sent; everything closed → `closed`; another store's order or line is refused by the refund and by the table's rules;
  a withdrawal after a closure asks the sent unit back); unit and view tests of the state, the slip skip, the edit block, the event's words,
  the Send card and the checkbox.
- **Not done**: units closed and then withdrawn (D153) could be refunded twice in principle (the withdrawal's refund does not know they were refunded); `refundOrder()` caps the
  total at what was paid, but the withdrawal refund of such a unit is for the legal review and the lead. An unsent order closed in full stays in the *To send* list filter, which reads
  `status = 'paid'` (as an order withdrawn in full already did).

## 4. Rules and law

### 4.1 Limits and constants (`src/lib/fulfilment-limits.ts`; a unit test pins every number)

| Constant | Value | Source |
|---|---|---|
| `EDIT_PAY_DAYS` | 7 | Kaizen's own (D173's draft default; Shopify does not say) |
| `EDIT_ADDED_LINES_MAX` | 50 per edit | Kaizen's own |
| `EDIT_QUANTITY_MAX` | 9,999 per added line | D173's draft limit |
| `EDITS_PER_ORDER_MAX` | 20 | Kaizen's own (an abuse and sanity brake) |
| `EDIT_NOTE_MAX` | 500 characters | Kaizen's own |
| `EDIT_PAY_PRESSES_PER_HOUR` | 20 per edit, 600 per store | D173's pay-link limits (`chat_usage` buckets `edit:pay:{id}`, `edit:pay`) |
| `EDIT_SENDS_PER_DAY` | 5 per edit | D173's draft limit (`edit:send:{id}`) |
| `PICK_LIST_MAX`, slips | 100 orders (`BULK_PRINT_MAX`) | D173 (Shopify's Order Printer prints 50) |

### 4.2 Sending in parts

- **Units to send** of a physical line = `max(0, quantity − shipped − withdrawn − closed)` (closed: 3.16). Withdrawn units are **taken from the unsent units first**: a withdrawal of units of a line that is
  partly sent removes unsent units before it asks for shipped ones back.
- **D153 refined** (`NOTHING_SENT_SQL`, server area, held by `returns.int.test.ts` cases): a withdrawal return has **nothing to send back** when, for each of its lines, the units of the
  counting withdrawal returns of that line made up to and including it are at most the line's quantity less the units of that line in shipments made before its confirmation (legacy
  shipments count as every unit). So "withdrew 1 of 3, 1 sent" has nothing to send back and is refunded at once (Art. 13(3) lets the store wait only for goods it sent); "withdrew 2 of 3, 2
  sent" has one unit to send back. `withdrawnInFull()` reads the same: every unit withdrawn and nothing shipped.
- **State.** The order is `paid` while units are to send and becomes `fulfilled` in the transaction that leaves none (`refresh_fulfilment()`, called after a parcel and after a confirmed
  withdrawal; an edit never needs it, since an edited order has nothing sent).
- **Receipt.** CRD Art. 9(2)(b): "in the case of multiple goods ordered by the consumer in one order and delivered separately, the day on which the consumer … acquires physical
  possession of the last good" (https://www.legislation.gov.uk/eudr/2011/83/article/9, read 2026-10-06). So `markDelivered()` needs the order `fulfilled` (`not_sent_in_full`), and a later
  parcel still reopens a recorded receipt.
- **Bulk send** sends everything still to send as one parcel; a backordered remainder is refused as `waiting_for_stock` (sent in parts by hand).

### 4.3 Pricing an edit (`priceOrderEdit()`, pure, `src/lib/order-edit.ts`; BigInt, half up only where the checkout rounds)

1. **Kept units.** A line going from `Q` to `q` units (`0 < q < Q`) keeps its `unit_price_minor` and `tax_rate`; its **kept total** is `paidForUnits(total, Q, q)` (D153's cumulative
   floor: the first `q` units carry `floor(total × q / Q)`, the odd minor units stay with the units removed), its **kept tax** `paidForUnits(tax, Q, q)` by the same rule, its kept discount
   `unit_price × q − kept total`, and each discount part (member, campaign, bonus, referral, staff, relief 0) is shared over the kept discount by the largest-remainder rule
   (`shareAmount()`, D173) in proportion to the part, never above it, so the line's checks hold. **Removed** = before − kept, column by column, so kept + removed is exactly the line as
   sold. A line removed entirely (`q = 0`) is removed with all its columns. A free gift line (D114, `order_lines.gift`) may be removed (its value is 0, nothing is refunded) and is never
   removed automatically when its campaign's condition stops holding (the screen says so).
2. **Added units** are a **new line** (a kept line never grows): `unit_price_minor` = the market's list price **as shown** in the order's view (`shown()`), or the custom price staff type
   (`0` to `DRAFT_PRICE_MAX_MINOR`); `discount_minor = 0`; the VAT is decided by `decideTax(loadTaxFacts(order's market and buyer), basket of the added lines)`, the function `cartSummary()` and
   `placeOrder()` call, with the rate `commerce.vat_rate(country, products.vat_category)` **of the day of the edit** (a new supply); the decision must be `standard` (a different decision,
   such as IOSS by the consignment's new value, refuses with `vat_changed`). The line freezes the variant's measure (D160) and its backorder (D172) as `placeOrder()` does.
   **Equivalence (the heart of criterion 1):** the added lines priced at list price equal, line for line, the unit price, line total and VAT that `cartSummary()` gives a cart of the same goods
   in the same market with no code, campaign, group discount or credit, in kroner and in a euro view (`order-edit.int.test.ts`).
3. **Shipping.** *Keep*: unchanged. *Set*: the new `shipping_minor` (VAT included); its VAT at the order's frozen `shipping_tax_rate` (`vatIncluded()`). Refused (`shipping_discounted`) when
   the order has a shipping discount (`discount_minor > Σ lines' discount_minor`), because the free-shipping part of a code cannot be re-judged without re-running the code. The screen shows
   what the market's rate would be for the edited basket (`basketShipping()` on goods before discounts, as checkout judges it) as a hint only.
4. **The order after**: `subtotal` += Σ added goods − Σ removed goods (unit × units); `discount_minor` and each part −= Σ removed parts; `tax_minor` = Σ lines' tax (kept and added) + the
   shipping's VAT (unchanged when kept); `shipping_minor` as chosen; `total = subtotal + shipping − discount` (the database's `orders_total_adds_up`). `Δ = total after − total before`.
5. **Problems** (codes and words in `ORDER_EDIT_PROBLEMS`): nothing changes (`no_change`), a kept line raised (`only_down`), every line removed (`nothing_left`: cancel the order instead), a
   total of 0 (`total_zero`), too many added lines, an invalid quantity or price, a variant not sellable in the market, a stock shortage, shipping refused, `vat_changed`, and the
   eligibility reasons of 4.4.

### 4.4 Which orders can be edited (`editBlock(order)`, pure, and the server's check under the lock)

Refused with a reason code and words: `not_paid` (pending, cancelled or closed), `sent` (a shipment exists, legacy or not; partly sent included), `copied`, `host`, `subscription`,
`weekly_box`, `booking` (a line with a booking), `venue_balance` (`balance_minor > 0`), `vat_kind` (reverse charge or IOSS), `return` (any withdrawal request confirmed or any return not
cancelled), `restricted` (D162), `edit_pending`, `edit_limit`, `store_closed`, `payments_off` (only for an edit that would refund or charge through Stripe: the money cannot move),
`test_mode` (an order paid in Stripe test mode may be edited only in test mode; never mixed). Everything else may be edited. Lines that are not goods (downloads, services, sign-up fees) are
shown and cannot be changed.

### 4.5 Money: collecting and refunding the difference

- **`Δ < 0`**: `refundOrder(storeId, orderId, { amountMinor: −Δ, reason: "Order change E{n}", restock: [] }, accountId, { idempotencyKey: "order-edit-refund:{edit}", inTransaction:
  apply })`: Stripe first (the store's account, `refund_application_fee: true`), then **the edit is applied in the same database transaction that records the refund**, so either both are
  written or neither. A payment taken outside Kaizen (D173) is refunded by being recorded (who may: the owner, or staff when allowed) and the screen says the store pays the customer back.
  `−Δ` above what is left to refund refuses (`over_refundable`: earlier goodwill refunds left too little). The bonus, affiliate and referral triggers react to the refund as to any (credits
  earned are reversed and used credits restored in proportion; nothing new).
- **`Δ = 0`**: applied with no money moving.
- **`Δ > 0`**: the edit is stored `awaiting_payment` with the added units held (`inventory_reservations.order_edit_id`, `expires_at` = the link's end) and a token; the order is unchanged.
  The pay page's press opens a Stripe **hosted** Checkout session through `openPaymentSession()` on the store's connected account for **one line** "Change to order {number}" of `Δ`, quantity 1,
  no coupon, `application_fee_amount = saleFee(Δ, storeFeeBps())` (Kaizen's fee on the extra sale), metadata `{ order_id, order_number, store_id, order_edit_id }` and never the token;
  a `payments` row (`pending`, `order_edit_id`) is written per session; the idempotency key is `order-edit-pay-{edit}-{n}` (n = the edit's payment rows, D173's rule).
  **`applySession()` branches first on `payments.order_edit_id`**: a completed session calls `completeEditPayment()` (captures the row and applies the edit in one transaction, under the
  order's lock; never `complete_order_payment()`); an expired or failed session only marks its payment row (never `cancelUnpaidOrder()`: the order is paid). Applying twice is a no-op.
  *Record as paid outside Kaizen* writes a `manual` payment of `Δ` with `order_edit_id` (method, reference, `received_on` as D173) and applies the edit.
- **Cancelling, expiring, withdrawing**: *Cancel the change*, the five-minute `expireOrderEdits()` and a confirmed withdrawal each call `settleOrderSessions()` for the edit's sessions first
  (closed only when Stripe says so; `processing` refuses the cancel and makes the job wait) and then release the held units and end the edit (`cancelled` / `expired`), with event
  `order.edit_cancelled` / `order.edit_expired`. A withdrawal never waits: it is confirmed, and if the edit's session cannot be closed the payment, if it comes, is refunded by 2.7's rule.
- **CRD Art. 22** (https://www.legislation.gov.uk/eudr/2011/83/article/22, read 2026-10-06): "Before the consumer is bound by the contract or offer, the trader shall seek the express consent
  of the consumer to any extra payment in addition to the remuneration agreed upon for the trader's main contractual obligation." So a higher total is **never applied or charged without
  the customer's own act**: their payment through the link, or money they handed over that staff record. A saved card is never charged for an edit.
- **Lower totals and the store's own changes**: an edit for *Out of stock* or *Our mistake* is the store not delivering part of what it sold; the customer is told and refunded at once,
  never offered credits instead. Whether a store may substitute goods without asking is a legal question (section 8, item 2); the editor requires the reason *The customer asked* for any
  edit that **adds** goods with `Δ ≤ 0` (a swap applied without payment), and says so.

### 4.6 Documents of an edit (D159 extended)

- **When**: at the transaction that applies the edit (in a sub-block: a failure rolls back only the documents, never the edit or its money; `documents = 'waiting'`, retried by the job).
- **What**: for an order whose original invoice is issued: an **edit credit note** for the removed units (each at its own rate, the line's removed total and tax, D153's working shape)
  and, when the shipping went down, the shipping reduction at the shipping rate; an **edit invoice** for the added units (each at its rate) and, when the shipping went up, the increase.
  Each refers to the original invoice by number (VAT Directive Art. 219: "Any document or message that amends and refers specifically and unambiguously to the initial invoice shall be
  treated as an invoice", read for D159 at https://www.legislation.gov.uk/eudr/2006/112/article/219) and to the order number, is dated the store day it is issued, takes the next number
  of its own gap-free series (`F-…`, `K-…`), and carries the seller, buyer and treatment of the original. Its **supply date** is the day the edit was applied (an edit paid through the link:
  the day the payment was captured; recorded outside: `received_on`). Nothing is issued for a part that is 0. Copied, host, test-mode and not-invoiced orders get none.
- **Payment section** of an edit invoice: `paid_online` for an edit paid through Stripe, `paid_outside` with the method for one recorded outside (D173), and a new kind
  **`settled_by_order`** for an edit invoice whose added goods were paid by what the customer had already paid (`Δ ≤ 0`): "Settled against the payment for invoice {F-17}" (hand-written,
  section 8).
- **Arithmetic and reports**: `Σ invoices − Σ credit notes` of an order equals, per VAT rate, the order's own lines and shipping after every edit and refund (a test in
  `checkout-kinds.int.test.ts`). VAT Directive Art. 90 (https://www.legislation.gov.uk/eudr/2006/112/article/90, read 2026-10-06): "In the case of cancellation, refusal or total or partial
  non-payment, or where the price is reduced after the supply takes place, the taxable amount shall be reduced accordingly". D161's reports read the documents through
  `tax_document_groups()` and so count the change in the period of the edit (filing mode: a credit note in a later quarter is a correction of the original period, as for any credit note).
  **Whether a pre-delivery change of a prepaid order should be dated otherwise is for the accountant** (section 8, item 5).

### 4.7 What figures do with an edit (`docs/analytics.md` first, 5.5)

An edited order is one paid order at its amounts **as edited**, dated by `placed_at` as every order is (so an edit changes the figures of the day the order was placed; Shopify shows a later
edit as a separate order: Kaizen's choice is stated on the Finance page); its added lines are units sold and its removed units are not; **a refund with `order_edit_id` is not a refund** in
Refunds, refund rate, Net revenue or the Returns figures (the order's total already went down); an edit payment is not an order. The reconciliation of D161 names a new cause,
**"changed by an edit in another period"** (the documents are dated by the edit, the order by its placement), counted and itemised, never netted silently. **Owed** (D172) becomes Σ per line
`min(backorder_quantity, units to send)` of paid orders, so a backordered unit already shipped is not owed.

### 4.8 Who may do what

| Action | Key | Notes |
|---|---|---|
| See parcels, units to send, edits; print slips and pick lists | `orders:read` | |
| Send (one parcel, in parts, bulk), email a parcel again | `orders:write` | open store not required (paid goods) |
| Edit an order, send or share its pay link, cancel an awaiting edit | `orders:write` | open store required |
| Edit with a refund of a payment taken outside Kaizen; record an edit as paid outside Kaizen | the owner, or `orders:write` when `order_settings.staff_mark_paid` is on | D173's rule, `accountMayRecordOutside()` |
| AI manager: `get_order`, `list_orders`, `pick_list` | `orders:read` (`TOOL_PERMISSIONS`) | ungated (read only) |

Every action calls `checkPermission(slug, key)`/`requirePermission()` (D158; nothing compares `role` with `"owner"`), is a server action bound to the store slug, writes an audit entry
(`order.sent_part`, `order.edit_applied`, `order.edit_sent`, `order.edit_cancelled`, `order.edit_paid_outside`; amounts and counts only, never staff's note) and `refresh()`es.

---

## 5. Where things live

Areas share files only through the registries of 5.6. **The words come first**: the foundation writes every shopper-facing word of section 8 before the server starts.

### 5.1 Foundation (schema, migrations, pure libraries, shared types, the words)

- `src/db/schema.ts` (3.1, 3.2); `supabase/migrations/{ts}_fulfilment.sql`, `{ts}_fulfilment_rules.sql`; `src/db/fulfilment.test.ts` (PGlite, every point of 3.3).
- Pure libraries (no server import; no zod in what the change pay page's client or the order page, a pay route, reaches):
  `src/lib/fulfilment-limits.ts` (4.1); `src/lib/fulfilment.ts` (`unitsToSend()`, `fulfilmentState()`, `shipmentProblems()` with the reason codes and words, `takeWithdrawnFromUnsent()`);
  `src/lib/pick-list.ts` (`pickList(orders, { by, sort })`: rows by variant or by order, sums, skips with reasons); `src/lib/order-edit.ts` (`editBlock()`, `priceOrderEdit()` with
  `splitLine()`, the problem codes and words, the summary's "what happens to the money" sentence); `src/lib/order-edit-status.ts` (the lifecycle table, mirrored by the database).
- `src/lib/invoice-snapshot.ts` / `src/lib/credit-allocation.ts`: the edit invoice and edit credit note snapshots (`buildEditInvoiceSnapshot()`, `editCreditNote()`), the pooled
  `bucketsLeft()` over an order's invoices, and the `settled_by_order` payment kind; `invoice-parity.test.ts` gains fixtures for each so the SQL of 3.3 point 9 equals them.
- `src/lib/inventory.ts`: `MOVEMENT_SOURCES` gains `order_edit`. `src/lib/order-ops-events.ts`: the new event and audit names (`order.sent_part`, `order.edit_applied`, `order.edit_sent`,
  `order.edit_cancelled`, `order.edit_expired`, `order.edit_paid_outside`, `order.edit_payment_refunded`, `credit_note.covered_by_edit`).
- Registers: `src/lib/store-copy-rules.ts` (3.7), `src/lib/personal-data.ts` (3.7, `EMAIL_KINDS`).
- The words (nb, sv, da, en by hand; 8): `m.fulfilment.*` (states, parcel list, *Still to come*), `m.orderChange.*` (the change pay page), `emailText().orderChanged`,
  `emailText().shippedPart` (the parcel's lines and "the rest follows"), `invoiceText().edit` (the edit invoice's and credit note's headings and reference line, `settledByOrder`), the
  slip's `m.slip.moreFollows`; `HAND_WRITTEN_ONLY` gains `ui:orderChange.`, `email:orderChanged.`, `email:shippedPart.`, `ui:fulfilment.receipt` (the receipt sentence); the plain state
  words may be machine-translated. `ui-catalog.test.ts` cases for anything that chooses by a number ("{n} items still to come").

### 5.2 Server (`src/server`, the cron and webhook routes)

- `src/server/order-admin.ts`: `markSent()` (3.4), `cancelOrder()` refuses a shipped order, `getOrderAdmin()` gains `shipments[].lines`, `toSend`, `fulfilment`, `edits`; the refund form's
  data counts edit refunds; `updateOrderContact()` unchanged.
- `src/server/fulfilment.ts` (`toSend()`, `refreshFulfilment()`, `shipmentLinesFor()`), `src/server/packing-slips.ts` (units to send, a shipment's slip, the new skip reasons),
  `src/server/pick-list.ts` (`pickListData(storeId, ids, { by, sort })`), `src/server/order-bulk.ts` (bulk send of the remainder, `edit_pending`, `print_pick_list` as a bulk action).
- **Edits**: `src/server/order-edits.ts` (`previewOrderEdit()`, `applyOrderEdit()` (the **only** function that sets the edit context and writes edited lines and totals), `sendOrderEdit()`,
  `shareOrderEditLink()`, `cancelOrderEdit()`, `recordEditPaidOutside()`, `completeEditPayment()`, `expireOrderEdits(now)`), `src/server/order-edit-pay.ts` (`changePageFor(shop,
  token)`, `startEditPayment(shop, token, { origin })`, the press limits), `src/server/order-edit-emails.ts` (`sendOrderChanged()`, the pay-link email).
- `src/server/stripe-webhooks.ts`: `applySession()` branches on `payments.order_edit_id` (4.5). `src/server/payment-session.ts`: a one-line session for an edit.
- `src/server/shopper-emails.ts`: `sendShipped()` lists the parcel's lines and the "rest follows" line. `src/server/returns.ts`, `return-sql.ts`, `withdrawals.ts`, `order-delivery.ts`:
  4.2's refinement, `refreshFulfilment()` on a confirmed withdrawal, `markDelivered()` needs `fulfilled`, a confirmed withdrawal cancels an awaiting edit. `bring-shipping.ts`,
  `porterbuddy-shipping.ts`, `helthjem-shipping.ts`: pass `lines` and estimate the weight of the chosen units. `standing-orders.ts`: the box is sent whole.
- `src/server/order-list-sql.ts` / `order-list.ts`: `ship=partly_sent`, `edit=pending`, *To send* still includes partly sent; the list row carries the fulfilment state and *Edited*.
- `src/server/invoices.ts` (and every reader of `commerce.invoices` by order: the documents card, the hosted page, the email attachments, the PDF job): read **all** of an order's documents
  and pick the original with `kind = 'order'` where one is meant; `document-readers.test.ts` lists them. `issueWaitingInvoices()` issues waiting edit documents after the original.
- `src/server/inventory*.ts`: **Owed** by 4.7 (`inventoryCounts().owed`).
- `src/server/privacy-export.ts`: parcels with their lines and the order's changes. `src/server/store-closure.ts` (or where `closeStore()` lives): cancel awaiting edits.
- `src/app/api/cron/cart-reminders/route.ts` (the five-minute job): `expireOrderEdits()`, never throwing, per store.
- **`checkout-kinds.int.test.ts`** (server area): scenarios `order edit: add, remove, reduce (kroner)`, `order edit, euro view`, `order edit with a higher total paid by link`, `order edit
  paid outside Kaizen`, `order edit of a draft-made order with a staff discount`, `order sent in parts`; each holds the order's sums, Stripe's charge and refund, the documents per rate,
  `expectUnitPrices()`, and analytics revenue (no double count).

### 5.3 Shopper

- `src/components/order-shipments.tsx` (the parcels and *Still to come*, used by `order/[orderId]/order-section.tsx` and the account's order page; the order page is a pay route, so the
  component is server-rendered and imports no zod), its view test.
- `src/app/s/[store]/[market]/account/change/[token]/page.tsx`, `actions.ts` (`startEditPaymentAction`), `change-view.tsx`, `change-form.tsx`: the change pay page of 2.4, built like
  D173's pay page (and reusing its seller block and states where they fit); `src/lib/pay-routes.ts`: `isNoExtrasPath()` learns `/account/change/` (`pay-routes.test.ts`).
- e2e: `e2e/order-change.spec.ts` (the change page's states from rows made by `e2e/db.ts`: ready, paid, expired, cancelled; the button's redirect cannot be followed without Stripe keys:
  the problem state is asserted, as D173's), `e2e/partial-shipment.spec.ts` (an order sent in two parcels: the order page lists both parcels with their lines and *Still to come*, in the
  shop's language).

### 5.4 Admin (English only; semantic tokens; no `max-w-*xl` on a page root; every page with `loading.tsx` and its own permission check)

- `orders/[orderId]/page.tsx`: the *Send* card with the parcel table, the shipments with their lines and slips, *Edit items* or its reason, the awaiting-edit panel, the history labels;
  `orders/[orderId]/edit/page.tsx` (the editor), `orders/[orderId]/edit/actions.ts`; `orders/actions.ts` (`sendOrderAction` takes lines); the carrier booking forms' parcel tables;
  `orders/[orderId]/packing-slip/page.tsx` (`?shipment=`), `orders/packing-slips/page.tsx` (units to send), `orders/pick-list/page.tsx`; the list's bulk bar (*Print pick list*) and the
  *Partly sent* / *Edited* / *Change awaiting payment* badges.
- Components in `src/components/admin/orders/` (`send-parcel.tsx`, `shipment-list.tsx`, `order-edit-editor.tsx`, `order-edit-summary.tsx`, `pick-list-view.tsx`) with `renderToString` tests.
- Registries: `src/lib/admin-map.ts` (`order.edit` `/orders/[orderId]/edit`, `orders.pick-list` `/orders/pick-list`, `order` and `order.packing-slip` descriptions widened), the order page's
  `EVENT_LABELS`, `src/lib/permissions.baseline.json`. No store-nav item (both pages are reached from the order page and the list).

### 5.5 Analytics and AI

- `docs/analytics.md` **first** (4.7: *Edited order*, Refunds without edit refunds, Owed per line, the reconciliation cause); then `src/server/analytics-sql.ts` (one fragment
  `NOT_EDIT_REFUND` used by every refund reader), `analytics-refunds-data.ts`, `analytics-returns-data.ts`, `tax-reconciliation.ts` (the new cause), the Finance page's note, with unit and
  int tests (`analytics-edits.int.test.ts`: an order edited in another period, kroner and a euro order, another store's, a store with none).
- `src/server/control-center.ts`, `src/lib/control-center.ts`: *Orders partly sent* (count, the oldest's age) and *Order changes waiting for the customer's payment* (count, ending within
  2 days), for members who may read orders only.
- Order file (D165, `src/lib/order-csv.ts`, `src/server/order-export.ts`): columns `fulfilment` (the state) and `edited` (true/false) in the accounting profile; the lines layout as the
  lines are now. `docs/wave-2-data.md` 4.2 is edited in the same change.
- AI manager (`src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `owner-tool-permissions.ts`, `manager-tools.ts` `TOOL_WORDS`, `assistant-skills.ts`): `get_order`, `list_orders` widened,
  `pick_list` new (2.5); a playbook line in `tidy-orders` ("send in parts from the order's page"). Served to Kaizen Life with the other owner tools.
- Plan comparison (D132): `{ts}_fulfilment_plan_features.sql` and `src/db/fulfilment-plan-features.test.ts`: *Order editing after purchase*, *Partial fulfilment*, *Pick lists*, in
  `Operations` after D173's rows (positions 395 to 397), each saying only what is built, in no plan until the platform's admin ticks it.

### 5.6 The registries, and who edits each

| Registry | Edited by |
|---|---|
| `src/db/schema.ts`, migrations 1 and 2, `COPY_RULES`, `PERSONAL_DATA`/`EMAIL_KINDS`, `MOVEMENT_SOURCES`, `order-ops-events.ts` | foundation |
| `src/lib/i18n.ts`, `email-text.ts`, `invoice-text.ts`, `ui-catalog.ts` (`HAND_WRITTEN_ONLY`), `ui-catalog.test.ts` | foundation |
| `src/lib/pay-routes.ts` (`isNoExtrasPath()`) and its test | shopper |
| `src/lib/admin-map.ts`, `permissions.baseline.json`, `EVENT_LABELS` | admin |
| owner tools, `TOOL_PERMISSIONS`, `TOOL_WORDS`, skills, plan features migration | analytics-and-ai |
| `src/lib/audit.ts` (`AUDIT_AREAS`) | nobody (the `order.` prefix is `orders`; a scan test holds the new actions) |
| `KNOWN_COOKIES`, `store-translate.ts`, sitemap, structured data, `store-nav.ts` | nobody (no cookie, no translatable store text, nothing public, no nav item) |

The server area edits the files of 5.2 and `checkout-kinds.int.test.ts`; the shopper and admin areas edit **no file under `src/server`**; the analytics-and-ai area edits only 5.5's files.
An area that needs a function another owns asks for it in its report.

---

## 6. Acceptance criteria, row by row, mapped to tests

Layers: **unit** (`pnpm test`), **PGlite** (`src/db/fulfilment.test.ts`, every migration applied), **int** (`pnpm test:int`, a real database seeded by `scripts/db-setup.mjs --seed`, the
fake Stripe of the integration tests), **view** (`renderToString`), **e2e** (storefront only), **scan** (a unit test that reads the source). Integration tests pass inputs through the
validation the app uses (`orderEditInput`, `sendInput`).

### 6.1 `orders.edit-an-order-after-placement` (and its twin `checkout.order-editing-after-purchase`)

| # | Criterion (row text kept) | Held by |
|---|---|---|
| E1 | Staff add a line, remove a line and change a quantity on a paid, unsent order; the total, VAT, discounts and stock holds are recalculated by the same functions as checkout and agree with `cartSummary()` (integration test in two currencies). | unit `order-edit.test.ts` (`splitLine()`: every column kept + removed = as sold, odd units, a line with every discount part, a staff discount, `shareAmount()` ties; `priceOrderEdit()`: add, remove, reduce, shipping keep and set, `shipping_discounted`, `only_down`, `nothing_left`, `total_zero`). int `order-edit.int.test.ts`: the three changes on one order in **kroner and a euro view**; the added lines equal `cartSummary()` of the same goods line for line (unit price, total, VAT) and `expectUnitPrices()` holds; the kept lines keep their sold discounts apportioned; the order's sums and checks hold; stock: removed units back where they came from (movements `order_restock`/`order_edit`), added units drawn (`sale`/`order_edit`), a variant that stops at zero refuses with nothing written, a backordered added unit carries its days; `checkout-kinds.int.test.ts` scenarios of 5.2. PGlite: the settled-order guards (a write outside the edit context raises; inside it passes), the frozen triggers' edit-context exceptions (down only). |
| E2 | A higher total gives a pay link for the difference; a lower total refunds the difference through `refundOrder()` and returns the stock (integration test with faked Stripe). | int `order-edit-pay.int.test.ts`: `Δ > 0` stores an awaiting edit, holds the added units until `expires_at`, leaves the order unchanged, emails the link once (fake `deliver`), the token's hash matches; the change page's data and press (a hosted session of one line of `Δ`, `application_fee_amount = saleFee(Δ)`, metadata without the token, a new key per press); a fake `checkout.session.completed` through `applySession()` (twice) applies the edit once and never calls `complete_order_payment()`; an expired session cancels nothing; `expireOrderEdits()` releases the units, a session paid just before the job is applied, not expired; a payment for an edit that can no longer apply is refunded in full; *Record as paid outside* (owner, staff only when allowed). `Δ < 0`: one Stripe refund of `−Δ` with the edit's idempotency key, the refund and the change in one transaction (a Stripe failure writes nothing; `pending` applies), removed units restocked, `over_refundable`, a manual payment's refund recorded. view: the change page's states, the editor's summary sentences. e2e `order-change.spec.ts`. |
| E3 | Every edit is one event in the order history with before and after, and the order number and sequence do not change (D141). | int: one `order.edit_applied` event per applied edit with `{ edit, seq, before: { totals, lines }, after: {…}, difference }` and staff's note only in `data.note` (anonymising removes it); `order_edits` and `order_edit_lines` hold before and after; the order's number and `commerce.order_number_audit()` are identical before and after a run of edits, refunds and expiries; a scan test (the existing one) still finds orders inserted only in `order-insert.ts`. PGlite: edits and edit lines are append-only and never deleted; `seq` per order. |
| E4 | A sent, cancelled or copied order refuses line edits with a plain message. | unit `editBlock()` (every reason of 4.4 with its words). int: refusals for a sent, a partly sent, a cancelled, an unpaid, a copied (also by the database), a **host** order, a subscription, a booking, a venue balance, reverse charge, IOSS, a return or withdrawal, a restricted order, a closed store, an awaiting edit; the order page shows the reason (view). |
| E5 (twin) | The customer is emailed a revised confirmation; every edit is logged with who and when. | int: `order.changed` sent once per applied edit to `order.email` only (fake `deliver` records every recipient), with what changed, the new total, the refund or the pay link, the documents' links and the withdrawal block; never staff's note; no separate refund email; the event and the audit entry name the account and the time. view: the email's text in nb, sv, da, en. |
| E6 (documents) | An invoiced order's edit issues a credit note and an additional invoice referring to the original; no document is changed. | int `order-edit-documents.int.test.ts`: per VAT rate, `Σ invoices − Σ credit notes` of the order equals its lines and shipping after the edit and after a later return and refund (pooled credit); the edit refund has no credit note of its own (`credit_note.covered_by_edit`); the numbers are gap-free in both series; a waiting original makes the edit's documents wait and issues them after; copied, host, test-mode and invoicing-off orders get none; `document_audit()` stays clean. `invoice-parity.test.ts`: the edit invoice, the edit credit note and `settled_by_order` fixtures equal the SQL. D161: `tax-reports.int.test.ts` gains an edit in a later quarter (books mode and filing mode). |

Expected rating after the run: **partial** (1.1); Full after 9.7 and section 8.

### 6.2 `orders.fulfilment-workflow-partial-fulfilment`

| # | Criterion (row text kept) | Held by |
|---|---|---|
| F1 | Staff mark chosen lines and quantities as sent in one shipment; the order shows Partly sent until every physical unit is in a shipment and Sent after (integration test). | unit `fulfilment.test.ts` (`unitsToSend()`, `fulfilmentState()` over every case of 1.3, withdrawn taken from unsent first). int `fulfilment.int.test.ts`: send 2 of 3 then 1 of 3 (state `partly_sent`, status `paid`, then `sent`/`fulfilled`); a quantity above what is left, a digital line, another order's line refused with nothing written; two sends at once (one refused `changed`); `markSent()` without lines sends the remainder (every old caller); a legacy shipment counts as everything; `toSend()` equals `commerce.line_to_send()`; `markDelivered()` refused until `fulfilled`, a later parcel reopens a receipt; `cancelOrder()` refused once anything is sent; the *To send* view and `ship=partly_sent` find it. PGlite: 3.3 points 1 to 4 (same order, Σ ≤ quantity under concurrency, append-only, the back-fill; the "a non-legacy shipment has lines" case is written now and skipped until the follow-up migration, 9.1); scan: shipments are inserted only by `markSent()`, which writes lines. view: the *Send* card and shipment list. |
| F2 | Each shipment has its own carrier, tracking and email; the shopper's order page lists them with their lines. | int: two parcels, two `order.sent` emails (keys per shipment) each listing its own lines and, for the first, "the rest follows"; carrier bookings pass their lines (fake carrier). view `order-shipments.test.ts` (both order pages' component: parcels, lines, *Still to come*, backorder words, a legacy parcel). e2e `partial-shipment.spec.ts` (the order page shows both parcels and their lines in the shop's language). |
| F3 | Selecting several orders marks them sent in one action, reporting any that were refused (integration test). | int `order-bulk.int.test.ts` (D173's, extended): a partly sent order's remainder sent as one parcel; refusals `waiting_for_stock`, `edit_pending`, `copied`, `withdrawn_in_full`, `not_found`, a closed store; per-order transactions; emails only when asked. |
| F4 | Units withdrawn before sending (D153) are left out of what can be fulfilled. | int: a withdrawal of 1 of 3 before sending leaves 2 to send and a parcel of 3 is refused; after 1 sent, a withdrawal of 1 leaves 1 to send and its return has **nothing to send back** (4.2, `NOTHING_SENT_SQL`), a withdrawal of the last unsent units makes the order `fulfilled`; the slip, the pick list and the bulk send leave withdrawn units out. `returns.int.test.ts` keeps every earlier case. |

Expected rating after the run: **full** (the lead's call after 9.7, 1.1).

### 6.3 `orders.packing-slips-and-pick-lists`

| # | Criterion (row text kept) | Held by |
|---|---|---|
| P1 | Selecting several orders prints their packing slips in one document, one per page, in each order's language, without prices (integration test of the data, render test of the page). | int `packing-slips.int.test.ts` (new): several orders in different languages, the units to send of each (a partly sent order its remainder), skips (`already_sent`, `withdrawn`, `copied`, `nothing_to_ship`, `not_found`), 101 ids refused; no amount in the data. view `packing-slip-views.test.ts` (D173's, extended): one page each, the language of each, none of the orders' formatted prices, totals or VAT words in four languages, a parcel's slip with "more follows". |
| P2 | A pick list adds up the items of the selected orders by product, variant, SKU and quantity, leaving out digital and service lines and units withdrawn before sending (unit test). | unit `pick-list.test.ts` (by product and by order, sums over orders, sorts, digital and service lines out, shipped and withdrawn units out, skips with reasons, an awaiting edit as a warning). int `pick-list.int.test.ts`: the data from real orders of the store, never another store's. view `pick-list-view.test.ts` (no prices, no names or addresses). |
| P3 | A slip shows a gift message when the order has one (with wave 3's gift rows). | view (D173's test, kept) and the parcel slip of a gift order. |
| P4 | Slips of orders of another store are never printed (integration test). | int `packing-slips.int.test.ts` and `pick-list.int.test.ts`: another store's ids are `not_found` and nothing of them is in the data; a parcel slip of another store's shipment is a 404 (`shipment` not in the order). |

Expected rating after the run: **full**.

### 6.4 Database tests, cross-cutting tests and scans

- **PGlite `src/db/fulfilment.test.ts`**: 3.3 points 1 to 10 one by one; a property test (random sends, withdrawals and edits: Σ shipped ≤ quantity, units to send never negative,
  `order_number_audit()` clean, `orders_total_adds_up` and every line check holding after each step).
- **Scans**: (a) `applyOrderEdit()` is the only writer that sets `kaizen.order_edit` (`order-edit-writers.scan.test.ts`); (b) shipments are inserted only by `markSent()` and every insert
  writes lines; (c) `document-readers.test.ts` lists every reader of `commerce.invoices` by order and that it handles `kind`; (d) `payment-readers.scan.test.ts` stays green (a new reader of
  `payments.provider` has its reason); (e) `stock-writers.scan.test.ts` (the edit's stock changes run under `withStockContext()`); (f) `permissions.scan.test.ts` and its baseline;
  (g) the audit actions are in `AUDIT_AREAS`; (h) `pay-routes.graph.test.ts`: the order page's parcel component imports no zod and no forbidden module, `/account/change/` is a no-extras path;
  (i) the existing numbering scan.
- **Registers**: `privacy.test.ts`, `commerce.test.ts` (`COPY_RULES`), `admin-map.test.ts`, `owner-tool-permissions.test.ts`, the email-kinds test, `ui-catalog.test.ts`,
  `fulfilment-plan-features.test.ts`, `KNOWN_COOKIES` unchanged.
- **Regression**: every existing test of checkout, drafts, bulk, returns, invoices, tax reports, stock, standing orders, carriers and the order file stays green.

### 6.5 Criteria changes (for the lead; the rows are not edited here)

1. **Merge the twin rows** (README rule 8): `checkout.order-editing-after-purchase` is the same Shopify feature and page as `orders.edit-an-order-after-placement`; the orders row owns the
   code and survives, taking the twin's criteria "the customer is emailed a revised confirmation" and "a host order cannot be edited" (held by E4 and E5), and names the deleted row in its
   `gap`. Until then both are rated together.
2. **E1, proposed text**: "Staff add a line, remove a line and lower a quantity on a paid, unsent order; units kept keep the price and discounts they were sold with, added goods are priced and
   taxed by the checkout's own functions and agree with `cartSummary()` for the same goods, and the totals, VAT and stock follow (integration test in two currencies)." Reason: "recalculated by
   the same functions as checkout" read literally would re-run campaigns, codes and credits over a sold order and change prices the customer agreed to; Shopify does not do it either (1.2).
3. **E2, proposed text**: "A higher total sends the customer a pay link for the difference and **the change is applied when it is paid**; a lower total refunds the difference through
   `refundOrder()` in the same transaction as the change and returns the stock." Reason: CRD Art. 22 (4.5).
4. **E4**: "a sent order" should read "an order with anything sent (partly sent included)".
5. **F1**: "until every physical unit is in a shipment" should read "until every physical unit **not withdrawn** is in a shipment" (F4 already says withdrawn units are not fulfilled).
6. **P2**: "units withdrawn before sending" should read "units already sent or withdrawn before sending" (a pick list is of what is still to send).
7. **The packing-slip row's `gap` text** names "template choice"; it is not a criterion. Template choice is section 7 here; the row should not be held for it.

---

## 7. What is deliberately NOT done, and why

- **Editing a partly sent order's unsent lines** (Shopify allows it): it needs edits that coexist with shipment lines and per-parcel documents; this run edits unsent orders only (decision 3).
- **Editing reverse-charge and IOSS orders** (their VAT treatment is frozen by D157 and an edit could change it), **subscriptions, weekly boxes, bookings, venue balances, hosts' orders**:
  each agrees a price or schedule elsewhere or has another seller.
- **Re-running campaigns, codes, group discounts or credits on an edit; adding a discount to an existing line; a staff discount on an edit**: kept units keep what they were sold with; an
  added line takes a custom price. A per-line manual discount (Shopify) is a later run.
- **Changing an order's market, currency or delivery service (D135 carrier quotes, pickup points, windows)**: shipping is kept or set by hand.
- **Custom items on an edit** (D173's custom service lines): their withdrawal handling is an open legal question (`docs/wave-3-orders.md` section 8 item 9).
- **Charging a saved card for an edit** (CRD Art. 22) and **several partial payments of a difference**.
- **The AI manager editing, sending or recording**: money, stock and the customer's consent; it reads only.
- **Cancelling or deleting a shipment** (Shopify cancels a fulfilment): shipments and their lines are records; a parcel recorded by mistake is noted on the order. A later run may add a
  *void* that keeps the row.
- **Carrier labels for several parcels in one booking, return labels, local delivery and pickup at a location**: wave 3's shipping run.
- **Pick lists by location, bin or with pictures; printing by fulfilment status other than "to send"; slip and pick-list templates (HTML/CSS/Liquid)**: a fixed layout; the location split
  needs shipments that record where they leave from.
- **Editable notification templates** for the change and parcel emails: row `orders.editable-notification-email-templates`.
- **Showing an edit as a separate order in analytics** (Shopify's way): Kaizen amends the order and dates the documents by the edit (4.7).
- **A customer asking for a change themselves** (self-service edit): staff make every edit.

---

## 8. Needs human legal review

Every text below is hand-written in nb, sv, da and en (admin ones in English), flagged `// legal: needs review` in the source, and the legal ones are in `HAND_WRITTEN_ONLY`. None is legal
advice. **The edit rows stay partial until a person has read items 1 to 6.**

1. **The order-change email** (`emailText().orderChanged`): subject, what changed, the reasons' words, the refund sentence (and for money taken outside Kaizen "{store} pays {amount} back
   to you"), the pay sentence "To confirm the change, pay {amount} by {date}. If you do not, your order stays as it was", "Nothing more to pay", the documents' lines, the withdrawal block for
   added goods. Questions: is it the confirmation of the changed contract on a durable medium (CRD Art. 8(7)); is the pay sentence an adequate request for express consent (Art. 22).
   The pay-link email has its own words (3.15 item 2: `proposedSubject` "A change to your order {n} is waiting for your payment", `proposedHeading`, `proposedIntro` "Nothing has
   changed yet…", `proposedRemoved`/`proposedAdded`, `proposedReasons`); the withdrawal sentence for added goods now reads "The added goods are part of your order: you can withdraw
   within 14 days of receiving the last parcel of the order…" (3.15 item 4) and is never shown to a business buyer (3.15 item 3).
2. **Changes the store makes without being asked** (*Out of stock*, *Our mistake*): may a store reduce an order and refund without the customer's agreement (non-delivery, CRD Art. 18 and
   national sale-of-goods law), and what must the email then say about the customer's other rights? The editor requires *The customer asked* for a swap (adds with `Δ ≤ 0`); is that enough?
3. **The change pay page** (`m.orderChange.*`): its states, "Already paid", "To pay now", the withdrawal sentence for added goods, the backorder sentence reused from D172, and the button
   `m.pay(Δ)` (the open question of `docs/wave-1-trust.md` on the checkout's button label applies here too). Its intro now says the store *proposes* a change and nothing has changed
   yet (3.15 item 2), and its withdrawal sentence counts from the last parcel (3.15 item 4).
4. **Terms on a change**: the page links the store's terms and records no new acceptance, relying on the order's (D158). Is the change a new contract that needs its own acceptance and its own
   pre-contract information?
5. **The edit invoice and edit credit note** (`editDocumentText()`: `additionalInvoice`, `amends`/`amendsOf`, `reasonOrderEdit`, `settledByOrder`, and from the review fixes
   `removedRow`, `shippingLoweredRow`, `supplyDatePaid`, `supplyDateSettled`): the headings ("Additional invoice for order {n}, amends invoice {F-17}", "Credit note for changes to
   order {n}"), the reference line, "Settled against the payment for invoice {F-17}", and the dating: the supply date of added goods paid in advance is the edit's payment day and a removed
   part is credited on the edit's day (VAT Directive Art. 65, 90, 219 as read). An accountant should confirm the treatment, especially for an order paid in one VAT period and changed in the
   next, and whether Norway, Sweden and Denmark accept the additional-invoice form or want a full corrective invoice.
6. **The parcel words**: "The rest of your order follows in another parcel" and the receipt sentence on the order page and in the shipped email ("your 14 days count from the day you receive
   the last parcel", CRD Art. 9(2)(b)), and the slip's "More of this order follows in another parcel". The receipt sentence is never shown to a business buyer (3.15 item 3).
7. **The withdrawal refinement** (4.2): withdrawn units taken from unsent units first, and a withdrawal whose units were all unsent refunded without waiting for goods (Art. 13(3)). Is this
   the right reading when the consumer names units that were in fact sent?
8. **Cash for a change** (3.15 item 8): the ceiling is applied to the order's cash for the whole sale (its earlier cash payments plus the change). Is a change to an order the same
   "transaction" in hvitvaskingsloven § 5's sense, and is the Danish `warn` rule right for it?

---

## 9. For the lead

### 9.1 Migrations expected

Three files (3.8) in this run and one follow-up after its deploy, additive, each run in one transaction by CI (`docs/ci-migrations.md`) after the checks pass; none is applied by hand first. Old code keeps working until the deploy
ends: every new column is nullable or has a default; `markSent()` of the old code inserts a shipment without lines, so **the "a shipment has lines" check is a fourth, follow-up migration**
(`{ts}_shipment_lines_required.sql`, the deferred constraint trigger of 3.3 point 1) that the lead pushes **after** this run's deploy has finished, together with un-skipping its PGlite test;
a shipment the old code recorded during the deploy window has no lines and is marked `legacy` by that follow-up migration first (`update … set legacy = true where not legacy and not exists
(lines)`, and its back-fill as in 3.3 point 2). The settled-order guard of 3.3 point 5 is safe in the window (the old code writes no settled line; check that `updateOrderContact()` and
`cancelOrder()` touch no guarded column). The `invoices_order_key` swap (drop the unique constraint, create the partial unique index) and the
check widenings (`invoices_kind`, `credit_notes_source`, `inventory_movements_source`) are plain DDL with short locks; run in a quiet hour. Stamps sort after
`20261006185225_orders_ops_fix_rules.sql`; rename before applying, never after.

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

CI applies through a direct connection, so none needs the owner. For completeness:
- **No new function contains `DELETE`, `TRUNCATE` or `DROP`**: an edit deletes a removed order line in **application code** (`applyOrderEdit()`, under the edit context), not in a function.
- `ALTER TABLE … DROP CONSTRAINT invoices_order_key`, `invoices_kind`, `credit_notes_source`, `inventory_movements_source` (then `ADD`/`CREATE UNIQUE INDEX`) are DDL outside functions.
- The `DO $patch$` blocks read the **live** definitions of `orders_origin_frozen()`, `order_lines_backorder_frozen()`, `draw_order_stock()`, `make_credit_note()` (and the cap trigger it uses),
  `payment_on_invoice()`, `document_audit()` and `issueWaitingInvoices()`' SQL, and since the review fixes (3.15 item 7) `bonus_refund_applied()` and `affiliate_refund_applied()`
(defined in `20260930172724`/`20260930184741`, never patched since), with `pg_get_functiondef` and replace a named text; each raises if its anchor is gone and is skipped when its
  marker is present. **Check the anchors against production's present definitions before the push** (`draw_order_stock` was last replaced by `20261006121317`, the invoice functions by
  `20261004125337`/`20261004152302` and D173's `20261006151848`).
- The back-fill of 3.3 point 2 is an `INSERT … SELECT` over production's orders with shipments: check its count after the deploy (`select count(*) from commerce.shipment_lines`) against
  the physical lines of orders with shipments.

### 9.3 Advisors to check after the deploy

Security: three new tables with RLS on and no policy; every new function `SET search_path = ''` and not granted to `anon`/`authenticated`; `order_edits.made_by` has an index.
Performance: the new triggers on `order_lines` and `orders` run on every write of those tables, the payment path included (`placeOrder()` inserts lines into a `pending_payment` order:
the guard must return at once for that status); compare the checkout's timings before and after; the `shipment_lines` sum under lock is per line.

### 9.4 Decision row, draft (D174, the next free number at ship time)

> **Orders are edited after purchase, sent in parts and picked from a list (wave 3, third run).** `docs/wave-3-fulfilment.md` is the contract. Every new shipment names its lines and
> quantities (`shipment_lines`; shipments before this run are `legacy` and count as everything sent); an order is *Partly sent* (still `paid`) until no unit is left to send
> (`quantity − shipped − withdrawn`, withdrawn units taken from unsent ones first) and `fulfilled` after; each parcel has its tracking and its own email listing its lines, the shopper's order
> pages list parcels and what is still to come, and the receipt (D153) is the last parcel's. A paid order with nothing sent can be **edited** by staff (`order_edits`, numbered per order):
> kept units keep their price and discounts as sold (apportioned as a return is), added goods are priced and taxed by the checkout's own functions, shipping kept or set; a lower total is
> refunded through `refundOrder()` in the same transaction as the change, a higher one is applied only when the customer pays it through a pay link (Stripe's hosted page) or staff record it
> as paid outside Kaizen (CRD Art. 22); the number never changes (D141). An invoiced order's edit issues an edit credit note and an additional invoice referring to the original (Art. 219),
> credits are then pooled over the order's documents, and an edit's refund is not a refund in analytics. Packing slips print what is still to send or one parcel; the pick list sums the
> selected orders' units to send by product or by order. `[Migration versions to record: …]`

### 9.5 CLAUDE.md bullet, draft (Admin section, after the D173 bullet)

> - **Fulfilment and order editing (wave 3, D174, `docs/wave-3-fulfilment.md`)**: shipments are written only by `markSent()`, which always writes `shipment_lines` (no lines given = everything
>   still to send; a non-legacy shipment without lines is refused at commit); units to send are only `toSend()`/`commerce.line_to_send()` (`quantity − shipped − withdrawn`, withdrawn units
>   taken from unsent ones first, held equal by a test); an order stays `paid` while *Partly sent* and becomes `fulfilled` only through `refresh_fulfilment()`; `markDelivered()` needs it
>   sent in full (CRD Art. 9(2)(b)). An order's lines and money columns change after `pending_payment` **only** inside `applyOrderEdit()` (`src/server/order-edits.ts`, the edit context
>   `kaizen.order_edit`; triggers refuse anything else; a scan test), which keeps sold units' discounts (`splitLine()`, `paidForUnits()`), prices added goods with `shown()` and `decideTax()`
>   (equal to `cartSummary()`), refunds a lower total through `refundOrder()` in the same transaction and applies a higher one only when paid (`applySession()` branches on
>   `payments.order_edit_id` and never calls `complete_order_payment()` for it; never charge a saved card for an edit). Only paid, unsent, standard-VAT orders without subscriptions,
>   bookings, boxes, hosts, returns or venue balances are edited (`editBlock()`). An edit issues documents only through `commerce.issue_edit_documents()` (edit credit note and
>   `kind = 'order_edit'` invoice, referring to the original); the order's documents are one pool for later credits; an edit's refund gets no credit note and is not a refund in analytics.
>   Pick lists are `pickList()` (`src/lib/pick-list.ts`). New words are hand-written and flagged; the change email and pay page need legal review.

### 9.6 Merge notes

- Shared files other work may touch: `src/db/schema.ts`, `src/lib/i18n.ts`, `email-text.ts`, `invoice-text.ts`, `admin-map.ts`, `owner-tools.ts`, `personal-data.ts`,
  `store-copy-rules.ts`, `src/server/order-admin.ts`, `stripe-webhooks.ts`, `shopper-emails.ts`, `returns.ts`, `return-sql.ts`, `invoices.ts`, `checkout-kinds.int.test.ts`. The two large
  moves are **`markSent()`'s new return shape** (every caller: the order page, bulk, three carriers, the boxes, the AI's existing callers; land it first and run every send test) and **the
  invoice pool** (land the SQL with `invoice-parity.test.ts` green before anything issues an edit document).
- `docs/analytics.md`, `docs/wave-2-data.md` 4.2 and `docs/returns.md` (a short "As built (D174)" note on 4.2's refinement) are edited by their areas in the same change.
- Run no other wave that edits the shared registries at the same time (`docs/parity-plan.md` 4.8).

### 9.7 Before pushing (the things CI cannot prove)

1. **By hand, signed in, on a test-mode store**: send an order in two parcels (one through a carrier's test booking if connected), read both emails and the order page; print a parcel's slip,
   the remainder's slip and a pick list of five orders.
2. **An edit end to end in Stripe test mode**: lower an order (refund through Stripe, the credit note), raise one (open the link, pay with a test card, the additional invoice), let one expire
   (shorten `expires_at` in the database), record one as paid outside; check the order page, the history, the documents and the emails.
3. **A person who reads Norwegian, Swedish and Danish** reads the change email, the change page, the parcel words and the edit documents on screen (section 8).
4. **Production data**: the back-fill count (9.2) and the checkout's timing with the new guards (9.3).

### 9.8 Blockers and risks

**No owner decision and no credential stops the work (`blockers` is empty).** Risks: (1) **the order guards** (3.3 point 5) touch every writer of orders and lines; the foundation's grep and
the full regression suite are the net, and a guard that proves too broad is narrowed to the columns an edit writes (recorded in 3.10), never removed; (2) **the invoice pool** changes how
D159 credits every later refund; `invoice-parity.test.ts`, the credit-note scenarios and D161's tax tests must all pass; (3) **`markSent()`'s callers** (five places); (4) **the deploy
window** for the deferred shipment check (9.1); (5) **legal questions** (section 8), above all consent to changes and the documents' dating, which may change words without changing the data
model; (6) **scope**: if the budget forces a cut, cut in this order and say so: the AI tools and control-center figures, the order file columns, carrier forms' parcel tables (bookings then
send the remainder), *Record as paid outside* for edits, the pick list's *by order* mode; never the database rules, the documents or the tests of 6.1 to 6.3.
