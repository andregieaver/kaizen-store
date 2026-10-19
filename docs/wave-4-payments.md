# Wave 4: payments (decisions D288 to D293)

The contract for wave 4 of `docs/parity-plan.md`: what Kaizena Flow does with money after the shopper presses pay, which methods a store offers, and a
second payment provider. Written on 2026-10-19 from the wave 4 rows of `docs/parity/rows`, the plan, CLAUDE.md, D15 to D23, and a read of the payment
code at commit `dbb3bce` (where things live is in section 9). Code, tests and texts follow this file; a unit that must deviate says so here first.

**Decision 1 of the plan is made (2026-10-19, the owner: "start wave 4 and add Mollie").** Kaizena Flow keeps Stripe as every store's default
provider and adds **Mollie** as a second one, behind one payment-provider adapter. Mollie brings what Stripe will not give a platform taking direct
charges: PayPal, Vipps (NOK), Swish (SEK), and MobilePay outside Stripe's preview, besides iDEAL, Bancontact, BLIK, EPS, Przelewy24, Klarna and cards.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A | D288 | What a Stripe payment was: its method and wallet, Stripe's risk outcome, disputes and their deadlines; the payments report by method; a risk filter and rule | `analytics.payments-reports-by-method`, `checkout.fraud-analysis-and-risk-flags`, `checkout.chargeback-and-dispute-handling` |
| B | D289 | Authorise now, capture later (Stripe) | `checkout.authorize-then-capture` |
| C | D290 | Payouts and reconciliation: the store's Stripe balance transactions and payouts, real fees in profit | `analytics.payouts-and-reconciliation` |
| D | D291 | Methods per country: Kaizena Flow asks Stripe for iDEAL, Bancontact, BLIK, EPS, Przelewy24 and SEPA debit, shows each method's state, and the owner switches methods off per country | `checkout.ideal-bancontact-sepa-blik-eps-p24-and-other-local-methods`, `checkout.klarna`, `checkout.mobilepay`, `international.vipps-and-mobilepay` |
| E | D292 | The payment-provider adapter and Mollie (Connect by OAuth, hosted checkout, webhooks, refunds, Kaizena Flow's fee) | `checkout.third-party-and-multiple-payment-gateways`, `checkout.paypal`, `checkout.vipps`, `checkout.swish` |
| F | D293 | Payment terms for company accounts (net 15, 30, 60) | `checkout.b2b-payment-terms` |

Each unit is its own commit with its own migration(s), tests and decision row, shipped before the next starts. Unit E is the largest; it may be split
into E1 (the adapter, with Stripe behind it and nothing else changing) and E2 (Mollie).

## 2. Rules for every unit

1. **Money stays where it is told.** Amounts are integer minor units with a currency; a payment's money is read in the order's own currency and
   converted only for reports (`inMain()`/`toMain()`). Every new money read gets a euro scenario (`checkout-kinds.int.test.ts` where it touches the cart
   or an order, else the unit's own integration test).
2. **Nothing invented.** A method, a risk level, a fee or a dispute reason is shown only as the provider reported it; an unknown one is *Unknown*,
   never guessed or estimated without saying so.
3. **Webhooks are the source; reads are the safety net.** Each event is recorded once (`webhook_events`, dedupe by id), handled idempotently, and a
   job re-reads what an event may have missed. A webhook never trusts the body alone where the provider says to fetch (Mollie always).
4. **Copied orders, host orders and Stripe test-mode payments** keep their present rules: copied orders never pay, refund or count; host orders
   follow D71; test-mode money is labelled and kept out of the analytics that already leave it out.
5. **Never `payment_method_types`** on a Stripe session (D17, D23): methods are switched with the account's capabilities and the session's
   `excluded_payment_method_types`, so the store's Stripe Dashboard still decides what is on.
6. **Pay routes keep their policy** (D158, `docs/pci.md`): a new script, frame or connect origin is added to `checkoutCsp()` only with a reason in
   `docs/pci.md`. Mollie is a redirect to its hosted checkout: card data never reaches Kaizena Flow (SAQ A).
7. **Staff texts are English; shopper and email texts are nb, sv, da and en by hand**, and anything a law decides (payment terms, a due date
   reminder) is flagged for review (`HAND_WRITTEN_ONLY`).
8. **Every new table** is classified in `COPY_RULES` (payment facts, disputes, payouts: `never`), in `PERSONAL_DATA` or `NOT_PERSONAL`, and holds a
   `store_id` on every row.

## 3. Unit A (D288): what a payment was, and disputes

**Payment facts.** When a Stripe payment is captured, Kaizena Flow reads its charge once (`payment_intent.latest_charge`, through the store's
connected account) and keeps on the `payments` row: `method_type` (Stripe's `payment_method_details.type`: `card`, `klarna`, `mobilepay`, `link`,
`ideal`, …), `wallet` (`apple_pay`, `google_pay`, … from the card's wallet), `card_brand`, `risk_level` (`normal`, `elevated`, `highest`,
`not_assessed`, `unknown`) and `risk_score`, as Stripe gave them, with `charge_reference` (`ch_…`). The read is made in `after()` the payment, and
a job fills any captured Stripe payment still without facts (at most a few a run, oldest first, a day back). A payment Kaizena Flow cannot read keeps
nulls and is *Unknown*. Manual, venue and exchange payments keep their own `method` (cash, bank transfer) and are *Recorded by staff*.

**The payments report** (`/admin/{store}/analytics/payments`, section Analytics, `analytics:read`): per method for a period, the orders paid, the
money received (with VAT, in the main currency, said so), Stripe's fees where known (unit C) else the estimate (said so), and refunds; the rows add
up to the paid orders' money received in the same period, and an *Unknown* row holds payments without facts. CSV like every analytics table
(`ANALYTICS_TABLES`).

**Risk.** The order page and the list show Stripe's risk outcome for an elevated or highest one (a chip, *Stripe: elevated risk*), nothing when
normal or not assessed. The list filters by risk (`risk=elevated` meaning elevated or highest, through `orderListWhere()`), and an order rule may
hold an order whose risk is elevated or highest (`CONDITION_KINDS` gains `risk`). A refunded or disputed order shows both.

**Disputes.** `commerce.payment_disputes` (store, order, payment, provider, `provider_reference` `dp_…` unique per provider, amount and currency,
reason, status as Stripe's, `evidence_due_by`, `outcome` won or lost when closed, `funds_withdrawn_minor`, `fee_minor` where known, timestamps,
`reminded_at`). The connected-account webhook gains `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn` and `.funds_reinstated`;
older webhook endpoints are given the new events as subscriptions were (`ensureSubscriptionEvents()`'s pattern). A dispute is found by its charge's
payment intent; a dispute on a payment Kaizena Flow does not know is ignored and logged.

- The order page shows the dispute (amount, reason in words, status, evidence deadline in the store's time zone, a link to the dispute in the store's
  Stripe Dashboard where evidence is submitted); the list filters *Disputed*.
- Staff are emailed once when a dispute opens and once three days before the deadline (`order.disputed`, `order.dispute_due` as store events through
  `alertRecipients()`, no shopper's name or address in them, amounts in the order's currency).
- A lost dispute is money out: the finance analytics subtract it (and its fee where known) once, in the period it closed, as *Lost disputes*, never
  as a refund (no credit note, no restock). A won one clears the flag. A dispute on a copied or host order is shown but never counted.
- Refunds made in Stripe's Dashboard are already recorded (D159, `applyStripeRefund()`), which this unit's dispute criterion names; nothing new.

## 4. Unit B (D289): authorise now, capture later

A store setting *Take payment when* (`order_settings.capture`: `at_checkout` default, `when_sent`, `by_hand`) makes Stripe sessions for goods use
`capture_method: manual`. A paid session then leaves the payment `authorized` and the order `authorized` (a new status between `pending_payment` and
`paid`), its stock still held (never drawn, never released), and it counts nowhere as sales. Staff capture the whole amount or less from the order
page (or, with `when_sent`, the first parcel captures the whole); `capturePayment()` calls Stripe, and `commerce.complete_order_payment()` runs then,
as for an automatic payment (invoice, stock drawn, emails, analytics from that day). An amount captured below the authorised releases the rest
(an order change, D174, is the way to sell less). An authorisation Stripe voids or lets expire (7 days for cards; the job checks `capture_before` a day
ahead and tells staff) cancels the order and releases its stock (`commerce.cancel_unpaid_order()`). Subscriptions, deposits, bookings, weekly boxes,
drafts and pay links keep capturing at once (said on the setting). Methods that cannot be captured later are captured at once by Stripe; the order
then simply becomes paid.

## 5. Unit C (D290): payouts and reconciliation

Kaizena Flow reads each store's Stripe payouts (`payout.created`, `.updated`, `.paid`, `.failed` on the connected-account webhook, and a daily read
back 30 days) and each payout's balance transactions, into `commerce.payouts` and `commerce.payout_lines` (charge, refund, dispute, fee, adjustment,
with the payment or refund each settles where known). The store's *Payouts* page (Analytics) lists payouts with date, amount, fees and what they
settle, flags one whose lines do not add up to it, or which holds money Kaizena Flow cannot tie to an order, with the difference, and exports to CSV.
Each Stripe charge's real fee (`balance_transaction.fee`, Stripe's and Kaizena Flow's application fee told apart) is kept on its payment, and the
finance analytics use real fees where every payment of the period has one and say *estimated* otherwise (`costCoverageOf()` style: how much of the
period's money has real fees). Amounts in the payout's currency; the page converts to the main currency only for totals, with the euro scenario.

## 6. Unit D (D291): methods per country

`PAYMENT_CAPABILITIES` gains `ideal_payments`, `bancontact_payments`, `blik_payments`, `eps_payments`, `p24_payments` and `sepa_debit_payments`; Kaizena
Flow requests them for every store account as it does today (D23), and shows on the Payments page each method's state as Stripe reports it
(requested, active, pending, inactive with Stripe's reason). The unused `commerce.payment_methods` table (per store, market and method) becomes the
owner's switch: a method switched off for a country is passed as `excluded_payment_method_types` on that country's sessions (never
`payment_method_types`), so a checkout offers only what is both on in Stripe and on for the country. Klarna and MobilePay are in the same list.
Delayed methods (SEPA debit) keep the order `pending_payment` with its stock held until `checkout.session.async_payment_succeeded` (already handled),
and release both on `async_payment_failed`; the order page says *Waiting for the bank*. Subscriptions say which methods they take (cards and SEPA
debit, as Stripe allows). Tested: a session for each country and currency excludes exactly the methods switched off (a fake Stripe records the
request), and a delayed payment's success and failure.

## 7. Unit E (D292): the provider adapter and Mollie

**The adapter.** `src/server/payment-providers/` holds a `PaymentProvider` (`id`, `openPayment()`, `readPayment()`, `refund()`, `capture?()`,
`handleWebhook()`, `methodsFor()`), with `stripe.ts` wrapping the present code and `mollie.ts` the new one. Checkout (`openPaymentSession()`), the
order page's late read (`getShopperOrder()`), refunds (`refundOrder()`, `splitRefund()`'s provider type) and the jobs that settle sessions ask the
payment's provider through the adapter; `payments.provider` gains `mollie`. Stripe stays exactly as it is underneath: E1 moves code, E2 adds Mollie.

**Connecting Mollie.** Kaizena Flow registers one Mollie app (OAuth; `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET` in the environment, like Stripe's
platform keys). On the Payments page the owner presses *Connect Mollie*, signs in at Mollie and approves Kaizena Flow; Kaizena Flow keeps the refresh
token encrypted (`SETTINGS_ENCRYPTION_KEY`, never shown again) in `commerce.mollie_connections` (store, organisation, the chosen profile, mode, scopes,
connected and revoked times), never a password. Scopes: `payments.read payments.write refunds.read refunds.write profiles.read profiles.write
settlements.read balances.read organizations.read onboarding.read`. Test mode is the same connection with `testmode: true` (D20's spirit: test
payments need nothing more from the owner).

**Which provider pays.** A store chooses its checkout provider on the Payments page: Stripe (the default) or Mollie, per mode. One provider per store
in this unit; mixing per method is for later. Everything already paid stays with the provider that took it: refunds, disputes and reads always go to
the payment's own provider.

**Paying with Mollie.** The cart's checkout button places the order as today (stock held), then creates a Mollie payment through the Payments API
(never the Orders API): amount and currency as `"123.45"` from minor units by code, `description` the order number, `redirectUrl` the order page,
`webhookUrl` `/api/mollie/{mode}`, `metadata` the order and store ids, `locale` the market's, the billing address, `lines` (each order line with VAT,
needed by Klarna and Billie, the totals equal to the amount by the same rounding as the invoice), `profileId` and `applicationFee` (Kaizena Flow's
sale fee for the store, in the payment's currency, never above Mollie's limit: the fee is capped and the cap logged). The shopper pays on Mollie's
hosted checkout and returns to the order page, which reads the payment once if the webhook has not come. The webhook carries only an id: Kaizena
Flow fetches the payment with the store's token and applies `paid`, `failed`, `canceled`, `expired` as `applySession()` does for Stripe (one
function decides an order's fate from a provider-neutral answer). Stock is held for Mollie's longest open payment (bank transfer is not offered in
this unit, so 35 minutes still holds).

**Refunds and disputes with Mollie.** `refundOrder()` refunds a Mollie payment through the Refunds API (with an `Idempotency-Key`), the webhook updates
its status, and a refund made in Mollie's Dashboard is recorded like a Stripe one. Kaizena Flow's application fee is **not** returned on a Mollie
refund (Mollie's rule): the store is told before it connects. Chargebacks are read from the payment on its webhook and kept as unit A's disputes.

**Methods.** The Payments page lists what Mollie has active for the store's profile and amount per currency (`GET /v2/methods` with an amount, so NOK,
SEK and DKK methods are listed), with *Activate* where the API allows (`profiles.write`) and Mollie's link where it needs the merchant (Vipps and
MobilePay need the merchant's own contract and a Nordic business, Swish an EEA business). Unit D's per-country switches apply to Mollie as a `method`
list on the payment (Mollie's own way), never to methods Mollie has off.

**What waits.** Live Mollie payments wait for Kaizena Flow's Mollie app and, for a fee ceiling above Mollie's default, a partner agreement (bucket B):
everything is built and tested against a recorded fake of Mollie's API. Express buttons, saved cards, subscriptions and weekly boxes stay on Stripe
(said on the setting: a store on Mollie sells no subscriptions until a later unit).

## 8. Unit F (D293): payment terms for company accounts

A company account (D108) may have terms: `net_15`, `net_30`, `net_60` (`customer_companies.payment_terms`, staff set it). A signed-in employee of
that company checks out without paying: the order is placed `awaiting_payment` with `due_on` (the store's day plus the terms), its stock drawn as
for a paid order (the goods may be sent), and an invoice issued then (D159, `paid_outside`'s sibling *due*). The customer and staff see the due date;
a reminder goes three days before and an overdue mark after (`order.payment_due`, `order.payment_overdue`, customer and staff, hand-written and flagged
for review). Paying is the existing pay link (D173, Stripe hosted) or staff marking it paid outside Kaizena Flow; the order then counts as sales on the
day it is paid (cash basis, as PAID is defined), and the invoice is not issued again. Overdue orders show in the control center and the analytics
(*Due* and *Overdue* totals). Only businesses (`effectiveAudience()`), only goods and services (not bookings, subscriptions or boxes), and a credit limit
per company stops a new order beyond it.

## 9. Where things are today (read 2026-10-19)

- A session is made only in `openPaymentSession()` (`src/server/payment-session.ts`), called by `startCheckout()` and the three pay links; the store's
  account and mode come from `paymentConnection()` / `getCheckoutAccount()` (`payment_providers.active_mode`, `stripe_accounts`). No `capture_method`.
- A payment row is written there (`provider 'stripe'`, `pending`) and completed by `applySession()` (`src/server/stripe-webhooks.ts`), which calls
  `completeOrderPayment()` and sets `captured`; `payments.status` already allows `authorized`, never written. `payments.method` is for manual payments only.
- Webhooks: `src/app/api/stripe/connect/[mode]/route.ts` (stores' accounts, `event.account`), events in `WEBHOOK_EVENTS` (`src/server/stripe.ts`),
  dispatched by `handleStripeEvent()`; refunds by `applyStripeRefund()` (`src/server/stripe-refunds.ts`).
- Refunds: `refundOrder()` and `splitRefund()` (`src/lib/refund-split.ts`, typed `stripe | manual`); readers of `payments.provider` are listed in
  `src/lib/payment-readers.scan.test.ts`.
- Methods: `PAYMENT_CAPABILITIES` and `ensureStorePaymentMethods()` (`src/server/connect.ts`); `commerce.payment_methods` exists and nothing reads it.
- Analytics: `PAID` (`src/server/analytics-sql.ts`), estimated fees `paymentFees()` (`src/lib/analytics-finance.ts`) from `analytics_settings`.
- Orders: `orderListWhere()` (`src/server/order-list-sql.ts`), holds (`src/server/order-hold.ts`), rules (`src/lib/order-rules.ts`), staff alerts
  (`store_events`, `alertRecipients()`).
- Pay-route policy: `checkoutCsp()` (`src/lib/csp.ts`).

## 10. What the rows can honestly reach

- Units A, B, C, D and F are bucket A: Full when their criteria hold in tests and on screens.
- Klarna, MobilePay, Vipps, Swish, PayPal and accelerated checkout stay **bucket B** until a live account has them on (Stripe's grants, or Kaizena
  Flow's Mollie app and each merchant's contract). Built and tested against fakes, they are partial with the reason said.
- `checkout.third-party-and-multiple-payment-gateways` is Full when the adapter carries checkout, webhooks and refunds for both providers and a Mollie
  order goes to paid and refunded in tests; its decision is this file.
