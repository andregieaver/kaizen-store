# Phase 1: Budgets, so it stays removed

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Turn every measure of this plan into a number that a test or a production figure holds and only lets fall. Every step here says which measures it holds. Each budget starts at the figure phase 0 leaves, with its tolerance stated, and each later step lowers its own. No step here waits for a later phase. Step 1.1 goes first, and 1.9 before the three steps that count statements. **A person will notice:** A change that makes a page, a function, a scheduled run, an AI call, a build or the standing rules heavier fails a check that names the number and says what to do. Platform, Usage and limits shows cold starts, the day's costliest statements and the admin's speed, and a stopped scheduler sends an email.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 1.1 Give every budget one home, and hold the written rules first

This plan's own checks would add about 27 sentences to CLAUDE.md. Write one rule in docs/rules that lists every baseline file with its test and its script. A scan test fails when a *.baseline.json under src is not named there, CLAUDE.md gets one sentence for all budgets, and each scan's failure message says what to do. Then hold the rules themselves: src/lib/docs-budget.scan.test.ts with src/lib/docs-budget.baseline.json, checked on docs-only pushes too by .github/workflows/docs-budget.yml. It holds CLAUDE.md's bytes and lines, as a ceiling that steps down and is never raised. It holds lines over 500 characters per folder, and table rows over 500 characters (410, only falling). It holds rules and decisions over 4,000 bytes (24 and 46): none new, and each shortened when it is next changed. It holds the three ignore files, and that no decision id appears twice. Do it before any other budget step. It holds the rules area's measures 1 to 4 and 6.

- **Closes:** [DC-3](../findings/written-rules/DC-3.md), GAP-rules-1
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** pnpm test src/lib/docs-budget.scan.test.ts passes at the figures phase 0 left, node scripts/docs-ratchet.mjs --check runs on a docs-only push, and the test fails on each planted case: a 600-character prose line in docs/rules, a new rule of 5,000 bytes, a *.baseline.json under src that the budgets rule does not name, and a dated report under docs/audits that no ignore file covers.
- **Platform:** One rule for all budgets: the platform's routes, jobs and tables are counted in the same baselines.
- **The owner's question first:** Should this plan get lines of its own in CLAUDE.md, as the code review has? Proposed: no. One shared line names the trackers, and each tracker keeps its rules at its own top.

## 1.2 Hold every route's first scripts

Budgets watch 15 of 560 routes: 9 of the admin's 449, and none of its worst four. scripts/bundle-budget.mjs reads .next/diagnostics/route-bundle-stats.json after each build against a baseline of all 560 routes, with 15,000 bytes of room each, and CI runs it. When a route's figure falls, the baseline is lowered in the same change. It holds first scripts by route: the owner's browser measures 1, 3 and 8, and the shopper's measure 8.

- **Closes:** [AC-10](../findings/admin-browser/AC-10.md), [BN-11](../findings/client-bundles/BN-11.md)
- **Effort:** S. **Areas it moves:** What an owner's browser gets; What a shopper's browser gets.
- **Done when:** node scripts/bundle-budget.mjs exits 0 in CI with a baseline of all 560 routes, and fails on a branch that adds a 20 KB import to one admin route.
- **Platform:** The baseline lists every route, so /admin/platform's screens and Kaizena Flow's public pages are held like a store's.

## 1.3 Hold documents, stylesheets and requests on real store pages

The visitor's budget counts a legacy file no modern browser loads, on 2 store routes with 14 to 16% of room, and no document, stylesheet or request count is held. e2e/performance.spec.ts, edited once, counts the server's script tags without nomodule on 8 store routes within 3%. It holds document and payload bytes on 5 routes within 5%, one of them a six-row, 31-block page made from Orbit's home. It holds stylesheet bytes on 3 routes within 4%, the admin's two sheets among them, inline style text, and the fetches a page makes after load. e2e/prefetch.spec.ts keeps one table of router-request budgets for the store home, a product page, a listing, the cart and the front door, each at its measured count plus 2, and checks that each page goes quiet. The ratchet gains two counts that only fall: statements that select a whole page document, and places that refresh a store's whole pages tag. It holds the shopper's browser measures 1 to 4 and 8, the page model's measures 3 and 5, and the styles' measures 1, 3 and 6.

- **Closes:** [SC-6](../findings/storefront-browser/SC-6.md), [PL-13](../findings/page-payload/PL-13.md), [PM-14](../findings/page-builder-model/PM-14.md), [CS-3](../findings/styles/CS-3.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** e2e/performance.spec.ts holds first-scripts budgets for 8 storefront routes within 3%, document budgets on 5 routes and stylesheet budgets on 3; e2e/prefetch.spec.ts holds a request budget for five pages; and src/server/ratchet.baseline.json holds the two new counts.
- **Platform:** Kaizena Flow's front page is one of the pages with a document budget and a request budget.

## 1.4 Put the admin under the import walk, and hold where the words go

The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out, and 6 of the 8 ways words can leak have no test. Add src/components/admin/admin-bundle.scan.test.ts, a walk that follows imports through modules without a directive: no Supabase client and no zod in the frame, and no whole catalogue, with today's exceptions on lists that only shrink. Add a dead-key scan (src/lib/message-keys.scan.test.ts) and a rule that catalogue files hold text only (src/lib/admin-messages/imports.scan.test.ts; today's 36 value imports in 14 files are its starting list). It holds the owner's browser measure 4 and the text area's measures 4, 6 and 7.

- **Closes:** [AC-11](../findings/admin-browser/AC-11.md), [TX-9](../findings/interface-text/TX-9.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; Interface text.
- **Done when:** pnpm test runs admin-bundle.scan.test.ts, admin-text-reach.scan.test.ts, src/lib/admin-messages/imports.scan.test.ts and src/lib/message-keys.scan.test.ts green, and each fails on its planted case: an import of zod in the admin's frame, an import of @/lib/admin-text in src/server/cart.ts, an import of zod in a catalogue file, and a new key that nothing reads.
- **Platform:** The platform admin's client modules are walked by the same scan.

## 1.5 Hold what a signed-in screen is handed, in English and in Norwegian

Every admin figure is for an English account, the spec reads the HTML's script tags only, and nobody has recorded what a save answers with. auth.setup.ts signs in a second owner whose admin language is Norwegian, through the stand-in as the others are. e2e/signed-in/admin-scripts.spec.ts then holds five screens in both languages: the store home, orders, a product's editor, the builder and the platform home. For each it holds the document's bytes, the words handed and the words in groups a part reads (kept as a baseline beside the spec), and the script fetched by the time the page is idle. It records the bytes a save answers with on the product editor and the builder. Each starts at the figure phase 0 leaves and only falls. It holds the owner's browser measures 2, 5 and 8 and the text area's measures 3 and 7.

- **Closes:** GAP-text-2
- **Effort:** M. **Areas it moves:** Interface text; What an owner's browser gets.
- **Done when:** e2e/signed-in/admin-scripts.spec.ts holds an English and a Norwegian figure for each of the five screens (document, words handed and read, script by idle) and a save's answer for two, and fails when a 10 KB area is added to a layout's hand-down in Norwegian.
- **Platform:** The platform home is one of the five screens, in both languages.

## 1.6 Put a launch-theme store into the measured set

All 12 measured store pages are the bare template: no font file, one-row pages and pictures of about 1 KB. Every store started from a theme has a builder-made header and footer, two font families and photographs. Seed one store in CI through the real preset path: Orbit with its content pack, header, footer and product layout, photographs through the upload pipeline, and its two font families as fixture rows, since CI cannot reach Google Fonts. Hold its home, a product page, a listing and a built page: document, payload, style text and the copies of each sheet, font files, picture bytes on a 3x phone and router requests. Add the pages to measure-routes.mjs. No finding covers this; three stewards asked for it. It holds the shopper's browser measure 6, the page model's measures 5 and 6 and the styles' measures 3 and 7.

- **Closes:** GAP-shopper-browser-1, GAP-page-model-3, GAP-styles-1
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** e2e/performance.spec.ts prints and holds, each within 5% of its first figure, the themed home's font files (at most 2 files and 80 KB, both preloaded), stylesheets (at most 3), style text, document and router requests, and Orbit's home as stored at or under 11,100 bytes; the four themed pages are in measure-routes.mjs.
- **Platform:** Kaizena Flow's own site runs on a theme in its own store, so the themed store's budgets are the nearest held figure for it; its home has a document budget from the house store seeded in step 0.3.

## 1.7 Put a cart with products and the checkout's payment step into the measured set

The cart was measured empty, and the checkout's load ended on the cart because the demo store takes no payments. Add a fixture store with payments on, made with SQL as e2e/draft-pay.spec.ts does, and a payment stand-in in the style of e2e/fixtures/auth-stub.mjs: the only fake, told it is one, with no bypass in the app. Hold a cart with two lines and the checkout at its payment step: first scripts, the document, router requests after load, and third-party requests and bytes. It holds the shopper's browser measure 6 on the money path.

- **Closes:** GAP-shopper-browser-2
- **Effort:** M. **Areas it moves:** What a shopper's browser gets.
- **Done when:** e2e/performance.spec.ts holds, each within 5% of its first figure, first scripts, the document and third-party bytes for the two-line cart and the checkout at its payment step, with 0 router requests while the payment form shows and the payment provider's script the only third-party request; both pages are in measure-routes.mjs.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and draws no cart or checkout of its own.

## 1.8 Hold what a server entry loads and carries

Nothing counts what a route's function loads, so the cycle grew to 229 files unseen. Build one import walker and three checks on it. src/server/route-load.graph.test.ts with src/server/route-load.baseline.json holds source files reached per entry, forbidden modules, the largest cycle, and a named list of every handler over 1,500 modules with its reason. scripts/trace-sizes.mjs --check in CI's e2e job holds the megabytes traced beside a function. scripts/route-budget.mjs holds chunk bytes per kind of entry and the 10.4 MB server-reference manifest every cold function reads, and prints repeated server chunks and the count of routing rules against Vercel's cap of 2,048. src/lib/dependencies.scan.test.ts fails on a package with no importer. Three planners named three tests: build it once. It holds the server's measures 1, 2 and 8 and the code area's measures 5, 7 and 8.

- **Closes:** [SG-14](../findings/server-module-graph/SG-14.md), [SF-7](../findings/server-functions/SF-7.md), [DP-6](../findings/dependencies/DP-6.md), [AS-3](../findings/files/AS-3.md), [SG-16](../findings/server-module-graph/SG-16.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** pnpm test runs route-load.graph.test.ts and dependencies.scan.test.ts green, a trial import of '@/server/chat-route' into a beacon fails the graph test naming the route, and scripts/route-budget.mjs prints the manifest's bytes and entries and the count of routing rules on every CI build and fails when the manifest rises (10.4 MB and 81,027 today).
- **Platform:** The baseline's entries include the platform admin's layout and one of its pages, the public site's front page and the docs' feedback route.

## 1.9 Count statements: one counter, and the admin's five screens

Nothing counts queries, so the store Home grew to 30 statements unseen. Put one counter in the database client (src/db/client.ts), off unless a test or a log line asks. src/server/admin-statements.int.test.ts holds five screens in src/server/admin-statements.baseline.json: the store shell, the store Home, the orders list, the products list and the platform Home, each with its waves. One log line per admin render gives the production figure. The other statement budgets of this phase use the same counter. It holds the server's measure 5.

- **Closes:** [AD-12](../findings/admin-server/AD-12.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database.
- **Done when:** pnpm test:int runs admin-statements.int.test.ts with five screens in its baseline, and it fails when a scratch change adds one statement to the store shell.
- **Platform:** The platform Home is one of the five screens.

## 1.10 Count the statements and rows of scheduled work and of a cold frame

The scheduler sends about 170,000 idle statements a day and nothing holds it. src/server/query-budget.int.test.ts, on the counter of step 1.9, holds the idle dispatcher tick, each minute route, the daily route's functions and the cold frame, with 1 and with 20 seeded stores of 30 pages and 200 products each. It also records rows read (seq_tup_read plus idx_tup_fetch over commerce's tables), so a read that grows with other stores' rows fails. The counts live in src/server/ratchet.baseline.json and only fall. It holds the database's measures 1, 3 and 5 and the scheduled area's measures 2 and 3.

- **Closes:** [DQ-11](../findings/queries/DQ-11.md), GAP-database-2
- **Effort:** M. **Areas it moves:** The database; Scheduled work; What the server loads and asks.
- **Done when:** pnpm test:int runs query-budget.int.test.ts with its counts in src/server/ratchet.baseline.json, and it fails when a scratch change writes 'store_id is not distinct from' back into listPublishedPages or adds a per-store statement to a daily prune.
- **Platform:** The idle tick that is counted includes the platform's own jobs, and one of the cold frames is Kaizena Flow's.

## 1.11 Hold the storefront's server side: statements per page, cached reads and render modes

The browser's side has budgets; the server's has none that can see these costs. scripts/server-budget.mjs in CI's e2e job counts statements for the home, a product, All products, a category, search, and home with a cart cookie (first budgets are today's numbers plus 2). It counts a cold home and product page of a seeded 500-product store too, so a read that grows with the catalogue shows as a number. src/server/use-cache.scan.test.ts lists every cached read's life and tags. scripts/render-modes.mjs holds compute mode and holes per route in scripts/render-modes.baseline.json, and checks that every prerendered public page has its title in the head of its static file. So one cookies() read in a shared part cannot move every store page to per-request unseen. It holds the server's measures 3, 4 and 7.

- **Closes:** [SD-13](../findings/storefront-server/SD-13.md), [CA-16](../findings/caching/CA-16.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks.
- **Done when:** node scripts/render-modes.mjs passes on CI's build and fails, naming /s/demo/no, on a trial cookies() read in the store's footer; scripts/server-budget.mjs holds eight pages; and use-cache.scan.test.ts fails for a new cached read with no tag.
- **Platform:** The house store's home is in the render-mode and statement baselines (seeded in step 0.3), so Kaizena Flow's front page cannot leave the static shell unseen.

## 1.12 Count a shop-only store's journey, and what one placed order writes

No test walks a store that uses the shop alone, and nobody has measured what one order writes. An int test on the counter of step 1.9 walks a store with features ['shop'] from home through a listing, a product and the cart to checkout, and fails when a statement names a table of a switched-off feature. Today's known reads (the product page's and the page frame's) start on a named list that steps 2.13 and 2.18 empty. The same test keeps what one guest order of three lines and one counted visit write: statements, and rows inserted and updated, which may only fall. The per-trigger times of the orders insert go into docs/performance.md once. It holds the surface's measures 1 and 2 and the database's measure 7.

- **Closes:** GAP-surface-1, GAP-database-3
- **Effort:** M. **Areas it moves:** The product's surface; The database; What the server loads and asks.
- **Done when:** The shop-only journey case passes in pnpm test:int with its list of exceptions named, and a scratch trigger on commerce.orders that writes a row fails the write budget.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow's store sells plans, not goods, so it has no cart journey; its pages' statements are held in step 1.11.

## 1.13 Flag in production what a test cannot see in the database

Platform, Usage and limits shows the day's difference in the reading of step 0.2, and raises five flags. One: a newcomer among the 25 top statements. Two: a commerce table over 1,000 rows read whole more than 10 times a day. Three: a write that changed a row in under 1 of 10 calls. Four: the cron schema over 80 MB. Five, from eight weeks after opening: an index on a hot table that no scan has used and that backs no constraint. A flag is also a line in the platform's morning briefing. It holds, as production figures, the database's measures 1, 2, 4, 6 and 7 and the scheduled area's measures 5 and 8.

- **Closes:** GAP-database-1
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** Platform, Usage and limits lists flags from two stored days, and an int test scans a seeded 2,000-row table 20 times and sees its flag.
- **Platform:** The flags are shown in /admin/platform, and they count Kaizena Flow's store and its null-store rows with every other.

## 1.14 Hold time on a slow phone with a nightly production figure

No figure of time is measured or held, and no finding covers it. measure-routes.mjs gains a run with the CPU slowed four times that records blocking time and the script bytes run by idle for the home, a product page, a listing and the cart; the run bytes, which are steady, get a budget in e2e/performance.spec.ts within 5%. A nightly workflow beside live-a11y.yml runs scripts/perf.mjs --form=mobile --min=90 against a launch-theme demo store in production and Kaizena Flow's front page, keeps largest paint, blocking time and layout shift in a file, and fails on two nights in a row under the line. Kaizena Flow's own demo stores switch visit counting on, so one field figure exists against the 'good' lines of src/lib/speed.ts. It holds the shopper's browser measure 7.

- **Closes:** GAP-shopper-browser-3
- **Effort:** M. **Areas it moves:** What a shopper's browser gets.
- **Done when:** The nightly job has run green for a week (performance 90 or more and blocking time at most 200 ms, the median of three runs) with its table in docs/performance.md, and e2e/performance.spec.ts holds the script bytes run by idle on four pages.
- **Platform:** Kaizena Flow's front page is one of the two pages measured each night.

## 1.15 Hold the admin's speed with a line in the morning briefing

The one production figure for the admin, its own speed beacon, read 3.93 s LCP at p75 on 31 October, before any cut; nothing warns when it is not good. The platform's morning briefing gets a line when the admin's LCP or INP at p75 over 28 days is not 'good' (2.5 s, 200 ms) for a kind of screen with 100 loads or more. The beacon tells the page builder from the product editor. Read the table a month after phase 0 and write it into docs/performance.md beside the October figures. It holds the owner's browser measure 8.

- **Closes:** GAP-owner-browser-3
- **Effort:** S. **Areas it moves:** What an owner's browser gets.
- **Done when:** A unit test of the briefing (src/lib/platform-briefing.ts) shows the line for a seeded slow kind of screen and none for a good one, and the beacon's rows name the builder and the product editor apart.
- **Platform:** The line is in the platform's own briefing, and /admin/platform's screens are kinds of screen like a store's.

## 1.16 Show cold starts as a production figure

No production figure exists for a cold start. Each instance logs one instance.start line through log(): the kind of entry, milliseconds to the end of register() and to the first answer, and resident memory; no request data. Platform, Usage and limits shows cold starts a day with p50 and p95 by kind, against a target: a beacon within 150 ms of the health check. The same line times Next's 'load route manifests' step, which decides step 2.24, the second half of this gap. It holds the server's measure 2.

- **Closes:** GAP-server-3
- **Effort:** M. **Areas it moves:** What the server loads and asks.
- **Done when:** Platform, Usage and limits shows a week of cold-start figures by kind of entry (cold starts a day, p50 and p95), with the time of the manifest's load among them, and a unit test of the instance.start line shows that it carries no request data.
- **Platform:** The figure lives in /admin/platform, and the platform admin's and Kaizena Flow's own entries are kinds of their own.

## 1.17 Hold unused code, copies and the admin's repeats with ratchets of exact lists

Lint sees unused locals only, and no test counts copies, twins, public files or route handlers nothing calls. src/server/unused.scan.test.ts, with scripts/unused.mjs to print and lower its lists, holds today's unused and test-only exports, so they can only shrink, and adds two cases: every file under public/ and every route.ts under src/app/api is referenced, or listed with its reason. One copy counter and one twin counter (scripts/lib/copy-count.mjs) run against src/lib/copies.baseline.json: 4,098 exact copied lines across files, 705 inside files, 41 twin pairs, each kept pair with a reason. src/server/ratchet.baseline.json gains the admin's repeat counts: action files off the shared wrapper (232), tables 154, native selects 436, files with Europe/Oslo 67, files with confirm( 42. It holds the code area's measures 1 to 4, 6 and 8.

- **Closes:** [DD-4](../findings/unused-code/DD-4.md), GAP-code-2, [CP-14](../findings/copied-code/CP-14.md), [FM-13](../findings/families/FM-13.md), [FM-7](../findings/families/FM-7.md), [FM-8](../findings/families/FM-8.md), GAP-code-3
- **Effort:** M. **Areas it moves:** The code itself.
- **Done when:** pnpm test fails on each planted case: export const NEVER_USED = 1 in a file under src/lib, public/unused.png, an empty src/app/api/never/route.ts, and a 30-line block pasted into another file or twice inside one.
- **Platform:** The platform's twins (its second engines and the modules of its 19 platform_* tables) are in the twin baseline with their reason until step 3.10 folds them.

## 1.18 Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows

One of 14 surface counts has a budget, and orders went from 24 to 34 indexes unseen. src/lib/surface-budget.scan.test.ts with src/lib/surface-budget.baseline.json holds dispatcher jobs, every-minute routes, pages, navigation links per section, AI tools, tables, platform_* tables and the rest. The same file carries index and trigger counts for the eight hot tables (orders 32 and 27 after step 0.26) and the rows the database writes for a new store (8 today, counted by a case in src/db/commerce.test.ts). A count rises only with --raise and a decision row that carries an 'Idle cost:' line: what the feature costs a store that does not use it. One paragraph in docs/store-features.md says switches are for what an owner sees, not for cost. It holds the surface's measures 3 and 4 and the database's measure 7.

- **Closes:** [FT-2](../findings/features/FT-2.md), [DS-12](../findings/database-shape/DS-12.md), GAP-surface-3
- **Effort:** S. **Areas it moves:** The product's surface; The database.
- **Done when:** pnpm test src/lib/surface-budget.scan.test.ts passes with 14 counts and the hot tables' counts in its baseline, and fails when a scratch migration adds a trigger on commerce.orders or one more job joins the dispatcher's list without --raise.
- **Platform:** The 19 platform_* tables and the platform's pages and jobs are counts of their own, so a new platform twin must state its idle cost too.
- **The owner's question first:** May a test refuse a new table, trigger, scheduled job, navigation link or AI tool until its decision row states what it costs a store that does not use it?

## 1.19 Hold every agent's round, show real tokens per call, and let the eval see whether the model finds a tool

The only AI budget is a tool count set at the provider's cap. src/server/ai-round.scan.test.ts with src/server/ai-round.baseline.json draws the AI manager's default round (161,661 characters today) with no page and on the largest page of each of the nine working areas, for a shop-only store and for one with every feature on. It draws the seven fixed prompts with their tool sets too: the shopper chat with and without support, the docs guide, the Dream Factory's steps and the autopilot's events. A log line per round and Platform, AI show input, cached and output tokens per call by feature, median and 90th percentile. Add at least 8 lean eval cases (six that need a tool outside the core 12, two that must load nothing), commit a first recording as the 'before', and try reasoning_effort 'low' on the two tool loops in one eval run. It holds the AI area's measures 1, 2 and 8.

- **Closes:** [AI-10](../findings/ai-calls/AI-10.md), [AI-14](../findings/ai-calls/AI-14.md), GAP-ai-3
- **Effort:** M. **Areas it moves:** AI calls.
- **Done when:** ai-round.scan.test.ts fails when 2,000 characters are added to list_orders' description or 500 to the shopper chat's prompt, src/data/agent-eval-recording.json holds at least 8 lean cases and agent-eval-replay.int.test.ts passes on it, and Platform, AI shows output tokens per call.
- **Platform:** The platform's assistant and its 39 tools are a line in the baseline, and the panel is Platform, AI.

## 1.20 Record every check's seconds and the build's peak memory, with ceilings

Not one number of the checks is held, while the production build peaks at about 7.2 GB of 8. scripts/timed.mjs wraps lint, the type check, the unit run, each integration shard, each Playwright run and each build, with ceilings in scripts/ci-budgets.json (25% above the median of the last ten runs; the slowest job a release waits for at 8 minutes). A check fails when a CI step runs outside the recorder. scripts/next-build.mjs prints seconds and peak memory after every build, Vercel's included; scripts/await-deploy.mjs writes the seconds from push to live, and Playwright's JSON reporter gives the tests that passed only on a retry. Turn source maps off in the Vercel build's page worker if a capped build shows it pays (about 4.7 MB of heap per MB of server code), and write both peaks into docs/build-memory.md. pnpm check runs the pre-push rule through the recorder. It holds the build's measures 4, 6 and 7.

- **Closes:** [TC-8](../findings/tests-ci-build/TC-8.md), [AS-10](../findings/files/AS-10.md), GAP-build-1
- **Effort:** M. **Areas it moves:** Tests, CI and the build; The code itself.
- **Done when:** Every CI run's summary lists seconds for lint, the type check, the unit run, each shard, each browser job and the build, the build's peak memory, the seconds from push to live and the retried tests; a run fails above a ceiling in scripts/ci-budgets.json; and docs/build-memory.md has a row for each source-map setting.
- **Platform:** One CI and one build serve stores and platform.

## 1.21 Give the production build room, and fail a run before it runs out

The build has 0.8 GB of room on Vercel's 8 GB machine and was killed once on 11 November, and nothing in this plan is measured to give it a quarter of the machine. Either pay for the 16 GB build machine, with the build cache and the workers back on, or run vercel build in CI and vercel deploy --prebuilt, which makes the deployed build the checked one. Either way scripts/next-build.mjs prints the peak, and a run goes red with the number when the peak passes 75% of the machine. It holds the build's measure 5.

- **Closes:** GAP-build-2
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** Ten production builds in a row peak at 75% of their machine or less in the recorder of step 1.20, a trial build above the line turns its run red, and code review step 1.8 is Done.
- **Platform:** One build makes the platform admin and Kaizena Flow's site with the stores.
- **The owner's question first:** Pay for Vercel's 16 GB build machine, or build in CI and deploy the prebuilt output? Without one of the two the build area stops at a B.

## 1.22 Watch the scheduler from outside, and run the daily job once

The daily job is scheduled twice at the same minute, by pg_cron and by Vercel's cron, so 40 functions can run twice at once. And the scheduler is watched only from inside itself: if pg_cron stops, nothing runs and nothing says so. Point Vercel's one cron (vercel.json) at a small new route that reads the ledger rows of the dispatcher, and of the tick once step 3.1 makes it, and emails the admins when one is over 15 minutes old. pg_cron's own SQL jobs, the log prune of step 0.25 among them, get a ledger row: a job of the daily list reads cron.job_run_details and fails when one's last run failed or the oldest row is over 8 days old. It holds the scheduled area's measure 6.

- **Closes:** [CR-12](../findings/scheduled-work/CR-12.md), GAP-scheduled-2
- **Effort:** S. **Areas it moves:** Scheduled work.
- **Done when:** vercel.json schedules only the watcher, commerce.cron_jobs.runs for route.subscription-reminders rises by exactly 1 a day, and stopping pg_cron on a test database sends the email within the hour.
- **Platform:** One scheduler runs the platform's jobs with the stores', and the email goes to the platform's admins.

## 1.23 Count what is in the stylesheet, and read the style text owners write

Nothing counts whose classes the sheet holds, or the style text owners add to every document, so two open decisions have no trigger. docs/audits/bloat-review-2026-11/scripts/stylesheet-audiences.mjs reads the built sheet and prints the bytes each audience alone names: the admin's share is 51.8 KB raw today. The tolerance goes into docs/performance.md: at most 15 KB raw of classes no store page can draw once step 2.11 has split the sheet; a third entry is weighed only above it. A line on Platform, Usage and limits reports per store the bytes of its layout-level style sheets and the share of published pages that need motion.css. Two trigger lines go with it. Above 10 KB for the median store: look again at an external sheet. Under half of pages needing motion.css: build CS-2. Read it before opening and each quarter. It holds the styles' measures 1, 2 and 8.

- **Closes:** GAP-styles-2, GAP-styles-3
- **Effort:** S. **Areas it moves:** Styles.
- **Done when:** docs/performance.md holds the audiences figure and the first style-text reading of the team's 60 stores with the two trigger lines, and the script runs on CI's build.
- **Platform:** Kaizena Flow's own store is a row in the reading, and its site's pages are one of the audiences counted.

## 1.24 Measure what a session really loads, and hold source file size

Every figure for the written rules is a file size or an estimate at four characters a token. scripts/session-load.mjs reads session transcripts and prints what a session loaded and read: the always-loaded files, each rule or doc read with its bytes, and every '[Omitted long matching line]'. Sample 20 working sessions from before phase 0 and 20 after. If the sample shows whole rule files being read, the plan gets a step that splits the seven rule files by section. Two counts join the code ratchet and only fall: source files over 100 KB (15) and over 2,000 lines (11). It holds the rules area's measure 8.

- **Closes:** GAP-rules-3
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** node scripts/session-load.mjs over 20 sessions prints the median bytes of rules and docs read per code change, before and after phase 0, into docs/audits/bloat-review-2026-11, and src/server/ratchet.baseline.json holds the two file-size counts.
- **Platform:** Sessions that work on the platform are in the sample with the rest.
