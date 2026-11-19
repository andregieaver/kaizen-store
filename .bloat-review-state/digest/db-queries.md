# db-queries: How data is asked for

All 14 verified findings stand, none argues from a feature being unused, and each now has ordered steps, the tests and rules that hold it, and one check; two were added. Today's cost is small (the listed app statements total about 39 minutes of database time in 78 days) because production holds only the team's demo stores, so what counts before opening is shape: one read fetches every published page whole to find one page (79,778 calls, 781 s), 122 store filters are written so the store index cannot serve them, the five-minute dispatcher starts 78 jobs on 5 connections, and 91,200 of 216,877 transactions deleted nothing. The two additions grow with orders and catalogue size: five document jobs find their due work each tick by re-checking every store's orders of 120 days and every invoice ever issued, and the catalogue listing calls a VAT function per product row (11.3 µs a row measured, against 0.1 µs when each rate is asked once). Do first: the statement counter (DQ-11), the store filter (DQ-8), the slug lookup (DQ-9), the knowledge job (DQ-6), the AI month sum (DQ-4) and the page index (DQ-2).

## Measures
- SQL statements written in src/server: 6,433 in 784 non-test files (3,883 selects); 5,124 .execute calls in 557 files; 1,272 typedRow(s) calls in 210 files
- Listed database time in production, 78 days: 6,334 s in the 19 costliest statements; 3,974 s (63%) is the scheduler's net.http_post; app statements 2,360 s, about 30 s a day
- Scheduler calls that are every-minute routes: 12,960 of 13,248 a day (97.8%); a fixed cost that does not grow with stores
- Transactions that do nothing: 162,622 of 216,877 begin/commit pairs (75%): 91,200 empty knowledge re-cuts and 71,422 advisory-lock claims by two minute routes
- Dispatcher shape: 78 jobs started at once with Promise.all, then 5 in turn; 84 ledger upserts a tick with the route's own; pool of 5 connections with a 5 s wait
- "use cache" reads: 85 directives in 49 files; no "use cache: remote"; statements issued from such functions ran 42,000 to 80,000 times each in 78 days
- is not distinct from: 145 uses in 52 files; 122 on store_id in 40 files; 6 files already hold a private owned() helper that branches correctly
- Calls of listPublishedPages: 35 call sites (37 rg lines: one definition, one comment); at least 12 look up one id with .find()
- Store slug looked up by id: 27 lines hold 'select slug from commerce.stores where id'; the statement ran 560,090 times, the most of any
- select *: 138 in 78 files of src/server by the verified count; 141 in 80 by my rg
- Database calls inside loops; list reads with no limit: 341 loops in 183 files plus 5 async map callbacks; 387 of 1,648 selects return a list with no limit (442 carry one); 6 load rows only to count them
- Connection pool: 5 connections per instance, 5 s idle, 5 s wait, node-postgres through the transaction pooler, no named prepared statements, read replica used by 1 module and off
- Per-row SQL functions (new): vat_rate 48 uses in 33 files, store_is_active 69 in 44, media_alt 9 in 6; 91 stable SQL functions in commerce carry a SET clause, so Postgres cannot inline them
- Cost of a per-row function (new, measured): vat_rate over 10,000 product rows 112.9 ms (11.3 µs a row) against 0.9 ms when each category's rate is asked once; store_is_active 24.1 ms against 0.5 ms for the plain expression on 10,002 rows; media_alt 48.8 ms for 10,000 rows on an empty media table
- How the document jobs find due work (new, measured): invoice job: orders entered on placed_at only through an index that starts with store_id (whole index walked), every succeeded refund read; invoice email job: every invoice read, issued_at only a Filter; e-invoice job: each 2-day invoice's snapshot JSON read
- Prune deletes of the dispatcher: 9 prune jobs read; every pruned table has an index on the time column the delete filters by

## Well made
- No finding in this dimension rests on a feature being unused; where the first auditor argued from an empty table the verified report kept only the running cost, and so does this plan.
- src/db/client.ts: one pool per instance (max 5, idle 5 s) attached to Vercel's lifecycle, node-postgres chosen for the transaction pooler with the reason written down (D37), no named prepared statements anywhere.
- Statement and lock limits are the role's (15 s, 5 s) and a longer one is taken with set local inside a transaction (longerTimeout, client.ts:89-92), never a plain set through the pooler.
- Transactions around single reads are rare: 12 read-only by their text among the 296 the scan could parse, each with a reason.
- Counting by loading rows is rare (6 heuristic hits in 1,648 selects), and offset paging is rare (11 uses in 10 files, all admin lists and version lists).
- The read replica (replicaDb, client.ts:105-110) is built but off, used by one module (analytics-totals.ts), and costs nothing while READ_DATABASE_URL is unset.
- publishedPageNames (pages.ts:713-735) pulls titles out of the JSON in SQL instead of fetching documents: the right shape, and the model for DQ-2.
- Queues are claimed with for update skip locked (integrations.ts:1033-1039, cookie-scans.ts:78-83), and store events are a real queue with done marks (staff-alerts.ts processStoreEvents), so the minute route's alert work follows what waits.
- The dispatcher's prune deletes are served by an index on their time column (search_queries_created_idx, search_cache_created_idx, recommendation_events_created_idx, recommendation_adds_created_idx, form_submissions_created_idx, api_idempotency_keys_created_id…
- A page view is recorded with two statements (one read, one upsert that also counts product views) plus a rate check for a new visitor (analytics-visits.ts recordVisit): lean for the write that will grow fastest.
- cronAuthorised() reads the scheduler's secret from Vault at most every five minutes per instance (cron-auth.ts:18-31), not on every call.
- Several dispatcher jobs already ask only for stores where the feature is set up (staff-alerts.ts joins staff_alert_settings; order-archive.ts starts from order_settings.auto_archive_days). The chat agent is off by default, so the knowledge job's cost follows …
- bonus_expire_due and the VAT-label midnight check are one set-based statement a tick each (2.1 ms and 7.3 ms a call): the right shape for a job over all stores.
- getStore() reads one wide row per store and is cached per store (stores.ts:231-277): one statement in place of many small ones.
- The admin's session, account and membership reads are wrapped in React cache() (auth.ts:121, 215, 354, 407), and cart, checkout and order share one read per request through perRequest().
- status_checks is pruned at 91 days (status.ts:265); the statistics file's note 'never pruned' is wrong.
- The proxy's two store reads are kept 10 s per instance (redirect-resolve.ts:203-232, house-switch.ts:31-43): single-row reads whose cost follows shopper traffic.
- media.url has a unique index and thumbnail_url an index (baseline_3_rules.sql:2884, 9796), so alt-text lookups can use them once the table is large.

## Findings (16)

### DQ-1 [P1 M eager corrected] Nine routes are called every minute whether or not there is work, and one of their questions grows with the number of stores
- evidence: pg_cron schedules nine jobs with '* * * * *' (baseline_4:93-103; I counted 9), each a net.http_post that also reads the cron secret from Vault. Production: 352,514 calls, 3,974 s, 11.3 ms each. Each run polls without first asking whether anything waits. Cookie scan: two updates, then a CTE over every open site with two correlated subqueries on cookie_scans written 'is not distinct from' (cookie-scans.ts:94-99); the …
- cost: 12,960 function calls a day by the schedule, fixed whatever the store count. At most about 150 s of database time a day for the calls themselves (13,248 calls at 11.3 ms). What grows: the cookie scan's who-is-due query … (The database and the server (function invocations), every minute. No shopper or…)
- fix: 8 steps; first: 1 (S, first). Cookie scan's due query, src/server/cookie-scans.ts:85-110: write the 'last' CTE so an index serves it. For stores: from sites s left join lateral (select max(c.finished_at) filter (where c.status = 'done') as done_at, max(c.created_at) as tried…
- done when: DQ-11's int test counts at most 3 statements for an idle cookie-scan run and 1 each for an idle theme-shots and pack-pictures run, and on production a day after the deploy seq_scan of commerce.cookie_scans in pg_stat_user_tables grows by fewer than 100 a day (about 31,000 a day today: 22 a minute).
- saving: Estimate. Steps 1 to 7: the 1.1 M sequential scans of cookie_scans and the 101 s of theme reads go, the 71,422 lock transactions stop while nothing waits, and the minute cost stops growing with stores. Step 8 would save up to 12,900 function calls a day while…
- after: DQ-8 (the shared owned() helper); DQ-5 (a cadence for the hourly and daily parts; until then the minute-0 test); DQ-11 (the statement counter the check uses)
- tracked: partly: docs/audits/psi-followups.md:477 REL-06 (open) says the routes that work after answering are not recorded in the job ledger. No step covers the polling…
- notes: Steps 1 and 2 alone are P0-sized (small, safe, and they remove the one per-minute question that grows with stores). The cron dimension describes the same scheduler cost from its side; do the work once. pg_cron's own run log (the cron schema is 564 MB) is not …

### DQ-2 [P0 M oversize confirmed] Every published page is read whole to find one page or a few titles
- evidence: listPublishedPages() (pages.ts:664-681) selects id, slug, published (the whole document) and two dates for every published page of an owner, parses each with zod, then looks up library alt texts for every picture on every page (withPageAlts). I listed its call sites with rg: 35. At least 12 then do .find() for one id: the front page (s/[store]/[market]/page.tsx:29), the products page (pages.ts:799), a page by id (pa…
- cost: 781 s in 78 days, 9.8 ms a call, on the team's demo stores. Estimate: about 90 KB a call on disk (29 rows at about 3 KB), more as JSON on the wire, parsed each time. After opening, the size of a call follows one store's… (The server on every cold render of a page's frame; the database; a visitor wait…)
- fix: 6 steps; first: 1. In src/server/pages.ts add publishedPageIndex(owner, type = 'page'): 'use cache', cacheLife('hours'), cacheTag(pagesTag(owner)), the same where and order by as listPublishedPages, but no document. Columns: id, slug, published ->> 'title' as title, the tran…
- done when: rg -c 'listPublishedPages\(' over src (tests left out) gives at most 20 lines (37 today), and on production a week after the deploy pg_stat_statements shows the statement 'select id, slug, published, published_at, first_published_at from commerce.pages … order by created_at' with fewer than a quarter of the calls of t…
- saving: Estimate: most of the 781 s (rows shrink from whole documents to a few short columns, or to one row), the zod parse of every document per call, and the alt lookup for pages not being drawn. The saving per call grows with a store's content.
- after: DQ-8 (the owned() helper, so the new reads are born index-friendly)
- tracked: no (code review step 3.9, Open, is the same idea for products: 'Stop reading the whole catalogue for one page')
- notes: The 29 rows a call are demo content; the cost per call will follow each real store's page and article count. The caching and storefront-data dimensions describe the same read; do it once. DQ-7 step 4 and DQ-10 build on the index.

### DQ-3 [P1 M eager confirmed] "Where is this picture used" scans every page's text for each picture, and the job re-checks every picture daily
- evidence: mediaUses() joins each picture to every page of the site and tests position(m.url in pg.draft::text) and the same on published, so both documents of every page are cast to text per picture; it does the same over entries, menus, saved parts, theme looks and settings in 12 union branches (media-library.ts:321-381). Production: 1,831 calls at 145 ms, and other shapes 43 at 925 ms, 198 at 133 ms, 205 at 66 ms, 776 at 47…
- cost: About 382 s in 78 days on 699 pictures. It grows with pictures times pages times page size per store, every day, for every store with media and an AI connection, whether or not anything changed. Estimate: a store with 2… (The database, daily per picture, driven by the five-minute dispatcher; an owner…)
- fix: 5 steps; first: 1 (S, first). In src/server/media-library.ts embedMedia(): replace the daily clause at line 810 with a change test. Once per site per run read one stamp, the latest change of anything that can hold a picture: greatest of max(updated_at) over the site's rows i…
- done when: After step 1: on production n_tup_upd of commerce.media_embeddings grows by fewer than 50 a day while no content changes (about 468 a day today: 13,414 updates on 468 rows). After step 4: total_exec_time of the statements starting 'with m as (select id, url, thumbnail_url from commerce.media' grows by under 1 s a week.
- saving: Estimate: at least 80% of the 382 s and nearly all 13,414 re-stamps after step 1; the library's read becomes an index lookup after step 4. The larger gain is that the daily cost stops growing with every store's library.
- after: DQ-5 (the hourly cadence of step 2); DQ-8 (owned())
- notes: Step 1 is P0-sized and stands alone. The schema dimension describes the same query; do it once.

### DQ-4 [P0 S eager confirmed] Each request for an AI connection sums the store's whole month of AI usage
- evidence: aiFor() is named on 92 lines in 65 files (my rg). For a store on the platform's key whose plan has a limit it calls aiRoomLeft(), which sums every ai_usage row of the month with a lateral price lookup per row and a euro conversion per day (usage-sql.ts:48-57, which I opened). The one-minute memo (limits.ts:122, 139-144) lives in one function instance and ticks are five minutes apart, so it helps only within one run.…
- cost: About 352 s in 78 days; 37 to 57 ms in front of AI features and of each job that asks per store. It grows with a store's usage through the month and with the number of stores the five-minute jobs ask for. (The database; a shopper or owner waiting for an AI answer; each five-minute job…)
- fix: 5 steps; first: 1. In src/server/limits.ts liveValue(), case 'ai_cost_micros' (lines 138-144): month to date = the sum of this month's store_usage_daily rows for the metric, plus a live aiCostSql() from the start of the day after the latest measured day (or from the month's …
- done when: limits-enforce.int.test.ts passes with a month of seeded usage split across measured days and today, and on production a week after the deploy the mean_exec_time of the ai_usage cost statement issued from limits.ts is under 5 ms in pg_stat_statements (37 to 57 ms today).
- saving: Estimate: about 90% of the 352 s (one day's rows instead of a month's), and the cost stops growing through the month.
- after: nothing
- tracked: not as a step. docs/capacity.md:610-612 already describes the intended shape (daily rows plus today's live count); the code does not follow it.
- notes: Production's statement text is an older shape than today's code (before the euro conversion), so today's cost per call is at least as high.

### DQ-5 [P1 M eager corrected] The five-minute dispatcher starts 78 jobs at once on 5 connections, and several redo work on every tick that grows with the number of stores
- evidence: runJobs() starts every job with Promise.all (cron-runs.ts:117); I counted 78 keys in the object the route passes, and 5 more tracked jobs run in turn after it. With the route's own that is 84 ledger upserts a tick (production: 457,349 + 107,700 calls, 84 s). The pool holds 5 connections and a caller waits at most 5 s for one (client.ts:68-70). Every job has the same cadence, 300 s, whether it prunes a log, settles t…
- cost: Today small: the ledger writes are 0.15 ms each and the dispatcher's own run was 1.3 s. The jobs' recorded times sum to about 12.5 s because 78 jobs queue for 5 connections. What grows with stores: the embeddings hash (… (The database and one function every five minutes. Later: owners, when a job tha…)
- fix: 5 steps; first: 1. src/server/cron-runs.ts runJobs(): take each job as { run, every } (every in seconds, 300 when left out) and run at most 4 at a time (the pool holds 5 and the ledger write needs one) through a small promise pool. At the start read the ledger once: select j…
- done when: DQ-11's int test: a second dispatcher tick run right after the first runs no job marked hourly or daily (their runs count in commerce.cron_jobs does not rise), the idle tick's statement count is the same for a seed of 1 store and of 20 stores and lower than today's count written in the baseline, and cron-runs.int.test…
- saving: Estimate: most of the 148 s of the embeddings hash at today's size, and about a quarter of the 84 ledger writes a tick (the 20 or so jobs that become hourly or daily). The real gain is that the tick's work stops growing with every store's catalogue and that a…
- after: DQ-11 (the idle-tick count is the check)
- tracked: partly: the PSI audit of 1 November 2026 lists the Promise.all against the pool of 5 as PERF-03 (unchanged, 'Cap the dispatcher's concurrency at the pool size'…
- notes: Before opening is the cheapest time to set cadences: nobody waits on these jobs yet. The cron dimension describes the same dispatcher from its side; do the work once. The invoice job's part moved to the new DQ-15.

### DQ-6 [P0 S eager confirmed] The knowledge job reads every page whole every five minutes and re-cuts pages that have no text, forever
- evidence: For every site with its chat agent on, syncPageKnowledge() selects every published page and article with its whole published document (knowledge.ts:169-175; production: 2,571 + 17,955 + 3,608 calls in three shapes, the first returning 40 rows a call at 16 ms) and compares versions in code. I followed the comparison: the stored version is min(c.version) over the page's chunks (line 171); a page whose text cuts to no …
- cost: 91,200 empty transactions (273,600 round trips: begin, delete, commit). Estimate: about 200 KB of page documents sent to the function each tick for the platform's site alone (40 rows at about 5 KB). After opening it is … (The database and the dispatcher function, every five minutes, for each site tha…)
- fix: 6 steps; first: 1. Migration (the table in src/db/schema.ts, then pnpm db:generate; knowledge_chunks itself is SQL only because of its vector, this table has none): commerce.knowledge_sources (store_id uuid null references stores on delete cascade, page_id uuid null unique r…
- done when: On production a day after the deploy the calls of 'delete from commerce.knowledge_chunks where page_id = $1' in pg_stat_statements grow by fewer than 20 a day (about 6,000 a day today), and the new case in chat.int.test.ts counts zero transactions for a second tick with nothing published.
- saving: Measured count: the 91,200 empty transactions and their round trips go to zero. Estimate: the whole-document read happens only when something was published, so the job's cost per store per tick drops to two small statements.
- after: DQ-5 (the hourly cadence of the net in step 4; until then a minute-below-5 test)
- tracked: no (docs/rules/storefront.md:407-411 states that the five-minute cron cuts pages published anew; the fix keeps it)
- notes: Step 2 alone (recording a source that cut to nothing) removes the 91,200 transactions and is a few lines; the rest removes the whole-document read. The schema dimension describes the same job; do it once.

### DQ-7 [P1 M eager corrected] A page's frame asks about 20 questions each time its cache is cold, some of them one per feature for every store, and the cache is cold far more often than the code assumes
- evidence: Next's own guide (use-cache.md:245-259, as the verified report read it): with the default handler on serverless, cache entries typically do not persist across requests, and no entry carries over a deploy. The repo has 85 'use cache' directives (my count), no 'use cache: remote' and no cacheHandlers. Production: statements issued from functions cached for hours ran 540 to 1,020 times a day each (a lower bound), for e…
- cost: About 20 round trips before a page's own content on each cold render (estimate from the code: 20 to 60 ms in the same region, not measured); 121 s of database time for the modal check alone. After opening this is paid p… (The first visitor of a store's page on a cold instance or after a deploy; the d…)
- fix: 6 steps; first: 1 (S, first). src/server/site-cookies.ts:89-121: start the independent reads together with one Promise.all (storeFeatures, getChatAgent, usesRememberedModals, referralPublicSettings or affiliateSite, getRecommendSettings, storeHasExperiments, getPlatformLangs…
- done when: DQ-11's int test counts at most 4 statements for siteCookies() of a seeded store with none of the features on (8 or 9 today by the code), and on production a week after the deploy no statement containing jsonb_path_exists on commerce.pages is among the 40 costliest in pg_stat_statements (121 s today).
- saving: Estimate: a cold frame goes from about 20 statements to 4 or 5; the 121 s of JSON scans become a column read.
- after: DQ-2 (step 4); DQ-8 (owned()); DQ-11 (the counter of step 6)
- tracked: partly: code review step 3.8 (Open) cuts round trips for cart and checkout only
- notes: Step 1 is P0-sized. How production's runs split between deploys, cold instances and builds cannot be told from the statistics; the caching and storefront-data dimensions carry the deploy and warm-up side. The 21 statements for the platform's frame are a code-…

### DQ-8 [P0 S oversize confirmed] "is not distinct from" on store_id keeps the index from serving the hottest reads, so they scan all stores' rows
- evidence: My rg: 145 uses in 52 files, 122 on store_id in 40 files (most: content-types.ts 10, site-tools.ts 9, saved-parts.ts 8, forms.ts 8, pages.ts 6). The ones that run most: pages.ts:71 (ownedBy, behind 79,778 calls), pages.ts:694 and 697 (67,601), pages.ts:728 and 733 (57,930), taxonomy.ts:60 (130,816), cookie-scans.ts:97 and 98 (49,338; 22 table scans a call), site-cookies.ts:46 (70,257) and :55 (70,278), page-modals.t…
- cost: Cheap per call today (1,389 pages). But each such read looks at every store's rows of that table, or every row of one type: about 1.2 billion rows read by sequential scan on these three tables in 78 days. The cost of on… (The database, on every cold page render and every cron minute.)
- fix: 6 steps; first: 1. New src/server/owned.ts: export const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`), with a comment that it is the one way to filter a store's or the platform's rows. Repl…
- done when: The ratchet's new count sums to at most the commented column-to-column joins left (122 today), and EXPLAIN of listPublishedPages' statement with enable_seqscan off on the local database shows store_id inside the Index Cond of pages_store_slug_key (today it is a Filter).
- saving: Estimate: the scans of pages, terms and cookie_scans become index scans of one store's rows. Little time saved at today's size; the cost stops growing with other stores' data.
- after: nothing
- tracked: no (docs/rules/storefront.md:179 is a rule that asks for the current wording for content types; the fix keeps its reason)
- notes: Mechanical and cheapest before opening: there is no real data to get wrong. Do it first, because DQ-1, DQ-2, DQ-6 and DQ-7 write new reads that should use the helper from birth. The schema dimension describes the same wording; do it once.

### DQ-9 [P0 S duplicate corrected] The store's slug is looked up by id again and again: the most-called statement in production
- evidence: 'select slug from commerce.stores where id = $1' ran 560,090 times, more than any other statement. My rg finds it on 27 lines. Page components know the store by id (GridPlace.owner, content-grid.ts:48), though the page was reached by slug. storeAndMarket() (content-grid.ts:151-156) is not cached and not shared within a request, and has 11 callers (my rg). Three of them are parts drawn per request (the filterable gri…
- cost: At least 7,180 round trips a day today for a value that does not change. Each is a primary-key read, tiny in database time, but a round trip a page part waits for. After opening the per-request share grows with shopper … (The server and the database on every render of a store page's dynamic parts; ea…)
- fix: 5 steps; first: 1 (S, first). Move storeSlugOf() from src/server/menus.ts:282-288 to src/server/stores.ts (it needs only readDb; menus.ts re-exports it) so nothing imports in a circle. In src/server/content-grid.ts make storeAndMarket() (151-156) and customWhere() (133) call…
- done when: rg -c 'select slug from commerce.stores where id' over src (tests left out) gives at most 3 lines (27 today), and on production a week after the deploy the calls of that statement in pg_stat_statements grow by fewer than 500 a day (at least 7,180 a day today).
- saving: Estimate: nearly all 560,090 calls, and most of the 237,563 provider reads inside one job run.
- after: nothing
- notes: Steps 1 and 2 are an hour's work and remove most of the calls; step 3 removes the wait for the per-request parts. The storefront-data dimension describes the same lookup; do it once.

### DQ-10 [P2 M oversize corrected] Some reads fetch whole JSON documents where a field, a card or a count is needed
- evidence: 61 selects name a page's document column and 14 a theme's (the verified re-run of the scan). That count is not the size of the problem: many are single-page reads by id for an editor that needs the document. The reads where less would do, after DQ-2, DQ-6 and DQ-7: (1) theme-store.ts:137 reads every published theme with its whole snapshot to draw cards: 10,851 calls, 107,917 rows, 27 s. (2) theme-store.ts:176 reads …
- cost: 27 s for the theme cards read; the rest is bytes and parse time on each call, not yet large. The theme reads grow with themes, not stores. The Pages list and the speed report grow with one store's content and traffic: t… (The server (memory and parse) and the database; an owner on the Pages list or t…)
- fix: 7 steps; first: 1. Theme cards: add a card jsonb column to commerce.design_presets (src/db/schema.ts, pnpm db:generate) holding what cardOf() reads from the snapshot (the looks, the swatch, the section style names). Write it where a theme is published (src/server/design-pres…
- done when: theme-store.int.test.ts asserts that the rows loadCards() reads have no snapshot key once cards are filled, and speedReport() on a store seeded with 10,000 samples issues one statement that returns at most 28 rows per kind and screen.
- saving: Estimate: the theme card read shrinks from whole themes to card facts (most of 27 s); the admin Pages list and the speed report stop growing with document size and sample count.
- after: DQ-1 (the daily sweep that backfills cards); DQ-2 (the same JSON-operator shape for pages)
- tracked: no (code review FD7, Open in step 3.15, names the width of orders but not these reads)
- notes: The theme-shots read of every snapshot each minute (101 s) is carried by DQ-1, not counted here. getStore()'s one wide cached row is not oversize for its job. Do each step when its file is next opened; none is urgent at today's sizes.

### DQ-11 [P0 M process confirmed] Nothing counts queries: no budget per page or per tick, and production's statement statistics are not part of any routine
- evidence: My rg finds no statement counter in src (no queryCount, countQueries or statementCount; the pool's only listener is the error handler at client.ts:73), and the verified report found pg_stat_statements named only in the draft of this review. The ratchet (ratchet.baseline.json, ratchet.scan.test.ts:22-56) holds counts of casts, suppressions, unchecked reads and writes by id alone; none is about how many statements run…
- cost: No running cost of its own. It is why the others grew unseen. (Everyone later: each new section, job and cached read adds statements with no n…)
- fix: 6 steps; first: 1. A counter for tests, with no change to production code: test/count-statements.ts exporting countStatements(run), which wraps pg's Client.prototype.query for the length of run and returns the number of statements and their first 80 characters (begin and com…
- done when: pnpm test:int runs query-budget.int.test.ts green with the three counts written in the baseline, and after DQ-1, DQ-5 and DQ-6 land the idle tick's count is the same for 1 and 20 seeded stores.
- saving: Not a direct saving. It gives DQ-1, DQ-5, DQ-6, DQ-7 and DQ-9 a number to check their fix against and keeps them from coming back.
- after: nothing
- tracked: no (code review step 4.6 'Measure, then tune', Open, is the admin audit's and names no query count)
- notes: Do it first: five other findings use its counter as their check. The verified report rated the effort S; with the move of the job list and three budgets it is M. The cron, storefront-data and admin-data dimensions each ask for a budget of their own; one count…

### DQ-12 [P2 S eager corrected] Every server instance reads the interface translations before it serves and polls them each minute
- evidence: register() awaits startUi() before an instance takes requests (instrumentation.ts:6-10); that runs 'select lang, count(*), max(updated_at) from commerce.ui_translations group by lang' (ui-text.ts:60-62), then a timer repeats it every 60 s (107-110). Production: 278,393 calls, the second most-called statement. The verified report measured one statement per instance per minute on the local database. ensureUi() is call…
- cost: At least 3,569 round trips a day, each tiny. One round trip before a new instance serves (estimate, not measured). It grows with instances, not with stores. Once languages are translated the poll becomes a count over ev… (The first visitor served by a new instance; the database.)
- fix: 3 steps; first: 1. Keep the read at start and the timer. In src/server/ui-text.ts make the poll cheap: a version stamp. Add ui_text_version bigint not null default 0 to commerce.platform_settings (one row), raised by one in the same statement by every writer of commerce.ui_t…
- done when: On production the calls of the ui_translations group-by statement in pg_stat_statements grow by fewer than 200 a day per running instance with no translation edited (1,440 per instance a day today).
- saving: Estimate: from 1,440 group-by polls per instance a day to 144, or the same count as single-row reads. Small either way.
- after: nothing
- notes: Low priority: about 3,600 tiny reads a day that grow with instances, not stores. Do it when ui-text.ts is next opened, and before many languages are machine-translated, when the group-by starts to count thousands of rows a minute per instance.

### DQ-13 [P2 M eager confirmed] 341 loops hold a database call in their body; the ones that matter are jobs that loop over sites
- evidence: The verified lexical scan finds 341 loops in 183 files with an awaited database call in the loop's own body, and 5 async map callbacks. Most run over a handful of rows by design, and their cost follows use: one insert per fee, stock hold or language when an order is placed or a product saved (checkout.ts:1081, order-insert.ts:363, products.ts:1207), one 'bought since' lookup per due cart reminder (cart-reminders.ts:…
- cost: Per-site loops cost several round trips per site per tick, one site after another, so a tick's length grows with the stores that use the feature. The order's per-line inserts add one round trip per line while the order'… (The database and the dispatcher every five minutes; a shopper at the moment of …)
- fix: 5 steps; first: 1. The per-site job loops are fixed where their findings are: the media loop in DQ-3, the embeddings and cadences in DQ-5, the knowledge loop in DQ-6, the invoice loop in DQ-15, and the one AI provider read for all sites in DQ-9 step 4. Do not repeat that wor…
- done when: DQ-11's tick test, run with the chat agent on and pictures in each of 1 and 20 seeded stores, issues at most 2 more statements per added store (about 10 per store today by the code read: the knowledge loop's 8 and the media loop's 2 to 4).
- saving: Estimate: per-tick round trips of these jobs stop growing with the number of sites. No saving of its own beyond DQ-3, DQ-5, DQ-6 and DQ-15.
- after: DQ-3; DQ-5; DQ-6; DQ-9; DQ-15; DQ-11 (the check)
- tracked: partly: code review step 3.7 'Stage placeOrder' (Open) restructures the order's writes; D320 already made a variant save 'a few statements'
- notes: This is the pattern behind DQ-3, DQ-5, DQ-6 and DQ-15 and adds little of its own. Do not count their savings again here. Steps 3 and 4 are small and can wait until those files are next opened.

### DQ-14 [P2 M oversize confirmed] 387 list reads have no limit by a heuristic count; a handful read a whole store's documents or samples
- evidence: Of 1,648 selects assigned to a const, 442 carry a limit and 387 return a list with no limit, no id or any() filter and no aggregate (the verified heuristic). Most are bounded by their parent (an order's lines, a store's locations). The ten that are bounded only by how much a store has: pages.ts:136 (every page with both documents, for the admin list); pages.ts:668 (DQ-2); knowledge.ts:170 (DQ-6); accessibility.ts:12…
- cost: Small today. Each of the ten returns rows in proportion to one store's whole content, so a large store makes its own screens slow. None costs anything for a store that does not open the screen, apart from the two alread… (An owner on the Pages list, the accessibility and claims screens and the activi…)
- fix: 6 steps; first: 1. The admin's Pages list: the slim columns of DQ-10 step 3, and paging with the shared list pattern when code review step 1.13 ('One way to search and page a list') is built; do not invent a second paging here.
- done when: A small scan test (src/server/list-limits.scan.test.ts) names the six reads this finding changes and asserts each statement carries a limit, an aggregate or a time bound; it passes.
- saving: Estimate: these reads stop growing with a store's content; nothing measurable at today's sizes.
- after: DQ-10 (steps 1, 2 and 5 are its steps 3, 5 and 2); code review step 1.13 (the shared list paging)
- tracked: partly: code review step 1.13 'One way to search and page a list' (Open) covers paging admin lists; step 0.9 (Done) paged the storefront's listings
- notes: Low priority under the owner's clarification: the cost follows an owner's use of a screen and one store's size, not the number of stores. It overlaps DQ-2, DQ-6 and DQ-10; do not count their savings again here.

### DQ-15 [P1 M eager added] Five document jobs find their due work by re-checking every store's recent orders, invoices and refunds on each tick
- evidence: Not in the verified report, which names only the invoice job's repeated per-store calls. invoiceJobs() runs every five minutes from the dispatcher. Its store finder (invoice-issue.ts:71-101) has no queue: it takes every order of every store placed in the last 120 days and proves for each that an invoice exists (an anti-join on invoices and a look in order_events), then every succeeded refund ever made (no time bound…
- cost: Nothing measurable today (102 orders in all). After opening the work per tick is in proportion to all stores' orders, not to what waits. Estimate: at 1,000 stores with 10 orders a day, 1.2 million orders are re-proved e… (The database, every five minutes, for every store that sells; later store owner…)
- fix: 6 steps; first: 1. Indexes that fit the two short windows, in one custom migration (pnpm exec drizzle-kit generate --custom --name document_job_indexes, then node scripts/prune-snapshots.mjs; none of these tables is on the hot-table list, so plain create index): invoices (is…
- done when: A new int test seeds 2,000 paid, invoiced consumer orders in one store, runs one invoice tick, one email check and one e-invoice check, and asserts that seq_tup_read plus idx_tup_fetch of commerce.orders and of commerce.invoices in pg_stat_user_tables each rose by fewer than 100 (read after select pg_stat_force_next_f…
- saving: Nothing at today's size. Estimate after opening: the tick's document work follows what waits, usually nothing, instead of all orders of 120 days and every invoice; and one of the two credit-note calls per store per tick goes (9,909 calls and 35 s so far).
- after: DQ-5 (the hourly cadence for the net); DQ-11 (the counter)
- tracked: no. Code review step 3.15 (Open, FD7 and FD8) is about keeping the big tables lean, not about these reads; the verified report's DQ-5 named only the repeated p…
- notes: Step 1 is P0-sized: six small indexes on tables that are empty today, before real invoices exist. The plans were read on empty local tables with sequential scans switched off, so they show which index a statement can use, not what the planner will choose at s…

### DQ-16 [P2 S oversize added] The catalogue's listing reads call a VAT function and an alt-text function once per product row, and Postgres cannot fold them into the query
- evidence: Not in the verified report beyond one line on store_is_active(). listProducts() (catalog.ts:284-330) returns every active product of a store and market with no limit (code review step 3.9) and selects commerce.vat_rate(market, p.vat_category) (line 312) and commerce.media_alt(m.url, locale) (line 299) per row; listGridProducts() does the same (lines 676 and 689). Both are stable SQL functions with SET search_path (b…
- cost: About 11 µs per product row per catalogue read for the VAT rate, plus at least 5 µs per row for the alt text: 0.3 ms for a 20-product demo store; estimate 80 ms or more for a 5,000-product catalogue on each cold listing… (The database; the first visitor of a listing after its cache is cold.)
- fix: 5 steps; first: 1. In src/server/catalog.ts add one sql fragment used by listProducts() and listGridProducts(): a CTE rates as materialized (select c.cat, commerce.vat_rate(market, c.cat) as rate from (select distinct vat_category as cat from commerce.products where store_id…
- done when: On a database seeded with 2,000 products in one store, one call of listProducts() raises seq_scan plus idx_scan of commerce.countries in pg_stat_user_tables by at most 10 (read after select pg_stat_force_next_flush(); at least 2,000 today: one or more per product row).
- saving: Measured: the VAT rate from 11.3 µs to about 0.1 µs per row (112.9 ms to 0.9 ms on 10,000 rows). Estimate: 5 µs or more per row for the alt text. Milliseconds for small stores, tens of milliseconds per cold listing for large catalogues.
- after: code review step 3.9 (the same two reads; do them together)
- tracked: no (code review step 3.9, Open, covers reading the whole catalogue for one page, not the per-row functions)
- notes: Small today and measured, not estimated, for the VAT part. Do it in the same change as step 3.9, which opens these two statements anyway. It also explains why countries is the second most scanned table in production's statistics, which no other finding does.
