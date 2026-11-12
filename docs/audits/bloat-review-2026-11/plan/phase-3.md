# Phase 3: One of each

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Keep one of each thing that was built twice, and add the gates that make cost follow use: scheduled work runs when something waits, at the pace its work changes. Nothing is retired because it is unused. Each fold is of a true duplicate, and before opening no data needs moving. Eight of these steps wait for the owner's answer. The scheduler's steps 3.1 to 3.4 and 3.6 do not, and go in that order. **A person will notice:** On a quiet day the scheduler makes about 1,200 function calls, not 13,250, and the platform home shows every scheduled function with a row of its own. With the owner's yes there is one place to edit Kaizena Flow's site, one engine for what happens when an order is paid, and one deploy for a burst of pushes. There is one import flow.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 3.1 Run one tick a minute, and call a route only when work waits

Nine routes are called every minute whether or not anything waits: 12,960 calls a day of full-application functions, three of them carrying Chromium. One pg_cron job runs commerce.cron_due() each minute: one indexed exists() per queue, net.http_post only for a queue that holds a row, and every route once in 15 minutes as a net. Six routes have a true queue and move first: page jobs, page looks, pack pictures, the Dream Factory, theme shots and the cookie scan. The theme-shots route keeps its wanted list between runs, not reading every published theme's snapshot each minute.

- **Closes:** [CR-1](../findings/scheduled-work/CR-1.md), [CR-7](../findings/scheduled-work/CR-7.md), [DQ-1](../findings/queries/DQ-1.md), [DP-7](../findings/dependencies/DP-7.md), [SF-10](../findings/server-functions/SF-10.md)
- **Effort:** L. **Areas it moves:** Scheduled work; The database; What the server loads and asks; The code itself.
- **Done when:** In production select count(*) from cron.job where schedule = '* * * * *' returns 1 (9 today), over one quiet day commerce.cron_jobs.runs for route.page-jobs rises by no more than 100 (1,440 today), and cron.job_run_details gains about 1,750 rows a day (13,250 today).
- **Platform:** The same routes carry Kaizena Flow's own queues, and cron_due() counts null-store rows.

## 3.2 Let the three feature routes follow what is due

After the tick, three routes that carry several features (integrations, broadcasts, autopilot) would still be called every minute: about 5,200 calls a day against a bar of 1,200. Write each one's 'is anything due' statement as one SQL function that both the tick and the route read, so automations, ad conversions and support emails stop costing stores times kinds every minute. A scan test fails a runner called in a gated route that has no part in the function. The stewards' tick alone does not reach the bar; this is the added part.

- **Closes:** [CR-3](../findings/scheduled-work/CR-3.md), GAP-scheduled-1
- **Effort:** M. **Areas it moves:** Scheduled work; The database.
- **Done when:** Over one quiet day commerce.cron_jobs.runs for route.integrations, route.broadcasts and route.autopilot each rise by no more than 100 (1,440 today), the scheduler's function calls that day total 1,200 or fewer (13,250), and a case in src/server/automations.int.test.ts counts 4 statements or fewer for an idle runAutomations() with 20 stores (at least 61 today).
- **Platform:** The same routes carry Kaizena Flow's own broadcasts, integrations and briefing.

## 3.3 Run the dispatcher from a registry: a cadence and a time budget per job, four at a time

All 83 dispatcher jobs share one five-minute cadence, 78 start at once on a pool of 5 connections, and each writes the ledger on every run. One registry names each job's cadence (300, 3,600 or 86,400 s) with a one-line reason, whether its work is one statement or per store (then with a cap and an order), and a budget in milliseconds. The budgets are the part no finding covers. The dispatcher's list is generated from the registry. runJobs() runs four at a time, starts no job after 240 s, writes one ledger row for idle jobs, refreshes a job's cache after that job, and re-hashes nothing on a tick where nothing changed. The ledger gains when a job last did any work, shown on Platform, Usage and limits. Kaizena Flow's own payouts are read from Stripe by an hourly job of their own, not every five minutes. src/server/cron-routes.scan.test.ts fails a registry job without a cadence, a reason and a budget, and cron-health gains 'slow' beside late and failing.

- **Closes:** [CR-2](../findings/scheduled-work/CR-2.md), [CR-8](../findings/scheduled-work/CR-8.md), [DQ-5](../findings/queries/DQ-5.md), GAP-scheduled-3, [CR-14](../findings/scheduled-work/CR-14.md)
- **Effort:** L. **Areas it moves:** Scheduled work; The database; The product's surface.
- **Done when:** A day after the deploy select count(*) from commerce.cron_jobs where job like 'dispatcher.%' and every_seconds = 300 is 58 or fewer (83 today), query-budget.int.test.ts counts at most 125 statements for an idle tick and the same for 1 and for 20 seeded stores (at least 248 today), and a unit test of runJobs() shows never more than 4 running and a job that never returns leaving the others' rows written.
- **Platform:** The platform's jobs (the briefing, the books, payouts, plan campaigns) are registry entries with a cadence of their own.

## 3.4 Give every daily function a ledger row of its own

The 40 daily functions share 2 ledger rows and 19 of them catch their error to the console, so a prune that fails is not seen. Run them through runJobs('daily', 86400) in the shape of step 3.3, each with a row daily.<name>. A prune that swallows its own error reports it, and a failing one emails the admins after three failed days. pruneVisits() asks only stores with rows older than the retention period, and the unbatched deletes on tables that will be large run in batches.

- **Closes:** [CR-17](../findings/scheduled-work/CR-17.md)
- **Effort:** M. **Areas it moves:** Scheduled work; The database.
- **Done when:** select count(*) from commerce.cron_jobs where job like 'daily.%' and every_seconds = 86400 is 38 or more (2 today), rg -c 'console.error' src/app/api/cron sums to 0 (19 today), and a new case in cron-runs.int.test.ts shows a daily job that throws leaving the others' rows ok and its own counted as failed.
- **Platform:** The platform's daily prunes are rows like the stores'.

## 3.5 Give every table that grows by time a delete rule

Seven tables grow by time with no delete: guest carts, processed webhook events, email messages, experiment events, referral visits, Work events and old page versions. Each gets a period in src/lib/retention.ts and a delete step in the daily run; the privacy text states the same periods. The status prune leaves the five-minute tick for the daily route. The docs index rewrites only the rows that changed, not all 1,845 on every docs deploy.

- **Closes:** [DS-13](../findings/database-shape/DS-13.md), [CR-10](../findings/scheduled-work/CR-10.md)
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** src/lib/retention.test.ts finds a delete step for every table that grows by time, in production seq_scan of commerce.status_checks grows by fewer than 10 a day (about 288 today), and a deploy that changes one docs article raises n_tup_upd of commerce.docs_index by fewer than 50 (1,845 before).
- **Platform:** The status page, the docs index and the platform's webhook events are the platform's own tables and get their periods in the same file.
- **The owner's question first:** How long are guest carts, processed webhook events and old page versions kept (the code review's question 6)? The privacy text states the same periods.

## 3.6 Let per-store jobs find due work by a mark, and look hourly

Five document jobs find due work by re-checking every store's orders of 120 days, invoices and refunds on each tick: add the partial indexes that fit their windows, concurrently on the hot tables, and a mark for what is done. Six more five-minute jobs (the books, Tripletex, Fiken, auto-archive, autopilot budgets, recurring costs) re-check every store that has the feature on, and the ledger's order never rotates: they look hourly, skip a store with nothing new, and every book gets its turn. Each is labelled per-store in the registry of step 3.3, with its cap and order.

- **Closes:** [DQ-15](../findings/queries/DQ-15.md), [CR-16](../findings/scheduled-work/CR-16.md)
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** A new int test seeds 2,000 paid, invoiced orders in one store, runs one invoice tick, one email check and one e-invoice check, and the rows read from commerce.orders and commerce.invoices stay under the bound it states; the new ledger case reaches the third book within three runs; and the ledger rows dispatcher.auto-archive, dispatcher.autopilot-budgets and dispatcher.recurring have every_seconds 3600.
- **Platform:** Kaizena Flow's own books are a book like any other and get their turn by the same order.

## 3.7 Call the PDF route when a document waits

The PDF route is deployed with Chromium (a 102 MB function) and nothing calls it, so the 'Try again' an owner sees on a missing invoice PDF is not true. With the owner's yes, the tick of step 3.1 calls it when a document waits, and it leaves NOT_SCHEDULED. If the answer is no, PDFs are made on the first download and the route is removed. Either way the finished backfill of AI picture marks is retired once a copied picture keeps its mark.

- **Closes:** [CR-11](../findings/scheduled-work/CR-11.md), [DD-12](../findings/unused-code/DD-12.md)
- **Effort:** S. **Areas it moves:** Scheduled work; The code itself.
- **Done when:** src/server/cron-routes.scan.test.ts passes with document-pdfs out of NOT_SCHEDULED (or the route's folder gone), and an int test shows an issued invoice with no PDF getting one within two ticks (or on its first download).
- **Platform:** Work's invoices at account level use the same PDF route.
- **The owner's question first:** Should invoice PDFs be made ahead by the scheduled job, so that 'Try again' is true (recommended), or made on the first download, with the route nothing calls and its 102 MB function removed?

## 3.8 Drop the dead database objects: one unused table and the leftover schema

The idempotency_keys table and its enum are used by no code: delete them from src/db/schema.ts with their register rows. The commerce_legacy schema, a renamed copy of the single-store tables kept since 24 September, holds 34 tables named by no code: take a last dump, keep it with the backups, and drop the schema in a guarded migration. Five unused columns go when their tables are next changed.

- **Closes:** [DS-14](../findings/database-shape/DS-14.md)
- **Effort:** S. **Areas it moves:** The database.
- **Done when:** rg -n 'idempotency_keys' src | rg -v 'api_(app_)?idempotency_keys' prints nothing, and the size by schema in the reading of step 0.2 lists no commerce_legacy.
- **Platform:** The leftover schema is from before the platform had stores; nothing of the platform's reads it.
- **The owner's question first:** May the commerce_legacy schema, kept since 24 September as a renamed copy of the single-store tables, be dropped after a last dump? The unused table goes either way.

## 3.9 Keep one kaizenaflow.com

Since 7 November kaizenaflow.com is served from Kaizena Flow's own store (D484), yet the old no-store site is still built, edited and read beside it: 20 route pages in two languages, 23 to 32 admin pages, 3 twin tables and up to 4,400 lines. Finish step 7 of the parity plan: remove the null-store site paths (the front page, [slug], blog, category, tag and cookies under src/app/(platform) and src/app/(platform-nb), with platform-theme-installs.ts, platform-roles.ts and platform-page.tsx), after the media library's rows move to the store. scripts/site-compare.mjs against a copy taken before shows no lost address. This removes the way back, so it waits for the owner's word.

- **Closes:** [FM-3](../findings/families/FM-3.md), [FT-5](../findings/features/FT-5.md), [DS-6](../findings/database-shape/DS-6.md)
- **Effort:** L. **Areas it moves:** The code itself; The product's surface; The database.
- **Done when:** rg -l 'platform_theme_installs' src --glob '!*.test.*' | wc -l prints 0, find 'src/app/(platform)' 'src/app/(platform-nb)' -name page.tsx lists no front page and nothing under [slug], blog, category, tag or cookies (20 files today), and node scripts/site-compare.mjs https://kaizenaflow.com --against before.json passes.
- **Platform:** This is the platform's own step: one place edits Kaizena Flow's site, and /admin/platform loses its second set of page, header, footer and menu screens.
- **The owner's question first:** Is the switch of 7 November final, so that the old no-store site and its twin tables can be removed before opening (or kept as a fallback for some weeks, as the parity plan first said)? And one desk for support and chat (parity plan step 6), or two?

## 3.10 Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope

The platform console has a second engine beside the stores' for workflows, own endpoints and integration deliveries: 26 to 55% of its lines are the stores' own, so a fix to retry or signing is made twice. Move the claim, the retry and the signing into src/server/workflow-engine.ts with a scope argument; separate tables and addresses stay. It needs one sentence in CLAUDE.md's parity rule: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy.

- **Closes:** [CP-4](../findings/copied-code/CP-4.md), [FM-4](../findings/families/FM-4.md), [FM-5](../findings/families/FM-5.md)
- **Effort:** M. **Areas it moves:** The code itself; The product's surface.
- **Done when:** rg -c 'for update skip locked' src/server/workflows.ts src/server/platform-workflows.ts prints nothing (the claim lives in workflow-engine.ts only), and the five platform and store pairs share under 60 lines in runs of three or more by the twin counter of step 1.17.
- **Platform:** This is the platform's own engine: it keeps every feature and its own tables, and runs them on shared code.
- **The owner's question first:** First the choice listed with the owner's choices (FT-10): keep the platform's four engines as twins on shared code, which is this step, or serve Kaizena Flow's events through its own store's engines once the site is one (then the twins are removed with step 3.9 and this step is dropped)? If twins: may the parity rule in CLAUDE.md say that where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy? Separate tables stay.

## 3.11 Fold order rules into Workflows

Order rules ('Automation') and Workflows are two engines for what happens when an order is paid: about 1,900 lines, 4 pages, 2 tables and 1 AI tool. Workflows gains the hold action, 'any' matching and the order facts; then order rules go, and their tables one release later. A hold is a safeguard: runs of order.paid must not be capped at 100 an hour, and the staff email must still say 'held'. The tool list changes, so run the agents' eval. Cheapest now: no owner has a rule to convert.

- **Closes:** [FT-8](../findings/features/FT-8.md)
- **Effort:** M. **Areas it moves:** The product's surface.
- **Done when:** find src -iname '*order-rule*' | wc -l prints 0 (5 today), the store navigation has no /settings/automation link, and src/server/workflows.int.test.ts has a case where a paid order over an amount is put on hold and the staff email says so.
- **Platform:** The hold action and the order facts are store-only by the house rule's exception (the platform sells no goods); the platform's workflows keep every other action.
- **The owner's question first:** May order rules fold into Workflows, so one engine decides what happens when an order is paid?

## 3.12 Save an own look in one place: the theme library

An owner's own look can be saved in two places: commerce.store_themes beside the theme library. 'Save as new theme' writes to commerce.store_theme_installs, the saved list leaves the theme editor, and store_themes goes in a second migration one release later. The editor works a little differently after: an own look in the library carries the header, footer and CSS, and counts against the library's limit.

- **Closes:** [FT-12](../findings/features/FT-12.md)
- **Effort:** S. **Areas it moves:** The product's surface.
- **Done when:** rg -n 'store_themes' src --glob '!*.test.*' | wc -l prints 0 after the second migration (17 today), and src/server/themes.int.test.ts has a case where 'Save as new theme' adds a row to commerce.store_theme_installs.
- **Platform:** The platform's theme workspace is a store too and changes in the same change.
- **The owner's question first:** May an owner's own look be saved only in the theme library, not also as a saved theme in the editor?

## 3.13 Give the five file imports one core

Five CSV imports each repeat the upload, register, check, apply and cursor code, the browser flow and the pages: 18 twin pairs, about 1,300 to 1,600 lines. One import definition with one job writer, one import flow in the browser, and 15 tick and problems routes become 2.

- **Closes:** [CP-1](../findings/copied-code/CP-1.md), [FM-6](../findings/families/FM-6.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** rg -l 'insert into commerce[.]data_jobs' src/server --glob '!*.test.ts' prints one file (five today), rg --files src/components/admin | rg 'import-flow' lists one file (four today), and src/lib/copies.baseline.json holds at most 23 twin pairs (41 today).
- **Platform:** The platform has no file import of its own to fold.

## 3.14 Draw Work once for store and account, and keep one Domains move page

Work's account-level screens are copies of the store-level ones (29 to 77% the same), and 58 Work actions are wrapped in a seven-line shell. One Work view serves store and account, the actions sit on the shared wrapper, and the two Domains move pages become one.

- **Closes:** [CP-5](../findings/copied-code/CP-5.md), [FM-10](../findings/families/FM-10.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** wc -l of the five owner-time, owner-invoices, owner-clients, owner-report and owner-overview files totals under 800 (1,209 today), and src/lib/copies.baseline.json holds at most 16 twin pairs.
- **Platform:** Work at account level is the second set of screens named, and it keeps every screen.

## 3.15 Keep one of each small thing: helpers, SQL fragments, English word lists

fail() is declared in 43 server files, isUuid in 23, isUniqueViolation in 9, and the day and country helpers 31 times with different bodies: give each one home, kept by a lint rule. The product title with its fallback, the usage counter and the order event are typed out in dozens of files: one fragment each (nine reads lack the title's fallback today). English word lists kept twice (old constants beside the catalogues, held equal by 37 assertions) get one source.

- **Closes:** [CP-8](../findings/copied-code/CP-8.md), [CP-16](../findings/copied-code/CP-16.md), [FM-12](../findings/families/FM-12.md), [CP-9](../findings/copied-code/CP-9.md), [DD-7](../findings/unused-code/DD-7.md), [CP-13](../findings/copied-code/CP-13.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** rg -c '^(export )?(const|function) (isUuid|isUniqueViolation)' src --glob '!*.test.ts' sums to 2 (32 today), rg -c 'insert into commerce[.]order_events' src --glob '!*.test.ts' sums to 1 (34 today), and no test holds a catalogue section equal to a words constant (37 such assertions today).
- **Platform:** The helpers and fragments are shared code, and the platform's files are among those that lose a private copy.

## 3.16 Draw an order's totals from one part

An order's totals are drawn in two order pages and again in checkout, and product cards are queried in two shapes. One OrderTotals part serves the three, and one product-card query. These are the sums a shopper pays by, so it is a step of its own: the checkout and order specs are the proof that nothing moved.

- **Closes:** [CP-12](../findings/copied-code/CP-12.md)
- **Effort:** S. **Areas it moves:** The code itself.
- **Done when:** The two order page files total under 900 lines (988 today) and draw OrderTotals, as checkout does, and the checkout and order e2e specs pass unchanged.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and draws no order totals of its own.

## 3.17 Keep one stored page shape

Every read of a stored page runs the editor's whole input schema and the upgraders for three old shapes, and six source files and the seed still write the old grid shape. First make every writer (the themes, the content packs, the seed) write the current shape. Then scripts/page-shapes.mjs counts the documents that differ from their parse and rewrites them once, and the upgraders go (about 240 lines) with the rule and the spec that pin them. Reads then parse with a small read schema.

- **Closes:** [PM-9](../findings/page-builder-model/PM-9.md), [DD-9](../findings/unused-code/DD-9.md)
- **Effort:** M. **Areas it moves:** The page builder's model and a built page; The code itself.
- **Done when:** node scripts/page-shapes.mjs prints 0 documents that differ from their parse on a freshly seeded database and on production, and rg for upgradeRow, upgradeBlock, upgradeLegacy and upgradeResponsive in src outside tests prints nothing.
- **Platform:** The platform's pages and the launch themes' snapshots are rewritten by the same script.

## 3.18 Build twice per push, and deploy only what changes the app

A push builds the app three times in CI, and a push that changes only tests deploys production again (about 8% of deploys). The unsigned and the signed-in browser suites share one build, with the specs that assumed Supabase was not configured adjusted; hosts keeps its own. The deploy job skips a push that changes only tests, and lint and the type check run once per push.

- **Closes:** [TC-7](../findings/tests-ci-build/TC-7.md), [TC-14](../findings/tests-ci-build/TC-14.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** src/lib/ci-once.scan.test.ts holds pnpm build in two CI jobs and one full type check per push, and a push that changes one *.test.ts file shows pending green with the deploy step skipped while /api/health still reports the previous commit.
- **Platform:** One CI and one deploy serve stores and platform.

## 3.19 Let a burst of pushes share one deploy

Each deploy empties every store's cached pages and starts every function cold: up to 52 deploys on 11 November. With the owner's yes, a CI run skips its deploy when a newer commit is already on main, so a burst of pushes shares one. It changes D5's 'at once' by a few minutes.

- **Closes:** [CA-2](../findings/caching/CA-2.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; Tests, CI and the build.
- **Done when:** Two pushes to main one minute apart produce one call of the Vercel deploy hook (two today), read from the two runs' logs, and /api/health reports the second commit.
- **Platform:** Kaizena Flow's own pages keep their cache through a skipped deploy like a store's.
- **The owner's question first:** Once stores are open, may a CI run skip its deploy when a newer commit is already on main, so a burst of pushes shares one deploy? It changes D5's 'at once' by a few minutes.
