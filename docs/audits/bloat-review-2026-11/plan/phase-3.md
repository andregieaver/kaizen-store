# Phase 3: One of each

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Keep one of each thing that was built twice, and add the gates that make cost follow use: scheduled work runs when something waits, at the pace its work changes. Nothing is retired because it is unused. Each fold is of a true duplicate, and before opening no data needs moving. Nine of these steps wait for the owner's answer. The scheduler's steps 3.1 to 3.4 and 3.6 do not, and go in that order. **A person will notice:** On a quiet day the scheduler makes at most 1,350 function calls, not 13,250, and the platform home shows every scheduled function with a row of its own. With the owner's yes there is one place to edit Kaizena Flow's site, one engine for what happens when an order is paid, and one deploy for a burst of pushes. There is one import flow.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 3.1 Run one tick a minute, and call a route only when work waits

Nine routes are called every minute whether or not anything waits: 12,960 calls a day of full-application functions, three of them carrying Chromium. One pg_cron job runs commerce.cron_due() each minute: one indexed exists() per queue, net.http_post only for a queue that holds a row, and every route once in 15 minutes as a net. Six routes have a true queue and move first: page jobs, page looks, pack pictures, the Dream Factory, theme shots and the cookie scan. The theme-shots route keeps its wanted list between runs, not reading every published theme's snapshot each minute.

- **Closes:** [CR-1](../findings/scheduled-work/CR-1.md), [CR-7](../findings/scheduled-work/CR-7.md), [DQ-1](../findings/queries/DQ-1.md), [DP-7](../findings/dependencies/DP-7.md), [SF-10](../findings/server-functions/SF-10.md), GAP-scheduled-s1
- **Effort:** L. **Areas it moves:** Scheduled work; The database; What the server loads and asks; The code itself.
- **Done when:** In production select count(*) from cron.job where schedule = '* * * * *' returns 1 (9 today), over one quiet day commerce.cron_jobs.runs for route.page-jobs rises by no more than 100 (1,440 today), and cron.job_run_details gains about 1,750 rows a day (13,250 today). An int test puts one claimable row in each gated queue and sees commerce.cron_due() name its route, and none on the empty seed (six routes here; all of them after steps 3.2 and 3.7). query-budget.int.test.ts counts the tick's statement, and it reads the same rows for 1 and for 20 seeded stores. A sweep call runs every runner's own claim without asking the due function: a scratch runner left out of cron_due() still runs in a sweep. cron-routes.scan.test.ts fails a second every-minute schedule in supabase/migrations and a cron route that is in neither cron_due() nor NOT_SCHEDULED. An idle cookie-scan run sends at most 3 statements and theme-shots and pack-pictures 1 each, none opens a transaction, and the two routes ask before they take their lock. In production the tick's statement averages under 20 ms, and calls of the theme snapshot statement rise by 100 or fewer a day.
- **Platform:** The same routes carry Kaizena Flow's own queues, and cron_due() counts null-store rows.
- **To carry it out:** [steps/3.1.md](steps/3.1.md) (review)

## 3.2 Let the three feature routes follow what is due

After the tick, three routes that carry several features (integrations, broadcasts, autopilot) would still be called every minute: about 5,200 calls a day against a bar of 1,350. Write each one's 'is anything due' statement as one SQL function that both the tick and the route read, so automations, ad conversions and support emails stop costing stores times kinds every minute. A scan test fails a runner called in a gated route that has no part in the function. The stewards' tick alone does not reach the bar; this is the added part.

- **Closes:** [CR-3](../findings/scheduled-work/CR-3.md), GAP-scheduled-1
- **Effort:** M. **Areas it moves:** Scheduled work; The database.
- **Done when:** Over one quiet day commerce.cron_jobs.runs for route.integrations, route.broadcasts and route.autopilot each rise by no more than 100 (1,440 today), the scheduler's function calls that day total 1,350 or fewer (13,250; 1,200 would be broken by the plan's own PDF route and watcher), a case in src/server/automations.int.test.ts counts 4 statements or fewer for an idle runAutomations() with 20 stores (at least 61 today), and the int test of step 3.1 sees commerce.cron_due() name each of the three routes when one of its queues holds a claimable row, and none on the empty seed.
- **Platform:** The same routes carry Kaizena Flow's own broadcasts, integrations and briefing.
- **To carry it out:** [steps/3.2.md](steps/3.2.md) (strong)

## 3.3 Run the dispatcher from a registry: a cadence and a time budget per job

All 83 dispatcher jobs share one five-minute cadence, 78 start at once on a pool of 5 connections, and each writes the ledger on every run. One registry names each job's cadence (300, 3,600 or 86,400 s) with a one-line reason, whether its work is one statement or per store (then with a cap and an order), and a budget in milliseconds. The budgets are the part no finding covers. The dispatcher's list is generated from the registry. runJobs() already runs four at a time since step 0.45 and keeps the report(error) of step 1.26; here it starts no job after 240 s, starts a job only if its budget fits, writes one ledger row for idle jobs, refreshes a job's cache after that job, and re-hashes nothing on a tick where nothing changed. commerce.cron_jobs gains worked (runs that took at least one item) and last_worked_at, and Platform, Usage and limits lists idle runs a day per job. Kaizena Flow's own payouts are read from Stripe by an hourly job of their own, not every five minutes: payouts.list once per mode in an hour. src/server/cron-routes.scan.test.ts fails a registry job without a cadence, a reason and a budget, and cron-health gains 'slow' beside late and failing.

- **Closes:** [CR-2](../findings/scheduled-work/CR-2.md), [CR-8](../findings/scheduled-work/CR-8.md), [DQ-5](../findings/queries/DQ-5.md), GAP-scheduled-3, [CR-14](../findings/scheduled-work/CR-14.md), GAP-scheduled-s3
- **Effort:** L. **Areas it moves:** Scheduled work; The database; The product's surface.
- **Done when:** A day after the deploy select count(*) from commerce.cron_jobs where job like 'dispatcher.%' and every_seconds = 300 is 58 or fewer (83 today), query-budget.int.test.ts counts at most 125 statements for an idle tick and the same for 1 and for 20 seeded stores (at least 248 today), an int test shows an idle run raising runs and not worked, Platform, Usage and limits lists idle runs a day per job, payouts.list is called once per mode in an hour, a unit test shows a job starting only if its budget fits, and the budgets of the fullest tick add up to 960 s or less.
- **Platform:** The platform's jobs (the briefing, the books, payouts, plan campaigns) are registry entries with a cadence of their own.
- **To carry it out:** [steps/3.3.md](steps/3.3.md) (strong)

## 3.4 Give every daily function a ledger row of its own

The 40 daily functions share 2 ledger rows and 19 of them catch their error to the console, so a prune that fails is not seen. Run them through runJobs('daily', 86400) in the shape of step 3.3, each with a row daily.<name>. A prune that swallows its own error reports it, and a failing one emails the admins after three failed days. pruneVisits() asks only stores with rows older than the retention period, and the unbatched deletes on tables that will be large run in batches.

- **Closes:** [CR-17](../findings/scheduled-work/CR-17.md), GAP-scheduled-s6
- **Effort:** M. **Areas it moves:** Scheduled work; The database.
- **Done when:** Every function the daily route calls is a registry entry with a row daily.<name> and every_seconds 86400 in commerce.cron_jobs (2 rows today for 40 functions), rg -o 'console.error' src/app/api/cron | wc -l prints 0 (19 today; rg -c prints 6, which counts files' lines), a new case in cron-runs.int.test.ts shows a daily job that throws leaving the others' rows ok and its own counted as failed, and a daily job that failed or was not reached is tried again the same day, at most three times.
- **Platform:** The platform's daily prunes are rows like the stores'.
- **To carry it out:** [steps/3.4.md](steps/3.4.md) (review)

## 3.5 Give every table that grows by time a delete rule

Seven tables grow by time with no delete: guest carts, processed webhook events, email messages, experiment events, referral visits, Work events and old page versions. Each gets a period in src/lib/retention.ts and a delete step in the daily run; the privacy text states the same periods. The periods: a guest cart goes 90 days after it ended (an open cart: after its expiry), unless an order points at it; the rule 'carts' in src/lib/retention.ts reads '90 days ... After the cart ended (an open cart: its expiry).' A processed webhook event goes, row and all, 90 days after it was processed; the rule 'webhook_payloads' reads '90 days ... After the event was processed; the row stays so its id still de-duplicates', so before that delete lands an int test shows that an event delivered again after its row is gone changes nothing, and a kind of event for which that cannot be shown keeps its rows. A page keeps all 50 versions for 90 days and then its newest 10 (VERSIONS_KEPT in src/lib/page-versions.ts is 50, with no age rule today), and the Versions panel says so. The other four take the period of the nearest rule the file already states: an email message's row 12 months after its body was emptied (the rule 'email_bodies' is 12 months), experiment events and referral visits 25 months (as 'visits'), Work events 24 months (as 'audit_log'). These deletes remove production rows for good. Before the push that turns them on: take a dump of the seven tables, restore it to a scratch database and compare the row counts table by table, keep it with the backups, and show the owner where the dump is and how many rows the first run will delete in each table. The push waits until the owner has seen them. The status prune leaves the five-minute tick for the daily route. The docs index rewrites only the rows that changed, not all 1,845 on every docs deploy. The seven are the known ones; nothing says the next table has a rule. A register puts every commerce table in one of four classes: kept with its parent, deleted after a stated period, kept for the law, or reference data. The tables are counted from the migrations (486).

- **Closes:** [DS-13](../findings/database-shape/DS-13.md), [CR-10](../findings/scheduled-work/CR-10.md), GAP-database-s6
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** src/lib/retention.test.ts finds a delete step for every table that grows by time, in production seq_scan of commerce.status_checks grows by fewer than 10 a day (about 288 today), and a deploy that changes one docs article raises n_tup_upd of commerce.docs_index by fewer than 50 (1,845 before); and a scan test fails for a commerce table in no class, for a 'deleted after' table with no period in src/lib/retention.ts and no delete step, and on a scratch table with a created_at column and no class. The privacy text and the Versions panel state the periods of src/lib/retention.ts and src/lib/page-versions.ts, and the owner has seen the dump and the first run's row counts before the deletes were pushed.
- **Platform:** The status page, the docs index and the platform's webhook events are the platform's own tables and get their periods in the same file.
- **Decided (the owner, 12 November: the recommended way):** The periods the repo already states are used. A guest cart is deleted 90 days after it ended (an open cart: after its expiry), unless an order points at it, and a processed webhook event 90 days after it was processed: src/lib/retention.ts:180 and :184 and docs/wave-1g-gdpr.md:287 and :291 state those periods, and today the rows are only emptied at that age. A page keeps all 50 versions for 90 days and then its newest 10, the finding's rule, because an unbounded history would in time need a larger database. *Asked:* How long are guest carts, processed webhook events and old page versions kept (the code review's question 6)? The privacy text states the same periods.
- **To carry it out:** [steps/3.5.md](steps/3.5.md) (strong)

## 3.6 Let per-store jobs find due work by a mark, and look hourly

Five document jobs find due work by re-checking every store's orders of 120 days, invoices and refunds on each tick: add the partial indexes that fit their windows, concurrently on the hot tables, and a mark for what is done. Six more five-minute jobs (the books, Tripletex, Fiken, auto-archive, autopilot budgets, recurring costs) re-check every store that has the feature on, and the ledger's order never rotates: they look hourly, skip a store with nothing new, and every book gets its turn. Each is labelled per-store in the registry of step 3.3, with its cap and order. The product-words sweep gets a change mark, products.text_changed_at, so an idle tick reads no product to learn that nothing changed.

- **Closes:** [DQ-15](../findings/queries/DQ-15.md), [CR-16](../findings/scheduled-work/CR-16.md)
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** A new int test seeds 2,000 paid, invoiced orders in one store, runs one invoice tick, one email check and one e-invoice check, and the rows read from commerce.orders and commerce.invoices are fewer than 100 each; an idle tick reads at most 10 more rows per added store, none from pages, products, product_variants, orders or media, and a day later product_variants is read whole 10 times a day or fewer; the new ledger case reaches the third book within three runs; and the ledger rows dispatcher.auto-archive, dispatcher.autopilot-budgets and dispatcher.recurring have every_seconds 3600.
- **Platform:** Kaizena Flow's own books are a book like any other and get their turn by the same order.
- **To carry it out:** [steps/3.6.md](steps/3.6.md) (strong)

## 3.7 Call the PDF route when a document waits

The PDF route is deployed with Chromium (a 102 MB function) and nothing calls it, so the 'Try again' an owner sees on a missing invoice PDF is not true. The tick of step 3.1 calls it when a document waits, and it leaves NOT_SCHEDULED, so 'Try again' is true. The finished backfill of AI picture marks is retired once a copied picture keeps its mark.

- **Closes:** [CR-11](../findings/scheduled-work/CR-11.md), [DD-12](../findings/unused-code/DD-12.md)
- **Effort:** S. **Areas it moves:** Scheduled work; The code itself.
- **Done when:** src/server/cron-routes.scan.test.ts passes with document-pdfs out of NOT_SCHEDULED, and an int test shows an issued invoice with no PDF getting one within two ticks.
- **Platform:** Work's invoices at account level use the same PDF route.
- **Decided (the owner, 12 November: the recommended way):** Made ahead by the scheduled job, as recommended: the tick calls the PDF route when a document waits, so 'Try again' is true. The route and its function stay. *Asked:* Should invoice PDFs be made ahead by the scheduled job, so that 'Try again' is true (recommended), or made on the first download, with the route nothing calls and its 102 MB function removed?
- **To carry it out:** [steps/3.7.md](steps/3.7.md) (review)

## 3.8 Drop the duplicate idempotency table and the leftover schema, after a verified dump

commerce.idempotency_keys and its enum were replaced by the api_idempotency_keys tables of D441, which do its job, so it goes as a duplicate, not because nothing uses it: delete it from src/db/schema.ts with its register rows. The commerce_legacy schema, a renamed copy of the single-store tables kept since 24 September, holds 34 tables (96 rows) named by no code, and is dropped in a guarded migration. Both drops remove production data for good. Before that push: take a dump of the commerce_legacy schema and of commerce.idempotency_keys, restore it to a scratch database and compare the row counts table by table, keep it with the backups, and show the owner where the dump is and the counts. The push waits until the owner has seen them. Five unused columns go when their tables are next changed.

- **Closes:** [DS-14](../findings/database-shape/DS-14.md)
- **Effort:** S. **Areas it moves:** The database.
- **Done when:** rg -n 'idempotency_keys' src | rg -v 'api_(app_)?idempotency_keys' prints nothing, and the size by schema in the reading of step 0.2 lists no commerce_legacy. The dump restores to a scratch database with the same row counts, and the owner saw it and the counts before the drops were pushed.
- **Platform:** The leftover schema is from before the platform had stores; nothing of the platform's reads it.
- **Decided (the owner, 12 November: the recommended way):** Yes to both. The commerce_legacy schema is dropped after a last dump that is verified and shown to the owner, and commerce.idempotency_keys goes because the api_idempotency_keys tables of D441 do its job. Neither moves a grade; the dump is the way back. *Asked:* May the commerce_legacy schema, kept since 24 September as a renamed copy of the single-store tables, be dropped after a last dump? And may commerce.idempotency_keys go, now that the api_idempotency_keys tables of D441 do its job? Neither moves a grade.
- **To carry it out:** [steps/3.8.md](steps/3.8.md) (review)

## 3.9 Keep one kaizenaflow.com

Since 7 November kaizenaflow.com is served from Kaizena Flow's own store (D484), yet the old no-store site is still built, edited and read beside it: 20 route pages in two languages, 23 to 32 admin pages, 3 twin tables and up to 4,400 lines. Finish step 7 of the parity plan: remove the null-store site paths (the front page, [slug], blog, category, tag and cookies under src/app/(platform) and src/app/(platform-nb), with platform-theme-installs.ts, platform-roles.ts and platform-page.tsx), after the media library's rows move to the store. scripts/site-compare.mjs against a copy taken before shows no lost address. The owner has said the switch is final. Support stays as it runs today: the site's visitors on the store's desk, owners on the platform's desk. The routes and screens go first. The twin tables (platform_theme_installs, its updates and platform_page_roles) and the site's null-store rows go in a later push, once that removal is live, and that migration removes production data for good. Before that push: take a dump of those tables and of the null-store site rows, restore it to a scratch database and compare the row counts table by table, keep it with the backups, and show the owner where the dump is and the counts. The push waits until the owner has seen them.

- **Closes:** [FM-3](../findings/families/FM-3.md), [FT-5](../findings/features/FT-5.md), [DS-6](../findings/database-shape/DS-6.md)
- **Effort:** L. **Areas it moves:** The code itself; The product's surface; The database.
- **Done when:** rg -l 'platform_theme_installs' src --glob '!*.test.*' | wc -l prints 0, find 'src/app/(platform)' 'src/app/(platform-nb)' -name page.tsx lists no front page and nothing under [slug], blog, category, tag or cookies (20 files today), and node scripts/site-compare.mjs https://kaizenaflow.com --against before.json passes. The dump of the twin tables and the null-store rows restores to a scratch database with the same row counts, and the owner saw it and the counts before the dropping migration was pushed.
- **Platform:** This is the platform's own step: one place edits Kaizena Flow's site, and /admin/platform loses its second set of page, header, footer and menu screens.
- **Decided (the owner, 12 November: the recommended way):** Yes, the switch of 7 November is final: the old no-store site and its twin tables are removed before opening, which the critic says the code area needs for an A and which is cheapest while nobody outside is disturbed. Support stays two desks, as it runs today: the site's visitors on the store's desk and owners on the platform's; joining them is the parity plan's step 6 and no part of this plan. *Asked:* Is the switch of 7 November final, so that the old no-store site and its twin tables can be removed before opening (or kept as a fallback for some weeks, as the parity plan first said)? And one desk for support and chat (parity plan step 6), or two?
- **To carry it out:** [steps/3.9.md](steps/3.9.md) (strong)

## 3.10 Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope

The platform console has a second engine beside the stores' for workflows, own endpoints and integration deliveries: 26 to 55% of its lines are the stores' own, so a fix to retry or signing is made twice. Move the claim, the retry and the signing into src/server/workflow-engine.ts with a scope argument; separate tables and addresses stay. The platform's four engines stay twins with their own tables (FT-10). The step adds one sentence to CLAUDE.md's parity rule: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy.

- **Closes:** [CP-4](../findings/copied-code/CP-4.md), [FM-4](../findings/families/FM-4.md), [FM-5](../findings/families/FM-5.md)
- **Effort:** M. **Areas it moves:** The code itself; The product's surface.
- **Done when:** rg -c 'for update skip locked' src/server/workflows.ts src/server/platform-workflows.ts prints nothing (the claim lives in workflow-engine.ts only), and the five platform and store pairs share under 60 lines in runs of three or more by the twin counter of step 1.17. CLAUDE.md's parity rule carries the sentence.
- **Platform:** This is the platform's own engine: it keeps every feature and its own tables, and runs them on shared code.
- **Decided (the owner, 12 November: the recommended way):** Twins on shared code: the platform keeps its four engines and their tables, and this step is built (the finding says to keep them unless one engine is wanted, and it is the smaller change). Yes, CLAUDE.md's parity rule gets the sentence: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy. *Asked:* First the choice listed with the owner's choices (FT-10): keep the platform's four engines as twins on shared code, which is this step, or serve Kaizena Flow's events through its own store's engines once the site is one (then the twins are removed with step 3.9 and this step is dropped)? If twins: may the parity rule in CLAUDE.md say that where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy? Separate tables stay.
- **To carry it out:** [steps/3.10.md](steps/3.10.md) (strong)

## 3.11 Fold order rules into Workflows

Order rules ('Automation') and Workflows are two engines for what happens when an order is paid: about 1,900 lines, 4 pages, 2 tables and 1 AI tool. Workflows gains the hold action, 'any' matching and the order facts; then order rules go, and their tables one release later. A hold is a safeguard: runs of order.paid must not be capped at 100 an hour, and the staff email must still say 'held'. The tool list changes, so run the agents' eval. Cheapest now: no owner has a rule to convert.

- **Closes:** [FT-8](../findings/features/FT-8.md)
- **Effort:** M. **Areas it moves:** The product's surface.
- **Done when:** find src -iname '*order-rule*' | wc -l prints 0 (5 today), the store navigation has no /settings/automation link, and src/server/workflows.int.test.ts has a case where a paid order over an amount is put on hold and the staff email says so.
- **Platform:** The hold action and the order facts are store-only by the house rule's exception (the platform sells no goods); the platform's workflows keep every other action.
- **Decided (the owner, 12 November: the recommended way):** Yes. Order rules fold into Workflows, so one engine decides what happens when an order is paid, as the surface's card proposes. It is cheapest now, while no owner has a rule to convert. *Asked:* May order rules fold into Workflows, so one engine decides what happens when an order is paid?
- **To carry it out:** [steps/3.11.md](steps/3.11.md) (strong)

## 3.12 Save an own look in one place: the theme library

An owner's own look can be saved in two places: commerce.store_themes beside the theme library. 'Save as new theme' writes to commerce.store_theme_installs, the saved list leaves the theme editor, and store_themes goes in a second migration one release later. The editor works a little differently after: an own look in the library carries the header, footer and CSS, and counts against the library's limit.

- **Closes:** [FT-12](../findings/features/FT-12.md)
- **Effort:** S. **Areas it moves:** The product's surface.
- **Done when:** rg -n 'store_themes' src --glob '!*.test.*' | wc -l prints 0 after the second migration (17 today), and src/server/themes.int.test.ts has a case where 'Save as new theme' adds a row to commerce.store_theme_installs.
- **Platform:** The platform's theme workspace is a store too and changes in the same change.
- **Decided (the owner, 12 November: the recommended way):** Yes. An owner's own look is saved only in the theme library; the saved list leaves the theme editor. One place to look, and the old table stays one release as the way back. *Asked:* May an owner's own look be saved only in the theme library, not also as a saved theme in the editor?
- **To carry it out:** [steps/3.12.md](steps/3.12.md) (review)

## 3.13 Give the five file imports one core

Five CSV imports each repeat the upload, register, check, apply and cursor code, the browser flow and the pages: 18 twin pairs, about 1,300 to 1,600 lines. One import definition with one job writer, one import flow in the browser, and 15 tick and problems routes become 2.

- **Closes:** [CP-1](../findings/copied-code/CP-1.md), [FM-6](../findings/families/FM-6.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** rg -l 'insert into commerce[.]data_jobs' src/server --glob '!*.test.ts' prints one file (five today), rg --files src/components/admin | rg 'import-flow' lists one file (four today), and src/lib/copies.baseline.json holds at most 23 twin pairs (41 today).
- **Platform:** The platform has no file import of its own to fold.
- **To carry it out:** [steps/3.13.md](steps/3.13.md) (strong)

## 3.14 Draw Work once for store and account, and keep one Domains move page

Work's account-level screens are copies of the store-level ones (29 to 77% the same), and 58 Work actions are wrapped in a seven-line shell. One Work view serves store and account, the actions sit on the shared wrapper, and the two Domains move pages become one. The three twin pairs in Work's server reads fold too: src/server/work-sql.ts holds the open-invoice condition, the paid sum, the time-entry joins and the grouping helper, read by work-attention.ts, work-overview.ts and work-owner.ts, which stays.

- **Closes:** [CP-5](../findings/copied-code/CP-5.md), [FM-10](../findings/families/FM-10.md), GAP-code-s5
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** wc -l of the five owner-time, owner-invoices, owner-clients, owner-report and owner-overview files totals under 800 (1,209 today), the twin counter lists none of the three Work server pairs, src/lib/copies.baseline.json holds at most 16 twin pairs, and the Work integration tests pass unchanged.
- **Platform:** Work at account level is the second set of screens named, and it keeps every screen.
- **To carry it out:** [steps/3.14.md](steps/3.14.md) (review)

## 3.15 Keep one of each small thing: helpers, SQL fragments, English word lists

fail() is declared in 43 server files, isUuid in 23, isUniqueViolation in 9, and the day and country helpers 31 times with different bodies: give each one home, kept by a lint rule. The product title with its fallback, the usage counter and the order event are typed out in dozens of files: one fragment each (nine reads lack the title's fallback today). English word lists kept twice (old constants beside the catalogues, held equal by 37 assertions) get one source.

- **Closes:** [CP-8](../findings/copied-code/CP-8.md), [CP-16](../findings/copied-code/CP-16.md), [FM-12](../findings/families/FM-12.md), [CP-9](../findings/copied-code/CP-9.md), [DD-7](../findings/unused-code/DD-7.md), [CP-13](../findings/copied-code/CP-13.md)
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** rg -c '^(export )?(const|function) (isUuid|isUniqueViolation)' src --glob '!*.test.ts' sums to 2 (32 today), rg -c 'insert into commerce[.]order_events' src --glob '!*.test.ts' sums to 1 (34 today), and no test holds a catalogue section equal to a words constant (37 such assertions today); fail() is declared in one server file (43 today), the day and country helpers sum to at most 8 (31 today), 'insert into commerce.chat_usage' is in at most 2 places, and a trial 'const isUuid =' in a new file fails lint or the scan.
- **Platform:** The helpers and fragments are shared code, and the platform's files are among those that lose a private copy.
- **To carry it out:** [steps/3.15.md](steps/3.15.md) (review)

## 3.16 Draw an order's totals from one part

An order's totals are drawn in two order pages and again in checkout, and product cards are queried in two shapes. One OrderTotals part serves the three, and one product-card query. These are the sums a shopper pays by, so it is a step of its own: the checkout and order specs are the proof that nothing moved.

- **Closes:** [CP-12](../findings/copied-code/CP-12.md)
- **Effort:** S. **Areas it moves:** The code itself.
- **Done when:** The two order page files total under 900 lines (988 today) and draw OrderTotals, as checkout does, and the checkout and order e2e specs pass unchanged.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and draws no order totals of its own.
- **To carry it out:** [steps/3.16.md](steps/3.16.md) (review)

## 3.17 Keep one stored page shape

Every read of a stored page runs the editor's whole input schema and the upgraders for three old shapes, and six source files and the seed still write the old grid shape. Every writer (the themes, the content packs, the seed) writes the current shape since step 0.46. Here scripts/page-shapes.mjs counts the documents that differ from their parse and rewrites them once, and the upgraders go (about 240 lines) with the rule and the spec that pin them.

- **Closes:** [PM-9](../findings/page-builder-model/PM-9.md), [DD-9](../findings/unused-code/DD-9.md)
- **Effort:** M. **Areas it moves:** The page builder's model and a built page; The code itself.
- **Done when:** node scripts/page-shapes.mjs prints 0 documents that differ from their parse on a freshly seeded database and on production, and rg for upgradeRow, upgradeBlock, upgradeLegacy and upgradeResponsive in src outside tests prints nothing.
- **Platform:** The platform's pages and the launch themes' snapshots are rewritten by the same script.
- **To carry it out:** [steps/3.17.md](steps/3.17.md) (strong)

## 3.18 Build twice per push, and lint and type-check once

A push builds the app three times in CI and lints twice. The unsigned and the signed-in browser suites share one build, with the specs that assumed Supabase was not configured adjusted; hosts keeps its own. Lint and the type check run once per push. The skip of a deploy for a tests-only push is step 0.38's. This step may not make the slowest job a release waits for longer: if one browser job behind one build would be slower than today's slowest, it keeps two test jobs and hands them the one build as an artifact.

- **Closes:** [TC-7](../findings/tests-ci-build/TC-7.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** src/lib/ci-once.scan.test.ts holds pnpm build in two CI jobs, one lint and one full type check per push, and the recorder of step 1.20 shows the slowest job a release waits for no slower after than before, with no single run over 10 minutes.
- **Platform:** One CI and one deploy serve stores and platform.
- **To carry it out:** [steps/3.18.md](steps/3.18.md) (strong)

## 3.19 Let a burst of pushes share one deploy

Each deploy empties every store's cached pages and starts every function cold: up to 52 deploys on 11 November. A CI run on the no-migration path skips its deploy when a newer commit is already on main, so a burst of pushes shares one; a run that applied a migration always deploys. The repository variable SHARE_DEPLOYS set to 'false' turns the skip off. It changes D5's 'at once' by a few minutes, and D5's row and CLAUDE.md's Workflow line say so. If step 1.21 moved the build to CI, this skip also keeps an older build from landing after a newer one.

- **Closes:** [CA-2](../findings/caching/CA-2.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; Tests, CI and the build.
- **Done when:** Two pushes to main one minute apart produce one production deploy (two today), read from the two runs' logs, and /api/health reports the second commit. With SHARE_DEPLOYS set to 'false' the same two pushes produce two.
- **Platform:** Kaizena Flow's own pages keep their cache through a skipped deploy like a store's.
- **Decided (the owner, 12 November: the recommended way):** Yes. A CI run on the no-migration path skips its deploy when a newer commit is already on main, so a burst of pushes shares one deploy; a run that applied a migration always deploys. It keeps stores' cached pages through a burst, and a repository variable turns it off. *Asked:* Once stores are open, may a CI run skip its deploy when a newer commit is already on main, so a burst of pushes shares one deploy? It changes D5's 'at once' by a few minutes.
- **To carry it out:** [steps/3.19.md](steps/3.19.md) (review)

## 3.20 Show how long due work waits, and say so when it is too long

The gate of step 3.1 trades a poll for a predicate. If a predicate misses a kind of due work, that work starts up to 15 minutes late, at the sweep, and the calls figure looks better for it. A function beside commerce.cron_due() returns, for each gated queue, the age of its oldest unfinished row, read by a condition wider than the predicate, or it could not see a predicate that is wrong. The watcher of step 1.22 reads it and emails the admins when a queue a person watches (AI page builds, looks at a page, the Dream Factory) is over 3 minutes, or another over 20. The daily reading keeps each queue's worst wait of the day. Do it after step 3.1.

- **Closes:** GAP-scheduled-s4
- **Effort:** S. **Areas it moves:** Scheduled work.
- **Done when:** An int test leaves a waiting row in commerce.page_ai_jobs for 4 minutes and sees the watcher's email, and Platform, Usage and limits shows each queue's worst wait of the day.
- **Platform:** The platform's own queues (the Dream Factory, theme shots) are gated queues like the stores' and are watched by the same function.
- **Decided (the owner, 12 November: the recommended way):** 3 minutes for work a person watches (an AI page build, a look at a page, the Dream Factory) and 20 minutes for the other queues, as the step and the scheduled card assume. Both are constants in one file, so another figure is a one-line change. *Asked:* How long may work that a person watches wait before the admins are told (an AI page build, a look at a page, the Dream Factory)? The step assumes 3 minutes, and 20 for the other queues; any stated figure reaches the bar.
- **To carry it out:** [steps/3.20.md](steps/3.20.md) (review)
