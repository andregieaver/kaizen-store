# Phase 1: Budgets, so it stays removed

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Turn every measure of this plan into a number that a test or a production figure holds and only lets fall. Each budget starts at the figure phase 0 leaves, with its tolerance stated, and each later step lowers its own. An A needs every measure held, so no area's budget is left for later. **A person will notice:** A change that makes a page, a function, a scheduled run, an AI call, a build or the standing rules heavier fails a check that names the number and says what to do. Platform, Usage and limits shows cold starts, the day's costliest statements and the admin's speed.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 1.1 Give every budget one home, and hold the written rules first

This plan's own checks would add about 27 sentences to CLAUDE.md. Write one rule in docs/rules that lists every baseline file with its test and its script. A scan test fails when a *.baseline.json under src is not named there, CLAUDE.md gets one sentence for all budgets, and each scan's failure message says what to do. Then hold the rules themselves: src/lib/docs-budget.scan.test.ts with src/lib/docs-budget.baseline.json (CLAUDE.md's bytes and lines, long lines per folder, rules over 4,000 bytes), checked on docs-only pushes too by .github/workflows/docs-budget.yml. Do it before any other budget step.

- **Closes:** [DC-3](../findings/written-rules/DC-3.md), GAP-rules-1
- **Effort:** S. **Areas it moves:** The written rules.
- **Done when:** pnpm test src/lib/docs-budget.scan.test.ts passes at the figures phase 0 left, node scripts/docs-ratchet.mjs --check runs on a docs-only push, and a scan test fails for a *.baseline.json under src that the budgets rule does not name.
- **Platform:** One rule for all budgets: the platform's routes, jobs and tables are counted in the same baselines.
- **The owner's question first:** Should this plan get lines of its own in CLAUDE.md, as the code review has? Proposed: no. One shared line names the trackers, and each tracker keeps its rules at its own top.

## 1.2 Hold every route's first scripts, and documents, stylesheets and after-load requests on real pages

Budgets watch 15 of 560 routes, the visitor's one counts a legacy file no modern browser loads, and no document, stylesheet or request count is held. scripts/bundle-budget.mjs reads .next/diagnostics/route-bundle-stats.json after each build against a baseline of all 560 routes, with 15,000 bytes of room each. e2e/performance.spec.ts, edited once, counts the server's script tags without nomodule on 8 store routes within 3%, and holds document and payload bytes (one of them a six-row, 31-block page made from Orbit's home), stylesheet bytes on 3 routes within 4%, inline style text, and the fetches a page makes after load. Tailwind's @source lines point at code only, not at tests, message files and SQL, held by src/lib/stylesheet-sources.scan.test.ts. The ratchet gains two counts: list statements that select a whole document, and what one publish makes stale.

- **Closes:** [AC-10](../findings/admin-browser/AC-10.md), [BN-11](../findings/client-bundles/BN-11.md), [SC-6](../findings/storefront-browser/SC-6.md), [PL-13](../findings/page-payload/PL-13.md), [PM-14](../findings/page-builder-model/PM-14.md), [CS-3](../findings/styles/CS-3.md), [CS-6](../findings/styles/CS-6.md), [AS-7](../findings/files/AS-7.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** node scripts/bundle-budget.mjs exits 0 in CI with a baseline of all 560 routes and fails on a branch that adds a 20 KB import to one admin route, and e2e/performance.spec.ts holds first-scripts budgets for 8 storefront routes within 3%, document budgets on 5 routes and stylesheet budgets on 3.
- **Platform:** The baseline lists every route, so /admin/platform's screens and Kaizena Flow's public pages are held like a store's.

## 1.3 Put the admin under the import walk, and hold where the words go

The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out, and 6 of the 8 ways words can leak have no test. Add src/components/admin/admin-bundle.scan.test.ts (no Supabase client and no zod in the frame, no whole catalogue), a dead-key scan (src/lib/message-keys.scan.test.ts), a rule that catalogue files hold text only (src/lib/admin-messages/imports.scan.test.ts), and document budgets in e2e/signed-in/admin-scripts.spec.ts. auth.setup.ts signs in a second owner whose admin language is Norwegian, through the stand-in as the others are, so every words budget runs in both languages.

- **Closes:** [AC-11](../findings/admin-browser/AC-11.md), [TX-9](../findings/interface-text/TX-9.md), GAP-text-2
- **Effort:** M. **Areas it moves:** What an owner's browser gets; Interface text.
- **Done when:** pnpm test runs admin-bundle.scan.test.ts, admin-text-reach.scan.test.ts, src/lib/admin-messages/imports.scan.test.ts and src/lib/message-keys.scan.test.ts green and each fails on its planted case, and e2e/signed-in/admin-scripts.spec.ts holds an English and a Norwegian figure for each budgeted screen.
- **Platform:** The platform admin's client modules are walked by the same scan, and its home is one of the budgeted screens.

## 1.4 Put the pages real shoppers get into the measured set: a launch-theme store and a paying cart

All 12 measured store pages are the bare template: no font file, one-row pages, pictures of about 1 KB and an empty cart. Seed one store in CI through the real preset path (Orbit with its content pack, header, footer and product layout, photographs through the upload pipeline, its two font families as fixture rows), and hold its home, a product page, a listing and a built page: document, payload, style text, font files, picture bytes on a 3x phone and router requests. Add a fixture store with payments on and a payment stand-in in the style of e2e/fixtures/auth-stub.mjs (the only fake, told it is one, no bypass in the app), and hold a cart with two lines and the checkout at its payment step. No finding covers this; three stewards asked for it, and without it no budget sees what a new owner's shoppers load.

- **Closes:** GAP-shopper-browser-1, GAP-page-model-3, GAP-styles-1, GAP-shopper-browser-2
- **Effort:** L. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** e2e/performance.spec.ts prints and holds, each within 5% of its first figure, the themed home's font files (at most 2 files and 80 KB), stylesheets (at most 3), document and router requests, and for the two-line cart and the checkout at its payment step first scripts, the document, router requests after load (0 while the form shows) and third-party bytes; all six pages are in measure-routes.mjs.
- **Platform:** Kaizena Flow's own site runs on a theme in its own store, so the themed store's budgets are the nearest held figure for it; its home has a document budget from the house store seeded in step 0.2.

## 1.5 Hold what a server entry loads and carries

Nothing counts what a route's function loads, so the cycle grew to 229 files unseen. Build one import walker and three checks on it: src/server/route-load.graph.test.ts with src/server/route-load.baseline.json (source files reached per entry, forbidden modules, the largest cycle), scripts/trace-sizes.mjs --check in CI's e2e job (megabytes traced beside a function), and scripts/route-budget.mjs (chunk bytes per kind of entry, repeated chunks, and the 10.4 MB server-reference manifest every cold function reads). src/lib/dependencies.scan.test.ts fails on a package with no importer. Three planners named three tests: build it once.

- **Closes:** [SG-14](../findings/server-module-graph/SG-14.md), [SF-7](../findings/server-functions/SF-7.md), [DP-6](../findings/dependencies/DP-6.md), [AS-3](../findings/files/AS-3.md), [SG-16](../findings/server-module-graph/SG-16.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** pnpm test runs route-load.graph.test.ts and dependencies.scan.test.ts green, a trial import of '@/server/chat-route' into a beacon fails the graph test naming the route, and scripts/route-budget.mjs prints the manifest's bytes and entries on every CI build and fails when either rises (10.4 MB and 81,027 today).
- **Platform:** The baseline's entries include the platform admin's layout and one of its pages, the public site's front page and the docs' feedback route.

## 1.6 Count statements and rows: admin screens, the idle tick, the minute routes and the cold frame

Nothing counts queries, so the store Home grew to 30 statements and the scheduler to about 170,000 idle statements a day unseen. Put one counter in the database client. src/server/admin-statements.int.test.ts holds five screens (store shell, store Home, orders list, products list, platform Home), and one log line per admin render gives the production figure. src/server/query-budget.int.test.ts holds the idle dispatcher tick, each minute route and the cold frame, with 1 and with 20 seeded stores, and also records rows read (seq_tup_read plus idx_tup_fetch), so a read that grows with other stores' rows fails. pruneVisits() asks only stores older than the retention period.

- **Closes:** [DQ-11](../findings/queries/DQ-11.md), [AD-12](../findings/admin-server/AD-12.md), [CR-14](../findings/scheduled-work/CR-14.md), GAP-database-2
- **Effort:** M. **Areas it moves:** The database; What the server loads and asks; Scheduled work.
- **Done when:** pnpm test:int runs admin-statements.int.test.ts with five screens in its baseline and query-budget.int.test.ts with its counts in src/server/ratchet.baseline.json, and the second fails when a scratch change writes 'store_id is not distinct from' back into listPublishedPages or adds a per-store statement to a daily prune.
- **Platform:** The platform Home is one of the five screens, and the idle tick that is counted includes the platform's own jobs.

## 1.7 Hold the storefront's server side: statements per page, cached reads, render modes, a shop-only journey and a placed order's writes

The browser's side has budgets; the server's has none that can see these costs. scripts/server-budget.mjs in CI's e2e job counts statements for the home, a product, All products, a category, search, and home with a cart cookie (first budgets are today's numbers plus 2). src/server/use-cache.scan.test.ts lists every cached read's life and tags, and scripts/render-modes.mjs holds compute mode and holes per route, so one cookies() read in a shared part cannot move every store page to per-request unseen. An int test walks a store with features ['shop'] from home to checkout and fails when a statement names a table of a switched-off feature. The budget also keeps what one guest order of three lines and one counted visit write: statements, and rows inserted and updated.

- **Closes:** [SD-13](../findings/storefront-server/SD-13.md), [CA-16](../findings/caching/CA-16.md), GAP-surface-1, GAP-database-3
- **Effort:** M. **Areas it moves:** What the server loads and asks; The product's surface; The database.
- **Done when:** node scripts/render-modes.mjs passes on CI's build and fails, naming /s/demo/no, on a trial cookies() read in the store's footer; scripts/server-budget.mjs holds six pages; the shop-only journey case passes in pnpm test:int; and a scratch trigger on commerce.orders that writes a row fails the write budget.
- **Platform:** The house store's home is in the render-mode and statement baselines (seeded in step 0.2), so Kaizena Flow's front page cannot leave the static shell unseen.

## 1.8 Hold with production figures what a test cannot: a slow phone, the admin's speed, a cold start

No figure of time is measured or held, and no finding covers it. measure-routes.mjs gains a run with the CPU slowed four times (blocking time, script bytes run by idle), with the run bytes budgeted in e2e/performance.spec.ts; a nightly workflow beside live-a11y.yml runs scripts/perf.mjs --form=mobile --min=90 against a launch-theme demo store and Kaizena Flow's front page. The morning briefing gets a line when the admin's LCP or INP at p75 over 28 days is not 'good' for a kind of screen with 100 loads, and the beacon tells the builder from the product editor. Each instance logs one instance.start line through log() (kind of entry, milliseconds to the end of register() and to the first answer, resident memory), shown as cold starts a day with p50 and p95 by kind. If production puts the server-reference manifest above 30 ms per cold start, give the most-listed cached readers their own files until it is under 5 MB.

- **Closes:** GAP-shopper-browser-3, GAP-owner-browser-3, GAP-server-3
- **Effort:** L. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets; What the server loads and asks.
- **Done when:** The nightly job has run green for a week with its table in docs/performance.md, a unit test of the briefing shows the line for a seeded slow kind of screen, and Platform, Usage and limits shows a week of cold-start figures with a beacon within 150 ms of the health check.
- **Platform:** All three figures live in /admin/platform (the briefing and Usage and limits), and Kaizena Flow's front page is one of the two pages measured each night.

## 1.9 Hold unused code, copies and the admin's repeats with ratchets of exact lists

Lint sees unused locals only, and no test counts copies, twins, public files or route handlers nothing calls. src/server/unused.scan.test.ts, with scripts/unused.mjs to print and lower its lists, holds today's unused and test-only exports, so they can only shrink, and adds two cases: every file under public/ and every route.ts under src/app/api is referenced, or listed with its reason. One copy counter and one twin counter (scripts/lib/copy-count.mjs) run against src/lib/copies.baseline.json: 4,098 exact copied lines across files, 705 inside files, 41 twin pairs, each kept pair with a reason. src/server/ratchet.baseline.json gains the admin's repeat counts: action files off the shared wrapper (232), tables 154, native selects 436, files with Europe/Oslo 67, files with confirm( 42.

- **Closes:** [DD-4](../findings/unused-code/DD-4.md), GAP-code-2, [CP-14](../findings/copied-code/CP-14.md), [FM-13](../findings/families/FM-13.md), [FM-7](../findings/families/FM-7.md), [FM-8](../findings/families/FM-8.md), GAP-code-3
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** pnpm test fails on each planted case: export const NEVER_USED = 1 in a file under src/lib, public/unused.png, an empty src/app/api/never/route.ts, and a 30-line block pasted into another file or twice inside one.
- **Platform:** The platform's twins (its second engines and the modules of its 19 platform_* tables) are in the twin baseline with their reason until step 3.6 folds them.

## 1.10 Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows

One of 14 surface counts has a budget, and orders went from 24 to 34 indexes unseen. src/lib/surface-budget.scan.test.ts with src/lib/surface-budget.baseline.json holds dispatcher jobs, every-minute routes, pages, navigation links per section, AI tools, tables, platform_* tables and the rest. The same file carries index and trigger counts for the eight hot tables (orders 32 and 27 after step 0.20) and the rows the database writes for a new store (8 today, counted by a case in src/db/commerce.test.ts). A count rises only with --raise and a decision row that carries an 'Idle cost:' line: what the feature costs a store that does not use it. One paragraph in docs/store-features.md says switches are for what an owner sees, not for cost.

- **Closes:** [FT-2](../findings/features/FT-2.md), [DS-12](../findings/database-shape/DS-12.md), GAP-surface-3
- **Effort:** S. **Areas it moves:** The product's surface; The database.
- **Done when:** pnpm test src/lib/surface-budget.scan.test.ts passes with 14 counts and the hot tables' counts in its baseline, and fails when a scratch migration adds a trigger on commerce.orders or one more job joins the dispatcher's list without --raise.
- **Platform:** The 19 platform_* tables and the platform's pages and jobs are counts of their own, so a new platform twin must state its idle cost too.
- **The owner's question first:** May a test refuse a new table, trigger, scheduled job, navigation link or AI tool until its decision row states what it costs a store that does not use it?

## 1.11 Hold every agent's round, show real tokens per call, and let the eval see whether the model finds a tool

The only AI budget is a tool count set at the provider's cap. src/server/ai-round.scan.test.ts with src/server/ai-round.baseline.json draws the AI manager's default round (161,661 characters today) and the seven fixed prompts with their tool sets: the shopper chat with and without support, the docs guide, the Dream Factory's steps and the autopilot's events. A log line per round and Platform, AI show input, cached and output tokens per call by feature, median and 90th percentile. Add at least 8 lean eval cases (six that need a tool outside the core 12, two that must load nothing), commit a first recording as the 'before', and try reasoning_effort 'low' on the two tool loops in one eval run.

- **Closes:** [AI-10](../findings/ai-calls/AI-10.md), [AI-14](../findings/ai-calls/AI-14.md), GAP-ai-3
- **Effort:** M. **Areas it moves:** AI calls.
- **Done when:** ai-round.scan.test.ts fails when 2,000 characters are added to list_orders' description or 500 to the shopper chat's prompt, src/data/agent-eval-recording.json holds at least 8 lean cases and agent-eval-replay.int.test.ts passes on it, and Platform, AI shows output tokens per call.
- **Platform:** The platform's assistant and its 39 tools are a line in the baseline, and the panel is Platform, AI.

## 1.12 Record every check's seconds and the build's peak memory, with ceilings

Not one number of the checks is held, while the production build peaks at about 7.2 GB of 8. scripts/timed.mjs wraps lint, the type check, the unit run, each integration shard, each Playwright run and each build, with ceilings in scripts/ci-budgets.json (25% above the median of the last ten runs; the slowest job a release waits for at 8 minutes). scripts/next-build.mjs prints seconds and peak memory after every build, Vercel's included; scripts/await-deploy.mjs writes the seconds from push to live, and Playwright's JSON reporter gives the tests that passed only on a retry. Turn source maps off in the Vercel build's page worker if a capped build shows it pays (about 4.7 MB of heap per MB of server code), and write both peaks into docs/build-memory.md. pnpm check runs the pre-push rule through the recorder.

- **Closes:** [TC-8](../findings/tests-ci-build/TC-8.md), [AS-10](../findings/files/AS-10.md), GAP-build-1
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** Every CI run's summary lists seconds for lint, the type check, the unit run, each shard, each browser job and the build, the build's peak memory, the seconds from push to live and the retried tests; a run fails above a ceiling in scripts/ci-budgets.json; and docs/build-memory.md has a row for each source-map setting.
- **Platform:** One CI and one build serve stores and platform.

## 1.13 Give the production build room, and fail a run before it runs out

The build has 0.8 GB of room on Vercel's 8 GB machine and was killed once on 11 November, and nothing in this plan is measured to give it a quarter of the machine. Either pay for the 16 GB build machine, with the build cache and the workers back on, or run vercel build in CI and vercel deploy --prebuilt, which makes the deployed build the checked one. Either way a run goes red with the number when the peak passes 75% of the machine. After the cuts of phases 0 and 2, measure again under a memory cap and report repeated server chunks with scripts/route-budget.mjs: 123.6 MiB of 195.5 MiB is the same three chunks written many times.

- **Closes:** GAP-build-2, [SG-11](../findings/server-module-graph/SG-11.md), [SF-11](../findings/server-functions/SF-11.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build; What the server loads and asks.
- **Done when:** Ten production builds running peak at 75% of their machine or less with a failing check above it, scripts/route-budget.mjs reports under 40 MiB of repeated server chunk bytes on a CI build, and code review step 1.8 is Done.
- **Platform:** One build makes the platform admin and Kaizena Flow's site with the stores.
- **The owner's question first:** Pay for Vercel's 16 GB build machine, or build in CI and deploy the prebuilt output? Without one of the two the build area stops at a B.
