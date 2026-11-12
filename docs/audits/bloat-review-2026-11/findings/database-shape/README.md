# The database's shape (DS)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** The database's shape is sound for a platform about to open: dead objects are rare (1 table, 5 columns, 34 leftover tables), triggers are gated by column and nearly every log has a retention rule; that 245 of 486 tables have held no row says only that the doors are still closed, and nothing is retired for it. What is worth fixing before opening is where cost does not follow use or grows with stores: pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it, every cold start evaluates a 1 MB schema file that no query uses (115 to 135 ms and 9 to 12 MB measured), 122 store filters are written so the store index cannot serve them, and page lists read whole documents (4.2 ms a call against 0.8 ms from a plain column, measured in a local Postgres 18). All 14 verified findings now have ordered steps, the tests and rules that hold them and one check; one was added: indexes are declared in two places and nothing compares them, which is how two of the three duplicates on orders and order_lines arrived. Do first DS-8 (the scheduler's log), DS-1 (the schema import), DS-7 (the store filter) and DS-15 with DS-9 (the duplicate-index test and the 13 drops); DS-6 (the platform kept twice) and DS-13's retention periods wait for the owner.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DS-8](DS-8.md) ✓ | pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it | oversize | P0 | S | 0.20 |
| [DS-1](DS-1.md) ✓ | Every server start loads the whole schema file, which no query uses | eager | P0 | S | 0.3 |
| [DS-7](DS-7.md) ✓ | `store_id is not distinct from` keeps Postgres from using the store indexes | oversize | P0 | M | 0.18 |
| [DS-15](DS-15.md) | Indexes are declared in two places and nothing compares them, which is how duplicates reached orders and order_lines | no check | P1 | S | 0.20 |
| [DS-9](DS-9.md) ✓ | Thirteen indexes duplicate another; orders carries 34, five of them starting (store_id, placed_at) | oversize | P1 | S | 0.20 |
| [DS-4](DS-4.md) ✓ | A page's title, its titles by language and its flags live only inside its content JSON, so lists read and parse whole pages | oversize | P1 | M | 2.19 |
| [DS-5](DS-5.md) ✓ | The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date | eager | P1 | M | 0.21 |
| [DS-10](DS-10.md) ✓ | Where each picture is used is found by text-searching every page's JSON, again every day for every picture | eager | P1 | S | 0.21 |
| [DS-3](DS-3.md) ✓ | Two scheduled jobs do work that does not follow use: a prune every minute and an invoice retry every five minutes for 120 days | eager | P1 | S | 0.22 |
| [DS-13](DS-13.md) ✓ | Retention gaps: carts and processed webhook events are never deleted, the status prune scans on every tick, and the docs index is rewritten whole *(your choice)* | oversize | P1 | M | 3.3 |
| [DS-12](DS-12.md) ✓ | Nothing counts what a new table, trigger, index or scheduled job adds to the running cost *(your choice)* | no check | P1 | S | 1.10 |
| [DS-6](DS-6.md) ✓ | Kaizena Flow's own site and tools are kept more than one way: null-store rows, platform_* twin tables, and a copy in its own store *(your choice)* | duplicate | P1 | L | 3.5 |
| [DS-2](DS-2.md) ✓ | Each server start waits for a read of the interface-text table, and every warm instance asks again each minute | eager | P2 | S | 0.7 |
| [DS-14](DS-14.md) ✓ | A very short list of dead database objects: one table, five columns and a leftover schema | dead | P2 | S | 0.20 |
| [DS-11](DS-11.md) ✓ | Ending one sandbox runs at least 800 deletes and holds about 2,100 locks, one pass per store table per round | oversize | P3 | S | 4.4 |

## Refuted by the second reviewer

These were in the first reading and did not hold. They are in no step.

- **The dispatcher does 12.5 s of database work every five minutes for unused features.** runJobs() starts all its jobs at once (src/server/cron-runs.ts:117) on a pool of 5 connections (src/db/client.ts:68) and times each around the whole job, so the per-job times overlap; the whole tick took about 1.3 s. Most jobs begin with one cheap due-read.
- **Seven SQL functions are called by nothing.** supabase/seed.sql:232-241 calls the add_demo_* functions and the Demo products rule requires them; bonus_verify and referral_verify are documented checks that tests call.
- **The 245 tables that never held a row and the 1,006 indexes never scanned are bloat to retire.** The platform is not open yet, so every feature is unused; 966 of those indexes sit on tables waiting for their first row. No running cost was shown for them.
- **Indexes on nullable foreign-key columns should become partial (414 of them, 6 on carts, 8 on orders).** My own candidate, refuted by measurement: about 1 µs and 7 bytes a row each on carts in PGlite, because btree deduplicates the NULL entries.
- **The 39 unique (store_id, id) keys that no foreign key points at are redundant.** They are rule P1's anchor (docs/platform.md:12); adding one later on a hot table is harder than having it from the start.

## Measured

| Measure | Value | How |
|---|---|---|
| Tables, columns, JSON columns | 486 tables, 5,806 columns, 292 jsonb columns | Catalog query on the tests' kept database (every migration applied, loaded into an in-memory PGlite, Postgres 18.6): a scratch script Same numbers as the verified report. |
| Indexes, triggers, functions | 1,988 indexes (production reports 1,989); 391 triggers; 617 functions, 331 of them trigger functions; all 617 carry a SET clause and 124 are SQL-language | pg_index, pg_trigger and pg_proc on the same database (a scratch script, counts.mjs, misc.mjs). |
| The hot tables' write cost in objects | 89 indexes and 60 triggers on the eight hot tables: orders 34 and 27, products 13 and 14, carts 11 and 1, order_lines 9 and 5, customers 8 and 6, product_variants 6 and 7, cart_lines 5 and 0, visits 3 and 0 | pg_index and pg_trigger for the HOT_TABLES of src/db/migration-safety.scan.test.ts:20 (a scratch script, hot.mjs). |
| orders | 92 columns, 8 jsonb, 34 indexes (18 partial, 3 GIN), 27 triggers, 34 checks, 10 foreign keys out, 41 in. stores has 309 foreign keys pointing at it. | a scratch script on the real schema. |
| Redundant indexes | 13 clear: 10 plain indexes that are a leading prefix of a unique key, orders_retention_idx and orders_invoice_candidates_idx (same key as orders_store_placed_idx, conditions nearly always true), and order_lines_order_idx (same key as the covering order_lines_analytics_idx). After dropping them in PGlite: 1,975 indexes, and the retention, visits, payout, token and recovery-code reads still get an index. | a scratch script over the parsed index list, a catalog query (a scratch script 12 pairs, 11 distinct plain indexes) and EXPLAIN before and after the 13 drops with enable_seqscan off (a scratch script). |
| Indexes not declared in schema.ts | 46 of the 1,059 non-unique indexes are named nowhere in src/db/schema.ts; 12 of them sit on hot tables, among them orders_invoice_candidates_idx and order_lines_analytics_idx, each a twin of an index schema.ts does declare | Index names from pg_index searched in the text of schema.ts (a scratch script). |
| What an index on a nullable foreign-key column costs | 414 plain indexes end in a nullable foreign-key column (6 on carts, 8 on orders). Measured: a guest cart insert takes 30 to 34 µs with carts' 11 indexes and 23 to 26 µs when the six are made partial, so about 1 µs each; each stores about 7 bytes a row (btree deduplication of NULLs). Not worth changing. | a scratch script 4 runs of 20,000 inserts on the real carts table in PGlite (wasm, so slower than production in absolute terms). |
| Page reads: whole document, JSON operator, plain column | 4.2 ms, 1.5 ms and 0.8 ms a call for one store's 29 published pages (252,719 bytes of rows against 4,265); the remembered-modal check 1.4 ms by jsonb_path_exists against 0.6 ms from a flag column | a scratch script 1,392 pages built from ten real page documents (mean 8.3 KB) in a copy of the pages table, 300 calls each, PGlite. Relative numbers; PGlite has a floor of about 0.5 ms a call. |
| The sandbox purge on the real schema | 400 store tables, so 400 dynamic deletes a pass and at least two passes; one pass that finds nothing took 64 to 293 ms and left 2,129 relation locks held by the transaction | a scratch script the function's own loop run for a store id that owns nothing, three times, with pg_locks read before commit. |
| Schema module at server start | schema.ts is 1,059,413 bytes and 19,614 lines; 85 to 100 ms to evaluate and 30 to 37 ms for drizzle to index it, 9 to 12 MB of heap (the verified report's timing); its table definitions sit in 6 server chunk files of the finished build | wc on the file; my rg for the schema-only name orders_store_placed_idx over .next/server (12 files: 6 .js and their 6 maps); the timing is the verified report's 11 runs, not repeated here. |
| Queries that use the schema object | 0. One runtime importer (src/db/client.ts:11); the only other importers are src/server/store-export.scan.test.ts:4 and drizzle.config.ts:7 | rg for imports of db/schema and for select, insert, update, delete, query, findMany on db() or tx over src. |
| Null-safe store comparison | 122 uses of `store_id is not distinct from` in 40 files (tests left out); 63 tables allow a null store_id; 19 platform_* tables | rg -i -c over src; catalog query (a scratch script). The verified report's EXPLAIN (sequential scan against an index scan) was not repeated. |
| Row level security | On for all 486 tables, 0 policies, forced on none: the app's role owns the tables, so no query pays for a policy | pg_class and pg_policies (a scratch script). |
| Scheduled objects | 9 pg_cron jobs every minute, 1 every five minutes, 4 daily (two of them retention deletes); the dispatcher runs 78 jobs through runJobs() and 5 more after it | supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:93-113 read; rg count of job lines and of tracked("dispatcher.…") in src/app/api/cron/cart-reminders/route.ts. |
| Database size | 731 MB: pg_cron's run log 564 MB (77%), commerce 124 MB, pg_catalog 27 MB, net 8.5 MB; a leftover commerce_legacy schema holds 34 tables and 96 rows | evidence/prod-db-stats.md (Size and shape). Not measured by me: production may not be queried in this review. |
| Database time of the app's top statements | About 2,360 s in 78 days (30 s a day) outside pg_cron's own 3,974 s of net.http_post; the three page statements are 968 s of it (781 + 66 + 121) | Sums of the Total column in evidence/prod-db-stats.md. |

## Well made, and should stay

- Dead columns are rare: six names appear nowhere outside schema.ts (I searched each: contact_checked_at, first_seen_at, secret_key_hint, webhook_secret_hint, legal_basis, source_updated_at), and legal_basis holds reference data.
- No SQL function is dead: supabase/seed.sql:232-241 calls the add_demo_* functions (I opened it), and only one function in the baseline builds statements from the catalog (purge_sandbox).
- Triggers are gated by column. I read the ones that fire on any product update (assert_product_publishable, products_first_active, integration_product_events) and on order lines: indexed lookups by store, no loops. carts has 1 trigger, cart_lines and visits none.
- Row level security is on for all 486 tables with no policy and not forced, as the advisors ask for a private schema; the app's role owns the tables, so no statement evaluates a policy.
- Indexes on nullable foreign-key columns are nearly free: about 1 µs and 7 bytes a row each, measured on carts in PGlite. Leave the 414 of them, and the written rule that every foreign key has its index.
- The 39 unique (store_id, id) keys nothing points at yet are rule P1's anchor (docs/platform.md:12: child tables reference their parent by store and id). Leave them.
- Binary data in the database is bounded: two bytea columns, font_files.data (163 rows, 5.7 MB) and carrier_labels.pdf, which the daily retention run deletes after 30 days (src/server/retention.ts:450).
- Search by meaning reads only the asking store's vectors: product_embeddings has (store_id, space) and the query filters on both (src/server/search.ts:213-218). There is no vector index; that is fine until one store has tens of thousands of products.
- Every insert into commerce.pages names its columns (9 statements in src, 4 in SQL functions), so derived columns can be added to pages without touching a writer.
- Only three statements write commerce.ui_translations, all in src/server/ui-text.ts (lines 211, 305, 315), so a version stamp for the poll has two writers to change.
- Retention exists for nearly every log (status_checks 91 days, ai_usage 400 days, integration deliveries 30 days, cookie scans 90 days by a pg_cron job, carrier labels 30 days); the gaps are in DS-8 and DS-13.
- No client component imports schema.ts or a type from it.
- The migration folder is lean: four baseline files of 3.99 MB; the 789 old files are in supabase/archive by rule D572.
- queue_integration_event and the dispatcher's 'is anything due' first reads already follow use: a store with no integration or no due work costs an indexed probe.
