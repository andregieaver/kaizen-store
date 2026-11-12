# How data is asked for (DQ)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** All 14 verified findings stand, none argues from a feature being unused, and each now has ordered steps, the tests and rules that hold it, and one check; two were added. Today's cost is small (the listed app statements total about 39 minutes of database time in 78 days) because production holds only the team's demo stores, so what counts before opening is shape: one read fetches every published page whole to find one page (79,778 calls, 781 s), 122 store filters are written so the store index cannot serve them, the five-minute dispatcher starts 78 jobs on 5 connections, and 91,200 of 216,877 transactions deleted nothing. The two additions grow with orders and catalogue size: five document jobs find their due work each tick by re-checking every store's orders of 120 days and every invoice ever issued, and the catalogue listing calls a VAT function per product row (11.3 µs a row measured, against 0.1 µs when each rate is asked once). Do first: the statement counter (DQ-11), the store filter (DQ-8), the slug lookup (DQ-9), the knowledge job (DQ-6), the AI month sum (DQ-4) and the page index (DQ-2).

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DQ-2](DQ-2.md) ✓ | Every published page is read whole to find one page or a few titles | oversize | P0 | M | 0.24 |
| [DQ-4](DQ-4.md) ✓ | Each request for an AI connection sums the store's whole month of AI usage | eager | P0 | S | 0.21 |
| [DQ-6](DQ-6.md) ✓ | The knowledge job reads every page whole every five minutes and re-cuts pages that have no text, forever | eager | P0 | S | 0.27 |
| [DQ-8](DQ-8.md) ✓ | "is not distinct from" on store_id keeps the index from serving the hottest reads, so they scan all stores' rows | oversize | P0 | S | 0.23 |
| [DQ-9](DQ-9.md) ✓ | The store's slug is looked up by id again and again: the most-called statement in production | duplicate | P0 | S | 0.20 |
| [DQ-11](DQ-11.md) ✓ | Nothing counts queries: no budget per page or per tick, and production's statement statistics are not part of any routine | no check | P0 | M | 1.10 |
| [DQ-1](DQ-1.md) ✓ | Nine routes are called every minute whether or not there is work, and one of their questions grows with the number of stores | eager | P1 | M | 3.1 |
| [DQ-3](DQ-3.md) ✓ | "Where is this picture used" scans every page's text for each picture, and the job re-checks every picture daily | eager | P1 | M | 0.28 |
| [DQ-5](DQ-5.md) ✓ | The five-minute dispatcher starts 78 jobs at once on 5 connections, and several redo work on every tick that grows with the number of stores | eager | P1 | M | 3.3 |
| [DQ-7](DQ-7.md) ✓ | A page's frame asks about 20 questions each time its cache is cold, some of them one per feature for every store, and the cache is cold far more often than the code assumes | eager | P1 | M | 2.18 |
| [DQ-15](DQ-15.md) | Five document jobs find their due work by re-checking every store's recent orders, invoices and refunds on each tick | eager | P1 | M | 3.21 |
| [DQ-10](DQ-10.md) ✓ | Some reads fetch whole JSON documents where a field, a card or a count is needed | oversize | P2 | M | 4.4 |
| [DQ-12](DQ-12.md) ✓ | Every server instance reads the interface translations before it serves and polls them each minute | eager | P2 | S | 0.8 |
| [DQ-13](DQ-13.md) ✓ | 341 loops hold a database call in their body; the ones that matter are jobs that loop over sites | eager | P2 | M | tolerated |
| [DQ-14](DQ-14.md) ✓ | 387 list reads have no limit by a heuristic count; a handful read a whole store's documents or samples | oversize | P2 | M | 2.19 |
| [DQ-16](DQ-16.md) | The catalogue's listing reads call a VAT function and an alt-text function once per product row, and Postgres cannot fold them into the query | oversize | P2 | S | 2.19 |

## Measured

| Measure | Value | How |
|---|---|---|
| SQL statements written in src/server | 6,433 in 784 non-test files (3,883 selects); 5,124 .execute calls in 557 files; 1,272 typedRow(s) calls in 210 files | From the verified report (the skeptic re-ran the auditor's sqlscan.mjs). Not re-run by me. |
| Listed database time in production, 78 days | 6,334 s in the 19 costliest statements; 3,974 s (63%) is the scheduler's net.http_post; app statements 2,360 s, about 30 s a day | Total column of prod-db-stats.md lines 62-80, summed in the verified report; I read the same table. |
| Scheduler calls that are every-minute routes | 12,960 of 13,248 a day (97.8%); a fixed cost that does not grow with stores | I counted 9 cron.schedule lines with '* * * * *' in baseline_4 (rg -c gives 9) times 1,440, against 288 dispatcher runs. |
| Transactions that do nothing | 162,622 of 216,877 begin/commit pairs (75%): 91,200 empty knowledge re-cuts and 71,422 advisory-lock claims by two minute routes | Call counts in prod-db-stats.md lines 88 and 92, matched to knowledge.ts:248-258, theme-shots.ts:168-169 and content-packs.ts:735-737, which I opened. The 216,877 total is from the task brief. |
| Dispatcher shape | 78 jobs started at once with Promise.all, then 5 in turn; 84 ledger upserts a tick with the route's own; pool of 5 connections with a 5 s wait | My node one-liner over api/cron/cart-reminders/route.ts: 78 keys in the runJobs object, 5 tracked("dispatcher.…") calls after it; src/db/client.ts:68-70. |
| "use cache" reads | 85 directives in 49 files; no "use cache: remote"; statements issued from such functions ran 42,000 to 80,000 times each in 78 days | My rg for the directive (85 in 49). Call counts from prod-db-stats.md lines 86-109. |
| is not distinct from | 145 uses in 52 files; 122 on store_id in 40 files; 6 files already hold a private owned() helper that branches correctly | My rg -c -i over src with tests and test support left out (same numbers as the verified report); rg 'const owned = ' in src/server. |
| Calls of listPublishedPages | 35 call sites (37 rg lines: one definition, one comment); at least 12 look up one id with .find() | My rg -n 'listPublishedPages\(' over src, tests left out, read line by line. |
| Store slug looked up by id | 27 lines hold 'select slug from commerce.stores where id'; the statement ran 560,090 times, the most of any | My rg -n (27 lines); prod-db-stats.md line 86. |
| select * | 138 in 78 files of src/server by the verified count; 141 in 80 by my rg | rg -c -i 'select \*\|select [a-z_]+\.\*' with tests left out. The difference is the glob for test support. |
| Database calls inside loops; list reads with no limit | 341 loops in 183 files plus 5 async map callbacks; 387 of 1,648 selects return a list with no limit (442 carry one); 6 load rows only to count them | From the verified report (re-runs of loopscan.mjs and countscan.mjs; lexical heuristics). Not re-run by me. |
| Connection pool | 5 connections per instance, 5 s idle, 5 s wait, node-postgres through the transaction pooler, no named prepared statements, read replica used by 1 module and off | I read src/db/client.ts:63-110 and :151-157; rg 'replicaDb()' gives analytics-totals.ts only. |
| Per-row SQL functions (new) | vat_rate 48 uses in 33 files, store_is_active 69 in 44, media_alt 9 in 6; 91 stable SQL functions in commerce carry a SET clause, so Postgres cannot inline them | My rg -c with tests left out; pg_proc on the local scratch database (proconfig not null, language sql, stable or immutable, not set-returning). |
| Cost of a per-row function (new, measured) | vat_rate over 10,000 product rows 112.9 ms (11.3 µs a row) against 0.9 ms when each category's rate is asked once; store_is_active 24.1 ms against 0.5 ms for the plain expression on 10,002 rows; media_alt 48.8 ms for 10,000 rows on an empty media table | explain (analyze, timing off) in a read-only transaction on the local scratch database (PostgreSQL 16.15, 20 products cross-joined with generate_series). |
| How the document jobs find due work (new, measured) | invoice job: orders entered on placed_at only through an index that starts with store_id (whole index walked), every succeeded refund read; invoice email job: every invoice read, issued_at only a Filter; e-invoice job: each 2-day invoice's snapshot JSON read | My EXPLAIN (costs off, enable_seqscan off, read-only) of the statements at invoice-issue.ts:72-99, invoice-notices.ts:131-139 and einvoice-sending.ts:64-70 on the local scratch database; index list of invoices, credit_notes, refunds and orders from baseline_3_rules.sql. |
| Prune deletes of the dispatcher | 9 prune jobs read; every pruned table has an index on the time column the delete filters by | I opened pruneSearchLog, pruneApiIdempotency, pruneOAuthTokens, pruneSearchCache, pruneDocsCounts, pruneFormSubmissions, pruneRecommendEvents and pruneReplications and matched each to its CREATE INDEX in baseline_3_rules.sql. |

## Well made, and should stay

- No finding in this dimension rests on a feature being unused; where the first auditor argued from an empty table the verified report kept only the running cost, and so does this plan.
- src/db/client.ts: one pool per instance (max 5, idle 5 s) attached to Vercel's lifecycle, node-postgres chosen for the transaction pooler with the reason written down (D37), no named prepared statements anywhere.
- Statement and lock limits are the role's (15 s, 5 s) and a longer one is taken with set local inside a transaction (longerTimeout, client.ts:89-92), never a plain set through the pooler.
- Transactions around single reads are rare: 12 read-only by their text among the 296 the scan could parse, each with a reason.
- Counting by loading rows is rare (6 heuristic hits in 1,648 selects), and offset paging is rare (11 uses in 10 files, all admin lists and version lists).
- The read replica (replicaDb, client.ts:105-110) is built but off, used by one module (analytics-totals.ts), and costs nothing while READ_DATABASE_URL is unset.
- publishedPageNames (pages.ts:713-735) pulls titles out of the JSON in SQL instead of fetching documents: the right shape, and the model for DQ-2.
- Queues are claimed with for update skip locked (integrations.ts:1033-1039, cookie-scans.ts:78-83), and store events are a real queue with done marks (staff-alerts.ts processStoreEvents), so the minute route's alert work follows what waits.
- The dispatcher's prune deletes are served by an index on their time column (search_queries_created_idx, search_cache_created_idx, recommendation_events_created_idx, recommendation_adds_created_idx, form_submissions_created_idx, api_idempotency_keys_created_idx, docs_reads_day_idx, oauth_tokens_expires_idx): they will not scan the growing tables. Their cadence is DQ-5's matter.
- A page view is recorded with two statements (one read, one upsert that also counts product views) plus a rate check for a new visitor (analytics-visits.ts recordVisit): lean for the write that will grow fastest.
- cronAuthorised() reads the scheduler's secret from Vault at most every five minutes per instance (cron-auth.ts:18-31), not on every call.
- Several dispatcher jobs already ask only for stores where the feature is set up (staff-alerts.ts joins staff_alert_settings; order-archive.ts starts from order_settings.auto_archive_days). The chat agent is off by default, so the knowledge job's cost follows the stores that switch it on.
- bonus_expire_due and the VAT-label midnight check are one set-based statement a tick each (2.1 ms and 7.3 ms a call): the right shape for a job over all stores.
- getStore() reads one wide row per store and is cached per store (stores.ts:231-277): one statement in place of many small ones.
- The admin's session, account and membership reads are wrapped in React cache() (auth.ts:121, 215, 354, 407), and cart, checkout and order share one read per request through perRequest().
- status_checks is pruned at 91 days (status.ts:265); the statistics file's note 'never pruned' is wrong.
- The proxy's two store reads are kept 10 s per instance (redirect-resolve.ts:203-232, house-switch.ts:31-43): single-row reads whose cost follows shopper traffic.
- media.url has a unique index and thumbnail_url an index (baseline_3_rules.sql:2884, 9796), so alt-text lookups can use them once the table is large.
