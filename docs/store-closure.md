# Closing a store (D171)

An owner can close their store; the platform can suspend, close and reopen any store. Nothing is deleted.

## Why nothing is deleted

Orders can never be deleted (D141), invoices and credit notes are immutable and kept for the seller's country's bookkeeping period
(5 to 10 years, D159), the audit log is append-only for 24 months (D158), and most of the 120-odd tables that point at a store do so with no
cascade. So a store that has sold anything can only be *closed*: the data stays, the daily retention job (D162) anonymises it when its
period ends. **Permanent deletion of a store that never sold anything was considered and is not built**: it would need an explicit,
ordered delete across every store-owned table and a way past the append-only audit log, which is a risk out of proportion to what it frees. A
closed store with no sales holds little and is inert.

## The three states

`stores.status` is `active`, `suspended` or `closed`. The steps are the database's (`commerce.stores_status_rules()`): active to suspended or
closed, suspended to active or closed, closed to active. The template store never leaves `active`. `closed_at` (the start of the owner's
reopening period) is set when a store is closed and cleared, with the reason, when it is reopened; `status_reason`, `status_changed_at` and
`status_changed_by` say why, when and by whom.

* **Not open** (suspended or closed): the storefront is a 404 (`getOpenStore()`), `commerce.orders_store_open()` refuses a new order whoever
  asks (a checkout, a renewal, a weekly delivery; a copied order is history and is let through), and the jobs that email shoppers, call a model
  or sync calendars skip the store (`commerce.store_is_active()`).
* **Members still reach it.** `loadMembership()` no longer hides a closed store from its members, and `memberCan()` (the one place the rule
  lives) lets them do only what concerns what already happened: `orders`, `customers` and `analytics` (read and write), `billing:read`,
  `staff:read` and the owner's own key (`allowedWhenNotOpen()` in `src/lib/store-closure.ts`). Everything that sells, publishes or changes the
  shop is refused for every role. The navigation offers the same, and a banner says the store is not open. The closed store is kept out of the level
  switcher and listed under *Closed stores* on `/admin/stores`.

## Closing, as the owner (`/admin/{store}/settings/close`, owner only)

1. **A sign-in from the last ten minutes** (`signedInRecently()`: the verified token's `amr` times, `src/lib/fresh-sign-in.ts`). Without one the page
   offers *Sign in again*, which signs out and returns to the page.
2. **The store's address typed in** (`confirmationMatches()`).
3. **Blocked** while paid orders with physical goods are still to send (test payments do not count), subscriptions are running (active, past due or
   paused) or weekly delivery lists are running. The page names what blocks and the owner clears it first.
4. **Warned** about what closing does: orders waiting for payment are cancelled, bookings still to come are not (the owner contacts the customers),
   open returns can still be handled, the Kaizen plan ends with the period already paid for (nothing is refunded), the store's own domains are released,
   and Stripe's balance is paid out as usual.

`closeStore()` then: counts again under a lock on the store row, ends the plan at period end first (so a store is never closed and still billed; if
Stripe refuses, nothing is closed), sets the status, expires the open Stripe sessions and cancels the orders still waiting for payment (a payment that
landed meanwhile completes its order, which then appears in the closed store's orders), releases the domains, writes `store.closed` to the audit log
and emails the owners.

## Reopening

The owner may reopen a store they closed for 30 days (`REOPEN_DAYS`, `ownerMayReopen()`); a suspension and anything later is the platform's. Reopening
undoes a plan set to end with its period, if that period is not over; a domain that was released is not restored (the owner adds it again). Sales work
again at once.

## The platform (`/admin/platform/stores/{store}`)

*Suspend* (a reason, 5 to 500 characters, which the owners are emailed), *Close* (a reason; may be forced past what blocks an owner) and *Reopen*
(a closed or suspended store, at any time). Every change is audited (`store.suspended`, `store.closed`, `store.reopened`, area settings so the owner
sees it in their log) and emailed (`store.status`, English, `src/lib/store-closure-emails.ts`).

## What the jobs leave alone

Skipped for a store that is not open: cart reminders, booking reminders, weekly delivery preparation, calendar feeds, product, knowledge and media
embeddings, alt texts, bonus expiry reminders, referral emails, scheduled A/B starts. Not skipped, because they are obligations: invoices and credit
notes, refunds, returns, host commissions, data and privacy jobs, and retention.

## Files

`supabase/migrations/…_store_closure*.sql`, `src/lib/store-closure.ts` (rules), `src/lib/store-closure-emails.ts`, `src/lib/fresh-sign-in.ts`,
`src/server/store-closure.ts` (the service), `src/server/permissions.ts` (`memberCan()`), the owner page and actions under
`src/app/admin/(gated)/[store]/settings/close/`, the platform's under `src/app/admin/(gated)/platform/stores/[store]/`, tests
`src/lib/store-closure.test.ts`, `src/lib/fresh-sign-in.test.ts`, `src/server/store-closure.int.test.ts`.
