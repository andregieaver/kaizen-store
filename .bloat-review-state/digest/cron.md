# cron: Scheduled and background work

Scheduled work is a fixed floor today, not a load: Supabase calls the app 13,250 times a day and those calls send about 170,000 statements, nearly all finding nothing because the platform is not open, so no feature here should be retired for being unused. The one measured waste is pg_cron's own run log, never pruned: 564 MB, 77% of the 731 MB database, fixed by one small migration (CR-5). What matters at opening is work that grows with stores, pages, products or orders on every run whether or not anything changed: chat knowledge, media, alt texts and product vectors (CR-4), the listings' check that hashes every product on the platform and asks the AI again about unreadable ones every five minutes (CR-15), automations and ad conversions each minute (CR-3), the cookie scan's due check (CR-6), waiting invoices (CR-9) and the accounting loops (CR-16). Calling the six queue routes only when a row waits (CR-1), giving about 30 of the 83 five-minute jobs an hourly or daily cadence with one ledger write a run (CR-2) and holding both with a registry and a scan test (CR-14) keep the floor from growing back; before opening is the cheapest time for all of it.

## Measures
- Scheduled function calls a day: 13,250 (12,960 from nine every-minute routes, 288 dispatcher runs, 2 daily routes); 13,252 pg_cron runs with the two SQL retention deletes
- Statements per idle minute from the nine every-minute routes: about 58 queries + 10 ledger upserts = 68 a minute, about 97,900 a day
- Dispatcher jobs: 83 (78 in runJobs + 5 tracked after it), each every 300 s; 84 ledger upserts and 1 delete a run
- Dispatcher wall time against the sum of its jobs' recorded times: 1,341 ms against 12.1 s
- How long a queued query may wait for a connection: 5 s, then it throws 'timeout exceeded when trying to connect'
- Jobs run every 300 s whose work is daily or slower: about 30 of 83: 9 pure prunes and about 21 jobs tied to a day, an hour or a week
- Jobs that loop over stores on every run: at least 12 of 83: knowledge, media, altTexts, embeddings (stores with their own AI), invoices, ledger, tripletex, fiken, autoArchive, autopilotBudgets, recurring, ebay; plus automations in the broadcasts route
- Size of the functions the scheduler calls: 11 of 13 routes require 118 to 145 chunks at start, 10.9 to 11.7 MiB of JavaScript (11.4 to 12.3 MB), and trace to 47 to 51 MiB; cookie-scan, page-looks and theme-shots trace to 125 MiB with Chromium; document-pdfs 30 chunks, 1.5 MiB at start, 102 MiB traced;…
- Cron's share of pg_stat_statements (78 days): net.http_post 352,514 calls, 3,974 s (first by total time, 51 s a day on average); cron_jobs upserts 565,049 (84 s); cookie-scan due check 49,338 calls, 192 s; theme snapshot read 35,101 calls, 101 s; issue_waiting_invoices 9,909 calls, 132 s; knowledge delet…
- pg_cron's own run log: 564 MB (the cron schema), 77% of the 731 MB database; no cleanup anywhere in the repo
- The listings' check (content moderation): 10 AI calls a run at most, 2,880 a day; one platform-wide hash of every product's words every five minutes; an unreadable answer is retried every run
- The daily job: 40 functions in one request (13 at once, 8 in turn, 19 at once), 24 of them prunes, 2 ledger rows, 19 catches that log to the console and answer nothing
- Outbound calls per idle dispatcher run: 3 for the status probes (own /admin/sign-in, Supabase auth health, Stripe balance) + 1 to 2 Stripe payouts.list for platformBooks: up to 1,440 a day, of which up to 576 are the payout reads
- status_checks at steady state: about 131,000 rows (1,440 a day x the 91-day prune); 20,547 rows and 3.2 MB today, about 14 days old
- after() on requests: 38 files call it; 8 are cron routes, 30 are request-side kicks of work the request itself created

## Well made
- An empty table before opening is not a finding. No feature in this dimension should be retired, parked or hidden because its queue has never held a row; the counts in production are idle cost and the team's own testing.
- Most dispatcher jobs are set-based: one to six statements over all stores, so their idle cost is the same at 60 or 6,000 stores (read: src/server/kaizen-life-handoffs.ts:502-551, src/server/sms.ts:691-718, src/server/bonus.ts:550-576, src/server/store-trial.t…
- Claims and leases are sound: queues are claimed with 'for update skip locked' and an expiry (read src/server/site-tools.ts:453-470, src/server/page-looks.ts:235-246, src/server/dream-factory.ts:459-474, src/server/theme-shots.ts:164-187).
- The run ledger and its alerts (src/server/cron-runs.ts, src/lib/cron-health.ts) are worth keeping: a late or failing job shows on the platform home and one failing job does not stop the others. Only how often it is written, and what it records, needs changing.
- Chromium is imported lazily (src/server/browser.ts:10-16) and traced into seven route patterns only (next.config.ts:50-66); an idle run of a Chromium route never loads the browser.
- Request-side after() is used well: it kicks work the request itself just created (src/server/site-tools.ts:245, src/app/admin/(gated)/[store]/broadcasts/actions.ts:93, src/server/support-inbound.ts:148, src/app/admin/(gated)/[store]/products/actions.ts:118). …
- The scheduler's calls do not pass through the proxy: its matcher leaves out api/ (src/proxy.ts:54-60).
- status_checks is pruned: src/server/status.ts:266 deletes checks older than 91 days. The stats file's 'never pruned (0 deletes)' is because the table is about 14 days old.
- net._http_response prunes itself: docs/decisions.md D263 counted 792 kept calls, six hours of the jobs scheduled then; the net schema is 8.5 MB.
- The daily usage route is set-based: one transaction of statements over all stores (src/server/usage-meter.ts:55-67).
- Store events (a paid order's rules and alerts) are a real queue with claims (src/server/staff-alerts.ts:924-943), and a ledger document that cannot be posted waits a day before the next try (src/server/ledger.ts:606-607).
- Cron auth is cheap and safe: the Vault secret is read at most every five minutes per instance and compared in constant time (src/server/cron-auth.ts:18-44).
- The cadence patterns already exist inside the dispatcher: two jobs limit themselves to the first five minutes of an hour (src/server/autopilot-effects.ts:44, src/server/experiment-jobs.ts:50) and the nightly translation claims its day (src/server/cron-runs.ts…
- The status job's outbound calls (own sign-in page, Supabase auth, Stripe balance, at most three pending checkouts) are what the status page measures; the AI probe limits itself to once a day (src/server/status.ts:148-165).
- Stores' own payouts are read once a day per store, five stores a run (src/server/payouts.ts:184-189); Tripletex opens no session when a store has nothing to send (src/server/tripletex-sync.ts:515-523).

## Findings (17)

### CR-1 [P1 M eager corrected] Nine routes are called every minute whether or not anything waits
- evidence: pg_cron posts to nine routes every minute: 12,960 calls a day. The ledger says they last took 0 to 72 ms; seven answer before working. Idle paths as read: autopilot 13 statements, broadcasts about 15, integrations about 14, theme-shots 8, cookie-scan 3, dream-factory 2, page-jobs, page-looks and pack-pictures 1 each, plus one ledger upsert per route and one for dream-factory.advance: about 68 a minute. Most queues a…
- cost: 12,960 invocations a day of functions that are already warm, and about 97,900 idle statements a day. Each call opens fresh connections to the pooler, because idle ones close after 5 s (db/client.ts:14). In database time… (The server per invocation (Vercel) and the Supabase pooler; the database a litt…)
- fix: 7 steps; first: 1. Write one custom migration (pnpm exec drizzle-kit generate --custom --name cron_tick, then node scripts/prune-snapshots.mjs). In it create commerce.cron_due(p_now timestamptz default now()) returns setof text, language sql, stable, search_path ''. It retur…
- done when: In production, select count(*) from cron.job where schedule = '* * * * *' returns 1, and over one quiet day commerce.cron_jobs.runs for route.page-jobs rises by no more than 100 (1,440 today).
- saving: Estimate. Lasting, whatever the store count: the six queue routes fall from 8,640 calls a day to the sweep's 576 plus the minutes with real work, and about 33,000 idle statements a day go. pg_cron's own runs, and so its log rows (CR-5), fall from 13,250 to ab…
- after: nothing
- tracked: Partly. The PSI audits advise folding the every-minute routes into one as PERF-10 (docs/audits/psi-2026-11-01.md:788 and the three audits before it); it never …
- notes: Sizes: the skeptic's figures are MiB (47.3 traced, 10.9 at start for page-jobs); my re-measure in decimal MB is 49.6 and 11.4, the same bytes. Why nearly every scheduled route loads the same 118 chunks is a question for the bundle dimension; here it only sets…

### CR-2 [P1 M eager corrected] The dispatcher runs all 83 jobs every five minutes: one cadence for everything, one ledger write per job, five connections
- evidence: runJobs() starts 78 jobs at once with Promise.all and five more follow one after another, all with EVERY = 300. Nine are pure prunes with retention of 24 hours to 180 days, though docs/capacity.md:112 puts a prune in the daily cron. About 21 more are tied to a day, an hour or a week (the platform briefing at 07:00 Oslo, staff summaries, analytics alerts, report emails, autopilot reports and budgets, nightly translat…
- cost: At least 248 statements per idle run (the auditor's floor, not recounted), about 71,400 a day; small in database time. The real exposure is at opening: 83 jobs queue on 5 connections with a 5 s limit, so one job that ho… (The database and the dispatcher's function, every five minutes; later, the jobs…)
- fix: 6 steps; first: 1. src/lib/cron-health.ts: add a pure jobDue(every, lastStartedAt, now): every 300 is always due; 3,600 is due when lastStartedAt is null or before the start of the current UTC hour; 86,400 when it is before the start of the current UTC day. Unit-test it in s…
- done when: One day after the deploy, select count(*) from commerce.cron_jobs where job like 'dispatcher.%' and every_seconds = 300 is 58 or fewer of 83, runs for dispatcher.searches rises by 1 a day (288 now), and the single-row 'insert into commerce.cron_jobs' statement in pg_stat_statements gains fewer than 15,000 calls a day …
- saving: Estimate: about 8,100 job runs a day fewer from cadence (30 jobs x 288 become about 560), and ledger round trips from 84 to 1 per run (about 24,000 a day fewer). The larger gain is headroom: fewer jobs competing for five connections when real work arrives.
- after: nothing
- tracked: No. PSI REL-06 (done) made the ledger; the earlier advice to split the dispatcher was answered with maxDuration, not with cadences.
- notes: CR-14 is the same change seen from the rule's side: build the cadence as a registry and the scan test with it. CR-17 reuses runJobs for the daily route.

### CR-3 [P1 M eager corrected] The marketing and autopilot minute routes: 28 idle statements a minute now, and per-store, per-order work every minute once a feature is on
- evidence: An empty table is not a reason to change anything, and the idle statements here are already counted in CR-1 (28 of its 58). What the code shows is how the work grows once a feature is used. runAutomations() loads every enabled automation and then, per store, reads the store once and, per store and kind, runs one due query, every minute, for emails whose delays count in days (automations.ts:264-271). queueAdConversio…
- cost: Today: 28 idle statements a minute, part of CR-1's floor. At opening (estimate from the SQL, not measured): automations cost about two statements per store per kind per minute, so 2,000 stores with two automations are a… (The database and the broadcasts and integrations functions, every minute, in pr…)
- fix: 6 steps; first: 1. src/server/automations.ts: replace the loop over enabledLifecycles() with one statement per kind that joins commerce.automations (enabled, the kind, store active, not a template) to the due people of every store, takes delay_days and enabled_at from the jo…
- done when: A new case in src/server/automations.int.test.ts counts the statements of one runAutomations() with 20 stores, two enabled automations each and nothing due: 4 or fewer (at least 61 today: one list, 20 store reads, 40 due queries).
- saving: Estimate: no new saving today beyond CR-1. At opening the routes' cost follows due work instead of stores times kinds and a week of orders.
- after: nothing
- notes: The growth figures are estimates read from the SQL; no plan was run. Before opening there are no conversations or sends to migrate, so the marker is cheapest now.

### CR-4 [P0 M eager confirmed] AI upkeep re-reads whole catalogues, sites and libraries every five minutes to learn nothing changed
- evidence: knowledge: for each site with a chat agent on, every run reads the site's locales (2 queries), every published page with its whole 'published' JSON, its blogs and its content entries, compares versions in JavaScript, runs a delete, resolves the AI and reads stale passages. A page that yields no passages gets no version (replacePassages deletes and inserts nothing), so it is cut again on every run: 91,200 'delete fro…
- cost: The dispatcher's four slowest database jobs after the status probes: alt-texts 604 ms, media 555, knowledge 542, embeddings 241. Database time is small today because there are 60 stores. It is the part of scheduled work… (The database and the dispatcher every five minutes; it scales with every store …)
- fix: 8 steps; first: Ship the four parts apart, smallest first. The aim for each job: an idle run is one statement over all stores, so the job can stay at five minutes and nothing gets slower.
- done when: In pg_stat_statements the calls of 'delete from commerce.knowledge_chunks where page_id = $1' rise by no more than the pages published that day (about 1,170 a day on average now), n_tup_upd on media_embeddings rises by fewer than 100 a day at today's size, and the new knowledge.int.test.ts shows an idle refreshKnowled…
- saving: Estimate: the four jobs fall from about 1.9 s of recorded time to a few statements per run; the 91,200 empty transactions and the daily re-touch of every picture stop; cost per store becomes cost per change.
- after: CR-2 (only for the hourly passes of steps 2, 4 and 6; steps 1, 2, 5 and 6 need nothing)
- tracked: no (docs/audits/psi-2026-10-24.md:146 judged these 'incremental'; the code and the stats show the knowledge loop and the media re-touch are not)
- notes: Under the owner's clarification this is the scheduled-work finding that matters most: it is cost per store whatever the store uses. Steps 1 and 6 are small and safe. Before opening there is no data to migrate, so the cuts table and the marker are cheap now. T…

### CR-5 [P0 S dead corrected] pg_cron's own run log is never pruned and is 77% of the database
- evidence: pg_cron writes one row to cron.job_run_details for every run and never deletes them. The baseline schedules 14 jobs; two are retention deletes for commerce tables, none for cron's own log. A search for job_run_details and log_run over src, scripts, docs and supabase/migrations finds nothing outside the first draft of this review. Measured in production: the cron schema is 564 MB of a 731 MB database; the app's own s…
- cost: 564 MB today (measured), 77% of the database. It grows by 13,250 rows a day at today's schedule: estimate 8 to 21 MB a day, 3 to 8 GB a year (the row size is not measured). (The database: disk, every backup and every restore. It grows with the schedule,…)
- fix: 3 steps; first: 1. One custom migration (name it cron_log_retention), inside the same guard as the baseline's cron block: cron.schedule('kaizen-cron-log-retention', '41 * * * *', a delete from cron.job_run_details where runid in (select runid from cron.job_run_details where …
- done when: select min(end_time) from cron.job_run_details is never older than 8 days, and the 'size by schema' query shows the cron schema under 60 MB after the one-off truncate (or the same size within 10 MB two weeks apart without it).
- saving: Up to 564 MB of 731 MB (measured size; how much comes back depends on the truncate or vacuum), and 8 to 21 MB a day of growth stopped (estimate).
- after: nothing
- notes: The auditor's first figure (190 MB) was an estimate; 564 MB is the measurement. CR-1's single tick cuts new rows by about 87%, so do this first and CR-1 after.

### CR-6 [P1 S eager corrected] The cookie scan's due check reads every site every minute without a usable index, and failing sites are retried hourly ahead of healthy ones
- evidence: Each minute claimScan() runs two updates and then a statement that lists every open site and, per site, runs two subselects on cookie_scans to find its last scan. Stats: 49,338 calls, 192 s, the fifth most expensive statement; cookie_scans has 1,101,927 sequential scans reading 962 M rows, the most of any table. An index on (store_id, created_at) exists (cookie_scans_store_created_idx), but the subselects compare wi…
- cost: Today: 3 statements a minute and about 4 s of database time a day; 40 to 50 Chromium runs a day, each up to twelve page renders of our own sites. At opening (estimate from the code): the check is sites times scans-per-s… (The database every minute; the server and the storefront functions for each sca…)
- fix: 6 steps; first: 1. Check the cause first, read-only: select status, requested_by is null as scheduled, count(*) from commerce.cookie_scans where created_at > now() - interval '7 days' group by 1, 2, and read the failed rows' error. If most scheduled scans are 'failed', the h…
- done when: seq_tup_read on commerce.cookie_scans in pg_stat_user_tables grows by under 1 M a day (about 21 M a day now: 962 M over 45 days), and scheduled scans in a day are at most a seventh of the sites plus 5.
- saving: Estimate: the due check from about 21 table scans a minute to one index read every 15 minutes; Chromium runs from 40 to 50 a day to about two at today's size if retries are the cause.
- after: CR-1 (the tick and the sweep minute); steps 1 to 3 need nothing
- notes: The index exists; the null-safe comparison is what stops its use. That is why 'add an index' alone would not help.

### CR-7 [P2 S eager corrected] The theme-shots route rebuilds its whole wanted list every minute
- evidence: runThemeShots() starts each minute with queueThemeShots(): it reads every published theme with its whole snapshot JSON (35,101 calls, 101 s, 348,763 rows, about ten themes a call), the themes' contents, the showcase stores and every theme_shots row (88,341 sequential scans), then one update, a claim under an advisory lock and a prune read: about 8 statements a minute. What is wanted changes only when a platform admi…
- cost: About 11,500 statements a day and every published theme's snapshot read 1,440 times a day. A fixed floor: themes are the platform's, so it does not grow with stores. (The database and the server, every minute.)
- fix: 4 steps; first: 1. src/server/theme-shots.ts: move the third statement of queueThemeShots() (lines 137-143, the unit whose run stopped at the end of a round) into its own settleStoppedShots(). runThemeShots() (lines 330-341) calls settleStoppedShots(), then claims. It calls …
- done when: In pg_stat_statements the calls of the statement that selects p.snapshot from commerce.design_presets where p.published and p.archived_at is null rise by 100 or fewer a day (1,440 now).
- saving: About 8 statements a minute to 0 or 1 while idle (about 11,500 a day); the snapshot read falls from 1,440 to at most 96 a day.
- after: nothing
- notes: With CR-1's gate the route is not called at all while no unit waits; this step still matters in the minutes when units do wait, and it is small. Do it in CR-1's change.

### CR-8 [P2 S eager confirmed] Kaizena Flow's own payouts are read from Stripe every five minutes
- evidence: runPlatformBooks() calls stripe.payouts.list for the last 40 days in every mode that has keys, on every dispatcher run, with no throttle, and upserts every payout it gets back each time. Payouts arrive at most daily. Stores' payouts, by contrast, are read once a day per store through payout_reads (payouts.ts:184-189). Separately, invoiceJobs() calls ensureSubscriptionEvents for test and live; it remembers the answer…
- cost: 1 to 2 Stripe API calls per run: 288 to 576 a day, whatever happens. Once payouts exist, also one upsert per payout of the last 40 days per run. Up to 2 more Stripe calls per cold start (how often is not known). (The server per run, and Kaizena Flow's Stripe rate limit.)
- fix: 4 steps; first: 1. src/server/platform-books.ts:238-245: split runPlatformBooks() in two. readPlatformPayoutsDue() does the Stripe read; postPlatformMoney() (no network) stays the five-minute job's part.
- done when: In platform-books.int.test.ts a counting Stripe stand-in sees payouts.list once per mode for two runs in the same hour, and in production the ledger row dispatcher.platform-payouts has every_seconds 3600 (or daily.platform-payouts exists).
- saving: About 288 to 576 Stripe calls a day to 24 to 48 (hourly) or 1 to 2 (daily).
- after: CR-2 (the hourly cadence), or use claimDay without it
- notes: No payout event is handled in src/server, so a webhook is not an alternative today.

### CR-9 [P1 S eager corrected] The invoice job re-asks the same waiting stores every five minutes, with no back-off and no order
- evidence: storesWithDocumentWork() returns up to 50 stores that have a paid order of the last 120 days with no invoice, with no 'order by' and no note of why the order waits. The job then calls commerce.issue_waiting_invoices and commerce.issue_missing_credit_notes for each. Stats: 9,909 calls each, 132 s and 35 s (13.3 ms and 3.5 ms a call), and no invoice came of them: the same stores come back on every run. The SQL functio…
- cost: About 17 ms of database time per waiting store per run, for up to 120 days per order; 167 s so far. At opening (read from the code): new owners who take orders before filling in their business details will be common; on… (The database every five minutes; later, an owner whose invoice is not issued be…)
- fix: 4 steps; first: 1. src/server/invoice-issue.ts:71-101, the first branch of storesWithDocumentWork(): add the two conditions the SQL function itself applies, commerce.invoice_eligibility(o.id) = 'ok' and commerce.invoice_readiness(o.id) = 'ready', so a store appears only when…
- done when: The calls of 'select commerce.issue_waiting_invoices($1, $2)' in pg_stat_statements rise by fewer than 10 a day on today's data (about 127 a day now), and the two new cases in invoice-issue.int.test.ts pass.
- saving: About 9,900 function calls per 78 days at today's size to a few a day, and the 50-store cap stops being a way to starve a store.
- after: nothing
- notes: Small, and it removes a way for an owner's invoice never to be issued; that is why it is P1 though today's cost is seconds.

### CR-10 [P2 S oversize confirmed] The docs search index is rewritten row by row on every docs change
- evidence: When the deployment's docs fingerprint differs, writeDocsIndex() upserts all rows with 'on conflict (key) do update' and no condition (docs-search.ts:109), then deletes rows whose updated_at is older than the transaction (line 120). Every row is rewritten even when one article changed; each rewrite recomputes two generated tsvector columns and a trigram text and touches three GIN indexes. The vector is kept when the…
- cost: About 1,845 row versions written per docs-changing deploy, with GIN upkeep. How much of the 33 MB is dead space was not measured. (The database on each deploy that changes content/docs or the contracts. It is d…)
- fix: 2 steps; first: 1. src/server/docs-search.ts:109-117: add a where to the upsert: the stored text_hash is distinct from excluded.text_hash, or the row of the other written columns (doc, item, track, kind, lang, areas, features, plans, section, section_title, path, url, title,…
- done when: After a deploy that changes one docs article, n_tup_upd for commerce.docs_index in pg_stat_user_tables rises by fewer than 50 (1,845 before).
- saving: Estimate: writes per docs deploy from 1,845 rows to the rows that changed. The table file shrinks only with a 'vacuum full'; a plain vacuum makes the space reusable.
- after: nothing
- notes: A fixed, platform-level cost. Worth doing because it is two lines, not because it is large.

### CR-11 [P2 S dead corrected] An unscheduled PDF route is deployed with Chromium, and a 'finished' backfill is still fed by every copied AI picture
- evidence: /api/cron/document-pdfs has no schedule in the migrations and no caller in src: a search for 'document-pdfs' and 'pdfJob' finds the route, comments, docs and tests only. Its own comment and docs/wave-1b-invoices.md:808 say 'schedule it where the five-minute job is scheduled; nothing breaks without it', and nobody did. The scan test excuses it as 'run by the dispatcher's invoice job and by staff', which the code does…
- cost: One 101.9 MiB function in every deploy that nothing calls, and waiting PDFs are made only on first download although 'Try again' says the job makes them on its next run. aiPictureMarks: one query a run today; at opening… (The build and deploy (function size); the dispatcher and storage per new store;…)
- fix: 6 steps; first: 1. document-pdfs, put it to use (recommended: it keeps the promise in 'Try again'): after CR-1, add 'document-pdfs' to commerce.cron_due() when an invoice or credit note has pdf_path null, is not anonymised and has fewer than five attempts (the predicate of p…
- done when: cron-routes.scan.test.ts passes with document-pdfs out of NOT_SCHEDULED (or the route folder is gone), and the count query of step 3 returns 0 a week after a store was made from a theme with AI pictures.
- saving: One Chromium function out of the deploy or put to use; the storage downloads for copied AI pictures never start; about 290 job runs and 288 deletes a day.
- after: CR-1 (to schedule the PDF route behind the tick); CR-2 (the ledger write)
- tracked: no (psi-followups.md:216 marks the backfill done but does not retire the job; docs/audits/psi-2026-10-28.md:383 notes document-pdfs as unscheduled)
- notes: The auditor's sub-item 'run keepStripeWebhooksCurrent daily' was refuted and is not part of this fix.

### CR-12 [P2 S duplicate confirmed] The daily job is scheduled twice, at the same minute
- evidence: vercel.json schedules /api/cron/subscription-reminders at '0 7 * * *' and pg_cron schedules the same route at '0 7 * * *'. The route's comment says this is meant: 'Supabase's scheduler calls it (D33), and Vercel Cron too where CRON_SECRET is set; each reminder goes once whoever calls.' That was written when the route sent reminders; it now runs about 40 functions (24 prunes, erasures, currency rates, domain renewals…
- cost: If the secret is set: the whole daily job runs twice at the same moment every day, each on five connections, both deleting the same rows (a statement may wait 5 s for a lock, then fails). If not: one refused call a day.… (The server and the database once a day; and anyone debugging a daily job that r…)
- fix: 4 steps; first: 1. vercel.json: remove the 'crons' block (lines 6-11). pg_cron stays the one scheduler (D33, D263).
- done when: vercel.json has no 'crons' key, and commerce.cron_jobs.runs for route.subscription-reminders rises by exactly 1 a day.
- saving: At most one duplicate run of the daily job a day; one scheduler instead of two.
- after: nothing
- notes: The effect in production is unconfirmed (CRON_SECRET's presence in Vercel was not checked), so confidence stays medium.

### CR-13 [P3 S oversize confirmed] Status checks are kept raw for 91 days though the page shows one bar a day
- evidence: Each run inserts one row per measured part (five of the six today): 1,440 rows a day. The prune keeps 91 days, so the table heads for about 131,000 rows; it has 20,547 after about 14 days. The page's read groups all 90 days into per-day counts and also runs a 'distinct on (component)' over the whole table with no time bound (status.ts:381-383), each time its cache is refilled, and the dispatcher refreshes that cache…
- cost: Estimate at steady state: about 131,000 rows and 20 MB, and two reads of the whole table on each cache refill. A fixed platform cost; it does not grow with stores. (The database, and a visitor to /status after each five-minute refresh.)
- fix: 2 steps; first: 1. Small step: src/server/status.ts:381-383, bound the 'newest check per part' read to checked_at > now() - interval '1 day', so it uses status_checks_component_idx (component, checked_at).
- done when: After step 1, seq_scan on commerce.status_checks in pg_stat_user_tables rises by 300 or fewer a day; after step 2 the table holds under 12,000 rows.
- saving: Estimate: about 131,000 rows to about 11,500 raw rows plus 540 day rows; the page's read from 131,000 rows to about 550.
- after: nothing
- notes: P3 because the table is pruned and bounded at about 20 MB, and it is the platform's own, not per store. Do step 1 when status.ts is next opened; step 2 only if the page gets slow.

### CR-14 [P1 S process confirmed] Nothing limits or measures scheduled work, so each feature adds a poll
- evidence: The scan test asks only that a cron route has a maxDuration and is tracked. The written rule ('new heavy work gets a route of its own') has produced nine every-minute routes, from six on 24 October; each PSI audit since has noted it under PERF-10 and none stopped it. A new job is one line in runJobs() with no cadence, no due check and no reason. The ledger cannot show idle cost or growth: for the seven routes that w…
- cost: Unbounded growth: 83 jobs now, and nobody sees which ones will cost per store. An agent reading the dispatcher pays about 6,000 tokens for the file (estimate from 24,495 bytes). (Everyone later: the database, the server, and each agent session that opens the…)
- fix: 5 steps; first: 1. Build CR-2's job list as a registry the dispatcher runs from (in src/app/api/cron/cart-reminders/route.ts or a new src/server/cron-registry.ts): for each job its name, every (300, 3600, 86400), work ('set' for one statement over all stores, or 'per-store' …
- done when: cron-routes.scan.test.ts fails on a fixture job that has no cadence, and the platform's Usage and limits page lists, for each job, when it last did any work.
- saving: No direct saving; it keeps CR-1 to CR-4 from growing back and turns the next audit into a query instead of a code read.
- after: CR-2 (the same change); CR-1 (for the route check)
- tracked: Partly: REL-06's open item (docs/audits/psi-followups.md:477) covers recording the after-answer routes' real work; PERF-10 in the PSI audits names the growth; …
- notes: This is the check that keeps the rest fixed. It costs little if it is built with CR-2 and not after it.

### CR-15 [P1 S eager added] The listings' check hashes every product on the platform every five minutes, and a listing the AI cannot answer for is asked again every run at the head of the queue
- evidence: The dispatcher's contentModeration job ends with screenListings(), Kaizena Flow's own check of listings (DSA art. 7, voluntary), on unless a platform admin turns it off (content_screening defaults to true, line 160). Its candidate statement (lines 205-225) first sorts every row of commerce.product_translations on the platform (distinct on product_id, with title, description and safety text, no store or status filter…
- cost: Database: one statement every five minutes that reads and sorts every product text on the platform; the like statement for embeddings takes 14.5 ms at today's few hundred translations and cannot use an index for 'hash d… (The database every five minutes, in proportion to every store's catalogue; Kaiz…)
- fix: 4 steps; first: 1. Record a try (smallest, do first). Migration: commerce.content_screened gains tries integer not null default 0 and tried_at timestamptz. In screenListings() (content-moderation.ts:227-231), when the answer is null or unreadable, upsert the row with the has…
- done when: The two new cases in content-moderation.int.test.ts pass, and in production select count(*) from commerce.ai_usage where feature = 'content_moderation' and created_at > now() - interval '1 day' is at most the products created or reworded that day plus the notices plus 10.
- saving: Estimate: up to 2,880 wasted AI calls a day avoided when answers cannot be read, the queue can no longer be held by ten listings, and the platform-wide hash runs 24 times a day instead of 288 (then only over what changed).
- after: CR-4 step 4 (the text_changed_at marker) for step 2; CR-2 (the hourly cadence) for step 3; step 1 needs nothing
- notes: Found by the planner while reading the 30 costliest dispatcher jobs (content-moderation 213 ms). Not an argument against the feature: the check stays, on by default. The daily cap and that Kaizena Flow pays for every store's listings are the owner's to know, …

### CR-16 [P2 M eager added] Six more five-minute jobs re-check every store that has the feature on, and the ledger's order never rotates
- evidence: The verified report's clean list says only the loops of CR-3, CR-4, CR-6 and CR-9 grow. A scan of all 83 job functions for loops (scratch script, then each read) finds six more that do per-store work on every run. ledger: for every book that is open or closed in the last 60 days, one statement with ten 'union all' branches over invoices, credit notes, payments, refunds, payouts and disputes with two anti-joins (ledg…
- cost: Nothing for a store that does not use these features: the cost follows use, which is the right shape. For stores that do, it is paid per run and not per change. Estimate from the code: 1,000 stores with books and Triple… (The database every five minutes, in proportion to the stores that use books, Tr…)
- fix: 5 steps; first: 1. Ledger order (smallest, do first). Migration: commerce.ledger_books gains checked_at timestamptz. runLedgerPosting() (ledger.ts:1042-1046) orders by checked_at nulls first and sets checked_at = now() for each book after its turn, so every book gets a turn …
- done when: The new ledger case passes (the third book is reached within three runs), and in production the ledger rows dispatcher.auto-archive, dispatcher.autopilot-budgets and dispatcher.recurring have every_seconds 3600.
- saving: Estimate: none measurable today (few stores use these). At opening an idle book or connection costs no statement between hourly looks instead of 2 to 5 every five minutes, and no book can be starved by the order.
- after: CR-2 (cadence) for step 4; CR-14 (the registry) for step 5; steps 1 to 3 need nothing
- notes: Added by the planner: the brief asked for jobs that loop over every store, and these six were cleared by a general sentence. The statement counts per store are read from the code, not measured; the 7,000 figure is an estimate. eBay (ten stores a run, oldest s…

### CR-17 [P2 M process added] The daily job runs about 40 functions in one request under one ledger row, so a prune that fails is not seen
- evidence: Counted in the route: 13 functions start at once (line 61), 8 run one after another (lines 63-78), then 19 start at once (line 79): 40 in all, of which 24 are prunes. Two ledger rows cover them: route.subscription-reminders and daily.database-door. docs/capacity.md:112 asks that a prune 'never throws', and most obey by catching their own error: pruneVisits() logs a warning and returns what it managed (analytics-visi…
- cost: No running cost today: it runs once a day. The exposure is the review's own subject: retention is the only brake on table growth (24 prunes) and part of the GDPR schedule (D162), and nothing shows per job whether it ran… (The database later, in tables that grow unseen; the platform's admins, who hear…)
- fix: 6 steps; first: 1. src/app/api/cron/subscription-reminders/route.ts: run the daily functions through runJobs('daily', 86_400, {...}) in CR-2's shape (small groups, one ledger write), so each has a row daily.<name> with its last run, its failure and, with CR-14, the rows it h…
- done when: select count(*) from commerce.cron_jobs where job like 'daily.%' and every_seconds = 86400 is 38 or more, and a new case in cron-runs.int.test.ts shows a daily job that throws leaves the others' rows ok and its own counted as failed.
- saving: No direct saving. A prune that stops working shows on the platform home within three days (FAILING_AFTER) instead of never, and one failing delete no longer skips the day's retention.
- after: CR-2 (runJobs with groups and one ledger write); CR-12 (one scheduler, so the job does not run twice at once)
- tracked: no (PSI REL-06 made the ledger for routes and dispatcher jobs; the daily route got one row)
- notes: Added by the planner under the brief's 'retention that is missing': the rules exist, the check that they run does not. Confidence is medium because no prune was seen failing; the finding is that it could not be seen.

## Refuted (not findings)
- CR-3a Two minute routes and 36 dispatcher jobs are speculative because their tables never held a row: The owner's clarification: every feature is unused before opening. Kept only as what the same code costs once used (CR-3).
- CR-11b Run keepStripeWebhooksCurrent daily: Saves 288 one-row reads a day and risks a day of lost Stripe events after a change of address, the incident the job was written for.
- CR-9a The owner must decide whether invoicing is broken (paid orders, no invoice): Those are the team's own test and demo orders; not an owner decision. One end-to-end invoice drill before opening is kept as a step.
- CR-6a cookie_scans has no index for the due check; add one: An index on (store_id, created_at) exists; the null-safe comparison is what stops its use, so the statement must change too.
- CR-13a status_checks is never pruned: It is pruned at 91 days (status.ts:266); the table is 14 days old. Kept only as an oversize read (CR-13, P3).
- CR-1a Each minute call loads a function of 47 to 125 MB: The functions are warm; size is paid at deploy and on a cold start. About 11 MiB of JavaScript is evaluated at a cold start.
