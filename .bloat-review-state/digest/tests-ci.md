# tests-ci: Tests, CI and the build

The tests are not the bloat: 325,579 lines of tests against 768,202 of source, no snapshots, and the browser suite does not repeat the unit tests (37 of 781 end-to-end tests use no page). The waste is in how the checks run, and it is paid per push whoever uses the platform: one push type-checks the same commit five times (183 s each here, 70% of the build) and builds it four times; every unit test file first loads 1.9 MB of admin English in a fresh worker (a 187-file sample takes 90 s today and 27 s without both); lint re-reads about 6,200 files on one thread (about 3 minutes, 1 s with a cache); and 229 server modules form one import cycle that 12 import lines close. Four small changes (TC-1, TC-3, TC-5, TC-12) remove about 9 runner-minutes of repeated type checks, about a quarter of the unit run and about 3 minutes of lint per push without checking any less. Before opening is the cheap time for the two with risk: cutting the cycle (TC-2) and changing the rule for what runs before a push (TC-6, the owner's call).

## Measures
- Test code against source: 325,579 lines in 1,771 test files (1,215 unit incl. 46 scans: 188,474 lines; 556 integration: 137,105 lines) against 768,202 lines in 4,139 source files: 0.42 to 1.
- Playwright: 223 spec files, 781 test() calls (573 top-level, 208 signed-in). 742 take a browser page; 37 use only HTTP requests. The hosts job runs 4 files with 25 tests.
- Production build on this 4-CPU machine: 263 s wall, exit 0; TypeScript 182.9 s (70%), Turbopack 36.5 s, 1,426 pages prerendered in 28.9 s. Whole-machine memory peaked at 7.61 GB from 0.80 GB.
- CI work per push to main (no migration): 9 runners; 8 pnpm installs; 6 database seeds; 3 db:check; 2 lints; 5 full type checks (static, the gate, and inside the e2e, hosts and signed-in builds); 3 builds (4 with Vercel's); the unit suite once plus 6 smoke files. With a migration the gate is skipped:…
- CI runs per day: About 35 a day (46 runs in 31 hours by run numbers). 75 of the last 92 commits with files run CI; 17 are docs-only; 18 carry a migration; 6 change only test files.
- Unit run, per-file cost under Vitest (my sample): 187 of the 934 unit files outside src/components and src/db, one niced worker, warm cache: 90.2-91.3 s as configured today (0.48 s a file, setup 40-41%); 66.0 s without admin-english.ts (0.35 s a file); 25.3-27.0 s also with isolate: false (0.14 s a file); al…
- Unit run, the other two groups (my samples): 22 component test files: 16.3 s warm (0.74 s a file), 24.0 s with a cold transform cache. 8 database test files (three of the five largest among them): 24.0 s (3.0 s a file). src/db/commerce.test.ts alone (8,166 lines, 324 tests): 9.7 s, so no single file set…
- The proposed three-project Vitest layout, tried: 64 files (41 unit, 22 component, 1 database) through one config with projects components / db / unit (unit without the English and without isolation): 21.3 s warm, twice, against 33.2-34.0 s for the same files as configured today. All 643 tests pass.
- Written wall times: Unit run 5 min 34 s in an agent sandbox (was 7 min 35 s); the gate's lint, type check and smoke tests 5 min 11 s on CI run 1160; the integration suite passed 30 minutes before it was cut in 3 shards.
- Lint (my sample): 6,213 lintable files (5,910 in src, 236 in e2e, 37 in scripts). Every fifth file of src, e2e and scripts (1,235 files), one thread: 36.4 s and 40.5 s, so about 3 minutes for the whole tree (estimate). With --concurrency auto: 26.5 s and 32.1 s. With --cache -…
- Importing the database client in a test file (my probe): 20 one-test files per variant, one niced worker: empty test 1.9-2.1 s; importing @/db/client 11.3-11.9 s (0.48 s a file over empty); the same packages without the schema 8.2-8.6 s (0.32 s); with drizzle-orm pre-bundled by Vitest's optimizer and no schema 3.4-…
- Who loads the database client: 525 of 556 integration files and 25 of 1,215 unit files reach src/db/client.ts; 551 integration and 29 unit files reach drizzle-orm. client.ts reaches 49 modules (1.49 MB) today and 2 (18 KB) without its schema import.
- The import cycle: One strongly connected component of 229 modules, all in src/server, 5.17 MB; catalog.ts, cart.ts, customers.ts, visibility.ts and checkout.ts each reach 1,305 modules (20.4 MB); 637 of 852 page, route and layout files reach it. With the 12 named edges cut: la…
- What the type check holds: 8,003 files: 4,145 src, 1,221 unit tests, 556 integration tests, 232 e2e, 1,825 from node_modules. Tests and e2e are 39% of the syntax trees of the project's own files (579 of 1,480 MB) and 24% of the whole program by characters. Probes: empty file 121 MB; sc…
- Unit-test setup file: src/test/admin-english.ts loads 93 source modules, 1.90 MB, for 54 areas, before each of 1,215 files. 114 unit files can reach admin-text.tsx, all under src/components. The other setup file is needed by 43 unit tests, 12 of them outside src/components.
- Unit tests' database template: Built in 5.9 s (3.0 s of it the four baseline migration files), 860 MB RSS, 12.6 MB kept. Vitest always runs the root project's global setup, so the gate's six smoke files build it too.
- Vitest's transform, cold against warm: About 5 ms a module under Vitest: 22 component files 24.0 s cold and 16.3 s warm (1,521 modules); 41 unit files 10.9 s and 8.4 s (394 modules). All unit tests reach 3,461 modules, so about 17 to 22 s of a cold unit run (estimate); the integration tests reach …
- Source-scanning tests: 46 files named *.scan.test.ts (3,813 lines); 84-86 unit test files read directories; 67 carry a private walker; about 43 walk all of src. Two parse all 4,139 source files with TypeScript, 4.5 s a pass; a text test first would leave 475 and 78 files.
- Repeated mocks: vi.mock("server-only") in 579 test files, 448 of them integration files where the config already aliases it; vi.mock("next/cache") in 465 integration files (318 share one line, 40 are multi-line); makeStore defined in 52 test files, paidOrder in 30.
- Build output: About 3.9 GB: 2.6 GB Turbopack cache, 1.3 GB server output (672 MB in 6,008 source maps), 24 MB static. 18 server chunks of 4,175,868 bytes are identical but for their source-map name.

## Well made
- Nothing in this dimension argues from 'no store uses it'. Every finding is a cost per push, per build or per test run, so the owner's clarification changes no verdict here. CI cost follows commits, not shoppers; what grows at opening is the price of a late or…
- Test volume is healthy: tests are 30% of src lines; no __snapshots__ folder, no .snap file, no toMatchSnapshot or toHaveScreenshot; the largest fixture is 39 KB and the agent-eval recording 20 KB.
- The end-to-end suite does not repeat the unit tests: 742 of 781 tests drive a browser page and only 37 are plain HTTP calls (my count), most of them checks that a route refuses a visitor without a session.
- No single test file sets the floor of the unit run: the largest, src/db/commerce.test.ts (8,166 lines, 324 tests), runs alone in 9.7 s (timed here).
- A unit run prints 9 lines when it passes (timed sample, output counted), so the test count does not flood an agent's context.
- The unit tests' database is well made: 4 baseline files, a template named by a hash of the migration files, built in 5.9 s (timed here), a copy per test file in 1.1-1.5 s. Caching it in CI would save seconds.
- Very little tests dead code: about a dozen source files are imported only by tests. The six *.test.ts files under docs/ are page generators with their own config (docs/site-pages/vitest.config.mts), run by hand; they are not dead tests.
- A docs-only push runs nothing (ci.yml:10-14) and the content/** exception is deliberate; a run on main is never cancelled (ci.yml:27-32); the audit job needs no install.
- The typing patterns the brief suspected are not what makes the type check heavy: schema.ts and its imports 573 MB, every admin catalogue 537 MB, page-content 358 MB, against about 5 GB for the whole program. The catalogues are plain object literals. The check…
- ESLint runs no type-aware rule and its import plugin has one single-file rule (eslint-config-next/dist/index.js:172), so lint builds no type program and a per-file cache is safe.
- Browser budgets exist and run in CI: first scripts and page weight per route in e2e/performance.spec.ts:21-58.
- Lazy imports in server code are an established pattern: 58 await import() calls in 30 files of src/server (rg), so cutting the cycle that way introduces nothing new.
- Only one test pins CI's configuration (src/lib/ci-playwright.scan.test.ts: image tags and the list of browser jobs). No test pins the build's type check, the Vitest setup files, the lint script or the schema argument, so the fixes below fight no existing chec…
- src/lib is nearly a clean layer already: 1 of its 1,146 files has a run-time import out of lib and 10 import a type from server, components, app or db.

## Findings (14)

### TC-1 [P0 S duplicate confirmed] One push type-checks the same commit five times; three of the checks hide inside CI's builds
- evidence: next.config.ts:46 skips the build's type check only on Vercel, so `pnpm build` in the e2e, hosts and signed-in jobs (ci.yml:152, 206, 249) each runs it. In this machine's build the TypeScript step took 182.9 s of 262.0 s (build.log: 'Finished TypeScript in 3.0min'). Next's doc says the build checks the complete project of the tsconfig, test files included, and that typescript.ignoreBuildErrors skips the step. The st…
- cost: About 9 runner-minutes of repeated type check per push in the three build jobs (3 x 183 s measured here; GitHub's runners differ), each under a 7 GB heap limit, and about 3 more where static and the gate both check. At … (CI on every code push; the owner waits longer for a release with a migration)
- fix: 5 steps; first: 1. next.config.ts:39-46: beside ON_VERCEL add `const SKIP_TYPECHECK = ON_VERCEL || process.env.SKIP_BUILD_TYPECHECK === "1";` and set `typescript: { ignoreBuildErrors: SKIP_TYPECHECK }`. Rewrite the comment at lines 44-45: the type check is the static job's a…
- done when: On the next push to main without a migration, the `pnpm build` logs of the e2e, hosts and signed-in jobs contain no 'Running TypeScript' line, the run shows `tsc` in two jobs only (static and pending), and 'Migrations match the schema' ran in one integration shard.
- saving: Steps 1-3: about 9 runner-minutes per push and about 3 minutes off the wall time of each browser job (from the 183 s measured here), so a release with a migration is about 3 minutes sooner. Step 5: one more type check (about 3 minutes) and one lint per push.
- after: nothing
- tracked: Partly. Code review FH10, step 1.8 (Open) tracks the three cold builds. The type check inside them and the doubled lint, type check and db:check are not tracke…
- notes: Do steps 1 to 4 first, alone: three lines of YAML and one of TypeScript. Leave step 5 until TC-12 and TC-4 have made lint and the gate's check cheap; it then removes the last duplicate.

### TC-2 [P1 M eager corrected] 229 server modules import each other in one cycle; 12 import lines close it
- evidence: I rebuilt the run-time import graph of src (each of 5,909 files transformed with esbuild, so type-only and unused imports are gone) and ran Tarjan: one strongly connected component of 229 modules, all in src/server, 5.17 MB. catalog.ts, cart.ts, customers.ts, visibility.ts and checkout.ts each reach 1,305 modules (20.4 MB of source); 637 of 852 page, route and layout files reach the cycle. With the 12 import lines a…
- cost: Server: a function that imports any core server module evaluates the cluster, 0.81-0.84 s and +180 MB as one plain bundle, paid per cold start; the server dimension sizes this, and it grows with traffic and with the num… (The server per cold start; CI and agent sessions for 67 test files; whoever nex…)
- fix: 6 steps; first: 1. Put the measure in first. Add `importGraph(root)` to scripts/lib/ratchet-count.mjs: walk src, leave out *.test.ts(x), read each file's `import ... from` / `export ... from` / bare `import "x"` lines with a regex, skip `import type`, `export type` and claus…
- done when: src/server/ratchet.baseline.json holds largestCycle 20 or less and catalogReach 417 or less (229 and 1,305 today), and src/server/ratchet.scan.test.ts passes.
- saving: Static, reproduced by me: largest cycle 229 -> 20 modules; a route that reaches catalog.ts loads 417 modules, not 1,305. Cold start: roughly a half to two thirds of 0.8 s for routes in the cluster (estimate, not measured in a build). Tests: tens of seconds pe…
- after: nothing
- tracked: Partly. Code review FV4/FH6 step 3.13 (Domain folders, Open) and FH7 step 4.1 (lint for boundaries, Open) name the missing boundaries. Neither measures or cuts…
- notes: Confidence is high on the measurement and medium on the saving. Step 1 alone is worth doing at once (S): it costs 0.2 s per unit run and stops the cycle from growing while the cuts wait. The cold-start gain belongs to the server dimension's finding on the sam…

### TC-3 [P0 S eager corrected] Every unit test file loads all the admin's English first, in a worker of its own; 91% cannot use the English
- evidence: vitest.config.mts:15 lists src/test/admin-english.ts as a setup file; Vitest 5.0.5 runs setup files before each test file, in a fresh worker per file (isolate defaults to true, pool to forks: its type file, lines 3622-3655). The file awaits all 54 areas of LATER_AREAS: 93 source modules, 1.90 MB. Only 114 of 1,215 unit files can reach admin-text.tsx, all under src/components (verified report). Measured here under Vi…
- cost: About 130 CPU-seconds per unit run for English that 1,001 files cannot use, and about 195 CPU-seconds for a fresh worker in each of the 934 plain unit files (both extrapolated from the 187-file sample): together about 8… (CI's static job and every agent session that runs pnpm test before a push; the …)
- fix: 5 steps; first: 1. vitest.config.mts: keep `resolve.alias` at the root and move everything else into `test.projects`, three inline projects with `extends: true`. `components`: include src/components/**/*.test.ts, setupFiles [src/test/eager-lazy-views.ts, src/test/admin-engli…
- done when: `pnpm test` passes with the same 'Test Files' and 'Tests' totals as before, Vitest's duration line for the full run shows setup under 10% (40% on today's sample), and the full run timed on one machine before and after is at least 15% shorter.
- saving: Measured on a 187-file sample, one worker: 90 s -> 66 s without the English -> 27 s without a fresh worker per file. Extrapolated (estimate): step 1 about 130 CPU-seconds, about 32 s of the 5 min 34 s run on 4 workers; step 3 about 195 CPU-seconds more, about…
- after: nothing
- notes: The verified report gave a floor of about 110 CPU-seconds from a bundle and left isolation as an untimed trial. Both are now timed under Vitest itself. Component tests (0.74 s a file on a 22-file sample) and database tests (3.0 s a file on 8) keep isolation a…

### TC-4 [P1 M oversize corrected] The type check is one 8,003-file program: 3 minutes and a 7 GB heap limit, with no single type to blame
- evidence: tsconfig.json includes **/*.ts and excludes only node_modules, so tests, e2e, docs and scripts are in the one program: 8,003 files, of which 1,221 unit tests, 556 integration tests and 232 e2e files (verified report, from .next/cache/.tsbuildinfo). The verified probes: an empty file needs 121 MB; schema.ts and its imports 573 MB; every admin catalogue 537 MB; page-content.ts 358 MB; one admin component, product-edit…
- cost: 182.9 s here and a 7,168 MB heap limit each time it runs: 5 times per push in CI today (TC-1), once before every push in each agent session, and about 3 of the gate's 5 min 11 s before each deploy. Vercel's 8 GB machine… (CI, every agent session, the owner in minutes before each deploy and in the ris…)
- fix: 6 steps; first: 1. Measure where check time goes, once: on a machine with 8 GB free run `pnpm exec next typegen && pnpm exec tsc --noEmit --incremental false --generateTrace <a folder outside the repo>` and list the 20 slowest files from the trace. Put the list in the decisi…
- done when: `pnpm exec tsc -p tsconfig.app.json --listFilesOnly | rg -c '\.test\.tsx?$|/e2e/'` prints nothing, and the gate's type-check seconds in CI's summary are at least 20% below static's full check on the same run.
- saving: Step 2: the gate's check holds 39% fewer syntax trees of the project's own files and 24% fewer characters in all; check time was not measured, so expect a fifth to a third off about 3 minutes before each deploy (estimate). Step 3: unmeasured here; the vendor'…
- after: TC-1; TC-8 (the recorder, for steps 3 and 4)
- tracked: No. FH10 step 1.8 (Open) gives the build room or builds in CI; nothing addresses the size of the check itself.
- notes: Steps 1 and 2 are small (S) and can ship right after TC-1. The brief's suspects (as const catalogues, the Drizzle schema's inferred types, zod over page-content) were measured by the auditor and the skeptic and are each about a tenth of the program: rewriting…

### TC-5 [P0 S dead corrected] The 19,614-line Drizzle schema is loaded at run time for a query builder nobody calls
- evidence: client.ts imports * from ./schema and passes it to drizzle() (line 78) and to the type NodePgDatabase<typeof schema> (line 31). Outside tests nothing calls the query builder: my rg for .select(, .insert(, .update(, .delete( and .query on db(), replicaDb(), tx or database finds only PGlite fixtures in src/db that call their own tx.query; drizzle-orm is imported 638 times for the sql tag. The only run-time importers o…
- cost: About 125 ms and 50 MB in every process that opens the database (plain Node). In tests, 0.16 s per file under Vitest: 525 integration files and 25 unit files load it, so about 84 s of the serial integration run, about 2… (The server per cold start; CI's integration shards and agents running integrati…)
- fix: 5 steps; first: 1. src/db/client.ts: delete line 11 (`import * as schema from "./schema"`); line 31 becomes `type Database = NodePgDatabase;`; line 78 becomes `drizzle({ client: pool })`. Nothing else in the file changes.
- done when: `rg -c schema src/db/client.ts` prints nothing, `pnpm db:check` passes, and the import graph of TC-2 (or scratch graph.mjs) shows src/db/client.ts reaching 2 modules instead of 49.
- saving: Server: about 125 ms and 50 MB per cold start (plain Node, not measured on Vercel). Tests: 0.16 s per file that opens the database, measured under Vitest: about 84 s of the integration run across its three shards and about 4 CPU-seconds of the unit run.
- after: nothing
- tracked: Yes. Code review FD5, step 3.14 'Split schema.ts' (Open). New here: the measured cost, and that the first half can ship alone as an S ahead of the M split.
- notes: Three lines. Do it before TC-13, which removes most of what is left of the client's import time in tests.

### TC-6 [P1 S process corrected OWNER-CHOICE] Every push pays the full checks twice: once by the agent, again by CI
- evidence: CLAUDE.md:12 asks for lint, the type check and the tests before every push. Written and measured times: the unit run 5 min 34 s in a sandbox; the type check 183 s in this machine's build; lint about 3 minutes by my one-in-five sample (TC-12). The gate before the deploy runs lint, the type check and 6 smoke files (package.json:12); the full unit suite runs beside the deploy and does not hold it. There is no script fo…
- cost: About 11 to 12 minutes of machine time and about 5 GB of memory before each push today (lint about 3, type check about 3, unit run 5 min 34 s), then lint and the type check twice more in CI. This is a deliberate safety … (Every agent session, and the owner in elapsed time per change)
- fix: 4 steps; first: 1. No decision needed for the cheap half: do TC-1, TC-3, TC-12 and TC-5 first. They cut the cost of the present rule (lint to seconds after a session's first run, the unit run by about a quarter) without changing what is checked.
- done when: The owner's choice is a decision row and CLAUDE.md:12 states it; `pnpm test:changed` exists and, after a one-line change to a file in src/lib, its two 'Test Files' lines add up to fewer than 250 files (1,215 in a full run).
- saving: With B or C: a related run is typically 85 to 200 test files in place of 1,215, about 4 minutes of machine time per push per session (estimate from the written 5 min 34 s and the measured selection). B also ends the second full unit run. With A: only what TC-…
- after: TC-1; TC-3; TC-12
- tracked: Partly. Step 0.2 (In progress) built the gate; widening it and the local rule are not tracked.
- notes: A process choice for the owner, not waste. My recommendation is B after TC-3: the deploy then waits about 4 more minutes, and what deploys has passed every unit test. If the wait matters more, C.

### TC-7 [P2 M duplicate confirmed] Three cold builds per push; the hosts job builds the whole app for 25 tests
- evidence: e2e, hosts and signed-in each install, seed and run `pnpm build` (ci.yml:149-152, 203-206, 246-249). The hosts job then runs 4 spec files with 25 tests (ci.yml:208). The e2e and signed-in builds differ only in NEXT_PUBLIC_SUPABASE_URL and its key (ci.yml:236-237); E2E_SIGNED_IN is read by playwright.config.ts:9 alone, not by the app. Playwright's config sets no shards and no workers; 573 and 208 tests run in two uns…
- cost: Each extra build is about 80 s once the type check is out (262 s less 183 s here), plus an install of a 939 MB node_modules, a seed and a runner to wait for. Vercel then builds a fourth time, and that build is the only … (CI on every code push)
- fix: 5 steps; first: 1. After TC-1. Try it locally first: build once with the signed-in job's two variables (NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3912 and its key), then run the unsigned projects against that build (`pnpm test:e2e` with the auth stand-in started). List the s…
- done when: A push to main runs `pnpm build` in two CI jobs at most (the done-when of code review step 1.8), and `release` still needs every browser suite.
- saving: One build without its type check (about 80 s here), one install and one seed per push: about 3 to 4 runner-minutes (estimate), and one runner fewer to wait for.
- after: TC-1
- tracked: Yes. Code review FH10, step 1.8, Open: share one build, shard Playwright, CI builds the app twice at most. New here: the 25-test count and the check of what di…
- notes: After TC-1 the remaining prize is small (about 80 s of build and an install). It is worth doing with step 1.8, whose larger half is the owner's choice between the 16 GB build machine and a prebuilt deploy (question 2 of the code review).

### TC-8 [P1 S process corrected] Nothing measures the build, the type check, lint or the test run, and the build is at its limit
- evidence: docs/build-memory.md says the margin on Vercel is about 0.8 GB and was crossed on 11 November while collecting page data with one worker. The build prerendered 850 pages on 27 October and 1,426 here (build.log). This machine's build peaked at 7.61 GB for the whole machine and wrote about 3.9 GB, of which 672 MB is server source maps (verified report). Budgets exist for browser scripts and page weight only (e2e/perfo…
- cost: A deploy that fails at random at the 8 GB edge, and growth nobody sees until it does: each new route and each new import adds to it. Today a killed deploy costs a retry; once stores are open it delays a fix that owners … (The build, and the owner when a deploy is killed)
- fix: 6 steps; first: 1. scripts/next-build.mjs: after `next build` returns, print one line with the wall seconds and the peak memory. Read the peak from /sys/fs/cgroup/memory.peak where it exists; where it does not, run the build with spawn and sample /proc/meminfo every 2 s, as …
- done when: Every CI run's summary lists seconds for lint, type check, unit run and build and the build's peak memory; a run fails when one passes its ceiling in scripts/ci-budgets.json; and Vercel's build log ends with the peak-memory line.
- saving: No time saved by itself. It turns silent growth into a red run with a number, and gives TC-4, TC-9 and TC-12 their before and after. The source-map switches are unknown until measured; Next's guide only says they can reduce build memory.
- after: nothing
- tracked: Partly. FH10 step 1.8 (Open) and its question 2 cover the 16 GB machine or a prebuilt deploy. Budgets for build, check and test time and the source-map switche…
- notes: Do steps 1 to 3 early: every other finding here has a done-when that reads these numbers.

### TC-9 [P2 S process corrected] CI keeps nothing between runs except pnpm's store
- evidence: Each job's only cache is setup-node's `cache: pnpm`. tsconfig.json sets incremental and .gitignore:40 ignores *.tsbuildinfo, so every type check in CI starts cold. Vitest 5's fsModuleCache defaults to true and writes node_modules/.vitest-cache; CI starts empty. The verified report put the Vitest half at about 3 CPU-seconds, the time esbuild needs for every file. My cold-against-warm samples under Vitest say more: 22…
- cost: Every type check starts from nothing on each of about 35 CI runs a day: 183 s here per check. Vitest's transforms cost roughly 20 s of each cold unit run and less in each integration shard (estimate from the samples). (CI)
- fix: 4 steps; first: 1. After TC-1 and TC-8 (the recorded seconds). In `static` and `pending`, after `pnpm install`, add a cache step for `tsconfig.tsbuildinfo` (and `tsconfig.app.tsbuildinfo` once TC-4 exists) with key `tsbuildinfo-${{ hashFiles('pnpm-lock.yaml', 'tsconfig*.json…
- done when: Over ten runs each, the type-check seconds in CI's summary have a median at least a third lower with a restored tsconfig.tsbuildinfo than without; if not, the cache step is gone and the decision says so.
- saving: Not measured: a full type check was ruled out for this review. An incremental check still parses the whole program and re-checks only changed files and what depends on their public shape, so most of the 183 s should go for a small commit. The Vitest part is a…
- after: TC-1; TC-8
- tracked: No. Step 0.4's note records 'nothing is cached between runs' for the test database only.
- notes: An experiment with a stop rule, not a sure win. If TC-4's native compiler holds, the check may be fast enough cold and this is moot.

### TC-10 [P2 S duplicate corrected] 86 test files read the source tree with 67 private walkers; two parse every file
- evidence: 46 files are named *.scan.test.ts (3,813 lines); 86 unit test files call readdirSync; 67 define a recursive walker of their own and about 43 walk all of src; src/test holds no shared helper (verified report; I read five of the walkers: the same few lines each, with its own file filter). brand.scan.test.ts and theme-words.scan.test.ts share their walker and visitor: each calls ts.createSourceFile on all 4,139 source …
- cost: Small. One walk and read of src is 83-152 ms, so about 7 CPU-seconds for all walks; the two parser scans about 9 CPU-seconds. About 600 lines of repeated walkers. The larger cost is that these rules report only in pnpm … (CI's static job and agents' unit runs; whoever adds the next scan and copies a …)
- fix: 3 steps; first: 1. Two lines now. In `oldNames()` of src/lib/brand.scan.test.ts (after the readFileSync at line 33) and in `oldWords()` of src/lib/theme-words.scan.test.ts (after the readFileSync at line 49), add `if (!OLD.some((re) => re.test(src))) return [];` before ts.cr…
- done when: Both parser scans contain the pre-test (`rg -c 'OLD.some\(\(re\) => re.test\(src\)\)' src/lib/brand.scan.test.ts src/lib/theme-words.scan.test.ts` prints 1 for each), and `rg -l readdirSync src --glob '*.test.ts' | wc -l` is 20 or less (86 today).
- saving: Step 1: about 8 CPU-seconds per unit run, about 2 s of wall time. Step 2: some 600 lines, and most of about 7 CPU-seconds of walks once isolation is off.
- after: TC-3 (for the shared walk to pay)
- tracked: Yes. Code review FH7/FH8, step 4.1, Open.
- notes: Step 1 is two lines and can ride with any change. The rest is not worth a change of its own; it belongs to step 4.1.

### TC-11 [P2 M duplicate confirmed] The same mocks and store-makers are written out in hundreds of test files
- evidence: Recounted with rg: vi.mock("server-only", ...) is in 579 test files, 448 of them integration tests, where the config already aliases server-only to a stub (vitest.integration.config.mts:10). vi.mock("next/cache", ...) is in 465 integration files in at least seven shapes that grew as Next's API grew: 318 share one line, 39, 25, 24 and 15 share four others, 40 are multi-line. vi.mock("next/headers", ...) has 89, 19, 1…
- cost: About 2,800 lines of 325,579, under 1%. No run-time cost worth naming. The real cost is that a change to Next's cache API or to what a store needs means editing hundreds of files. (Agents and reviewers, in edits and in context read)
- fix: 5 steps; first: 1. New test/integration-mocks.ts, listed as `setupFiles` in vitest.integration.config.mts: vi.mock("next/cache") with the widest shape in use (cacheLife, cacheTag, updateTag, revalidateTag, refresh as no-ops); vi.mock("next/headers") with cookies (get, getAll…
- done when: `rg -l 'vi\.mock\("server-only"' src --glob '*.int.test.ts' | wc -l` prints 0 (448 today), `rg -l 'vi\.mock\("next/cache"' src --glob '*.int.test.ts' | wc -l` prints under 60 (465 today), and `pnpm test:int` passes.
- saving: About 2,000 to 2,800 lines, and one place to change when a mocked API changes. No run time.
- after: nothing
- notes: The smallest finding here. Its real use: with the mocks in one setup file, running the integration files without a fresh worker each (as TC-3 does for unit tests) becomes something that can be tried; today 465 files each install their own.

### TC-12 [P0 S eager added] Lint reads all 6,213 files on one thread every time, with no cache: about 3 minutes, and it is on the deploy path
- evidence: package.json:9 is `eslint --max-warnings 0`: no --cache and no --concurrency, though the installed ESLint 9.39.5 has both (its --help; concurrency defaults to off). ESLint walks everything but .next, out, build, next-env.d.ts and .claude (eslint.config.mjs:9-17): 6,213 lintable files by find (5,910 in src, 236 in e2e, 37 in scripts). Timed here on every fifth file of src, e2e and scripts (1,235 files), one thread: 3…
- cost: About 3 minutes of one core per lint (estimate): twice per push in CI (static at ci.yml:55 and the gate at :299, the second before the deploy hook), and once before every push in each agent session (CLAUDE.md:12). At ab… (CI on every push; the owner in minutes before each deploy; every agent session …)
- fix: 4 steps; first: 1. package.json:9: `"lint": "eslint --max-warnings 0 --cache --cache-strategy content --cache-location node_modules/.cache/eslint/"`. That folder is ignored by git and by ESLint already; the unit tests' database template is kept beside it.
- done when: A second `pnpm lint` on an unchanged tree finishes in under 15 s on the machine where the first took minutes, and the gate's lint step takes under 30 s on a CI run that restored the cache (read from the step's time, or TC-8's summary).
- saving: From about 3 minutes to seconds for every lint after the first: on the sample, 1.0 s for 1,235 unchanged files against 36 to 40 s. Per push that is about 2 to 3 minutes off the deploy gate, the same off static, and the same off each agent push after a session…
- after: nothing
- notes: Missed by the report, which called lint 'not measured'. Confidence is high on the sample's times and medium on the whole-tree total, which is the sample times five. One line in package.json gives agents the saving at once; the CI cache step gives it to the ga…

### TC-13 [P1 S eager added] Each test file that opens the database spends half a second importing Drizzle and the schema, one small module at a time
- evidence: Vitest gives each test file a fresh worker (isolate defaults to true; the integration config also runs files one at a time, vitest.integration.config.mts:16) and loads packages from node_modules natively, module by module. A probe in scratch, 20 one-test files per variant, one niced worker, warm cache, two or three runs each: an empty test 1.9-2.1 s; a test importing @/db/client 11.3-11.9 s; the same packages withou…
- cost: 0.48 s per file for the client today, 0.07 s with the schema gone (TC-5) and Drizzle pre-bundled. For 525 integration files that is about 250 s of a serial run, about 85 s of wall time in each of the 3 shards on every p… (CI's integration shards on every push; agents running pnpm test:int)
- fix: 4 steps; first: 1. After TC-5. vitest.integration.config.mts: inside `test` add `deps: { optimizer: { ssr: { enabled: true, include: ["drizzle-orm", "drizzle-orm/node-postgres"] } } }`. Put the same block at the root of vitest.config.mts so the projects of TC-3 inherit it (2…
- done when: On one machine, `pnpm test:int --shard=1/3` reports a duration at least 30 s shorter than before the change (expected: about 44 s, 0.25 s for each of the roughly 175 files in a shard), with the same test counts.
- saving: About 0.25 s per test file that opens the database: about 130 s of the integration run across its three shards and 6 CPU-seconds of the unit run (estimate from a 20-file probe). With TC-5 the client's import falls from 0.48 s to 0.07 s a file, about 215 s acr…
- after: TC-5
- notes: Missed by the report, which timed the schema in plain Node only. The probe files live outside the repo and import the real client, so the per-file numbers are real, but the trial on a shard is the proof. The same half second is not paid in production: the app…

### TC-14 [P2 S eager added] A push that changes only tests builds and deploys production again
- evidence: The push filter leaves out only *.md and docs/** (ci.yml:10-14). Every other push to main runs `pending`, which after the gate calls Vercel's deploy hook (ci.yml:317-325), and the hook builds the head of main; vercel.json has no step that skips a build. Nothing looks at what changed. In this clone's history 75 of the last 92 commits with files run CI, and 6 of those 75 (8%) change only test files (*.test.ts, e2e/**,…
- cost: About one deploy in twelve rebuilds an unchanged app (estimate: 8% of commits, and a commit is not always a push of its own): a Vercel build at the 8 GB edge (docs/build-memory.md:44-46) that prerenders 1,426 pages agai… (The build on Vercel; CI's pending runner while it waits)
- fix: 4 steps; first: 1. .github/workflows/ci.yml, job `pending`: before the gate, a step `changed` that lists the push's files (`git diff --name-only ${{ github.event.before }} ${{ github.sha }}`, after fetching the `before` commit) and writes `deploy=false` when every file match…
- done when: A push that changes one *.test.ts file shows `pending` green with the deploy step skipped while /api/health still reports the previous commit; a push that changes one non-test file under src deploys as before.
- saving: About 8% of deploys (estimate): at today's pace about 3 Vercel builds a day, each several minutes of an 8 GB build machine.
- after: nothing
- notes: Small and true. Not worth a change of its own: do it when ci.yml is open for TC-1. It matters a little more after opening, when each needless deploy is also a moment of cold functions for real visitors.
