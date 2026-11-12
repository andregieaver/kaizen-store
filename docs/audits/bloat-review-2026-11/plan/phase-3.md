# Phase 3: One of each

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Keep one of each thing that was built twice, and add the gates that make cost follow use: scheduled work runs when something waits, at the pace its work changes. Nothing is retired because it is unused. Each fold is of a true duplicate, and before opening no data needs moving. **A person will notice:** On a quiet day the scheduler makes about 1,200 function calls, not 13,250, and the platform home shows every scheduled function with a row of its own. There is one place to edit Kaizena Flow's site, one engine for what happens when an order is paid, one import flow, and one deploy for a burst of pushes.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 3.1 Run one tick a minute, and call a route only when work waits or is due

Nine routes are called every minute whether or not anything waits: 12,960 calls a day of full-application functions, three of them carrying Chromium. One pg_cron job runs commerce.cron_due() each minute: one indexed exists() per queue, net.http_post only for a queue that holds a row, and every route once in 15 minutes as a net. The theme-shots route keeps its wanted list between runs. The three feature routes (integrations, broadcasts, autopilot) get their 'is anything due' statement as one SQL function that both the tick and the route read, so automations, ad conversions and support emails stop costing stores times kinds every minute. The stewards' tick alone leaves about 5,200 calls a day against a bar of 1,200; the shared due function is the added part that reaches it.

- **Closes:** [CR-1](../findings/scheduled-work/CR-1.md), [CR-7](../findings/scheduled-work/CR-7.md), [DQ-1](../findings/queries/DQ-1.md), [DP-7](../findings/dependencies/DP-7.md), [SF-10](../findings/server-functions/SF-10.md), [CR-3](../findings/scheduled-work/CR-3.md), GAP-scheduled-1
- **Effort:** L. **Areas it moves:** Scheduled work; The database; What the server loads and asks.
- **Done when:** In production select count(*) from cron.job where schedule = '* * * * *' returns 1 (9 today); over one quiet day commerce.cron_jobs.runs for route.page-jobs, route.integrations, route.broadcasts and route.autopilot each rise by no more than 100 (1,440 today); and a case in src/server/automations.int.test.ts counts 4 statements or fewer for an idle runAutomations() with 20 stores (at least 61 today).
- **Platform:** The same routes carry Kaizena Flow's own queues (its broadcasts, integrations and briefing), and cron_due() counts null-store rows.

## 3.2 Run the dispatcher from a registry: a cadence and a time budget per job, four at a time

All 83 dispatcher jobs share one five-minute cadence, 78 start at once on a pool of 5 connections, and each writes the ledger on every run. One registry names each job's cadence (300, 3,600 or 86,400 s) with a one-line reason and a budget in milliseconds (the budgets are the part no finding covers). runJobs() runs four at a time, starts no job after 240 s, writes one ledger row for idle jobs, and re-hashes nothing on a tick where nothing changed. Kaizena Flow's own payouts are read from Stripe by an hourly job of their own, not every five minutes. src/server/cron-routes.scan.test.ts fails a registry job without a cadence, a reason and a budget, and cron-health gains 'slow' beside late and failing.

- **Closes:** [CR-2](../findings/scheduled-work/CR-2.md), [CR-8](../findings/scheduled-work/CR-8.md), [DQ-5](../findings/queries/DQ-5.md), GAP-scheduled-3
- **Effort:** L. **Areas it moves:** Scheduled work; The database; The product's surface.
- **Done when:** A day after the deploy select count(*) from commerce.cron_jobs where job like 'dispatcher.%' and every_seconds = 300 is 58 or fewer (83 today), query-budget.int.test.ts counts the same idle-tick statements for 1 and for 20 seeded stores, and a unit test of runJobs() shows never more than 4 running and a job that never returns leaving the others' rows written.
- **Platform:** The platform's jobs (the briefing, the books, payouts, plan campaigns) are registry entries with a cadence of their own.

## 3.3 Give every scheduled function a ledger row and a watcher from outside, and every growing table a delete rule

The 40 daily functions share 2 ledger rows and 19 of them catch their error to the console, so a prune that fails is not seen: each becomes tracked('daily.<name>', 86400) with a row of its own. pg_cron's own SQL jobs get a ledger row too, and one Vercel cron calls a small route that emails the admins when the tick's or the dispatcher's row is over 15 minutes old, so the scheduler is no longer watched only from inside itself. Seven tables grow by time with no delete (guest carts, processed webhook events and old page versions among them): each gets a period in src/lib/retention.ts and a delete step. The status prune stops scanning on every tick, and the docs index rewrites only the rows that changed.

- **Closes:** [CR-17](../findings/scheduled-work/CR-17.md), GAP-scheduled-2, [DS-13](../findings/database-shape/DS-13.md), [CR-10](../findings/scheduled-work/CR-10.md)
- **Effort:** M. **Areas it moves:** Scheduled work; The database.
- **Done when:** select count(*) from commerce.cron_jobs where job like 'daily.%' and every_seconds = 86400 is 38 or more, rg -c 'console.error' src/app/api/cron sums to 0, stopping the tick on a test database sends the email within the hour, src/lib/retention.test.ts finds a delete step for every table that grows by time, and a deploy that changes one docs article raises n_tup_upd of commerce.docs_index by fewer than 50 (1,845 before).
- **Platform:** The status page, the docs index and the platform's webhook events are the platform's own tables and get their periods in the same file.
- **The owner's question first:** How long are guest carts, processed webhook events and old page versions kept (the code review's question 6)? The privacy text states the same periods.

## 3.4 Let per-store jobs find due work by a mark, and call the PDF route when a document waits

Five document jobs find due work by re-checking every store's orders of 120 days, invoices and refunds on each tick: add the partial indexes that fit their windows, and a mark for what is done. Six more five-minute jobs (the books, Tripletex, Fiken, auto-archive, autopilot budgets, recurring costs) re-check every store that has the feature on, and the ledger's order never rotates: they look hourly, and every book gets its turn. The PDF route is deployed with Chromium and nothing calls it, so the 'Try again' owners see is not true: call it from the tick when a document waits. The finished backfill of AI picture marks is retired once a copied picture keeps its mark.

- **Closes:** [DQ-15](../findings/queries/DQ-15.md), [CR-16](../findings/scheduled-work/CR-16.md), [CR-11](../findings/scheduled-work/CR-11.md), [DD-12](../findings/unused-code/DD-12.md)
- **Effort:** M. **Areas it moves:** Scheduled work; The database; The code itself.
- **Done when:** A new int test seeds 2,000 paid, invoiced orders in one store, runs one invoice tick, one email check and one e-invoice check, and the rows read from commerce.orders and commerce.invoices stay under the bound it states; the ledger rows dispatcher.auto-archive, dispatcher.autopilot-budgets and dispatcher.recurring have every_seconds 3600; and cron-routes.scan.test.ts passes with document-pdfs out of NOT_SCHEDULED.
- **Platform:** Kaizena Flow's own books and plan invoices are found by the same marks, and Work's invoices at account level use the same PDF route.
- **The owner's question first:** Should invoice PDFs be made ahead by the scheduled job, so that 'Try again' is true (recommended), or made on the first download, with the route nothing calls and its 102 MB function removed?

## 3.5 Keep one kaizenaflow.com

Since 7 November kaizenaflow.com is served from Kaizena Flow's own store (D484), yet the old no-store site is still built, edited and read beside it: 20 route pages in two languages, 23 to 32 admin pages, 3 twin tables and up to 4,400 lines. Finish step 7 of the parity plan: remove the null-store site paths (the front page, [slug], blog, category, tag and cookies under src/app/(platform) and src/app/(platform-nb), with platform-theme-installs.ts, platform-roles.ts and platform-page.tsx), after the media library's rows move to the store. scripts/site-compare.mjs against a copy taken before shows no lost address. This removes the way back, so it waits for the owner's word.

- **Closes:** [FM-3](../findings/families/FM-3.md), [FT-5](../findings/features/FT-5.md), [DS-6](../findings/database-shape/DS-6.md)
- **Effort:** L. **Areas it moves:** The code itself; The product's surface; The database.
- **Done when:** rg -l 'platform_theme_installs' src --glob '!*.test.*' | wc -l prints 0, find 'src/app/(platform)' 'src/app/(platform-nb)' -name page.tsx lists no front page and nothing under [slug], blog, category, tag or cookies (20 files today), and node scripts/site-compare.mjs https://kaizenaflow.com --against before.json passes.
- **Platform:** This is the platform's own step: one place edits Kaizena Flow's site, and /admin/platform loses its second set of page, header, footer and menu screens.
- **The owner's question first:** Is the switch of 7 November final, so that the old no-store site and its twin tables can be removed before opening (or kept as a fallback for some weeks, as the parity plan first said)? And one desk for support and chat (parity plan step 6), or two?

## 3.6 Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope

The platform console has a second engine beside the stores' for workflows, own endpoints and integration deliveries: 26 to 55% of its lines are the stores' own, so a fix to retry or signing is made twice. Move the claim, the retry and the signing into src/server/workflow-engine.ts with a scope argument; separate tables and addresses stay. It needs one sentence in CLAUDE.md's parity rule: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy.

- **Closes:** [CP-4](../findings/copied-code/CP-4.md), [FM-4](../findings/families/FM-4.md), [FM-5](../findings/families/FM-5.md)
- **Effort:** M. **Areas it moves:** The code itself; The product's surface.
- **Done when:** rg -c 'for update skip locked' src/server/workflows.ts src/server/platform-workflows.ts prints nothing (the claim lives in workflow-engine.ts only), and the five platform and store pairs share under 60 lines in runs of three or more by the twin counter of step 1.9.
- **Platform:** This is the platform's own engine: it keeps every feature and its own tables, and runs them on shared code.
- **The owner's question first:** May the parity rule in CLAUDE.md say: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy? Separate tables stay.

## 3.7 Keep one engine for one job: order rules fold into Workflows, and an own look is saved in the theme library

Order rules ('Automation') and Workflows are two engines for what happens when an order is paid: about 1,900 lines, 4 pages, 2 tables and 1 AI tool fold into Workflows, which gains the hold action, 'any' matching and the order facts (the hold must not be capped at 100 runs an hour). An owner's own look can be saved in two places: 'Save as new theme' writes to commerce.store_theme_installs, and store_themes goes in a second migration. Before either, compare by job the two pairs of engines nobody compared (order invoices beside Work invoices, and orders on payment terms beside Work's unpaid invoices), and write a finding with a fix or a tolerated line for each. Cheapest now: no owner has a rule or a saved look to convert.

- **Closes:** [FT-8](../findings/features/FT-8.md), [FT-12](../findings/features/FT-12.md), GAP-surface-2
- **Effort:** M. **Areas it moves:** The product's surface.
- **Done when:** find src -iname '*order-rule*' | wc -l prints 0, rg -n 'store_themes' src --glob '!*.test.*' | wc -l prints 0 after the second migration, src/server/workflows.int.test.ts has a case where a paid order over an amount is put on hold and the staff email says so, and docs/audits/bloat-review-2026-11/findings/features.md holds a verdict for each of the two compared pairs.
- **Platform:** The platform's theme workspace changes in the same change, and the platform's workflows gain the hold action through the shared engine of step 3.6.
- **The owner's question first:** May order rules fold into Workflows, and may an own look be saved only in the theme library? Yes or no for each.

## 3.8 Give each family one core: the five file imports, Work's two sets of screens, the Domains move page

Five CSV imports each repeat the upload, register, check, apply and cursor code, the browser flow and the pages: one import definition with one job writer, and 15 tick and problems routes become 2 (18 twin pairs, about 1,300 to 1,600 lines). Work's account-level screens are copies of the store-level ones (29 to 77% the same), and 58 Work actions are wrapped in a seven-line shell: one Work view for store and account, the actions on the shared wrapper, and one Domains move page.

- **Closes:** [CP-1](../findings/copied-code/CP-1.md), [FM-6](../findings/families/FM-6.md), [CP-5](../findings/copied-code/CP-5.md), [FM-10](../findings/families/FM-10.md)
- **Effort:** L. **Areas it moves:** The code itself.
- **Done when:** rg -l 'insert into commerce[.]data_jobs' src/server --glob '!*.test.ts' prints one file (five today), rg --files src/components/admin | rg 'import-flow' lists one file (four today), wc -l of the five owner-time, owner-invoices, owner-clients, owner-report and owner-overview files totals under 800 (1,209 today), and src/lib/copies.baseline.json holds at most 16 twin pairs (41 today).
- **Platform:** The platform has no file import of its own to fold; Work at account level is the second set of screens named, and it keeps every screen.

## 3.9 Keep one of each small thing: helpers, SQL fragments, order totals, English word lists

fail() is declared in 43 server files, isUuid in 23, isUniqueViolation in 9, and the day and country helpers 31 times with different bodies: give each one home, kept by a lint rule. The product title with its fallback, the usage counter and the order event are typed out in dozens of files: one fragment each (nine reads lack the title's fallback today). An order's totals are drawn in two order pages and again in checkout: one OrderTotals part, and one product-card query. English word lists kept twice (old constants beside the catalogues, held equal by 37 assertions) get one source.

- **Closes:** [CP-8](../findings/copied-code/CP-8.md), [CP-16](../findings/copied-code/CP-16.md), [FM-12](../findings/families/FM-12.md), [CP-9](../findings/copied-code/CP-9.md), [CP-12](../findings/copied-code/CP-12.md), [DD-7](../findings/unused-code/DD-7.md), [CP-13](../findings/copied-code/CP-13.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** rg -c '^(export )?(const|function) (isUuid|isUniqueViolation)' src --glob '!*.test.ts' sums to 2 (32 today), rg -c 'insert into commerce[.]order_events' src --glob '!*.test.ts' sums to 1 (34 today), the two order page files total under 900 lines (988 today), and no test holds a catalogue section equal to a words constant (37 such assertions today).
- **Platform:** The helpers and fragments are shared code, and the platform's files are among those that lose a private copy.

## 3.10 Keep one stored page shape

Every read of a stored page runs the editor's whole input schema and the upgraders for three old shapes, and six source files and the seed still write the old grid shape. First make every writer (the themes, the content packs, the seed) write the current shape. Then scripts/page-shapes.mjs counts the documents that differ from their parse and rewrites them once, and the upgraders go (about 240 lines) with the rule and the spec that pin them. Reads then parse with a small read schema.

- **Closes:** [PM-9](../findings/page-builder-model/PM-9.md), [DD-9](../findings/unused-code/DD-9.md)
- **Effort:** M. **Areas it moves:** The page builder's model and a built page; The code itself.
- **Done when:** node scripts/page-shapes.mjs prints 0 documents that differ from their parse on a freshly seeded database and on production, and rg for upgradeRow, upgradeBlock, upgradeLegacy and upgradeResponsive in src outside tests prints nothing.
- **Platform:** The platform's pages and the launch themes' snapshots are rewritten by the same script.

## 3.11 Build twice per push, and deploy only what changes the app

A push builds the app three times in CI, and a push that changes only tests deploys production again (about 8% of deploys). The unsigned and the signed-in browser suites share one build, with the specs that assumed Supabase was not configured adjusted; hosts keeps its own. The deploy job skips a push that changes only tests, and lint and the type check run once per push. Each deploy empties every store's cached pages and starts every function cold (up to 52 deploys on 11 November): with the owner's yes, a run skips its deploy when a newer commit is already on main, so a burst of pushes shares one.

- **Closes:** [TC-7](../findings/tests-ci-build/TC-7.md), [TC-14](../findings/tests-ci-build/TC-14.md), [CA-2](../findings/caching/CA-2.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build; What the server loads and asks.
- **Done when:** A push to main runs pnpm build in two CI jobs at most, held by src/lib/ci-once.scan.test.ts, and a push that changes one *.test.ts file shows pending green with the deploy step skipped while /api/health still reports the previous commit.
- **Platform:** One deploy serves stores and platform, and Kaizena Flow's own pages keep their cache through a skipped deploy like a store's.
- **The owner's question first:** Once stores are open, may a CI run skip its deploy when a newer commit is already on main, so a burst of pushes shares one deploy? It changes D5's 'at once' by a few minutes.
