# A demo store's year of history

`scripts/demo-history.mjs` (D792) writes about fourteen months of made-up history for one store as plain SQL files, so the admin of a store
that has only a catalogue looks like one that has sold for a year. It is for stores that are only ever demos: most of what it writes is
append-only (orders, invoices, stock movements, the activity and event logs) and stays.

## Running it

1. Read the store's facts: `node scripts/demo-history.mjs --context-sql` prints the query (replace `:slug`); save its JSON as the context.
   Its `name` is the name the store gets.
2. Generate: `node scripts/demo-history.mjs --context ctx.json --out dir --end <ISO time>`. The same context and end give the same files
   (a seeded random generator), so files added later to the script can be generated for a store that already has the earlier ones: check
   the earlier files come out byte for byte the same and run only the new ones.
3. Rehearse on a local copy of the store (`DATABASE_URL=… node scripts/demo-history.mjs --apply dir`), then run the files in name order on
   the real database, each its own transaction. Supabase refuses `set_config('session_replication_role', …)`; the files use
   `SET LOCAL session_replication_role = replica` only to re-date append-only rows (stock movements, credit notes, consent events).

## What it writes

- **The year** (files 00–80): customers, about 40 % with accounts; orders with card payments, invoices dated the day paid
  (`build_invoice_snapshot()` as `make_order_invoice()` does), parcels, deliveries recorded as the carrier's, refunds and returns whose
  credit notes are re-dated to the refund; stock drawn through the levels and restocked so the ledger holds; carts and visits; newsletter
  subscribers; reviews; finished, summarised support conversations; wishlists; bonus credits earned and used; staff-issued gift cards;
  a trade pipeline; email automations with three months of sends, two flows, a year of newsletters with frozen counts, cart reminders, ad
  spend and searches. Black Week, Christmas and a launch ramp shape the year.
- **The selling features** (files 90–96): subscriptions (plans on two products, subscribers with renewal orders), a subscription box with
  lists and past boxes, a class taught by two people and a guest room by the night (bookings tied to paid orders, written before their
  invoices), trade companies with locations, members, a price list and orders on 30 days' terms, Refer a friend, and two finished A/B tests
  on the front page. Their orders are numbered after the year's.

## Why nothing reaches anyone

- Every made-up person is on `example.org`, which the senders log and never send to (D792); the store's real staff are the only real
  addresses, so every order's alerts and rules are marked handled in the same transaction, and terms orders are all paid in time.
- Nothing seeded points at Stripe: subscriptions and box lists have no Stripe customer or subscription, so no job or button reaches Stripe;
  box lists have no consent to automatic orders, so no job makes box orders.
- Rows a job would act on are written finished: refunds succeeded, checkouts fully reminded, upcoming bookings and subscriptions marked
  reminded, A/B tests run and ended inside one transaction and discarded (applying would rewrite the live front page; discarding leaves it).
