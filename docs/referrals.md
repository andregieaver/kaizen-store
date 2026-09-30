# Kaizen's referral program (D131)

Store owners refer other store owners. When a store opens through an owner's link, the owner earns **credit** worth a share
of the fees that store pays Kaizen, and the credit comes off their own Kaizen plan invoices. This is the platform level of the
affiliate program (a store's own program for its customers is the store level, `src/lib/affiliates.ts`). The contract shared by the screens and the
server is `src/lib/referrals.ts`; the rules are in SQL (`commerce.referral_*`, migration `referral_rules`); the servers are
`src/server/referrals.ts` and `src/server/referral-billing.ts`.

## The owner's decisions (final)

- **Who refers**: any account that is an `owner` of a store. The first time they open Referrals (`/admin/account/referrals`) they get a
  code and a link, with no approval. Platform admins can block an account.
- **Reward**: `commissionBps` (10 % by default) of the fees the referred store pays Kaizen for `months` (12) months from when the
  referral was made (the store's approval): (a) its **plan invoices**, the amount **without VAT** after discounts and credit, when a
  Stripe plan invoice is paid; (b) **Kaizen's sale fee** on its orders (`payments.kaizen_fee_minor`), when the payment is captured.
  Rounded down, in the fee's own currency.
- **Credit, not cash**: per currency, **never converted** between currencies. Earned credit is **pending** for `pendingDays` (30),
  because a fee can be refunded, then **usable**: it is put on the referrer's own Kaizen plan invoices in the same currency until
  it is used up.
- **Refunds and credit notes** take back their share of the commission, never below zero: what was used stays used.
- **Attribution**: the link `/r/{code}` leads to `/sign-up?ref={code}`; the **last click wins**. The code travels in the address and in the
  sign-up form's hidden field, so signing up in the same visit needs no cookie. The cookie `kaizen_ref` (lasting `cookieDays`, 30) is set **only
  after the visitor has allowed marketing cookies** (see below).
- **Guards**: no self-referral; blocked referrers earn nothing; a program that is off makes no referral; a `void` referral earns nothing more.
- **Privacy**: a referrer sees a referred store by its name and the commission it earned, never its customers, orders or fees. The link counts
  visits by day and code and keeps nothing about the visitor.

## Tables (`src/db/schema.ts`, bottom)

| Table | What |
|---|---|
| `referral_settings` | the one row: `enabled`, `commission_bps`, `months`, `pending_days`, `cookie_days`; none means the defaults, program off |
| `referrers` | an account's `code` (`^[a-z0-9]{6,16}$`, unique), `blocked_at`, `blocked_reason` |
| `referrals` | one per referred store (`store_id` unique): the referrer, the request it came from, the **frozen** `commission_bps` and `months`, `status` `active` or `void` |
| `referral_entries` | the append-only ledger per account and currency: `earn`, `apply`, `restore`, `reverse`, `adjust`; signed `amount_minor`; `source_kind`/`source_ref` (`plan_invoice` + the Stripe invoice, `sale_fee` + the payment), `referral_id`, `invoice_ref`, `available_at`, and an **idempotency key, unique** |
| `referral_allocations` | which lot each negative entry took from (append-only) |
| `referral_visits` | visits to a link by day and code (`store_id` null for Kaizen's link) |
| `access_requests.referral_code` | the code the request came with; checked when the request is approved |

`referrals` and `referral_visits` have a `store_id` column, so they are classified `never` in `COPY_RULES` (a copy of a store is not a
new referral).

## The ledger (same as the bonus ledger, D130, per account and currency)

A positive entry is a **lot** (credit usable from `available_at`). A negative entry is paid out of lots through `referral_allocations`,
usable lots first, the oldest first. What is left of a lot, and an account's balance, is **computed from the ledger**, never stored.

- `referral_balance(account)` gives per currency `available`, `pending` and when the next pending credit is usable; `referral_verify(account)` is
  the invariant (the sum of the entries equals what the lots hold, no lot over-allocated).
- **A balance cannot go below zero**, whatever writes: a trigger refuses an allocation beyond its lot, and a deferred constraint trigger refuses a
  negative entry not paid in full out of lots by the end of the transaction.
- The ledger is **immutable** (no update, no delete except with the account). Tests that need time to pass pull that trigger.
- Every writer takes the account's advisory lock first (`referral_lock`), so concurrent webhooks, refunds and invoices for one account are serialised.
- Every entry has an idempotency key; applying it twice changes nothing.

### SQL functions (all `SET search_path = ''`, security invoker)

| Function | What |
|---|---|
| `referral_program()` | the settings now (defaults while there are none) |
| `referral_lots(account, currency)`, `referral_usable_lots(...)`, `referral_balance(account)`, `referral_verify(account)` | reading |
| `referral_lock(account)` | advisory lock |
| `referral_grant(...)`, `referral_take(...)` | write a lot / a negative entry paid out of lots (`p_exact` refuses instead of taking less) |
| `referral_earn(store, fee, currency, source_kind, source_ref, note, at)` | commission on a fee, once per source (`{source_kind}:{source_ref}`): program on, referral `active`, referrer not blocked, `at` inside `[created_at, created_at + months)`, rounded down, pending `pending_days` |
| `referral_reverse(source_kind, source_ref, num, den, cumulative, key, note)` | takes back the share `num/den` of what a source earned, as far as the referrer still has it |
| `referral_apply_invoice(account, currency, invoice, max)` | credit on one invoice, at most `max` and what is usable now; **once per invoice** (a held invoice answers with what it holds); a blocked account's credit is not used |
| `referral_restore_invoice(invoice, note)` | credit held by an invoice comes back as a new lot |
| `referral_adjust(account, currency, amount, note, by, key)` | Kaizen adds or removes credit with a reason |
| `referral_visit(code)` | counts a visit by day for a real, unblocked code |

### Triggers

- `access_requests_referral` (after `store_id` is set on a request with a `referral_code`; approval runs in SQL, `approve_access_request()`): makes the
  `referrals` row with the rate and months **of that day**, when the program is on and the code is a referrer's. **No referral** when the requester's
  email is the referrer's or the referrer is a member of the new store (self-referral).
- `payments_referral_insert` / `payments_referral_status`: a payment inserted `captured`, or turned `captured`, with `kaizen_fee_minor > 0` earns
  `sale_fee:{payment_id}` for the store's referrer. Orders copied by a store duplication (D129) never earn (they cannot take a payment at all). A fault
  here is reported as a warning and never stops the payment.
- `refunds_referral`: the refunded share of the payment, **cumulative** over its refunds (`reverse:{refund_id}`), so refunds add up to exactly the whole
  however they are cut.

## Stripe (Kaizen's billing webhook, `/api/stripe/billing/{mode}`)

`BILLING_EVENTS` gained `invoice.created`, `invoice.paid`, `invoice.voided`, `invoice.deleted`, `credit_note.created`. A webhook made before them
lacks them: saving the program's settings with it on calls `ensureBillingEvents()`, which adds what is missing to the existing endpoint without replacing it.

| Event | Does |
|---|---|
| `invoice.paid` | a referred store's plan invoice: `earnOnPlanInvoice()` earns commission on `total_excluding_tax` (`plan_invoice:{invoice}`, once) |
| `invoice.created` | a **draft** plan invoice of a store whose owner has usable credit in the invoice's currency: `applyCreditToInvoice()` |
| `invoice.voided`, `invoice.deleted` | credit on the invoice comes back (`referral_restore_invoice`) |
| `credit_note.created` | `reverseForCreditNote()` takes back the credited share (credit note without VAT / invoice without VAT) of the commission the invoice earned |

A store's invoice is found by the invoice's `customer_account` (`stripe_accounts.account_id` in that mode), else the subscription's `kaizen_store_id`
metadata. Only invoices a subscription made count (`isPlanInvoice()`).

**Which account's credit applies**: the owners of the store being invoiced (`store_members.role = 'owner'`, not disabled), the first by membership
date who has usable credit in the invoice's currency and is not blocked.

### Applying credit: how it fails safely (`applyCreditToInvoice()`)

1. The invoice is **read from Stripe** (an event's copy can be old): only a draft takes a line.
2. The **ledger takes the credit first** (`referral_apply_invoice`, at most the invoice's amount without VAT, so the invoice is never negative), once per invoice.
3. Stripe is asked for **one** invoice item, "Referral credit", amount negative, metadata `kaizen_referral_credit = {invoice}`, idempotency key from the ledger
   entry, after looking for a line with that mark already there.
4. If the call fails, Stripe is asked whether the line arrived: if it did, the credit stays taken; if it did not, **the credit is given back** (`restore`). If
   Stripe cannot be asked at all, the credit stays taken and the webhook answers 500; Stripe sends the event again and the retry finishes or undoes it
   (finalized invoice with no line: given back; with the line: kept). Nothing is ever applied twice, and the ledger never says credit was applied for a line
   Stripe does not have once the retry has run.

The referrer is emailed once per invoice (`referral-credit-applied:{invoice}`) when a line is newly added.

## Consent (D58)

`kaizen_ref` is in `KNOWN_COOKIES`: category **marketing**, `on: "platform"`, `referrals: true`; `declaredCookies()` lists it (and so `siteCookies()` asks about
marketing on Kaizen's site, and the cookie page lists it with the configured days) only while the program is on. `ReferralKeeper` (sign-up page) writes it only when
`mayKeepReferral()` (the consent cookie allows marketing), now or when the visitor decides later in the visit (`CONSENT_CHANGED_EVENT`); withdrawing marketing removes it
(`forget()` in `ConsentManager`). Nothing is stored before consent. `requestAccess()` reads the form's `ref`, else the cookie, and `createAccessRequest()` drops any code
that is unknown, malformed or blocked without a word.

## Screens

- `/admin/account/referrals` (control center tab Referrals): link with copy button, code, visits, requests, referred stores, credit per currency (usable / pending),
  history. `/r/{code}` is the link (`src/app/r/[code]/route.ts`, in `robots.txt`'s closed paths).
- `/admin/platform/referrals`: settings, totals per currency, referrers (block/unblock, adjust credit with a reason), referred stores (void with a reason, count
  again). Every change is audited (`platform.referral_*`).
- Emails (English, like plan reminders; `src/lib/referral-emails.ts`): to the referrer when a referred store opens (`referral-opened:{referral}`, once), and when credit is
  put on an invoice.
- AI manager: `get_referral_program`, `set_referral_program` (gated `public`) for the platform; `get_my_referrals` (the account's own overview) for everyone; skills
  `referral-program` and `refer-store-owners`.

## Limits and not in v1

- **Refunds made directly in Stripe without a credit note** (a bare `charge.refunded` on a plan invoice) are not seen: commission on the invoice stays. Credit notes are.
- **Stores' sale-fee refunds** are seen only through `commerce.refunds` (recorded by Kaizen), as for the bonus program.
- **Voiding a referral** stops new commission; what it already earned stays (adjust it by hand with a reason).
- **Credit on a credit note of the referrer's own invoice** is not returned: the line stays on the invoice that was credited.
- An invoice finalized before the webhook reaches Kaizen (Stripe finalizes a draft about an hour after `invoice.created`) gets no credit; the credit waits for the next invoice.
- The first invoice of a subscription is finalized at once, so it cannot take credit.
- A referral is made only when a **request is approved**; a store opened another way (an owner creating more stores, D19) is never a referral.
- Commission is on the amount **without VAT, after discounts and credit** Kaizen actually billed; VAT on the credit line follows the invoice's tax rates.
- Amounts are never converted: a referrer with credit in NOK only reduces NOK invoices.
- Payout in cash, tiers, a referred store's own customers, cookies on stores' sites: not here.
