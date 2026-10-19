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
a job fills any captured Stripe payment still without facts (at most a few a run, newest first, a day back). A payment Kaizena Flow cannot read keeps
nulls and is *Unknown*. Manual, venue and exchange payments keep their own `method` (cash, bank transfer) and are *Recorded by staff*.

**The payments report** (built as a section of the Finance page, `/admin/{store}/analytics/finance`, *Payments by method*, `analytics:read`: one
place for money, no page of its own): per method for a period, the payments, the money received (with VAT, in the main currency, said so), Stripe's
fees where known (unit C) else the estimate (said so), and refunds; the rows add up to the paid orders' money received in the same period, and an
*Unknown* row holds payments without facts. CSV like every analytics table (`ANALYTICS_TABLES`, `finance.payment_methods`). Definition in
`docs/analytics.md`.

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
- Staff are emailed once when a dispute opens and once three days before the deadline (built as the staff alert event `dispute`, emails
  `staff.dispute` and `staff.dispute_due` through `alertRecipients()`, each once per recipient by its key; sent from the webhook and the five-minute
  job rather than through `store_events`, whose queue is for paid orders and returns; owners get it by default and stores that saved their alert
  choices give it to each owner on the list; no shopper's name or address in them, amounts in the order's currency).
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

**As built (D289).** The setting is the owner's (Orders settings, *Take payment*, three choices with what each means; staff read it). Which
orders wait is only `captureModeFor()` (`src/lib/capture.ts`): subscriptions, bookings, deposits and venue balances, hosts' listings and downloads
are captured at checkout, and with `when_sent` so is an order with nothing to send. The order keeps its own `orders.capture_mode` (set by
`prepareCapture()` in `startCheckout()`), so changing the setting never changes an order already placed. A completed session whose PaymentIntent is
`requires_capture` goes through `commerce.authorize_order_payment()` (`authorizeFromSession()` in `applySession()`): the order is `authorized` with
`capture_before` (Stripe's `capture_before` from the card, else seven days), its reservations extended to a day past it, its cart converted and the
confirmation sent; nothing is drawn, invoiced or counted (analytics' `PAID` needs a captured payment), and the staff alert for a paid order waits
for the capture. **Capturing less** is a capture of that amount and a `refunds` row of kind `release` (succeeded, no provider reference) for the
rest, written in the capture's transaction: the invoice is issued on the whole order and the release is credited by the trigger every refund uses,
so documents and analytics read it as a refund of money that was never taken. Kaizena Flow's fee is the same share of what was captured. *Cancel
and release* voids the PaymentIntent and cancels the order through `cancel_unpaid_order()` (the customer is emailed when ticked). With `when_sent`,
`markSent()`, `markCollected()` and `markOutForDelivery()` capture first and record nothing when the capture fails; a carrier booking waits for the
capture. Stripe's `payment_intent.canceled` and the five-minute job (an alert `staff.capture_due` a day ahead, once; past the deadline Stripe is
asked: ended cancels, captured in the Dashboard makes it paid) end what Stripe ended. The shopper sees *Confirmed* (nb *Bekreftet*, sv *Bekräftad*,
da *Bekræftet*) and is never told about the hold; staff see *Card held, to capture* in the list (*Pay* filter *Card held, to capture*; a held
order to send is in *To send*) and the order's capture card. The order page reads stored rows only (`orderCapture()`); Stripe is called only by a
press, the webhook and the job.

## 5. Unit C (D290): payouts and reconciliation

Kaizena Flow reads each store's Stripe payouts (`payout.created`, `.updated`, `.paid`, `.failed` on the connected-account webhook, and a daily read
back 30 days) and each payout's balance transactions, into `commerce.payouts` and `commerce.payout_lines` (charge, refund, dispute, fee, adjustment,
with the payment or refund each settles where known). The store's *Payouts* page (Analytics) lists payouts with date, amount, fees and what they
settle, flags one whose lines do not add up to it, or which holds money Kaizena Flow cannot tie to an order, with the difference, and exports to CSV.
Each Stripe charge's real fee (`balance_transaction.fee`, Stripe's and Kaizena Flow's application fee told apart) is kept on its payment, and the
finance analytics use real fees where every payment of the period has one and say *estimated* otherwise (`costCoverageOf()` style: how much of the
period's money has real fees). Amounts in the payout's currency; the page converts to the main currency only for totals, with the euro scenario.

**As built (D290).** Payouts are read for the store's own Stripe account only (`commerce.stripe_accounts`, never a host's), by the
connected-account webhook (`PAYOUT_EVENTS` in `WEBHOOK_EVENTS`, so older endpoints gain them) and a daily read per store (`payout_reads`,
`runPayoutJobs()` in the five-minute dispatcher: payouts created in the last 30 days, then up to five paid ones whose lines are unread). A
paid payout's lines are its balance transactions (`balanceTransactions.list({ payout })`, at most `PAYOUT_LINES_MAX`; more makes it
*incomplete*), each tied once to its payment (`charge_reference`, else the PaymentIntent's session), refund or dispute and so to its order; a
line's fee is Stripe's `fee_details` split into Stripe's own fee and Kaizena Flow's application fee (`feeParts()`), and a charge's line writes
its payment's `provider_fee_minor`, `application_fee_minor` and `fee_currency` once (also from the charge's balance transaction when the
payment's facts are read, `writeFee()`). A manual payout lists no lines (Stripe does not say) and says so. Whether a payout adds up is
`reconcilePayout()` only: its lines' net against its amount (*Adds up*, *Does not add up by …*), or *Money not tied to an order* for charges,
refunds and disputes with no order; never a guess. The tables are append-only (no delete, identity fixed, ties set once, a line's currency
the payout's). Finance's payment fees are Stripe's real fee (without Kaizena Flow's, which is the platform fee) for each order whose every
captured Stripe payment has one in a currency the store converts, and the estimate from Analytics settings for the rest, labelled *estimated*
with how many are real (`Totals.realFeeOrders`); *Payments by method* does the same per payment. The page is Analytics → Payouts
(`/analytics/payouts`, by arrival day in the store's time zone, each payout in its own currency, totals of paid live payouts converted with a
currency without a rate left out and counted), one payout at `/analytics/payouts/{id}`, and the CSV `payouts.list` (per-row currency,
`rowCurrency`). Tested: `src/lib/payouts.test.ts`, `src/db/payouts.test.ts`, `src/server/payouts.int.test.ts` (a euro payout included),
`payouts-view.test.ts`, `analytics-finance.test.ts`.

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

**As built (D291).** The methods are `PAYMENT_METHODS` (`src/lib/payment-methods.ts`): cards (always on, with Apple Pay and Google Pay), Klarna,
Link, MobilePay, iDEAL, Bancontact, EPS, Przelewy24, BLIK and SEPA Direct Debit, each with its Stripe type and capability. An account is still made
with the four base capabilities (`BASE_CAPABILITIES`, a host's too); `ensureStorePaymentMethods()` asks for the rest afterwards, together, and one
at a time when Stripe refuses them together, so a method Stripe does not offer a store never stops its account (a refusal of all is asked again
next time). What Stripe says of each capability is kept on the account (`stripe_accounts.method_states`, `capabilityStates()`, by `saveStatus()`)
and shown on the Payments page (`PaymentMethodsCard`: *Active*, *Stripe is checking*, *Requested*, *Not available* with Stripe's reason in words).
`commerce.payment_methods` is the owner's choice: a row with `enabled = false` switches a method off for a country, no row is on (the template's
rows are all on), an unknown method is ignored and cards are never off. `excludedPaymentMethods()` gives a country's list, which
`openPaymentSession()` passes as `excluded_payment_method_types` for the order's own country (also shown in another currency); never
`payment_method_types`. A subscription box's pay link saves the card for later deliveries and stays card-only. A completed session that is unpaid
and holds no card (SEPA Direct Debit processing) makes the order wait for the bank: `commerce.await_bank_payment()` keeps it `pending_payment`, sets
`orders.awaiting_bank_since`, holds its stock and booked times for `BANK_WAIT_DAYS` (21) and converts the cart, once; the shopper's order page says
the payment is on its way (`m.paymentBank`, four languages, and stops refreshing), the admin's order header *Waiting for the bank*; Stripe's
`async_payment_succeeded` completes it as any paid order (the confirmation email follows) and `async_payment_failed` cancels it and lets the stock
go. Tested: `src/lib/payment-methods.test.ts`, `src/db/bank-payments.test.ts`, `src/server/payment-methods.int.test.ts` (Norway in kroner and shown
in euro, Sweden untouched, the bank wait paid and failed), `billing.int.test.ts` (capabilities asked for one at a time after a refusal).

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

### As built: E1, the adapter (D292)

- **One rule for an order's fate.** A provider's answer about a payment is a `PaymentAnswer` (`src/lib/payment-providers.ts`: provider, reference,
  `open`, `paid`, `unsettled`, `failed` or `expired`, and who paid when it says); `paymentFate()` decides from it alone (complete, hold or wait, cancel unless
  a weekly delivery or a staff-made order, or settle a change's or an exchange's difference), and `applyPaymentAnswer()` (`src/server/payment-outcome.ts`)
  acts on it: the customer's details, the order's completion, the confirmation and everything that follows a payment. Stripe's `applySession()` only turns
  a Checkout session into an answer (`stripeAnswer()`) and hands over what only Stripe can do as hooks: hold a card (D289), wait for the bank (D291), and
  after the payment its facts, a subscription and a delivery's saved card.
- **The provider.** `src/server/payment-providers/` holds `PaymentProvider` (`refresh()`: ask for the payment and apply the answer; `close()`: make an open
  payment unpayable; `refund()`: give part of it back, throwing `PaymentProviderRefusal` with a sentence for staff), `stripe.ts` with Stripe's code moved
  in unchanged, and `providerOf()`. The order page's late read (`getShopperOrder()`), closing a draft's, change's or exchange's open sessions
  (`settleOrderSessions()`) and every refund part (`refundOrder()`; `splitRefund()` takes any provider or `manual`) go to the payment's own provider.
- **Deviations.** Opening a payment stays `openPaymentSession()` for Stripe and the Stripe webhook routes stay as they are: E2 adds `openPayment()` to the
  interface with Mollie's, and Mollie's webhook is a route of its own (`/api/mollie/{mode}`), since each provider signs and shapes its calls its own way.

### As built: E2, Mollie (D292)

- **Connecting.** *Connect Mollie* on the Payments page (owners) sends the owner to Mollie's authorize page with `MOLLIE_SCOPES` and a state kept in
  the `kaizen_mollie_connect` cookie (ten minutes, path-scoped); `/api/integrations/mollie/callback` swaps the code for tokens (HTTP Basic with
  `MOLLIE_CLIENT_ID`/`MOLLIE_CLIENT_SECRET`), reads the organisation and its first website profile and keeps `commerce.mollie_connections` (one per
  store; the refresh token and the access token it last had encrypted, the access token renewed from the refresh token when it ends). Test payments
  are the same connection with Mollie's `testmode`. *Disconnect* revokes the token at Mollie and the checkout goes back to Stripe.
- **Which provider pays.** `commerce.checkout_providers` (per store and mode; no row is Stripe) through `chooseCheckoutProvider()`; Mollie counts only
  while it is connected and Kaizena Flow's app is set up (`checkoutProviderOf()`). The store's mode is still the Payments page's (`payment_providers`);
  real payments through Mollie need no Stripe account of the store's own (`setStripeProvider()` lets live mode on when Mollie is chosen for it).
  What only Stripe does stays Stripe's, whatever the choice: a subscription's renewals, a deposit's saved card, a host's account, a weekly box, and every
  pay link (a draft's, a change's, an exchange's).
- **Paying.** Mollie's hosted page asks for no address, so a Mollie store's cart asks who pays (name, email, phone where a driver brings the goods) and
  the delivery address when goods are sent (`cleanPayer()`, no zod on the cart), checked before the order is placed and written on the order then.
  `openMolliePayment()` makes the payment through the Payments API: the amount in the currency shown (euro included) as Mollie's decimal string, the
  order's own return address, the webhook `/api/mollie/{mode}` (left out on a local address), the market's locale, the store's profile, Kaizena Flow's
  fee as `applicationFee` capped at half the payment (`MOLLIE_FEE_SHARE_MAX`; the cap is said on the order's `payment.started` event), and a `method`
  list: what Mollie has active for the amount, less what this unit leaves out (`MOLLIE_LEFT_OUT`: pay-later methods, bank transfer, direct debit) and
  what the owner switched off for the country (D291). The return address is patched to name the payment once Mollie has made it, as Stripe's does.
- **Answers.** The webhook names only an id: `handleMollieWebhook()` finds the payment among the stores' in that mode, fetches it from Mollie with the
  store's token and applies it through `applyPaymentAnswer()` (`mollieAnswer()`), records the event once per state, and reads the payment's refunds
  (`applyRefundReport()`, shared with Stripe's) and chargebacks (`writeDispute()`, shared with Stripe's; Mollie takes a chargeback's money at once, so
  it is kept closed as lost, or won when reversed). The order page asks Mollie when the webhook is late (`refresh()`), and a shopper who checks out again
  has the earlier payment cancelled at Mollie, or waits while Mollie cannot cancel it. Store closure and erasure close a Mollie payment the same way.
- **Refunds.** `refundOrder()` sends a Mollie payment's part to Mollie with an `Idempotency-Key`; the webhook completes it and the credit note follows
  (D159). Kaizena Flow's fee is not returned on a Mollie refund (Mollie's rule), said on the Payments page before connecting.
- **Test mode.** A Mollie payment keeps its mode on the row (`payments.test_mode`): `invoice_eligibility()` and the order file count it as a test, so a
  Mollie test order never gets an invoice number.
- **Deviations from the contract above.** No `lines` are sent and pay-later methods (Klarna, Billie, in3, Riverty) are left out until Mollie's captures
  are built (`authorized` is answered as unsettled and waits); a store keeps one checkout provider per mode; Mollie's payment facts (method, risk) and
  payouts are not read in this unit.

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
