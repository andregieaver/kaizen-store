# db-schema: The database's shape

The database's shape is sound for a platform about to open: dead objects are rare (1 table, 5 columns, 34 leftover tables), triggers are gated by column and nearly every log has a retention rule; that 245 of 486 tables have held no row says only that the doors are still closed, and nothing is retired for it. What is worth fixing before opening is where cost does not follow use or grows with stores: pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it, every cold start evaluates a 1 MB schema file that no query uses (115 to 135 ms and 9 to 12 MB measured), 122 store filters are written so the store index cannot serve them, and page lists read whole documents (4.2 ms a call against 0.8 ms from a plain column, measured in a local Postgres 18). All 14 verified findings now have ordered steps, the tests and rules that hold them and one check; one was added: indexes are declared in two places and nothing compares them, which is how two of the three duplicates on orders and order_lines arrived. Do first DS-8 (the scheduler's log), DS-1 (the schema import), DS-7 (the store filter) and DS-15 with DS-9 (the duplicate-index test and the 13 drops); DS-6 (the platform kept twice) and DS-13's retention periods wait for the owner.

## Measures
- Tables, columns, JSON columns: 486 tables, 5,806 columns, 292 jsonb columns
- Indexes, triggers, functions: 1,988 indexes (production reports 1,989); 391 triggers; 617 functions, 331 of them trigger functions; all 617 carry a SET clause and 124 are SQL-language
- The hot tables' write cost in objects: 89 indexes and 60 triggers on the eight hot tables: orders 34 and 27, products 13 and 14, carts 11 and 1, order_lines 9 and 5, customers 8 and 6, product_variants 6 and 7, cart_lines 5 and 0, visits 3 and 0
- orders: 92 columns, 8 jsonb, 34 indexes (18 partial, 3 GIN), 27 triggers, 34 checks, 10 foreign keys out, 41 in. stores has 309 foreign keys pointing at it.
- Redundant indexes: 13 clear: 10 plain indexes that are a leading prefix of a unique key, orders_retention_idx and orders_invoice_candidates_idx (same key as orders_store_placed_idx, conditions nearly always true), and order_lines_order_idx (same key as the covering order_lines_…
- Indexes not declared in schema.ts: 46 of the 1,059 non-unique indexes are named nowhere in src/db/schema.ts; 12 of them sit on hot tables, among them orders_invoice_candidates_idx and order_lines_analytics_idx, each a twin of an index schema.ts does declare
- What an index on a nullable foreign-key column costs: 414 plain indexes end in a nullable foreign-key column (6 on carts, 8 on orders). Measured: a guest cart insert takes 30 to 34 µs with carts' 11 indexes and 23 to 26 µs when the six are made partial, so about 1 µs each; each stores about 7 bytes a row (btree …
- Page reads: whole document, JSON operator, plain column: 4.2 ms, 1.5 ms and 0.8 ms a call for one store's 29 published pages (252,719 bytes of rows against 4,265); the remembered-modal check 1.4 ms by jsonb_path_exists against 0.6 ms from a flag column
- The sandbox purge on the real schema: 400 store tables, so 400 dynamic deletes a pass and at least two passes; one pass that finds nothing took 64 to 293 ms and left 2,129 relation locks held by the transaction
- Schema module at server start: schema.ts is 1,059,413 bytes and 19,614 lines; 85 to 100 ms to evaluate and 30 to 37 ms for drizzle to index it, 9 to 12 MB of heap (the verified report's timing); its table definitions sit in 6 server chunk files of the finished build
- Queries that use the schema object: 0. One runtime importer (src/db/client.ts:11); the only other importers are src/server/store-export.scan.test.ts:4 and drizzle.config.ts:7
- Null-safe store comparison: 122 uses of `store_id is not distinct from` in 40 files (tests left out); 63 tables allow a null store_id; 19 platform_* tables
- Row level security: On for all 486 tables, 0 policies, forced on none: the app's role owns the tables, so no query pays for a policy
- Scheduled objects: 9 pg_cron jobs every minute, 1 every five minutes, 4 daily (two of them retention deletes); the dispatcher runs 78 jobs through runJobs() and 5 more after it
- Database size: 731 MB: pg_cron's run log 564 MB (77%), commerce 124 MB, pg_catalog 27 MB, net 8.5 MB; a leftover commerce_legacy schema holds 34 tables and 96 rows
- Database time of the app's top statements: About 2,360 s in 78 days (30 s a day) outside pg_cron's own 3,974 s of net.http_post; the three page statements are 968 s of it (781 + 66 + 121)

## Well made
- Dead columns are rare: six names appear nowhere outside schema.ts (I searched each: contact_checked_at, first_seen_at, secret_key_hint, webhook_secret_hint, legal_basis, source_updated_at), and legal_basis holds reference data.
- No SQL function is dead: supabase/seed.sql:232-241 calls the add_demo_* functions (I opened it), and only one function in the baseline builds statements from the catalog (purge_sandbox).
- Triggers are gated by column. I read the ones that fire on any product update (assert_product_publishable, products_first_active, integration_product_events) and on order lines: indexed lookups by store, no loops. carts has 1 trigger, cart_lines and visits no…
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

## Findings (15)

### DS-8 [P0 S oversize corrected] pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it
- evidence: The statistics give 731 MB for the database: the cron schema 564 MB, commerce 124 MB. pg_cron writes one row to cron.job_run_details per run with the whole command text. The baseline schedules 9 jobs a minute, 1 every five minutes and 4 daily (baseline_4:93-113, which I read): 13,252 rows a day. Two of the daily jobs are retention deletes (consents, cookie_scans); none prunes the run log. rg for job_run_details over…
- cost: Measured: 564 MB, 77% of the database. Estimate: about 8 MB more a day at today's schedule (13,252 rows of about 0.6 KB), about 3 GB a year, whatever the number of stores. Larger backups, slower restores and branches. (The database)
- fix: 7 steps; first: 1. Before writing the file, read two facts on production (one read-only statement through the Supabase tool): select has_table_privilege('postgres', 'cron.job_run_details', 'TRUNCATE') as may_truncate, count(*) as rows, pg_size_pretty(pg_total_relation_size('…
- done when: On production a week after the deploy, the size-by-schema query in /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/prod-db-stats.md shows the cron schema under 80 MB (564 MB today) where TRUNCATE ran, or select count(*) from cron.job_run_details is under 100,000 where only the d…
- saving: Estimate: about 500 MB once (where TRUNCATE is allowed) and growth of about 8 MB a day stopped at about 60 MB (7 days of rows).
- after: nothing
- notes: The verified report said to add the job 'in baseline_4's block and a new migration'; the baseline must not be edited, so only the new migration. Whether the postgres role may TRUNCATE or VACUUM FULL the table could not be checked here (production is not to be…

### DS-1 [P0 S eager confirmed] Every server start loads the whole schema file, which no query uses
- evidence: client.ts imports the whole schema (line 11) and hands it to drizzle() (line 78). No file uses the query builder: my rg for select, insert, update, delete, query or findMany on db() or tx finds only tests' own tx.query on PGlite. The only other importers of schema.ts are one scan test and drizzle.config.ts. The instance-start hook loads client.ts through ui-text.ts (instrumentation.ts:8). In the finished build 6 ser…
- cost: About 115 to 135 ms of CPU and 9 to 12 MB of memory at every cold instance start (measured on this machine, not on Vercel); the schema's 652 KB of minified code in 6 server chunk files. Per cold instance, so it grows wi… (The first shopper or owner on every cold instance; the build)
- fix: 5 steps; first: 1. src/db/client.ts: delete line 11 (import * as schema from "./schema"). Line 31 becomes type Database = NodePgDatabase; (drizzle's default, an empty schema). Line 78 becomes drizzle({ client: pool }). Db, withRows(), readDb() and replicaDb() keep their shap…
- done when: After pnpm build, rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l prints 0 (6 today).
- saving: Measured here: about 115 to 135 ms and 9 to 12 MB per cold start, and the schema's code out of 6 server chunk files.
- after: nothing
- tracked: Code review FD5, step 3.14 'Split schema.ts': Open (docs/audits/code-review-2026-11.md:116, :268, :484). The measurements and the fact that the instance-start …
- notes: Splitting schema.ts into src/db/schema/*.ts is P3: it saves no running cost once step 1 is in, and eight tests and one script name the file by path.

### DS-7 [P0 M oversize confirmed] `store_id is not distinct from` keeps Postgres from using the store indexes
- evidence: 122 uses in 40 files (my rg, tests left out). Postgres does not answer IS NOT DISTINCT FROM from a btree index; the verified check ran EXPLAIN ANALYZE in a local Postgres 18.6 on 50,000 rows of the pages shape: a sequential scan (3.5 ms) against an index scan for `=` (0.46 ms) and for `is null`. Production agrees: pages had 199,789 sequential scans reading 203 M rows although (store_id, type, slug) exists; cookie_sc…
- cost: About 1.2 billion rows read by scan in 78 days. Small in time today. It grows with stores times rows per table, and the cookie-scan claim grows with stores squared: every site's subquery scans every site's scans, every … (The database)
- fix: 6 steps; first: 1. New src/server/owned.ts: export const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`). The branch must be in code: `store_id = null` matches nothing. Replace the private cop…
- done when: The ratchet's new count of `store_id is not distinct from` sums to no more than the commented column-to-column joins left (122 today by rg -i -c over src), and on production seq_scan of commerce.cookie_scans in pg_stat_user_tables grows by fewer than 1,000 a day (about 14,000 a day today: 1,101,927 in 78 days).
- saving: Estimate: the sequential scans on pages, cookie_scans, terms and menus become index reads; a few seconds of database time a day now, and at scale the difference between an index probe and a full scan on each cache fill and each minute.
- after: nothing
- notes: The same work as DQ-8 in the queries dimension, with the same helper and ratchet: do it once, and first, so the new reads of DS-4 and DS-5 are written with the helper from the start. The ten hot reads alone are S.

### DS-15 [P1 S process added] Indexes are declared in two places and nothing compares them, which is how duplicates reached orders and order_lines
- evidence: An index is made either in src/db/schema.ts (drizzle writes the migration) or by hand in a custom migration, as the rule for hot tables requires for a concurrent build (docs/ci-migrations.md:60-62). pnpm db:check compares schema.ts with drizzle's own snapshot, so a hand-written index is invisible to it. On the migrated test database 46 of the 1,059 non-unique indexes are named nowhere in schema.ts, 12 of them on hot…
- cost: No direct cost. Each duplicate that slips in is one more index entry on every write of its table, and the hot tables are where hand-written indexes are made. (The database per write, later; CI)
- fix: 4 steps; first: 1. Add src/db/index-duplicates.test.ts, using createTestDatabase() from src/db/testing.ts like the other src/db tests. It runs one catalog query: for btree indexes of schema commerce, list each plain (not unique) index A whose key columns, taken with pg_get_i…
- done when: pnpm test runs src/db/index-duplicates.test.ts; its first case returns 0 rows (11 today) and it fails when a scratch migration adds create index on commerce.orders (store_id, placed_at).
- saving: No direct saving; it stops the next duplicate on a hot table at the commit that adds it.
- after: DS-9 (the 13 drops empty the first case)
- tracked: Partly: code review FD7 proposes a standing unused-index check after traffic (step 3.15, Open). A duplicate check at commit time is new.
- notes: Added by the completeness check. The query, run on the real schema in PGlite, is in /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/ds-plan/dupsql.mjs; the count of undeclared indexes is from the same script.

### DS-9 [P1 S oversize corrected] Thirteen indexes duplicate another; orders carries 34, five of them starting (store_id, placed_at)
- evidence: From the index list and the catalog of the migrated test database: ten plain indexes are a leading prefix of a unique key on the same table (account_recovery_codes_account_idx, api_tokens_store_idx, api_uploads_store_idx, legal_snapshots_store_idx, order_edits_order_idx, payout_lines_payout_idx, recurring_costs_store_idx, return_exchanges_return_idx, visits_store_day_idx, webhook_endpoints_store_idx). orders_retenti…
- cost: One extra index entry per row for each duplicate: 2 per order write, 1 per order line, 1 per counted visit. Small per write; visits is where it adds up after opening. (The database, per write)
- fix: 6 steps; first: 1. Hot tables first (orders, order_lines, visits are on the list of src/db/migration-safety.scan.test.ts:20). Custom migration: pnpm exec drizzle-kit generate --custom --name drop_duplicate_hot_indexes. First line `-- kaizen:no-transaction`; four statements s…
- done when: On the migrated test database select count(*) from pg_indexes where schemaname = 'commerce' gives 1,975 (1,988 today), and select count(*) from pg_indexes where schemaname = 'commerce' and tablename = 'orders' gives 32 (34 today).
- saving: Measured by count: 13 indexes; 2 fewer entries per order write, 1 per order line and 1 per counted visit.
- after: nothing
- tracked: Code review FD7, step 3.15 'Keep the big tables lean': Open. It counted 24 indexes and named orders_retention_idx; the count is now 34 and the list of 13 is ne…
- notes: The saving is small; it is P1 because it is half an hour now, while the tables are tiny, and the same change later needs care on busy tables. Land it with DS-15's test.

### DS-4 [P1 M oversize confirmed] A page's title, its titles by language and its flags live only inside its content JSON, so lists read and parse whole pages
- evidence: pages has 12 columns and no title: everything is in draft and published (baseline_1:28427-28440). listPublishedPages selects `published` for every page of a store and parses each (pages.ts:668-679); production: 79,778 calls, 781 s, 29 whole pages a call, the costliest app statement. publishedPageNames digs titles out with JSON operators (57,930 calls, 66 s) and usesRememberedModals runs jsonb_path_exists over every …
- cost: About 968 s of database time per 78 days in three statements (41% of the app's listed statements), plus parsing about 29 documents per call in Node. After opening it grows with stores times deploys and with cache fills … (The database; the server per uncached render and at build time)
- fix: 7 steps; first: 1. First the callers: DQ-2 in the queries dimension moves the 12 readers of one page to a publishedPageById() and the slug and title readers to a publishedPageIndex(). That removes most of the cost with no migration. The steps here are the structural part.
- done when: rg -n "published (->>|#>>)|jsonb_path_exists\(published" src/server/pages.ts src/server/page-modals.ts prints no line inside publishedPageNames or usesRememberedModals, and on production a week after the deploy the two statements (57,930 and 68,878 calls so far) no longer grow in pg_stat_statements.
- saving: Estimate. DQ-2 and DS-7 take most of the 781 s. The columns take what is left: about half of each title read and of each modal check (1.5 to 0.8 ms and 1.4 to 0.6 ms a call in PGlite), which is most of 187 s per 78 days today.
- after: DQ-2 (the queries dimension's fix for the same reads; do the callers first); DS-7 (the owned() helper for the changed where clauses)
- tracked: no (code review step 3.9 covers the catalogue, not pages)
- notes: The verified report proposed columns written at publish by every publishing path; stored generated columns need no writer, which removes that risk. Before opening is the cheap moment: the table rewrite is 1,389 rows now.

### DS-5 [P1 M eager confirmed] The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date
- evidence: refreshKnowledge loops over every site with its chat agent on (knowledge.ts:297). For each, syncPageKnowledge selects `published` for every published page and article (:170-176), then compares the page's date with the version kept on its passages. A page whose text yields no passages has no kept version, so it is cut again on every run: replacePassages opens a transaction and deletes by page (:249). Production: 91,2…
- cost: About 1,170 pointless transactions and about 310 whole-content reads a day today, for one or two sites. After opening, every five minutes all published content of each site with the chat on is read, changed or not. (The database and the server on every cron tick)
- fix: 7 steps; first: 1. Add a small table for what was cut, in src/db/schema.ts then pnpm db:generate: commerce.knowledge_sources (store_id uuid null references stores on delete cascade, page_id uuid null unique references pages on delete cascade, entry_id uuid null unique refere…
- done when: On production a day after the deploy the calls of `delete from commerce.knowledge_chunks where page_id = $1` in pg_stat_statements grow by fewer than 20 a day (about 1,170 a day today).
- saving: Estimate: the 91,200 delete transactions and nearly all 24,134 content reads per 78 days; at scale one slim read per site per tick instead of all its documents.
- after: DS-7 (owned() in the new reads)
- notes: The same work as DQ-6 in the queries dimension, which rates it P0 and names the same table; do it once. Rated P1 here because the chat agent is off by default, so the cost starts only where an owner turns it on. Steps 1 and 2 alone end the 91,200 transactions…

### DS-10 [P1 S eager corrected] Where each picture is used is found by text-searching every page's JSON, again every day for every picture
- evidence: mediaUses() casts each page's draft and published JSON to text and searches it for each picture's address and its small copy's (media-library.ts:321-322), and does the same for entries, menus, saved parts, the theme and navigation. embedMedia() treats a picture as stale when its vector is older than one day, 'so what uses an item is kept current' (:795-799, :810), and calls mediaUses for up to a run's worth of pictu…
- cost: About 380 s of database time per 78 days today, the second costliest app statement. It grows with pictures times pages per site, for every site with media, every day, whether or not anything changed. (The database and the server per cron tick; the owner's media library when it sh…)
- fix: 4 steps; first: 1. Keep the rule: uses are looked up, never stored. In embedMedia() replace the one-day clause at :810 with a change test. Before the stale read, read one stamp for the site: the greatest of max(updated_at) over the site's rows in the tables mediaUses() reads…
- done when: On production n_tup_upd of commerce.media_embeddings in pg_stat_user_tables grows by fewer than 50 a day while no content changes (about 172 a day today: 13,414 in 78 days).
- saving: Estimate: most of the 3,053 scans and of the 13,414 date-only updates per 78 days; at scale one small read per idle site per tick instead of a full search a day.
- after: nothing
- notes: DQ-3 in the queries dimension describes the same read; its steps 3 to 5 keep uses in a new table, which goes against the written rule at media-library.ts:27. This plan stops at the change test. Storing uses is worth weighing only if the library's own 'used in…

### DS-3 [P1 S eager corrected] Two scheduled jobs do work that does not follow use: a prune every minute and an invoice retry every five minutes for 120 days
- evidence: (a) deliverDue() ends every call with its 30-day prune (integrations.ts:1062) and deliverPlatformDue() with its own (platform-integrations.ts:483-485); the route runs both every minute: 66,533 runs of the claim and of the delete. The table's four indexes lead on next_attempt_at, endpoint_id and store_id (I read them from the catalog); none leads on created_at, so once deliveries exist the prune scans the table every…
- cost: Measured: 167 s of database time in 78 days for the invoice retry with no invoice produced; 133,066 statements for the per-minute claim and prune. Estimate after opening: about 4.8 s of database time a day for each stor… (The database and the server on every cron tick)
- fix: 6 steps; first: 1. src/server/integrations.ts: move the delete at :1062 out of deliverDue() into an exported pruneDeliveries(). Keep the constant KEEP_DAYS at :47 in this file: src/lib/retention.test.ts:82 reads it from here. src/server/platform-integrations.ts:483-485: the …
- done when: On production a week after the deploy, calls of `select commerce.issue_waiting_invoices($1, $2)` in pg_stat_statements grow by fewer than 20 a day while no store has an issuable invoice waiting (about 127 a day today), and the delete on commerce.integration_deliveries grows by 1 a day (about 853 a day today).
- saving: Measured today: 167 s per 78 days and 133,066 statements. Estimate at scale: about 4.8 s of database time a day per store that sells before its details are complete.
- after: nothing
- notes: DQ-15 in the queries dimension plans the document jobs more widely (indexes for the short windows, an hourly net); this is the smallest change for the two measured cases and fits beside it. The job list's overstated times need no fix of their own: DQ-5 runs t…

### DS-13 [P1 M oversize confirmed OWNER-CHOICE] Retention gaps: carts and processed webhook events are never deleted, the status prune scans on every tick, and the docs index is rewritten whole
- evidence: (1) status_checks gets 6 rows every five minutes and the same job prunes by checked_at on every tick (status.ts:266); its only index is (component, checked_at) (baseline_3:12841): 1,072 sequential scans so far, and the table heads to about 157,000 rows at its 91 days. (2) page_versions keeps 50 versions a page with no age limit (page-versions.ts:38-44): 642 rows are 5.4 MB, so a page at its cap holds about 420 KB. (…
- cost: Small today. After opening, carts is the gap that grows with shoppers: one row with 11 index entries, plus its lines, for every basket ever started; in PGlite a bare cart is about 141 bytes of heap and 163 of indexes. p… (The database)
- fix: 6 steps; first: 1. src/server/status.ts: move the two deletes at :266-269 into an exported pruneStatus() and call it from the daily route (src/app/api/cron/subscription-reminders/route.ts, the list at line 79). The five-minute job then only inserts. No new index.
- done when: On production seq_scan of commerce.status_checks in pg_stat_user_tables grows by fewer than 10 a day (about 288 a day today), and each table named in FD8 has a delete step with its period in src/lib/retention.ts.
- saving: Estimate: 287 scans a day of a table heading to 157,000 rows; about 1,800 fewer row rewrites per docs deploy; a ceiling on carts and on page history that today have none.
- after: The owner's periods for carts, processed webhook events and page history (code review Question 6)
- tracked: FD8, step 3.15 and Question 6 of the code review: Open, for the tables retention blanks and never deletes. The status_checks, page_versions and docs_index poin…
- notes: Steps 1 and 2 need no decision and are S. The verified report listed carts in one line; it is the gap that grows with shoppers, so it is spelled out here.

### DS-12 [P1 S process corrected OWNER-CHOICE] Nothing counts what a new table, trigger, index or scheduled job adds to the running cost
- evidence: Advisors are read by hand after a migration (docs/ci-migrations.md:154). The ratchet that exists counts unchecked reads, casts and writes by id (ratchet.baseline.json has four keys, none about the database's shape). No test counts triggers or indexes on the hot tables, per-minute pg_cron jobs or dispatcher jobs. Today's numbers, from the catalog of the migrated test database and the source: 89 indexes and 60 trigger…
- cost: No direct cost. Without a count, the things that cost per write or per tick (a trigger on orders, an index on visits, a new per-minute route, a job that reads every site on a timer) arrive unseen with each feature. (The database per write and per tick; CI; every agent that reads the schema)
- fix: 6 steps; first: 1. Add src/db/schema-budget.test.ts, using createTestDatabase() from src/db/testing.ts. It counts, for each table of HOT_TABLES (exported by src/db/migration-safety.scan.test.ts:20), its indexes (pg_index) and its triggers (pg_trigger where not tgisinternal).
- done when: pnpm test runs src/db/schema-budget.test.ts, and it fails when a scratch migration adds a trigger on commerce.orders without a change to src/db/schema-budget.json.
- saving: No direct saving; it makes the next per-write or per-tick cost a visible choice.
- after: DS-9 (drop the duplicates first, so the budget starts at orders 32, order_lines 8, visits 2)
- tracked: Partly: FD7 proposes a standing unused-index check (step 3.15, Open); docs/ci-migrations.md:154 notes advisors are checked by hand.
- notes: A budget is a way of working, so it is the owner's to adopt. It is aimed at what costs per write and per tick, not at tables that hold no row yet. DS-15's duplicate-index test is its companion and needs no decision.

### DS-6 [P1 L duplicate corrected OWNER-CHOICE] Kaizena Flow's own site and tools are kept more than one way: null-store rows, platform_* twin tables, and a copy in its own store
- evidence: 63 tables allow a null store_id for Kaizena Flow's own rows and 19 platform_* tables exist (catalog of the migrated test database); the parity plan counted 9 twins on 6 November and says why the gap opens: each store feature is built once for stores and again for the platform (docs/platform-parity-plan.md:32-35). The twins double jobs: the every-minute route runs runWorkflows and runPlatformWorkflows, deliverDue and…
- cost: A true duplicate: two engines for one job (workflows, deliveries, theme installs), twin jobs every minute and every five minutes, and the null-safe comparisons of DS-7 in 40 files. The running cost is small; the main co… (Every future feature, built twice; the database and server per tick, slightly)
- fix: 5 steps; first: 1. The owner decides whether to make the switch before opening, when the site has the least to lose and nobody to disturb, or to keep both copies for now.
- done when: docs/platform-parity-plan.md step 7 is marked done and ls src/server/platform-theme-installs.ts src/server/platform-roles.ts finds neither file.
- saving: Estimate: the site's null-store paths, a handful of twin tables and their jobs after step 7, and one build instead of two for each later site feature.
- after: The owner's decision on the switch (docs/platform-parity-plan.md step 5)
- tracked: docs/platform-parity-plan.md: step 5 built and off (D484), step 6 and step 7 'One copy' not done. The twins of the console track (D516, D518, D523) are the pla…
- notes: Not waste: a choice the owner already framed. Before opening is the cheapest time to make it, because the site has no real visitors to lose and the store has no real data to migrate.

### DS-2 [P2 S eager corrected] Each server start waits for a read of the interface-text table, and every warm instance asks again each minute
- evidence: register() awaits startUi() (instrumentation.ts:6-9), which runs `select lang, count(*), max(updated_at) from commerce.ui_translations group by lang` before the instance takes requests, then loads each changed language with its own query, one after the other (ui-text.ts:64-71). A timer repeats the group-by every 60 s in each warm instance (:31, :110-112). Production: 278,393 calls in 78 days, the second most-called …
- cost: Today: one small query before the first request of each instance and about 3,570 polls a day. After opening the poll counts every row of every machine-translated language (about 100 KB of English text per language by th… (The first request on every cold instance; the database)
- fix: 5 steps; first: 1. src/db/schema.ts, table platform_settings: add ui_text_version bigint not null default 0; pnpm db:generate (one row; a constant default is instant).
- done when: On production a day after the deploy, calls of the group-by on commerce.ui_translations in pg_stat_statements grow by fewer than 50 a day with no text edited (about 3,570 a day today).
- saving: Estimate: the group-by runs only after an edit; the poll becomes a one-row read ten times rarer (about 357 a day at today's instance count). A few milliseconds at most per cold start today; more once languages are translated, because they load in one read.
- after: nothing
- notes: The same work as DQ-12 in the queries dimension; do it once. Do it when ui-text.ts is next opened and before many languages are machine-translated (the nightly run of D436 fills the table).

### DS-14 [P2 S dead corrected] A very short list of dead database objects: one table, five columns and a leftover schema
- evidence: idempotency_keys: no code names it outside schema.ts and five registers (my rg, with the two api_*_idempotency_keys tables left out), and the personal-data register says 'An unused table… nothing is written to it' (personal-data.ts:238). Its enum idempotency_status is used by this table only (schema.ts:289, :7187). Five column names appear in no file of src but schema.ts: domain_registrations.contact_checked_at, not…
- cost: No running cost. About 100 lines across schema.ts, the baseline and five registers for the table; 34 leftover tables in production's backups. (An agent's session and anyone reading the schema)
- fix: 5 steps; first: 1. src/db/schema.ts: delete the table idempotencyKeys (:7180 on) and the enum idempotencyStatus (:289). pnpm db:generate writes DROP TABLE and DROP TYPE; no running code uses either, so one push is safe.
- done when: rg -n 'idempotency_keys' src | rg -v 'api_(app_)?idempotency_keys' prints nothing, and production's size-by-schema query lists no commerce_legacy schema.
- saving: Measured: 1 table, 1 enum, later 5 columns, and 34 leftover tables in production.
- after: nothing
- tracked: commerce_legacy: noted in docs/decisions.md:424 as removable later; no step. The rest: no.
- notes: This is dead code, not a feature waiting for opening: nothing can write to the table. Dropping commerce_legacy is the one step that needs the owner's word.

### DS-11 [P3 S oversize corrected] Ending one sandbox runs at least 800 deletes and holds about 2,100 locks, one pass per store table per round
- evidence: purge_sandbox() loops over every commerce table with a store_id column but two and runs a dynamic DELETE in its own exception block, and repeats the whole pass until a pass deletes nothing (baseline_1:15393-15417): at least two passes. On the real schema that is 400 tables. I ran the function's own loop in PGlite for a store id that owns nothing: one pass is 400 statements, took 64 to 293 ms (the first run, with col…
- cost: Estimate: 0.1 to 0.5 s of database time per ended sandbox. Measured: about 2,100 lock entries held until commit, which is a third of a default Postgres lock table (64 a connection, 100 connections). Both rise with every… (The database, per expired sandbox)
- fix: 4 steps; first: 1. Small step, now: a custom migration that replaces commerce.purge_sandbox() with the same body and one new first statement, PERFORM pg_advisory_xact_lock(hashtext('commerce.purge_sandbox')), so two purges never hold their locks at the same time (two dispatc…
- done when: src/server/sandbox.int.test.ts has a case where two purges started together both finish, and docs/builder-sandbox.md states production's max_locks_per_transaction and max_connections beside the 2,129 locks one purge holds.
- saving: No time saved by step 1; it removes the case of two purges holding about 4,300 lock entries together. Step 3, if ever needed: from about 2,100 locks in one transaction to about 300.
- after: nothing
- notes: Not worth more than step 1 now: the cost follows use, is a fraction of a second, and one purge fits a default lock table. The verified report's fix (ask first which tables hold a row) would not lower the lock count: the asking locks the same tables and indexe…

## Refuted (not findings)
- DS-16 The dispatcher does 12.5 s of database work every five minutes for unused features: runJobs() starts all its jobs at once (src/server/cron-runs.ts:117) on a pool of 5 connections (src/db/client.ts:68) and times each around the whole job, so the per-job times overlap; the whole tick took about 1.3 s. Mo…
- DS-17 Seven SQL functions are called by nothing: supabase/seed.sql:232-241 calls the add_demo_* functions and the Demo products rule requires them; bonus_verify and referral_verify are documented checks that tests call.
- DS-18 The 245 tables that never held a row and the 1,006 indexes never scanned are bloat to retire: The platform is not open yet, so every feature is unused; 966 of those indexes sit on tables waiting for their first row. No running cost was shown for them.
- DS-19 Indexes on nullable foreign-key columns should become partial (414 of them, 6 on carts, 8 on orders): My own candidate, refuted by measurement: about 1 µs and 7 bytes a row each on carts in PGlite, because btree deduplicates the NULL entries.
- DS-20 The 39 unique (store_id, id) keys that no foreign key points at are redundant: They are rule P1's anchor (docs/platform.md:12); adding one later on a hot table is harder than having it from the start.
