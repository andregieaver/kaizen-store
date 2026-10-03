# Withdrawals and returns (D153)

The EU withdrawal function (Directive (EU) 2023/2673, Consumer Rights Directive Art. 11a, applying since 19 June 2026;
Norway's angrerettloven § 22 mirrors it) and a returns flow for goods, built on the `withdrawal_requests`, `returns`
and `return_lines` tables that have existed, unused, since the first schema. This file is the contract: code, tests and
texts follow it, and a disagreement is settled here first.

This is a decision about **law-shaped behaviour**. Every consumer-facing text is hand-written in Norwegian, Swedish,
Danish and English and **needs human (legal) review before real use**, like the other legal texts. Nothing here is
legal advice and nothing is machine-translated into a legal text.

## Two things, kept apart

1. **A withdrawal** (`withdrawal_requests`, `kind = 'withdrawal'`): the consumer's *statement* that they withdraw from
   the contract. It is a legal notice. It needs no reason, no approval and no goods back first. The store may not refuse
   it inside the period for a line that has the right; it can only say what happens next. It is made with the
   **withdrawal button**: two steps (*Withdraw from contract here*, then *Confirm withdrawal*) and an acknowledgement on
   a durable medium (an email, kept in `email_messages`) with the date and time.
2. **A return** (`returns`): the physical side, which the store works through: goods in transit, received, inspected,
   refunded. A return is created by a confirmed withdrawal (`withdrawal_request_id` set) or, for goods outside the legal
   right but inside the store's own longer window, by a shopper's *return request* (`kind = 'return'`, no withdrawal
   request, the store may approve or decline it).

## Who can withdraw, from what, until when

Per order line (a pure function, `src/lib/withdrawal.ts`: `lineEligibility()`):

- **Goods, not excluded.** `order_lines.withdrawal_exclusion = 'none'` and the order is paid
  (`status in ('paid','fulfilled')`, or was paid and later cancelled: no), not copied (`copied_from is null`, triggers
  already refuse copied orders). **Sealed goods** (`sealed_hygiene`, `sealed_media`) keep the right *until they are
  unsealed* (CRD Art. 16(e), (i)): the withdrawal is accepted, the page and the acknowledgement say the right lasts while
  the seal is unbroken, and whether it was broken is for the inspection (a deduction with its note, or declining the
  line). Every other exclusion is refused from the start.
- **Bookings and services (`delivery = 'service'`, stays, rentals, appointments)** are cancelled or moved with the
  shopper's own booking tools (D66) and are `dated_service` here: this page does not withdraw them and says so in
  neutral words (it does **not** claim the law excludes them) and points to the store. **Open legal question (needs a
  human check before real use):** CRD Art. 16(l) excludes only accommodation, transport, car rental, catering and leisure
  services with a set date; an ordinary appointment (a consultation, a haircut, a repair visit) keeps a 14-day right
  from the contract until fully performed (Art. 9(2)(a), 16(a)). The app does not yet tell leisure from other
  appointments, so a statement about one is handled by staff through *Register a withdrawal* below.
- **Digital content** with the shopper's tick at checkout (`digital_consent_at`) has no right (D24): excluded.
- **Businesses.** An order with a company (`company_name`) has no statutory right. The withdrawal function says so and
  offers the voluntary return window instead (below).
- **Window.** The statutory period is 14 days (`LEGAL_WITHDRAWAL_DAYS = 14`) from the day the consumer **received** the
  goods, the last of them when they come in parts (`orders.delivered_at`, CRD Art. 9(2)(b)). It is **never started from an
  estimate**: the date a parcel was sent is not the date it arrived, and a trader may not refuse a statement because of
  its own guess. So with the goods sent and their receipt not recorded the right is simply open (the function answers
  "sent: your 14 days count from the day you receive them", never a deadline), and before anything is sent it is open as
  well (a consumer may withdraw before delivery). `delivered_at` is written by staff (*Mark the goods as received* on the
  order's page, `markDelivered()`, a store day not in the future and not before the order) and, later, by a carrier's
  confirmed delivery. A **shipment recorded after the receipt takes the receipt back** (`markSent()` clears it and writes
  `order.delivery_reopened`): goods sent in parts are received when the last part is. `return_settings.transit_days` (default
  3, 0 to 14) is only the store's usual transit time, used for one thing: staff are shown "if the parcel took your usual
  transit time the days would run to about {day}: an estimate, not a deadline". The store's own longer window
  (`return_settings.window_days`, 14 to 100, default 14) counts from the same receipt: the legal 14 days are never shortened
  by the store, and the part beyond 14 is a *return* the store may decline, not a withdrawal. Days are the store's calendar
  days (`stores.time_zone`). **The period may be longer by law** (CRD Art. 10: up to 12 months, Norway 3 months, when the
  trader did not give the Art. 6(1)(h) information): the app records no such information, so after the 14 days by its
  records it says "by our records the 14 days have passed; if you were not given the information, or received the goods
  later, the period may be longer: write to the store", never that the period is over as a fact, and staff can register such
  a statement (below) as *accepted as in time* with the reason. **Needs a human check:** whether to record, per store, that
  the model withdrawal information is given.
- **Quantity.** A line can be withdrawn only up to what is left: `quantity − Σ(quantity on withdrawal and return lines
  that are not cancelled or declined)`.
- **Subscriptions and delivery boxes** (`orders.subscription_id`, standing deliveries): the request is accepted and
  recorded like any other, the staff screen shows a banner that the subscription itself is ended separately. The
  function does not end it.

Hidden, never silently: a line that cannot be withdrawn is *listed with the plain reason* (excluded by law, digital
content, period over, already returned), never left out.

## The withdrawal function (shopper)

- **Where.** `/s/{store}/{market}/withdraw` (a plain route, always reachable: linked from the standard footer, from
  every order confirmation and shipping email, from the order page and from My account's order page). It is not a page
  role and not in the builder (phase 1); it uses the store's theme and its own chrome.
- **Step 1 – the statement.** Fields: name, email, order number, and the lines (all eligible lines ticked, quantities
  editable). No reason is asked. A signed-in customer's own orders are prefilled and need no email. A link from an
  order page carries the order (the order page's own key, never the number alone) and prefills.
- **Matching.** The order number and email must match (case-insensitive email; the order's `email` or its customer's).
  The reply is the **same** whether or not they match (no enumeration): "If the details match an order, you will see the
  next step." The next step is only shown, in the same response, when they matched. A mismatch shows the same-shaped
  page with an explanation of where to find the order number and the contact address of the store (never a different
  status code or timing the browser can tell apart; at least a fixed delay floor is applied). **Guesses are counted**
  (`commerce.withdrawal_attempts`): an attempt that matched no order is kept for a day as **hashes of what the request itself
  supplied** (the store with the typed email, the store with the typed order number; never an IP address, a cookie or the
  raw value), and after 10 by one email, 10 by one order number or 300 in the store in an hour the function answers
  *limited* to what is shown by email and number, matched or not (the same words for any number, so the real one is not given
  away). An order shown by its page's key, which cannot be guessed, or by being signed in is never turned away by it, so nobody can
  lock a consumer out of the function by guessing at their order (a consumer turned away can use the order page's link, sign in, or
  write to the store, which registers the withdrawal). Order numbers are a sequence, so without it
  anyone who knows an email could walk through them. A match records nothing there. The number lookup uses an index
  (`orders_number_normalised_idx`: number without spaces, upper case), so a guess is cheap for the database.
- **Step 2 – confirm.** A page listing exactly what the shopper declared and the button *Confirm withdrawal*. Nothing is
  a withdrawal until it is pressed (an email scanner or a refresh changes nothing: step 1 only creates a pending
  request, which expires after 24 hours unconfirmed and is then deleted by the daily job).
- **Acknowledgement.** Confirming records `confirmed_at`, writes the return(s), and sends the acknowledgement email in
  the order's language **in the same request** (a durable medium): the store, the order, the lines, the date and time
  (store time zone, with offset), the reference, what happens next (return instructions, who pays return shipping per the
  store's setting, when the refund is made), and the statutory text that goods must be sent back within 14 days of the
  declaration. The acknowledgement goes to **the order's own address** (and its customer's), **never to an address typed
  into the form**: a visitor who holds an order page's key, or is signed in, may type any address, and the store's
  sender must not be made to write to a stranger, so for such a visitor the request keeps the order's address and every
  later email (received, refunded) goes there too. `acknowledged_at` and `acknowledgement_reference` (the
  `email_messages` id) are set only when the email was **handed to the email provider** (`sent`): an email that is only
  kept (`logged`, no provider set up) has not reached the shopper, so it is not recorded as sent, the page says it could
  not be sent, staff see *acknowledgement not sent* and the job tries again. If the provider fails, the request still
  stands (confirmation is the legal act) and the failure is shown to staff as *acknowledgement not sent* with a *Send
  again*. The confirmation page itself also shows the acknowledgement text and reference, so the shopper has it at once.
  **A withdrawal made before the goods were sent** (the order had no shipment when the store was told) says "the goods had
  not been sent, so you have nothing to send back": no send-back day, no return-cost sentence and no hold on the refund
  (Art. 13(3) lets the store hold a refund only against goods or proof of sending).
- **A statement the function could not take.** Any clear statement withdraws (CRD Art. 11): an email, a letter, a call, or a
  form with a typo in the order number. Staff **register** it on the order's page (*Register a withdrawal the customer made
  outside the form*, `registerWithdrawal()`): the lines, how it came (`email`, `letter`, `phone`, `in_person`, `other`), the
  store day the store was told (that moment is `confirmed_at`, starts the refund's 14 days, and is what the acknowledgement
  states), a note. It is written exactly as the two steps write it (`writeConfirmation()`), the period is judged as it stood
  when the store was told, the history says staff registered it (`return.confirmed` with `registered`, actor `staff`) and
  the acknowledgement goes to the order's address. A statement past the 14 days by the records is registered as *accepted as
  in time*, with its reason (the information about the right was not given, or the goods came later).
- **No cookie, no storage, no IP kept.** Abuse limits (per order, per email, per store per hour) are counted in the
  database by the request's own keys, never by IP or a cookie. The channel recorded is `web`.
- **Closed or late.** After the period by the store's records the function still opens and says (in words that do not
  claim the law's last word) that by the records the 14 days have passed and the period may be longer, and to write to the
  store (and, if the store has a longer voluntary window and it is open, offers a *return request*).

## The return (staff side)

Statuses (`returns.status`, in this order; `declined` and `cancelled` end it elsewhere): `requested`, `approved`,
`in_transit`, `received`, `inspected`, `closed`; plus `declined`, `cancelled`. A **withdrawal return** starts at
`approved` (the right is not the store's to refuse) and the store sets instructions; a **voluntary return** starts at
`requested`.

- **Queue** `/admin/{store}/returns` (Orders section): filters by status and kind, search by order number/email,
  oldest first, an *Overdue* mark and a count in the section.
- **Detail** `/admin/{store}/returns/{id}`: the withdrawal's statement and acknowledgement (with its send state), the
  lines with condition and decision, a timeline (from `order_events`), notes. Actions: approve or decline (a voluntary
  return only; declining a withdrawal return is refused except for a line the law excludes, and then it is a *line
  decision*, not a status), set instructions and return address, a return label address (https only, pasted: carrier
  labels are a later phase), *Mark in transit* (the shopper's proof of sending), *Mark received*, *Inspect* (per line: `condition` `as_new`, `opened`,
  `used`, `damaged`; `restock` yes/no; a **deduction** for diminished value from handling beyond what is necessary to
  establish the nature, CRD Art. 14(2): a number with a note, and never above the line's value), *Refund* and *Close*.
- **Refund** goes through the existing `refundOrder()` (Stripe on the store's account, Kaizen's fee on the refunded
  part returned, restock, order event, host commission), never a second path. The amount is computed once by
  `refundFor()` (`src/lib/return-refund.ts`, pure, tested):
  line value actually paid for the returned quantity (the line's `total_minor` already has campaigns, group and code
  discounts taken off, and the bonus credit and referral shares: refund what the shopper paid for it, never the list
  price) − deductions, **plus the original standard delivery cost** only when the whole order is withdrawn (CRD Art.
  13(1): the cheapest standard delivery the trader offered; extra for a faster option is not refunded), **minus the
  return shipping cost** when the shopper pays it (the store's setting, default *shopper pays*: a CRD default; a store
  that pays says so in `return_settings.who_pays_return`; **as it stood when the order was placed**, `orders.return_cost_payer`:
  the consumer is told of the cost before buying, so a later change of the setting changes nothing for an order already sold,
  and an order with no record counts as the store paying), amounts in the order's currency, minor units, never negative
  and never above `order.refundableMinor`. The staff screen shows the working before the button. **A withdrawal is refunded
  in full (Art. 13(1))**: staff can *raise* the amount, with a reason (logged), never lower it; what takes from a withdrawal
  is only the inspection's deductions (Art. 14(2), each with its note) and the return shipping the shopper pays, both in the
  working. A voluntary return is the store's own offer and its amount can be set lower with a reason. **The refund email
  always shows how the amount was made**: the working, each deduction with its note, and an adjustment row with its reason.
- **Timing.** The store must refund without undue delay and at most **14 days after it was informed** of the withdrawal
  (Art. 13(1)), and may withhold until it has the goods back or proof of sending, whichever is earlier (Art. 13(3)): so with
  *withhold until received* the refund is offered **from *in transit* on** (the shopper's proof of sending), and **at once for
  a withdrawal made before anything was sent** (`nothingSent`: no shipment existed when the store was told). Staff never have to
  *Mark received* to be able to refund, and nothing false (`received_at`, "the goods have arrived") is ever written to do it.
  A parcel packed for an order every unit of which was withdrawn is not sent (`markSent()` refuses it), and the order's page
  tells staff what was withdrawn before sending, to leave out of the parcel. `refundDue()`: the
  deadline is `confirmed_at + 14 days`; with *withhold until received* on (`return_settings.refund_when`, `received`
  default for goods, `request` otherwise) the clock for the refund is the earlier of *received* and *proof of sending*
  plus nothing, never later than the deadline stated in the acknowledgement. The queue shows *Refund due* and *Overdue*;
  the control center's `attention` and the store Home alerts count overdue ones; nothing is refunded automatically.
- **Stock.** Restock goes through the refund's `restock` input; a return the store marks `restock` for a line that was
  never sent (no shipment) restocks too. Digital, service and booking lines never restock.
- **A withdrawal is never cancelled** (`return_withdrawal_not_cancellable`): it is effective on the statement, and
  cancelling it would remove the consumer's legal withdrawal and its refund deadline from the system without telling them.
  *Cancel* exists for a voluntary return only. When the goods never come back a withdrawal is **closed without a refund** (the
  store confirms it, `confirmNoRefund`, and says why in the note), so it and its deadline stay on record.
- **Orders paid outside Kaizen's Stripe** (`canRefund` false): the return can be worked through but the refund is
  recorded as *refunded outside* (a note and an event, no amount sent), exactly as the order page already tells staff to
  refund in Stripe.

## Voluntary returns (the store's own window)

`return_settings.window_days > 14` or a shopper's request past 14 days offers a *return request* (kind `return`,
reason chosen from a list, optional note, a photo is out of scope). The store approves or declines with a reason that
the shopper is emailed. Excluded goods (`withdrawal_exclusion <> 'none'`) can only be returned voluntarily if the store
switches *Accept returns of excluded goods* on (default off). Complaints about defects under the two-year legal guarantee
(Directive 2019/771) are **not** this flow (a later piece): the reason `defective` here is only a reason, and the shopper
is told that their statutory complaint rights are unaffected.

## Reasons

`reason` (optional on both kinds, never required for a withdrawal and never asked first): `changed_mind`, `too_big`,
`too_small`, `defective`, `not_as_described`, `damaged_in_transit`, `wrong_item`, `arrived_late`, `other` (+ a note up to
500 characters). The store reads them in analytics; they are never used to refuse a withdrawal.

## Settings (`commerce.return_settings`, one row per store, a store setting, copied with a store)

`window_days` (14–100), `transit_days` (0–14: the store's usual transit time, shown to staff as an estimate and never used to close a right), `who_pays_return` (`shopper` | `store`), `refund_when`
(`received` | `request`), `accept_excluded` (bool), `instructions` (text up to 2000 characters, in the store's main
language, shown and emailed; translatable through the store translation worklist), `return_address` (jsonb: name, street,
postal code, city, country; default the store's postal address), `b2b_returns` (bool: voluntary returns for company
orders, default off). Edited at `/admin/{store}/settings/returns` (Settings section) by owners; staff with order access
work the queue. Defaults are the legal ones.

## Data (what is new on the existing tables)

`withdrawal_requests`: `locale`, `market_code`, `status` (`pending` → `confirmed`, `expired`), `expires_at`.
`orders`: `return_cost_payer` (`shopper` | `store`, the setting at the sale; null counts as the store), `standard_shipping_minor`
(the standard delivery at the sale); `delivered_at` (already there) is written by *Mark delivered*. `withdrawal_attempts`: hashed
keys of guesses, a day. `returns`: `shipping_refund_minor` (the delivery its refund gave back), `refund_claimed_at` (a refund in
progress). `returns`: `kind`, `number` (per order, `{order number}-R{n}`), `reason`, `reason_note`, `instructions`, `label_url`,
`return_address` (snapshot), `approved_at`, `shipped_at` (shopper's proof of sending, or staff's), `received_at`,
`inspected_at`, `closed_at`, `outcome` (`refunded` | `declined` | `no_refund` | `cancelled`), `refund_id`,
`refund_deadline`, `public_token` (random, 32 bytes, for the shopper's status page, which changes nothing and shows no
address or email beyond the order number), `updated_at`. `return_lines`: `reason`, `restock`, `deduction_minor`,
`deduction_note`, `decision` (`accept` | `decline` with `decline_reason`). `return_settings` as above. The DB enforces:
quantities within what is left (trigger, under a lock on the order's lines), the lifecycle (no skipping back), a
withdrawal return needing a confirmed request, `acknowledged_at` only after `confirmed_at`, a refund never above what
was paid, no write on a copied order. Enum values are added in their own migration step (a new value cannot be used in
the migration that adds it).
**As built (migrations `returns` and `returns_rules`, `src/db/returns.test.ts`).** Where the above left room, the
database decides it this way, and the pure libraries agree (`src/lib/return-status.ts` holds the same lifecycle table and a
test runs every move against the database):

- *Extra columns.* `returns`: `decision_note` (why a voluntary return was declined, emailed), `staff_note`,
  `refund_computed_minor` (what `refundFor()` said), `refund_minor` and `refunded_at` (what was refunded, recorded once),
  `refund_note` (the reason for an adjusted amount), `refund_outside` (refunded outside Kaizen's Stripe), `return_shipping_minor`.
  `return_lines.restock` is a plain yes/no (default no). `withdrawal_requests.status` is text (`pending`, `confirmed`,
  `expired`) with checks; `returns.kind`, `outcome` and the line `condition`/`decision` are text with checks. Only
  `return_status` is an enum, with `approved`, `declined` and `cancelled` added in their own migration step.
- *Quantities.* A pending request holds nothing: its lines are checked against what is left when it is made and again when it
  is confirmed, and the **return lines** are the claim (accepted lines of returns not declined or cancelled, counted under a
  `FOR NO KEY UPDATE` lock on the order line). A withdrawal return holds only what its request declared, and a line the law
  excludes is a *declined line* with a reason, never an accepted one. A return's lines are never changed in quantity or deleted
  (decline the line, return the rest); returns and their lines are never deleted; no lines are added once the goods are in transit.
- *Lifecycle.* Forward only: `requested` to `approved`, `declined`, `cancelled`; `approved` to `in_transit`, `received`,
  `closed`, `cancelled`; `in_transit` to `received`, `closed`, `cancelled`; `received` to `inspected`, `closed`, `cancelled`;
  `inspected` to `closed`. A withdrawal return starts `approved`, is never declined, and exists only for a *confirmed* request of
  the same order (one return per request) on an order without a company. A step sets its own time (`approved_at`, `shipped_at`,
  `received_at`, `inspected_at`, `closed_at`), once, and never early; an ended return is only annotated (`staff_note`).
  `refund_deadline` is `confirmed_at + 14 days` unless set. Numbers `{order number}-R{n}` are assigned by the database.
- *Refunds.* Recorded once, after approval and before the return ends; the returns of an order together never above what was
  captured on it (the order's total when nothing was recorded); a Stripe refund (`refund_id`) must be one of the same order, for the
  amount recorded, and pays one return only. A refund of 0 closes the return as `no_refund`.
- *Withdrawal requests.* Start `pending` for a paid order (`paid`, `fulfilled`, `closed`), confirm once and before `expires_at`
  (24 hours), with at least one line; a confirmed request keeps its words (name, email, lines, times) and takes only its
  acknowledgement, which is never taken back and never before the confirmation. `commerce.expire_withdrawal_requests()` deletes
  unconfirmed requests past their time and returns the count; a confirmed request is never deleted.
- *Whole order (delivery refund).* A `withdrawal` return that, with the order's **other withdrawals whose goods are settled**
  (back, refunded, or never sent; earlier or later made), takes **every line of the order** in full refunds the original standard
  delivery, less what other returns already gave back of it (`returns.shipping_refund_minor`, set in the same transaction as the
  refund; the database refuses more than the order's delivery in all). A line the law excludes that stays with the shopper makes the
  withdrawal partial, so no delivery is refunded. A voluntary return does not refund delivery by itself (staff may raise the amount
  with a reason). So whichever of two withdrawals completing an order is refunded first, once the other's goods are settled, carries
  the delivery, and one whose partner is still on its way waits for it (the delivery is not paid for an order whose goods are not
  all accounted for).
- *Partial quantities.* `floor(T x n / Q)` cumulative per line (`src/lib/return-refund.ts`): the odd minor units fall to the
  last units, so any split of a line over returns adds up to its total exactly and never to more.
- *Return shipping.* `returnShippingMinor` is what the store paid for a label it charges the shopper for; it is 0 when the
  shopper sends the goods back themselves. It is taken off only when `who_pays_return` is `shopper`.

`return_events` is not a table: history is `order_events` with types `return.requested`, `return.confirmed`,
`return.approved`, `return.declined`, `return.in_transit`, `return.received`, `return.inspected`, `return.refunded`,
`return.closed`, `return.cancelled`, `return.refund_overridden`, each with `{ returnId, number, … }`.

## Emails (`email-text.ts`, hand-written nb/sv/da/en, others through the catalogue)

Withdrawal acknowledged (the durable medium), return approved (instructions, address, who pays), return declined (reason),
return received, return refunded (amount, when), refund overdue reminder to staff (to the store's contact email, once).
Each in the order's language; each kept in `email_messages`; each idempotent by key (`return.{id}.{event}`).

**As built (server: `withdrawals.ts`, `returns.ts`, `return-settings.ts`, `return-emails.ts`, `return-jobs.ts`).** Where the above left
room, the server decides it this way (tests: `src/server/returns.int.test.ts`):

- *Access and matching.* A shopper's order is found by its number (spaces and case ignored) of the store's own, non-copied orders,
  shown by the email on the order or its customer, **or** by the order page's key (the payment's reference), **or** by being the
  signed-in customer (`matchOrder()`); the number alone never. A mismatch of any kind is `{ ok: true, matched: false }`, the same
  value after the same delay floor (`DELAY_FLOOR_MS`). The order's own email is handed back (to prefill the form) only to a visitor
  who proved the order by key or by being signed in. Unmatched attempts are not recorded anywhere (no IP, no cookie), so the limits
  below count what exists: pending and confirmed requests by order, by email and by store in the last hour
  (`WITHDRAWAL_LIMITS`: 5, 10, 300; a voluntary return: 5 open per order, 10 per email, 300 per store).
- *Step 1 is idempotent.* The same statement (order, email, name, lines) made again is the same pending request, not a second row.
  The request keeps the order's language and market, not the page the shopper used.
- *Step 2.* The period is judged as it stood when the statement was made (`submitted_at`), so a day passing between the steps never
  takes the right away. A line declared that has since become excluded is a declined line (`excluded_by_law`); anything else no
  longer withdrawable refuses the confirmation (`not_available`) and nothing is written. Confirming twice returns the first result.
  The events written are `return.confirmed` (actor `shopper`) and `return.approved` (actor `system`, `automatic: true`).
- *The acknowledgement* names the return's number as its reference (the email's own id is not known until it is kept);
  `acknowledgement_reference` holds the `email_messages` id. "Sent" is `sent` or `logged` (kept, no email provider set up yet). When
  the order's own address differs from the shopper's, it gets a copy. A failed hand-over leaves the withdrawal standing as *not sent*;
  `resendAcknowledgement()` (staff) and the five-minute job (every 5 minutes, up to 3 days after confirmation, up to 6 attempts) send it
  again by keys of their own and set `acknowledged_at` only the first time.
- *Cron.* Daily: `expireWithdrawalRequests()` (also in `subscription-reminders`). Every five minutes: `runReturnJobs()` emails the
  store's contact address once per return when a withdrawal's refund is past its deadline (kind `return.overdue`, key
  `return.{id}.overdue`; that email is the only "mark": the queue's *Overdue* is read from the clock) and retries unsent acknowledgements.
- *Steps.* Each step locks the return, checks `canMove()` and writes its event with the account (`data.by`). A line decision is
  `return.declined` with `data.scope = 'line'`. Closing a withdrawal with no refund needs `confirmNoRefund`. An inspected return can only be
  closed (the lifecycle table has no `inspected -> cancelled`). Inspection needs a condition on every accepted line and a deduction no
  more than the units' value.
- *Refund.* `refundReturn()` works the sum out again from what is stored (it never trusts the screen's number), bounds the staff's
  amount by `reviewOverride()` and by what is left (Stripe's refundable and what the order's returns may still take), and calls
  `refundOrder()` with the return's id: `RefundOptions.inTransaction` writes the return's refund columns in the same transaction as
  Stripe's refund row and the restock, `outside` records a refund made outside Kaizen's Stripe (only stock goes back). **The refund
  is claimed first** (`returns.refund_claimed_at`, taken before Stripe is called by a guarded update, released when it is recorded or
  fails, taken over after 2 minutes), so two members pressing *Refund* at once cannot both pay it, and Stripe's `idempotencyKey` is
  the return's alone, `return-refund:{id}:{n}` with `n` the refunds of this return Stripe reported as failed (kept in the order's
  history): neither the amount nor the order's other refunds are in it, so a retry after Stripe took the refund and the database
  did not replays that refund whatever else happened on the order, and a different amount cannot make a second one. A refund Stripe reports as failed is not recorded on the return. Units that go back
  into stock are the ones asked for, else the lines inspected as going back, never more than was returned or than is left to put back.
  The shopper gets one email (`return.refunded`); the order's own refund email is not sent as well.
- *Units on earlier returns.* A return's share of a line is counted after the units on counting returns **created before it**, so
  any split adds up exactly whatever order they are refunded in; the delivery goes with the return that completes the order.
- *Standard delivery.* `placeOrder()` keeps the cheapest standard delivery with the order (`orders.standard_shipping_minor`, in the
  order's currency): the market's flat rate as shown, free over its limit judged **on the basket before discounts** as checkout does
  (the renewal copies it from the first order). A withdrawal of the whole order gives back no more delivery than that, whatever a
  carrier's dearer service cost, in a converted view as in the country's own currency. An order placed before it was kept falls back
  to the flat rate of its own currency (basket before discounts); with another currency and no record, all that was paid counts.
- *Order emails.* The confirmation and the shipped email of a consumer's goods carry the right to withdraw, **who pays for return
  shipping as the order was sold** (`orders.return_cost_payer`, from the setting when the order is placed), and a link
  (`withdrawUrl()`, `src/server/withdraw-link.ts`): `/s/{store}/{market}/withdraw?order={number}&key={the order page's key}`; the page
  reads `order` and `key` and calls `lookupWithdrawableOrder()`.

**As built (admin: `/admin/{store}/returns`, `/returns/{id}`, `/settings/returns`, the order page, the control center).** Where the above left room,
the admin decides it this way (pure words in `src/lib/return-admin.ts`, views in `src/components/admin/returns/`, actions in
`returns/actions.ts` and `settings/returns/actions.ts`; tests beside them and `src/server/returns-admin.int.test.ts`,
`returns-actions.int.test.ts`):

- *Queue.* A GET form (status, kind, search, "past the refund deadline") whose state is the address (`?status=&kind=&q=&overdue=1&page=`, read by
  `returnQueueFilter`), four figures that link to the filtered queue (open, to approve, past the deadline, acknowledgement not sent) and a
  sentence that leads with what the law makes urgent. Each row carries `DueMark`: the refund's mark from `refundDue()` (*Refund due by*, *Refund
  overdue by n days*, *Waiting for the goods*, *Past the refund deadline, still waiting for the goods*) in alert colours only when past the
  deadline. No count badge in the tabs: that needs a query in the store layout on every page; the store Home and the control center carry it.
- *Detail.* Everything offered comes from `detail.actions` (`actionsFor()`), so a step the lifecycle forbids is never shown. A refused step shows the
  server's own sentence. Until the refund is recorded, an inspected return can still be corrected (the server allows it). The *Decline a
  line* form is offered for a line of a voluntary return and for a line the law excludes; a line with the right of withdrawal has none. The
  working is `refundFor()`'s, shown before the button; with the shopper paying return shipping the screen asks the server for the sum again
  (`recalculateRefundAction()`, the same `previewRefund()`), and the refund works it out once more from what is stored. An amount other than the
  working needs a reason (`reviewOverride()`); the amount is typed in the order's currency (`parsePrice()`), never a float.
- *Every step* is a server action bound to the store's slug and the return's id: `requireMember()` first (a store the account is not in is a 404;
  the return is looked up by that store's id, so another store's return is "no longer exists"), the form read into the shape the server's schema
  checks again, a `commerce.audit_log` row (`return.approved`, `return.declined`, `return.line_declined`, `return.instructions_changed`,
  `return.in_transit`, `return.received`, `return.inspected`, `return.refunded`, `return.closed`, `return.cancelled`, `return.note_changed`,
  `return.acknowledgement_resent`, `returns.settings_saved`; never the instructions' text) and `refresh()`. Every member works the queue; the rules
  are the owner's (the page shows them read-only to everyone else, and the action refuses).
- *Settings.* `commerce.return_settings.instructions_translations` (jsonb, `{ "sv-SE": "…" }`, migration `returns_instructions_i18n`, which also
  patches `clone_store()` and `duplicate_store()` to copy it) holds the instructions in the store's other languages. They are written on the
  settings page or accepted from the store translation (scope `returns`, unit `returns:instructions`, a *legal* unit: listed apart and unticked
  until read). `instructionsIn(main, translations, locale)` (`src/lib/return-instructions.ts`) is the one way to read them for a shopper: the
  translation, else the main language's. **Not yet used by the emails and the withdrawal page**: a return copies `settings.instructions` (the
  main language) onto itself when it is made, so whoever shows a return's instructions in the order's language reads the settings' translation
  while the return's own text is still the settings' text, and the return's own text when staff changed it.
- *Order page.* A card with the returns made on the order (each linking to its screen), where the order stands in time (`windowSentence()`, from
  `withdrawalWindow()` and `orderEligibility()` through `orderReturnsOverview()`) and the customer's withdrawal page for the order's market,
  without the order's key. The order's history says a return's steps in words with a link (`eventSentence()`).
- *Attention.* `StoreFigures.returns` (overdue, unacknowledged, requested), counted for all stores in one query (`returnAttention()`, with the
  queue's own `OVERDUE_SQL`), makes `attentionFor()` list, urgent first: withdrawals past the legal refund deadline, acknowledgements not sent,
  then return requests waiting for an answer. It shows on the store Home and the owner's control center for every member.

**As built (shopper: `/withdraw`, `/returns/{token}`, the footer, the order pages).** Where the above left room, the shopper's side decides it
this way (pure parts in `src/lib/withdraw-form.ts`, pieces in `src/components/withdraw/`, the page, its one action and its form in
`src/app/s/[store]/[market]/withdraw/`; tests beside them, `withdraw/actions.int.test.ts` and `e2e/withdrawal.spec.ts`):

- *One form, one action.* `/withdraw` is a single `<form>` whose buttons say what they do (`intent`: `start`, `confirm`, `edit`, `return`) and one
  server action, `withdrawAction()`, which reads the form, calls `withdrawals.ts` and answers with a `WithdrawState` the page draws
  (`form` / `confirm` / `done`). Nothing is kept between the steps in the browser: the state travels in hidden fields (name, email, order number,
  the order key, the pending request's id), so there is no cookie and no storage (a test scans the source for both). The form calls the action from a
  transition, so a failed check keeps what was typed (the admin's `ActionForm` does the same, but it is English-only and red-on-white, so the shopper's form has its own copy of the
  technique). Focus follows the step: to the message if there is one, else to the new step's heading (`tabIndex -1`); errors are `role="alert"`, the
  matching notice is `role="status"`, each field's hint and error are tied to it by `aria-describedby`, and an invalid field is `aria-invalid`.
- *Step 1 with no lines shown.* A stranger who types name, email and order number is not shown the order's lines before the order is found (that
  would tell whether it exists). The action checks the fields, finds the order, declares **everything that can be withdrawn, in full**, and answers
  with step 2, which lists it and offers *Change what I withdraw* (back to the lines, which are then known, with the choice kept). Opened from the order
  page's link (`?order=&key=`) or by a signed-in customer, the page has already shown the order is theirs (`lookupWithdrawableOrder()`), so step 1
  lists the lines, all ticked, with a number each. A key that does not match, or no key, is just the plain form with the number filled in.
- *No difference a stranger can see.* A wrong email, a wrong number, another store's order, a wrong key: the same state (`notice: "unmatched"`), the same
  sentence, after the same floor (`DELAY_FLOOR_MS`, applied by the action over both calls it makes, so a match, which does more work, is not slower).
  A mismatch is information (`role="status"`) and says where to look and how to reach the store (the contact address the footer already shows).
- *Not withdrawable.* A matched order whose lines cannot be withdrawn shows every line with its plain reason (`m.returns.refusal.*`, and for an excluded
  line which exclusion), where the order stands in time (`windowNote()`), and, when the store's own window takes the goods back, the **return request**:
  its lines, a reason from the list (optional), a note, and the sentence that statutory rights for faulty goods are not affected. A sent request shows
  its number and a link to its status page.
- *The confirmation page* shows the acknowledgement exactly as emailed (the server returns its text) with its reference (the return's number), the day
  to send the goods back by, the latest refund day and the sentence that the store may wait for the goods. If the email could not be handed over, it says
  so and that the withdrawal stands.
- */returns/{token}* reads `getShopperReturn()`: the steps, the lines (a declined line with its reason, a system reason in the shopper's language), what to
  do and where to send it, who pays, the refund when there is one. Read only, `noindex` and `referrer: no-referrer`, the order number and nothing about the
  shopper; an unknown token is a 404 (so is another store's).
- *The footer.* `withdrawal` is a site part (`SITE_PARTS`, a store's only): the standard footer and `defaultFooter()` hold it; `siteLayoutProblem()` refuses a
  store's footer without it, and without it shown on phones (`footerHasWithdrawal()`: in a row of the page's flow, not hidden on phones); and the market
  layout draws the standard link under any footer that does not have it, so footers saved before the function existed are covered too (`WithdrawalStrip`).
  The builder offers no *Hide on phones* for it.
- *The order pages.* The order page (`OrderDetails`, the standard page only) and My account's order page hold `OrderReturns`: the button *Withdraw from the
  contract or return goods* for a paid order of goods for a consumer (with the order page's key in the link; My account's link has the number and the
  signed-in customer is the proof) and the order's returns, each linking to its status page. A store's own order page built from pieces has no such
  piece yet; its footer link and the order emails still lead to the function.
- *Reserved addresses.* `withdraw` and `returns` are reserved store page slugs (`RESERVED_STORE_PAGE_SLUGS`, the `pages_store_slug_not_reserved` check,
  migration `reserve_withdraw_slug`; a test requires every route directory of a market to be reserved). **Before applying that migration to production,
  check no store has a page at `/withdraw` or `/returns`** (`select … from commerce.pages where store_id is not null and type = 'page' and slug in
  ('withdraw','returns')`): the check would fail on it, and the owner needs to move it first. Both are working paths where no modal opens by itself,
  and neither is a landing page that visit counting keeps (`(other)`).
- *Search engines.* Neither page is a published page, so neither is in a sitemap or `llms.txt`; both are `noindex`.
- *Texts.* Everything the shopper reads here is `m.returns.*` in `src/lib/i18n.ts`, hand-written in nb, sv, da and en (other languages come from the
  catalogue, D111, and fall back to English key by key; none of it uses `CHOOSING`, because nothing chooses by a number or a yes/no). The button texts
  follow the directive's own: *Withdraw from contract here* (nb *Angre avtalen her*, sv *Ångra avtalet här*, da *Fortryd aftalen her*) and *Confirm
  withdrawal* (*Bekreft angrer*, *Bekräfta ångrande*, *Bekræft fortrydelse*). **They need legal review before real use**, like the emails.
  The instructions a store wrote for returns are not on the withdrawal page: they reach the shopper in the acknowledgement and on the return's status
  page (the return's own copy, in the store's main language until the translated instructions reach the return, see the admin note above).

**As built (analytics, the AI manager, structured data, the chat agent).** Where the above left room, these decide it this way (tests beside
them, `src/server/analytics-returns-data.int.test.ts`, `return-tools.int.test.ts`, `stores-return-policy.int.test.ts`):

- *Analytics* (`docs/analytics.md` "Returns" defines every figure; `src/lib/analytics-returns.ts` pure, `src/server/analytics-returns-data.ts`,
  `ReturnsView` under Refunds on the Traffic page). Rates are of the cohort of paid orders with goods placed in the period, whenever their returns
  were made, and need minimum volumes (`MIN_RATE_ORDERS` 30, `MIN_RATE_UNITS` 30, `MIN_PRODUCT_UNITS` 20, `MIN_REASON_SAMPLE` 10,
  `MIN_TIMING_SAMPLE` 5); a store with no return recorded shows what is missing, never 0 %. The page says that returns made without the function
  are not seen, that the rates are still rising while the period is inside the store's window, and that a withdrawal asks for no reason (so
  "No reason given" is its own row). Copied and hosts' orders never count; the overdue count is the queue's own `OVERDUE_SQL`.
- *The AI manager* (`src/lib/return-tools.ts` pure, `src/server/return-tools.ts`, the four tools in `OWNER_TOOLS`, so the store's MCP server serves
  them): `list_returns` and `explain_return` read the queue and one return as the admin's screens do (`listReturns()`, `getReturn()`; amounts by
  `formatMoney`, dates and "due" words by `return-admin.ts`, nothing worked out by the model). `approve_return` and `decline_return` are gated
  `send` (they email the shopper) and answer only a voluntary return that waits for an answer; both are checked before they are kept
  (`preflightOwnerTool()`): a **withdrawal is refused at once** (approve: it starts approved; decline: the right is not the store's to refuse),
  an unknown or another store's return is refused, and the words the customer is sent (`instructions`, `note`, `reason`) pass `findClaims()`.
  There is **no tool that refunds a return**: receiving, inspecting and refunding stay on the return's page, and the tool says so. The playbook is
  the `handle-return` skill; `handle-refund` points to it.
- *Structured data.* `Store.returnPolicy` (`ReturnPolicyFacts`, read with the store from `return_settings`, the legal default when the store
  has no row) feeds `MerchantReturnPolicy` (`returnPolicy()` in `src/lib/structured-data.ts`): `merchantReturnDays` is the store's window (never under
  the legal 14), `returnFees` is `FreeReturn` when the store pays and `ReturnFeesCustomerResponsibility` otherwise, and goods the law excludes say
  `MerchantReturnNotPermitted` unless the store takes those back too (`accept_excluded`); downloads and services always say no returns. Saving the
  settings must `updateTag(storeTag(slug))` (the settings action does).
- *The chat agent.* `store_info` carries `returns` (`returnFacts()` in `src/lib/chat.ts`): the legal 14 days, the store's own window, who pays
  return shipping, whether excluded goods are taken back, and the withdrawal page's address, all from the same `Store.returnPolicy`, never from the
  model. Faulty goods are said to be a separate matter.

## Open points that need a human legal check (from the review of this decision)

None of these is settled by code; each is said where it matters and is for the store's lawyer before real use.

- **Information given before the contract (CRD Art. 6(1)(h), (i)).** The app does not record that the model withdrawal information
  was given, so it never says the period is over as a fact (the period is up to 12 months, Norway 3 months, longer without it), and
  staff register such statements as *accepted as in time*. Who pays return shipping is kept with the order and said in the
  confirmation email, but **the checkout page does not yet state it** before the purchase: a store whose terms do not carry it should
  set *the store pays* (an order with no record counts as the store paying).
- **Services and appointments (Art. 16(l), 16(a)).** Bookings are not withdrawn through the function (they are cancelled or moved
  from the order, D66); an ordinary appointment that is not a leisure activity may still carry a withdrawal right until performed.
  Staff handle such a statement through *Register a withdrawal*.
- **Sealed goods (Art. 16(e), (i)).** The right is accepted from the start and the unsealing is for the inspection; the wording of
  the "while the seal is unbroken" lines in all four languages is hand-written and unreviewed.
- **Receipt (Art. 9(2)(b)).** The period starts from the receipt staff record; until then the right is open without an end. A
  carrier's confirmed delivery should write it later; until it does a store that never records receipts has an open-ended right on
  its orders, which is the safe side of an estimate.
- **Deductions (Art. 14(2)).** Only the inspection can lower a withdrawal's refund, each with its note, shown to the shopper.

## What this deliberately does not do (said on the screens)

Return **labels** from carriers, **exchanges**, **defect complaints / the legal guarantee**, **photos** with a return,
**pickup of returns at the door**, **returning to a different location than the first**, and ending **subscriptions** are
later pieces. Refunds made only in Stripe are not seen (as in analytics, D152).

## Where things live

Pure: `src/lib/withdrawal.ts` (eligibility, windows, deadlines, reason list), `src/lib/return-refund.ts` (`refundFor()`),
`src/lib/return-status.ts` (lifecycle, labels, next steps). Server: `src/server/withdrawals.ts` (the function: start,
confirm, expire, acknowledge), `src/server/returns.ts` (queue, detail, transitions, inspect, refund through
`refundOrder()`), `src/server/return-settings.ts`, `src/server/return-emails.ts`. Shopper: `/s/{store}/{market}/withdraw`,
`/s/{store}/{market}/returns/{token}` (status), a *Withdraw* button on the order pages, a *Returns* list on My account's
order page, the standard footer link. Admin: `/admin/{store}/returns`, `/admin/{store}/returns/{id}`,
`/admin/{store}/settings/returns`. Also: the Returns section of analytics (reasons, rate, time to refund), AI manager
tools `list_returns` / `explain_return` (read) and gated `approve_return` / `decline_return`, `MerchantReturnPolicy` in
structured data from the settings, the control center's attention, `COPY_RULES` (`return_settings` is `settings`; the rest
`never`), `clone_store()` copying `return_settings`.
