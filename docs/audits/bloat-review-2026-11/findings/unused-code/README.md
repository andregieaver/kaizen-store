# Code nothing uses (DD)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** There is little dead code: about 2,700 lines of 772,000 (0.35%), thin over some 400 files and dropped by the build, and none of it is a feature waiting for opening: it is code with no caller. The one run-time price is the 19,614-line schema that every cold start evaluates for a query builder nobody calls (150 to 190 ms and about 18 MB, measured here): three lines to change, the same fix as DS-1 and DP-1. The planner's own check added one cost the report missed: a unit test replays all 789 archived migrations on every run (6.2 s and about 630 MB, measured). The plan is a guard first (the review's scan as an exact-list ratchet, about 9 s a run), then deletion in tiers: 721 lines nothing uses, about 230 in three dead files, and about 1,700 that only a test keeps alive.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DD-1](DD-1.md) ✓ | Every cold start evaluates the 19,614-line schema that no query reads | eager | P0 | S | 0.3 |
| [DD-4](DD-4.md) ✓ | Nothing counts unused code, so it grows unseen | no check | P1 | S | 1.9 |
| [DD-3](DD-3.md) ✓ | 331 exports are used by nothing at all, and some say they are in use | dead | P1 | S | 0.25 |
| [DD-8](DD-8.md) ✓ | Three files only tests reach, and a rule that still describes one of them | dead | P1 | S | 0.25 |
| [DD-2](DD-2.md) ✓ | About 330 exports in production files are kept alive only by a test | dead | P2 | M | 4.3 |
| [DD-7](DD-7.md) ✓ | English words kept twice: old constants beside the catalogues, held equal by tests | duplicate | P2 | S | 3.9 |
| [DD-5](DD-5.md) ✓ | Three Work actions have no screen: a logged time entry's hours cannot be corrected *(your choice)* | dead | P2 | S | your choice |
| [DD-12](DD-12.md) ✓ | The invoice-PDF job has a route and a retry button, but nothing ever calls it *(your choice)* | dead | P2 | S | 3.4 |
| [DD-13](DD-13.md) | One unit test replays all 789 archived migrations on every run | dead | P2 | S | 0.26 |
| [DD-10](DD-10.md) ✓ | Tests that quote or replay migrations no database will run again | dead | P2 | S | 0.26 |
| [DD-11](DD-11.md) ✓ | Small things kept from before: old redirects, a twin switch, a second scheduler, an old schema | duplicate | P2 | M | 0.25 |
| [DD-9](DD-9.md) ✓ | Upgraders for three old page shapes: almost free to run, still fed by today's code, and pinned by a rule and a spec | dead | P3 | M | 3.10 |
| [DD-6](DD-6.md) ✓ | Live drills can only be asked for by hand-written SQL, and their job polls every five minutes *(your choice)* | eager | P3 | S | your choice |

## Measured

| Measure | Value | How |
|---|---|---|
| Source files no entry point or test reaches | 0 of 4,133 (772,235 lines without tests) | The review's TypeScript-parser scan (kept in the repo as docs/audits/bloat-review-2026-11/scripts/unused-code.mjs; the skeptic re-ran it in 8.8 s with the same counts as m/dead.json). |
| Files only tests reach | 42 files, 6,616 lines: 34 test support (4,957 lines), 5 guard data or reference formulas read by tests by design (1,485), 3 dead (171 by wc) | m/dead.json's list sorted by name by the planner; the 8 that are not test support were opened by the skeptic. |
| Test-support files whose names the existing ratchet does not know | 9 of 34 (trust-fixtures.ts, three test-fixtures.ts, part-css.testing.ts, xml-tree.test-helper.ts, db/testing.ts, test-days.ts, db/migration-files.ts); src/server/trust-fixtures.ts sits in ratchet.baseline.json with 5 unchecked reads | Planner: the 42 names against NOT_COUNTED in scripts/lib/ratchet-count.mjs:16; rg of the names in src/server/ratchet.baseline.json (line 422). |
| Tier 0: exports nothing uses at all | 331 exports, 721 lines, in 209 files (src/lib 257 exports and 457 lines, src/server 51 and 208, src/components 22 and 47, src/app 1 and 9). 23 are server functions (158 lines) | Planner's scratchpad/work/ddplan/tiers.mjs over the skeptic's word index (work/skdd/rows.json): the 262 scan-dead exports without Next's register, plus 69 that no test file names. 17 of the largest re-checked with rg -w: one line each, the definition. |
| Tier 2: exports exactly one test file names | 324 exports, 1,575 lines, in 203 files; about 80% are dead but for the test (the skeptic's sample of 60: 45 dead) | Same script; the share is the skeptic's sample (seed 77123). |
| Tier 3: exports several test files name | 119 exports, 1,384 lines, in 89 files; about 500 lines are oracles that stay (buildInvoiceSnapshot 189, buildEditInvoiceSnapshot 111, editCreditNote 80, nextState 65, creditNoteSnapshot 53, validateExport 53) | Same script, largest first; the oracles are the skeptic's reading of each. |
| Dead production TypeScript in all | about 2,700 lines (2,400 to 3,000), 0.35% of non-test source | The skeptic's estimate from two samples: 721 + 171 + about 1,250 + about 450 + about 130 second-order. Not re-derived. |
| Word constants kept beside the catalogues (a subset of tiers 0 to 3) | 86 to 121 exports, 363 to 572 lines; 52 read by nothing, 69 named by a test, in 59 test files | Planner's scratchpad/work/ddplan/words.mjs: suspect names ending WORDS, LABELS, TEXT, NOTE, COPY, NAMES and the like, with and without lower-case helpers. The skeptic's own patterns gave 85 to 119 and 360 to 577. |
| Server actions no component imports | 3 of 1,372 | The skeptic's count; the planner ran rg -w on the three names again: one definition each, one integration test for two of them. |
| Route handlers nothing calls | 1 of 263: /api/cron/document-pdfs (pg_cron schedules 12 of the 13 cron routes) | Planner listed src/app/api/cron (13 folders) against baseline_4 lines 93 to 104 (12 schedules) and rg of the address in src: comments, one scan test and next.config.ts only. |
| SQL functions nothing calls | 0 of 616; and none hangs on dead TypeScript alone | The skeptic's trace. Planner's addition (scratchpad/work/ddplan/sql2nd.mjs): the suspect exports' bodies call 2 commerce functions, and both have another caller. |
| Declared packages nothing imports | 0 of 68 | The skeptic's check of m/dead.json against package.json and the two peers. |
| Unused locals and private helpers | 0 can hide: lint is eslint --max-warnings 0 with no-unused-vars on, and no file switches the rule off | Planner: package.json line 9, node_modules/eslint-config-next/dist/typescript.js line 36, rg for eslint-disable of no-unused-vars in src, scripts and e2e: 0. |
| Members of exported objects nothing reads | 33 of 179 members (34 lines, 4 of them functions) in the 34 objects that could be judged; the other 767 exported objects are passed whole and were not judged | Planner's scratchpad/work/ddplan/members.mjs on the repo's TypeScript: an object is judged only when every use is a static X.member. The largest are word lists (STAFF_TEXT 11 of 15, KIND_TITLES 8 of 10): the same class as the word constants. |
| Scripts nothing names | 0 of 38 files that matter (scripts/load/browse.js, 24 lines, is named only by its folder) | Planner: rg -F of each basename over package.json, .github, docs, CLAUDE.md, src, e2e and scripts. |
| Tests that never run | 0: all 1,771 test files match src/**/*.test.ts (unit) or src/**/*.int.test.ts (integration); e2e-live's one spec runs daily from .github/workflows/live-a11y.yml | Planner: vitest.config.mts, vitest.integration.config.mts, a count of test file names by suffix, rg for e2e-live in the workflows. |
| Cold-start cost of the schema (DD-1) | 117 to 149 ms to evaluate the module, 32 to 36 ms for drizzle's init with it, 16 MB + 2.3 MB of heap; 6 built server chunks hold it | The skeptic's three timed runs. Planner re-counted the chunks: rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' prints 6. DS-1 and DP-1 measured the same change on whole routes at 60 to 135 ms. |
| One replay of the archived migrations (DD-13) | 789 files, 4.6 MB of SQL: 6.2 s and 629 MB resident in one process | Planner's scratchpad/work/ddplan/replay.mjs: what src/db/vat.test.ts lines 811 to 851 do (every archived file into a new in-memory PGlite), run once, niced, on this 4-CPU machine at load 1.7. |
| Test lines that only quote or replay an archived migration (DD-10) | about 320 lines in 16 files, plus the 98-line block of DD-13 | Planner: rg for readMigration, findMigration and migrationHistory in tests (19 reads in 17 files), each block's first and last line found with awk and opened. |
| Code that still writes a page shape from before D179 (DD-9) | 6 places in production code and 2 in the seed write a grid's columns as {mobile, tablet, desktop} | Planner: rg for 'columns: { mobile' in src outside tests (src/lib/signature/kit.ts:85, meridian.ts:371, atelier.ts:284, kinetic.ts:311, src/lib/content-pack-pages.ts:77 and :162) and in supabase/seed.sql (lines 273 and 279); upgradeBlock() reads that shape as old (responsive.ts:459 and :498). |
| Run-time cost of the page-shape upgraders (DD-9) | about 10 microseconds for a page of 12 rows and 120 blocks already in today's shape | The skeptic's bench (20,000 timed runs of an esbuild bundle). Not redone. |
| Old admin addresses kept (DD-11) | 8 redirect patterns, 2 unit tests (85 lines) and 4 e2e specs that still use the old addresses | Planner opened src/lib/work-paths.ts:22-26, src/lib/theme-admin-paths.ts:33-39 and next.config.ts:113; rg of the old addresses in e2e: work.spec.ts, signed-in/themes-unified.spec.ts, missing-font.spec.ts, store-features-onboarding.spec.ts. |
| Deletion tiers (lines, and the check that proves each safe) | T0 exports nothing uses: 721 lines. T1 three dead files and their tests: about 230. T2 exports one test names: 1,575 lines, about 1,250 go. T3 exports several tests name: 1,384 lines, about 300 to 600 go. T4 tests of archived migrations: about 420 test lines. T5 before opening: 8 redirects and the modules twin, about 100 lines; the page upgraders (about 240 lines) only after their gate | T0 and T1: pnpm lint and typecheck fail if anything used them, and node scripts/unused.mjs (DD-4) lists none. T2 and T3: typecheck, pnpm test and test:int. T4: pnpm test passes and no test imports src/db/migration-files.ts. T5: the e2e suite, and for the upgraders a production count of zero old-shaped documents. |

## Well made, and should stay

- Reachability: no source file is unreachable. The scan's blind spot (a file reached by a namespace, star or dynamic import marks all its exports used) was measured by the auditor at about 13 more dead exports (30 lines) outside schema.ts; the skeptic did not redo it.
- Admin routes: 449 pages, each listed in src/lib/admin-map.ts and held there by admin-map.test.ts, which walks the page files. Two pages only forward (experiments/variants and setup): both are current, not old addresses.
- Route handlers: 262 of 263 have a caller. The exception is /api/cron/document-pdfs (DD-12).
- Server actions: 1,369 of 1,372 are imported by a component. The three that are not run through the same membership guard as the rest, so leaving them costs no safety.
- SQL: every one of 616 function names has a caller, and no SQL function is called only from a TypeScript export that is itself dead (planner's check: 2 names, both have other callers).
- Dependencies: none unused.
- Unused locals and private helpers cannot pile up: pnpm lint runs with --max-warnings 0 and no file disables no-unused-vars (0 hits). Only the export keyword hides unused code, which is what DD-4 closes.
- Members of exported objects: 33 unread members (34 lines) in the 34 objects that could be judged, nearly all words; not worth a finding of its own (they go with DD-7).
- Scripts: all 38 files under scripts are named by package.json, CI, a doc or another script; scripts/theme-art (9,725 lines) and supabase/archive (6.5 MB, kept by rule D572) are in no build or deploy path.
- Tests: none test only themselves, and none is left out of both runners. The 34 test-support files are imported by tests only and never bundled.
- Dead exports do not reach a browser or a server bundle (the skeptic checked two dead text constants and one dead server function's SQL in .next).
- Switches: three fixed constants only (APP_DIRECTORY_OPEN = false, a documented legal gate with one reader; CSP_ENFORCE = true; DOCS_GUIDE_READY = true) and two environment switches that are real choices (KAIZEN_LIFE_SSO, REPLICATE_ALLOW_PRIVATE). No always-on or always-off environment flag.
- One-off code: rg for backfill, migrate, upgrade, convert and one-off in src/server and src/app/api found no finished one-off job still shipped, apart from the dispatcher's AI-picture marks, which the scheduled-work dimension holds (CR-11).
- Oracles and test seams are by design, not dead: buildInvoiceSnapshot, creditNoteSnapshot and their edit twins, nextState in support-state.ts, validateExport, STORE_MATCHER, replayAgentEval, closeDb, and reset helpers such as forgetUpsTokens and resetTicks.
- Guard data read only by tests is deliberate: i18n-glossary.ts, legal-wording-nb.ts, store-export-scope.ts, src/lib/signature-themes.ts and experiment-legacy.ts.
- platformAction() has no production caller yet; it is part of code review step 1.4 and one day old: not a finding.
- Nothing in this dimension argues from an empty table or an unused feature. The one place an empty table is used as evidence is narrow: a branch that exists only for rows written before a decision cannot matter where the table has never held a row (api_tokens, site_stagings and campaigns in m/prod-db-stats.md). Those branches are one line or one short list each and are not worth a finding.
- Not covered here because other dimensions hold the evidence: unused public assets, unused tables, columns and indexes, the catalogues' size, the old no-store site (FM-3), and what the dispatcher's jobs cost when idle.
