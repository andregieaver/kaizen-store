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
| P5 | **Accounts are platform-wide; roles are per store.** One sign-in (Supabase magic link) per person; `store_members` gives them `owner` or `admin` in each store. | 2026-09-24 |
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
