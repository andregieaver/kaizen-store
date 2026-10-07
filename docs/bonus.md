# The bonus program (D130)

A store's signed-in customers earn **credits** on what they pay and use them as a price reduction on a later order.
Switched on by the owner under Sales → Bonus credits (`/admin/{store}/bonus`); off by default. Since D178 (`docs/store-features.md`) the
program also stands behind the store feature `bonus` (Settings → Features): the feature is the gate (the Bonus page, the customer's bonus
panel, the cart's and checkout's credits, My account's credits and the AI tools are there only while it is on), and the program's own
switch (`bonus_settings.enabled`) stays on the Bonus page, so the rules can be set up before shoppers see them. The program **works**
only while both are on: `commerce.bonus_program_on()` in SQL, `BonusProgram.on` in code. The contract shared by the
screens and the server is `src/lib/bonus.ts`; the rules are in SQL (`commerce.bonus_*`, migration `bonus_program_rules`);
the engine is `src/server/bonus.ts`; checkout uses it from `cartSummary()` and `placeOrder()`.

## The owner's decisions (final)

- **Money credits** in the store's main currency, kept as integer minor units. The currency is pinned in
  `bonus_settings.currency` when the program is first saved (the store's own country's currency then), so a balance never
  changes currency under a customer. A market shown in another currency (D109) sees them converted at the store's rates;
  the ledger never holds a converted amount.
- **Earned**: `earnBps` (5 % by default) of what was **paid online for goods**: order lines' totals (VAT included) less the
  part left for a venue (D66), so without shipping, without credits used on the order and without what is paid at the
  venue. Sign-up fees are lines and count. Rounded down. Only for signed-in customers, never on a copied order (D129), a
  host's order (D71, the credits are the store's) or a free gift line (its total is 0).
- **Pending, then usable**: a grant is usable `pendingDays` (14) after payment, then until it expires.
- **Used** as a price reduction on goods, **last**: after campaigns (D114), the group's discount (D108) and codes (D31), at
  most `maxRedeemPercent` of those goods, at least `minRedeemMinor`, never more than the customer has and **never so that
  less than the payment provider's smallest charge is left to pay** (`MIN_CHARGE_MINOR`: Stripe's minimum per currency).
  Nothing comes off shipping, sign-up fees, a subscription's own lines (its first charge and renewals) or what is left
  for a venue: credits are taken off the part of a line that is paid online, so a deposit's venue balance does not change.
- **Refunds and cancellations** take back what the refunded part earned (never below zero: what was used stays used) and
  return the used credits by the refunded share.
- **Expiry** is optional (`expiresMonths`, counted from when a grant becomes usable), oldest credits first, with one
  reminder email per customer and expiry date, 14 days ahead.

## Tables

| Table | What |
|---|---|
| `bonus_settings` | one row per store: the settings above and the pinned currency; none means defaults, program off |
| `bonus_entries` | the append-only ledger: `earn`, `redeem`, `restore`, `reverse`, `expire`, `adjust`; signed `amount_minor`; `order_id`, `refund_id`, `available_at`, `expires_at`, `note`, `created_by`, and an **idempotency key unique per store** |
| `bonus_allocations` | which lot each negative entry took from (append-only) |
| `orders.credit_minor` | credits used, in the order's currency; **part of `discount_minor`** (so `total = subtotal + shipping − discount`) |
| `order_lines.bonus_discount_minor` | each line's share, part of the line's `discount_minor`, so VAT and refunds agree |
| `orders.bonus_earned_minor`, `bonus_available_at` | what it earned (order currency, before conversion) and when it is usable; set when paid |
| `carts.bonus_request_minor`, `bonus_request_currency` | what the shopper asked to use (only a request) |

`OrderView.discountMinor` leaves the credits **out** (`OrderView.creditMinor` and `OrderView.bonus` carry them, all in the
order's currency); `cartSummary().discountMinor` does the same (`bonusMinor` is the credits), so discounts never show twice.

## The ledger and its invariants

A positive entry is a **lot** (credits usable from `available_at`, until `expires_at`). A negative entry is paid out of lots
through `bonus_allocations`, usable lots first, **the one expiring first, then the oldest**. What is left of a lot is its
amount less its allocations; a balance is computed from the ledger, never stored:

- `available` = what is left of lots with `available_at <= now` and not expired; `pending` = what is left of later ones;
  `balance = available + pending`. Expired credits stop counting at once, before the job writes their `expire` entries.
- `bonus_verify(store, customer)`: the sum of the entries equals what the lots hold, and no lot is over-allocated.
- **A balance cannot go negative**, whatever writes: a trigger refuses an allocation beyond its lot, and a deferred
  constraint trigger refuses a negative entry not paid in full out of lots by the end of the transaction.
- The ledger is **immutable** (trigger: no update, no delete except when the customer is deleted, which cascades their
  ledger and allocations away). Tests that need time to pass pull that trigger (`ageBonus()` in the tests).
- Every writer is a `commerce.bonus_*` function that first takes the **customer's row lock**, so concurrent checkouts,
  refunds and expiry for one customer are serialised; `bonus_take` refuses rather than overdraw (`p_exact`).
- Each grant, use, return and expiry carries an idempotency key (`earn:{order}`, `redeem:{order}`, `restore:{refund}`,
  `reverse:{refund}`, `expire:{lot}`, `restore-unpaid:{order}`, …): applying it twice changes nothing.

## Flows

**Cart → order → Stripe → payment → refund** (all amounts in the order's currency unless said; `U` credits used, `P` paid
online, `G` granted):

1. *Cart* (`cartSummary()`): eligible per line = goods bought once that are due online after campaigns, group and code
   (`today − lineDiscount − venue`); `redeemLimit()` clamps the request; the credit is spread over the lines by largest
   remainder (`allocateCredit`); VAT is worked out on each line after its credit; `total = subtotal + fees + shipping −
   discount − credits`; `dueNow = total − venue balance`.
2. *Placing* (`placeOrder()`): the same arithmetic under the customer's row lock (taken when the cart asks for credits), the
   request brought down to what they still have; `orders.credit_minor`, lines' `bonus_discount_minor`; the ledger gets a
   `redeem` entry of the credits-currency amount (`debitFor`: rounded up, capped at the balance) **held against the pending
   order**; the cart's request is set to what the order used.
3. *Stripe* (`startCheckout()`): credits are part of the same one-time coupon as codes, groups and campaigns
   (`discount.couponMinor`, named with the store's bonus label), so Stripe charges `dueNow`; with a deposit or a venue
   part each line is sent as what is due now and the credits are inside it. `payment_method_types` is never passed.
4. *Paid* (trigger on `orders.status`, so every path: webhook, return page, venue confirmation, renewals, late
   payment): the order earns `G = floor(Σ(line total − venue) × bps / 10 000)` converted (rounded down) into the credits'
   currency, `available_at = paid_at + pendingDays`, once; nothing for a guest, a copy, a host's order, a program that is
   off by then (its own switch or the store feature, D178), or a base that rounds to 0. The used credits simply stay used.
5. *Unpaid* (`cancel_unpaid_order`, checkout expiry, a replaced checkout, or the job below): the held credits come back as
   a `restore` lot usable at once. If the payment arrives **after** the order was cancelled, the credits are taken again
   as far as the customer still has them; a shortfall is the store's and is noted as a `bonus.short` order event.
6. *Refund* (trigger on `refunds`, status not `failed`): with `R` refunded in all and `P` paid online, `reverse` takes back
   `floor(G·R/P)` of the grant (all of it when `R ≥ P`) less what was already taken, capped at what is left of that lot;
   `restore` returns `floor(U·R/P)` of the credits used, less what came back. Cumulative, so any cutting of refunds adds up
   to the whole. Cancelling a paid order (`cancelOrder` refunds, then cancels) takes back what is left of the grant and
   returns what is left of the credits used.

Stripe invoices (when the store has them on) show the credits as the coupon's discount line. There are no separate
credit notes for shop orders (Work's invoices and credit notes are a different thing).

**Expiry and reminders** (`runBonusJobs()` in the five-minute cron): `bonus_expire_due()` writes an `expire` entry for each
lot past its date (what is left of it); customers with credits expiring within 14 days get one email per customer and expiry
date (`sendBonusExpiryEmail`, idempotency key `bonus-expiry:{customer}:{date}`, skipped for opted-out emails and when the
program is off); unpaid orders holding credits for more than 2 hours are cancelled, which gives the credits back.

**Expiry pauses while the program is off** (D178): `bonus_settings.paused_at` is set when the program stops working (its own
switch, or the store feature `bonus` with what it needs) and cleared when it works again, by the database (`bonus_settings_pause`
on the settings, `stores_features_after()` → `bonus_pause_sync()` on the store's features), whatever path made the change. While
it is set, `bonus_expire_due()` writes nothing off for the store and `bonus_expiring()` reminds nobody. When the program comes
back on, `bonus_resume()` moves every lot whose date passed during the pause: what is left of it is expired (key
`expire-paused:{lot}`, not counted as expired in the overview) and granted again as a `restore` lot of the same amount
(`resume:{lot}`, usable as before), expiring as long after its old date as the program was off, so the customer gets back
the time they could not use. Lots whose date is still ahead keep it. The ledger stays append-only and every balance whole.
Programs that were off when this came (migration `store_features_customers_rules`) start their pause then.

**Staff** add or remove credits with a reason (`adjustBonus`): adding is usable at once and follows the store's expiry;
removing takes usable credits first and never goes below zero. Audited (`customer.bonus_adjusted`). Settings changes are
audited (`store.bonus_settings`) and never touch what was already earned.

## Copying a store (D129)

`bonus_settings` is copied (`duplicate_store()`); the ledger never is: customers' balances stay with the original store.

## Not in v1

- **Subscription renewals redeeming.** Renewals earn when paid (on their lines, not shipping) but cannot use credits; the
  first order can use them on goods bought once next to the subscription.
- Tier multipliers (higher earn rates per customer group), transfers between customers, credits as gift cards, credits on
  shipping, reminders in the customer's own currency preference.
- Refunds made directly in Stripe's Dashboard: Kaizen has no refund webhook, so such a refund is not seen and credits do not
  move; refund from the order page (`refundOrder`), which records the refund and so moves the credits.
- A refund that changes status to `failed` after it was recorded does not put the credits back (nothing updates refund
  statuses today; a new failure path must call `commerce.bonus_refund_applied` logic in reverse).
- Customers' credits in a data export: there is no customer data export to put them in; deleting the account removes the
  ledger.
