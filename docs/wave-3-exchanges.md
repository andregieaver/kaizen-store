# Wave 3: exchanges and return labels (decision D239 proposed)

This file is the contract for the run `parity-wave` with `wave: 3`, `spec: docs/wave-3-exchanges.md`, rows `orders.exchanges` and `orders.return-labels`. Code, tests and texts
follow it; a disagreement is settled here first (the agent that must deviate changes this file in the same edit, in a "3.x As built" paragraph, and says so in its report). It was
written from the tracker rows, `docs/parity-plan.md`, CLAUDE.md, `docs/returns.md` (D153, the model and the base), `docs/wave-3-orders.md` (D173: drafts, pay links, money taken
outside), `docs/wave-3-fulfilment.md` (D174: order changes, a difference paid by link or refunded), `docs/wave-1b-invoices.md` (D159), `docs/shipping-carriers.md` (D133 to D138),
`docs/wave-3-notifications.md` (D238) and the code as it is on 2026-10-15 (commit `4640316`). It invents no parallel order, payment, refund, stock, document or carrier system: an
exchange is a D153 return whose credit pays a new order made by the one order inserter, and a return label is a carrier booking made through the existing `ShippingCarrierAdapter`.

**What was found in the code that shapes everything below** (verified 2026-10-15):

- **Returns** (`commerce.returns`, `return_lines`, `return_settings`; `src/server/returns.ts`, `src/lib/return-refund.ts`, `src/lib/return-status.ts`): a return is refunded once
  by `refundReturn()`, which works the amount out again with `refundFor()` (line values actually paid − deductions + the standard delivery on a whole withdrawal − the return shipping
  the shopper pays), claims the refund (`refund_claimed_at`), and calls `refundOrder()` with `returnId` and `inTransaction`, which writes the return's refund columns, the restock and
  the refund row together. `returns.outcome` is `refunded | declined | no_refund | cancelled` (check `returns_outcome`). `returns.return_shipping_minor` is "what the store paid for a label
  it charges the shopper for" and is taken off only when the order's `return_cost_payer` is `shopper`. `returns.label_url` is a **pasted** https address, shown on the status page and
  emailed as a button (`return-emails.ts`). The lifecycle (`actionsFor()`) offers *Refund* from `in_transit` on when the store withholds until received, at once otherwise.
- **Orders are inserted and numbered only in `src/server/order-insert.ts`** (`insertOrder()`, `insertOrderLine()`, `allocateStock()`, `reserveStock()`), called today by `placeOrder()`,
  the renewal and `placeDraftOrder()` (scan tests `order-numbers.test.ts`, `stock-writers.scan.test.ts`, `vat-readers.test.ts`, `unit-price-readers.test.ts`). `orders.source` is
  `checkout | draft` (check `orders_source`, `orders_source_draft`). `placeDraftOrder()` is the nearest model of what an exchange order needs: priced by `priceDraft()` (built from
  `decideTax()`, `basketShipping()`, `allocate()`; equal to `cartSummary()`), stock held to an expiry, an order `pending_payment` paid through a hashed-token link and Stripe's **hosted**
  session (`draft-pay.ts`, `draft-sessions.ts`), with `recordTermsForOrder()` for the terms.
- **Paying a difference** exists for changes (D174: `order-edit-pay.ts`, `/account/change/{token}`, `applySession()` branching on `payments.order_edit_id`, `expireOrderEdits()`,
  `settleOrderSessions()`), and **refunding through `refundOrder()` with `inTransaction`** is how every refund is recorded with its consequences. `refundOrder()` splits over captured
  payments (`splitRefund()`), takes `paymentId`, `outside`, `returnId`, `eventData`.
- **Credit notes** (D159) come from a succeeded refund (`source = 'refund'`, deferred trigger) or a return refunded outside (`source = 'return_outside'`, from `returns.refund_working`);
  `make_credit_note()` already skips refunds that something else documents (`order_edit_id`, D174 3.3 9(e)); `payment_on_invoice()` decides whose invoice a payment belongs to.
- **Carriers** (`src/lib/shipping-carriers.ts`): `ShippingCarrierAdapter` has `check`, `rates?`, `pickupPoints?`, `book?`, `track?`; `book()` is outbound only. Bring's Booking v2 is
  built (`bookingBody()`, `parseBooking()` in `src/lib/bring.ts`; `bringBook()`, `bringLabel()` in `src/server/bring-shipping.ts`); labels are fetched from Bring with the store's keys
  when printed and never stored (`carrier-label.ts`, `carrierLabel()`). PostNord has no booking; Porterbuddy and Helthjem book outbound only.
- **Notifications** (D238): every customer email is a `NOTIFICATIONS` entry (`src/lib/notifications.ts`) with a switch asked through `notificationOn()`, an `EMAIL_KINDS` entry and a
  template slot list; the return emails are `return.acknowledgement` (required), `return.approved`, `return.declined`, `return.received`, `return.refunded`.
- **No-extras paths** (`src/lib/pay-routes.ts`): `isPayLinkPath()`, `isChangeLinkPath()`, `isDocumentPath()`, `isSupportLinkPath()`; a new bearer-token page joins `isNoExtrasPath()`.
- **The signed-in admin fixture exists** (D234), so this run can hold the staff screens with an e2e (`e2e/fixtures/auth-stub.mjs`, CI's `signed-in` job).

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Now | Bucket | What this run can honestly reach |
|---|---|---|---|---|
| `orders.exchanges` | 2 | missing | A | **Partial, Full by the criteria.** Every criterion is built and held: replacements added to a return with the difference worked out by the checkout's own pricing (`priceDraft()` over `decideTax()`), in kroner and in a euro view (unit and integration tests); processing makes a linked new order numbered from the store's sequence through `insertOrder()`, holding stock only then (integration and PGlite tests); a difference owed by the shopper goes out as a pay link, one owed to the shopper is refunded through `refundOrder()` (integration tests with the repo's fake Stripe); the credit is never lower than `refundFor()`'s and never applied to an exchange without the shopper's own press (PGlite and integration tests). By D173's and D174's precedent the lead holds it at **partial** until (a) the consumer texts of section 8 are read by a person and (b) one exchange's pay link has been paid in Stripe test mode on a real store (9.6); then Full. |
| `orders.return-labels` | 3 | partial | **B** | **Partial, kept.** Built as far as code goes: a return label booked from the shopper's address to the return address through the store's own Bring agreement (return service, `bookReturn()`), its label address kept on the return, the label reaching the shopper by an email button and the status page through a Kaizen route that fetches it from Bring's own host and never stores it, its cost taken off the refund only when the shopper pays return shipping and never above the cost, and the pasted-address path untouched when booking fails (integration tests with a faked carrier, unit tests with `refundFor()`, an e2e on the status page). It **stays partial** (bucket B): nothing here has met Bring's servers (the return service's party roles and label link are documented only in part, 1.2), the store needs a return agreement with Bring (Bring's error `BOOK-INPUT-043`), and only Bring books returns; the row can move only after one return label has been booked and printed with a real Mybring test user (9.6). |

No row needs a decision of `docs/parity-plan.md` section 5. No credential stops the build: the difference is paid through the store's existing Stripe (or recorded as paid outside
Kaizen, D173), and the carrier side is built against a faked adapter as D134 was. **`blockers` is empty.** Weights are not changed (tracker rule 6).

Rows this run touches but does not close: `orders.self-serve-withdrawal-and-return-requests` (the request form gains the optional exchange wish; its rating does not move),
`orders.editable-notification-email-templates` (three new notifications join `NOTIFICATIONS`, with slots), `orders.draft-and-manual-orders` (nothing), `customers.gift-cards` and store
credit (nothing: an exchange is not store credit, section 7).

### 1.2 What Shopify does, and what the carrier and the law say (pages read on 2026-10-15)

- **Exchanges** (https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/creating-returns, read 2026-10-15): "You can also add exchange items to your return", with a
  product discount on them; "Order level discounts can't be applied to exchange items"; "You can't add custom items as exchange items"; "You can't add exchange items to orders with
  duties"; "Exchange items inventory isn't reserved until you process the return"; "Return fees and exchange items are applied against returned items to determine whether a refund is due
  or payment needs to be collected"; for an even exchange "The money paid for the returning items is applied to the new items"; staff "collect the balance by sending an invoice when
  processing a return", or capture or mark as paid; "Avoid issuing refunds during partial processing if you'll need to collect payment later for remaining items". Restocking fees per
  return or item; a return shipping fee per return. The page does not state a return window for exchanged items (the row's text from 2026-10-03 says they have their own).
- **Return labels** (https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/shipping-labels/buying-labels/return-labels, read 2026-10-15): "Return labels are available only
  for US domestic orders" (USPS, FedEx, UPS); "Return labels use pay-on-scan billing … you aren't charged when you create the label"; staff email the label, copy a link or print it;
  "You can't automatically charge the customer for the label cost … you must do this manually when processing the refund"; "Return labels can't be voided, but they can expire". When
  creating a return: *Create a return label in Shopify* (US only), *Upload a return label* (a file or a label URL, with an optional tracking number and carrier), or *No shipping
  required*.
- **Bring** (https://developer.bring.com/api/booking/, read 2026-10-15): the Booking API has a return service example ("Return Parcels Service", product `9300`); "Sender phone is
  mandatory … Exceptions to this rule are … all return services"; responses may carry `returnLinks` and `returnConsignmentNumber` (for a return booked with an outgoing parcel), and
  `labelFreeCode`/`qrCodeLink` on packages; errors `BOOK-INPUT-043` ("The customer does not have a return agreement for that country/product") and `BOOK-INPUT-083` ("Invalid Return
  Product ID"); the test indicator is the `X-Bring-Test-Indicator` header (the payload option is deprecated). **Free return**
  (https://developer.bring.com/api/booking/free-return, read 2026-10-15): for Norwegian domestic parcels a return product (`9000`, `9300`, `9600`, `9350`) can be booked with the
  outgoing shipment; "You will be invoiced for the return only if your customer uses it". **Not read** (and so not asserted): the names of `9350`, `9000`, `9600`; which party is
  `sender` and which `recipient` in a standalone return (the example's two parties are unlabelled in the page's text); whether a standalone `9300` is billed on use. The foundation
  writes these as `needs confirmation with credentials` in `src/lib/bring.ts`, and 9.6 checks them.
- **Law.** CRD Art. 13(1) (https://www.legislation.gov.uk/eudr/2011/83/article/13, read 2026-10-15): the trader reimburses "using the same means of payment as the consumer used for the
  initial transaction, unless the consumer has expressly agreed otherwise and provided that the consumer does not incur any fees as a result of such reimbursement", within 14 days of
  being informed; 13(3): the trader "may withhold the reimbursement until he has received the goods back or until the consumer has supplied evidence of having sent back the goods,
  whichever is the earliest". Art. 14(1) (https://www.legislation.gov.uk/eudr/2011/83/article/14, read 2026-10-15): "The consumer shall only bear the direct cost of returning the
  goods unless the trader has agreed to bear them or the trader failed to inform the consumer that the consumer has to bear them". Art. 22 (read for D174): express consent to any extra
  payment.

What Kaizen matches: replacements added to a return, from the catalogue only (no custom items), with a price staff may lower per line and no order-level discount; stock not held until
the return is processed; return fees (the label the shopper pays for, and inspection deductions) and the replacements netted against the returned items into *refund due*, *even* or
*to pay*; the balance collected by a link the customer pays (or recorded as paid outside Kaizen) or the rest refunded; three return-shipping choices (book a label with a connected
carrier, paste a label address, no label); the label emailed and on the status page; its cost charged to the shopper only by the store's rule.
**Where Kaizen goes further on purpose:** the replacements are a **new order** with its own number from the gap-free sequence (D141), its own invoice and its own right of withdrawal,
linked to the return and the original order both ways; an exchange is applied **only on the customer's own confirmation**, because the refund then goes another way than the payment
came (Art. 13(1)); a withdrawal's credit is never lower than its legal refund; the label cost is never above what the store paid (Art. 14(1)). **What it deliberately does not match**:
section 7.

### 1.3 Terms used in this file

- **Return** and **withdrawal return**, **voluntary return**: as D153. **Original order**: the order the return belongs to.
- **Credit** `C`: what `refundFor()` says the return is worth to the shopper now (returned value − deductions + delivery given back − return shipping the shopper pays), in the original
  order's currency. An exchange never computes it another way.
- **Replacements**: catalogue goods variants staff put on an exchange, with quantities and prices. **Replacement total** `T`: what the exchange order will cost (goods + shipping, VAT
  included), from `priceDraft()`.
- **Difference** `Δ = T − C`. `Δ < 0`: **refund due** (`−Δ` goes back to the original payment). `Δ = 0`: **even**. `Δ > 0`: **to pay**.
- **Exchange** (`return_exchanges` row): one proposal of replacements for one return, with a lifecycle (3.3). **Proposed**: sent to the customer, not yet confirmed. **Confirmed**: the
  customer pressed *Confirm the exchange* (or, for a voluntary return only, staff recorded the customer's agreement). **Processed**: the exchange order exists. **Settled**: the exchange
  order is paid and the return's refund is recorded.
- **Exchange order**: the new order (`orders.source = 'exchange'`, `orders.exchange_id`), numbered from the store's order sequence.
- **Transfer**: the part `min(C, T)` of the credit applied to the exchange order: on the original order a `refunds` row with no Stripe call (`refunds.exchange_id`, `kind`
  `transfer`), on the exchange order a `payments` row with `provider = 'exchange'`. The rest of the credit (`max(0, C − T)`) is an ordinary Stripe refund through `refundOrder()`.
- **Return label**: a carrier booking from the shopper's address to the store's return address. **Booked label** (`returns.label_source = 'carrier'`) vs **pasted label**
  (`label_source = 'pasted'`, D153's `label_url`).

### 1.4 Decisions this spec makes (the lead may veto any before the build; each is argued where it is used)

1. **An exchange is a new order, paid partly or wholly by the return's credit.** The credit moves as a pair of rows that never reach Stripe (a `transfer` refund on the original order, an
   `exchange` payment on the new one, equal and written in one transaction), so the original order is documented as a return (a credit note) and the new one as a sale (an invoice), each
   with the VAT of its own supply (VAT Directive Art. 90 for the first, an ordinary supply for the second), and every existing reader of refunds and payments stays right (4.4, 4.6).
2. **No exchange without the customer's own act.** A proposal is confirmed by the customer's press on the exchange page (a timestamped record). For a **voluntary return** staff may
   instead record the customer's agreement (channel, store day, note), as D153 lets staff register a withdrawal; for a **withdrawal return** they may not (Art. 13(1) "expressly
   agreed"; section 8 item 2 asks whether a recorded phone agreement would do).
3. **The credit is never lowered by the exchange.** `C` is `refundFor()`'s for the return as it stands at processing; nothing about the exchange enters `refundFor()`; a restocking fee is
   not built (7). If inspection lowers `C` after the customer confirmed so that they would pay more than they agreed, processing refuses (`credit_changed`) and the exchange is proposed
   again.
4. **Replacements are priced as the checkout prices them**: `priceDraft()` with goods lines only, the market's list price as shown in the original order's market view (`shown()`), an
   optional lower price per line typed by staff (D173's custom price, the price charged), no code, campaign, group discount, credits or welcome discount; VAT by `decideTax()` over the
   original order's market and buyer; shipping free by default, or the market's flat rate, or a price staff set (4.2).
5. **Stock is held only when the return is processed** (Shopify's rule): a proposal holds nothing; processing allocates and reserves through `allocateStock()`/`reserveStock()` and the
   exchange order draws at payment as any order does.
6. **Processing is two steps in two transactions**: (a) make the exchange order `pending_payment` with its stock held; (b) settle (the transfer, the remainder refund through
   `refundOrder()` or the pay link's payment, the order completed). Stripe is called between them, never inside a transaction that also allocates stock, so a stock shortage can never
   follow a refund already sent (4.4).
7. **Only standard orders of goods are exchanged**: not copied, not a host's, `vat_kind = 'standard'`, not a subscription, weekly box or booking, not restricted (D162), in an open store
   with the shop on (4.3).
8. **Return labels are a carrier capability, not a carrier**: the adapter gains `bookReturn?()`, the registry the feature `return_labels`; Bring is the only one built. A booked label's
   address is never shown to the shopper as it is (it needs the store's keys): the shopper opens a Kaizen route that fetches it from the carrier's own host each time (4.7).
9. **A label never decides money by itself**: its cost becomes the return shipping deduction only when the order's `return_cost_payer` is `shopper`, never above the cost, and staff
   may lower it (4.8).
10. **The AI manager reads exchanges and labels and does neither** (2.6).

---

## 2. Behaviour

### 2.1 Shopper side

- **Asking for an exchange (optional, never in the withdrawal's two steps).** The withdrawal function's steps are unchanged (D153: no reason, nothing more asked). Afterwards, the
  return's status page `/s/{store}/{market}/returns/{token}` shows, while the return is open, not refunded, and the store has exchanges on (`return_settings.exchanges`, default on) and
  the order can be exchanged (4.3): *Would you like something else instead of your money back?* with a text field (*What would you like instead?*, up to 500 characters, plain text,
  `cleanShopperText()`) and *Ask for an exchange*. It records the wish (`returns.exchange_wish_at`, `exchange_wish_note`) and emails the store's contact address once
  (`return.exchange_wished`, staff alert, no customer data beyond the order and return numbers). The page then says "Your wish is sent. The store will send you a proposal; until you
  confirm one, you will get your money back as usual." A voluntary return request (D153's form for goods outside the right) offers the same field beside its reason. A wish is not an
  agreement: nothing is applied from it.
- **The exchange page** `/s/{store}/{market}/account/exchange/{token}` (a no-extras path, `isExchangeLinkPath()`: `noindex`, `Referrer-Policy: no-referrer`, no cookie, storage,
  tracking, chat or consent manager, entered by a full page load; valid only under the original order's own country; the token is 32 random bytes kept only as a SHA-256 hash):
  - shows the store and seller block, the return's number, **what you send back** (lines, quantities) and **your credit** `C` with its working (`refundFor()`'s rows, as the refund email
    shows them), **what you get** (replacements: title, variant, quantity, price each, line total; a backorder sentence of D172 for a backordered variant), the shipping, the
    replacement total `T`, and the outcome: *We refund you {−Δ}* / *Nothing more to pay or refund* / *You pay {Δ}*, the terms link (`checkout_terms` words of D158), the right of
    withdrawal sentence for the new goods (the replacements are a purchase of their own), and the sentence "If you do not confirm by {date}, you get your money back as usual";
  - one button **Confirm the exchange** (`m.exchange.confirm`) and a link **No thanks, refund me instead**;
  - **Confirm** records `confirmed_at` (the express agreement), the terms the page showed (a `legal_snapshots` reference kept on the exchange, written to the exchange order's
    `order_terms` with this time when the order is made, `recordTermsForOrder()`), and answers "Confirmed. We make your new order when your return is processed; you will get an email."
    For `Δ > 0` it adds "You will be asked to pay {Δ} then." **Nothing is charged here**; no card is typed (no CSP pay route);
  - **No thanks** ends the proposal (`declined_by_customer`), emails nothing, and says "We will refund you as usual";
  - **The pay step** (`Δ > 0`, after processing): the same page shows *To pay now: {Δ}* and **Pay {Δ}** (`m.pay(Δ)`), which opens Stripe's **hosted** Checkout session for `Δ`
    (one line "Exchange for return {R}", quantity 1, no coupon), one idempotency key per press, at most `EXCHANGE_PAY_PRESSES_PER_HOUR`; after paying Stripe returns the customer to
    the exchange order's order page;
  - states in plain sentences: *proposed*, *confirmed (waiting for your return)*, *to pay*, *done* ("Your exchange is done: order {number}"), *expired*, *cancelled* ("This proposal no
    longer works. You get your money back as usual; write to the store with any question", with the contact address), *payments off*. An unknown, malformed or other-store token is the
    same 404 as a missing page.
- **The status page** (D153) shows the exchange's state beside the return's steps (*Exchange proposed* with the link, *Exchange confirmed*, *Exchanged: order {number}* linking to it,
  *Exchange expired, refunded as usual*), and the **return label** (2.3).
- **The exchange order** is an ordinary order for the customer: its order page (the payment's reference key, as every order), confirmation email (`order.confirmation` with the exchange
  sentence, 2.5), shipped emails, documents, its own **withdrawal** (D153 applies to it as to any order of goods: 14 days from its own receipt) and its own returns. Its page says
  "Exchange for return {R} of order {N}" with a link to the original order's page only when the visitor holds that page's key too (never by inference).
- **Languages**: everything the customer reads here is `m.exchange.*`, `m.returnLabel.*` and `emailText().exchange`/`.returnLabel`, hand-written nb, sv, da, en, in
  `HAND_WRITTEN_ONLY` (no machine translation; other languages show English for them), and the page is in the original order's language.

### 2.2 Staff side: the exchange (`/admin/{store}/returns/{id}`, the return's page)

Needs `orders:write` (seeing it: `orders:read`). The return's page gets an **Exchange** card while the return is not ended and not refunded, and the order can be exchanged (4.3);
otherwise the card says why in words (copied, a host's, reverse charge or IOSS, a subscription, a weekly box, a booking, restricted, the store is not open, the shop is off, exchanges off
in the settings, already refunded).

- **The customer's wish** (if any) is shown first with its time and note ("Customer asked for an exchange: 'size M instead'").
- **The builder** (one screen inside the card): *Add a product* (the D173 picker: active goods variants offered in the original order's market, `searchDraftVariants()`), quantity 1 to
  `EXCHANGE_QUANTITY_MAX`, the price as shown in the order's currency, editable **down** to a lower price (a product discount, as Shopify allows; never above the list price, `price_up`);
  at most `EXCHANGE_LINES_MAX` lines; *Shipping*: *Free* (default), *The market's standard rate* (`basketShipping()` on the replacements, as checkout judges it) or *Set a price*
  (VAT included); a **delivery address** (the original order's shipping address by default, editable, in the market's country: D173's rule).
- **The summary** is the server's (`previewExchange()`, the same function the processing uses; the browser never adds anything up): the credit `C` with `refundFor()`'s working (and
  "the credit can still change: inspection has not been recorded" while it has not), the replacements priced, `T`, VAT per rate, and **the outcome**: "Refund due to the customer:
  120,00 kr" / "Even exchange" / "Payment to collect: 149,00 kr", the stock state of each replacement (in stock, would be backordered with its days, would stop at zero: a warning,
  since nothing is held yet), and the documents it will make ("Credit note for the returned items on order 1042; invoice for the new order").
- **Send to the customer** (`proposeExchange()`): stores the proposal (`proposed`, prices frozen as shown, `expires_at` = 4.5's end), emails the customer the exchange page
  (`return.exchange_proposed`, to the order's own address only, D153's rule: never an address typed anywhere), and shows the link once with *Copy link*. *Create a link to share* does the
  same without the email. Staff can *Send again* (at most `EXCHANGE_SENDS_PER_DAY`) and *Withdraw the proposal* (ends it, `cancelled`, the customer's page says so).
- **Record the customer's agreement** (voluntary returns only; refused for a withdrawal return with `withdrawal_needs_customer`): how it came (`email`, `letter`, `phone`, `in_person`,
  `other`), the store day, a note (staff text, kept in the history event only). It confirms the proposal as the customer's press would (`confirmed_by = 'staff'`).
- **Process the exchange** is offered where *Refund* would be (`actionsFor()` gains `process_exchange` when a confirmed exchange exists and the refund would be offered; *Refund* is then
  not offered, and *Cancel the exchange and refund instead* is). Pressing it (`processExchange()`):
  - works `C` out again from what is stored and the replacements' VAT on the day; refuses `credit_changed` when `Δ` would be higher than the customer confirmed (a higher credit, or a
    lower `Δ`, goes through: it only helps the customer);
  - **step (a)**: makes the exchange order and holds its stock (4.4); a variant that stops at zero refuses with `stock_short` and nothing is made (staff change the proposal, which needs a
    new confirmation, or refund instead);
  - **`Δ ≤ 0`**: **step (b)** at once: the transfer `T`, the remainder `−Δ` refunded through `refundOrder()` on the original order's payment, the exchange order completed (paid,
    invoiced, its stock drawn), the return recorded (`outcome = 'exchanged'`, `refund_minor = C`), the restock of the returned units as inspected, one email to the customer
    (`return.exchanged`: the new order's number and link, the refund of `−Δ` if any). A Stripe refund that fails leaves the exchange order `pending_payment` with its hold, the exchange
    `processed` and the return unrefunded, and says Stripe's sentence; *Try again* repeats step (b) with the same idempotency key; *Cancel the exchange and refund instead* cancels the
    exchange order (`cancel_unpaid_order()`, stock released) and offers the ordinary refund.
  - **`Δ > 0`**: the exchange order waits (`pending_payment`, stock held until the link's end); the customer is emailed the pay step (`return.exchange_to_pay`). Staff may instead
    **Record as paid outside Kaizen** (the owner, or staff when `order_settings.staff_mark_paid` is on: D173's rule and the cash ceilings of `cash-limits.ts`, as `checkEditCash()` applies them), which settles at once with a
    `manual` payment of `Δ`. While it waits, the return page and the exchange order's page say so with the link's end and offer *Send again*, *Record as paid outside Kaizen* and
    *Cancel the exchange and refund instead* (which closes the Stripe session first, `settleOrderSessions()`, and refuses while Stripe says `processing`).
- **The original order's page** shows on its Returns card "Exchanged: order {M}" with a link; **the exchange order's page** shows "Exchange for return {R} of order {N}" with a link, a
  `source = 'exchange'` badge (*Exchange*) in the order list (filter `source=exchange`, through `parseOrderListParams()`/`orderListWhere()`), and is sent, packed, labelled and
  tracked like any order.
- **The queue** (`/admin/{store}/returns`) shows *Exchange wished*, *Exchange proposed*, *Exchange confirmed*, *Exchange: payment to collect* marks and gains a filter `exchange=` (wished,
  proposed, confirmed, waiting_payment). The refund deadline marks (`refundDue()`) are unchanged: a withdrawal return with an exchange still has its legal deadline, and an exchange that
  is not settled by it is *Overdue* as any unrefunded withdrawal.
- **Settings** (`/admin/{store}/settings/returns`, owner): *Offer exchanges* (`return_settings.exchanges`, default on) and the return label settings of 2.3.

### 2.3 Staff side: return labels

- **The choice.** Wherever D153 asks for a label address (approving a voluntary return; *Instructions, address and label* on an approved or in-transit return, which is where a
  withdrawal return, approved from the start, gets one), the field becomes **Return shipping**: *Book a return label with {carrier}* (offered only when a connected carrier has
  `return_labels` in `available`, the store's agreement is complete and checked, the shopper's address and the return address are in a country the carrier books returns in: Bring,
  Norway), *Paste a label address* (D153, unchanged) or *No label: the customer sends it themselves*. A booked label shows: carrier, service, tracking number with its link, *Test label*
  when booked in the carrier's test environment, the cost (when the carrier priced it), *Print label* (staff: the same route the shopper's button uses, through the admin) and *Book
  again* (only when the previous booking failed or was a test).
- **Booking** (`bookReturnLabel()`): the parcel's weight is estimated from the returned lines' variant weights (the D134 estimate), editable; the service is the carrier's return
  service (Bring: `9300` by default, `return_settings.label_service` when the owner set another the agreement covers); the price is asked first (`rates()` for the return product; an
  unanswered price is "price not known", which does not stop booking); then `bookReturn()`. A booking keeps on the return: carrier, consignment and tracking numbers, tracking link, the
  label's address at the carrier (private), the cost, `label_test`, `label_booked_at`; and writes `return.label_booked`. **A booking that fails** keeps the return as it was (the approval
  already happened, in its own transaction, before the carrier was called), shows the carrier's plain sentence ("Bring says the store has no return agreement for this country or
  service", `BOOK-INPUT-043`), and leaves *Paste a label address* and *No label* there: nothing about the pasted path changes.
- **Automatic labels for withdrawals** (`return_settings.label_auto`, owner, off by default; needs a carrier as above): a withdrawal return, which starts approved with no staff step,
  gets its label booked by the five-minute job (`runReturnJobs()`, at most `LABEL_TRIES` attempts, never inside the shopper's confirmation request: the carrier is never called while
  the withdrawal is confirmed, so its acknowledgement is never late for it). A voluntary return with the setting on has *Book a return label* preselected on approval.
- **Who pays** is the order's `return_cost_payer` (D153). *The customer pays*: the screen says "{cost} will be taken off the refund as return shipping" and the refund's working
  takes it (4.8); staff may lower the amount. *The store pays*: nothing is taken off, and the screen says so. A cost the carrier did not price is not taken off until staff type it.
- **Platform side**: no new page. The carriers' registry shows *Return labels* among a carrier's features; the plan comparison (D132) gets two rows (5.5).

### 2.4 The label for the shopper

- **On the status page**: *Your return label* with **Print your return label** (a booked label: links to `/s/{store}/{market}/returns/{token}/label`; a pasted label: its own address,
  as D153), the carrier, the tracking number and link, and the sentence on who pays ("The cost of the label, {amount}, is taken off your refund" only when it will be; "Return shipping
  is free for you" when the store pays). A test label says "This is a test label and cannot be used" (the store has not gone live with the carrier).
- **The label route** `/s/{store}/{market}/returns/{token}/label`: finds the return by its token among the store's own (an unknown or another store's token is a 404, as the status page);
  refuses a return that is ended (`closed`, `declined`, `cancelled`) or has no booked label (404); fetches the label with `returnLabel()` from the carrier's own host only
  (`carrierLabel()`'s rule: the address must be on a host the carrier's module names, `api.bring.com` for Bring, fetched with the store's keys through `carrierContext()`), and answers
  the bytes as `application/pdf` with `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Content-Disposition: inline; filename="return-{R}.pdf"`. It is
  **never stored** (not in Storage, not in `email_messages`, not in a cache). At most `LABEL_FETCHES_PER_HOUR` per return (bucket `label:{returnId}` in `chat_usage`, taken
  atomically); over it, a page "Too many tries, try again in an hour". The carrier failing is a page "The label cannot be fetched right now; try again in a moment" (status 503), never a
  stack trace or the carrier's answer.
- **By email**: `return.label_ready` (a new notification, on by default, to the order's own address, key `return.{id}.label`), sent when a label is booked (by staff or the job) after the
  return's approval email went (or, on approval with a booking, the approval email carries the button and no second email is sent): a button **Print your return label** to the label route
  (a booked label) or the pasted address, the carrier, the tracking number, and the who-pays sentence. **The file is never attached.**

### 2.5 Emails (all `src/lib/email-text.ts`, hand-written nb, sv, da, en; `EMAIL_KINDS`; `NOTIFICATIONS` entries with slots; idempotent by key; to `order.email` only)

| Kind | When | Key | Notes |
|---|---|---|---|
| `return.exchange_proposed` | staff send a proposal (and *Send again*) | `return.{id}.exchange.{exchange}.{n}` | the page link, `C`, `T`, the outcome, the confirm-by date; switchable (D238), on by default |
| `return.exchange_to_pay` | processing with `Δ > 0` (and *Send again*) | `return.{id}.exchange.{exchange}.pay.{n}` | the pay step link, `Δ`, the pay-by date, "If you do not pay by {date}, you get your money back as usual"; **required** (it asks for money the customer agreed to, D238's rule for pay links) |
| `return.exchanged` | settlement | `return.{id}.exchanged` | the new order's number and link, what was refunded (`−Δ`) or paid, the documents; **required** (it records how the refund was made, Art. 13(1)); the return's `return.refunded` email is **not** sent as well |
| `return.exchange_lapsed` | the pay link or the proposal ended unpaid / unconfirmed after the customer confirmed | `return.{id}.exchange.{exchange}.lapsed` | "Your exchange did not go through; you get your money back as usual"; switchable, on by default |
| `return.label_ready` | a label booked | `return.{id}.label` | 2.4 |
| `return.exchange_wished` | staff alert to the store's contact address | `return.{id}.exchange_wish` | order and return numbers and a link to the return; never the note's words (staff read them in the admin) |

The exchange order's own `order.confirmation` carries one added sentence ("This order is your exchange for return {R}; it was paid with the credit of your return" and the part paid, if
any). The original order's `order.refunded` email is not sent for the transfer or the remainder (the `return.exchanged` email is the one email).

### 2.6 Platform side, AI manager, chat agent

- **Platform**: nothing new to operate; the plan comparison rows (5.5).
- **AI manager** (read only): `explain_return` and `list_returns` say the exchange's state, `C`, `T`, `Δ` (amounts by `formatMoney`, nothing worked out by the model) and the label
  (carrier, tracking, booked or not, who pays); `get_order` says when an order is an exchange (and of which return). **No tool proposes, confirms, processes an exchange, books a label or
  records a payment.** The `handle-return` skill gets a paragraph: exchanges and labels are done on the return's page.
- **The chat agent** (`store_info.returns`, `returnFacts()`): one more fact, "exchanges: offered or not", from `return_settings.exchanges`; never a price or a difference.
- **Support (D216)**: the support tools' order view (`support-tools.ts`) shows an order's returns with the exchange state words; no action kind is added to `CUSTOMER_ACTIONS`.

### 2.7 Copied orders, host orders, other kinds, other currencies, other languages, privacy, closed stores

- **Copied orders (D129)**: have no returns (D153 refuses them), so no exchange and no label; the new tables refuse them (`refuse_copied_order()`); `copy_orders()` copies an exchange
  order as an ordinary order **without** `exchange_id` (source `checkout`, history) and never copies `return_exchanges` or the return-label columns' bookings.
- **Hosts' orders (D71)**: not exchanged (`host`: the seller is the host and the commission and DAC7 figures would cross orders); a label may be booked only on the store's own carrier
  agreement for the store's own order, so never for a host's (hosts sell stays and rentals, which have no returns anyway).
- **Subscriptions, weekly boxes, bookings, downloads, services**: an original order with a subscription or weekly box, or a return line that is not physical goods, is not exchanged;
  replacements are physical goods only (`not_goods`).
- **Business buyers (D63)**: a voluntary return of a company order (`b2b_returns`) can be exchanged when its `vat_kind` is `standard`; the exchange order keeps the company and its
  VAT treatment decided again by `decideTax()` (a decision other than `standard` refuses, `vat_changed`). Reverse-charge and IOSS originals are not exchanged (7).
- **Other currencies (D109)**: the exchange is in the original order's currency and market view (`{country}[-{lang}][-{currency}]` rebuilt from the order, as D174 does); replacements
  are priced with `shown()` in that view, never converted again; `C`, `T`, `Δ`, the transfer, the refund, the pay link and the label deduction are all in that currency. A carrier price in
  another currency (Bring prices in NOK) is converted once into the order's currency at the store's rates (`convertMinor`) for the deduction and shown with both amounts; with no rate it
  is "price not known" (never a guessed amount). Every new money read has a **euro scenario** in `checkout-kinds.int.test.ts`.
- **Languages**: staff screens are English; customer texts as 2.1. The proposal email and page are in the original order's language; the exchange order takes the original order's
  locale.
- **Privacy (D162)**: an exchange holds ids, quantities, amounts, the wish note (shopper text) and staff's agreement note (kept only in `order_events.data.note`, as D174's notes): both
  notes are blanked by the anonymising (`anonymise_order()` patched) and the wish note is in the export's `returns` section; the return label columns hold the carrier's numbers and a
  carrier address that names no person (the shopper's name and address go to the carrier in the booking request, as for an outbound parcel, D134, and are never kept here). Erasure:
  `return_exchanges` is `keep` (bookkeeping, via the order), the wish note `anonymise`. A restricted order is not exchanged and gets no label booking (`restricted`: the address would be
  read for a person cut loose). The customer's data export lists each return's exchange (state, dates, `C`, `T`, `Δ`, the exchange order's number).
- **Closed or suspended store (D171)**: no proposal, confirmation, processing or label booking (`store_closed`); a proposal or a waiting pay link when the store closes is ended by the
  closing step (session closed, exchange order cancelled through `cancel_unpaid_order()`, stock released), and the customer is refunded as usual by staff. D171 blocks closing only on unsent paid
  goods and running subscriptions; open exchanges are listed among the closure screen's warnings (`closureBlockers()`'s warnings), never as a blocker.
- **Website mode (D178)**: with `shop` off, no exchange (`shop_off`) and the exchange page answers *payments off*; the status page and labels stay (after-sale, `afterSaleOf()`).

### 2.8 Failure behaviour

- **Proposal**: a replacement not offered in the market, a price above the list price, too many lines, a quantity out of range, an address outside the market's country, a return that
  cannot be exchanged: refused with a sentence, nothing stored.
- **Confirmation**: a proposal expired, withdrawn or already confirmed answers its state; confirming twice returns the first result. A return refunded meanwhile (staff refunded instead)
  ends the proposal (`superseded`) and the page says the money was refunded.
- **Processing, step (a)**: under the original order's and the return's locks, the return's refund must be unclaimed and unrecorded (`refund_claimed_at` taken by processing, D153's
  claim, released at the end); the exchange must be `confirmed`; a stock shortage refuses (`stock_short`); `credit_changed` as 2.2. Nothing is written on a refusal.
- **Processing, step (b)** with `Δ < 0`: Stripe first (`refundOrder()` with idempotency key `exchange-refund:{exchange}`), then the transfer, the payment, the completion and the return's
  record in the transaction that records the refund (`inTransaction`), so all or none are written. A refund Stripe answers `pending` settles the exchange (the money is on its way). A
  refund that fails changes nothing but the event `exchange.refund_failed`.
- **Pay link**: `expireExchanges()` (the five-minute job) ends an exchange whose link passed its end: closes the Stripe session first (`settleOrderSessions()`; a session `paid` or
  `processing` is left to the webhook), cancels the exchange order (`cancel_unpaid_order()`, stock released), marks the exchange `expired`, releases the return's refund claim and emails
  `return.exchange_lapsed`. **A payment that arrives for an exchange that can no longer settle** (the return was refunded, the exchange cancelled while Stripe was processing) is refunded
  in full at once (`refundOrder()` of that payment, D174's rule), event `exchange.payment_refunded`.
- **Withdrawal deadline**: a withdrawal return's exchange cannot push the legal refund past `refund_deadline`: a proposal's and a pay link's end are capped at the deadline's store day
  (4.5); an exchange whose cap is less than `EXCHANGE_MIN_HOURS` away is refused (`deadline_near`: "refund instead"). An exchange that lapses leaves the return as D153 has it: the queue
  marks it due or overdue, nothing is refunded automatically, and the staff alert of D153 (`return.overdue`) still fires.
- **Labels**: a carrier timeout (the adapters' timeouts), a refused booking, a missing return address or weight, a country the carrier does not book returns in: a plain sentence, the
  return unchanged, the pasted path offered. The job's automatic booking tries `LABEL_TRIES` times over an hour and then writes `return.label_failed` and stops (staff see it on the
  return and in the queue's *Label not booked* mark).
- **Documents**: issuing the credit note or the exchange order's invoice never blocks the money (D159's rule: a sub-block; `issueWaitingInvoices()` retries).
- **Stripe minimum**: a `Δ` below the provider's minimum for the currency is not offered as a card payment: the pay step says "The amount is too small to pay by card" and staff are told
  to record it as paid outside Kaizen, lower a replacement's price, or refund instead.

---

## 3. Data

All new tables are in `commerce`, carry `store_id` with composite foreign keys `(store_id, …)`, have RLS on with no policy (the server reaches them through `db()`), and are
`never` in `COPY_RULES`.

### 3.1 Columns added to existing tables

| Table | Column | Meaning |
|---|---|---|
| `orders` | `exchange_id uuid null` (fk `(store_id, exchange_id)` → `return_exchanges`) | The exchange this order was made for. Set only with `source = 'exchange'`; frozen after insert. |
| `orders` | `source` check widened to `('checkout', 'draft', 'exchange')`; new check `orders_source_exchange`: `(source = 'exchange') = (exchange_id is not null)` and `source = 'exchange'` ⇒ `made_by is not null` | `orders_source_draft` keeps its meaning (draft ⇔ `draft_id`). |
| `payments` | `exchange_id uuid null` (fk) | A payment of an exchange order: the `exchange` transfer, the pay link's Stripe payment, or a `manual` one. |
| `payments` | `transfer_refund_id uuid null` (fk `(store_id, transfer_refund_id)` → `refunds`) | For `provider = 'exchange'`: the original order's transfer refund it is paid from. Check: `(provider = 'exchange') = (transfer_refund_id is not null)`. |
| `refunds` | `exchange_id uuid null` (fk), `kind text not null default 'money'` (`money`, `transfer`) | `transfer`: the credit moved to an exchange order, no provider call, `provider_reference` null, created `succeeded`. `money` with `exchange_id`: the remainder refunded through Stripe, or the refund of an exchange's late payment. Check: `kind = 'transfer'` ⇒ `exchange_id is not null and provider_reference is null`. |
| `returns` | `outcome` check widened with `exchanged` | The return ended by an exchange; `refund_minor = C`, `refund_working` as for any refund. |
| `returns` | `exchange_wish_at timestamptz null`, `exchange_wish_note text null` (≤ 500) | The customer's wish (2.1). |
| `returns` | `label_source text null` (`pasted`, `carrier`), `label_carrier_id text null`, `label_service text null`, `label_consignment_number text null`, `label_tracking_number text null`, `label_tracking_url text null` (https), `label_carrier_url text null` (https, private), `label_cost_minor bigint null` (≥ 0, the order's currency), `label_cost_carrier jsonb null` (`{ amountMinor, currency, vatIncluded }` as the carrier priced it), `label_test boolean not null default false`, `label_booked_at timestamptz null`, `label_tries int not null default 0` | Checks: `label_source = 'pasted'` ⇔ `label_url is not null` (D153's column keeps its meaning) and `label_source = 'carrier'` ⇔ `label_carrier_id is not null and label_booked_at is not null`; `label_carrier_id` is a known carrier; the URLs https. A migration back-fills `label_source = 'pasted'` where `label_url` is set. |
| `return_settings` | `exchanges boolean not null default true`, `label_carrier text null` (a carrier id), `label_service text null`, `label_auto boolean not null default false` | 2.2, 2.3; `label_auto` needs `label_carrier` (check). |
| `inventory_movements` | source check and `MOVEMENT_SOURCES` widened by `exchange` | The exchange order's draw (reason `sale`, source `exchange`); the returned units' restock stays `return_restock`. |
| `credit_notes` | `source` check widened by `return_exchange`, with `return_id` set and `refund_id` null for it, `unique (store_id, return_id) where source = 'return_exchange'` | 3.3 point 6. |

### 3.2 New tables

**`return_exchanges`**: `id uuid pk`, `store_id`, `return_id` (fk restrict), `order_id` (the original order, fk restrict), `seq int` (per return from 1, under the return's lock,
`unique (store_id, return_id, seq)`), `status text` (`draft`, `proposed`, `confirmed`, `processed`, `settled`, `declined_by_customer`, `cancelled`, `expired`, `superseded`),
`currency char(3)`, `market_slug text` (the original order's market view), `shipping_kind text` (`free`, `standard`, `set`), `shipping_minor bigint`, `delivery_address jsonb`
(name, street, postal code, city, country, phone optional; the market's country), `credit_minor bigint` (`C` when proposed), `total_minor bigint` (`T`), `difference_minor bigint`
(`T − C` as proposed), `credit_at_processing bigint null`, `difference_at_processing bigint null`, `token_hash text null` (SHA-256 base64url, unique where not null),
`expires_at timestamptz null`, `terms jsonb null` (the snapshots the page showed: `[{ role, snapshotId, hash }]`), `confirmed_at timestamptz null`, `confirmed_by text null`
(`customer`, `staff`), `confirmed_channel text null` (`web` for the customer; `email`, `letter`, `phone`, `in_person`, `other` for staff), `exchange_order_id uuid null` (fk restrict),
`refund_id uuid null` (the remainder's refund, fk), `transfer_refund_id uuid null` (fk), `made_by uuid not null` (fk `accounts`), `created_at`, `updated_at`, `processed_at`,
`settled_at`, `ended_at`. Partial unique index: **one exchange per return that is not ended** (`status in ('draft','proposed','confirmed','processed')`); index
`(store_id, status, expires_at)` for the job; `(store_id, order_id)`; `(made_by)`.

**`return_exchange_lines`**: `store_id`, `exchange_id` (fk restrict), `n int` (position), `variant_id uuid not null` (fk restrict), `sku`, `title`, `quantity int` (1 to
`EXCHANGE_QUANTITY_MAX`), `list_price_minor bigint` (as shown when proposed), `unit_price_minor bigint` (the price charged, `0 ≤ unit ≤ list`), primary key `(exchange_id, n)`.
Inserted with their exchange while it is a `draft` or when it is (re)proposed as a new `seq`; never changed or deleted.

### 3.3 What the database itself enforces (PGlite tests in `src/db/exchanges.test.ts`, 6.3)

1. **Lifecycle** (`commerce.return_exchanges_rules()`): `draft → proposed | cancelled`; `proposed → confirmed | declined_by_customer | cancelled | expired | superseded`;
   `confirmed → processed | cancelled | expired | superseded`; `processed → settled | cancelled | expired`; `settled` is final and nothing of it changes. Each step sets its own time
   once. A proposal needs at least one line and a token hash and `expires_at`; `confirmed` needs `confirmed_at`, `confirmed_by` and a channel, and **`confirmed_by = 'staff'` is refused
   when the return is a withdrawal return** (`exchange.withdrawal_needs_customer`); `processed` needs `exchange_order_id` of an order with `exchange_id` = this exchange; `settled` needs the
   return's `outcome = 'exchanged'` in the same transaction (a deferred constraint trigger checks at commit). An ended exchange keeps its token hash until `pruneExchangeTokens()` clears it 90 days
   after it ended, so the page can say what became of it; `expires_at` is kept as it was.
2. **Eligibility at the database** (`commerce.exchange_block(order, return)` returning a reason or null, called by the rules trigger on insert and on `processed`): the order is not copied,
   not a host's, `vat_kind = 'standard'`, not restricted, no subscription or weekly box, `store_is_active()` and `feature_on(store, 'shop')`; the return is not ended and has no refund
   recorded or claimed by someone else; every accepted return line is physical goods.
3. **The exchange order** (`orders_exchange_rules()`): an order with `exchange_id` must be inserted by `insertOrder()` under the exchange context (`kaizen.exchange` = the exchange id),
   with the original order's store, currency and market, and its lines only physical goods variants matching `return_exchange_lines` (variant and quantity, the price `unit_price_minor`);
   one non-cancelled exchange order per exchange. The order number comes from `commerce.next_document_number(store, 'order')` as for any order (D141, unchanged).
4. **The transfer** (`refunds_transfer_rules()`, `payments_exchange_rules()`): a `transfer` refund and its `exchange` payment are written together (a deferred constraint trigger checks at
   commit that each transfer refund has exactly one `exchange` payment of the same amount and currency, on the exchange's order, and the reverse), both `succeeded`/`captured`, never
   updated afterwards except by a later refund of the payment; the transfer's amount is `min(C, T)` of the exchange (`credit_at_processing`, `total_minor` of the exchange order); the
   refunds of a return's exchange (transfer + remainder) add up to the return's `refund_minor`; the D153 cap "the returns of an order never above what was captured" holds unchanged (the
   transfer counts as refunded).
5. **Refunding an exchange payment later** (a return of the exchange order): `refunds` of an `exchange` payment never exceed it (the existing cap) and are money refunds made **on the
   original order's Stripe payment** (`transfer_refund_id` → its `payment_id`) by `refundOrder()` (4.6); a `manual` original is refunded as recorded (D173). `commerce.payment_of_order()`
   (D174) treats an `exchange` payment as the order's payment.
6. **Documents** (anchored, idempotent patches of D159's live definitions, each raising if its anchor is gone, held by `invoice-parity.test.ts`):
   (a) `make_credit_note()` issues **nothing** for a refund with `exchange_id` (`kind` `transfer` or the remainder `money`) and writes `credit_note.covered_by_exchange` once; the exception
   is the refund of a late exchange payment (2.8), which is an ordinary refund of the exchange order (its own invoice, or none when it was never invoiced, `payment_on_invoice()`);
   (b) **the returns trigger issues one credit note per exchanged return**, source `return_exchange`, when `outcome` becomes `exchanged`, from `refund_working` as for `return_outside`
   (same builder, same allocation, `creditAllocation()`), for the full `C`;
   (c) `payment_on_invoice()`: an `exchange` payment and the pay link's payment belong to the exchange order's invoice;
   (d) the exchange order's invoice (`issue_order_invoice()` inside `complete_order_payment()`) carries a payment section that names the transfer: a new kind `settled_by_return`
   ("Paid with the credit of return {R} of order {N}: {amount}") beside `paid_online` / `paid_outside` for the rest (words hand-written, section 8);
   (e) `document_audit()` and `store_checkup` count an exchange refund without a credit note of its own as covered.
7. **Completing the exchange order**: `complete_order_payment()` is called for it as for any order (its stock drawn from its holds, the invoice issued, the order `paid`), by
   `commerce.complete_exchange_order(exchange)`, which requires the order's captured payments to add up to its total (`exchange` + Stripe or `manual`) and sets the exchange `settled`.
8. **Copied orders**: `return_exchanges`, `return_exchange_lines` refuse them; the two copied-order guard functions are not patched.
9. **Return labels**: the checks of 3.1; `returns.label_*` may change only while the return is `approved` or `in_transit` (the D153 rule for instructions), except `label_tries`;
   `label_cost_minor` never above the converted carrier cost when both are known is a code rule (4.8), not a check.

### 3.4 Functions and the shared reads

- `previewExchange(storeId, returnId, input)` and `processExchange()` share one pricing (`priceExchange()`, 4.2) and one credit reader (`creditOf()`, which calls `previewRefund()`'s
  working, D153).
- `exchangeView(storeId, exchangeId)` for the admin, the page and the AI tools; `exchangeForToken(shop, token)` for the page (hash lookup, the store's own, the order's market).
- `bookReturnLabel(storeId, returnId, input, actor)`, `returnLabel(storeId, token)` (the route's fetch).

### 3.5 Indexes

`return_exchanges (store_id, return_id)`, the partial unique of 3.2, `(store_id, status, expires_at) where status in ('proposed','confirmed','processed')`, `(made_by)`;
`return_exchange_lines (store_id, variant_id)`; `orders (store_id, exchange_id) where exchange_id is not null`; `payments (store_id, exchange_id) where …`;
`payments (store_id, transfer_refund_id) where …`; `refunds (store_id, exchange_id) where …`; `returns (store_id, label_booked_at) where label_source = 'carrier'` is not needed (the
job finds unbooked withdrawal returns by `label_source is null and label_tries < LABEL_TRIES`, partial index `(store_id, created_at) where kind = 'withdrawal' and label_source is null`).

### 3.6 Retention

Exchanges, their lines, the transfer rows and the label columns are part of the orders' bookkeeping record and are kept with them (an anonymised order keeps them; they name no
person). The wish note is blanked by `anonymise_order()` and by `runRetention()` 24 months after the return ends; staff's agreement note lives only in `order_events.data.note`
(removed by the anonymising, as D174). Token hashes are cleared 90 days after an exchange ends (`pruneExchangeTokens()` in the daily `runRetention()`, application code: **no
`DELETE` in a SQL function**).

### 3.7 What is private, what is copied, and the registers

- **`COPY_RULES`** (`src/lib/store-copy-rules.ts`): `return_exchanges: never`, `return_exchange_lines: never` ("Exchanges of the original's returns: copied orders have no returns").
  `return_settings` stays `settings`: `clone_store()` and `duplicate_store()` are patched to copy `exchanges` and `label_auto`, and to copy **neither** `label_carrier` nor
  `label_service` (a carrier agreement is not copied, `shipping_carriers` is `never`; a copy with a carrier named it has no agreement for would book nothing). `copy_orders()` copies an
  exchange order without `exchange_id`, as `source = 'checkout'`, and never copies `refunds.kind = 'transfer'` rows or `exchange` payments (a copied order is history, D129).
- **`PERSONAL_DATA`**: `return_exchanges` and `return_exchange_lines` as `shopper` via the order, export section `returns`, erasure `keep` (bookkeeping record, D162), with the wish note
  and `delivery_address` named as the fields the anonymising blanks (`anonymise`, the address replaced by the marker the order's own address gets). `EMAIL_KINDS`: the six kinds of
  2.5 (class `shopper`, `return.exchange_wished` class `staff`). `privacy.test.ts` holds them.
- **Nothing public**: no sitemap, `llms.txt`, structured data (beyond the chat fact), feed, WordPress API change; the exchange page and the label route are `noindex` and not listed;
  `exchange` is not a page slug (it lives under `/account/`, which is reserved).
- **Secrets**: the label route fetches with the store's carrier keys through `carrierContext()` only; no key or carrier address ever reaches a page, an email or a log.

### 3.8 Migrations expected (9.1)

1. `{ts}_exchanges.sql` (generated from `schema.ts`: the columns of 3.1, the tables of 3.2, checks, foreign keys, indexes).
2. `{ts}_exchanges_rules.sql` (custom: 3.3 points 1 to 9, the check widenings, the back-fill of `label_source`, the D159 patches, the `copy_orders()`, `clone_store()`,
   `duplicate_store()` and `anonymise_order()` patches).
3. `{ts}_exchanges_plan_features.sql` (the analytics-and-ai area: two plan-comparison rows, D132).

Stamps sort after `20261015001332_notifications_plan_features.sql`. Enum values: none (every new state is text with a check).

### 3.9 As built (foundation, 2026-10-15)

The foundation built 3.1 to 3.7 as `20261015050012_exchanges.sql` (generated) and `20261015050226_exchanges_rules.sql` (custom); the plan-features migration
(3.8 item 3) is the analytics-and-ai area's. Where it differs from the text above:

- **`returns_label_pasted`** (`label_source = 'pasted'` ⇔ `label_url`) is not in `schema.ts`: the rules migration adds it after a trigger
  (`returns_label_pasted()`, which completes what the running code writes, `label_url` alone, both ways) and the back-fill, so the deploy never breaks the
  pasted path. A carrier booking is written with `label_url` null.
- **Replacements of a draft** (`return_exchange_lines`) may be changed or removed while their exchange is a `draft`; once proposed they are a record (inserted
  only with the proposal, in its transaction). The partial "one open exchange per return" index covers drafts too.
- **The status table** is `src/lib/exchange-status.ts` (re-exported by `exchange.ts`), so the schema imports it without the pricing code.
- **`commerce.exchange_block(return, claimed_ok)`** holds the reasons the database can see, in `exchangeBlock()`'s order (`DATABASE_BLOCKS`: copied to
  `edit_pending`); `limit` is the `seq` check, and `test_mode` and `payments_off` are the code's only.
- **A return ends `exchanged`** without a status change when an exchange settles it (its refund recorded in the same update, only under that exchange's
  context `kaizen.exchange`); closing it later keeps the outcome. While an exchange of the return is `processed`, the return's refund is recorded only by that
  exchange (`return_exchange_pending`). The remainder's refund is the return's `refund_id`, matched as `refund_minor − commerce.return_transferred()`.
- **`orders_source_draft`** now reads: a draft names its draft, and a staff-made order (`draft` or `exchange`) names its maker.
- **`return_exchanges.transfer_refund_id`** names the first transfer; all of them are `refunds.exchange_id` = the exchange with `kind = 'transfer'`
  (`commerce.exchange_refunds_of()` sums them and the remainder).
- **The exchange order's lines** are held to the replacements at commit only while the order was never changed (D174's `edited_at`).
- **An `exchange` payment** takes the test mode of the payment its transfer came from (a test original's exchange order gets no invoice number:
  `invoice_eligibility()` patched), has no account or fee, and is a record. `refunds_manual_cap()` now also caps the refunds of an `exchange` payment and of a
  payment that carries a transfer.
- **Documents**: `make_credit_note()` and `issue_missing_credit_notes()` patched as 3.3 point 6; `document_insert_guard()` patched to let the
  `return_exchange` note in; `payment_on_invoice()` needed no patch (an exchange order's payments are made before its invoice); `document_audit()` counts
  numbering only, so the "covered" counting of 6(e) is the server's (`src/server/invoices.ts`, `invoice-issue.ts` add `credit_note.covered_by_exchange` to
  their lists; `FULFILMENT_EVENTS.coveredByExchange` names it); `build_invoice_snapshot()` writes `settled_by_return` (`returnNumber`, `orderNumber`), mirrored by
  `buildInvoiceSnapshot()`'s `settledByReturn` fact and drawn by `OrderDocumentView` with `settledByReturn()` of `invoice-text.ts`.
- **Copies**: `copy_orders()` needed no patch (it never copied `source`, `exchange_id` or payments). `clone_store()` and `duplicate_store()` copy
  `return_settings.exchanges` only: `label_auto` needs a carrier, which is not copied, so a copy starts with it off.
- **Referrals**: `affiliate_attribute_order()` answers `none` for an exchange order.
- **Bring**: `returnBookingBody()` does not send the return's number (where Booking v2 takes a reference was not read: 9.6).
- **Words**: the wish field's words are `m.exchangeWish.*` in each `{lang}-browser.ts` (prefix `ui:exchangeWish.` in `HAND_WRITTEN_ONLY`); the page's and the
  label's are `m.exchange.*` and `m.returnLabel.*` (`src/lib/messages/{lang}-exchange.ts`), the emails' `emailText().exchange`/`.returnLabel`
  (`src/lib/exchange-email-text.ts`).

### 3.10 As built (server, 2026-10-15)

The server area built 3.4 and 4.4 to 4.8 in `src/server/exchanges.ts`, `exchange-pay.ts`, `exchange-emails.ts` and `return-labels.ts`. Where it differs from the text:

- **Terms**: the confirmation press keeps the terms the page showed as immutable snapshots (`snapshotTermsShown()`, factored out of `recordTermsForOrder()` in
  `checkout-terms.ts`), stored on `return_exchanges.terms` with their mode and locale; processing ties them to the exchange order with
  `recordTermsSnapshotsForOrder()` (the order did not exist when the customer pressed).
- **`refundOrder()`** gains `exchangeId` (every refund row it writes names the exchange; the transaction runs under `kaizen.exchange`), not an `exchange: { exchangeId,
  transferMinor }` that writes the transfer itself: the transfer pair (split over the original's captured payments, Stripe's first), the return's record and
  `complete_exchange_order()` are written by `settleExchange()` inside `refundOrder()`'s `inTransaction` (or a transaction of its own when nothing is refunded or
  restocked). Exchange payments are refundable on the exchange order: `getOrderAdmin()` counts them, and `refundOrder()` refunds one at the payment its transfer came
  from (Stripe's PaymentIntent, or recorded for a manual original), after the order's own payments (4.6).
- **Idempotency key** of the remainder: `exchange-refund:{exchange}:{failures}` (failures counted from `exchange.refund_failed` events), as D153's return key: a refund
  Stripe reported failed is replayed by its key, so a retry needs a new one. A refund that throws writes nothing; *Try again* is `processExchange()` on a processed
  exchange with Δ ≤ 0.
- **The token** is replaced (a new hash) when an exchange with Δ > 0 is processed and on *Send again*: the pay email carries the new link and the earlier one is dead
  (D173's rule for a sent draft). Exchange tokens are SHA-256 **base64url** (the check `return_exchanges_token`), not hex like drafts'.
- **Business buyers**: the exchange order's VAT is decided with no cart (`loadTaxFacts(..., cartId: null)`); its company name and number are copied from the original.
  A reverse-charge original is refused anyway (`vat_kind`).
- **The order page of an even exchange** (paid wholly by the credit) opens by its `exchange` payment's reference: `getShopperOrder()` and the confirmation's order
  link accept provider `exchange` (after Stripe's and manual's).
- **Refund guards in `returns.ts`**: `refundReturn()` refuses `exchange_pending` while an exchange is processed (before Stripe; the database refuses too) and
  `above_cost` when the return shipping typed is above a booked label's cost; `inspectReturn()` refuses while an exchange is processed (the credit it rests on);
  a refund supersedes a proposed or confirmed exchange (a draft is cancelled) in the refund's transaction. `actionsFor()` gained `process_exchange` and
  `cancel_exchange` (`ActionContext.exchange`); `ACTION_LABELS` has their words.
- **The return is closed** by settling when it was `inspected`; otherwise it keeps its step with `outcome = 'exchanged'`.
- **Settings**: `getExchangeLabelSettings()`/`saveExchangeLabelSettings()` in `return-settings.ts` (beside D153's `ReturnSettings`, which is unchanged).
- **Labels**: the return address must be the settings' structured `return_address` (the store's postal address is one free-text line, so it cannot be a party of
  a booking: `no_return_address`). A carrier price without VAT gets the standard rate of the return address's country before conversion (the store's direct cost,
  4.8). The booking writes the deduction into `returns.return_shipping_minor` when the shopper pays and staff had set none. `return.label_ready` is always its own
  email (key `return.{id}.label`, `.label.test` for a test label); the approval email is not changed to carry it.
- **Retention**: a step `exchanges` in `runRetention()` (`pruneExchangeTokens()`, `pruneExchangeWishes()`, the latter under `commerce.anonymising`, which the return's
  rules require to blank a wish).
- **Closing a store**: `cancelExchangesForClosure()` runs in `closeStore()` before the open checkouts are cancelled; its counts are warnings, never a blocker.
- **Euro scenario**: held in `exchanges.int.test.ts` ("an exchange shown in euro"), not `checkout-kinds.int.test.ts` (whose fixture is the cart's).
- **Not built here** (other areas): the order list's `source=exchange` filter, the AI tools' fields, the chat fact, support's order view, the admin and shopper pages.

### 3.11 As built (admin, 2026-10-15)

The admin area built 5.4. Where it differs from the text:

- **The return's page** composes two new cards into `ReturnDetailView` (slots `exchangeCard`, `labelCard`): `ExchangeCard` (the wish, the current exchange with its
  replacements, outcome and steps, or the builder `ExchangeBuilder`, whose summary is `ExchangeSummary` over `previewExchange()`) and `LabelCard` (*Return
  shipping*). The builder's input is made by the pure `builderInput()` (`src/lib/exchange-form.ts`); it starts from `previewExchange(store, return, null)` (the
  credit and the original order's market) and the order's address (`orderDeliveryAddress()`, `src/server/exchange-admin.ts`). A new proposal is offered only when
  none is out: staff withdraw a proposed or confirmed one first (the server would replace it; the screen keeps it explicit).
- **Labels**: D153's pasted label address stays in the approve and instructions forms as it was; booking is the separate *Return shipping* card, offered once the
  return is approved or in transit (so *Book a return label* is not preselected on approval: a voluntary return is approved first, then booked). *Print label* is
  `/admin/{store}/returns/{id}/label` (`staffReturnLabel()`, `orders:read`, `no-store`, `noindex`).
- **Actions**: `returns/[returnId]/exchange-actions.ts` (preview, search, save draft, propose; and per exchange: send again or a new link, withdraw, record the
  agreement, process / try again, paid outside, cancel) and `label-actions.ts` (book). Each asks `orders:write` with `checkPermission()`; the server functions write
  the audit entries themselves, so the actions add none. The exchange is found by id among the store's and must belong to the bound return.
- **Settings**: a second form on `/admin/{store}/settings/returns` (`ExchangeSettingsForm`, `saveExchangeLabelSettingsAction`, owner only), audited as
  `returns.settings_saved` with `part: "exchanges_labels"`; it refreshes the store's tag.
- **Orders**: `SOURCE_FILTERS` gains `exchange` (*Exchange*; `orderListWhere()` `o.source = 'exchange'`, a real sale for `excludesCopied()`), the list's row badge
  *Exchange*; the exchange order's page says "exchange for return {R} of order {N}" in its header line with both links (no separate badge there); the original
  order's Returns card says "Exchanged: order {M}" (or "Exchange being processed") through `exchangeOrdersOfReturns()`.
- **Queue**: the marks and `exchange=` filter (`exchangeFilterOf()`, kept in `queueHref()`), and *Label not booked*.
- **Not added**: a Store Home or control-center line for exchanges (the queue's marks and the refund deadline marks carry it), new `ADMIN_PAGES` or navigation (none
  needed, as 5.6 says), store-translation entries (no new store-owned text).

### 3.12 As built (shopper, 2026-10-15)

The shopper area built 2.1 and 2.4 in `src/app/s/[store]/[market]/account/exchange/[token]/` (`page.tsx`, `actions.ts`, `exchange-form.tsx`, `exchange-view.tsx`,
`loading.tsx`), `src/app/s/[store]/[market]/returns/[token]/label/route.ts`, `returns/[token]/actions.ts` and `page.tsx`, `src/components/exchange/`
(`exchange-wish-form.tsx`, `step-focus.tsx`), `src/components/withdraw/return-status-view.tsx`, the withdrawal form's request field, and the two order pages. Where it
differs from the text:

- **The status page cannot link the exchange page**: the exchange's token is kept only as a hash, so the page says where the proposal (or the pay link) is: "in the
  email the store sent you" (`m.exchange.status.inEmail`, `payInEmail`, new words in the four languages), with the outcome and the confirm-by or pay-by date.
  *Exchanged: order {M}* is said without a link (the order page opens by its payment's key, which this page does not hold).
- **The exchange page's view and forms live beside the route** (as D174's change page), not in `src/components/exchange/`; there is no `exchange-section.tsx`
  (the page is not a page role). The terms sentence is the checkout's (`CheckoutTerms`, with its tick box in `checkbox` mode holding *Confirm*). No backorder
  sentence is drawn: nothing is held before processing, and `exchangePageFor()` gives no stock facts.
- **New words** (hand-written nb, sv, da, en, `HAND_WRITTEN_ONLY` prefixes already cover them; legal review section 8 items 1 and 8): `m.exchange.creditChanged`,
  `startFailed`, `sellerHeading`, `status.inEmail`, `status.payInEmail`; `m.exchangeWish.tooManyLines`.
- **The wish on a voluntary return request**: `recordExchangeWish()` gained `{ atRequest }` (the request is still `requested`, the one block it ignores; it then asks
  `exchange_block()`'s later checks itself, since the SQL answers `requested` first). A wish the order cannot take never holds the request up and is left out; one
  too long is said on the field before anything is sent (`FIELD.exchangeWish`, `FieldKey` `exchangeWish`). The status page's offer is `wishOfferedFor()` (no wish,
  no proposal, `exchangeBlockFor()` null).
- **`ShopperReturn.returnShippingMinor`** (the return shipping the refund takes off when the shopper pays) was added so the label card says the amount that will be
  taken off, not the label's price.
- **The label route** answers its refusals as small pages in the market's language (`tooMany` 429, `unavailable` 503); the end-to-end test can only hold the
  refusals (the end-to-end server has no carrier), the PDF answer is held by `return-labels.int.test.ts` and the route's unit test.
- **The order page** names the exchange (`exchangeOfOrder()`, "Exchange for return {R} of order {N}") without a link; My account links the original order when it
  is the signed-in customer's own (`ownsOrder()`).


### 3.13 As built (analytics and AI, 2026-10-15)

The analytics-and-ai area built 2.6 and 5.5. Where it differs from the text:

- **Definitions first** (`docs/analytics.md`): rows **Exchange order** and **Transfer** in the definitions table, **Exchanged return** in the Returns table,
  and a section *Exchanges (D239, wave 3)*. Two limits are written there rather than hidden: the payment-fee estimate is made on an exchange order's whole
  total (the part the credit paid took no card fee), and on the Customers page an exchange order is an order of the customer like any other, so a customer
  who exchanged has one order more and can count as returning or repeat. Neither is fixed in this run.
- **Code**: `EXCHANGE_ORDER` (`analytics-sql.ts`), `EXCHANGE_CHANNEL` and `isNoVisit()` (`analytics-traffic.ts`; the blended conversion leaves out both no-visit
  rows), `TrafficReport.exchangeOrders` with its note, the channel table's *Exchanges* row (also for new customers) with its note on the Marketing page;
  the Returns section's `exchanges` (`{ returns, share, keptMinor, transfers, tracked }`, the share by `exchangeShare()` from `MIN_RATE_ORDERS` returns made),
  `ReturnKindRow.exchanged`, the card *Exchanged* and the kinds table's column (and file column `exchanged`). The euro scenario is in
  `src/server/analytics-exchanges.int.test.ts` (a kroner and a euro exchange through the real flow), not `checkout-kinds.int.test.ts`.
- **AI manager**: no new tool. `explain_return` gains `exchange_wish`, `exchange` (`exchangeFacts()`: state, credit, replacements, the difference in words by
  its sign) and `return_label` (`labelFacts()`: carrier, tracking, test, cost, who pays; never the carrier's label address); `list_returns` gains the queue's
  exchange mark and *label not booked*; `get_order` gains `exchange_for`. Pure parts in `src/lib/return-tools.ts`. The `handle-return` skill has the paragraph.
- **Chat agent**: the fact rides on `store.returnPolicy` (`ReturnPolicyFacts.exchanges`, read in `getStore()` from `return_settings.exchanges`; never in the
  JSON-LD), so it follows the settings' existing tag refresh. Not offered unless the store keeps the default on; it never names a price or a difference.
- **Support**: `order_details` gives each return's newest exchange state in words (`EXCHANGE_STATE_WORDS`, `src/lib/support-tools.ts`, no amounts) with the
  exchange order's number, and an exchange order's `exchangeFor`. No action kind was added.
- **Plan comparison**: migration `20261015065442_exchanges_plan_features.sql`. The spec's category *Orders* does not exist; the order rows are in
  *Operations* (390 to 397), so the two rows are there at 398 and 399, in no plan (as every wave-3 row). Held by `src/db/exchanges-plan-features.test.ts`.

### 3.14 As built (review fixes, 2026-10-15)

The adversarial review's findings changed these points of the text above (each held by a test named after the finding):

- **A label's cost is never taken off at booking** (changes 2.3 *Who pays*, 2.4 and 4.8). `bookReturnLabel()` records the cost only and leaves
  `returns.return_shipping_minor` alone. Whether the parcel came back with the label is known only at refund time, so the refund form starts at 0 and offers
  *The parcel came with the label: take off {cost}*; `refundReturn()` passes what staff typed through `labelDeduction()` (never above the cost, a note for an
  unpriced label). Tracking is not read to decide it (Bring's return scans are not built). A label the job booked unasked is therefore never charged unless
  staff confirm it was used. The shopper reads `m.returnLabel.costIfUsed` / `emailText().returnLabel.costIfUsed` ("If you send the parcel with this label, its
  cost, {amount}, is taken off your refund …") before the refund and `costOff` after it. The exchange's credit takes a label off only when staff had already
  set an amount (it no longer comes from the booking).
- **A test label is never taken off** (`labelDeduction({ test: true })` gives 0 and refuses an amount typed, `test_label`), and the page and email say nothing
  about its cost.
- **One booking at a time**: `bookReturnLabel()` runs under a transaction-scoped advisory lock (`return-label:{id}`, taken without waiting; the second caller
  gets `busy`), reads the state again under it, and its final write requires no real label written meanwhile. `bookPendingLabels()` counts no try for `busy`
  or `booked`.
- **A withdrawal's proposal is never a link staff hold** (changes 2.2 *Send to the customer*): `proposeExchange()` and `resendExchange()` refuse `createLink`
  for a withdrawal return while it waits for the customer (`link_withdrawal`); the proposal goes by email to the order's own address only, so the press on the
  page is the customer's. The pay step's link may still be shared. The admin hides *Create a link to share* there.
- **The exchange page's withdrawal sentence** (`m.exchange.newPurchase`) is drawn only for a consumer and only when no replacement is goods the law excludes
  (`ExchangePage.withdrawalRight`, from `orders.company_name` and `products.withdrawal_exclusion`); otherwise only the store's own information is linked.
- **The agreement sentence** says "Being paid back this way has no fee" (no longer "It costs you nothing extra"), and a proposal with a difference to pay adds
  `agreementToPay(amount)` on the page and in the proposal email.
- **Stock goes back once**: `refundOrder()` takes `restockIf(tx, status)`, asked first inside the refund's transaction; the settlement answers false for a
  refund Stripe reported failed and for an exchange no longer `processed` (it locks the exchange row), so a failed try and its retry, or two settles at once,
  put the returned units back once.
- **Credits of an exchange order** (4.6): migration `20261015083910_exchanges_bonus_base.sql` patches `bonus_refund_applied()` and
  `affiliate_refund_applied()` so the paid base counts captured `exchange` payments as well as Stripe's.
- **The export** carries each exchange's `deliveryAddress` and `replacementLines`, also for a proposal that made no order.

---

## 4. Rules and law

### 4.1 Limits and constants (`src/lib/exchange-limits.ts`; a unit test pins every number)

| Constant | Value | Source |
|---|---|---|
| `EXCHANGE_LINES_MAX` | 20 per exchange | Kaizen's own |
| `EXCHANGE_QUANTITY_MAX` | 99 per line | Kaizen's own |
| `EXCHANGE_PROPOSAL_DAYS` | 7 | Kaizen's own (D174's `EDIT_PAY_DAYS`), capped by 4.5 |
| `EXCHANGE_PAY_DAYS` | 7 | as D174, capped by 4.5 |
| `EXCHANGE_MIN_HOURS` | 24 | Kaizen's own: less time to the legal deadline than this, refund instead |
| `EXCHANGE_SENDS_PER_DAY` | 5 per exchange | D173's draft limit (`exchange:send:{id}`) |
| `EXCHANGE_PAY_PRESSES_PER_HOUR` | 20 per exchange, 600 per store | D173 (`exchange:pay:{id}`, `exchange:pay`) |
| `EXCHANGE_WISH_NOTE_MAX` | 500 characters | D153's note limit |
| `EXCHANGES_PER_RETURN_MAX` | 5 proposals (`seq`) | Kaizen's own (an abuse brake) |
| `LABEL_TRIES` | 3 (5, 20 and 60 minutes after the return was made) | Kaizen's own |
| `LABEL_FETCHES_PER_HOUR` | 30 per return | Kaizen's own (`chat_usage` bucket `label:{id}`) |

### 4.2 Pricing replacements (`priceExchange()`, pure, `src/lib/exchange.ts`, built on `priceDraft()`)

1. **Lines**: each replacement is a draft `goods` line of its variant, `unitPriceMinor` = the staff price (≤ the list price as shown, `shown(market, list)` in the original order's market
   view, `listPriceMinor` kept), `discountMinor` 0. No discount input: `priceDraft()` is called with no code, campaign, group, credit or staff discount.
2. **VAT**: `decideTax(loadTaxFacts(original order's market and buyer), basket)` through `priceDraft()`'s `tax` callback, the rate `commerce.vat_rate(country, category)` **of the day**
   (a new supply). The decision must be `standard` (`vat_changed` otherwise).
3. **Shipping**: `free` → 0; `standard` → the market's flat rate as `priceDraft()`'s `rate` input judges it for the replacements (`rateShipping()`: free over the market's limit on the
   basket before discounts); `set` → the amount typed (VAT included, ≤ `DRAFT_PRICE_MAX_MINOR`), its VAT at the standard rate (`shippingVat()`).
4. **Equivalence (the heart of criterion 1)**: replacements at list price with standard shipping equal, line for line and in total, what `cartSummary()` gives a cart of the same goods in
   the same market with no code, campaign, group discount or credit, in kroner and in a euro view (`exchanges.int.test.ts`); held for the exchange order as placed in
   `checkout-kinds.int.test.ts` (an exchange scenario in NOK and EUR).
5. **The credit `C`** is `refundFor()`'s amount for the return (the same input `refundReturn()` builds, `creditOf()`), never adjusted by the exchange: no override
   (`reviewOverride()` is not offered on an exchange), no deduction other than inspection's and the return shipping the shopper pays (4.8).
6. **The outcome**: `Δ = T − C`; `transfer = min(C, T)`; `refundRemainder = max(0, C − T)`; `toPay = max(0, T − C)`. Integers in minor units; nothing is rounded here (every part is an
   integer already).
7. **Problems** (codes and words in `EXCHANGE_PROBLEMS`): `no_lines`, `too_many_lines`, `quantity`, `price_up`, `not_offered`, `not_goods`, `address_country`, `vat_changed`,
   `stock_short` (processing only), `credit_changed`, `deadline_near`, `total_zero` (a replacement total of 0 is not an exchange: refund instead), and the block reasons of 4.3.

### 4.3 Which returns can be exchanged (`exchangeBlock(facts)`, pure, and the database's `exchange_block()`, held equal by a test)

Refused with a reason code and words: `off` (the store's setting), `copied`, `host`, `vat_kind`, `subscription`, `weekly_box`, `booking`, `not_goods` (a returned line that is not
physical goods), `restricted`, `store_closed`, `shop_off`, `refunded` (the return's refund is recorded or claimed), `ended` (declined, cancelled, closed), `requested` (a voluntary return not
yet approved), `limit` (`EXCHANGES_PER_RETURN_MAX`), `edit_pending` (a D174 change awaits payment on the original), `test_mode` (an original paid in Stripe test mode is exchanged only
while the store is in test mode, never mixed), `payments_off` (only for an exchange that would refund or charge through Stripe).

### 4.4 Processing and settling (`processExchange()`, `settleExchange()`, `src/server/exchanges.ts`)

- **Step (a)**, one transaction, under the original order's lock, then the return's, then the exchange's: re-check 4.3 and the exchange `confirmed`; work `C` out again
  (`credit_at_processing`) and `Δ`; refuse `credit_changed` when `Δ` exceeds the confirmed `difference_minor`; claim the return's refund (`refund_claimed_at`, D153's guarded update);
  `allocateStock()` for the replacements (a variant that stops at zero: `stock_short`; a backordered remainder: sold with its days, frozen on the line as `placeOrder()` does);
  `insertOrder()` with `source = 'exchange'`, `exchange_id`, `made_by` = the staff account, the original order's `customer_id`, `email`, `locale`, market, company, billing address,
  the exchange's delivery address, `return_cost_payer` from the settings now and `standard_shipping_minor` as `placeDraftOrder()` computes it, the VAT decision's fields;
  `insertOrderLine()` per replacement (cost copied as a sale copies it, measure frozen, D160); `reserveStock()` with `at` = the pay link's end (`Δ > 0`) or 30 minutes (`Δ ≤ 0`, settled
  at once); the exchange `processed`; events `order.placed` (`{ exchange, return }`) on the new order and `return.exchange_processed` on the original. Terms: `recordTermsForOrder()`
  with the exchange's `terms` and `confirmed_at`.
- **Step (b), `Δ ≤ 0`**, in the same request after (a) committed: `refundOrder(storeId, originalOrderId, { amountMinor: −Δ, reason: "Exchange for return {R}", restock: <the return's
  restock plan> }, accountId, { returnId, idempotencyKey: "exchange-refund:{exchange}", exchange: { exchangeId, transferMinor: T }, inTransaction: settle })`. `refundOrder()` gains the
  option `exchange`: it writes the `transfer` refund row (no provider call) on the original order's captured payment (`splitRefund()` over its payments, the Stripe one first), the
  remainder through Stripe as today (`kind = 'money'`, `exchange_id`), and with `amountMinor = 0` and a transfer it calls no provider at all (an even exchange, or one where the
  customer owes and pays). `settle` (inside the same transaction): the `exchange` payment(s) on the exchange order (one per transfer row, `transfer_refund_id`), the return's refund
  columns (`refund_minor = C`, `refund_working`, `refund_computed_minor`, `refunded_at`, `refund_id` = the remainder's refund or null, `outcome = 'exchanged'`, status `closed` when the
  return was `inspected`, else as D153 leaves a refunded return), `complete_exchange_order()`, the exchange `settled`, the claim released, events `return.refunded` with
  `{ exchange, transferMinor, refundMinor }` and `order.paid` on the new order. Then, outside the transaction, the `return.exchanged` email and the exchange order's confirmation.
- **Step (b), `Δ > 0`**: after (a), the pay step is live; the Stripe session is opened by the page's press through `openPaymentSession()` on the store's connected account for `Δ`,
  `application_fee_amount = saleFee(Δ, storeFeeBps())` (Kaizen's fee on what is charged now; the transferred part was charged on the original order, whose fee is not returned for it,
  D17's rule for a refund is not triggered by a transfer), metadata `{ order_id, order_number, store_id, exchange_id }` and never the token, a `payments` row `pending` with
  `exchange_id`. **`applySession()` branches on `payments.exchange_id`** (after D174's `order_edit_id` branch): a completed session calls `completeExchangePayment()`, which captures the
  row and runs step (b)'s settle with `amountMinor = 0` and the transfer `C` (all in one transaction, under the locks; never `complete_order_payment()` directly); an expired or failed
  session only marks its row (never `cancelUnpaidOrder()`: the exchange job decides). *Record as paid outside Kaizen* writes the `manual` payment of `Δ` (method, reference,
  `received_on`) and settles likewise. Settling twice is a no-op.
- **Kaizen's fee on a remainder refund** is returned on the refunded part as for any refund (`refund_application_fee: true`); on the transfer nothing moves at Stripe, so nothing is
  returned (the money stays charged, for the new goods).

### 4.5 Deadlines

- A **voluntary return**: a proposal's end is `now + EXCHANGE_PROPOSAL_DAYS`; a pay link's end `now + EXCHANGE_PAY_DAYS`.
- A **withdrawal return**: both are capped at the end of the store day before `refund_deadline` (CRD Art. 13(1): reimbursement "not later than 14 days from the day on which he is
  informed"); an exchange whose cap is less than `EXCHANGE_MIN_HOURS` away is refused (`deadline_near`). The customer's agreement to be paid by an exchange is the "otherwise" of Art.
  13(1); until it is settled, the legal deadline is the store's (the page and the emails say "If you do not confirm / pay by {date}, you get your money back as usual"). **Needs legal
  review**: whether a settled exchange meets the 14 days when the customer pays a difference, and whether the period may run while the store waits for the goods (Art. 13(3)), section 8.
- **Withholding** (Art. 13(3)): processing is offered exactly when D153 would offer the refund (`actionsFor()`), so an exchange never waits longer for the goods than a refund would.

### 4.6 Money, payments and refunds of an exchange order later

- The exchange order is a paid order with up to two captured payments: `exchange` (the transfer) and `stripe` or `manual` (the difference). `refundOrder()` on it splits over them
  (`splitRefund()`, D174) **difference first, then the transfer**; a refund of the `exchange` payment is made **at Stripe on the original order's payment** (the charge that still holds
  the money: the transfer did not refund it) with the store's account and idempotency key, recorded as a `refunds` row of the exchange order's `exchange` payment with the Stripe
  refund's id as `provider_reference`; for a `manual` original it is recorded as made outside (D173's rule). `RefundOptions` unchanged for callers.
- **The original order's refundable** already counts the transfer (it is a refund row), so a later goodwill refund on the original can never take the money the exchange order rests on;
  Stripe's own refundable on the original charge is then at least the exchange order's transferred amount (a test holds both sides).
- The bonus program (D130) and the referral programme (D131) react to the transfer as to any refund of the original (earned credits reversed in proportion, used credits restored) and to
  the exchange order as to any paid order (it earns on its total). An exchange order is never a referred friend's first order and is never attributed to an affiliate (`orders.source =
  'exchange'` is refused by `affiliate_attribute()`; a test).
- **Withdrawal of the exchange order**: D153 applies; its standard delivery is what `standard_shipping_minor` says, refunded only up to what was paid (`shippingPaidMinor()`), so a free
  exchange shipping gives nothing back.

### 4.7 Booking a return label (`src/lib/return-label.ts` pure, `src/server/return-labels.ts`)

- **When it can be booked** (`labelBlock()`): the return is `approved` or `in_transit`; not ended; not restricted; the store open; a carrier with `return_labels` available, its
  agreement complete and its last check `ok`; the order's shipping address complete (name, street, postal code, city, country) and the return address set (`return_settings.return_address`
  or the store's postal address); both in a country the carrier books returns in (`returnCountries` in the registry: Bring `NO`).
- **The request** (`ReturnBookingRequest`): `returnReference` (the return's number), `serviceId`, `from` (the shopper: the order's shipping name and address, the order's email and phone,
  phone optional for Bring's return services), `to` (the return address with the store's contact email and phone), `parcels` (one parcel, the estimated weight). Bring
  (`returnBookingBody()` in `src/lib/bring.ts`): Booking v2 with the return product, test indicator by header; **the party roles are `needs confirmation with credentials`** (1.2): the
  module maps sender = shopper, recipient = the store, and a comment says the example did not label them.
- **The answer**: `parseReturnBooking()` (tracking number, consignment number, the label's address, https only, on a Bring host) or a plain sentence: `BOOK-INPUT-043` → "Bring says the
  store has no return agreement for this country or service. Ask Bring to add returns to your agreement, or paste a label address.", `BOOK-INPUT-083` → "Bring does not know that return
  service.", others as `bringProblem()`.
- **Test environment**: a label is booked as a test (`label_test`), is shown as one and never emailed as usable (the email says it is a test, so a store trying it out sees the flow).
- **Labels are fetched, never stored**: `returnLabel()` reads `label_carrier_url`, checks its host against the carrier module's own hosts (`isBringUrl()`; a URL on any other host is never
  fetched, and the route answers 404), and fetches with the agreement's keys, 10 s timeout.

### 4.8 Who pays for the label (`labelDeduction()`, pure, `src/lib/return-label.ts`; fed into `refundFor()` as `returnShippingMinor`)

- `return_cost_payer = 'shopper'` (as the order was sold, D153): the deduction defaults to `label_cost_minor` (the carrier's price **with VAT**, the store's actual direct cost, converted
  to the order's currency once at the store's rates, rounded half up to the minor unit; unknown → 0 until staff type one); staff may set a lower amount; **never above the cost** when the
  cost is known (`above_cost`: CRD Art. 14(1), "only … the direct cost of returning the goods"); when the cost is unknown staff may type one with a note (kept on the return's event).
- `return_cost_payer = 'store'` or null (an order with no record counts as the store paying, D153): the deduction is 0 and cannot be set.
- A **pasted** label keeps D153's rule (staff type `return_shipping_minor`); *No label* is 0.
- The deduction is taken off the credit of an exchange exactly as off a refund (it is part of `refundFor()`), and the exchange page and emails show it in the working.
- `refundFor()` is not changed: the unit test `return-label.test.ts` holds that the label's deduction reaches `refundFor()`'s `returnShippingMinor` for the shopper and never for the
  store, and `return-refund.test.ts` gains the case "label cost taken off a withdrawal's refund, never below 0, never above the cost".

### 4.9 Who may do what

| Action | Key | Notes |
|---|---|---|
| See exchanges, labels | `orders:read` | |
| Build, propose, send again, withdraw a proposal, process, cancel and refund instead | `orders:write` | open store, shop on |
| Record the customer's agreement (voluntary returns only) | `orders:write` | refused for a withdrawal return |
| Record an exchange's difference as paid outside Kaizen | the owner, or `orders:write` with `order_settings.staff_mark_paid` | D173's rule, `accountMayRecordOutside()` |
| Book a return label, print it | `orders:write` / `orders:read` | |
| Exchange and label settings | owner (`requireOwnerRole`, as the return settings) | |
| AI manager: `list_returns`, `explain_return`, `get_order` | `orders:read` (`TOOL_PERMISSIONS`) | read only, ungated |

Every action is a server action bound to the store slug and the return's id, asks `requirePermission(slug, key)` (D158), writes an audit entry (`return.exchange_proposed`,
`return.exchange_agreement_recorded`, `return.exchange_processed`, `return.exchange_paid_outside`, `return.exchange_cancelled`, `return.label_booked`, `returns.settings_saved`; area
`orders` in `AUDIT_AREAS`; amounts and ids only, never a note's words or an address) and `refresh()`es.

---

## 5. Where things live

Areas share files only through the registries of 5.6. **The words come first**: the foundation writes every customer-facing word of section 8 before the server starts.

### 5.1 Foundation (schema, migrations, pure libraries, shared types, the words)

| File | What |
|---|---|
| `src/db/schema.ts`, the three migrations of 3.8 | 3.1, 3.2, 3.3 |
| `src/db/exchanges.test.ts` | PGlite: every point of 3.3 |
| `src/lib/exchange-limits.ts` (+ test) | 4.1 |
| `src/lib/exchange.ts` (+ test) | `priceExchange()`, `exchangeBlock()`, `EXCHANGE_PROBLEMS`, `exchangeOutcome()` (`Δ`, transfer, remainder, to pay), `exchangeDeadline()` (4.5), the lifecycle table `nextExchangeStatus()` held equal to the database's by a test |
| `src/lib/exchange-input.ts` (+ test) | zod schemas of the builder, the agreement, the wish (server); a plain `exchange-input-browser.ts` for the shopper's wish field (no zod on a visitor's client component, D211) |
| `src/lib/return-label.ts` (+ test) | `labelBlock()`, `labelDeduction()`, `LABEL_PROBLEMS` |
| `src/lib/shipping-carriers.ts` | `CarrierFeature` gains `return_labels` (label "Return labels for customers"); `CarrierInfo.returnCountries`; `ReturnBookingRequest`; `ShippingCarrierAdapter.bookReturn?()`; Bring's `available` gains `return_labels` |
| `src/lib/bring.ts` (+ test) | `BRING_RETURN_SERVICES` (`9300` documented; others `needs confirmation`), `returnBookingBody()`, `parseReturnBooking()`, the two error codes' sentences |
| `src/lib/messages/{nb,sv,da,en}.ts`, `{lang}-browser.ts` | `m.exchange.*`, `m.returnLabel.*` (the wish field's words in `-browser`) |
| `src/lib/email-text.ts` | `exchange.*`, `returnLabel.*` (2.5) |
| `src/lib/invoice-text.ts` | `settled_by_return` payment words (section 8) |
| `src/lib/ui-catalog.ts` | `HAND_WRITTEN_ONLY` gains `exchange.`, `returnLabel.` |
| `src/lib/notifications.ts` | the five customer notifications of 2.5 with slots and `required` flags (`return.exchange_to_pay`, `return.exchanged` required) |
| `src/lib/pay-routes.ts` | `isExchangeLinkPath()`, joined to `isNoExtrasPath()` |

### 5.2 Server (`src/server`, the cron and webhook routes)

| File | What |
|---|---|
| `src/server/exchanges.ts` (+ `exchanges.int.test.ts`) | `previewExchange()`, `saveExchangeDraft()`, `proposeExchange()`, `resendExchange()`, `withdrawProposal()`, `recordExchangeAgreement()`, `recordExchangeWish()`, `processExchange()`, `settleExchange()`, `completeExchangePayment()`, `markExchangeSessionEnded()`, `recordExchangePaidOutside()`, `cancelExchange()`, `expireExchanges()`, `cancelExchangesForClosure()`, `exchangeView()`, `exchangeForToken()`, `pruneExchangeTokens()` |
| `src/server/exchange-pay.ts` | the page's loader and its press (`exchangePageFor()`, `confirmExchange()`, `declineExchange()`, `startExchangePayment()`), D173's `draft-pay.ts` pattern |
| `src/server/exchange-emails.ts` | the six kinds of 2.5 through `sendEmail()`, `notificationOn()` |
| `src/server/order-admin.ts` | `refundOrder()`'s `exchange` option; `splitRefund()` order for an exchange order (4.6); the refund of an `exchange` payment at the original's Stripe payment |
| `src/server/stripe-webhooks.ts` / `applySession()` | the `exchange_id` branch (4.4) |
| `src/server/returns.ts` | `actionsFor()` input (`exchangeConfirmed`), `refundReturn()` refuses while an exchange is `processed` (`exchange_pending`) and ends a `proposed`/`confirmed` one as `superseded` when staff refund instead; `getReturn()`/`getShopperReturn()`/`listReturns()` carry the exchange and label fields; the queue filter |
| `src/server/return-labels.ts` (+ `return-labels.int.test.ts`) | `labelOptions()`, `bookReturnLabel()`, `returnLabel()`, the job's `bookPendingLabels()` |
| `src/server/carriers/bring.ts` (+ test) | `bookReturn()`, its price ask |
| `src/server/return-jobs.ts` | `runReturnJobs()` adds `bookPendingLabels()` and `expireExchanges()` |
| `src/server/return-settings.ts` | the new settings |
| `src/server/order-insert.ts` | `OrderInsert` gains `exchange?: { id; madeBy }` (source `exchange`) |
| `src/server/store-closure.ts` | `cancelExchangesForClosure()` in the closing step; a warning in `closureBlockers()` |
| `src/server/privacy-export.ts`, `privacy-erasure.ts`, `retention.ts` | 2.7, 3.6 |

### 5.3 Shopper

| File | What |
|---|---|
| `src/app/s/[store]/[market]/account/exchange/[token]/page.tsx`, `actions.ts`, `exchange-section.tsx`, `loading.tsx` | the exchange page (2.1); pieces in `src/components/exchange/` |
| `src/app/s/[store]/[market]/returns/[token]/label/route.ts` | the label route (2.4) |
| `src/components/withdraw/return-status-view.tsx` (+ test), `src/app/s/[store]/[market]/returns/[token]/` | the exchange state, the wish form (a small client component, no zod), the label card |
| `src/components/withdraw/` return request form | the wish field on a voluntary return request |
| order pages (`order-section.tsx`, My account's order) | "Exchange for return {R}" line |
| `e2e/exchange.spec.ts`, `e2e/return-label.spec.ts` | 6.1, 6.2 |

### 5.4 Admin (English; colour roles; `PageHeader`, `Card`, `List`; every page with `loading.tsx` and its own permission check)

| File | What |
|---|---|
| `src/components/admin/returns/exchange-card.tsx` (+ view test), `label-card.tsx` (+ view test) | the return page's cards (2.2, 2.3) |
| `src/app/admin/[store]/returns/[id]/exchange-actions.ts`, `label-actions.ts` | the server actions |
| `src/app/admin/[store]/returns/page.tsx` | the queue's marks and filter |
| `src/app/admin/[store]/settings/returns/` | the settings fields |
| `src/app/admin/[store]/orders/[orderId]/` | the *Exchange* badge, the link both ways; the order list's `source` filter value |
| `src/lib/return-admin.ts` | the marks' words, `exchangeSentence()`, `labelSentence()` |
| `e2e/admin-exchange.spec.ts` (signed-in, D234) | 6.1 criterion 1's screen |

### 5.5 Analytics and AI

| File | What |
|---|---|
| `docs/analytics.md` first | **Exchange order** (a paid order like any, *left out of everything that asks where a sale came from*, as D173's staff-made orders: conversion, funnel, device, landing page; its own channel row **Exchanges**), **Transfer** (a refund of the original in Refunds, Net revenue and the Returns figures: goods came back; `refunds.kind = 'transfer'`), **Exchanges** in the Returns section (count of exchanged returns, share of counting returns, `MIN_RATE_ORDERS`), the reconciliation's lines unchanged (a transfer is a refund and a payment) |
| `src/server/analytics-sql.ts`, `analytics-returns-data.ts`, `src/lib/analytics-returns.ts` | `FROM_CHECKOUT` already excludes `source <> 'checkout'`; the Exchanges channel row; the exchange share |
| `src/lib/return-tools.ts`, `src/server/return-tools.ts` | 2.6's fields |
| `src/lib/chat.ts` `returnFacts()` | the exchanges fact |
| the plan-features migration | rows *Exchanges* and *Return labels from your carrier* (category Orders) |
| `src/lib/assistant-skills.ts` | `handle-return`'s paragraph |

### 5.6 The registries, and who edits each

| Registry | Change | Area |
|---|---|---|
| `COPY_RULES`, `PERSONAL_DATA`, `EMAIL_KINDS` | 3.7 | foundation |
| `NOTIFICATIONS`, `HAND_WRITTEN_ONLY`, `m.*`, `emailText()`, `invoice-text.ts` | 5.1 | foundation |
| `CARRIERS`, `CarrierFeature`, `ShippingCarrierAdapter` | 5.1 | foundation |
| `MOVEMENT_SOURCES` | `exchange` | foundation |
| `isNoExtrasPath()` | `isExchangeLinkPath()` | foundation |
| `AUDIT_AREAS` | the actions of 4.9 (area `orders`) | server |
| scan tests' allow-lists: `order-numbers.test.ts`, `stock-writers.scan.test.ts`, `payment-readers.scan.test.ts` (provider `exchange` readers, each with its reason), `restricted-orders.scan.test.ts`, `document-readers.test.ts`, `vat-readers.test.ts`, `unit-price-readers.test.ts`, `selling-readers.scan.test.ts`, `storefront-bundle.scan.test.ts` | the new files | server (shopper for the bundle scan) |
| `ADMIN_PAGES`, `store-nav.ts` | **none**: no new admin page (the cards live on the return's page; the settings on the return settings page) | — |
| `TOOL_PERMISSIONS`, `TOOL_WORDS`, `OWNER_TOOLS` | no new tool; fields of existing tools | analytics-and-ai |
| `KNOWN_COOKIES` | **none**: nothing is set (a source-scan test of the new routes and components) | shopper |
| sitemap, structured data, `llms.txt`, store-translate | **none** (the instructions' translation is D153's; the new texts are interface text) | — |
| plan features (D132) | two rows | analytics-and-ai |
| `checkout-kinds.int.test.ts` | the exchange scenarios (NOK, EUR) | server |

---

## 6. Acceptance criteria, row by row, mapped to tests

U = unit (Vitest, `src/**/*.test.ts`), P = PGlite (`src/db/*.test.ts`), I = integration against a real database and the fake Stripe (`src/server/*.int.test.ts`), E = Playwright.

### 6.1 `orders.exchanges`

| Criterion (the row's, unchanged) | Held by |
|---|---|
| Staff add replacement products to a return; the system shows the difference (refund due or payment to collect) from the same pricing functions as checkout, in two currencies | U `exchange.test.ts` (`priceExchange()` over `priceDraft()`: refund due, even, to pay; price above list refused; shipping kinds); I `exchanges.int.test.ts` "preview equals `cartSummary()` for the same goods" in a NOK market and a euro view; I `checkout-kinds.int.test.ts` exchange scenarios NOK and EUR (the placed exchange order equals the preview); E `admin-exchange.spec.ts` (signed-in: add a replacement on a return, the summary says "Payment to collect") |
| Processing the return creates a linked new order for the replacements with a number from the store's sequence (D141), holding stock only then | I `exchanges.int.test.ts` "a proposal holds no stock; processing allocates and reserves; the order has `source = 'exchange'`, `exchange_id`, the next number in the sequence, and `order_number_audit()` reports no gap"; P `exchanges.test.ts` (the order rules of 3.3 point 3, one non-cancelled order per exchange); U `order-numbers.test.ts` scan (only `order-insert.ts` inserts; `exchanges.ts` listed as a caller) |
| A difference owed by the shopper goes out as a pay link; one owed to the shopper is refunded through `refundOrder()` | I `exchanges.int.test.ts` "Δ > 0: pay link emailed, session for Δ, completed session settles: transfer + Stripe payment add up to the order's total, invoice issued, return `exchanged`"; "Δ < 0: `refundOrder()` called with the exchange option, Stripe refund of −Δ, transfer of T, one credit note `return_exchange` for C, none for the two refunds"; "Δ = 0: no provider call"; "Stripe refund fails: nothing settled, retry settles once"; "late payment refunded in full"; E `exchange.spec.ts` (the customer's page: confirm, then the pay step's button leads to Stripe's hosted page, faked) |
| A withdrawal's legal refund is never reduced by choosing an exchange without the shopper's own statement | P `exchanges.test.ts` "`confirmed_by = 'staff'` refused for a withdrawal return"; I `exchanges.int.test.ts` "C equals `refundFor()`'s refund for the same return; processing without a confirmation is refused; an unconfirmed or expired proposal leaves the full refund available; `credit_changed` when inspection would make the customer pay more than confirmed"; I "a lapsed exchange on a withdrawal return leaves `refundDue()` unchanged and the return overdue at its legal deadline"; U `exchange.test.ts` `exchangeDeadline()` capped at the refund deadline |

Also held: eligibility refusals (4.3) by U and I; the copied, host, reverse-charge and restricted cases by I; privacy (export, anonymising of the wish note) by I
`privacy-export.int.test.ts` cases; no cookie or storage on the page by a source scan.

### 6.2 `orders.return-labels`

| Criterion (the row's, unchanged) | Held by |
|---|---|
| Approving a return with a connected carrier books a return shipment from the shopper's address to the return address and keeps its label address on the return (integration test with a faked carrier) | I `return-labels.int.test.ts` with a faked `bookReturn()` registered for the test: approving a voluntary return with *Book a return label* sends `from` = the order's shipping address, `to` = the return address, and keeps carrier, numbers, `label_carrier_url`, `label_source = 'carrier'`; the withdrawal return's automatic booking by `bookPendingLabels()` with `label_auto`; U `bring.test.ts` (`returnBookingBody()`, `parseReturnBooking()` with the documented error codes) |
| The label reaches the shopper by email and on the status page, fetched from the carrier's own host and never stored (test) | I `return-labels.int.test.ts` "the `return.label_ready` email has the label route as its button and no attachment; the route fetches from the faked carrier's host with the agreement's keys, answers PDF with `no-store`; a `label_carrier_url` on another host is never fetched (404); nothing is written to Storage or `email_messages` beyond the email's body"; U `return-status-view.test.ts` (the card); E `return-label.spec.ts` (the status page shows *Print your return label* and the route answers a PDF from a stub carrier) |
| Who pays is the order's return cost payer: a label the shopper pays for is taken off the refund as return shipping (unit test with `refundFor()`) | U `return-label.test.ts` (`labelDeduction()` → `refundFor()`: shopper pays → cost taken off, store pays or null → 0, never above the cost, unknown cost → 0); U `return-refund.test.ts` the added case; I `return-labels.int.test.ts` "the refund's working shows the label's deduction for a shopper-pays order" in NOK and in a euro order (cost converted once) |
| A carrier that cannot book leaves the pasted-address path working | I `return-labels.int.test.ts` "a faked carrier that refuses (`BOOK-INPUT-043`) or times out: the return stays approved, the sentence is shown, and pasting a label address still works and is emailed as D153 does"; existing `returns-actions.int.test.ts` and `return-input.test.ts` unchanged and passing |

### 6.3 Database tests, cross-cutting tests and scans

- P `src/db/exchanges.test.ts`: the lifecycle, eligibility, the exchange order's rules, the transfer pair (deferred), the refund of an `exchange` payment, the D159 patches (no credit note for
  an exchange refund; one `return_exchange` credit note; the exchange order's invoice), copied orders refused, `label_*` checks, the `label_source` back-fill.
- U `invoice-parity.test.ts`: the `return_exchange` credit note equals `buildInvoiceSnapshot()`'s for the return's working.
- I `checkout-kinds.int.test.ts`: an exchange scenario in NOK and EUR: original order, return, exchange with `Δ < 0`, `Δ > 0`; `Σ invoices − Σ credit notes` of both orders equals their
  lines and shipping as they now stand, per VAT rate.
- I `exchanges.int.test.ts` "a later return of the exchange order refunds the transfer part at the original order's Stripe payment" and "a goodwill refund on the original cannot take the
  transferred part".
- The scans of 5.6 updated, each new reader with its reason.

### 6.4 Criteria changes (for the lead; the rows are not edited here)

- `orders.return-labels` criterion 1: "Approving a return" does not fit a withdrawal return, which starts approved with no staff step. Proposed: "Approving a return with a connected carrier
  that offers return labels, or the store's automatic label setting for a withdrawal return, books a return shipment from the shopper's address to the return address and keeps its label
  address on the return (integration test with a faked carrier)."
- `orders.return-labels` criterion 2: "by email" should say how, since attaching would store it. Proposed: "… by an email button and on the status page, both opening a Kaizen route that
  fetches it from the carrier's own host with the store's keys; it is never stored or attached (test)."
- `orders.return-labels` criterion 3: add the cap. Proposed: "… taken off the refund as return shipping, never above what the label cost (CRD Art. 14(1)) (unit test with `refundFor()`)."
- `orders.exchanges` criterion 4 is right and is held as written; its words "the shopper's own statement" are read here as *the customer's own press on the exchange page* for a
  withdrawal return (a staff record is allowed only for a voluntary return).
- `orders.exchanges` `shopify.text`: the page read on 2026-10-15 does not state that exchanged items have their own return window (the row says so); Kaizen gives them one anyway (the
  exchange order is an order). The lead may correct the row's text at the re-rating.

---

## 7. What is deliberately NOT done, and why

- **Restocking fees and return fees of the store's own** (Shopify has them): a fee taken off a withdrawal's refund would lower the legal refund (Art. 13, 14(2) allow only the direct
  return cost and diminished value); for voluntary returns D153's lower amount with a reason exists. Not built; wave 5 (discounts and fees) may revisit for voluntary returns only.
- **Store credit or gift cards instead of a refund**: wave 5 (`customers.gift-cards`); an exchange is goods for goods.
- **Exchanging into custom items, services, downloads, bookings or subscriptions**, and **exchanges of reverse-charge, IOSS, host, subscription or weekly-box orders**: each needs its own
  price, time or tax rule; Shopify refuses custom items too.
- **The customer choosing the replacement themselves** (a self-serve exchange picker on the status page): the wish is free text and staff build the proposal; a picker needs stock and
  price rules on a public page. Later, with wave 8's chat order tools.
- **Exchanges before the goods are back** ("advance exchange"): processing waits exactly as the refund would (Art. 13(3)); sending replacements first is a credit risk and a new flow.
- **Return labels for PostNord, Porterbuddy and Helthjem**: PostNord has no booking yet (D136, EDI behind a login); Porterbuddy and Helthjem return products are not documented in their
  connections. Bucket B, a later run per carrier.
- **A return label booked together with the outgoing parcel** (Bring's free return, `returnProduct` on the outbound booking, label in the box): useful, but it books a label for every
  order; a later step of D134.
- **Cancelling an unused label at the carrier**: not offered (Shopify cannot void either); the staff screen says a cancelled return leaves its label unused.
- **QR codes / label-free returns** (`labelFreeCode`, `qrCodeLink`): not read in full; later.
- **Pickup of returns at the door** (D153's list): not built.
- **A return to another location than the first** (D153's list): the return address is the store's one.

---

## 8. Needs human legal review

Every text below is hand-written in nb, sv, da and en, in `HAND_WRITTEN_ONLY`, and flagged `needs legal review` in its module:

1. **The exchange page and the proposal email** (`m.exchange.*`, `emailText().exchange.proposed`): that confirming is the consumer's express agreement to be reimbursed by the exchange
   instead of to the original means of payment (CRD Art. 13(1) second subparagraph), that the consumer incurs no fee by it, and the sentence "If you do not confirm by {date}, you get your
   money back as usual".
2. **Whether staff may record a customer's agreement given by phone or email** for a withdrawal return (refused in this run), and whether the recorded agreement for a voluntary return
   is enough. For a withdrawal return no link to share is made either (3.14): the proposal reaches the customer only by email to the order's own address.
3. **The pay step and `return.exchange_to_pay`**: the extra payment's consent (Art. 22), and whether a withdrawal return's 14-day reimbursement deadline is met by an exchange whose
   difference is paid later or not at all (the store must then refund by the deadline; the texts say so).
4. **The right of withdrawal for the replacements** (the exchange order as a new distance contract with its own 14 days) and its sentence on the page and in the confirmation.
5. **`return.exchanged`**, `return.exchange_lapsed` and the exchange order's confirmation sentence.
6. **The invoice wording `settled_by_return`** ("Paid with the credit of return {R} of order {N}") and the credit note of an exchanged return (VAT Directive Art. 90, 219): for the
   accountant as well, including whether the transfer should be shown on the exchange order's invoice as a payment (this spec) or a reference.
7. **The label texts** (`m.returnLabel.*`, `return.label_ready`): the who-pays sentences ("If you send the parcel with this label, its cost, {amount}, is taken off your refund …"
   before the refund, "The cost of the label, {amount}, is taken off your refund" after it) against Art. 6(1)(i) and 14(1), and the test-label sentence.
8. **The wish field's words** on the status page and the return request form, and that asking it after the withdrawal's two steps never burdens the withdrawal function (Art. 11a).

---

## 9. For the lead

### 9.1 Migrations expected

The three of 3.8, applied by CI's `release` job (`docs/ci-migrations.md`). They only add and widen: no rename, no drop of a column, so the code still running during the deploy keeps
working (a `refunds.kind` default `money`, `label_source` back-filled in the same migration).

### 9.2 Statements the Supabase migration tool would cancel, and things only the lead can do

- CI applies through a direct connection, so these run as written; listed in case anything is applied with the tool: `ALTER TABLE … DROP CONSTRAINT` and re-`ADD` for the widened checks
  (`orders_source`, `returns_outcome`, `credit_notes_source` and its pairing check, `inventory_movements_source`, `refunds`' and `payments`' new pairings); `DROP INDEX`/`CREATE UNIQUE
  INDEX` if any D159 unique is replaced (none expected: the new credit-note uniqueness is an added partial index).
- **No `DELETE` or `DROP` inside a function**: token pruning and the wish-note retention are application code (`runRetention()`).
- The `label_source` back-fill is one `UPDATE … WHERE label_url IS NOT NULL` in the migration (not in a function).
- Before applying: check that no live return has `label_url` set together with any value the new checks refuse (none can exist: the columns are new).

### 9.3 Advisors to check after the deploy

Security and performance advisors of `ybsozesfuxuitoacntfo`: RLS on with no policy for the two new tables (INFO, as every private table); the foreign keys to `accounts`
(`return_exchanges.made_by`) and every new composite foreign key have a covering index (3.5); the new functions have `SET search_path = ''` and are not granted to `anon`/`authenticated`.
Record the files' versions in `docs/decisions.md` (Migration versions).

### 9.4 Decision row, draft (D239, the next free number at ship time)

| D239 | **Exchanges and return labels (wave 3).** `docs/wave-3-exchanges.md` is the contract. **Exchanges.** Staff add catalogue goods to a return as replacements (`return_exchanges`, `return_exchange_lines`), priced by `priceDraft()` in the original order's market view with no order-level discount and an optional lower price per line; the server nets them against the return's credit, which is always `refundFor()`'s, into a refund due, an even exchange or a payment to collect. The customer confirms the proposal on `/account/exchange/{token}` (a voluntary return's agreement may be recorded by staff; a withdrawal's never: CRD Art. 13(1)). Processing, offered where the refund would be, makes a new order (`source = 'exchange'`, numbered by D141's sequence through `insertOrder()`) and only then holds its stock; the credit moves as a transfer refund on the original order and an `exchange` payment on the new one (no Stripe call), the rest is refunded through `refundOrder()` or paid by a link (Stripe's hosted page) or recorded as paid outside Kaizen. The original order gets one credit note for the return (`return_exchange`), the new one its own invoice. A withdrawal's exchange never runs past its legal refund deadline. **Return labels.** The carrier adapter gains `bookReturn()` (Bring's return service); a label is booked on approval, from a withdrawal return by the five-minute job when the owner turns it on, or by hand; it is emailed as a button and shown on the status page, both opening a route that fetches it from Bring with the store's keys and never stores it; its cost is taken off the refund only when the shopper pays return shipping, never above the cost; a failed booking leaves the pasted address. | {date} | Rows `orders.exchanges` (partial until the texts of section 8 are read and an exchange is paid in Stripe test mode) and `orders.return-labels` (partial, bucket B: not yet booked with a real Bring agreement). Migration versions: … Advisors checked after: … |

### 9.5 CLAUDE.md bullet, draft (Admin section, after the D238 bullet)

- **Exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md`)**: an exchange is a D153 return whose credit pays a new order: `return_exchanges` (lifecycle in the database,
  `nextExchangeStatus()`), replacements priced only by `priceExchange()` (over `priceDraft()`, equal to `cartSummary()`), the credit only `refundFor()`'s and never lowered, applied only
  on the customer's press on `/account/exchange/{token}` (a no-extras path; staff may record agreement for a voluntary return only). Processing (`processExchange()`, where the refund
  would be offered) makes the order through `insertOrder()` (`source = 'exchange'`, D141) and only then holds stock; the credit moves as a `refunds.kind = 'transfer'` row and an `exchange`
  payment (no Stripe call), the rest through `refundOrder()`'s `exchange` option or a pay link (`applySession()` branches on `payments.exchange_id`); one `return_exchange` credit note per
  exchanged return, none for its refunds; a later refund of the `exchange` payment is made at the original order's Stripe payment. Return labels are `bookReturn?()` on
  `ShippingCarrierAdapter` (feature `return_labels`, Bring only), kept as `returns.label_*`, fetched for the shopper by `/returns/{token}/label` from the carrier's own host and never
  stored or attached; the deduction is only `labelDeduction()` (shopper pays, never above cost). New words are hand-written (`HAND_WRITTEN_ONLY`) and need legal review; a new money read
  here needs a euro scenario in `checkout-kinds.int.test.ts`.

### 9.6 Before pushing, and after (the things CI cannot prove)

- **Exchange in Stripe test mode on a real store**: place an order, withdraw it, propose an exchange with `Δ > 0`, confirm, process, pay the link, and check: the new order's number, its
  invoice, the original's credit note, the Stripe dashboard shows one charge for `Δ` and no refund for the transfer. Then a `Δ < 0` exchange: one Stripe refund of `−Δ`.
- **A Bring return label with a real Mybring test user**: book a `9300` return in the test environment, confirm the party roles (sender = shopper?), the label link's host and that it is
  fetchable with the same headers, and whether a standalone return is billed on use; fix `returnBookingBody()` and the `needs confirmation` comments.

### 9.7 Merge notes and risks

- `refundOrder()` and `applySession()` are shared with D153, D173 and D174: the server area changes them, the other areas do not touch them; the existing integration tests of returns,
  drafts and edits must pass unchanged.
- The D159 patches are anchored on the live definitions as of `20261015001113_notifications_rules.sql` (the latest `complete_order_payment()`); the foundation re-reads them before
  patching and fails loudly when an anchor moved.
- `payment-readers.scan.test.ts` will flag every reader of `payments.provider`: each must decide whether `exchange` is a payment it counts (analytics: yes; the order page's key: no, an
  exchange order's key is its Stripe or manual payment, else its `exchange` payment's id; refunds: yes, per 4.6).

## 3.15 As built (the lead's checks, 15 October 2026)

* **The once-shown share link** is held by `ExchangeLinkHolder` (`src/components/admin/returns/exchange-link.tsx`), a client component at a fixed place in the
  Exchange card: the builder hands it the link (`useShowExchangeLink()`), so the `refresh()` after a proposal, which stops drawing the builder once the proposal
  is live, keeps the link on screen. `e2e/signed-in/admin-exchange.spec.ts` had failed 2 of 6 runs on it.
* **A withdrawal's exchange after an email change** is refused (`email_changed`): `proposeExchange()`, and `resendExchange()` while the proposal waits for the
  customer, refuse when an `order.edited` event naming `email` (`updateOrderContact()`) is newer than the return, since the proposal would then reach an address
  the customer did not give (skeptic's residual risk; test in `exchanges.int.test.ts`).

