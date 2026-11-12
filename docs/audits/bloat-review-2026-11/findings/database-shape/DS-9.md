# DS-9 ✓ Thirteen indexes duplicate another; orders carries 34, five of them starting (store_id, placed_at)

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.26.
- **Second check:** corrected.
- **Where:** `supabase/migrations/20261111172841_baseline_3_rules.sql:10328`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10384`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10419`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10062`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10076`, `supabase/migrations/20261111172841_baseline_3_rules.sql:14206`, `supabase/migrations/20261111172841_baseline_3_rules.sql:5660`, `src/db/schema.ts:4899`, `src/db/schema.ts:4901`, `src/db/schema.ts:5092`, `src/db/schema.ts:13544`, `src/db/schema.ts:13723`, `src/db/schema.ts:8319`, `src/db/schema.ts:8353`, `src/db/schema.ts:13598`, `src/db/schema.ts:14998`, `src/db/schema.ts:5809`, `src/db/schema.ts:19270`, `src/db/schema.ts:6571`, `src/db/schema.ts:8644`
- **Evidence:** From the index list and the catalog of the migrated test database: ten plain indexes are a leading prefix of a unique key on the same table (account_recovery_codes_account_idx, api_tokens_store_idx, api_uploads_store_idx, legal_snapshots_store_idx, order_edits_order_idx, payout_lines_payout_idx, recurring_costs_store_idx, return_exchanges_return_idx, visits_store_day_idx, webhook_endpoints_store_idx). orders_retention_idx and orders_invoice_candidates_idx have the key of orders_store_placed_idx with conditions nearly every order meets. order_lines_order_idx has the key of the covering order_lines_analytics_idx. I dropped the 13 in PGlite (1,988 to 1,975 indexes) and ran EXPLAIN with sequential scans off: the retention read takes orders_store_placed_idx with anonymised_at as a filter, a store's day of visits takes visits_day_visitor_key as an index-only scan, payout lines take payout_lines_reference_key, tokens api_tokens_store_id_key, recovery codes account_recovery_codes_hash_key. orders has 34 indexes; a plain new order writes 22 entries, and `status` is in three partial indexes' conditions, so a status change writes them again.
- **Cost today:** One extra index entry per row for each duplicate: 2 per order write, 1 per order line, 1 per counted visit. Small per write; visits is where it adds up after opening. Paid by: The database, per write
- **Saving:** Measured by count: 13 indexes; 2 fewer entries per order write, 1 per order line and 1 per counted visit.
- **Risk:** Low. None of the 13 backs a constraint that another index does not enforce, and every foreign key they served has another index on the same leading columns. What could break: a slower read where a dropped partial index was smaller; it would show as a slow statement in pg_stat_statements, and the index can be built again concurrently.
- **Already tracked:** Code review FD7, step 3.15 'Keep the big tables lean': Open. It counted 24 indexes and named orders_retention_idx; the count is now 34 and the list of 13 is new.

## The fix

1. Hot tables first (orders, order_lines, visits are on the list of src/db/migration-safety.scan.test.ts:20). Custom migration: pnpm exec drizzle-kit generate --custom --name drop_duplicate_hot_indexes. First line `-- kaizen:no-transaction`; four statements split by `--> statement-breakpoint`: DROP INDEX CONCURRENTLY IF EXISTS commerce.orders_retention_idx; the same for commerce.orders_invoice_candidates_idx, commerce.order_lines_order_idx and commerce.visits_store_day_idx.
2. src/db/schema.ts: delete the three declared lines of those (:4901 orders_retention_idx, :5092 order_lines_order_idx, :13544 visits_store_day_idx; orders_invoice_candidates_idx is not declared). At :5092 leave a comment: (store_id, order_id) is served by order_lines_analytics_idx, written in SQL because of its INCLUDE.
3. Delete the nine other declared lines: :13723, :8319, :8353, :13598, :14998, :5809, :19270, :6571, :8644. Run pnpm db:generate: it writes twelve DROP INDEX statements. Keep the nine in that file (none of their tables is hot) and remove the three hot ones from it, since step 1's file drops them concurrently. Run node scripts/prune-snapshots.mjs and pnpm db:check.
4. Check the plans on the local database after scripts/db-setup.mjs --seed, with set enable_seqscan = off: the retention step's orders read (src/server/retention.ts) shows orders_store_placed_idx, and a count of commerce.visits for one store and day shows visits_day_visitor_key.
5. Keep: the three selective partial indexes (ai_usage_autopilot_idx, order_events_restock_idx, price_lists_exclusive_idx), the (store_id, id) keys (rule P1) and the indexes on nullable foreign-key columns (measured: about 1 µs a row each).
6. docs/audits/code-review-2026-11.md: correct FD7 (34 indexes before, 32 after; the redundant ones dropped, with date and commit) and leave step 3.15 Open for the unused-index review after some weeks of traffic. Record both files' versions in docs/decisions.md and check the advisors.

**Done when:** On the migrated test database select count(*) from pg_indexes where schemaname = 'commerce' gives 1,975 (1,988 today), and select count(*) from pg_indexes where schemaname = 'commerce' and tablename = 'orders' gives 32 (34 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/migration-safety.scan.test.ts and src/db/migrate-no-transaction.int.test.ts hold the marker and the concurrent statements; docs/ci-migrations.md:48-66 is the rule.
- src/db/commerce.test.ts:6310 expects the unique key visits_day_visitor_key, which stays.
- pnpm db:check and src/db/snapshots.scan.test.ts for the schema.ts edits.
- Int tests whose reads used these indexes must pass unchanged: src/server/retention.int.test.ts, src/server/invoice-issue.int.test.ts, the analytics visits tests, src/server/payouts.int.test.ts.
- src/db/index-duplicates.test.ts (DS-15): its first case goes from 11 rows to 0.
- Rule: a migration never drops what running code needs. Dropping an index breaks no statement; the old code only loses a faster path it did not need.

**Notes:** The saving is small; it is P1 because it is half an hour now, while the tables are tiny, and the same change later needs care on busy tables. Land it with DS-15's test.
