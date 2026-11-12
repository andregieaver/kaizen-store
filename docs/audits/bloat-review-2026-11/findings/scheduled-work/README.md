# Scheduled and background work (CR)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** Scheduled work is a fixed floor today, not a load: Supabase calls the app 13,250 times a day and those calls send about 170,000 statements, nearly all finding nothing because the platform is not open, so no feature here should be retired for being unused. The one measured waste is pg_cron's own run log, never pruned: 564 MB, 77% of the 731 MB database, fixed by one small migration (CR-5). What matters at opening is work that grows with stores, pages, products or orders on every run whether or not anything changed: chat knowledge, media, alt texts and product vectors (CR-4), the listings' check that hashes every product on the platform and asks the AI again about unreadable ones every five minutes (CR-15), automations and ad conversions each minute (CR-3), the cookie scan's due check (CR-6), waiting invoices (CR-9) and the accounting loops (CR-16). Calling the six queue routes only when a row waits (CR-1), giving about 30 of the 83 five-minute jobs an hourly or daily cadence with one ledger write a run (CR-2) and holding both with a registry and a scan test (CR-14) keep the floor from growing back; before opening is the cheapest time for all of it.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CR-4](CR-4.md) ✓ | AI upkeep re-reads whole catalogues, sites and libraries every five minutes to learn nothing changed | eager | P0 | M | 0.28 |
| [CR-5](CR-5.md) ✓ | pg_cron's own run log is never pruned and is 77% of the database | dead | P0 | S | 0.25 |
| [CR-1](CR-1.md) ✓ | Nine routes are called every minute whether or not anything waits | eager | P1 | M | 3.1 |
| [CR-2](CR-2.md) ✓ | The dispatcher runs all 83 jobs every five minutes: one cadence for everything, one ledger write per job, five connections | eager | P1 | M | 3.3 |
| [CR-3](CR-3.md) ✓ | The marketing and autopilot minute routes: 28 idle statements a minute now, and per-store, per-order work every minute once a feature is on | eager | P1 | M | 3.2 |
| [CR-6](CR-6.md) ✓ | The cookie scan's due check reads every site every minute without a usable index, and failing sites are retried hourly ahead of healthy ones | eager | P1 | S | 0.23 |
| [CR-9](CR-9.md) ✓ | The invoice job re-asks the same waiting stores every five minutes, with no back-off and no order | eager | P1 | S | 0.30 |
| [CR-14](CR-14.md) ✓ | Nothing limits or measures scheduled work, so each feature adds a poll | no check | P1 | S | 3.3 |
| [CR-15](CR-15.md) | The listings' check hashes every product on the platform every five minutes, and a listing the AI cannot answer for is asked again every run at the head of the queue | eager | P1 | S | 0.29 |
| [CR-7](CR-7.md) ✓ | The theme-shots route rebuilds its whole wanted list every minute | eager | P2 | S | 3.1 |
| [CR-8](CR-8.md) ✓ | Kaizena Flow's own payouts are read from Stripe every five minutes | eager | P2 | S | 3.3 |
| [CR-10](CR-10.md) ✓ | The docs search index is rewritten row by row on every docs change | oversize | P2 | S | 3.5 |
| [CR-11](CR-11.md) ✓ | An unscheduled PDF route is deployed with Chromium, and a 'finished' backfill is still fed by every copied AI picture | dead | P2 | S | 3.7 |
| [CR-12](CR-12.md) ✓ | The daily job is scheduled twice, at the same minute | duplicate | P2 | S | 1.22 |
| [CR-16](CR-16.md) | Six more five-minute jobs re-check every store that has the feature on, and the ledger's order never rotates | eager | P2 | M | 3.6 |
| [CR-17](CR-17.md) | The daily job runs about 40 functions in one request under one ledger row, so a prune that fails is not seen | no check | P2 | M | 3.4 |
| [CR-13](CR-13.md) ✓ | Status checks are kept raw for 91 days though the page shows one bar a day | oversize | P3 | S | tolerated |

## Refuted by the second reviewer

These were in the first reading and did not hold. They are in no step.

- **Two minute routes and 36 dispatcher jobs are speculative because their tables never held a row.** The owner's clarification: every feature is unused before opening. Kept only as what the same code costs once used (CR-3).
- **Run keepStripeWebhooksCurrent daily.** Saves 288 one-row reads a day and risks a day of lost Stripe events after a change of address, the incident the job was written for.
- **The owner must decide whether invoicing is broken (paid orders, no invoice).** Those are the team's own test and demo orders; not an owner decision. One end-to-end invoice drill before opening is kept as a step.
- **cookie_scans has no index for the due check; add one.** An index on (store_id, created_at) exists; the null-safe comparison is what stops its use, so the statement must change too.
- **status_checks is never pruned.** It is pruned at 91 days (status.ts:266); the table is 14 days old. Kept only as an oversize read (CR-13, P3).
- **Each minute call loads a function of 47 to 125 MB.** The functions are warm; size is paid at deploy and on a cold start. About 11 MiB of JavaScript is evaluated at a cold start.

## Measured

| Measure | Value | How |
|---|---|---|
| Scheduled function calls a day | 13,250 (12,960 from nine every-minute routes, 288 dispatcher runs, 2 daily routes); 13,252 pg_cron runs with the two SQL retention deletes | Counted from supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:93-113 (14 schedules); the folder holds only the four baseline files, so nothing later changes them. |
| Statements per idle minute from the nine every-minute routes | about 58 queries + 10 ledger upserts = 68 a minute, about 97,900 a day | The auditor's count, re-read by the skeptic for autopilot (13), cookie-scan (3), theme-shots (8) and dream-factory (2); broadcasts (15) and integrations (14) read in part. I re-read the six queue routes' claim statements for CR-1's predicates. |
| Dispatcher jobs | 83 (78 in runJobs + 5 tracked after it), each every 300 s; 84 ledger upserts and 1 delete a run | Scratch script over src/app/api/cron/cart-reminders/route.ts:128-275 that lists each job with its function, file and loops (a scratch script); the stats file lists the same 83 names. |
| Dispatcher wall time against the sum of its jobs' recorded times | 1,341 ms against 12.1 s | The skeptic's sum of the 83 last durations in prod-db-stats.md (12,111 ms). The difference is waiting for one of 5 connections (src/db/client.ts:68). |
| How long a queued query may wait for a connection | 5 s, then it throws 'timeout exceeded when trying to connect' | src/db/client.ts:70 (connectionTimeoutMillis: 5000). Not seen failing today; it is the limit 83 parallel jobs on 5 connections meet when real work lengthens the queue. |
| Jobs run every 300 s whose work is daily or slower | about 30 of 83: 9 pure prunes and about 21 jobs tied to a day, an hour or a week | The skeptic's count after reading the nine prunes and a sample of the day-bound jobs; settleTrials() must stay at five minutes (store-trial.ts:101). |
| Jobs that loop over stores on every run | at least 12 of 83: knowledge, media, altTexts, embeddings (stores with their own AI), invoices, ledger, tripletex, fiken, autoArchive, autopilotBudgets, recurring, ebay; plus automations in the broadcasts route | The same scratch script prints each job's 'for' loops; I then read each loop's body. Queue drains (a loop over due rows) and jobs that list stores in one statement and work only on the due ones (summaries, analyticsAlerts) are not counted. |
| Size of the functions the scheduler calls | 11 of 13 routes require 118 to 145 chunks at start, 10.9 to 11.7 MiB of JavaScript (11.4 to 12.3 MB), and trace to 47 to 51 MiB; cookie-scan, page-looks and theme-shots trace to 125 MiB with Chromium; document-pdfs 30 chunks, 1.5 MiB at start, 102 MiB traced; usage 48 chunks, 5.0 MiB | Scratch script over .next/server/app/api/cron/*/route.js (the R.c() chunk list) and route.js.nft.json of the finished build (a scratch script). Paid at deploy and on a cold start, not on each call. |
| Cron's share of pg_stat_statements (78 days) | net.http_post 352,514 calls, 3,974 s (first by total time, 51 s a day on average); cron_jobs upserts 565,049 (84 s); cookie-scan due check 49,338 calls, 192 s; theme snapshot read 35,101 calls, 101 s; issue_waiting_invoices 9,909 calls, 132 s; knowledge delete 91,200 calls for 782 rows | prod-db-stats.md, matched to the statements in the code. |
| pg_cron's own run log | 564 MB (the cron schema), 77% of the 731 MB database; no cleanup anywhere in the repo | prod-db-stats.md 'Size and shape'; a search for job_run_details over src, scripts, docs and supabase/migrations finds nothing outside the first draft of this review. |
| The listings' check (content moderation) | 10 AI calls a run at most, 2,880 a day; one platform-wide hash of every product's words every five minutes; an unreadable answer is retried every run | Read src/server/content-moderation.ts:38-39, 202-231 and src/lib/content-moderation.ts:103-110. Production's count of unreadable answers was not measured. |
| The daily job | 40 functions in one request (13 at once, 8 in turn, 19 at once), 24 of them prunes, 2 ledger rows, 19 catches that log to the console and answer nothing | Counted in src/app/api/cron/subscription-reminders/route.ts:61-79 (rg -o console.error gives 19). |
| Outbound calls per idle dispatcher run | 3 for the status probes (own /admin/sign-in, Supabase auth health, Stripe balance) + 1 to 2 Stripe payouts.list for platformBooks: up to 1,440 a day, of which up to 576 are the payout reads | Read src/server/status.ts:94-137 and src/server/platform-books.ts:238-245 with platform-payouts.ts:80-107. |
| status_checks at steady state | about 131,000 rows (1,440 a day x the 91-day prune); 20,547 rows and 3.2 MB today, about 14 days old | src/server/status.ts:266 and prod-db-stats.md. |
| after() on requests | 38 files call it; 8 are cron routes, 30 are request-side kicks of work the request itself created | rg for after( in src files that import next/server, tests left out (the skeptic counted 40 importing files). |

## Well made, and should stay

- An empty table before opening is not a finding. No feature in this dimension should be retired, parked or hidden because its queue has never held a row; the counts in production are idle cost and the team's own testing.
- Most dispatcher jobs are set-based: one to six statements over all stores, so their idle cost is the same at 60 or 6,000 stores (read: src/server/kaizen-life-handoffs.ts:502-551, src/server/sms.ts:691-718, src/server/bonus.ts:550-576, src/server/store-trial.ts:79-104). The loops that grow are named in CR-3, CR-4, CR-6, CR-9, CR-15 and CR-16.
- Claims and leases are sound: queues are claimed with 'for update skip locked' and an expiry (read src/server/site-tools.ts:453-470, src/server/page-looks.ts:235-246, src/server/dream-factory.ts:459-474, src/server/theme-shots.ts:164-187).
- The run ledger and its alerts (src/server/cron-runs.ts, src/lib/cron-health.ts) are worth keeping: a late or failing job shows on the platform home and one failing job does not stop the others. Only how often it is written, and what it records, needs changing.
- Chromium is imported lazily (src/server/browser.ts:10-16) and traced into seven route patterns only (next.config.ts:50-66); an idle run of a Chromium route never loads the browser.
- Request-side after() is used well: it kicks work the request itself just created (src/server/site-tools.ts:245, src/app/admin/(gated)/[store]/broadcasts/actions.ts:93, src/server/support-inbound.ts:148, src/app/admin/(gated)/[store]/products/actions.ts:118). The only waitUntil on a request is the 404 record in src/proxy.ts:122.
- The scheduler's calls do not pass through the proxy: its matcher leaves out api/ (src/proxy.ts:54-60).
- status_checks is pruned: src/server/status.ts:266 deletes checks older than 91 days. The stats file's 'never pruned (0 deletes)' is because the table is about 14 days old.
- net._http_response prunes itself: docs/decisions.md D263 counted 792 kept calls, six hours of the jobs scheduled then; the net schema is 8.5 MB.
- The daily usage route is set-based: one transaction of statements over all stores (src/server/usage-meter.ts:55-67).
- Store events (a paid order's rules and alerts) are a real queue with claims (src/server/staff-alerts.ts:924-943), and a ledger document that cannot be posted waits a day before the next try (src/server/ledger.ts:606-607).
- Cron auth is cheap and safe: the Vault secret is read at most every five minutes per instance and compared in constant time (src/server/cron-auth.ts:18-44).
- The cadence patterns already exist inside the dispatcher: two jobs limit themselves to the first five minutes of an hour (src/server/autopilot-effects.ts:44, src/server/experiment-jobs.ts:50) and the nightly translation claims its day (src/server/cron-runs.ts:81-91).
- The status job's outbound calls (own sign-in page, Supabase auth, Stripe balance, at most three pending checkouts) are what the status page measures; the AI probe limits itself to once a day (src/server/status.ts:148-165).
- Stores' own payouts are read once a day per store, five stores a run (src/server/payouts.ts:184-189); Tripletex opens no session when a store has nothing to send (src/server/tripletex-sync.ts:515-523).
