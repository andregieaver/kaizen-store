# Wave 3, run 2: order list with search, filters, saved views and bulk actions; tags and archive; draft orders with pay links; gift messages (decision D173 proposed)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-orders.md`. Code, tests and texts follow it; a disagreement is settled here
first (the agent that must deviate changes this file in the same edit and says so in its report). It was written from the tracker rows,
`docs/parity-plan.md`, CLAUDE.md and the code as it is on 2026-10-06 (commit `63b76a2`), and follows the shape of `docs/returns.md` and
`docs/wave-3-inventory.md`. It builds on what exists (`orders`, `order_lines`, `order_events`, `payments`, `refunds`, `placeOrder()`, `startCheckout()`,
`applySession()`, `complete_order_payment()`, `cancel_unpaid_order()`, `refundOrder()`, `markSent()`, the packing slip, D141's order numbers, D153's returns,
D159's invoices, D162's erasure, D129's copied orders, D172's reservations) and invents no parallel order system.

**What was found in the code that shapes everything below** (verified 2026-10-06):

- The Orders page (`src/app/admin/(gated)/[store]/orders/page.tsx`) is four tabs (*Orders*, *To send*, *Waiting for stock*, *Unfinished checkouts*, chosen by `?show=`) over
  `listOrders()` in `src/server/orders.ts`: one SQL statement with `limit 200`, newest first, **no search, no filter, no paging, no selection**. The default list holds every order that is
  not an unfinished checkout, **copied history (D129) included**; an unfinished checkout is `pending_payment` or a `cancelled` order that was never paid.
- **There is no tag column or table and no archive state on an order.** `order_events` is append-only and carries the history; its free text is `data.reason` and `data.note`, the two keys the erasure
  (D162) removes when an order is anonymised. `restricted-orders.scan.test.ts` fails for a query that matches `commerce.orders` by email and lacks `restricted_at`/`anonymised_at`/`GONE`.
- **A copied order is read-only** except its customer link (`commerce.copied_orders_read_only()`, patched once by `20261004174402_gdpr_rules.sql` for anonymising with `pg_get_functiondef` and a text
  replace); its history takes only the event `copied` (`commerce.refuse_copied_order_event()`); every table that acts on an order refuses it (`refuse_copied_order()`).
  Tags and archive on a copied order therefore need **two small patches of those functions** (3.3), nothing else.
- **Orders have two inserters only**: `placeOrder()` (cart to `pending_payment` order, numbered by `commerce.next_document_number(store, 'order')` in the same transaction, stock allocated and held
  by `allocate()`, reservations `CHECKOUT_MINUTES + 5` long) and the subscription renewal. It is a ~700-line function bound to a cart (`orderLineRows()` joins variants and prices; campaigns, the group
  discount, the welcome discount, a code, bonus credits and `decideTax()` all read the cart), and a unit test scans the source for the numbering. `cartSummary()` must agree with it
  (`checkout-kinds.int.test.ts`).
- Payments: `commerce.payments` has providers `stripe` and `venue` (a booking paid at the venue: `balance_minor`, `markBalancePaid()`), `payments_amount_positive`, a unique `(store, provider, reference)`
  and `test_mode` (a trigger, venue only). **`refundOrder()` can only send money through Stripe**: `canRefund` is "a captured Stripe payment on a connected account", `refundableMinor` counts
  `provider = 'stripe'` only, and `options.outside` (D153) records a return refunded elsewhere with **amount 0** (stock only). `complete_order_payment()` accepts a `pending_payment` or `cancelled` order, writes the
  event `order.paid` with the actor literal `'stripe'`, and issues the invoice in a sub-block (D159).
- The invoice snapshot's payment section (`issue_order_invoice()`, `buildInvoiceSnapshot()`, the oracle `invoice-parity.test.ts` holds the SQL to) reads
  `v_online = total - balance` as `{ kind: 'paid_online', provider: <first non-venue provider, else 'stripe'> }` and `{ kind: 'pay_at_venue' }` for the balance. **A payment taken in cash or by bank transfer would be printed
  as "paid online" on a legal document** unless the snapshot learns a third kind (3.3, 4.6).
- Stripe: `startCheckout()` creates a Checkout session (`ui_mode: 'elements'` on Kaizen's page, or the hosted page as a fallback) that **expires after `CHECKOUT_MINUTES` (30) + 60 s**; the Connect webhook's
  `applySession()` completes the order on `complete`, and on `expired` or a failed payment calls `cancelUnpaidOrder()`. A reverse-charge or part-paid order already sends **each line at its amount due, quantity 1, no coupon**
  (the order's own net amounts), which is the shape a draft needs (no coupon for a staff discount).
- Terms at checkout (D158): `recordTermsForOrder(store, market, orderId)` writes `order_terms` and the immutable `legal_snapshots`; `/cart`, `/checkout` and `/order` are **pay routes** (`checkoutCsp()`, no consent
  manager, no zod in their client bundle, `PayRouteGuard`); `isNoExtrasPath()` in `src/lib/pay-routes.ts` lists hosted pages that carry no cookie, tracking or chat (`/account/documents/{token}`, `/account/invoice/{token}`).
- The packing slip (`orders/[orderId]/packing-slip/page.tsx`) is single-order, in the order's language, and **already has no prices** (D27). `shipments` allow several parcels; `markSent()` flips the order to `fulfilled`.
- Permissions are `orders:read` and `orders:write` (area keys only, `src/lib/permission-keys.ts`); a closed or suspended store still lets every role use `orders` (`allowedWhenNotOpen()`), but
  `orders_store_open()` refuses an **insert** of an order there.
- The AI manager has `list_orders` and `get_order` (read, `orders:read`); `PAID` in `src/server/analytics-sql.ts` is "a captured payment, not copied, not a host's", whatever its provider, so any captured manual payment
  counts as a sale without a change; conversion rate is "paid orders / sessions".
- The repo has **no signed-in admin fixture** (D158): signed-in admin paths are held by `renderToString` view tests and server integration tests, never by a click-through e2e. The storefront can be clicked
  (e2e against `pnpm start`), but there is no Stripe in it.
- The five-minute job is `/api/cron/cart-reminders/route.ts`; the daily clean-up is `runRetention()` in `src/server/retention.ts`. Documents are `invoices` and `credit_notes`; a refund that becomes `succeeded` by **any
  path** gets a credit note from a deferred constraint trigger.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `orders.order-list-search-filters-saved-views-bulk` | 4 | partial | A | **Partial, becoming Full** only when the lead has used the screen once signed in (9.7) and the skeptic accepts view tests plus server integration tests as the evidence for criteria 2 to 4. Criteria 1 to 4 are held by integration tests of the server functions (search, filters and paging, views, bulk), but the feature is the screen, and no test clicks it (the same position D165's bulk editor and D172's inventory page were in). Expectation: **partial**. |
| `orders.order-tags-and-archiving` | 3 | missing | A | **Full.** The rules are database rules and server functions with integration tests for every criterion (tags per store, 40 characters, 250 per order, case-insensitive; filter; archive and unarchive singly and in bulk with the number sequence untouched; copied orders taggable and archivable and nothing else). The screen is a small card and a button. |
| `orders.draft-and-manual-orders` | 3 | missing | A | **Partial.** Every criterion is built and held by tests, but (a) the Stripe half (a pay link opening a hosted session, a webhook completing the order) is tested against the repo's fake Stripe only; a test-mode payment through a real Stripe account is a by-hand check (9.7); (b) the pay page's wording, the button label, the cash warning and the invoice wording for a payment taken outside Kaizen are consumer legal texts nobody has reviewed (section 8), and D158's rule is that a row resting on unreviewed text stays partial; (c) the admin screens are not clickable in CI. Full only when 9.7 and section 8 are done. |
| `orders.gift-receipts-and-messages` | 1 | missing | A | **Full.** The criteria are a store switch, three bounded fields on the cart copied to the order, a price-free slip and text cleaning: integration, view and storefront e2e tests hold all of them. The words are interface text, not legal text. |

No row of this run is bucket B, C or D. Nothing here needs a third party, a credential or an owner decision from `docs/parity-plan.md` section 5 (no second payment provider: a draft is paid through the Stripe
the store already has, or recorded as paid outside), so `blockers` is empty. The weight of a row is not changed here (rule 6 of the tracker).

Rows near this run that it **helps but does not close** (the lead may re-rate after reading the code; each stays below Full for the reason given):
`orders.packing-slips-and-pick-lists` (bulk printing of slips and the gift block on the slip are built here; there is still no pick list and no template choice),
`orders.fulfilment-workflow-partial-fulfilment` (bulk *Mark sent* is built here; sending lines and quantities in parts is not), `orders.edit-an-order-after-placement` (not touched),
`orders.staff-alerts-for-new-orders-order-automation` (not touched; tags are what its rules will later set), `orders.editable-notification-email-templates` (not touched).

### 1.2 What Shopify does (pages read on 2026-10-06; the four rows' own pages were read 2026-10-03)

- **Order list** (https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders): keyword search in the search bar; filters for status (open, archived), payment
  (unpaid, paid), fulfilment (unfulfilled, partially fulfilled, fulfilled), delivery method and more; six default views (All, Unfulfilled, Unpaid, Open, Archived, Local Delivery); **custom views are saved with filters,
  column arrangement and sort order, "only on your Shopify admin on your desktop computer"**; a view updates as orders change; the Order column is always first. **The page does not list the bulk actions or their limits**: the row's
  text (fulfil, print packing slips, capture payment, archive, cancel up to 250 at once, tags, labels, Flow) was read on 2026-10-03, but a fetch of the bulk-actions page on 2026-10-06 returned a page without them,
  so the 250 is taken from the row and used here as Kaizen's own limit.
- **Tags** (https://help.shopify.com/en/manual/shopify-admin/productivity-tools/using-tags): "Tags that are associated with orders and draft orders can have up to 40 characters"; up to 250 tags on each order; "Tags
  are not case sensitive"; only letters, numbers and hyphens are allowed (accented letters interfere with search); tags can be added and removed in bulk (desktop and mobile); orders can be filtered by tag; **"When you create an
  order from a draft order, the draft order tags are carried over and added as order tags."**
- **Archive** (https://changelog.shopify.com/posts/focus-on-the-right-orders-with-improved-order-archiving, 15 March 2022; https://help.shopify.com/en/manual/checkout-settings/order-processing, via search
  result): with *Automatically archive the order* on (Settings, General, Order processing), orders that are paid and fulfilled, fully or partly refunded, or with no balance are archived so they leave the Unfulfilled and Open
  views; most finished orders are archived by default; staff can archive by hand (order page, More actions, Archive orders); a return on an archived order unarchives it. The manual-archive page itself
  (https://help.shopify.com/en/manual/orders/archive-orders) was fetched and had no text on archiving.
- **Draft orders** (https://help.shopify.com/en/manual/orders/create-orders, https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft,
  https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/get-paid): a draft holds products, **custom items** (not in the catalogue, no inventory tracking), discounts at order and line level
  (amount or percent), **custom prices per line that replace the list price without showing a reduction**, shipping rates (preset, custom, pickup), taxes (on by default, can be switched off), a customer, tags and a market;
  **reserving inventory is an explicit option with an expiry date** (units become *committed*); staff **send an invoice that contains a link to the checkout page, or share the link themselves**; when the customer pays, the draft
  becomes an order and is marked Paid; staff can **mark it as paid** for money received by other means ("cash or bank deposit") and the customer gets the confirmation email; or take a card by hand (Shopify Payments only);
  if prices or shipping rates changed before payment staff must resolve it before the payment is captured; **the draft stays editable after the invoice is sent, and the edit does not update an invoice already sent**; drafts created
  from 1 April 2025 are deleted after a year of inactivity. **The pages do not say** when the order number is assigned or how long the checkout link stays valid; Kaizen's choices below are its own.
- **Gift receipts and messages** (https://help.shopify.com/en/manual/sell-in-person/shopify-pos/receipt-management/managing-receipts): a gift receipt in Shopify POS is "proof of purchase but doesn't contain the
  amount spent", for whole orders only, printed from the order or at the payment screen. **Nothing is said about gift messages or online gift receipts**: they come from App Store apps (the row, read 2026-10-03).

What Kaizen matches: search, filters in the address, saved views, bulk tag, archive and fulfil, 40-character case-insensitive tags (250 per order), archive and unarchive with automatic archiving as an option, drafts with
custom items, custom prices, an order discount, shipping choice, a pay link by email or to share, marking paid outside Kaizen, tags carried over, and a gift message with a price-free slip.
What it deliberately does not match in this run: section 7.

### 1.3 Terms used in this file

- **Order list**: the Orders page. **Built-in views**: *All*, *To send*, *Waiting for stock*, *Unfinished checkouts*, *Archived* (not stored; the first three and *Unfinished* are today's tabs). **Saved view**: a named
  filter, sort and column choice stored per store (3.2).
- **Tag**: a short staff label on an order (4.2). **Key**: the tag in its case-folded, trimmed form; two tags with the same key are one tag.
- **Archived**: an order with `archived_at` set. It is a visibility state only: it changes no amount, no number, no stock, no document and no counting in analytics.
- **Draft order** (a *draft*): a staff-made, editable quote that becomes a real order when sent. Its states are `open`, `sent`, `paid`, `expired`, `cancelled` (4.5). **Staff-made order**: an order with `source = 'draft'`.
- **Pay link**: `/s/{store}/{market}/account/pay/{token}`; the token is random, kept only as a hash, and a new link replaces the old.
- **Payment outside Kaizen** (a *manual payment*): a payment row with `provider = 'manual'` recording money that did not pass through Kaizen's Stripe (cash, bank transfer, other).
- **Gift order**: an order whose buyer marked it as a gift (`is_gift`), with an optional message, *To* and *From*. A **free gift line** is a different thing (D114, `order_lines.gift`, a product a campaign gives); the two are never
  called the same in code or text (`isGift`/`giftMessage` for the buyer's, `freeGift` for a campaign's).
- **Staff discount**: the order-level discount staff give on a draft (a percent or an amount, with a label the buyer sees). **Custom price**: a draft line's unit price entered instead of the list price. **Custom item**: a draft
  line with no product (a service or a fee).

### 1.4 Decisions this spec makes (the lead may veto any before the build; each is argued where it is used)

1. **A draft becomes an order when it is sent, not when it is paid** (4.5). The order is `pending_payment`, numbered from D141's sequence, stock is held for the draft's validity; paying completes it through the
   existing functions, expiry cancels it through the existing function. Reason: every later step (reservations, `complete_order_payment()`, the webhook, `cancel_unpaid_order()`, the order page, invoices) already works on an order.
   A draft that is never sent holds no stock and uses no number; one that expires keeps a *cancelled* order number, as every abandoned checkout does today (no gap, 4.5).
2. **A draft has its own small pricing function built from the checkout's building blocks**, not from a cart: `priceDraft()` (pure) calls the same `decideTax()`/`loadTaxFacts()`, `basketShipping()`, `shown()`,
   `vatIncluded()` and `allocate()` as `placeOrder()`, and the one insert of an order row and its lines is extracted from `placeOrder()` into `src/server/order-insert.ts` so there is **one place that numbers and writes an
   order**. Campaigns, the group discount, the welcome discount, discount codes and bonus credits do **not** apply to a draft: staff give the price or the staff discount they want.
3. **The pay link opens Stripe's hosted page, never Kaizen's embedded form.** The link is a Kaizen page that shows the order and a button; the button creates a fresh hosted Checkout session (they expire after 24 h at most) and
   redirects. So no Stripe.js and no new script origin on a new route, and PCI scope is the same as the fallback checkout (SAQ A, `docs/pci.md`).
4. **Money taken outside Kaizen is a real `payments` row** (`provider = 'manual'`, a `method`), so the order is paid by `complete_order_payment()`, the invoice and analytics need no special case, and **a refund of it is
   a real `refunds` row recorded as `succeeded` without calling Stripe**, so the credit note and the refund figures follow (4.6).
5. **Saved views are the store's**, shared by everyone who can read orders, made and changed by `orders:write`. (Shopify's page does not say whether a view is personal; Kaizen's rule is its own.)
6. **Gift fields live on the cart** (like the company name) and are copied to the order when it is placed; the store switches the feature on (`order_settings.gift_messages`, default off).
7. **Automatic archiving is opt-in** (`order_settings.auto_archive_days`, default off): no existing store's list changes without its owner choosing.
8. **The AI manager may make and send drafts but never record a payment**: no AI tool marks a draft paid.

---

## 2. Behaviour

### 2.1 Shopper side

**Gift.** In a store that has switched gift messages on (2.3), the cart page shows a *This is a gift* box (the `cart_gift` piece, 5.3) under the items: a tick, and when ticked the fields *To* (up to 60 characters), *From* (up to 60) and
*Message* (up to 300 characters, at most 6 lines, with a live counter, `maxLength` on the field and the number left written out). Nothing is required. Ticking and typing are kept on the cart (`setCartGift()`, a
server action, no cookie, no storage; the cart cookie that already exists carries it); unticking clears the three fields. The text is cleaned on the server (4.8); a message over the limit after cleaning is **refused with a message,
never silently cut**. Checkout copies the three fields and `is_gift` to the order when it is placed. A change to the gift fields after the order was placed makes the checkout start again, as a changed code does (`getOpenCheckout().changed`).
The order page, the thank-you page and My account show the buyer their own message under the lines ("Your gift message"); the confirmation email repeats it. **Nothing is ever sent to the recipient**: Kaizen has no recipient address
and sends no email, SMS or notice to a third party, and the *shipping notice* to the buyer never carries the message. A store with the switch off shows no box and ignores any gift fields sent to it.

**Pay link.** A shopper who gets a staff-made order opens `/s/{store}/{market}/account/pay/{token}` (from the email, or a link the store shared). The page, in the order's language, shows the store, the seller (legal name, organisation number, address and contact email, since the page has no site footer), the lines with
quantities and line totals (a custom price shown as the price agreed, never with a "was" price), the shipping, the staff discount under the name staff gave it, the VAT as the checkout shows it (a private buyer: included;
a business: as the store's audience setting says), the total, a note from the store if staff wrote one, the date the link is valid to, one sentence on the right of withdrawal with a link to the store's withdrawal-information page, and the store's terms sentence exactly as the checkout draws it (`terms_at_checkout`:
a link, or a link with a tick box that must be ticked). A line on backorder says so with the checkout's words (D172). One button, the checkout's label (`m.payNow`), sends the buyer to Stripe's page; the press records
the terms acceptance (`recordTermsForOrder()`) first, as the checkout does. States, each a plain sentence: **ready**; **paid** ("This order is paid", no way to pay again); **expired** or **cancelled** or **replaced** ("This link
no longer works. Ask the store for a new one", with the store's contact address); **payments off** (the store cannot take payments right now). An unknown or malformed token is the same 404 as any missing page (no
difference between "never existed" and "wrong"). The page sets no cookie, loads no tracking, chat or consent manager (`isNoExtrasPath()`), is `noindex`, and links nothing to Stripe until the button is pressed.
After paying, Stripe returns the buyer to the ordinary order page of that order (`/order/{id}?session_id=…`), which already shows the confirmation, documents and the right of withdrawal.

**Emails to the buyer.** (1) *The pay link* (`draft.pay_link`, 2.4): subject "{store}: your order {number} is ready to pay", the lines, total, the note, the button and the valid-to date, in the order's
language; (2) the existing order confirmation after payment (with the invoice link, D159, and the withdrawal block, D153), which for a staff-made order is sent when the order is paid, whether through Stripe or marked paid
outside. Both go to the one address staff typed or took from the customer, never to a second address.

### 2.2 Staff side: the order list (`/admin/{store}/orders`)

Needs `orders:read` to look and `orders:write` to change. The address is the state of the list (a bookmark and the back button work); the server reads it through one function, `parseOrderListParams()`
(`src/lib/order-list.ts`), which **drops every unknown key and ignores every invalid value** (never an error page, never raw text into SQL), and writes it back with `orderListQuery()` (a test holds that
`orderListQuery(parseOrderListParams(x))` is stable).

| Parameter | Meaning |
|---|---|
| `q` | Search text (2.2.1), up to 100 characters. |
| `show` | A built-in view: `to-send`, `waiting`, `unpaid` (unfinished checkouts), `archived`. Absent = *All*. The old `?show=` addresses keep working. |
| `view` | A saved view's id: its stored parameters are applied first, then any other parameter in the address overrides it. |
| `pay` | `paid`, `partially_refunded`, `refunded`, `balance_due` (something is still to be paid at the venue, D66), `unpaid` (no captured payment). One or several, comma-separated. |
| `ship` | `to_send` (paid, something physical to ship, not sent), `sent`, `waiting` (paid, backordered units), `no_shipping` (nothing physical). |
| `status` | The order's own status: `paid`, `fulfilled`, `cancelled`, `closed`. |
| `tag` | One or several tags (case-insensitive); all must be on the order. |
| `from`, `to` | A date range in **the store's own days** (`YYYY-MM-DD`, inclusive); or `range` = `7d`, `30d`, `90d`, `this_month`, `last_month` (relative, so a saved view stays useful). |
| `market` | A country code of the store's markets. |
| `source` | `checkout`, `draft` (staff-made), `copied` (history copied from another store). |
| `gift` | `1`: gift orders only. |
| `archived` | `no` (default), `yes` (only archived), `all`. |
| `sort` | `placed_desc` (default), `placed_asc`, `total_desc`, `total_asc`; ties always by `id`. |
| `after` | A cursor (opaque, base64url) for the next page; an invalid cursor is the first page. |
| `cols` | Visible columns (2.2.3). |

**Default list (*All*).** What the page shows today (everything but unfinished checkouts, copied history included) **minus archived orders**. Choosing any of `pay`, `ship`, `source` other than `copied`, or `status` is
a statement about real sales, so **copied orders never match them** (they appear in *All*, in *Archived*, in `source=copied` and in search).
*Unfinished checkouts* (`show=unpaid`, or `pay=unpaid`) are `pending_payment` orders and `cancelled` orders that were never paid, as today; a draft's sent-and-unpaid order is one of them until paid (it shows a *Draft D-12*
badge) and is also listed on the drafts page (2.4).

**2.2.1 Search.** One box. The text is normalised (Unicode NFC, whitespace collapsed, trimmed), cut to 100 characters and split into **at most 5 words** (more are ignored, and the page says so); a word shorter
than 2 characters is ignored unless it is all digits. **Every word must match** (AND); a word matches an order when **any** of these holds (`%`, `_` and `\` in the word are literals, never wildcards):

1. its **order number** (the word with a leading `#` and spaces removed, upper-cased, equals the normalised number or is a prefix of it; only for a word with a digit);
2. its **email** contains the word (`lower(o.email) like`), **and the order is not restricted or anonymised** (`o.restricted_at is null and o.anonymised_at is null`, D162);
3. a **name** on it (shipping or billing name) contains the word, with the same guard;
4. a **line's title or SKU** contains the word (`order_lines`, this store's order only);
5. one of its **tags** equals or starts with the word;
6. a **tracking number** of one of its shipments equals the word (case-insensitive, exact).

Phone numbers, street addresses and postal codes are **not searchable** (the page does not need them and this keeps the personal surface small). A store sees only its own orders: every sub-query carries `store_id`.
The result is ordered by the chosen sort, paged (below), and the page says how many orders match ("37 orders", or "10,000+" above a cap of 10,000 counted).

**2.2.2 Paging.** 50 orders a page (`ORDERS_PAGE_SIZE`), **keyset** on the sort key and `id`, so a page boundary never loses or repeats an order whatever happens to the list meanwhile, and 250, 10,000 or more orders
page the same way. *Next* and *Previous* links carry the cursor; there are no page numbers.

**2.2.3 Columns.** *Order* is always first. The others are `placed`, `customer`, `market`, `payment`, `fulfilment`, `items`, `total`, `tags`, `source`, in a fixed order, shown or hidden by tick boxes; the default is
`placed, customer, payment, fulfilment, items, total, tags`. The choice travels in `cols` and is stored in a saved view. A badge *Archived*, *Gift*, *Draft D-n*, *Waiting for stock*, *Copied* shows beside the number
whatever the columns.

**2.2.4 Saved views.** Above the list: the built-in views, then the saved ones in their order, then *Save as view*. A saved view stores exactly what the address holds except `after` and `q` is kept (staff may save a
search), plus the columns: **title** (1 to 40 characters, unique in the store ignoring case), **parameters** (only the keys of the table above, validated by `parseOrderListParams()` on the way in and again on
the way out), **columns**, **position**. At most **30** per store. Anyone with `orders:read` can open one; `orders:write` creates, renames (with new parameters: *Update view*), reorders and deletes. Opening a view
gives the same orders as typing its parameters. A view of another store is never found (its id with this store's slug is a 404 or a refusal, never data). Saving works on every screen size. Each change writes an audit
entry (`order.view_saved`, `order.view_deleted`: the title and the number of parameters, never the search text).

**2.2.5 Bulk actions.** A tick box on every row, a *Select all on this page* box, and (when 250 or fewer orders match) *Select all {n} matching*; the bar then offers the actions of the table. The server never trusts a
list for "all matching": it re-runs the same query (store id, the address's parameters) and takes its ids. A request names at most **250** orders (`BULK_MAX`); more is refused with a sentence. Duplicates collapse.
Each order is handled **in its own transaction, one after another**, so a refusal or a failure on one never undoes the others; the answer is `{ requested, applied, refused: [{ number, reason }] }` and the page shows
"Applied to 41 of 43 orders" with the refused ones and their reasons in words. An id that is not this store's is reported as *not found* and never revealed.

| Action | Needs | Applies to | Refused with (code: words) |
|---|---|---|---|
| Add tags / Remove tags | `orders:write` | any order of the store, copied history included | `tag_limit`: the order already has 250; `invalid_tag` (never per order: refused before anything runs); `not_found` |
| Archive | `orders:write` | an order that needs no more work (4.3) | `needs_sending`, `unfinished_checkout`, `open_return`, `already_archived`, `not_found` |
| Unarchive | `orders:write` | any archived order | `not_archived`, `not_found` |
| Mark as sent | `orders:write` | a paid order with something to ship, not yet sent (no tracking number: carrier *Other*, empty tracking) | `copied`, `unpaid`, `nothing_to_send`, `already_sent`, `withdrawn_in_full`, `waiting_for_stock` (units on backorder: staff send it from the order), `delivery_unpaid` (a weekly box waits for its charge, D102), `changed` (it moved while the batch ran), `not_found` |
| Print packing slips | `orders:read` | orders with something physical to ship; opens one document (2.5), at most **100** orders | skipped on the page: `copied`, `nothing_to_ship`, `not_found` |

*Mark as sent* has a tick **Tell the customers** that is **off** by default and says how many emails it will send ("37 customers will get an email"); with it on, each order's *shipped* email (with no tracking line)
goes out through the existing `sendShipped()`. The batch never charges a card and never refunds. One audit entry per batch with the counts (`order.bulk_tagged`, `order.bulk_archived`, `order.bulk_unarchived`,
`order.bulk_sent`), never the numbers; each order's own history also gets its event (2.3). Closed and suspended stores may tag and archive (the `orders` key is allowed there) and may not mark as sent
(`orders_store_open()` does not stop that, so the server checks `store_is_active()` and refuses it with a sentence).

### 2.3 Staff side: tags, archive, gift on the order, settings

**Tags.** The order page has a *Tags* card: the tags as chips with a remove cross, and a field to add (type, comma or Enter, with the store's tags in use as suggestions, the 200 most used). Adding a tag that exists
in another case is the same tag (the first spelling on the order stays). A tag is 1 to 40 characters after trimming and collapsing spaces, not containing a comma or a control character; at most 250 on an order
(4.2). Every change is one history event on the order, `order.tags_changed`, whose `data.note` says it in words ("Added: vip, late. Removed: test") and nothing else (so the erasure of 2.7 covers it). The list
shows the tags in a column and filters by them (`tag=`); the filter lists the store's tags with counts. A tag on a **draft** moves to the order when the draft is sent. **A copied order** can be tagged and archived and nothing
else about it changes (3.3).

**Archive.** The order page has *Archive* (and *Unarchive* on an archived one), with the reason when refused (4.3). Archiving writes `order.archived`, unarchiving `order.unarchived`. An archived order **leaves the
default list and every queue except its own view**, stays searchable, readable, refundable and countable, keeps its number, and `order_number_audit()` reads the same before and after. **A new return or
withdrawal on an archived order unarchives it** (event `order.unarchived` with `data.note` "A return was started"). *Automatic archiving* (Settings, Orders): when `auto_archive_days` is set (14 to 365), the
five-minute job archives orders that need no more work (4.3) and whose last event is older than that many days, in batches of 200 per store, only in open stores; the event is `order.archived` with actor `system`.

**Gift on the order page.** A *Gift* card for a gift order: To, From, the message in full (preserving line breaks, as text), and a *Print gift slip* link (2.5). The list has a *Gift* badge and a `gift=1` filter. Staff **cannot edit**
the buyer's gift text after the order is placed (the database refuses, 3.3); a buyer's request to remove it is a note on the order and the slip is simply not printed with it (not built, section 7).

**Settings (`/admin/{store}/settings/orders`, owner and `settings:write`).** *Gift messages* (on/off), *Automatic archiving* (off, or after N days), *Draft order links are valid for* N days (1 to 30, default 7),
*Staff may record payments taken outside Kaizen* (off by default: then **only the owner** may use *Mark as paid outside Kaizen*; on: anyone with `orders:write`). A short, plain warning sits beside the
payment option (section 8, item 6).

### 2.4 Staff side: draft orders (`/admin/{store}/orders/drafts`)

Needs `orders:write` for everything except looking (`orders:read`). The Orders section of the store navigation gains *Draft orders* beside *Orders*.

**The list.** Drafts newest first (paged 50, keyset), with the number (`D-1`, `D-2`, a per-store counter without a promise of no gaps), customer, total, status and the date; a filter by status (`open`, `sent`,
`paid`, `expired`, `cancelled`); a *New draft* button. A **store has at most 500 open drafts**; more is refused with a sentence.

**Making a draft** (`/orders/drafts/new`, then `/orders/drafts/{id}`). The editor is one screen with:

- **Market** (a country of the store, with the language and currency view it shows, `{country}[-{lang}][-{currency}]`, D109): chosen first, because it decides the prices, the currency and the VAT country. Changing
  it after lines were added re-prices catalogue lines at the new market's list price and **tells staff which prices changed** (a custom price stays as typed, in the new currency, and is flagged).
- **Customer**: search an existing customer (the picker shows name and email only, and needs no more than `orders:write`) or type an **email** (a guest); name, phone and the shipping and billing
  address; for a business, the company name and organisation number (checked by `organisationNumber()`, as in the cart). The draft's email is **required to send, not to save**.
- **Lines**: add a product variant (search by title or SKU: goods only, active, `sellable` in this market; *not* downloads, subscriptions or plans, appointments, stays, rentals, hosts' listings, which a draft cannot sell
  in this run, 7) with a quantity (1 to 9,999), or a **custom item** (title up to 120 characters, a price, a quantity, a VAT category from `commerce.vat_categories`, delivery `service`: no stock, no shipping). The price
  of a catalogue line starts as the market's **list price as shown** (`shown(market, amount)`) and is stored on the line as `list_price_minor`; staff may type a **custom price** (VAT included, in the draft's currency, 0 or
  more). A line may be removed and the order of lines changed. At most **100 lines**.
- **Discount**: none, a **percent** (0.01 to 100.00, two decimals) or an **amount** (not above the goods), with a **label** (up to 60 characters, default "Discount", **shown to the buyer** on the pay page, the order and the
  invoice, so the editor says "the buyer sees this"). It applies to the goods, never to shipping or fees.
- **Shipping**: *The market's rate* (the flat rate and its free-over limit, as the checkout works it out), *Free*, or *A price I set* (VAT included). With no physical line the shipping is none and the control is hidden.
- **Notes**: *Note to the buyer* (up to 500 characters, shown on the pay page and in the email, cleaned like any shopper-bound text), *Internal note* (up to 1,000, never shown to the buyer), **tags** (4.2).
- **The summary** beside it is worked out on every change by the server function `previewDraft()` (the same `priceDraft()` the sending uses, never a number computed in the browser): lines, discount, shipping, the VAT
  per rate, the total, the unit price per kg or litre where the variant has one (D160), and **problems** in words (no email, no line, a physical line and no shipping address, a variant not sellable, a stock shortage
  or backorder, a market that no longer exists, a total of 0).

Saving is explicit (*Save draft*); nothing holds stock or a number while a draft is `open`.

**Sending.** *Send to the customer* (needs payments on; email and at least one line; no problems) does, in one transaction through `placeDraftOrder()`: re-reads the store, market, variants and prices' sellability; takes the locks
and allocates stock exactly as `placeOrder()` does (a variant that stops at zero fails the send with `stock`; one on backorder is sold with the days stated, D172); inserts the order (`source = 'draft'`, `draft_id`,
`made_by`, the next order number, `pending_payment`, the customer's email, the typed addresses, the staff discount, `return_cost_payer`, `standard_shipping_minor`, the frozen VAT treatment) and its lines through the **one shared
insert**; holds the stock until the draft's `expires_at` (**now + the validity in days**, the setting, default 7, at most 30, adjustable on the send dialog); copies the tags to the order; sets the draft `sent`
with `order_id`, `sent_at`, `expires_at` and a **new pay token** (only its hash is kept); writes the order's `order.placed` event with actor `staff` and `data.draft` the draft's number. After the commit the email
`draft.pay_link` is sent (a failed email leaves the draft sent and says so: staff may *Send again*, which rotates the token). *Send again* is limited to 5 times a day per draft, and the store to 60 sends an hour (`chat_usage`
bucket `draft:send`, taken atomically). **Create a link to share** does the same without the email and shows the link **once** on the screen to copy (the hash is all that is kept); making a new link kills the old one.
The sent draft is **read-only**: *Edit* means *Reopen*, which closes any open Stripe session, cancels the unpaid order through `cancel_unpaid_order()` (its number stays, cancelled; stock is released), kills the pay link and
returns the draft to `open` with its contents; sending it again makes a new order and a new number. (Shopify lets a sent draft be edited; Kaizen makes the link always pay exactly the order it was sent for.)

**Paying.** (a) The buyer pays through the link (2.1): `applySession()` completes the order as for any checkout, the existing confirmation, invoice, customer link and booking steps follow, and the draft becomes `paid` (a
trigger, 3.3). Kaizen's sale fee is taken on the Stripe payment as for any order. (b) Staff **record a payment outside Kaizen**: *Mark as paid outside Kaizen* on an open or sent draft, with a **method** (*Bank transfer*, *Cash*,
*Other*) and an optional **reference** (up to 200 characters; goes in the order event's `data.note`); a sent draft first closes its Stripe session (if the session was paid meanwhile the action refuses, "this was already paid
through Stripe" and the order completes through the webhook as normal). The server (`markDraftPaidOutside()`) inserts the order if the draft is still `open` (as sending does, but with no pay link and a validity of 1 day), writes a
`payments` row (`provider = 'manual'`, the method, `status = 'captured'`, amount the order's total, `kaizen_fee_minor` 0, `recorded_by` the staff member, reference `manual_{uuid}`), then calls
`complete_order_payment()` (stock is drawn, the invoice is issued, the order is `paid`), writes the order event `order.paid_outside` (`data.method`, `data.note`) and the audit entry `order.draft_paid_outside`,
and sends the confirmation email, which is **not optional** (it is the confirmation on a durable medium and states the right to withdraw, 4.7; a draft with no email cannot be paid outside Kaizen). **Kaizen takes no sale fee on money it never touched**; this is said on the screen.
Who may: the owner always; others with `orders:write` only when the store setting allows (2.3), else the button is not drawn and the action refuses.

**Refunding and cancelling a staff-made order paid outside Kaizen.** The refund form on the order page, for an order whose captured payment is `manual`, says "This was paid outside Kaizen: pay the customer back yourself, then record
it here" and, on submit, **records** the refund: a `refunds` row (`status = 'succeeded'`, reference `manual_refund_{uuid}`, the amount, the reason, `created_by`) **with no call to Stripe**, the units put back as usual, the event
`order.refunded_outside`; the credit note follows from the existing trigger (D159) and the refund counts in analytics like any succeeded refund. The amount cannot exceed what is left (`refundableMinor` counts manual
payments). *Cancel* on a paid, unsent manual order refunds the whole of it the same way and puts everything back. Returns (D153) on such an order record the refund as they do today for an order paid elsewhere, now with the
amount (the existing `outside` path keeps amount 0 for payments that are `venue`; a manual payment uses the recorded-refund path).

**Expiry.** When `expires_at` passes (`expireDrafts()`, the five-minute job; the pay page also treats a passed time as expired without waiting for the job): a Stripe session still open for the order is closed first with
`closeSession()`; if it turns out **paid or processing** the order is completed (or left to the webhook) and **not** cancelled; otherwise `cancel_unpaid_order()` releases the stock and cancels the order (reason "draft expired"),
the payment row is marked cancelled, and the draft becomes `expired`. Its **number stays on the cancelled order, so the sequence has no gap** and `order_number_audit()` is clean (4.5). A Stripe session's own 24-hour
expiry never cancels a draft's order (`applySession()` skips `cancelUnpaidOrder()` for an order with a `draft_id`; the pay link makes a new session on the next press). A closed store: its drafts are marked `cancelled` by the
same job (the closure already cancelled their orders).

**Deleting.** An `open` draft can be deleted (a real delete: nothing else points at it). A `sent` draft is *Reopened* first. `paid`, `expired` and `cancelled` drafts are kept 30 days and then deleted by
`pruneDraftOrders()` (4.5, 3.6); an `open` draft is deleted after 90 days without an edit (Shopify keeps a year; Kaizen keeps less personal data).

### 2.5 Packing slips: one, many, and gift

The existing slip (`/orders/{id}/packing-slip`) stays: in the order's language, the deliver-to address, the number and date, the physical lines with quantity and SKU, **no prices, no VAT, no totals, no payment
or discount words, no invoice number**. For a **gift order** it gains, above the lines, a block *A gift for {To}* / *From {From}* and the **message** (as text, line breaks kept, `white-space: pre-line`), and nothing
else changes: it is by construction a price-free slip, and the *Print gift slip* link opens the same page. A staff-made order's slip shows its note to the buyer only if it was marked *print on the slip* (not built, 7).
Bulk printing (`/admin/{store}/orders/packing-slips?ids=…`, at most 100 ids, `orders:read`): one document, **each order on its own printed page** (`break-after: page`), each in its own language, only orders with something
physical to ship, copied history and other stores' ids skipped with a line saying why at the top (not printed). It changes no state (there is no "printed" flag).

### 2.6 Platform side, emails, AI manager

- **Platform:** no new platform page. One row in the plan comparison (D132, 5.5) describes the features; it enables nothing.
- **Emails:** one new kind, `draft.pay_link` (class `shopper`, in `EMAIL_KINDS`); existing kinds gain a gift paragraph (the confirmation) or nothing (the shipped notice, which never carries the message). The new wording is in
  `src/lib/email-text.ts` (nb, sv, da, en by hand, flagged for review, kept out of the AI catalogue: `HAND_WRITTEN_ONLY`).
- **AI manager:** `list_orders` gains the search, the filters and a page; new tools `tag_orders`, `archive_orders` (ungated: internal labels and a visibility flag), `list_draft_orders`, `create_draft_order` (a draft only, nothing
  sent), `send_draft_order` (**gated `send`**: it emails a customer and holds stock, kept for the owner's yes with `approvalSummary()`). **There is no tool that records a payment** and none that deletes a draft or refunds.
  Each tool answers from the same server functions (never a model's number) and is in `TOOL_WORDS`, `TOOL_PERMISSIONS` and served to Kaizen Life with the other owner tools.

### 2.7 Copied orders, host orders, subscriptions, other currencies, other languages, privacy, closed stores

- **Copied orders (D129):** can be **tagged and archived** (and are listed, found by number, line or tag, and opened, but never printed on a slip) and nothing else: every other write is still refused by the database. They are never in
  *To send*, *Waiting for stock* or a `pay`, `ship` or `source=checkout|draft` filter, never marked sent in bulk, never drafted. Their tag events and archive events are the only events they accept besides `copied`.
- **Hosts' orders (D71):** listed and tagged and archived like any order; **a draft cannot sell a host's listing** (7); a host's order is never made by a draft. Bulk *Mark as sent* applies to them as `markSent()` does today.
- **Subscription renewals and weekly boxes (D25, D102):** listed, tagged and archived like any order; bulk *Mark as sent* refuses a weekly box whose card has not been charged (`delivery_unpaid`) and sends the others through
  `markSent()`; a draft cannot sell a subscription.
- **Other currencies and markets (D109):** a draft is made for a market view, priced and stored **in the currency that view shows**, as an order is (`orders.currency`); amounts are never converted again after the draft is saved
  (the list price is converted when a line is added or the market changed, with `shown()`); every money read here has a **euro scenario** (a euro view of a krone store) in `checkout-kinds.int.test.ts`. The list shows each order's
  total in its own currency; no sum across currencies is made on this page.
- **Languages:** admin screens are English only. Everything a shopper reads (the gift box, the pay page, the pay-link email, the packing slip's gift block) is by language of the order or market: nb, sv, da and en by hand;
  other languages show English for the legal and legal-adjacent words (`HAND_WRITTEN_ONLY`) and are machine-translated into the catalogue for the plain words (the gift box labels). A slip is printed in the **order's language**.
- **Privacy:** a gift message, *To* and *From* are personal data of the buyer and name a third party; they are exported with the buyer's orders, and erased by the existing order anonymisation (3.7). A draft's contact data is
  the buyer's personal data and is kept as short as 3.6 says. Tags and the internal note are staff text; the editor says "do not write about a person" and the erasure removes what is in `data.note`. Search never finds an erased
  person by email or name.
- **Closed or suspended store:** staff may list, search, tag, archive and print; **sending or paying a draft, and a bulk send, are refused** with "this store is not open" (the order insert is refused by `orders_store_open()` and
  the server says it plainly first).

### 2.8 Failure behaviour

- **A refused or failed item in a bulk action** is reported, never hidden, and never stops the others (2.2.5). A request over 250 orders, an empty selection or an unknown action is refused before anything runs.
- **A saved view whose parameters no longer parse** (a market was removed, a tag is gone) opens with the valid ones and says "Some of this view's settings no longer apply".
- **Search that matches nothing** says so and offers *Clear*; a search that is too broad is capped at the count cap and the page says "10,000+".
- **Sending a draft:** a variant gone or not sellable, a stock shortage, a market removed, payments off, a closed store, a total of 0 or a payment provider minimum that Stripe refuses: the draft stays `open`, **nothing is written** (one
  transaction), and the sentence says which line or why. A Stripe failure while creating the session on the pay page leaves the order as it was and the buyer on the same page with "The payment could not be started. Try again, or
  contact the store."
- **The pay-link email fails to send:** the draft is `sent` and the order exists; staff see "The email could not be sent" with *Send again* and *Create a link to share*.
- **Two staff at once:** a draft has a `version` that every save must present; the second save of an old version is refused with "This draft was changed by someone else: reload". Sending and paying lock the draft row.
- **A payment arrives for an order the draft expired meanwhile** (the Stripe session was still open): the job closes the session first; if the buyer paid in that window the order completes (`complete_order_payment()` accepts a cancelled order and
  reports `stock.short` if the stock was sold, which the order page shows); staff are not told by email in this run (7).
- **The pay page when Stripe is switched off**, the draft's order paid, expired or cancelled: the states in 2.1.
- **A gift message in the cart over the limit:** the cart page says how many characters are over; nothing is saved until it fits; checkout is not blocked by an empty message.
- **Archiving a returned order** is refused with `open_return` until the return is done; a refusal is a sentence, not an error page.

---

## 3. Data

All additions are **additive** (the code that is still running keeps working until the deploy finishes): columns have defaults or are nullable, nothing is renamed or dropped except one check constraint that is
re-added in the same file (3.3). Every new table has RLS on and no policy (the `commerce` schema is private to the server), every composite foreign key an index, and a `store_id` that every statement names.

### 3.1 Columns added to existing tables

| Table | Column | Type and rule |
|---|---|---|
| `orders` | `archived_at` | `timestamptz null`. Set = archived. Check `orders_archived_not_pending`: `archived_at is null or status <> 'pending_payment'`. Writable on a copied order (3.3). |
| `orders` | `source` | `text not null default 'checkout'`, check `in ('checkout', 'draft')`. Renewals, weekly boxes and copied history stay `checkout` (their own markers are `subscription_id`, `standing_deliveries`, `copied_from`). |
| `orders` | `draft_id` | `uuid null`. **No foreign key** (like `copied_from`): a draft is deleted by retention while its order lives on. Unique with `store_id` per live attempt is not needed; several orders may name one draft over time. |
| `orders` | `made_by` | `uuid null references accounts(id)`: the staff member who sent or paid the draft. Null for every other order. |
| `orders` | `staff_discount_minor` | `bigint not null default 0`; check `between 0 and discount_minor` (it is a part of `discount_minor`, like `credit_minor`; `OrderView.discountMinor` leaves it out and shows it as its own row). |
| `orders` | `staff_discount_label` | `text null`, 1 to 60 characters when set; non-null only when `staff_discount_minor > 0`. |
| `orders` | `is_gift`, `gift_to`, `gift_from`, `gift_message` | `boolean not null default false`; `text null` up to 60, 60 and 300 characters. Check `orders_gift_fields`: `is_gift or (gift_to is null and gift_from is null and gift_message is null)`. Frozen once written (3.3). |
| `order_lines` | `list_price_minor` | `bigint null`: the market's list price as shown when a draft line was added; null when the price is the list one and for every order that is not a draft's. Never read by any total. |
| `order_lines` | `custom` | `boolean not null default false`: a custom item (no variant, `sku = 'CUSTOM'`, `delivery = 'service'`). A sign-up fee line is not custom (its sku is `SIGNUP-FEE`). |
| `order_lines` | `staff_discount_minor` | `bigint not null default 0`, a part of the line's `discount_minor` (the existing component columns `member_`, `campaign_`, `bonus_`, `referral_` and `vat_relief_` are its siblings); the sum of the components never exceeds `discount_minor`. |
| `carts` | `is_gift`, `gift_to`, `gift_from`, `gift_message` | As on `orders`, same checks. Cleared when the cart is converted or expires, like the rest of the cart. |
| `payments` | `method` | `text null`, check `in ('cash', 'bank_transfer', 'other')`; **set if and only if `provider = 'manual'`** (check `payments_manual_method`). |
| `payments` | `recorded_by` | `uuid null references accounts(id)`: who recorded a manual payment. |

`commerce.payments.provider` has no check constraint today; `'manual'` is a new value, never inserted by the shopper's side. A manual payment has no `provider_account`, so every query that joins a payment to
`connected_accounts` (`refundOrder()`, `getOrderAdmin()`, host and return code) leaves it out **by design** and must be read for it explicitly (5.2 lists them; `payment-readers.scan.test.ts` (6.5) fails for a reader of
`provider = 'stripe'` or `provider = 'venue'` that is not named in its allow-list with the reason).

### 3.2 New tables (all in `commerce`)

**`order_tags`** (store-owned; one row per tag on an order): `store_id`, `order_id`, `key text` (trimmed, case-folded), `label text` (as first typed on this order), `created_by uuid null`, `created_at`. Primary key
`(order_id, key)`; composite foreign key `(store_id, order_id)` to `orders` (`on delete restrict`; orders are never deleted); index `(store_id, key, order_id)` for the filter and the suggestions. Checks: `char_length(label)
between 1 and 40`, `char_length(key) between 1 and 40`, `label = btrim(label)`, `label !~ '[,\u0000-\u001f\u007f]'`. **It is not a table the copied-order guards are installed on**: a copied order may have tags.

**`order_views`** (saved views): `id uuid pk`, `store_id`, `title text` (1 to 40; unique `(store_id, lower(title))`), `params jsonb` (an object; `pg_column_size(params) < 4096`), `columns text[] null`,
`position int not null`, `created_by uuid null references accounts(id)`, `created_at`, `updated_at`. At most 30 per store (a trigger). The column is `title`, not `name`, so the privacy detector (`name` is a person's name column)
does not read it as personal.

**`order_settings`** (one row per store, made lazily with the defaults when read): `store_id pk`, `gift_messages boolean not null default false`, `auto_archive_days int null` (null or 14 to 365), `draft_valid_days int not null default 7`
(1 to 30), `staff_mark_paid boolean not null default false`, `next_draft_number bigint not null default 1`, `updated_at`.

**`draft_orders`**: `id uuid pk`, `store_id`, `number text` (`D-{n}`, unique per store), `status text` (check in `open, sent, paid, expired, cancelled`), `version int not null default 1` (raised by every save: optimistic
concurrency), `market_code char(2)` (composite foreign key to the store's market), `market_slug text` (the view: `no`, `no-en-eur`), `currency char(3)`, `locale text`, `customer_id uuid null` (composite foreign key, `on delete set null`),
`email text null`, `phone text null`, `shipping_address jsonb not null default '{}'`, `billing_address jsonb not null default '{}'`, `company_name text null`, `organisation_number text null`, `note_to_buyer text null` (up to 500),
`internal_note text null` (up to 1,000), `tags jsonb not null default '[]'` (labels, validated like order tags), `discount_kind text null` (`percent`, `amount`), `discount_value bigint null` (basis points 1 to 10,000, or minor units),
`discount_label text null` (up to 60), `shipping_kind text not null default 'rate'` (`rate`, `free`, `custom`), `shipping_minor bigint null`, `valid_days int null` (1 to 30), `order_id uuid null` (composite foreign key to
`orders`), `sent_at`, `expires_at`, `paid_at`, `pay_token_hash text null` (sha-256 of a 32-byte random token, hex; unique where not null), `pay_sends_today int`, `pay_sent_on date`, `created_by uuid references accounts(id)`,
`created_at`, `updated_at`, `edited_at` (the inactivity clock). Checks keep the discount, shipping and validity fields consistent (`discount_kind is null` iff value and label are null; `shipping_kind = 'custom'` iff `shipping_minor`
is not null). The detectors read `email`, `phone`, `shipping_address`, `company_name` and `note_to_buyer` as personal: its register entry is in 3.7.

**`draft_order_lines`**: `id uuid pk`, `store_id`, `draft_id` (composite foreign key, `on delete cascade`), `position int`, `variant_id uuid null` (composite foreign key to `product_variants`), `title text` (up to 200;
a catalogue line's title is the product's title and options as `placeOrder()` writes it, in the market's language), `sku text`, `quantity int` (1 to 9,999), `unit_price_minor bigint` (0 or more, VAT included, the draft's currency),
`list_price_minor bigint null`, `vat_category text null` (custom items only; foreign key to `vat_categories`), `delivery text` (`physical` for a variant of goods, `service` for a custom item). Checks: a custom line has no variant, a
category, `delivery = 'service'` and no list price; a catalogue line has a variant, a list price and no category. At most 100 lines per draft (a trigger).

### 3.3 What the database itself enforces (PGlite tests in `src/db/orders-ops.test.ts`, 6.5)

1. **Tags**: the 250-per-order limit (a trigger `order_tags_limit()`, so two bulk runs cannot both pass it), the label and key checks, the uniqueness of `(order_id, key)`.
2. **Saved views**: at most 30 per store (a trigger), unique case-insensitive title.
3. **Archive**: `orders_archived_not_pending`; `archived_at` is the only column of an order that changes on a copied order besides `customer_id` and the anonymising fields: **`commerce.copied_orders_read_only()` is patched**
   (`pg_get_functiondef` and a text replace on its first test, raising when the anchor is not found, exactly as `20261004174402_gdpr_rules.sql` did) so `to_jsonb(NEW) - 'customer_id' - 'archived_at'` is compared;
   **`commerce.refuse_copied_order_event()` is patched** to accept `copied`, `order.tags_changed`, `order.archived` and `order.unarchived`. A copied order still refuses every other update, its lines, and every other event
   (the existing tests stay green and gain the two allowed cases).
4. **Gift is frozen**: a trigger `orders_gift_frozen()` refuses a change to `is_gift`, `gift_to`, `gift_from` or `gift_message` after the insert, except to null while `current_setting('commerce.anonymising', true) = 'on'`
   (the erasure's own setting, D162). **`commerce.anonymise_order()` is patched** to null the three text fields and `is_gift`; the check `orders_anonymised` is dropped and re-added with the gift fields null
   (`ALTER TABLE … DROP CONSTRAINT`, outside any function).
5. **Staff discount arithmetic**: `orders_staff_discount` (between 0 and `discount_minor`), the existing `orders_total_adds_up` and `orders_amounts_non_negative` hold for staff-made orders unchanged; on `order_lines` the
   sum of the discount components never exceeds `discount_minor`.
6. **Payments**: `payments_manual_method` (a method iff `provider = 'manual'`); `payments_amount_positive` still holds; `payments_venue_mode` leaves a manual payment `test_mode = false` (a manual payment is real money
   whatever mode Stripe is in). A manual payment on a copied order is refused by the existing `payments_refuse_copied_order`.
7. **Draft lifecycle** (`draft_orders_rules()`, forward only like `returns`): `open → sent`; `sent → paid | expired | cancelled | open` (reopen); `expired → open`; `cancelled → open`; `paid` is final; no other move.
   `order_id`, `sent_at`, `expires_at` and the pay token are written only with `status = 'sent'`; **a draft that is not `open` refuses changes to its lines, prices, discount, shipping and customer** (and its lines refuse
   insert, update and delete); `version` only goes up; a draft is deleted only while `open`.
8. **A draft's order follows it** (`orders_draft_follow()`, an AFTER UPDATE OF `status` trigger on `orders`, like `orders_bookings_follow`): an order with `draft_id` that becomes `paid` marks its draft `paid` (if the draft is
   `sent` and names that order); one that becomes `cancelled` from `pending_payment` marks its draft `expired` if the draft is still `sent` for it (a reopen sets the draft `open` before it cancels, so this does not fire).
9. **Numbers (D141) are untouched**: an order's number, its series and its gap-free property are unchanged; a draft's `D-n` is a separate counter and is never an order number. `order_number_audit()` stays clean
   after any sequence of sends, expiries, reopens and archives (a PGlite property test).
10. **A staff-made order** has `source = 'draft'` iff `draft_id is not null`, and `made_by` is set (check `orders_source_draft`). It is otherwise an ordinary order: the invoice, credit note, reservation and withdrawal
    functions do not look at `source`.
11. **The invoice's payment section learns a third kind.** `commerce.issue_order_invoice()` is patched (anchor on `jsonb_build_object('kind', 'paid_online', 'amountMinor', v_online, 'provider', v_provider)`): when the first
    non-venue payment is `manual` the entry is `{ kind: 'paid_outside', amountMinor, provider: 'manual', method }` instead; `buildInvoiceSnapshot()` (the oracle), `OrderDocumentView` and `src/lib/invoice-text.ts` learn it, and
    `invoice-parity.test.ts` gets a manual-payment fixture. `payment_on_invoice()` and `invoice_eligibility()` need no change (a manual payment is neither a no-show fee nor a test payment).
12. **Which payments count as "online"** in `getOrderAdmin()`: `paidMinor` stays all captured; `refundableMinor` counts `stripe` **and `manual`**; `canRefund` is a captured Stripe payment on a connected account **or** a captured
    manual payment (the refund path then differs, 2.4).

### 3.4 Functions and the shared reads

- `commerce.next_draft_number(store uuid) returns text`: `update commerce.order_settings … returning` under the row lock, creating the row if missing (the only writer of `next_draft_number`).
- `commerce.order_tag_counts(store uuid, limit int)`: the store's tags with counts (for the filter and the suggestions), `STABLE`, `search_path = ''`.
- Application-side single sources: `orderListWhere()` in `src/server/order-list-sql.ts` is the **one** SQL builder for the list, the count, the "all matching" selection of a bulk action, the saved views and the AI tool (a test holds
  that nothing else builds a list condition); `parseOrderListParams()` is the one parser; `archiveBlock(order)` (pure, 4.3) the one rule for archiving, used by the single action, the bulk action and the automatic job.

### 3.5 Indexes (the search and the list must stay fast for a store with tens of thousands of orders; `order-list-perf.int.test.ts`)

`pg_trgm` lives in the `extensions` schema: write `extensions.gin_trgm_ops`. New: `orders_search_email_idx` gin `(lower(email) extensions.gin_trgm_ops) where restricted_at is null and anonymised_at is null` (the search's
own guard, so the planner can use it); `orders_search_name_idx` gin on `lower(shipping_address ->> 'name')` and a second on `lower(billing_address ->> 'name')`, same predicate; `order_lines_search_title_idx` gin
`(lower(title) extensions.gin_trgm_ops)` and `order_lines_search_sku_idx` on `lower(sku)`; `shipments_tracking_idx` `(store_id, lower(tracking_number))`; `orders_list_placed_idx` `(store_id, placed_at desc, id desc)
where archived_at is null`, `orders_list_archived_idx` `(store_id, placed_at desc, id desc) where archived_at is not null`, `orders_list_total_idx` `(store_id, total_minor, id)`; `order_tags_key_idx` as above;
`draft_orders_store_idx` `(store_id, status, updated_at desc)`; `draft_orders_expiry_idx` `(expires_at) where status = 'sent'`; `draft_orders_token_idx` unique `(pay_token_hash) where pay_token_hash is not null`.
Trigram indexes add write cost on every order and line insert, which is on the payment path; the performance advisor is checked after the deploy (9.3).

### 3.6 Retention

- **Draft orders** (`pruneDraftOrders()` in `runRetention()`, daily, application code): an `open` draft with no edit for **90 days** is deleted; a `paid`, `expired` or `cancelled` draft is deleted **30 days** after it reached that
  state. The order it made keeps all its own data (it is the sale); only the draft's copy of the buyer's contact data goes. Nothing is kept longer "in case".
- **Tags of an anonymised order** are deleted by the same job once the order is anonymised (D162): `pruneAnonymisedOrderTags()` (application code; the SQL anonymising function contains no `DELETE`).
- **Saved views, settings, tags of live orders**: kept while the store exists. **Order events** follow the order (append-only; the erasure rewrites only `data.reason` and `data.note`).
- **Gift text** lives on the order and follows the order's retention exactly: restricted when the person is erased, replaced by the marker when the seller's bookkeeping period ends (`retentionRule()`), never longer.
  A **cart's** gift text goes with the cart (the cart reminder job's `KEEP_DAYS`, 60).

### 3.7 What is private, what is copied, and the registers

- **Private:** every table above (RLS on, no policy). The pay link's token is shown once and only its hash is stored. Nothing here is served by the WordPress plugin's API (`/api/wordpress/v1/*` reads what a shopper can see).
- **`COPY_RULES`** (`src/lib/store-copy-rules.ts`, `commerce.test.ts` fails for a missing table): `order_tags` **never** ("a copy's order history starts clean; the tags are the original's staff working notes"; the copied orders
  themselves can be tagged afresh); `order_views` **never** ("a copy starts with the built-in views; tags and filters name the original's data"); `order_settings` **never** ("a copy starts with the defaults:
  gift messages off, no automatic archiving; the owner sets them", so `clone_store()` and `duplicate_store()` need **no patch** and the row is made lazily); `draft_orders` **never** and `draft_order_lines` **never**
  ("working documents with a customer's contact data, and a sent draft holds stock"). `orders.archived_at` is **not copied**: `copy_orders()` writes copies unarchived; `orders.source`, `draft_id`, `made_by`, the gift and staff
  discount columns are copied as their defaults (a copied order is `checkout`, no gift: the history keeps the money, `copy_orders()` copies `discount_minor` whole, which already includes any staff discount).
  `carts` is not copied (existing rule).
- **`PERSONAL_DATA`** (`src/lib/personal-data.ts`, `src/db/privacy.test.ts` fails otherwise): `orders` gains `gift_to`, `gift_from`, `gift_message` in `personal` (erasure `restrict` then anonymise, as the rest of the
  order; export section `orders`); `carts` gains the same three (deleted with the cart); **new entries:** `draft_orders` (subject `shopper`, link `customer`/`email` as typed by staff, personal `email`, `phone`,
  `shipping_address`, `billing_address`, `company_name`, `organisation_number`, `note_to_buyer`, `internal_note`; export section `carts` (a draft is a basket not yet an order) `also: ["addresses"]`; erasure `delete`,
  deleting the person's drafts matched by `customer_id` only (**never by an email staff typed**: `resolveSubject()` matches a shopper only by the account's own proven email, D162); a guest's draft goes by 3.6),
  `draft_order_lines` (`KEEP_ORDER`-like: no personal field; deleted with its draft), `order_tags` (subject `shopper`, via `order`, personal `label`, erasure `keep` until the order is anonymised, then deleted; exported
  inside the order's section as `tags`), `order_views` and `order_settings` in `NOT_PERSONAL` (staff configuration, "do not hold a search for a person's name" is said on the screen; a saved search text is kept
  in `params.q`, so the entry says so and the audit entry never holds it). The new email kind `draft.pay_link` is in `EMAIL_KINDS` as `shopper`. `exportCustomerData()` adds gift fields to each order, the tags to
  each order and the person's drafts (by `customer_id`) to `carts`; `eraseSubject()` deletes those drafts and blanks nothing else it does not already.
- **Cookies and storage:** none. The gift box sets nothing; the pay page sets nothing; saved views and the list's state are in the address and the database. `KNOWN_COOKIES` is unchanged (a test holds it).

### 3.8 Migrations expected

Six files (four from the build, two from the review's fixes, 3.15), timestamps after `20261006121317_inventory_draw_claims.sql`, each additive, each one transaction through CI (`docs/ci-migrations.md`), none applied by hand first:

1. `{ts}_orders_ops.sql` (generated by `pnpm db:generate` after `src/db/schema.ts`): the columns of 3.1, the five tables of 3.2, their checks, keys and plain indexes.
2. `{ts}_orders_ops_rules.sql` (custom): the triggers and functions of 3.3 and 3.4 (including the two `pg_get_functiondef` patches, the `anonymise_order()` patch, the `issue_order_invoice()` patch and the re-added
   `orders_anonymised` check), RLS on the new tables.
3. `{ts}_orders_ops_search.sql` (custom): the trigram and list indexes of 3.5 (`create index` outside any function; written as `create index if not exists`).
4. `{ts}_orders_ops_plan_features.sql` (custom, written by the analytics-and-ai area): the plan comparison rows (5.5), idempotent by name as D172's was.
5. `20261006185203_orders_ops_fix.sql` (generated): `payments.received_on date null` with the check `payments_received_manual` (only a payment taken outside Kaizen may carry one).
6. `20261006185225_orders_ops_fix_rules.sql` (custom): the trigger `refunds_manual_cap` and two more anchored `DO $patch$` blocks (`build_invoice_snapshot()` for the staff discount kind, `make_order_invoice()` for the received day). No `DELETE` or `DROP`.

### 3.9 As built

Each area appends a paragraph here after its work ("3.10 As built by the foundation", "3.11 … by the server area", and so on) listing every deviation from this file and every addition; a paragraph changes the text above it.

### 3.10 As built by the foundation

Built: `src/db/schema.ts` (the columns of 3.1 and `orderTags`, `orderViews`, `orderSettings`, `draftOrders`, `draftOrderLines`), three migrations (`{ts}_orders_ops` generated, `{ts}_orders_ops_rules`, `{ts}_orders_ops_search`; the fourth, plan features, is the
analytics-and-ai area's), `COPY_RULES` and `PERSONAL_DATA`/`NOT_PERSONAL`/`EMAIL_KINDS`, the pure libraries of 5.1, the words of section 8, and `src/db/orders-ops.test.ts` (PGlite, every rule of 3.3). Deviations and additions, each a change to the text above:

- **`commerce.build_invoice_snapshot()` is patched, not `issue_order_invoice()`** (3.3 point 11, 9.2): the payment section lives in the snapshot builder. The anchor is the one `jsonb_build_object('kind', 'paid_online', …)` line; `paid_outside` carries `provider: 'manual'` and `method`.
  The document's header said "Paid online {date}" from `t.paidOn`; for a payment recorded outside Kaizen it now says `t.paidOutside` with the date (`OrderDocumentView`). `invoice-parity.test.ts` and `order-document-view.test.ts` hold both.
- **A draft is deleted unless it is `sent`** (3.3 point 7 said "only while open", 3.6 and 2.4 need `pruneDraftOrders()` and the erasure to delete `paid`, `expired` and `cancelled` drafts): `draft_orders_rules()` refuses the delete of a `sent` draft only.
- **`expired → paid` and `cancelled → paid` are legal moves** (3.3 points 7 and 8, 2.8): a payment can reach the order of a draft that expired meanwhile; `complete_order_payment()` completes it and `orders_draft_follow()` marks the draft paid
  (sent, expired or cancelled, only when the draft still names that order). `src/lib/draft-status.ts` is the same table.
- **The pay token may stay on a finished draft** (`paid`, `expired`, `cancelled`), so the page can say what became of the link; it is null on an `open` draft and cleared by a reopen. Only the hash of the *current* token is kept, so a replaced token cannot be told from
  a wrong one: the "replaced" state of 2.1 is the same 404 as an unknown token.
- **Checks and triggers beyond the spec:** `payments_manual_recorded` (a manual payment names who recorded it), `payments_manual_real` (never `test_mode`), `orders_origin_frozen` (`source`, `draft_id`, `made_by`, `staff_discount_*` are written with the order),
  `draft_orders_lifecycle` (which of order, times and link each status has; an expiry after the send), `order_lines_discount_parts` (the components of a line's discount never exceed it, **only for a line with a staff discount**: checking every old row would put a
  constraint on production data nobody has read), `orders_staff_discount_label`, `order_tags_label_chars` (no comma, control or bidirectional character; the library also refuses the zero-width ones), `draft_order_lines_kind` (a line is goods or a custom item, never both), `orders_gift_fields`
  also holds the three limits (60, 60, 300 characters, 6 lines). The customer foreign key of a draft is `ON DELETE SET NULL (customer_id)` (written in the rules file, like the other composite ones: do not regenerate it from `schema.ts`).
- **Not enforced by the database** (the server does, 5.2): at most 500 open drafts a store, a draft line being goods that are sellable in the market, and the 10,000,000 ceiling of one unit's price (`DRAFT_PRICE_MAX_MINOR`, held by `priceDraft()`).
- **`priceDraft()` takes the tax decision as a function** (`(basket) => decideTax(facts, basket)`), because `decideTax()` lives in a `server-only` module; everything else it calls is pure (`vatIncluded()`, `basketShipping()`, `reliefFor()`). The free-over limit is judged by `basketShipping()` over
  *every* line's goods before the discount, custom items included, exactly as a cart judges its service lines. Percent discounts round half up with BigInt; amounts share by the largest remainder. `draft-order.test.ts` holds the arithmetic and the equality with the cart's own steps in a krone market and a
  euro view; the equality with `cartSummary()` itself (the real database, the real `decideTax()`) is the server area's `draft-order.int.test.ts`.
- **Words:** `m.gift` (the five plain labels may be machine-translated; `note` and `slip` are hand-written only), `m.draftPay`, `emailText().draft`, `emailText().giftMessage`, `documentText().paidOutside` and `paymentMethods`. `ui:gift.counter` is in `CHOOSING`. The gift box says
  that the message is printed on the packing slip and that the store does not send it to the recipient. `HAND_WRITTEN_ONLY` holds `ui:gift.note.`, `ui:gift.slip.`, `ui:draftPay.`, `email:draft.`, `email:giftMessage.`.
- **Added:** `src/lib/order-ops-events.ts` (the event and audit names, `COPIED_ORDER_EVENTS` held against the patched function), `src/lib/draft-input.ts` (zod; `parsePercentBps()`, `formatPercentBps()`), `commerce.order_tag_counts()` returns `(key, label, orders)`, `next_draft_number()` returns the text `D-{n}`.
- **Not done:** the retention of drafts is `DRAFT_*_RETENTION_DAYS` in code (3.6); no row was added to `commerce.retention_rules`, so the privacy page's schedule does not list it (the lead may want one). The concurrency of the 250-tag lock is a trigger with an advisory lock; PGlite has one connection, so two writers at once are for
  the server area's integration test. Lock order: a reopen locks the draft and then cancels the order (`cancel_unpaid_order()` locks the order), while a payment locks the order and then `orders_draft_follow()` updates the draft: **lock the order row first in `reopenDraft()` and `sendDraft()`** to avoid a deadlock.

### 3.11 As built by the server area

Built: the server modules of 5.2 and their integration tests (`order-list`, `order-tags`, `order-archive`, `order-views`, `order-bulk` (which also holds the packing-slip tests), `gift`, `draft-orders` and the `draft orders from staff` and `gift` scenarios of `checkout-kinds.int.test.ts`, euro views and the paid-outside invoice and credit notes included). Stripe is
the fake of the integration tests; the live flow (a hosted session, the webhook, a refund through Stripe) is for the by-hand check of 9.7. Deviations and additions, each a change to the text above:

- **Names.** The functions are `changeOrderTags()` (one order, one history event, `{ add, remove }`), `getOrderTags()`, `tagsForOrders()`, `tagSuggestions()`, `pruneAnonymisedOrderTags()` (all in `order-tags.ts`); `listOrderViews()`, `getOrderView()`, `saveOrderView()`, `updateOrderView()`, `deleteOrderView()`,
  `reorderOrderViews()`; `recordDraftPaidOutside(member, draftId, input)` (not `markDraftPaidOutside()`); `payPageFor(shop, token)` and `startDraftPayment(shop, token, { termsTicked, origin })` take the store and the market together; `settleOrderSessions()` (`draft-sessions.ts`) closes a draft order's Stripe sessions
  for the reopen, the payment outside and the expiry; `unarchiveForReturn(tx, storeId, orderId)` is the return code's one call; `order-actor.ts` holds `OrderActor` (`staffActor()`, `SYSTEM_ACTOR`) and `writeOrderEvent()`. `order-insert.ts` exports `insertOrder()`, `insertOrderLine()`, `allocateStock()` and `reserveStock()`; the Stripe session is
  `payment-session.ts` (`openPaymentSession()`, `paymentConnection()`). `src/lib/order-list-row.ts` is the pure shape of a list row.
- **Staff-only data is on `OrderAdmin`, not `OrderView`.** `OrderView` (what the shopper's page, the emails and the pay page read) gains only what a buyer may see: `gift`, `staffDiscountMinor` and `staffDiscountLabel` (and `discountMinor` **excludes** the staff discount, as it excludes credits), and a line's `custom`. `tags`, `archivedAt`, `source`, `draft`,
  `madeBy`, `paidOutside` and a line's `listPriceMinor` are on `OrderAdmin` only, so no shopper-facing surface can draw an internal tag or a staff member.
- **`unpaid` is the unfinished checkout** (`pay=unpaid` and `show=unpaid`: waiting for payment, or cancelled and never paid, never copied history), the same set; a draft's sent order is in it until it is paid.
- **A search finds archived orders.** The archive filter is `no` by default and hides archived orders from the list; a search with words ignores that default (an order is looked up by its number whatever its state); `archived=yes` still shows only them. The address cannot tell the default from an explicit `no`.
- **Closing a store ends its drafts as `expired`, not `cancelled`.** The order of a sent draft is cancelled by `cancel_unpaid_order()` and the order's own trigger makes the draft `expired`; `cancelled` is not reached by any path (the status and its moves stay, for a later one). The expiry job skips a store that is not open.
- **Automatic archiving never takes copied history** (the owner chose to see it), in addition to 4.3's rules.
- **Retention.** `runRetention()` has two new steps, `draft_orders` (`pruneDraftOrders()`, 3.6) and `order_tags` (`pruneAnonymisedOrderTags()`); the erasure deletes the drafts of the customer **account** (never one matched by an address staff typed, D162: such a draft goes by the retention step, 90 days untouched or 30 after it ended) and clears the cart's gift.
- **A refund of money taken outside writes two events** for one refund: `order.refunded` (so analytics, the restock readers and the return code read it as any refund) and `order.refunded_outside` (the words that say nothing was sent). Only the owner, or staff when the owner allows it (`accountMayRecordOutside()`), may record one.
  The AI manager's `refund_order` tool goes through the same function, so it now accepts an order paid outside (the analytics-and-ai area owns the tool and should say so in its description).
- **A draft cannot be sent when a list price moved** after its last save (`price_changed`, blocking): the line must be saved again to take the new price. A typed price is never compared.
- **`reopenDraft()` keeps `valid_days`** (the database freezes it with the rest of a draft that is not open, and the next send writes it again). The first version cleared it and the database refused the reopen; `draft-orders.int.test.ts` holds it.
- **A custom item** carries `withdrawal_exclusion = 'none'` and `delivery = 'service'`; the withdrawal code's `lineEligibility()` is not asked for it at send time, so a custom item of a physical kind would be returnable as a service line. Staff who sell such things should use a product (open point, 7).
- **Bulk print with nothing of the store's named** answers `{ applied: 0, refused: [not_found …] }`, not a request problem, like every other action.
- **Draft pricing is held to the cart** in `draft-orders.int.test.ts` (kroner and euro) and in the draft scenarios of `checkout-kinds.int.test.ts` (Stripe's charge, invoice, credit notes). `checkout.ts` lost its inline order insert and session code to `order-insert.ts` and `payment-session.ts`, so the scan tests that listed `checkout.ts` as the reader or writer of a
  column now list the new modules (`stock-writers.scan.test.ts`, `unit-price-readers.test.ts`, `vat-readers.test.ts`, `document-readers.test.ts`): the same readers, moved, none added beyond `draft-orders.ts` reading a variant's content to copy it to the order line. `order-numbers.test.ts` also scans for the single writer of `archived_at`, `order_tags`, `draft_orders`
  and of a manual payment.

### 3.12 As built by the shopper area

Built: the cart's gift box (`cart/cart-gift.tsx`, the `setGiftAction()` in `cart/actions.ts`, the `cart_gift` piece in `STORE_PIECES`, its place in the cart starter, `CartGift` in `cart-contents.tsx`, a case in `StorePartSection`), the buyer's own message back to them (`components/gift-note.tsx`: the order page and its lines piece, My account's order,
the checkout's items), the staff discount as its own row (`components/staff-discount-row.tsx`: the order page, My account, the pay page) and the pay link (`account/pay/[token]/page.tsx`, `pay-view.tsx`, `pay-form.tsx`, `actions.ts`; `isPayLinkPath()` in `src/lib/pay-routes.ts`, part of `isNoExtrasPath()`).
Tests: `cart-gift.test.ts`, `pay-view.test.ts`, `gift-note.test.ts`, more cases in `cart-contents.test.ts`, `order-section.test.ts`, `checkout-section.test.ts`, `pay-routes.test.ts`, `pay-routes.graph.test.ts` and `gift-no-html.scan.test.ts`; `e2e/gift.spec.ts` and `e2e/draft-pay.spec.ts`. Deviations and additions, each a change to the text above:

- **The pay button's label is `m.pay(amount)`, not `m.payNow`.** The checkout's button reads `m.pay(total)` ("Betal 1 249,00 kr", "Pay €105.00"); `m.payNow` is the weekly boxes' (`m.deliveries.payNow`). The page uses the checkout's own label, with the amount, as 2.1 and 4.7 intend. Section 8 item 2 is about this label.
- **The gift box is also drawn by the `cart_checkout` piece when the page holds no `cart_gift` piece** (`CartCheckout drawGift`, the way `drawTerms` leaves the terms to their own piece), so a cart page built from pieces before gift messages existed shows the box above its checkout button as soon as the store switches the feature on. The whole cart (`CartContents`) draws it under the lines, in the slide-out cart too.
- **The box saves when a field is left or the tick changes** (no save button; it needs JavaScript, as adding to the cart does), and checks with `cleanGift()` in the browser before it sends anything, so a text over its limit is refused with a sentence beside the field and nothing is sent. The browser's `maxLength` blocks the 301st character; the server checks again. The component calls `t(lang)` itself (as `site-form.tsx` does) because the words include the live counter, a function.
- **One word added:** `m.gift.note.saveFailed` in nb, sv, da and en (hand-written only, under the `ui:gift.note.` prefix): "The gift message was not saved. Try again."
- **A gift with no words says only "This is a gift"** on the order page (a heading with nothing under it would be odd); with words it shows To, From and the message under "Your gift message".
- **The staff discount is its own row** on the order page, in My account and on the pay page, under the label staff gave it (`m.discount` when it has none), because `OrderView.discountMinor` leaves it out. The checkout never shows one: a draft's order never goes through the checkout page.
- **The pay page's problems:** a payment still processing is `m.problemProcessing` ("Payment for this cart is still being processed.": it says cart, there is no order-worded message); limits and Stripe failures are `m.draftPay.startFailed`; a state that changed meanwhile (paid, expired, payments off) draws the page afresh (`refresh()`). The expired state shows the store's name, one sentence and the contact address, and nothing of the order or the store's note.
- **The terms sentence and its tick are the checkout's own component** (`CheckoutTerms` with the `terms-choice` store), held on the page's own form field `terms`; the server (`startDraftPayment()`) checks the tick again and records the acceptance before Stripe.
- **The pay link links the store's withdrawal-information page** from `store.legalPages.withdrawal_info` through `listPublishedPages()` (a link only where the store has published one).
- **Not built:** a link from the pay page to the paid order (it needs the Stripe session id the checkout return carries); a reminder or a "paid" email to staff (7).

### 3.13 As built by the admin area

Built (English only, tokens only, each page with a `loading.tsx`, each action `checkPermission(slug, key)` first): the Orders page around `listOrdersPage()` (`orders/page.tsx`, `src/components/admin/orders/`: `order-list-view`, `view-bar`, `filter-bar`, `order-table` (selection, bulk bar,
result panel), `view-tools` (save, replace, rename, reorder, delete)), the bulk actions and saved views (`orders/list-actions.ts`), the order page's Tags card, Archive button, Gift card, staff-made badge and history words (`order-ops.tsx`, `gift-card.tsx`, `orders/ops-actions.ts`, `src/lib/order-ops-events-text.ts`), the refund
and cancel forms' wording for money taken outside Kaizen (`order-actions.tsx`), the packing slip with its gift block and the bulk slips (`packing-slip-view.tsx`, `orders/[orderId]/packing-slip`, `orders/packing-slips`), the draft orders (`orders/drafts`, `drafts/new`, `drafts/[draftId]`, `drafts/actions.ts`, `src/components/admin/drafts/`: list, new-draft form,
editor, summary, send and paid-outside boxes, the read-only panel, the screen that keeps a shared link on view) and `settings/orders`. Registries: `store-nav.ts` (*Draft orders* after *Orders*, *Orders* under Selling), `admin-map.ts` (`orders` widened, `orders.packing-slips`, `orders.drafts`, `orders.draft.new`, `orders.draft`, `orders.settings`; the order page's `EVENT_LABELS`).
Pure: `order-list-admin.ts` (links, selection banner, table rows), `draft-editor.ts` (the editor's state and what it sends), `draft-markets.ts` (country, language and currency choices), `order-ops-events-text.ts`. Tests: `orders-views.test.ts`, `order-page-views.test.ts`, `packing-slip-views.test.ts` (also the settings form), `drafts-views.test.ts`, and the unit tests of the four pure files. Deviations and additions, each a change to the text above:

- **A draft saves itself** (the editor, 900 ms after a change, and on *Save draft*), because the summary is the SERVER's (`previewDraft()` prices what is saved) and the browser may never work a total out. An open draft holds no stock and takes no number, so saving is harmless; the version check refuses a second person's change and the screen says to reload.
  Sending and recording a payment save first (`ensureSaved()`) and are disabled, with the reason written, while the draft has problems.
- **`/orders/drafts/new` is the market chooser** (country, language, currency from `draftMarketOptions()`); *Start the draft* makes the draft (`createDraftAction()`) and opens it. A person who may only read sees a sentence instead of the form; the page asks `orders:read` (the scan test: a page asks the area's read key, the action `orders:write`).
- **A saved view is never carried in a link.** A view opened with `?view=` is applied by the server and written out in full: every link of the page (chips, built-in views, pages) and the filter form are made from the state without it, because a cleared filter would otherwise come back from the view. *Save this list as a view* can replace a view instead of making a new one.
- **Printing slips works on the ticked orders of a page** (at most 100, a link to `orders/packing-slips?ids=`), not on "all matching": the browser holds the ids it was shown, and a print is not a write, so no action carries it. The other bulk actions take "all matching" (the query, read again by the server).
- **A draft's link to share is shown once on the screen** (`DraftScreen` keeps it while the page re-renders from `open` to `sent`); the sent panel offers *Send again*, *Create a link to share*, *Reopen*, *Mark as paid outside Kaizen* and, for expired and cancelled drafts, *Delete*.
- **Not built here (the analytics-and-ai area's by 5.5):** the store Home's "drafts waiting for payment" and "drafts expiring within two days" (`control-center.ts`); the admin area edited no file under `src/server`. The draft list shows each draft's status, so a store can find them with `?status=sent`.
- **Not run:** nothing here was clicked in a browser (no signed-in admin fixture, D158) and no Stripe call was made; the screens are held by view tests and by the server area's integration tests. The cash warning (section 8, item 6) and the words beside the paid-outside refund are English admin text, flagged for the same review as the rest of section 8.

### 3.14 As built by the analytics-and-ai area

Built: the analytics definitions (`docs/analytics.md`, the rows *Staff-made order*, *Custom item*, *Custom price*, *Drafts waiting for payment* and the section *Staff-made orders and the AI manager's order tools*) and what implements them once each (`FROM_CHECKOUT`/`STAFF_MADE` in `analytics-sql.ts`, `checkoutOrders` on `Totals`, `SeriesPoint` and `DailyPoint`, `STAFF_CHANNEL` and `isNotAChannel()` in `analytics-traffic.ts`, `TrafficReport.staffOrders`, `CUSTOM_ID`/`isNoProduct()` in `analytics-products-data.ts`, the *Staff discounts* kind in `analytics-discounts-data.ts`, a note in the diagnosis); `DraftFigures` in `src/lib/control-center.ts` and `src/server/control-center.ts` (store Home and the owner's overview); `tags`, `archived`, `source`, `gift_order` and the Full profile's `gift_to`/`gift_from`/`gift_message` in the order file; the AI manager's `list_orders` (widened), `tag_orders`, `archive_orders`, `list_draft_orders`, `create_draft_order`, `send_draft_order` (`src/lib/order-ops-tools.ts`, `src/server/order-ops-tools.ts`, a `send` gate, `preflightSendDraft()`, `draftApprovalSummary()` kept by `keepForApproval()`), two playbooks (`tidy-orders`, `draft-order`), their permissions and progress words; and the migration `20261006172421_orders_ops_plan_features.sql` (four rows after *Orders, returns and refunds*, positions 391 to 394, in no plan until the platform's admin ticks one; `src/db/orders-plan-features.test.ts`). Tests: `order-ops-tools.test.ts`, `order-ops-tools.int.test.ts`, `analytics-staff-orders.int.test.ts` (kroner, a euro order, a custom item, a staff discount, another store's order, a store with none), `order-export-ops.int.test.ts`, and cases added to `analytics-kpi`, `analytics-alerts`, `analytics-traffic`, `control-center` and `order-csv` tests. Deviations and additions, each a change to the text above:

- **The order file's columns are `tags`, `archived`, `source`, `gift_order`** (not `gift`: that column is the line's free-gift flag), written `true`/`false` like `copied`, tags joined by `, ` in the order of their keys, placed after the amounts so the lines layout still ends with its line columns and `payment_reference`. An erased person's order has `[removed]` for its tags and the gift's words; the flags stay.
- **A custom item's cost is not known** (counted against cost coverage), where the spec was silent: a draft's staff-typed item has no variant to hold a cost, and counting it as a cost of 0 would flatter profit (the honesty rules). Four SQL places decide a line's cost is known and all four changed together.
- **A staff discount is its own discount kind** on the Marketing page (a row only for a store that gave one), taken out of the *Discount codes* remainder, so the kinds still add up to the total.
- **The channel table's Staff-made row also holds the customers whose first order was staff-made** (new customers of that row). The Traffic page does not give staff-made orders a row in its device, market or landing tables: it names them apart (`staffOrders`, one note), because those tables are about visits.
- **The AI manager.** `list_orders` keeps `which` and `search` and gains the page's own filters, a count (`more_than_counted` above the cap) and `next`; a search now finds archived orders and never an erased person by name or email (the page's own query). `tag_orders` and `archive_orders` take up to 25 orders by number or id (numbers are the store's own: both of two stores may have an order 1001) and report refusals in the page's words; they are not gated (internal labels and a visibility flag), the batch writes its own audit entry. `create_draft_order` takes SKUs of shipped goods, an email, a market and an optional percent off with the name the customer sees (passed through `findClaims()`); it needs no price, address or note, so the draft it makes says *Goods are shipped: add a shipping address* and `send_draft_order` is refused (before it is kept for a yes, by `preflightSendDraft()`) until the owner has added one on the draft's page. If a draft cannot be written the empty draft just made is deleted so none is left behind. **`refund_order` now refuses an order paid outside Kaizen** (nothing can be sent from there, and a refund of it is recorded on its page by someone who has paid the customer back); the server area's `refundOrder()` would otherwise have recorded it from the assistant. `get_order` says tags, archived, staff-made, paid outside and *gift* and never gives the gift's words (a third party's, and text a person typed is data the model should not read as instructions).
- **The control center's draft items** (`drafts`) are *N draft orders are waiting for payment, the oldest sent D days ago* and, apart, *the pay links of N draft orders end within 2 days* (`DRAFT_EXPIRING_DAYS`), both only for a member who may read orders, not urgent, linking to `/orders/drafts?status=sent`.
- **Not built, by the spec's own list:** nothing on the platform's side (the plan comparison's rows only describe), no analytics page of its own for drafts, and no analytics figure for archived orders (they count exactly as before, and no figure reads a tag).
- **Not run:** no signed-in screen was clicked (no admin fixture, D158); the tools and figures are held by unit and integration tests against a real database and the fake Stripe of `order-ops-tools.int.test.ts`, which holds the draft send, the order it makes and the stock it holds; no model was called (the tools are held by direct calls: a model's use of them is not tested here).

### 3.15 As built by the review's fixes (the lead's list of 16 findings)

Every finding was fixed at its cause or disputed with evidence (none was disputed); each has a test. Deviations and additions, each a change to the text above:

- **One Stripe idempotency key per press of the pay link.** `PaymentSessionOptions.idempotencyKey` and `allowedCountry` (`payment-session.ts`); a cart's checkout keeps `checkout-{order}`, the draft's pay link passes `draft-pay-{order}-{n}` where `n` counts the order's Stripe payment rows, so a second press is no longer refused or answered with the first, closed session; the payments insert is `on conflict do nothing` for a replayed session id. `draft-security.review.int.test.ts` models Stripe's key rule.
- **A failed look at Stripe is not "closed".** `settleOrderSessions()` closes a session only when Stripe says it does not exist (`resource_missing`/404) or reports it expired; any other failure, and a missing client, leaves the row pending and answers `processing`, so staff cannot record money outside, expire or reopen while the buyer may still pay. Two guards close the race with a press: `recordDraftPaidOutside()` counts pending Stripe rows under the order's row lock and refuses (`processing`), and `startDraftPayment()` re-reads the order under its lock after the session is made and closes that session when the order is no longer waiting (`closeOpenedSession()`; `paid`/`expired` to the buyer). `expireDrafts()` settles once more after the cancel.
- **The pay link only works under its own order's country** (`payPageFor()` is `not_found` for another market's address; the language and currency of the view may differ) and Stripe's address form allows the order's country, not the address bar's.
- **Press limits**: 20 an hour per draft (`draft:pay:{draftId}`) and a backstop of 600 an hour per store (`draft:pay`) that only presses the draft allowed count against.
- **Refunds of money taken outside Kaizen are capped under concurrency**: `refundOrder()` locks the order row and recomputes what is left inside the transaction (`RefundOverCap`), and the trigger `commerce.refunds_manual_cap()` refuses a non-failed refund that takes a *manual* payment's refunds above it (a Stripe payment's cap is Stripe's).
- **The received day** (`payments.received_on`, `draftPaidOutsideInput.receivedOn`, at most `MANUAL_RECEIVED_DAYS_MAX` = 31 days back and not in the store's future): the invoice's supply date is that day (never later than the issue day), so D161 reports it in the right VAT/OSS period; the order's `order.paid` event and analytics still use the day it was recorded (stated on the screen). `order.paid_outside` and the audit entry carry `receivedOn`.
- **Cash ceilings** (`src/lib/cash-limits.ts`, 4.6 and section 8 item 7): Norway enforced, Denmark warns, both unverified.
- **The invoice names a staff discount** (`SnapshotDiscount.kind` `staff`, the label staff gave it, `OrderInvoiceFacts.staffDiscountMinor/staffLabel`, `discountKinds.staff` in four languages; the SQL patch and the oracle agree in `invoice-parity.test.ts`, which has a staff-discount fixture). The code's share is what is left after it.
- **The pay page** draws the withdrawal sentence only for a consumer order with a shipped line; **custom items are not sold to a private customer** (4.7); **a delivery address in another country than the market blocks** the draft (`shipping_country`).
- **The order page's key** includes a manual payment in every reader (withdrawals, the confirmation's withdraw link, terms, booking changes), and `src/lib/payment-readers.scan.test.ts` (spec 6.5 (d), which the build had not written) lists every reader of `payments.provider` with its reason and fails for a key list that leaves `'manual'` out.
- **The customer picker** of a draft needs `customers:read` as well as `orders:write` (`mayFindDraftCustomers()`).
- **"Highest/Lowest total" sorts by value across currencies**: `OrderListContext.totalFactors` (from `store_currencies`) turn each total into hundredths of the rates' reference currency (`totalKey()`, also the cursor's key); a store with one currency sorts by the stored total as before.
- **A gated `send_draft_order` sends the draft the owner was shown**: `keepForApproval()` keeps `approved_version` (replacing any a model passed) from the same preview as the summary, and the send is of that version or refused with `conflict`.
- **Not run / known:** nothing here was applied to production; no signed-in screen was clicked; `pnpm db:check`'s `git diff --exit-code -- supabase` part cannot pass until the new files are committed (`drizzle-kit check` and `generate` pass: "No schema changes").

---

## 4. Rules and law

### 4.1 Limits and constants (one module, `src/lib/order-limits.ts`; a unit test pins every number so a change is a reviewed change)

| Constant | Value | Source |
|---|---|---|
| `TAG_MAX_LENGTH` | 40 characters (Unicode code points after trimming and collapsing spaces) | Shopify's limit (read), the row |
| `TAGS_PER_ORDER` | 250 | Shopify's limit (read), the row |
| `ORDERS_PAGE_SIZE` | 50 | Kaizen's own |
| `ORDERS_COUNT_CAP` | 10,000 (shown as "10,000+") | Kaizen's own |
| `SEARCH_MAX_LENGTH`, `SEARCH_MAX_WORDS`, `SEARCH_MIN_WORD` | 100, 5, 2 | Kaizen's own |
| `BULK_MAX` | 250 | the row's "up to 250 at once" (Shopify's cancel limit, as the row reads it); applied to every bulk action |
| `BULK_PRINT_MAX` | 100 | Kaizen's own (a printed document, not a write) |
| `VIEWS_MAX`, `VIEW_TITLE_MAX` | 30, 40 | Kaizen's own |
| `GIFT_MESSAGE_MAX`, `GIFT_NAME_MAX`, `GIFT_MESSAGE_LINES` | 300, 60, 6 | Kaizen's own (a gift card holds about this much; the criterion asks for "a stated length") |
| `DRAFT_LINES_MAX`, `DRAFT_QUANTITY_MAX`, `DRAFTS_OPEN_MAX` | 100, 9,999, 500 | Kaizen's own |
| `DRAFT_VALID_DAYS` | default 7, 1 to 30 | Kaizen's own (Shopify does not say, 1.2) |
| `DRAFT_SENDS_PER_DAY`, `DRAFT_SENDS_PER_HOUR_STORE` | 5, 60 | Kaizen's own (a staff-typed address can receive a payment email: the limit is the abuse brake) |
| `DRAFT_OPEN_RETENTION_DAYS`, `DRAFT_DONE_RETENTION_DAYS` | 90, 30 | Kaizen's own (GDPR Art. 5(1)(c) and (e), data minimisation and storage limitation, as read for D162; Shopify keeps a year) |
| `AUTO_ARCHIVE_MIN_DAYS` | 14 (to 365) | Kaizen's own: never before the 14-day withdrawal period (D153) can have run |

### 4.2 Tags

- A tag is entered as text and **normalised** by `normaliseTag()` (pure, `src/lib/order-tags.ts`): Unicode NFC, trim, collapse runs of whitespace to one space; **the key** is that text lower-cased with `toLowerCase()`
  (not locale-dependent). Two tags with the same key are one tag on an order; the label kept is the first spelling written on that order. Length counts **code points** (an emoji is one).
- **Refused:** empty after trimming; more than 40 code points; a comma or any control character (U+0000 to U+001F, U+007F, and the bidirectional controls U+202A to U+202E and U+2066 to U+2069); a 251st tag on an order.
  Letters of every language, digits, spaces, hyphens, underscores and common punctuation are allowed (**Shopify allows only letters, numbers and hyphens and warns that accents break its search; Kaizen's stores write Norwegian,
  Swedish and Danish, so it allows them**: the search compares lower-cased text in Postgres, which handles `æøåäö`).
- Adding the same tag twice, removing a tag that is not there and adding at the limit with a tag already present are **not errors** (idempotent; the result says "already had" / "did not have").
- A bulk add fails an order at its limit with `tag_limit` and goes on; the tag text is validated **once before the batch** (an invalid tag refuses the whole request, since it would refuse every order).
- Tag text is staff text. It is never sent to a shopper, never in a feed, a sitemap, structured data, the chat agent's answers or the WordPress API. The tag column of the order file (D165) is in the default profile.

### 4.3 When an order may be archived (`archiveBlock(order)`, pure)

An order may be archived unless one of these holds (the reason is the code in 2.2.5): it is `pending_payment` or a cancelled order that was never paid (`unfinished_checkout`); it is `paid` with something physical to
ship and not sent (`needs_sending`: it is in *To send*, hiding it would hide work); it has an **open return** (`returns.status` not final, `open_return`); it is already archived (`already_archived`). **Everything
else may be archived**: sent, closed, cancelled-after-payment, paid with nothing to ship (downloads, services, bookings: a booking's own calendar is the work queue, not this list), copied history and hosts' orders.
**Unarchiving** has no precondition. Archiving changes no figure anywhere (analytics, invoices, VAT reports, exports read the order whatever `archived_at` says; the order file has an `archived` column).
**Automatic archiving** uses the same `archiveBlock()` plus "the order's last event is older than `auto_archive_days`" and "the store is open"; a return or withdrawal on an archived order calls `unarchiveOrder()` (the
return code's one new call), so the order is back in the list when work starts. Shopify also archives automatically by default and on a return unarchives (read); Kaizen's default is off (decision 7).

### 4.4 Search, filters, dates and paging

- **LIKE safety:** the search word is escaped for `LIKE` (`\`, `%`, `_`) and passed as a **bound parameter**, never concatenated; the cursor is a bound JSON value; saved `params` are parsed by the one parser on the way in
  and on the way out; `sort` is a closed set mapped to fixed SQL; **nothing a person typed is ever a column, an operator or a keyword**. A test feeds `'; drop table`, `%`, `_`, `\`, very long text and control characters.
- **Dates are the store's days** (`store.timeZone`): `from` is the start of that local day, the range's end is **the start of the next local day after `to`** (the date plus one, computed as a date, never an interval on a
  `timestamptz`, D165's rule), so an order at 23:30 local on the last day is in the range in summer and in winter time. `range=30d` means the last 30 local days including today.
- **Payment state** is one SQL fragment (`PAY_STATE` in `order-list-sql.ts`) from `payments` and `refunds`: *captured* = sum of `captured` payments, *refunded* = sum of `succeeded` refunds on those payments;
  `paid` = captured > 0 and refunded = 0; `partially_refunded` = 0 < refunded < captured; `refunded` = captured > 0 and refunded >= captured; `unpaid` = captured = 0 (and the order is not copied);
  `balance_due` = `balance_minor > 0` on a paid or sent order. A weekly box and a booking paid at the venue are **paid** by their own payment rows, as analytics counts them (`PAID`).
- **`ship`:** `to_send` = status `paid`, copied null, a physical line exists (today's *To send*); `waiting` = `to_send` and a line with `backorder_quantity > 0` (today's *Waiting for stock*); `sent` = status `fulfilled`;
  `no_shipping` = no physical line.
- **Paging is keyset**: the next page is `(sort_key, id) < (last_key, last_id)` (or `>` for ascending), the cursor carries both, the sort has `id` as a tie-break, so equal timestamps and totals neither repeat nor skip an
  order. The count is a separate bounded query (`limit ORDERS_COUNT_CAP + 1`).
- **Restricted and anonymised orders** (D162): the email and name predicates exclude them (`restricted_at is null and anonymised_at is null`); the number, line, tag and tracking predicates do not (those are not a person's
  data). The list shows such an order's number, date, status and total and the marker, never the person.

### 4.5 Draft orders: lifecycle, numbers, stock, expiry, arithmetic

**Lifecycle** (`src/lib/draft-status.ts`, mirrored by the database, 3.3 point 7): `open → sent`; `sent → paid | expired | cancelled | open`; `expired → open`; `cancelled → open`; `paid` final. *Mark as paid outside*
from `open` passes through `sent` inside one transaction.

**Numbers (D141).** An order's number is taken **only** inside `insertOrder()` (the shared insert extracted from `placeOrder()`, `src/server/order-insert.ts`), in the transaction that inserts the order, from
`commerce.next_document_number(store, 'order')`. There are now **three callers** of that insert (`placeOrder()`, the subscription renewal, `placeDraftOrder()`); the scan test that reads the source for the numbering
is updated to name `order-insert.ts` as the one place and to fail for any other file that inserts into `commerce.orders` or calls `next_document_number`. A draft that is never sent uses no number. A sent
draft's order uses its number at send. If the order is cancelled (expiry, reopen, a failed payment) the number stays on the cancelled order, exactly as a cancelled unfinished checkout's does today, so the sequence has **no
gap**; `order_number_audit()` is the test (6.3, row D4). *Reopen and send again* makes a second order and uses a second number.

**Stock.** A draft holds **no** stock and reads availability only to warn. At send, `placeDraftOrder()` takes the level rows in (variant, location) order, counts the free units (on hand minus live holds), calls `allocate()`
(D172: keep an order together, else by location rank, the backordered remainder at the first location that stocks it; a variant that stops at zero fails with `stock`; one on backorder sells with the days stated and writes
`order_lines.backorder_quantity`/`backorder_days`) and writes `inventory_reservations` whose `expires_at` is **the draft's `expires_at`** (not the checkout's 35 minutes). The hold is released by payment
(`complete_order_payment()`), by `cancel_unpaid_order()`, or lapses at `expires_at` if the job has not run yet (a lapsed hold stops counting in `variant_availability`, so stock is never held by a forgotten draft; a payment after
the lapse draws what is left and reports `stock.short`). A custom item has no stock.

**Arithmetic** (`priceDraft()` in `src/lib/draft-order.ts`, pure, BigInt, **half up to the minor unit**, using the repo's one rounding helper (the one `unitPrice()` and `vatIncluded()` use), never a new one):

1. For each line, `goods = unit_price × quantity` (VAT included, the draft's currency); `Σ goods = subtotal` (the order's `subtotal_minor`).
2. **Staff discount.** *Percent* (basis points `b`, 1 to 10,000): each line's `off = round_half_up(goods × b / 10,000)`; the total discount is the sum of the lines' (so no remainder is left over). *Amount* `A`
   (must be at most `Σ goods`, else refused): `off_i = floor(A × goods_i / Σ goods)` and the remaining minor units go one each to the lines with the largest fractional remainder, ties to the earlier line (the same
   largest-remainder rule `creditAllocation()` uses), so `Σ off_i = A` exactly and no line goes below zero. A line with `goods = 0` gets 0. `line_total = goods − off`.
3. **Shipping.** *Market rate*: `basketShipping()` over the physical lines' **goods before the staff discount** (free shipping judged before discounts, as the checkout judges it) with the market's flat rate shown in the
   draft's currency (`shown(market, …)`); *Free*: 0; *Custom*: the entered amount. No physical line: 0 and no shipping choice.
4. **VAT** is `decideTax(loadTaxFacts(draft), { lines (line_total, the line's rate), shippingMinor, fees: [], currency })`, the same function `placeOrder()` and `cartSummary()` call: each catalogue line at its product's rate
   `commerce.vat_rate(country, products.vat_category)` (D65), a custom item at its category's rate, the shipping at the country's standard rate unless a person verified a rule (D157). A draft's buyer **has no VAT-number
   check** (7), so the treatment is `standard` (or `ioss` where the facts say so), never `reverse_charge`. VAT is worked out on **the price charged after the staff discount**, as a code's discount is today
   (the legal basis was not re-read in this run: the existing checkout and D157's tests hold the arithmetic).
5. `discount_minor = Σ off` (plus `vat_relief_minor` if the treatment gave any); `total = subtotal + shipping − discount_minor` (the database's `orders_total_adds_up`); `tax_minor` from `decideTax`; **due now = total**
   (no venue part); `staff_discount_minor = Σ off`; each line stores `unit_price_minor` (the custom price or the list price), `discount_minor = off`, `staff_discount_minor = off`, `total_minor = line_total`, its
   `tax_minor` and `tax_rate` from the decision. A **custom price is not a discount** anywhere: the line's `unit_price_minor` is what was charged and `list_price_minor` is information (analytics, the invoice and the
   refund arithmetic read the price charged).
6. A total of 0 cannot be sent or paid (the payment table forbids a 0 payment and the invoice has no zero total); below the payment provider's minimum Stripe refuses the session (the failure of 2.8).
7. **Stripe is sent the order's own amounts** the way a reverse-charge order is: each line **at its amount due, quantity 1**, named `"{quantity} × {title}"`, no coupon, the shipping as the one shipping option at
   `shipping_minor − shipping discount` (none for a draft), and `application_fee_amount = saleFee(total, storeFeeBps)`; so what Stripe charges equals `total_minor` (a test holds it).
8. **Equivalence (the heart of criterion D1).** A draft whose lines are catalogue goods at list price, no staff discount, the market's rate and no campaign, group discount, code or credit in play prices to the **same
   subtotal, shipping, VAT and total as `cartSummary()` for a cart with those lines**, in the market's currency and in a euro view (`draft-order.int.test.ts` runs the two side by side), and `checkout-kinds.int.test.ts`
   gains a `draft` and a `draft, euro view` scenario that take a draft to a paid order and hold its invoice (total, VAT per rate) and unit prices (`expectUnitPrices()`) to the order.

**The pay link** (4.5 is the contract; 2.1 the screens): 32 random bytes, base64url, **only its SHA-256 is stored** (`draft_orders.pay_token_hash`); the page looks the draft up by that hash; a new token replaces the old (so
*Send again*, *Create a link to share* and *Reopen* each kill the earlier link); a link is valid until `expires_at`. It is a **bearer secret**: anyone with it can reach the pay page of that order (and nothing else: no account,
no other order, no address change). The page shows the buyer's own order data, so it is `noindex`, sets `Referrer-Policy: no-referrer`, and the pay page never puts the token in a Stripe URL, metadata or event.
The Stripe session's `metadata` carries the order id, number and store id only, as the checkout's does.

### 4.6 Money taken outside Kaizen, and refunding it

- **A manual payment is a captured `payments` row** the staff member records for the order's whole total (partial and several payments are not built, 7), with a method and an optional reference. It never touches Stripe,
  carries no Kaizen fee, is **always real money** (`test_mode = false`), is audit-logged (`order.draft_paid_outside`: the method and the amount, never the reference) and appears in the order's history as `order.paid_outside`.
- **The invoice** (D159) is issued by the existing `complete_order_payment()` call and says **how it was paid** (`paid_outside`, with the method) and not "paid online" (3.3 point 11). The wording (nb, sv, da, en) is
  in `src/lib/invoice-text.ts`, hand-written, flagged (section 8). The VAT of the sale is as charged on the order; nothing about a cash sale changes the VAT arithmetic.
- **A refund of it** is a `refunds` row recorded `succeeded` with `provider_reference = 'manual_refund_{uuid}'` and no Stripe call; the deferred constraint trigger issues the credit note for it by the existing rule (the
  refund is on a payment that is on the invoice, `payment_on_invoice()`), capped per VAT rate by the existing allocation. The staff member pays the customer back themselves; the screen says so before it records.
  **The refund is recorded only for the amount staff say they paid back**; Kaizen cannot see whether it happened.
- **The law this touches, and what was and was not read.** *Norway:* Skatteetaten's page on the cash register duty defines **kontantsalg** as a sale "der kjøparen si betalingsplikt overfor seljar blir gjord opp ved
  levering, ved bruk av betalingskort eller kontantar" and says sales over the internet and sales by bank transfer or invoice are not kontantsalg
  (https://www.skatteetaten.no/nn/bedrift-og-organisasjon/starte-og-drive/rutiner-regnskap-og-kassasystem/kassasystem/sporsmal-og-svar-om-nye-kassasystemer/, read 2026-10-06). So **a bank-transfer draft is outside
  the cash register duty**, but **cash taken when goods are handed over is a cash sale** that a business with the duty must register in a compliant cash register system, and a draft order is not one. The *Cash* method is therefore
  offered with a plain warning (section 8, item 6) and the screen never calls a recorded payment a receipt. *Sweden* (kassaregisterlagen), *Denmark* (bogføringsloven and the digital cash register rules) and *Germany* (KassenSichV) were
  **not read**; whether each needs a register for a sale agreed by link and paid in cash is an open legal question (section 8, item 7).

### 4.7 Consumer law for what a shopper is shown and told

Sources are the ones the wave 1 specs read (`docs/wave-1-trust.md` quotes Directive 2011/83/EU Art. 8(2) and 8(7); `docs/returns.md` and D153 carry Arts. 9 to 16); EUR-Lex returned an empty page when read again on
2026-10-06, so those articles are **not re-quoted here**.

- **The pay link is part of a distance contract.** The buyer is bound when they pay. Before that the pay page must give what the checkout gives: **the seller** (legal name, organisation number, address and a contact
  email from the company settings, since the page carries no site footer), **the goods and the total price with taxes and delivery cost**, **the delivery time** where a line is on backorder (D172), **the right of
  withdrawal** in one sentence with a link to the store's withdrawal-information page where it has one, **the terms** exactly as `terms_at_checkout` configures them (a link, or a tick box that must be ticked, recorded
  by `recordTermsForOrder()` before the buyer is sent to Stripe), and **a button that states an obligation to pay**. The existing checkout's button reads "Pay now"/`m.payNow`; whether that satisfies Art. 8(2) is an open
  question the wave 1 spec already carries (`docs/wave-1-trust.md`), and this page uses the same label and the same flag (section 8, item 2).
- **The confirmation on a durable medium (Art. 8(7))** is the order confirmation email, with its withdrawal block, sent when the order is paid: for a payment through Stripe and for a payment recorded outside Kaizen
  alike. **It is not optional**: there is no switch to turn it off for a draft with an email. (A draft cannot be sent without an email, and a draft paid outside without an email is refused for the same reason.)
- **Withdrawal.** A staff-made order is an ordinary order for D153: the 14-day period for goods runs from a recorded receipt. A custom item is a `service` line with `withdrawal_exclusion = 'none'`, and `lineEligibility()` answers every
  service line as a **booking** ("A booking for a service is cancelled or moved from your order... It is not withdrawn here."), which is wrong for a service that is not a booking (a statutory right under CRD Art. 9 and 16(a), lost only by performance the consumer
  asked for). **The review found this and the build did not report it; the decision is: a custom item is not sold to a private customer** (`custom_consumer`, a blocking problem of `draftProblems()`: the draft cannot be sent or paid outside), and is sold to a business only
  (which has no statutory right). What the function answers for a business order's custom line is recorded by `draft-orders.int.test.ts` ("a custom item and the withdrawal function"): `booking` for the service line (a refusal text that reads wrongly but is only ever
  shown to a business) and `business_order` for its goods. Giving custom items their own path (Art. 16(a): the consent and the acknowledgement, a start-of-service record) is a legal decision (section 8, item 9), not a patch. The pay page and the confirmation draw the
  right-of-withdrawal sentence only for a consumer order with something to ship (`withdrawBlocks()` and `PayView` agree).
- **Tax.** A staff discount and a custom price are the price charged; VAT is on it (4.5 point 4). A sale by link or phone is taxed in the delivery country by the same decision as the checkout. The wave 1 documents carry
  the invoice law (Directive 2006/112/EC Art. 226 and the national lists, `docs/wave-1b-invoices.md`); nothing here changes them.
- **Gift.** A gift message and the recipient's name are personal data of the buyer and a **third party** (the recipient). They are minimal (a name and a free text the buyer chose to write), kept only with the order,
  exported with the buyer's data and erased with it, never sent to the recipient and never used for anything else (GDPR Art. 5(1)(b) and (c); the information duty towards the recipient under Art. 14 is a legal question,
  section 8, item 8). Kaizen sells no gift wrapping and makes no promise about delivering a message with the parcel (7).

### 4.8 Text a shopper types (the gift fields; also the notes on a draft)

`cleanShopperText(value, { maxChars, maxLines })` (pure, `src/lib/gift.ts`, **no zod and no server import**: the cart page is a pay route and its client bundle must stay free of both): Unicode NFC; `\r\n` and `\r`
to `\n`; remove every control character except `\n`; **remove the bidirectional controls U+202A to U+202E and U+2066 to U+2069 and the zero-width characters U+200B to U+200D and U+FEFF** (they can disguise text);
trim each line's trailing spaces and the whole text; collapse three or more `\n` to two; count length in **code points**; refuse (do not cut) a text over `maxChars` or `maxLines`; an all-empty result is null. The
text is **always rendered as text**: React escapes it, the email renderer turns it into a paragraph through `renderEmail()` (which escapes), the slip uses `white-space: pre-line`; **no `dangerouslySetInnerHTML`,
no markdown, no link detection** (a scan test, 6.5, fails if a gift component uses it). It is never put in a URL, a Stripe field, structured data, a feed or a log line, and it is not run through the claims filter
(that filter is for AI-written copy; this is the buyer's own words) and not through a translation catalogue.

### 4.9 Who may do what

| Action | Key | Notes |
|---|---|---|
| Look at orders, search, filter, open a saved view, print slips, look at drafts | `orders:read` | |
| Tag, archive, unarchive, save and delete views, bulk tag, bulk archive, bulk send | `orders:write` | bulk send also needs an open store |
| Create, edit, send, reopen, delete drafts; create a pay link | `orders:write` | sending needs payments on and an open store |
| Mark a draft paid outside Kaizen; record a refund of a manual payment | the owner; or `orders:write` when `order_settings.staff_mark_paid` is on | checked through `requireOwnerRole()`/`checkPermission()` (nothing compares `role` with `"owner"`: `permissions.scan.test.ts`); the setting is changed by the owner only |
| Change *Orders* settings | `settings:write` (the owner holds it); `staff_mark_paid` owner only | |
| AI manager: list, tag, archive, create a draft | the tool's own key (`TOOL_PERMISSIONS`: `orders:read` / `orders:write`) | the assistant is the owner's alone today |
| AI manager: send a draft | `orders:write`, gated `send` | kept for a yes (`approvalSummary()`) |
| AI manager: record a payment | **nobody; no such tool** | |

A closed or suspended store allows tagging, archiving and printing (`allowedWhenNotOpen()` includes `orders`) and refuses sending, paying and bulk send.

---

## 5. Where things live

Areas do not share files except through the registries listed in 5.6. **The words come first:** because the server's email and the shopper's screens read the same keys, the **foundation** writes every shopper-facing word
of section 8 (`src/lib/i18n.ts`, `src/lib/email-text.ts`, `src/lib/invoice-text.ts`, and the `ui-catalog.test.ts` cases) before the server starts; the shopper area uses them and adds none unless it says so in its report.

### 5.1 Foundation (schema, migrations, pure libraries, shared types, the words)

- `src/db/schema.ts`: the columns of 3.1 and the tables `orderTags`, `orderViews`, `orderSettings`, `draftOrders`, `draftOrderLines`.
- `supabase/migrations/{ts}_orders_ops.sql` (generated), `{ts}_orders_ops_rules.sql`, `{ts}_orders_ops_search.sql` (custom). The plan-features file is the analytics-and-ai area's.
- Pure libraries (no server import, no zod in the ones the cart page or the pay page's client reaches):
  - `src/lib/order-limits.ts` (4.1); `src/lib/order-list.ts` (`parseOrderListParams()`, `orderListQuery()`, the built-in views, the columns, the cursor encoding, `BUILT_IN_VIEWS`); `src/lib/order-search.ts`
    (`searchWords()`, `escapeLike()`); `src/lib/order-tags.ts` (`normaliseTag()`, `parseTagList()`, `tagChange()`, its words); `src/lib/order-archive.ts` (`archiveBlock()`, the reason codes and words);
    `src/lib/order-bulk.ts` (the action union, `BulkResult`, the reason words, `BULK_MAX` handling that is pure: dedupe, cap);
  - `src/lib/gift.ts` (`cleanShopperText()`, `cleanGift()`, the limits; **zero imports from `zod` or `server-only`**);
  - `src/lib/draft-order.ts` (`priceDraft()`, `DraftLine`, `DraftPricing`, the problem codes and words), `src/lib/draft-input.ts` (the zod schema the editor and the server share), `src/lib/draft-status.ts` (the lifecycle table);
  - `src/lib/invoice-snapshot.ts`: `buildInvoiceSnapshot()` learns `paid_outside` (3.3 point 11).
- Registers: `src/lib/store-copy-rules.ts` (the five new tables, 3.7), `src/lib/personal-data.ts` (the entries and the `draft.pay_link` kind, 3.7).
- The words (nb, sv, da, en by hand): `m.gift.*` (the box, labels, counter, the order page's "Your gift message", the slip's block), `m.draftPay.*` (the pay page's states, labels, the seller block, the withdrawal sentence, the
  terms sentence reused from checkout), `emailText().draft` (the pay-link email) and `emailText().giftMessage` (the confirmation's paragraph), `invoiceText().paidOutside` with the three methods; each
  hand-written key is added to `HAND_WRITTEN_ONLY` in `src/lib/ui-catalog.ts` **except the plain gift-box labels** (`m.gift.title`, `to`, `from`, `message`, `counter`), which may be machine-translated for other languages.
  `ui-catalog.test.ts` gets a case for any message that chooses by a number (the counter, the "n customers will get an email" line).
- Tests: the unit and PGlite items of 6.1 to 6.5.

### 5.2 Server (`src/server`, routes of the cron and webhook, the actions' server functions)

- **The one order insert:** `src/server/order-insert.ts` (`insertOrder()`, `insertOrderLines()`, `reserveStock()`): extracted from `placeOrder()` without changing a behaviour (`checkout.int.test.ts`,
  `checkout-kinds.int.test.ts`, `backorder.int.test.ts`, `standing-orders.int.test.ts`, `subscriptions.int.test.ts` and the invoice tests stay green); the subscription renewal calls it too. The numbering scan test is updated (4.5).
- `src/server/checkout.ts`: `placeOrder()` uses the extracted insert and **copies the cart's gift fields** to the order (only when `order_settings.gift_messages` is on); `getOpenCheckout().changed` includes a gift difference;
  `startCheckout()`'s Stripe session creation is **extracted into `src/server/payment-session.ts`** (`openPaymentSession(order, options)`: the line items, the application fee, the metadata, hosted or elements) and used by both.
- `src/server/cart.ts`: `setCartGift(shop, { isGift, to, from, message })` (cleans with `cleanGift()`, refuses over the limit, ignores everything when the store's switch is off, never throws a raw error) and the cart's read carries
  the gift fields.
- **List:** `src/server/order-list-sql.ts` (`orderListWhere()`, `PAY_STATE`, the sort fragments), `src/server/order-list.ts` (`listOrdersPage(storeId, params)` → `{ rows, count, nextCursor, previousCursor }`, `selectAllMatching()`,
  `tagSuggestions()`), `src/server/orders.ts` (`OrderView` gains `tags`, `archivedAt`, `source`, `draftNumber`, `madeBy`, `gift`, `staffDiscount`, and a line's `listPriceMinor`, `custom`; `listOrders()` stays as a thin wrapper for
  its other callers, `control-center.ts` and `owner-tools.ts`, until they move to the new function).
- `src/server/order-views.ts` (`listViews()`, `saveView()`, `updateView()`, `deleteView()`, `reorderViews()`; the store id on every statement, audit entries `order.view_saved`, `order.view_deleted`).
- `src/server/order-tags.ts` (`addTags()`, `removeTags()`, the single-order and the batch versions, event `order.tags_changed`, audit `order.tags_changed` for single changes), `src/server/order-archive.ts`
  (`archiveOrder()`, `unarchiveOrder()`, `archiveFinishedOrders(now)`, events and audit), `src/server/order-bulk.ts` (`runBulk(storeId, member, request)`: the per-order loop, the result, one audit entry per batch;
  *Mark as sent* calls `markSent()` through a pure pre-check that names the refusal), `src/server/packing-slips.ts` (`packingSlipData(storeId, ids)`: the shared reads for the one slip and the bulk page, with the gift block),
  `src/server/order-settings.ts` (`getOrderSettings()` with lazy defaults, `saveOrderSettings()`).
- **Drafts:** `src/server/draft-orders.ts` (`createDraft()`, `saveDraft()` with the `version` check, `previewDraft()`, `placeDraftOrder()` (the only caller of the shared insert for drafts), `sendDraft()`, `reopenDraft()`,
  `deleteDraft()`, `markDraftPaidOutside()`, `expireDrafts(now)`, `pruneDraftOrders()`, `pruneAnonymisedOrderTags()`), `src/server/draft-pay.ts` (`newPayToken()`, `payPageFor(storeId, marketParam, token)`,
  `startDraftPayment(token, { termsTicked })`, `closeDraftSession()`), `src/server/draft-emails.ts` (`sendDraftLink()`, the limits through `chat_usage` bucket `draft:send`).
- `src/server/order-admin.ts`: `getOrderAdmin()` counts manual payments in `refundableMinor` and `canRefund`; `refundOrder()` gains the recorded-refund path for a manual payment (a `refunds` row `succeeded`, no Stripe call, the
  restock, the event `order.refunded_outside`); `cancelOrder()` uses it; `updateOrderContact()` unchanged. **Every reader of `payments.provider`** is looked at with the scan list (6.5): `refundOrder()`, `markBalancePaid()`,
  `host-payments.ts`, `returns.ts`/`return-sql.ts`, `invoice-*`, `analytics-refunds-data.ts`, `order-export.ts`, `applyStripeRefund()`.
- `src/server/stripe-webhooks.ts`: `applySession()` does **not** call `cancelUnpaidOrder()` for an expired or failed session of an order with a `draft_id` (the order lives until the draft's expiry); a paid session on a draft's
  order completes it as ever; the paid draft is marked by the trigger.
- `src/server/returns.ts`/`withdrawals.ts`: a new return or confirmed withdrawal calls `unarchiveOrder()` (the only change).
- `src/server/retention.ts` (`runRetention()` calls `pruneDraftOrders()` and `pruneAnonymisedOrderTags()`), `src/app/api/cron/cart-reminders/route.ts` (calls `expireDrafts()` and `archiveFinishedOrders()`, never
  throws, per store, only open stores for archiving; documented in the route's comment like its neighbours), `src/server/privacy-export.ts` and `privacy-erasure.ts` (3.7), `src/server/invoices.ts` readers for the new
  payment kind where they exist, `src/server/shopper-emails.ts` (`sendOrderConfirmation()` adds the gift paragraph; `sendShipped()` is **not** changed and a test holds it).
- Routes: none new in `src/app/api`. The pay page's action is a server action beside its page (5.3).
- **`checkout-kinds.int.test.ts`** is the server area's: it gains the `draft`, `draft, euro view`, `draft with a staff discount`, `draft with a custom item`, `draft paid outside` and `gift order` scenarios.

### 5.3 Shopper

- `src/lib/store-parts.ts`: a new cart piece **`cart_gift`** ("Gift message", route `cart`, hint "The tick box and fields for a gift message. Nothing in a store with gift messages switched off.") in `STORE_PIECES`; its place
  in the cart starter (`starterPage()`), a case in `StorePartSection`, drawn from `cart-contents.tsx` (never inline in a `page.tsx`) and in the standard cart page when the page has no such piece; the checkout page's
  `checkout_items` piece shows the gift as a read-only line.
- `src/app/s/[store]/[market]/cart/cart-gift.tsx` (client, imports `@/lib/gift` and the words, **not zod, not a server module**: `pay-routes.graph.test.ts` holds it), `cart/actions.ts` (`setGiftAction`: calls
  `setCartGift()`, `refresh()`), `cart-contents.tsx` (the hook-up), `order/order-section.tsx` and the account's order view (the buyer's own message), `checkout/checkout-section.tsx` (the read-only line).
- `src/app/s/[store]/[market]/account/pay/[token]/page.tsx`, `actions.ts` (`startDraftPaymentAction`) and a small client form: the pay page of 2.1 (server-rendered, the button a form posting to the action, no Stripe.js);
  `src/lib/pay-routes.ts` (`isNoExtrasPath()` learns `/account/pay/`; `pay-routes.test.ts` gains it; the page is **not** a pay route and **not** in `FORBIDDEN_ON_PAY_ROUTES`' reach).
- e2e: `e2e/gift.spec.ts` (storefront), `e2e/draft-pay.spec.ts` (the states of the pay page with rows made by `e2e/db.ts`; the button's redirect cannot be followed without Stripe keys, the test asserts the problem state it
  shows).

### 5.4 Admin (English only; tokens only, never `max-w-*xl` on a page root)

- Pages (each with `loading.tsx`, each calls `requirePermission(slug, key)`, actions thin with the slug bound first and `refresh()`): `orders/page.tsx` (rewritten around `listOrdersPage()`), `orders/drafts/page.tsx`,
  `orders/drafts/new/page.tsx`, `orders/drafts/[draftId]/page.tsx`, `orders/packing-slips/page.tsx` (bulk), `orders/[orderId]/packing-slip/page.tsx` (gift block, via `packingSlipData()`), `orders/[orderId]/page.tsx`
  (Tags card, Gift card, Archive button, the *Staff-made* badge with a link to its draft, the history labels, the refund form's outside wording), `settings/orders/page.tsx`; their `actions.ts` files.
- Components in `src/components/admin/orders/` (list table, filter bar, view bar and *Save as view* dialog, bulk bar and result panel, tags card, gift card, archive button) and `src/components/admin/drafts/` (editor, line
  picker, customer picker, summary panel, send dialog, paid-outside dialog, list), each with a `renderToString` test (`orders-views.test.ts`, `drafts-views.test.ts`); the refund form (`order-actions.tsx`) says "paid outside Kaizen".
- Registries: `src/lib/store-nav.ts` (Orders section: *Draft orders* `/orders/drafts` after *Orders*; Settings, Selling group: *Orders* `/settings/orders`), `src/lib/admin-map.ts` (`ADMIN_PAGES`: `orders` description widened,
  `orders.drafts`, `orders.draft`, `orders.draft.new`, `orders.packing-slips`, `settings.orders`; a `group` that follows the section, keywords: search orders, filter, saved view, tag, archive, bulk, draft, quote, pay link,
  gift), `src/lib/permissions.baseline.json` (new pages in their areas), the history event labels (`EVENT_LABELS`: `order.tags_changed`, `order.archived`, `order.unarchived`, `order.paid_outside`, `order.refunded_outside`).

### 5.5 Analytics and AI

- `docs/analytics.md` **first**: "a staff-made order (`source = 'draft'`) is a paid order like any other for revenue, VAT, orders, AOV, refunds, customers and products, **and is left out of conversion rate, the funnel and
  channel attribution** (it was not a visit: it is shown as the channel *Staff-made*)"; "a custom item is in revenue and VAT and **not in the product rankings** (it has no product): the Products page shows *Custom items*
  as one row"; "a custom price is the price charged, not a discount: Gross sales are the price charged, Discounts include the staff discount"; "archived orders count exactly as before". Then `src/server/analytics-sql.ts`
  (one `FROM_CHECKOUT` fragment for the conversion and funnel readers), `analytics-products-data.ts` (custom lines), the Overview/Marketing views' channel label, with unit and int tests.
- `src/server/control-center.ts` and store Home attention: *Drafts waiting for payment* (count and the oldest age), *Drafts expiring within 2 days*; counts only for members who may read orders (`StoreFigures.hides`).
- **Order and customer files (D165):** `src/lib/order-csv.ts` and `src/server/order-export.ts` gain `tags`, `archived` (yes/no), `source` (`checkout`/`draft`/`copied`), `gift` (yes/no) in the **accounting** profile and
  `gift_to`, `gift_from`, `gift_message` in the **full** profile only (personal), none for an erased person's order; formula characters escaped by `writeCsv()` as ever; a canary test (the message `=cmd|…` stays text).
- **AI manager** (`src/lib/owner-tools.ts`, `src/server/owner-tools.ts`, `owner-tool-permissions.ts`, `manager-tools.ts` `TOOL_WORDS`, `assistant-skills.ts`): `list_orders` widened (search, the filters of 2.2, a page);
  `tag_orders`, `archive_orders` (ungated, up to 25 orders per call through `runBulk()`), `list_draft_orders`, `create_draft_order` (variant SKUs and quantities, a customer email, a market; returns the draft's summary from
  `previewDraft()`; **nothing is sent**), `send_draft_order` (gate `send`, `preflightOwnerTool()`, `approvalSummary()`); a line of skill text for "housekeeping orders". Sums and totals come from the server functions, amounts through
  `formatMoney`. The owner tools are served to Kaizen Life through the store's MCP (`/api/mcp`) with the others.
- The plan comparison (D132): `supabase/migrations/{ts}_orders_ops_plan_features.sql` and `src/db/orders-plan-features.test.ts` (D172's shape): four rows in `Operations` after `Orders, returns and refunds` (position 391 to 394):
  *Order search, filters, saved views and bulk actions*, *Order tags and archive*, *Draft orders and payment links*, *Gift messages*, each a description that says only what is built (limits as the code has them: 250 tags, 40 characters,
  250 orders a batch, links valid 1 to 30 days) and no plan includes it until the platform's admin ticks it.

### 5.6 The registries, once more, and who edits each

| Registry | Edited by | What |
|---|---|---|
| `src/db/schema.ts`, `supabase/migrations/*` (files 1 to 3) | foundation | 3.1, 3.2, 3.3, 3.5 |
| `src/lib/store-copy-rules.ts`, `src/lib/personal-data.ts` (`EMAIL_KINDS`) | foundation | 3.7 |
| `src/lib/i18n.ts`, `src/lib/email-text.ts`, `src/lib/invoice-text.ts`, `src/lib/ui-catalog.ts` (`HAND_WRITTEN_ONLY`), `ui-catalog.test.ts` | foundation | every shopper-facing word of section 8 |
| `src/lib/store-parts.ts` (`STORE_PIECES`), `starterPage()`, `StorePartSection` | shopper | `cart_gift` |
| `src/lib/pay-routes.ts` (`isNoExtrasPath()`), `pay-routes.test.ts` | shopper | `/account/pay/` |
| `src/lib/store-nav.ts`, `src/lib/admin-map.ts` (`ADMIN_PAGES`), `permissions.baseline.json`, the order page's `EVENT_LABELS` | admin | 5.4 |
| `src/lib/owner-tools.ts`, `owner-tool-permissions.ts`, `manager-tools.ts` (`TOOL_WORDS`), `assistant-skills.ts` | analytics-and-ai | tools |
| `plan_features` (its migration and test) | analytics-and-ai | 5.5 |
| `src/lib/audit.ts` | nobody | the prefix `order.` is already `orders` (`AUDIT_AREAS`); a scan test holds every action named in 3 to 5 |
| `KNOWN_COOKIES` | nobody | no cookie or storage (a test holds it) |
| `src/lib/store-translate.ts` worklist | nobody | no new translatable store text (the gift box and pay page words are interface text; a store's note to a buyer is typed per draft) |
| sitemap, `llms.txt`, structured data, WordPress API | nobody | nothing public is added; the pay page is `noindex` and not listed |
| `COPY_RULES`, `PERSONAL_DATA` | foundation | 3.7 |

The server area edits `checkout.ts`, `cart.ts`, `orders.ts`, `order-admin.ts`, `stripe-webhooks.ts`, `shopper-emails.ts`, `returns.ts`, `retention.ts`, the cron route, `privacy-*.ts` and `checkout-kinds.int.test.ts`; the shopper and
admin areas edit **no file under `src/server`** (they ask the server's functions; an action file under `src/app` is theirs); the analytics-and-ai area edits `analytics-*.ts`, `control-center.ts`, `order-export.ts`,
`owner-tools.ts` and no file of the others. If an area needs a function another area owns it asks for it in its report and the lead merges; none edits the other's file.

---

## 6. Acceptance criteria, row by row, mapped to tests

Layers: **unit** (`pnpm test`), **PGlite** (`src/db/orders-ops.test.ts`, every migration applied), **int** (`pnpm test:int`, a real database seeded by `scripts/db-setup.mjs --seed`), **view** (`renderToString`), **e2e** (storefront
only: there is no signed-in admin fixture), **scan** (a unit test that reads the source). Every integration test passes its inputs through the validation the app uses (`parseOrderListParams()`, `draftInput`, `cleanGift()`).

### 6.1 `orders.order-list-search-filters-saved-views-bulk`

| # | Criterion (row text kept) | Held by |
|---|---|---|
| L1 | Searching an order number, customer name, email or product title finds the matching orders of this store and no other store's (integration test). | int `order-list.int.test.ts`: two stores with the **same** number, email, name and product title: each store's search returns only its own; each of the six matchers finds its order (number with `#` and spaces, email part, name part, line title, SKU, tag, tracking number); AND over words; five words max; `%`, `_`, `\` and injection text are literals and match nothing they should not; an **erased** person's order (`restricted_at`) is **not** found by email or name but is by number and tag; a copied order is found by number and line. unit `order-search.test.ts` (normalisation, escape, word rules). |
| L2 | The list filters by status, payment, fulfilment and a date range, all in the address, and pages through more than 200 orders without losing any (integration test with 250 orders). | int `order-list.int.test.ts`: **250 orders** (mixed status, payment, refund states, shipped and not, three markets, two currencies, copied and draft-made ones, ties on `placed_at` and `total_minor`): every filter alone and in combination returns exactly the set an independent in-test classification expects (including `pay=partially_refunded`, `ship=waiting`, `source=copied`, `gift=1`, `tag=`); **walking the pages with each of the four sorts returns every order exactly once** (no loss, no repeat) and the count equals 250; date boundaries at the store's local midnight in winter and summer time; `archived=no|yes|all`; an invalid cursor is the first page. unit `order-list.test.ts` (parse drops unknown keys, ignores invalid values, `orderListQuery(parse(x))` is stable, the old `?show=` addresses map to the new parameters). view `orders-views.test.ts` (filter bar shows each active filter, the empty state, *Next*/*Previous*, the count text). int `order-list-perf.int.test.ts` (5,000 orders in one store: search and a filtered page each answer inside a generous bound; the plan uses the trigram index). |
| L3 | A staff member saves a filter and column choice as a named view and reopens it (integration test; views are per store). | int `order-views.int.test.ts`: save, open, update, rename, reorder, delete; opening a view returns the **same ids** as the same parameters typed; a relative range stays relative; unknown keys in stored params are dropped on the way in and out; the 31st view and a duplicate title (any case) are refused; store B cannot open, update or delete store A's view (by id, with B's slug); `orders:read` opens and `orders:write` changes (permission test over the actions); audit entries hold the title, never `q`. PGlite: the limit trigger, the unique title. |
| L4 | Selecting several orders offers bulk actions: add and remove tags, archive, print packing slips and mark sent; each is applied to every selected order or reports which one it refused (integration test). | int `order-bulk.int.test.ts`: for **each action** a batch of mixed orders (eligible, ineligible, copied, another store's id, a duplicate id): the result lists `applied` and every refusal with its code; **per-order atomicity** (a forced failure on the third leaves the first two applied and the rest processed, and says so); `all matching` re-runs the query (a client list is never trusted) and refuses above 250; 251 ids refused before anything runs; mark sent refuses unpaid, copied, already sent, withdrawn-in-full and weekly boxes not yet charged, sends a paid one with no tracking, emails only when *Tell the customers* is on (the count shown equals the emails sent, through a fake `deliver`), and refuses in a closed store; one audit entry per batch with counts only; each order's own event written. int `packing-slips.int.test.ts` (data for several orders in their own languages, no prices anywhere in it, other stores' and copied orders skipped with the reason, 101 ids refused). view: the bulk bar and result panel. |

Expected rating after the run: **partial**, Full when 9.7 item 1 is done and accepted (1.1).

### 6.2 `orders.order-tags-and-archiving`

| # | Criterion | Held by |
|---|---|---|
| T1 | Staff add and remove tags on an order and on a selection of orders; tags are per store, case-insensitive, at most 40 characters, at most 250 per order (unit and integration tests). | unit `order-tags.test.ts` (normalise, key, 40 and 41 code points, an emoji counts one, comma and control characters refused, bidi controls refused, duplicates collapse, `parseTagList()` splits on commas). PGlite: the 251st tag refused by the trigger (also with two concurrent inserts), duplicate key refused, label and key checks. int `order-tags.int.test.ts`: add and remove on one order and on a selection; `VIP` then `vip` is one tag; the same tag text in two stores is two independent tags; at 250 an extra add reports `tag_limit` for that order and goes on; idempotent adds and removes; the tag counts and suggestions are per store. |
| T2 | The order list filters by tag and the tag shows on the order page and in its history (integration test). | int: `tag=VIP` finds orders tagged `vip`; two tags together require both; the order's event `order.tags_changed` has the words in `data.note`; the anonymising of an order removes the note's text (`data.note` rule) and `pruneAnonymisedOrderTags()` deletes the tags. view: the order page's Tags card and the history line (`order-page-views.test.ts`). |
| T3 | Staff archive and unarchive orders singly and in bulk; archived orders leave the default list, stay reachable in an Archived view and keep their numbers and sequence (integration test, `order_number_audit` unchanged). | int `order-archive.int.test.ts`: archive and unarchive singly and in bulk; the default list excludes, `show=archived` and `archived=all` include; refusals for a to-send order, an open return, an unfinished checkout; **`order_number_audit()` and every number identical before and after**; an archived order is still found by search, refundable, counted by analytics (`periodTotals()` equal before and after) and in its invoice; a new return or withdrawal unarchives it (D153 hook); the automatic job (`archiveFinishedOrders(now)` with a fake clock): only orders that need no more work and are older than N days, batches of 200, idempotent, skips closed stores and open returns, off by default. PGlite: `orders_archived_not_pending`. |
| T4 | A copied order (D129) can be tagged and archived but nothing else about it changes. | PGlite: on a copied order the tag insert, `archived_at` update and the three events succeed; **every other column update, a line change, any other event and a payment still raise** (the existing copied-order tests plus new cases); `to_jsonb(order)` minus `archived_at` is identical after archiving. int: tag, archive and bulk tag/archive over a mixed set with copied orders apply; bulk *Mark as sent* refuses them with `copied`; the order page for a copied order offers tags and archive and nothing else. |

Expected rating after the run: **full**.

### 6.3 `orders.draft-and-manual-orders`

| # | Criterion | Held by |
|---|---|---|
| D1 | Staff create a draft with products, quantities, a customer, address, shipping and a discount; totals and VAT come from the checkout's own functions (integration test in two currencies). | unit `draft-order.test.ts` (`priceDraft()` table: percent and amount discounts with the largest-remainder cases and ties, a line of 0, an amount over the goods refused, free-over judged before the discount, shipping free/custom/rate, VAT per line and for shipping, a total of 0, half-up rounding at the boundary, a custom price below and above list). int `draft-order.int.test.ts` + `checkout-kinds.int.test.ts` scenarios `draft`, `draft, euro view` (a euro view of a krone store), `draft with a staff discount`, `draft with a custom item`: **a draft of the same goods at list price prices exactly as `cartSummary()` of an equivalent cart** (subtotal, shipping, VAT, total) in both currencies; the placed order's lines, tax and total equal `priceDraft()`'s; its invoice total equals the order total and the VAT per rate equals the order's (the existing invoice expectations); `expectUnitPrices()` holds; Stripe is sent amounts that sum to the total (fake Stripe records them). |
| D2 | Sending the draft emails a pay link; paying it makes a normal order with a number from the store's gap-free sequence (D141) and holds stock only when the draft is sent (integration test). | int `draft-orders.int.test.ts`: before send `variant_availability` is unchanged and no number is used (`order_number_audit` and `next` unchanged); **send** creates the `pending_payment` order with the next number and holds the units until `expires_at`, writes `draft.pay_link` mail once (fake `deliver`) with a link whose token hash matches; re-sending rotates the token and the old link is dead; a sent draft refuses edits; **paying** (a fake Connect `checkout.session.completed` through `applySession()`, twice) completes the order once, draws stock, issues the invoice, sends the confirmation, marks the draft `paid`, links the customer; a stock shortage, a not-sellable variant, payments off and a closed store each fail the send with nothing written; backordered variants carry their days. int `draft-pay.int.test.ts` (the pay page's data and action against the fake Stripe: each state, the terms record in `checkbox` and `link` modes, a new hosted session each press, an old session closed, a failed Stripe call leaves the order as it was). view: the pay page's states. scan: the one order insert and the numbering (4.5). |
| D3 | A draft can be marked paid for money taken outside Kaizen (cash, bank transfer) with the method recorded, and such an order refunds as an outside payment. | int `draft-manual.int.test.ts`: from `open` and from `sent` (the Stripe session is closed first; paid-meanwhile is refused); methods `cash`, `bank_transfer`, `other` required; a manual `payments` row captured for the total, `kaizen_fee_minor` 0, `test_mode` false in a test-mode store; the order is `paid`, stock drawn, the confirmation sent, the invoice issued **with `paid_outside` and the method**; permission: staff refused when `staff_mark_paid` is off, allowed when on, the owner always. **Refund:** a partial refund records a `succeeded` refund with **no Stripe call** (the fake Stripe asserts none), restocks, writes `order.refunded_outside`, issues a credit note by the existing trigger, the amount cannot exceed what is left, `cancelOrder()` refunds the rest; analytics counts the refund. PGlite: `payments_manual_method`. `invoice-parity.test.ts` gains a manual-payment fixture (SQL snapshot equals `buildInvoiceSnapshot()`); view: the invoice shows the method wording in nb, sv, da, en. |
| D4 | An unpaid draft that expires leaves no number gap and releases its stock. | int `draft-expiry.int.test.ts` (`expireDrafts(now)`): stock held at send is back in `variant_availability` after expiry; the order is `cancelled` ("draft expired"), the draft `expired`, the payment row cancelled, `commerce.order_number_audit()` is **clean (no gap)** and the cancelled order keeps its number; the pay link then says expired; a Stripe session **paid just before** the job completes the order and does **not** cancel it; a session expiry webhook does not cancel a draft's order; a reopen releases the stock and a resend uses a new number without a gap; a closed store's drafts are cancelled. PGlite: the lifecycle table (every legal and illegal move) and `orders_draft_follow()`. |
| D5 | Draft-created orders count in sales and in the customer's history and are marked as staff-made. | int `draft-analytics.int.test.ts` (analytics-and-ai area): a paid draft order is in `periodTotals()` revenue, VAT, orders and AOV, in the customer's orders (`customerSummary()`/the customer page's list, by `customer_id` or by the account's email), in the owner's order file with `source = draft`; **not** in conversion rate, the funnel and channel attribution; a custom item is not in the product rankings. view: the *Staff-made* badge and column, the `source=draft` filter, the order page link to its draft. |

Expected rating after the run: **partial** (1.1); Full after 9.7 and section 8.

### 6.4 `orders.gift-receipts-and-messages`

| # | Criterion | Held by |
|---|---|---|
| G1 | At checkout the shopper marks an order as a gift with a message of at most a stated length; it is kept on the order and shown to staff (integration test). | int `gift.int.test.ts`: with the switch on, `setCartGift()` keeps the three fields on the cart; `placeOrder()` copies them to the order; over 300 code points, over 6 lines or a 61-character name is **refused, not cut**; with the switch off the fields are ignored and nothing is stored; a changed gift after the order was placed makes `getOpenCheckout().changed` true; the order page and list show it to staff (view `order-page-views.test.ts`: the Gift card, the list badge and `gift=1`); the buyer's own order page shows their message. e2e `e2e/gift.spec.ts`: switch on (db helper), put a product in the cart, the box appears in the shop's language, typing shows the counter, the 301st character is blocked, reload keeps it, unticking clears it; no cookie other than the cart's appears (the cookies test). PGlite: `orders_gift_fields`, `orders_gift_frozen`, the anonymising of the fields. |
| G2 | The packing slip of a gift order shows the message and no prices, and an email to the buyer never prints the message in a shipping notice to the recipient. | view `packing-slip-views.test.ts`: the slip of a gift order shows *To*, *From* and the message (line breaks kept) and **contains none of the order's formatted prices, totals, discount or VAT words** (asserted against `formatMoney()` of every line and total in each currency and the words in four languages); the bulk page prints each order on its own page with its own language. int: `sendShipped()`'s email body, subject and preview never contain the message (a message of a unique marker string is searched for in every email the order produced except the confirmation); **no email is ever addressed to anyone but `order.email`** (the fake `deliver` records every recipient across the order's whole life); the confirmation repeats the message only for the buyer. |
| G3 | The message passes through the same output cleaning as other shopper text and is never rendered as HTML. | unit `gift.test.ts` (`cleanShopperText()`: NFC, control characters, bidi and zero-width characters removed, newline collapsing, code-point counting with emoji, trimming, `<script>` and `<b>` and `&amp;` kept as the literal characters). view: slip, order page, cart box and the confirmation email render `<b>x</b>` as `&lt;b&gt;x&lt;/b&gt;`. scan `gift-no-html.scan.test.ts`: no gift component or module uses `dangerouslySetInnerHTML`, `innerHTML` or a markdown renderer for these fields. int: the order file (D165) writes a message starting `=` as text (formula characters escaped). |

Expected rating after the run: **full**.

### 6.5 Database tests, cross-cutting tests and scans

- **PGlite `src/db/orders-ops.test.ts`:** 3.3 points 1 to 12 one by one; a **property test of the sequence** (random sends, expiries, reopens, archives, tags: `order_number_audit()` clean and no order's number ever changes); the two
  patched functions keep every earlier copied-order test green; `anonymise_order()` blanks the gift fields and the frozen-gift trigger lets it; the re-added `orders_anonymised` check; the search indexes exist and are
  `gin` with `extensions.gin_trgm_ops`.
- **Scans (source reads):** (a) **orders are inserted and numbered only in `order-insert.ts`** (and the renewal's use of it) and nowhere else; (b) `archived_at` is written only by `order-archive.ts` and the copy function's default; `order_tags` rows
  only by `order-tags.ts`; `draft_orders.status` only by `draft-orders.ts`/`draft-pay.ts`/the triggers; (c) **no list condition is built outside `orderListWhere()`**; (d) `payment-readers.scan.test.ts`: every reader of
  `payments.provider` is in an allow-list with a reason (3.1); (e) `restricted-orders.scan.test.ts` stays green with the new email and name predicates; (f) `permissions.scan.test.ts` and its baseline with the new pages and actions;
  (g) the audit actions named in this file are in `AUDIT_AREAS` (prefix `order.`); (h) `gift-no-html`; (i) `pay-routes.graph.test.ts`: the cart's gift component and the pay page import neither zod nor a server module the pay-route rule forbids,
  and `/account/pay/` is in `isNoExtrasPath()`.
- **Registers:** `privacy.test.ts` (entries of 3.7), `commerce.test.ts` (`COPY_RULES`), `admin-map.test.ts` and `store-nav` tests (new pages in exactly one place), `owner-tool-permissions.test.ts` (new tools), the email-kinds test
  (`draft.pay_link`), `ui-catalog.test.ts`, `orders-plan-features.test.ts`, `KNOWN_COOKIES` unchanged.
- **Regression:** every existing test of checkout, backorder, standing orders, subscriptions, invoices, returns, store copy, the order file and the inventory stays green; `checkout-kinds.int.test.ts` keeps every old scenario.

### 6.6 Criteria changes (for the lead; the rows are not edited here)

1. **L1 and L2 stand as written** and are held more strongly than written (erased people are not found by email or name; copied history appears only where 2.2 says).
2. **T1** says "case-insensitive, at most 40 characters": stands. Added: Shopify allows only letters, numbers and hyphens; Kaizen allows more (4.2). Not a weakening.
3. **D2 and D4 need one clarification, proposed text:** D2 "Sending the draft emails a pay link; **the order is made when it is sent**, paying it completes it, the number is from the store's gap-free sequence (D141), and stock is held only from the send".
   D4 "An unpaid draft that expires **cancels its order, leaves the number sequence without a gap (`order_number_audit` clean) and releases its stock**". Reason: the criterion's "leaves no number gap" can be read as "uses no number";
   with the order made at send (1.4 decision 1) a number *is* used and stays on a cancelled order, as for every abandoned checkout. If the lead reads D4 as "uses no number", the alternative is to create the order at the
   first press of *Pay* instead (then a link nobody opens uses nothing); it needs a separate reservation table, which this spec rejects.
4. **D3 "refunds as an outside payment"** is made exact in 2.4 and 4.6 (a recorded refund with no Stripe call, a credit note by the existing trigger); the existing `outside` option (amount 0) stays for returns of orders paid at the venue.
5. **G2's second half is untestable as written** ("an email to the buyer never prints the message in a shipping notice to the recipient": there is no email to a recipient). Proposed text: "No email is ever sent to the gift's
   recipient, and the shipping notice to the buyer never carries the message." Held by the tests of G2.
6. **G1** "a stated length": 300 characters, 60 for each name, stated on the screen (4.1).
7. **L4** lists "print packing slips": a print is not a write, so "each is applied to every selected order or reports which one it refused" is held for it as "printed for every selected order that has something to ship, the others listed with the reason".

---

## 7. What is deliberately NOT done, and why

- **Editing an order after it is placed** (`orders.edit-an-order-after-placement`, a later run of wave 3): a draft is edited *before* it is an order; a sent draft is reopened, not edited in place.
- **Partial fulfilment, shipments tied to lines, pick lists, slip templates** (`orders.fulfilment-workflow-partial-fulfilment`, `orders.packing-slips-and-pick-lists`): bulk *Mark as sent* sends whole orders; the bulk slip and the gift block are built, a pick list and template choice are not.
- **Staff alerts, automation rules (a rule that tags or holds), editable notification templates**: rows `orders.staff-alerts-for-new-orders-order-automation` and `orders.editable-notification-email-templates`. Tags are what a rule will later set.
- **Bulk cancel and bulk refund, bulk capture, labels, Flow workflows** (Shopify's bulk list): cancel and refund move money and need a per-order amount and reason; there is no capture (Kaizen charges when the shopper pays). A bulk *cancel* of
  unpaid checkouts is not asked for.
- **Draft orders that sell subscriptions, appointments, stays, rentals, downloads, hosts' listings, weekly boxes or free gifts from a campaign:** they need a plan choice, a slot held under a lock, a buyer's express consent to start a
  download (CRD Art. 16(m), which staff cannot give for a buyer) or another seller's Stripe account. A draft sells **goods and custom service items**.
- **Campaigns, group discounts, discount codes, bonus credits and the welcome discount on a draft**: staff set the price or the staff discount; a code on a draft is not built (Shopify applies codes and automatic discounts).
- **Reverse charge on a draft**: needs a VIES-checked VAT number (D157's check is tied to a cart); a draft's buyer has none, so VAT is charged. A later run adds a staff *Check VAT number* with the same service and limits.
- **Carrier quotes, pickup points and delivery windows on a draft** (D135 to D138): a draft uses the flat rate, free, or a price staff set.
- **Several payments, deposits, payment terms ("net 30"), invoices paid later, authorise-and-capture**: wave 4 (B2B payment terms). A manual payment is the whole total, once.
- **Card details taken by phone** (Shopify's manual card entry): it would bring card data into the admin (PCI scope); the buyer pays on Stripe's page through the link.
- **A draft template, duplicating a draft, importing past orders as paid drafts** (Shopify mentions the last): the order file's import is wave 2's pipeline; not for orders.
- **Staff email when a draft is paid or expires**, **a reminder to the buyer before the link expires**: not built; the drafts page and the store Home's attention list show waiting drafts.
- **Personal saved views and the "desktop only" rule**: views are the store's and can be saved on any device (1.4).
- **A tag manager (rename or delete a tag store-wide), tag colours, automatic tags**: bulk remove covers deletion; renaming is a bulk add and remove.
- **Searching phone, street address or postal code; search by invoice number or customer id**: the personal surface of search stays small; invoices have their own search page (D159).
- **Column drag-and-drop and a column for every field**: a fixed set shown or hidden (2.2.3).
- **Exporting the current filtered list**: the order file (D165) has its own filters; a "download this list" button is not built.
- **Gift wrapping, a paid gift option, a gift receipt for returns with the price hidden, a message sent to the recipient or printed on the parcel's label, scheduled delivery of a message, per-line gift marking**: Kaizen prints the message
  on the packing slip only. A **gift receipt as a separate price-free document** is the packing slip (which has no prices).
- **Removing a gift message at the buyer's request**: the text is frozen on the order; a request is a note on the order and the slip is not printed with it. (The order is erased with the person under D162.)
- **Real-time updates of the list, a mobile layout beyond what the admin shell gives, keyboard shortcuts**: not asked for.
- **Notifying staff when a payment arrives after a draft expired**: the order completes and the order page shows `stock.short` where it applies.

---

## 8. Needs human legal review

Every text below is hand-written in nb, sv, da and en (the admin ones in English) and flagged `// legal: needs review` in the source; the legal ones are in `HAND_WRITTEN_ONLY` so no language is machine-translated. None is claimed to be
legal advice. **The rows that rest on them stay at the lead's judgement (1.1): the draft row stays partial until a person has read items 1 to 3, 5, 6 and 10.**

1. **The pay page** (`m.draftPay.*`): the state sentences (ready, paid, expired, replaced, payments off), the seller block's labels, the one-sentence **right of withdrawal** with its link, the backorder sentence it reuses from D172, the
   delivery-cost and VAT wording it reuses from the checkout, and the rule that the page shows no price the shopper cannot pay.
2. **The button.** The page uses the checkout's label (`m.payNow`: "Betal nå", "Betala nu", "Betal nu", "Pay now") as the checkout does. CRD Art. 8(2) asks for "order with obligation to pay" or an unambiguous equivalent; whether "Pay now"
   satisfies it is the open question `docs/wave-1-trust.md` already carries for the checkout. Decide once for both.
3. **The pay-link email** (`emailText().draft`): subject, heading, intro, the lines of the summary, "valid until {date}", the button, the store's note (quoted, never HTML), and the footer. Questions: does this email, with the pay page, meet the
   information duty before the buyer is bound; does a link valid for up to 30 days at a price fixed at send time need a stated price guarantee; may the store's note contain terms.
4. **Gift words** (`m.gift.*`, `emailText().giftMessage`): the box, "Your gift message", the slip's block. Interface text, not legal text; listed because the buyer's text is stored with the order.
5. **The invoice's wording for a payment taken outside Kaizen** (`invoiceText().paidOutside` and the three methods, on the invoice and the credit note): "Paid by bank transfer, cash or another way outside the online checkout" in four
   languages, and the rule that such an invoice states **how it was paid** rather than "paid online". Questions: the exact words national invoice rules need for a payment received in cash; whether a credit note for a refund
   Kaizen only recorded needs more.
6. **The warning beside *Cash*** (English admin text): "Cash taken when goods are handed over is a cash sale under the cash register rules in many countries. Record it here only if your accountant says this is allowed.
   Recording a payment here does not replace a cash register." (now followed by the cash ceilings held as data, `cashRuleWords()`) and the warning on the refund form ("Kaizen cannot see whether you paid the customer back").
7. **Open legal questions, not answered by the code:** whether a cash payment recorded on a draft order is a *kontantsalg* needing a cash register in Norway (Skatteetaten's page, read, says cash or card at delivery is; bank transfer and internet sales are
   not; a sale agreed by link and paid in cash on delivery is the case to ask about), and the position in **Sweden** (kassaregisterlagen), **Denmark** (digital cash register rules) and **Germany** (KassenSichV), **none read**.
   **The cash-payment ceilings (added by the review).** Some countries forbid a business to receive cash above a ceiling: Norway's hvitvaskingsloven § 5 (https://lovdata.no/lov/2018-06-01-23/%C2%A75; Skatteetaten's guidance on the cash ban,
   https://www.skatteetaten.no/en/rettskilder/type/uttalelser/prinsipputtalelser/endringer-i-hvitvaskingsloven--veiledning-om-kontantforbudet/) is reported as 40,000 NOK for goods; Denmark has a similar ceiling reported as 15,000 to 20,000 DKK, **not read in an official source**.
   They are data in `src/lib/cash-limits.ts` (`CASH_RULES`, each with its source and `verified: false`): Norway's is **enforced** (cash at or above it is refused with `cash_limit`; the order of an open draft is rolled back with the refusal) and Denmark's only **warns**. **A person
   must read the sources, confirm the amounts, whether the ceiling is per sale or per day, whether it applies to the business and the goods sold, and add the countries Kaizen does not know of (Sweden, Germany and the rest are not held: no row is not a statement that there is no rule).**
8. **Gift data of a third party.** The message and the recipient's name are the buyer's text about another person. Is the information duty towards the recipient (GDPR Art. 14) met by the store's privacy statement, may the
   message be kept for the bookkeeping period with the order, and should the recipient's name be left out of the export of the *buyer's* data?
9. **Custom service lines and withdrawal.** A custom item is a `service` line with no exclusion, and the withdrawal function answers any service as a booking (4.7). Until a person decides what period and what refund rule apply to a service sold by link
   (CRD Art. 9 and 16(a)), **a custom item is sold to businesses only** (`custom_consumer`). Questions: what a consumer service needs (the express request to start within the period, the acknowledgement of losing the right, the proportionate payment), and whether to lift the block.
10. **The staff discount label** the buyer sees, and the **retention** of a draft's contact data (90 days open, 30 days after it ends): are these defensible, and is a draft the buyer never saw "personal data of a person who
    is not yet a customer" needing a lawful basis stated in the privacy statement?
11. **The invoice's staff discount line** (`invoiceText().discountKinds.staff`: "Rabatt gitt av butikken", "Rabatt från butiken", "Rabat fra butikken", "Discount given by the store", followed by the label staff gave it): hand-written, flagged, kept out of the AI catalogue. Questions: whether a discount that is not a code or a campaign needs more on a legal invoice.
12. **The received day of money taken outside Kaizen** (`payments.received_on`, the invoice's supply date): the day staff give decides the VAT and OSS period of the sale (Directive Art. 63 and 65 as the wave 1 specs read them), so a person must say how far back it may be dated (31 days is the code's number, `MANUAL_RECEIVED_DAYS_MAX`) and whether a transfer received in a period already filed may be recorded at all.

---

## 9. For the lead

### 9.1 Migrations expected

Six files (3.8, 3.15), additive. Each runs in one transaction through CI (`docs/ci-migrations.md`) after the checks pass; none is applied by hand first. The old code (which has no gift, tag or archive concept) keeps working against
the new schema until the deploy finishes: every new column has a default or is nullable; the one re-added check (`orders_anonymised`) is dropped and re-added in the same file (a short lock on `orders`); the new indexes are plain `create
index` on tables that already exist (a short build; on a large `orders` table run the search file in a quiet hour, it is a separate file so it can wait). Stamps must sort after the latest committed file (`20261006121317_inventory_draw_claims.sql`);
rename before they are applied, never after.

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

The migration tool cancels statements with `DELETE` or `DROP` inside function bodies; CI applies through a direct connection, so none of these needs the owner. For completeness:
- **No function in this unit contains `DELETE`, `TRUNCATE` or `DROP`**: retention is application code (`pruneDraftOrders()`, `pruneAnonymisedOrderTags()`), the anonymising patch only nulls columns, the draft lifecycle trigger raises.
- `ALTER TABLE commerce.orders DROP CONSTRAINT orders_anonymised` (then `ADD CONSTRAINT`) is plain DDL outside any function.
- The `DO $patch$` blocks read the **live** definitions of `commerce.copied_orders_read_only()`, `commerce.refuse_copied_order_event()`, `commerce.anonymise_order()` and `commerce.issue_order_invoice()` with `pg_get_functiondef` and replace a
  named text; **each raises if its anchor is not found** (so the file fails instead of silently not patching), and each is skipped when its marker text is already there (idempotent). Check the four anchors against **production's**
  present definitions before the push (`select pg_get_functiondef('commerce.issue_order_invoice(uuid)'::regprocedure)` and the others): the invoice function was last replaced by `20261004125337`/`20261004152302`, the copied-order guard
  last patched by `20261004174402`, and `anonymise_order()` by `20261004174402`.
- `clone_store()` and `duplicate_store()` are **not patched** (3.7).

### 9.3 Advisors to check after the deploy

Security: five new tables with RLS on and no policy; every new function `SET search_path = ''` and not granted to `anon`/`authenticated`; the new `payments.recorded_by` and `orders.made_by` foreign keys to `accounts` have indexes.
Performance: the trigram indexes on `orders` and `order_lines` add a write on every placement (the payment path inserts the order and its lines in one transaction), so look at the order placement time (`checkout.int.test.ts` timings and
the function's duration in production) and keep any index the advisor calls unused until the list has been used for a week; `order_tags` and `draft_orders` indexes as listed in 3.5.

### 9.4 Decision row, draft (D173, the next free number at ship time)

> **Order search, filters, saved views and bulk actions; tags and archive; draft orders with pay links; gift messages (wave 3, second run).** `docs/wave-3-orders.md` is the contract. The Orders page reads its state from the address
> (`parseOrderListParams()`: search over number, email, name, line title and SKU, tag and tracking number; filters for status, payment, fulfilment, tag, market, source, gift, a store-day date range; keyset paging, 50 a page, a
> count capped at 10,000), saved views are the store's (30 at most), and bulk actions (tag, archive, mark sent, print slips; 250 at most) run order by order and report each refusal. All list conditions are built by one function,
> `orderListWhere()`. Orders have tags (`order_tags`: 40 characters, 250 per order, case-insensitive) and an archive state (`orders.archived_at`, a visibility flag only; the number sequence is untouched; a return unarchives; automatic archiving
> is an owner option), both usable on copied orders (two guard functions patched). **Draft orders** (`draft_orders`, `draft_order_lines`): staff price goods and custom items with a custom price, a staff discount, shipping and a market, through
> `priceDraft()` built from the checkout's own VAT, shipping and allocation functions (equal to `cartSummary()` for the same goods); *Send* makes the order (`source = 'draft'`) from the one shared insert `src/server/order-insert.ts`, takes its number from D141's
> sequence and holds stock until the draft's expiry; the buyer pays through a hashed-token link (`/account/pay/{token}`) that opens Stripe's hosted page, or staff record a payment outside Kaizen (a `payments` row with
> provider `manual`, a method, owner-only unless the owner allows staff), which the invoice states as paid outside Kaizen and a refund of which is recorded without a Stripe call and gets a credit note by the existing trigger; an expired draft cancels its
> order, releases the stock and leaves no gap. **Gift messages** (store switch, default off): `is_gift`, *To*, *From* and a 300-character message on the cart and the order, cleaned by `cleanShopperText()` (no HTML, no
> bidi or control characters, refused not cut), frozen after placement, erased with the order, printed on a price-free packing slip (single and bulk), never in a shipping notice and never sent to a third party. `[Migration versions to record: …]`

### 9.5 CLAUDE.md bullet, draft (Admin section, after the inventory bullet)

> - **Orders: list, tags, archive, drafts, gift (wave 3, D173, `docs/wave-3-orders.md`)**: the Orders page's state is its address, parsed only by `parseOrderListParams()` (`src/lib/order-list.ts`; unknown keys dropped, invalid values ignored) and turned into SQL only
>   by `orderListWhere()` (`src/server/order-list-sql.ts`: the list, the count, the bulk "all matching", saved views and the AI tool); search matches number, email, name, line title and SKU, tag and tracking number, with `restricted_at is null`
>   on email and name (D162) and every `LIKE` word escaped and bound; paging is keyset. Saved views are `order_views` (the store's, 30 at most, `title` not `name`); bulk actions (`runBulk()`, 250 at most) run order by order and report each refusal. Tags are
>   `order_tags` (`normaliseTag()`: 40 code points, 250 per order, case-folded key; the history event carries the words in `data.note` so erasure covers it); archive is `orders.archived_at`, a visibility flag set only by `src/server/order-archive.ts`
>   under `archiveBlock()`; both work on copied orders (the two copied-order guard functions allow exactly `archived_at` and three event types). **Orders are inserted and numbered only in `src/server/order-insert.ts`** (called by `placeOrder()`, the
>   renewal and `placeDraftOrder()`; a scan test). A draft (`draft_orders`) is priced only by `priceDraft()` (`src/lib/draft-order.ts`, built from `decideTax()`, `basketShipping()`, `allocate()` and the repo's half-up rounding; equal to `cartSummary()` for
>   the same goods) and becomes an order when **sent** (order `pending_payment`, `source = 'draft'`, stock held to the draft's expiry, tags carried over); the buyer pays through `/s/{store}/{market}/account/pay/{token}` (a token kept only as a hash, a
>   page that opens Stripe's **hosted** session, `isNoExtrasPath()`), `applySession()` never cancels a draft's order on a session expiry, `expireDrafts()` does at the draft's expiry. Money taken outside Kaizen is a `payments` row with
>   `provider = 'manual'` and a `method` (owner-only unless `order_settings.staff_mark_paid`), the invoice says `paid_outside`, and a refund of it is a `refunds` row recorded `succeeded` with no Stripe call; never add a reader of
>   `payments.provider` outside `payment-readers.scan.test.ts`'s list. No campaigns, codes, credits or VAT-number checks on a draft; no AI tool records a payment. A staff-made order counts everywhere except conversion, the funnel and channels (`docs/analytics.md`).
>   Gift messages (`order_settings.gift_messages`, default off): `carts` and `orders` carry `is_gift`, `gift_to`, `gift_from`, `gift_message`, cleaned by `cleanShopperText()` (`src/lib/gift.ts`, no zod: the cart is a pay route), refused not cut, frozen by a trigger,
>   shown to the buyer, staff and the slip, never in `sendShipped()` and never emailed to anyone but `order.email`. New words are hand-written and flagged (`HAND_WRITTEN_ONLY`); consumer texts need legal review.

### 9.6 Merge notes

- Shared files other work may touch: `src/db/schema.ts`, `src/lib/i18n.ts`, `src/lib/email-text.ts`, `src/lib/invoice-text.ts`, `src/lib/store-nav.ts`, `src/lib/admin-map.ts`, `src/lib/store-parts.ts`, `src/lib/owner-tools.ts`, `src/server/checkout.ts`,
  `src/server/checkout-kinds.int.test.ts`, `src/server/order-admin.ts`, `src/server/orders.ts`, `src/lib/personal-data.ts`, `src/lib/store-copy-rules.ts`. Edits are small and local, except `checkout.ts`, whose extraction of the order insert
  and the Stripe session is the one large move: land it first and run every checkout test before anything builds on it.
- `docs/analytics.md` (the staff-made definitions) and `docs/wave-2-data.md` 4.2 (the order file's columns) are edited by the analytics-and-ai area in the same change.
- Run no other wave that edits the shared registries at the same time (`docs/parity-plan.md` section 4.8).

### 9.7 Before pushing (the things CI cannot prove)

1. **By hand, signed in:** open the Orders page with a few hundred orders, search by number, email, name and product, filter by payment and tag, save a view and reopen it, select several orders, tag, archive and unarchive them, print their slips,
   mark two as sent with and without emailing; tag and archive a copied order. Decide whether this lifts the first row from partial to Full (1.1).
2. **A draft end to end in Stripe test mode on a real store:** make a draft with a product, a custom item, a custom price and a discount, send it to your own address, open the link, pay with a test card, and check the order, the invoice and the
   confirmation; send another and let it expire (shorten its validity in the database); record one paid by bank transfer and read its invoice; refund it and read the credit note. Decide whether the draft row can move (it also waits for section 8).
3. **A person who reads Norwegian, Swedish and Danish** reads the pay page, the pay-link email, the gift words and the paid-outside invoice wording on screen (section 8).
4. **Look at the packing slip of a gift order** (printed, from the order page and from the bulk page) in a krone store and in a euro store; check there is no price on it.
5. **Check the payment path's timing** on a copy of production data after the trigram indexes exist (9.3), and that `complete_order_payment()` still issues the invoice for a card payment and for a manual one.

### 9.8 Blockers and risks

**No owner decision and no credential stops the work (`blockers` is empty).** Risks: (1) **extracting the order insert and the Stripe session from `checkout.ts`** touches the most tested money path; the equivalence test of 4.5 point 8 and every
existing checkout test are the safety net, and if the extraction proves unsafe the fallback is a second insert in `order-insert.ts` used by drafts only, the scan test extended to name it (record the deviation in 3.11); (2) the **invoice payment
patch** replaces a live function by anchor: the parity test with a manual fixture must pass before the push; (3) **trigram indexes on the payment path** (9.3); (4) the **by-link payment** is verified against a fake Stripe in CI and for real only by 9.7 item 2;
(5) the **legal questions of section 8**, above all cash and the button label, which may change the offered methods or the pay page's wording without changing the data model; (6) the admin screens are not clickable in CI, so their evidence is views plus
server tests and one by-hand check; (7) **scope**: this is the largest wave 3 run so far (four rows, five tables, a new money path); if the budget forces a cut, cut in this order and say so in the report: AI tools, the control-center figures, the order file
columns, automatic archiving, the euro scenarios of the gift (never the draft's), never the tests of the rules in 3.3.
