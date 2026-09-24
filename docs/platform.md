# Platform architecture

Kaizen is a platform that hosts many merchant stores, in the spirit of Shopify.
This note records how. The older single-store decisions in
[`decisions.md`](decisions.md) still hold per store unless this file says
otherwise.

## Decisions

| # | Decision | Date |
|---|---|---|
| P1 | **One database, every row belongs to a store.** A `stores` table; every commerce table carries `store_id`, and child tables reference their parent by `(store_id, id)`, so the database refuses any row that points into another store. | 2026-09-24 |
| P2 | **Stores live on subdomains** of a platform domain (`{store}.{platform domain}`), with custom domains later. Until the platform domain is set up, stores are reachable at `/s/{store}` on the current URL. | 2026-09-24 |
| P3 | **Invite-only beta.** Anyone can request access; the platform operator approves. | 2026-09-24 |
| P4 | **The original store is the demo template.** Its catalogue is what every new store starts with, copied inside the database in one transaction. | 2026-09-24 |
| P5 | **Accounts are platform-wide; roles are per store.** One sign-in (Supabase Auth: password or magic link) per person; `store_members` gives them `owner` or `admin` in each store. | 2026-09-24 |
| P6 | **Routing by host happens in Vercel's routing layer, and only reads the host name.** Host-based rewrites from `{store}.{domain}` to `/s/{store}` are configuration, not code, so they add no function call to a page view and never touch cookies or personal data. They are added once the platform domain exists; until then `storeBase()` in `src/lib/paths.ts` returns `/s/{store}`. | 2026-09-24 |

## How it fits together

- `commerce.stores` holds each store; `slug` is its subdomain, checked for
  format and against reserved names (`admin`, `www`, …).
- `commerce.countries` is the platform's list of countries (the EU and
  Norway). A store's `markets` are the countries it sells to.
- Creating a store runs `commerce.initialise_store()`, which adds its invoice
  and credit-note series and Stripe (disabled, test mode).
- `supabase/seed.sql` creates the template store, slug `demo`.
- Storefront: `/s/{store}` (country chooser) and `/s/{store}/{market}/…`.
  `src/server/stores.ts` loads a store and its markets (cached per store);
  `src/server/shop.ts` resolves URL params to a store and market.
- Admin: `/admin` lists the account's stores; `/admin/{store}/…` is one store,
  gated by `requireMember()` in `src/server/auth.ts`.

## From sign-up to an open store

1. **Request.** Anyone can ask for a store at `/sign-up` (name, email, store
   name). It is stored in `commerce.access_requests`; repeat requests from the
   same email are merged, and the page never says which emails have asked.
2. **Approval.** Platform admins see waiting requests at `/admin/platform`,
   adjust the store name and address, and approve or decline.
   `commerce.approve_access_request()` creates the account (or reuses one),
   copies the template with `commerce.clone_store()` and records the decision,
   in one transaction: if anything fails, nothing changes.
3. **Invitation.** The new owner is emailed a sign-in link. It lands on
   `/auth/confirm` and works in any browser (see README for the email
   template this needs).
4. **Setup wizard.** An owner whose store is not open yet is taken to
   `/admin/{store}/setup`: business details, countries, Stripe test keys,
   demo products, then "Open my store". Every step can be skipped; progress is
   read from the store's data (`getSetupProgress()`), so the overview's
   checklist stays right however a setting was changed.
5. **Preview until open.** Before the owner opens it, the storefront works but
   says it is a preview and asks search engines not to index it.

What `clone_store()` copies: markets, payment-method switches, product-safety
contacts, stock locations and the catalogue (not archived products). Current
prices are copied as new prices, so the new store shows no reductions it
never made. It never copies orders, customers, carts, business details or
producer registrations. Copied rows get ids derived from the new store and
the original id (`commerce.clone_id()`), so references line up without a
lookup table.

## Tenant isolation

- Server code reaches store data only through functions that take a `storeId`.
- Composite foreign keys make cross-store references impossible in the
  database, not just unlikely in the code.
- Planned hardening: run storefront queries as a database role without
  `BYPASSRLS`, with row-level security policies keyed on the store, so a
  missing filter returns nothing instead of another store's rows.

## Performance budget

"Under 500 ms" is measured as follows, and each page type has its own budget:

| Page | Budget | How it is met |
|---|---|---|
| Storefront pages (home, product, category) | Server response under 100 ms from cache; **LCP under 500 ms** on desktop broadband at p75 | Prerendered and cached per store; only stock and cart stream in |
| Storefront dynamic parts (stock, cart) | Under 300 ms server time at p95 | One indexed query each, in Dublin next to the database |
| Admin pages and actions | **Under 500 ms** server time at p95 | Indexed queries, no waterfalls, optimistic UI where it helps |

No website loads in 500 ms on a slow mobile connection; there the target is
Google's "good" LCP (2.5 s), and the store should beat it comfortably.
Vercel Speed Insights measures real visitors; CI fails when a page's server
response in the test run exceeds its budget.

## Usability by design

- Every task has one obvious path; defaults are chosen so most merchants never
  need to change them.
- Forms validate as you go, say what is wrong in plain words, and never lose
  input.
- The admin is keyboard-friendly and meets WCAG 2.2 AA, like the storefront.
- New merchants are guided by a setup wizard and a checklist rather than
  documentation.
