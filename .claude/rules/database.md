---
paths:
 - "src/db/**"
 - "supabase/**"
 - "scripts/db-*.mjs"
 - "scripts/squash-migrations.mjs"
 - "scripts/prune-snapshots.mjs"
 - "drizzle.config.ts"
---

# The database: how-to

A migration reaches production only through CI, and a change to a hot table follows the rules below.

- Only the newest snapshot in `supabase/migrations/meta` is kept (D532): `pnpm db:generate` prunes them, and after a custom
  migration run `node scripts/prune-snapshots.mjs`.
- The folder starts with a baseline (D572, `docs/ci-migrations.md`): four files made by `scripts/squash-migrations.mjs` from the
  789 up to 11 November 2026, which are kept in `supabase/archive/`; never edit a baseline. Squash again each quarter.
- On the hot tables (orders, order_lines, visits, products, product_variants, customers, carts, cart_lines) an index is built
  `concurrently` in a file whose first line is `-- kaizen:no-transaction`, and a constraint is added `not valid` and validated
  later (D569, `docs/ci-migrations.md`; `migration-safety.scan.test.ts`).
- In production a statement may run 15 s and wait 5 s for a lock (the `postgres` role's limits, code review 1.5); a job that needs
  longer calls `longerTimeout(tx, seconds)` inside its transaction (`src/db/client.ts`, `set local`, never a plain `set` through
  the pooler).
