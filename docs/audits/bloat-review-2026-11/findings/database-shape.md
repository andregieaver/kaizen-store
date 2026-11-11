# The database's shape (DS)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** The database is wide, not rotten. About half of it has never been used: 245 listed tables of 486 never held a row, and they carry 47% of all columns, 49% of all indexes, 50% of all foreign keys and 45% of the lines of schema.ts. Table by table the work is careful: almost no dead columns or functions, only 15 prefix-redundant indexes, triggers gated by column, and a retention rule for nearly every log. The running cost comes from a few habits: the whole schema file is loaded at every server start though no query uses it, work is found by polling and by re-reading whole JSON documents, unused features still run on every tick and write, and the platform itself is modelled three ways. The absolute load is small today (731 MB, the top statements cost about 81 s of database time a day), so the gain is in cold starts, function time and stopping growth, not in rescuing a struggling database.

## Measured

| Measure | Value | How |
|---|---|---|
| Tables, columns, JSON columns | 486 tables, 5,806 columns, 292 jsonb columns | Parsed CREATE TABLE blocks of supabase/migrations/20261111172839_baseline_1_schema.sql with a node script (scratch work/ds/cols.mjs) |
| Share of the schema that belongs to never-used tables | 245 listed tables (the stats file says 255 but lists 245): 2,723 of 5,806 columns (47%), 966 of 1,988 indexes (49%), 553 of 1,106 foreign keys (50%), 131 of 391 triggers (34%), about 8,838 of 19,614 lines of schema.ts (45%) | Joined the never-held-a-row list in prod-db-stats.md with the parsed baseline (work/ds/idxcat.mjs, groups.mjs) |
| Indexes by kind | 1,988 parsed (production reports 1,989): 485 primary keys, 267 unique constraints, 177 unique indexes, 1,059 plain; 239 partial; 25 GIN; 657 are exactly a foreign key's columns; 256 only back a foreign key to accounts (created_by, updated_by and the like) | Parsed CREATE INDEX and ADD CONSTRAINT in 20261111172841_baseline_3_rules.sql (work/ds/indexes.mjs, idxcat.mjs) |
| Redundant indexes | 15 (3 exact duplicates, 12 leading prefixes of another index), 8 on used tables; 39 unique (store_id, id) keys that no foreign key points at (10 on used tables) | Same script: btree index whose columns equal or lead another btree index on the same table, with a compatible WHERE; list in work/ds/redundant.tsv |
| orders | 92 columns, 8 jsonb, 34 indexes (18 partial, 3 trigram GIN), 27 triggers, 10 foreign keys out, 41 in; 102 rows in production | Parsed baseline; rows from prod-db-stats.md |
| Triggers on hot tables per event | orders: 7 on insert, 11 on a status change, 1 on any update; products: 8 on insert, 4 on any update; payments: 9 on insert; product_variants 5 on insert; order_lines 3; carts 0 on insert; cart_lines 0; visits 0; prices 1 | Parsed CREATE TRIGGER lines of baseline_3 and their event lists (work/ds/parsed.json) |
| Wide rows | stores 66 columns (8 jsonb), platform_settings 37 (6 jsonb), pages 12 (draft and published jsonb, no title column), design_presets 26 (snapshot, draft, listing jsonb) | Parsed baseline (work/ds/cols.mjs) |
| SQL functions | 617 (331 trigger functions, 15,811 body lines); 7 are called by nothing | Parsed CREATE FUNCTION bodies; searched src, scripts, triggers, other functions, views (work/ds/fns.mjs) |
| Columns no code names | 59 of 5,806 (1.0%) are not named in any file or SQL body that names their table; 6 names appear nowhere. Sample of 150 columns (every 38th): 1 unnamed, 11 more are written but never read by name (audit stamps) | work/ds/deadcols2.mjs and sample.mjs against src (tests and schema.ts excluded) and SQL function bodies; write-only ones opened by hand |
| Schema module at server start | schema.ts is 1,059,413 bytes; 652 KB of its own code minified (1.16 MB with what it imports); present in 6 server chunks of the finished build; 86 to 117 ms to evaluate, 30 to 42 ms more for drizzle to index it, about 10 MB of heap | esbuild bundle of src/db/schema.ts into scratch, node --expose-gc timing over 8 runs on this machine (load average 2.8); rg for the table definitions in .next/server chunks |
| Queries that use the query builder or the schema object | 0. One runtime importer of schema.ts (src/db/client.ts); 1,182 files import only `sql` from drizzle-orm | rg over src for schema imports, findMany/findFirst, db().select/insert/update/delete |
| Null-safe store comparison | 122 uses of `store_id is not distinct from` in 40 files; pages had 199,789 sequential scans, cookie_scans 1,101,927, terms 183,724 | rg -i over src (tests excluded); scan counts from prod-db-stats.md |
| Platform modelled three ways | 63 tables with a nullable store_id, 19 platform_* tables (14 twins of a store table; 12 never used), plus the house store | Parsed baseline for `store_id uuid` without NOT NULL and for platform_ names; never-used list from prod-db-stats.md |
| Database time of the top statements | 6,334 s over 78 days (81 s a day); 3,974 s of it (63%) is pg_cron's own net.http_post calls | Summed the Total column of the costliest-statements table in prod-db-stats.md |
| Database size outside the app's schema | 607 MB of 731 MB | prod-db-stats.md: database 731 MB, commerce schema 124 MB |

## Well made, and should stay

- Dead columns are rare: 59 of 5,806 columns (1.0%) are not named by any code that touches their table, most of them created_at stamps; only 6 column names appear nowhere in the app or in SQL functions.
- SQL functions are used: 7 of 616 are called by nothing (five add_demo_* and two *_verify, 306 lines).
- Classic index redundancy is small: 15 of 1,988 indexes duplicate or lead another index. The 1,006 never-scanned indexes are mostly a symptom of never-used tables (966 indexes sit on them), not of careless indexing.
- Triggers are gated by column: of the 27 on orders, 23 fire only when named columns change and 1 on any update. The shopper's hottest tables carry almost none: carts 1, cart_lines 0, visits 0.
- Retention is in place for nearly every log: status_checks 91 days (src/server/status.ts:266; the '0 deletes' in the statistics only means the table is younger than its limit), ai_usage 400 days, audit_log 24 months, visits, speed samples 90 days, search logs, docs reads, page_versions 50 a page, cookie_scans 90 days by a pg_cron job (baseline_4:106-113). cron_jobs is one upserted row per job and does not grow.
- platform_settings is never read whole: 29 distinct column lists in 29 files, each naming what it needs. The store read (src/server/stores.ts:232-281) names its columns and is cached per store.
- No client component imports schema.ts or types from it: the only importers are src/db/client.ts, one scan test and drizzle.config.ts.
- Logos and site icons are stored as URLs inside the navigation JSON, not as embedded image data.
- The migration folder is already lean: one 2.7 MB snapshot and four baseline files of 3.9 MB (code review steps 0.3 and 1.7, done).
- Every store table but four has a plain index leading on store_id (398 of 402), and every table is classified in the export, copy and personal-data registers by scan tests.

## Findings

### DS-1 ✓ Every server start loads the whole schema file, which no query uses

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.1.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `src/instrumentation.ts:6`, `src/db/schema.ts:1`, `.next/server/instrumentation.js.nft.json`
- **Evidence:** client.ts does `import * as schema` and passes it to drizzle(). No file uses the query builder or the relational API: 0 findMany/findFirst, 0 db().select/insert/update/delete, and 1,182 files import only `sql`. The finished build's instrumentation entry traces to chunk _1pmw-ihec6glt (2.34 MB), which holds all 481 table definitions; the same definitions (about 585 KB each time) sit in 6 server chunks. Timed in node on this machine: 86 to 117 ms to evaluate the module, 30 to 42 ms for drizzle to index it (0.04 ms without), about 10 MB of heap.
- **Cost today:** About 120 to 150 ms of CPU and 10 MB of memory at every server instance start (measured here, not on Vercel); about 3.5 MB of repeated code in the server output; 19,614 lines (about 1 MB of text) an agent must slice to read one table. Paid by: The first shopper or owner on every cold instance; the build; an agent's session
- **Fix:** Step one, small: drop the `schema` argument and the import in client.ts (`drizzle({ client: pool })`, `NodePgDatabase` without the type argument). schema.ts stays as the source for drizzle-kit only. Step two: split it by area into src/db/schema/*.ts with `pnpm db:check` writing no migration.
- **Saving:** Measured: about 120 to 150 ms and 10 MB per cold start; 652 KB of minified code out of each of 6 chunks. Step two saves reading cost for people and agents only.
- **Risk:** Low. Nothing reads db().query or a table object. Check the type of Db still compiles and run the integration tests.
- **Already tracked:** Code review FD5, step 3.14 'Split schema.ts': Open. The measurements and the fact that the instance-start hook loads it are new.

### DS-2 ✓ Each server start waits for a database read of an empty table, then asks again every minute

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Where:** `src/instrumentation.ts:6`, `src/server/ui-text.ts:57`, `src/server/ui-text.ts:61`, `src/server/ui-text.ts:106`, `src/server/ui-text.ts:110`, `src/server/ui-text.ts:31`
- **Evidence:** register() awaits startUi(), which runs `select lang, count(*), max(updated_at) from commerce.ui_translations group by lang` before the instance may take requests (Next's guide: register 'must complete before the server is ready'). A timer repeats it every 60 s in each warm instance. Production: 278,393 calls in 78 days, the second most-called statement; ui_translations has never held a row.
- **Cost today:** One connection set-up and one query before the first request of every instance (not timed here), plus about 3,570 queries a day for nothing. It is also what pulls the database client and DS-1's schema into every instance, whatever the route. Paid by: The first request on every cold instance; the database
- **Fix:** Load a language's translations on first use of a language that is not built in, not at start. Replace the per-instance timer with a cached read refreshed by a tag when the platform admin saves translations (reloadUi already knows when).
- **Saving:** Estimate: one database round trip off every cold start and 278,393 queries per 78 days gone. Instances that never query the database no longer open a connection at start.
- **Risk:** Low to medium. t() is synchronous, so the first render in a machine-translated language must await the load; today no such texts exist.

### DS-3 Unused features still run in the database on every write and every tick

- **Kind:** ahead of use. **Effort:** M. **Confidence:** medium. **Step:** 0.4.
- **Where:** `supabase/migrations/20261111172839_baseline_1_schema.sql:15459`, `supabase/migrations/20261111172841_baseline_3_rules.sql:15361`, `supabase/migrations/20261111172841_baseline_3_rules.sql:15368`, `src/app/api/cron/integrations/route.ts:27`, `src/app/api/cron/cart-reminders/route.ts:128`, `src/server/referrals.ts:60`, `src/server/site-cookies.ts:53`, `src/server/invoice-issue.ts:124`
- **Evidence:** Grouped the 245 never-used tables by feature (largest: integrations, API and workflows 24 tables; email, SMS and automations 21; site extras 21; loyalty 17; analytics extras 17; invoices and books 15). Their costs today: 21 triggers on live tables (orders, products, customers, inventory_levels, refunds, shipments) call queue_integration_event, which runs 3 insert-selects against store_integrations, webhook_endpoints and workflows, all empty. The every-minute integrations route ran an update and a delete on integration_deliveries 66,533 times each; the table never held a row. issue_waiting_invoices ran 9,909 times (132 s) and invoices never held a row. bonus_expire_due ran 11,790 times (25 s) with empty bonus tables. referral_program() was read 42,078 times and cookie_notes 70,278 times, both features empty. By script, 8 dispatcher jobs name only never-used tables (api-idempotency, oauth-tokens, activities, business-changes, recommendations, instagram, support-actions, domain-registrations): 801 ms of last-run time per tick; most other jobs are driven by an empty table too.
- **Cost today:** Per write: 3 extra statements on each product save, stock change, customer change and order event. Per tick: at least 801 ms of job time every 5 minutes for jobs that can find nothing, and 2 statements a minute on a table that was never used. Per paid order: 11 triggers, four of which re-read the whole 92-column order row to look in empty tables (about 1 to 3 ms, estimate). Paid by: The database and the server on every cron tick; an owner's save; another auditor covers the schedule itself
- **Fix:** Give each optional feature one cheap 'in use' fact (a settings or connection row exists) and check it first: the dispatcher reads the set once per run and skips jobs whose feature no store has; queue_integration_event returns at once when the store has no integration, endpoint or workflow (one exists() instead of three insert-selects). Decide retiring features separately.
- **Saving:** Estimate: at least the 801 ms per tick measured for the 8 jobs, likely several seconds of the 12.5 s; 133,066 statements per 78 days on integration_deliveries; two of three statements per integration trigger.
- **Risk:** Low if the gate reads the same tables the job would read. A feature switched on mid-run waits one tick.

### DS-4 A page's title, parts and flags live only inside its content JSON, so lists read and parse whole pages

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 2.10.
- **Where:** `src/server/pages.ts:664`, `src/server/pages.ts:669`, `src/server/pages.ts:715`, `src/server/pages.ts:799`, `src/server/pages.ts:862`, `src/server/page-modals.ts:24`, `src/server/forms.ts:78`, `src/server/product-questions.ts:54`, `src/app/s/[store]/[market]/[slug]/page.tsx:20`, `supabase/migrations/20261111172839_baseline_1_schema.sql:28427`
- **Evidence:** pages has 12 columns and no title: everything is in draft and published. listPublishedPages selects `published` for every page of a store, and 20 of its 35 call sites then pick one page by id or need only slugs (generateStaticParams, front page, role pages, checkout terms). In production it is the costliest app statement: 79,778 calls, 781 s, 29 whole pages a call. Titles are dug out of the JSON 57,930 times (66 s). Whether a store uses a form or a modal is answered by jsonb_path_exists over every published page: 68,878 calls, 121 s. 60 JSON-path reads of page content in 32 server files.
- **Cost today:** About 970 s of database time per 78 days in three statements (15% of the top list), plus parsing about 29 pages of JSON per call in Node and keeping them as one cache entry per store. Paid by: The database; the server per uncached render and at build time
- **Fix:** Add plain columns kept at publish (title, a small flags or part-kinds array). Add `publishedPageById()` and `publishedPageSlugs()` and move the find-by-id and slug-only callers to them. Answer 'does this site use a modal or this form' from the flags column.
- **Saving:** Estimate: most of the 970 s; each list call returns a few hundred bytes instead of about 29 documents.
- **Risk:** Medium. The new columns must be written by every path that publishes (publish, schedules, theme updates, store copy); backfill in the same migration. Additive, so the running code keeps working.
- **Already tracked:** no (step 3.9 covers the catalogue, not pages)

### DS-5 The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.10.
- **Where:** `src/server/knowledge.ts:171`, `src/server/knowledge.ts:187`, `src/server/knowledge.ts:192`, `src/server/knowledge.ts:249`, `src/server/knowledge.ts:297`, `src/lib/knowledge.ts:65`
- **Evidence:** syncPageKnowledge selects `published` for every published page of each site with a chat agent, then compares the page's date with the version stored on its passages. A page whose text yields no passages (cutPassages returns [] for empty text) has no stored version, so it is cut again on every run: one transaction with `delete from knowledge_chunks where page_id`. Production: 91,200 such deletes for 782 rows ever deleted, 1,060 inserts; the content read ran 24,134 times at up to 16 ms.
- **Cost today:** About 1,170 pointless transactions a day and about 310 whole-content reads a day; the job's last run took 542 ms. Paid by: The database and the server on every cron tick
- **Fix:** Select id, published_at and the stored version without `published`; fetch content only for pages whose date changed. Record the cut version for a page with no passages (a column on pages, or a row in a small state table) so it is not cut again.
- **Saving:** Estimate: the 91,200 delete transactions and nearly all 24,134 content reads per 78 days.
- **Risk:** Low. Add a test: a published page with only pictures is cut once.

### DS-6 The platform is modelled three ways: null-store rows, platform_* twin tables and its own store

- **Kind:** duplicate. **Effort:** L. **Confidence:** medium. **Step:** 3.2. **The owner's decision.**
- **Where:** `docs/platform-parity-plan.md:32`, `docs/platform-parity-plan.md:118`, `src/app/api/cron/integrations/route.ts:31`, `src/app/api/cron/cart-reminders/route.ts:266`, `src/app/api/cron/cart-reminders/route.ts:269`, `src/server/pages.ts:71`
- **Evidence:** 63 tables allow a null store_id for Kaizena Flow's own rows. 19 platform_* tables exist (the parity plan counted 9 on 6 November); 14 are twins of a store table and 12 never held a row; in 8 pairs neither side ever did (workflows, workflow_runs, webhook_endpoints, integrations, integration_deliveries, api_tokens, ad_conversions, marketing_spend). Since D484 the site is served from the house store, so the null-store pages and menus are a second copy. Each twin doubles jobs: the every-minute route runs runWorkflows and runPlatformWorkflows, deliverDue and deliverPlatformDue; the dispatcher runs theme-updates and platform-theme-updates.
- **Cost today:** Twin tables, twin jobs every minute and every 5 minutes, and the null-safe comparisons of DS-7. 12 never-used platform_* tables with their indexes and code. Paid by: The database and server per tick; every future feature built twice
- **Fix:** Finish step 7 of the parity plan: remove the null-store site paths and retire the twins. Until then, build no new platform_* twin: put Kaizena Flow's rows in the house store, and keep platform_* only for things with no store form (sign-ups, plans).
- **Saving:** Estimate: up to 14 twin tables and their jobs, and the null branch in 56 server modules (the plan's own count).
- **Risk:** Medium. The plan already says the null rows go only weeks after the switch.
- **Already tracked:** docs/platform-parity-plan.md step 7 'One copy': not done. Twins have kept being added since (D516, D518, D523).

### DS-7 ✓ `store_id is not distinct from` keeps Postgres from using the store indexes

- **Kind:** oversize. **Effort:** S. **Confidence:** medium. **Step:** 0.7.
- **Where:** `src/server/pages.ts:71`, `src/server/site-cookies.ts:46`, `src/server/cookie-scans.ts:96`, `src/server/taxonomy.ts:60`, `src/server/css-versions.ts:20`, `src/server/content-types.ts:80`, `src/server/media-library.ts:77`, `src/server/text-styles.ts:24`
- **Evidence:** 122 uses in 40 files. Postgres cannot answer IS NOT DISTINCT FROM from a btree index, so each such read scans the table. Production agrees: three page statements written this way ran 206,586 times and pages had 199,789 sequential scans (203 M rows read) though a (store_id, type, slug) key exists; cookie_scans had 1,101,927 scans (962 M rows); terms 183,724. The every-minute cookie-scan claim runs two such subqueries per site. Other files already write the indexable form (media-library.ts:77, text-styles.ts:24). Not confirmed with EXPLAIN: production may not be queried.
- **Cost today:** About 1.2 billion rows read by scan in 78 days. Small in time today; it grows with stores times rows, and the cookie-scan claim grows with stores squared. Paid by: The database
- **Fix:** One shared helper that emits `store_id = $1` for a store and `store_id is null` for the platform, used by the owner helpers (pages.ts:71, css-versions.ts:20, taxonomy.ts:60 and the rest). A scan test that fails on a new `store_id is not distinct from` in a where clause.
- **Saving:** Estimate: the sequential scans on pages, cookie_scans, terms and menus become index reads; a few seconds of database time a day now, the difference between index and full scan at scale.
- **Risk:** Low. Only where clauses change; leave unique keys and on-conflict targets as they are.

### DS-8 ✓ 607 MB of the 731 MB database is outside the app's schema, and the scheduler's own run log has no pruning job

- **Kind:** oversize. **Effort:** S. **Confidence:** low. **Step:** 0.5.
- **Where:** `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:93`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:105`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:106`
- **Evidence:** The statistics give 731 MB for the database and 124 MB for commerce. pg_cron writes one row to cron.job_run_details per run, with the whole command text. The schedule is 9 jobs a minute, one every 5 minutes and 4 daily: 13,252 rows a day. The baseline schedules two retention jobs (consents, cookie_scans) and none for the run log; a search of migrations, the archive, src and docs finds no mention of job_run_details. 352,514 net.http_post calls are recorded. That the run log is the bulk of the 607 MB is an estimate; it was not measured.
- **Cost today:** Estimate: several hundred MB of the database, growing by about 13,000 rows a day. Larger backups and slower restores and branches. Paid by: The database
- **Fix:** First confirm with one size query on cron.job_run_details and net._http_response. Then add a daily pg_cron job that deletes run-log rows older than 7 days, in baseline_4's block and a new migration. Fewer per-minute jobs shrink it further.
- **Saving:** Estimate: most of the 607 MB, if the run log is what fills it.
- **Risk:** Low. The app keeps its own job ledger in commerce.cron_jobs.

### DS-9 orders has 34 indexes, four of them starting (store_id, placed_at); 15 indexes in all are redundant

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 4.1.
- **Where:** `supabase/migrations/20261111172841_baseline_3_rules.sql:10328`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10342`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10384`, `supabase/migrations/20261111172841_baseline_3_rules.sql:10419`, `supabase/migrations/20261111172841_baseline_3_rules.sql:14206`, `src/db/schema.ts:4899`, `src/db/schema.ts:4901`, `src/db/schema.ts:13544`
- **Evidence:** Parsed from the baseline: orders has 34 indexes for 102 rows (18 partial, 3 trigram GIN). orders_retention_idx and orders_invoice_candidates_idx have the same columns as orders_store_placed_idx; orders_list_placed_idx starts the same way. An ordinary new order writes about 22 index entries (16 unconditional, 3 partial whose condition holds, 3 GIN). `status` is an indexed column, so each status change rewrites them all and fires 11 triggers. Across the schema 15 indexes equal or lead another (visits_store_day_idx under the visits unique key is on the hottest table), and 39 unique (store_id, id) keys have no foreign key pointing at them.
- **Cost today:** About 22 index writes per order insert and again per status change: nothing at 102 orders, about 90 per order's life at scale. 15 redundant indexes cost one extra write each per row. Paid by: The database, per write
- **Fix:** Drop the 15 in work/ds/redundant.tsv (on orders and visits with `drop index concurrently` in a no-transaction file, D569). Stop adding a (store_id, id) key until a child table needs it. Then review never-scanned indexes on used tables once real traffic exists.
- **Saving:** Measured by count: 15 indexes now, 8 on used tables; 2 fewer entries per order write and 1 per counted visit.
- **Risk:** Low. None of the 15 backs a constraint that another index does not also enforce.
- **Already tracked:** Code review FD7, step 3.15 'Keep the big tables lean': Open. It counted 24 indexes and named orders_retention_idx; the count is now 34 and the list of 15 is new.

### DS-10 Where each picture is used is found by text-searching every page's JSON, again every day for every picture

- **Kind:** eager. **Effort:** S. **Confidence:** medium. **Step:** 2.10.
- **Where:** `src/server/media-library.ts:317`, `src/server/media-library.ts:338`, `src/server/media-library.ts:343`, `src/server/media-library.ts:810`, `src/server/media-library.ts:860`
- **Evidence:** mediaUses() casts each page's draft and published JSON to text and searches it for each picture's URL, and does the same for entries, menus, saved parts, theme and navigation. The five-minute media job re-embeds a picture when its vector is older than one day 'so what uses an item is kept current', which calls mediaUses for it. Production: the statement ran about 3,050 times at 47 to 925 ms (266 s for the main shape); media_embeddings took 13,414 updates on 468 rows; the media job's last run was 555 ms.
- **Cost today:** About 300 s of database time per 78 days today; it grows with pictures times pages. Paid by: The database and server per cron tick; the owner's media library
- **Fix:** Remove the one-day clause: refresh a picture's vector only when the picture changes or a page that names it is saved. Later, keep a media_uses table written at save so the library reads it instead of scanning.
- **Saving:** Estimate: most of the 3,050 scans and the 13,414 date-only updates per 78 days.
- **Risk:** Low. A picture's 'used in' words in search can lag until its next change.

### DS-11 Ending one sandbox runs at least 800 deletes, one per store table per round

- **Kind:** oversize. **Effort:** M. **Confidence:** medium. **Step:** 4.1.
- **Where:** `supabase/migrations/20261111172839_baseline_1_schema.sql:15374`, `src/server/sandbox.ts:343`, `src/server/sandbox.ts:369`
- **Evidence:** purge_sandbox() loops over every commerce table with a store_id column (402, less two) and runs a dynamic `DELETE … WHERE store_id = $1` in its own exception block, and repeats the whole pass until a pass deletes nothing: at least two passes. 216 of those tables have never held a row for any store. Not timed in production.
- **Cost today:** At least 800 statements and 800 subtransactions per visitor's try of the builder (estimate: 0.25 to 0.5 s each purge). The cost rises with every table added. Paid by: The database, per expired sandbox
- **Fix:** Delete in foreign-key order in one pass, and skip tables with no row for the store by asking once (a union of exists per table is one statement), or keep the list of tables a sandbox may write and delete only from those.
- **Saving:** Estimate: from 800 or more statements to a few dozen per purge.
- **Risk:** Medium. The function is the guarantee that nothing of a sandbox is left; keep the final check that no row remains.

### DS-12 Nothing limits or reviews the schema's growth

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.5. **The owner's decision.**
- **Where:** `docs/ci-migrations.md:154`, `docs/audits/code-review-2026-11.md:268`, `docs/wave-2-redirects.md:266`, `src/db/schema.ts:8`
- **Evidence:** The code review counted 467 tables and 19,082 lines on about 8 November; schema.ts has 481 and 19,614 today. Each new table brings a primary key, often a (store_id, id) key, an index for every foreign key (a written rule: 'the advisor asks'), and rows in the export, copy and personal-data registers. Advisors are read by hand after a migration. No test counts tables, indexes, triggers, functions or scheduled jobs, and nothing reports tables that never held a row or indexes never scanned. 52% of tables are in that state.
- **Cost today:** Unbounded growth: about 5 tables a day lately, each with 4 indexes on average. Paid by: CI, the build, the database, and every agent that must read the schema
- **Fix:** A ratchet scan test like ratchet.scan.test.ts over the migrations: counts of tables, indexes, triggers, functions and per-minute jobs may rise only with a line in the baseline file saying why. At each quarterly squash, list tables with no row and indexes with no scan since the last one and decide each. A rule that a new feature's job and trigger check 'in use' first (DS-3).
- **Saving:** No direct saving; it stops the next 250 unused tables.
- **Risk:** Low. The ratchet must be cheap to raise, or it will be raised by habit.
- **Already tracked:** Partly: FD7 proposes a standing unused-index check (step 3.15, Open); docs/ci-migrations.md:154 notes advisors are checked by hand.

### DS-13 Three small retention gaps remain

- **Kind:** oversize. **Effort:** S. **Confidence:** medium. **Step:** 2.10. **The owner's decision.**
- **Where:** `src/server/status.ts:254`, `src/server/status.ts:266`, `src/db/schema.ts:17781`, `src/server/page-versions.ts:38`, `src/lib/page-versions.ts:6`, `src/server/retention.ts:321`
- **Evidence:** status_checks gets 6 rows every 5 minutes and is pruned by a delete on checked_at that the (component, checked_at) index cannot serve, run on every tick: 1,072 sequential scans, 10.5 M rows; at its 91-day limit it will hold about 157,000 rows and scan them 288 times a day. page_versions keeps 50 versions a page with no age limit: 642 rows are 5.4 MB (8.4 KB each), so 1,389 pages could reach about 580 MB (estimate, worst case). Retention blanks but never deletes rows in carts, webhook_events, email_messages and others.
- **Cost today:** Small today: one full scan of status_checks per tick; page_versions 5.4 MB. Paid by: The database
- **Fix:** Prune status_checks once a day, or index checked_at. Give page_versions an age rule beside the count (for example keep 50 for 90 days, then the last 10). Do FD8's delete steps.
- **Saving:** Estimate: 287 scans a day of a table heading to 157,000 rows; a ceiling on page_versions.
- **Risk:** Low. The page-versions rule changes what an owner can take back; state it in the Versions panel.
- **Already tracked:** FD8, step 3.15: Open, for the blank-never-delete tables. The status_checks and page_versions points are new.

### DS-14 A short list of dead database objects

- **Kind:** dead. **Effort:** S. **Confidence:** high. **Step:** 4.1.
- **Where:** `src/db/schema.ts:7180`, `src/lib/personal-data.ts:238`, `supabase/migrations/20261111172839_baseline_1_schema.sql:26372`
- **Evidence:** idempotency_keys: no code or SQL function names it, and the personal-data register itself says 'An unused table… nothing is written to it'. Seven SQL functions are called by nothing in src, triggers, other functions or views: add_demo_appointment, add_demo_bundle, add_demo_gift_card, add_demo_rental, add_demo_stay (290 lines), bonus_verify and referral_verify (16 lines; tests call five of them). Six column names appear nowhere in the app or SQL: domain_registrations.contact_checked_at, not_found_hits.first_seen_at, payment_credentials.secret_key_hint and webhook_secret_hint, product_safety_rules.legal_basis, tripletex_sync.source_updated_at.
- **Cost today:** No running cost. About 400 lines across schema.ts, the baseline and three registers. Paid by: An agent's session and anyone reading the schema
- **Fix:** Drop idempotency_keys and its register rows in one migration. Keep the two *_verify functions if the tests are wanted as invariants; remove the add_demo_* functions if the Demo products feature no longer calls them. Leave the columns until their tables are next touched.
- **Saving:** Measured: 1 table, up to 7 functions (306 lines), 6 columns.
- **Risk:** Low. Follow the rule 'add, never drop in the same change': nothing running reads these.
