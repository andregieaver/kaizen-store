# unused-code: Code nothing uses

There is little dead code: about 2,700 lines of 772,000 (0.35%), thin over some 400 files and dropped by the build, and none of it is a feature waiting for opening: it is code with no caller. The one run-time price is the 19,614-line schema that every cold start evaluates for a query builder nobody calls (150 to 190 ms and about 18 MB, measured here): three lines to change, the same fix as DS-1 and DP-1. The planner's own check added one cost the report missed: a unit test replays all 789 archived migrations on every run (6.2 s and about 630 MB, measured). The plan is a guard first (the review's scan as an exact-list ratchet, about 9 s a run), then deletion in tiers: 721 lines nothing uses, about 230 in three dead files, and about 1,700 that only a test keeps alive.

## Measures
- Source files no entry point or test reaches: 0 of 4,133 (772,235 lines without tests)
- Files only tests reach: 42 files, 6,616 lines: 34 test support (4,957 lines), 5 guard data or reference formulas read by tests by design (1,485), 3 dead (171 by wc)
- Test-support files whose names the existing ratchet does not know: 9 of 34 (trust-fixtures.ts, three test-fixtures.ts, part-css.testing.ts, xml-tree.test-helper.ts, db/testing.ts, test-days.ts, db/migration-files.ts); src/server/trust-fixtures.ts sits in ratchet.baseline.json with 5 unchecked reads
- Tier 0: exports nothing uses at all: 331 exports, 721 lines, in 209 files (src/lib 257 exports and 457 lines, src/server 51 and 208, src/components 22 and 47, src/app 1 and 9). 23 are server functions (158 lines)
- Tier 2: exports exactly one test file names: 324 exports, 1,575 lines, in 203 files; about 80% are dead but for the test (the skeptic's sample of 60: 45 dead)
- Tier 3: exports several test files name: 119 exports, 1,384 lines, in 89 files; about 500 lines are oracles that stay (buildInvoiceSnapshot 189, buildEditInvoiceSnapshot 111, editCreditNote 80, nextState 65, creditNoteSnapshot 53, validateExport 53)
- Dead production TypeScript in all: about 2,700 lines (2,400 to 3,000), 0.35% of non-test source
- Word constants kept beside the catalogues (a subset of tiers 0 to 3): 86 to 121 exports, 363 to 572 lines; 52 read by nothing, 69 named by a test, in 59 test files
- Server actions no component imports: 3 of 1,372
- Route handlers nothing calls: 1 of 263: /api/cron/document-pdfs (pg_cron schedules 12 of the 13 cron routes)
- SQL functions nothing calls: 0 of 616; and none hangs on dead TypeScript alone
- Declared packages nothing imports: 0 of 68
- Unused locals and private helpers: 0 can hide: lint is eslint --max-warnings 0 with no-unused-vars on, and no file switches the rule off
- Members of exported objects nothing reads: 33 of 179 members (34 lines, 4 of them functions) in the 34 objects that could be judged; the other 767 exported objects are passed whole and were not judged
- Scripts nothing names: 0 of 38 files that matter (scripts/load/browse.js, 24 lines, is named only by its folder)
- Tests that never run: 0: all 1,771 test files match src/**/*.test.ts (unit) or src/**/*.int.test.ts (integration); e2e-live's one spec runs daily from .github/workflows/live-a11y.yml
- Cold-start cost of the schema (DD-1): 117 to 149 ms to evaluate the module, 32 to 36 ms for drizzle's init with it, 16 MB + 2.3 MB of heap; 6 built server chunks hold it
- One replay of the archived migrations (DD-13): 789 files, 4.6 MB of SQL: 6.2 s and 629 MB resident in one process
- Test lines that only quote or replay an archived migration (DD-10): about 320 lines in 16 files, plus the 98-line block of DD-13
- Code that still writes a page shape from before D179 (DD-9): 6 places in production code and 2 in the seed write a grid's columns as {mobile, tablet, desktop}
- Run-time cost of the page-shape upgraders (DD-9): about 10 microseconds for a page of 12 rows and 120 blocks already in today's shape
- Old admin addresses kept (DD-11): 8 redirect patterns, 2 unit tests (85 lines) and 4 e2e specs that still use the old addresses
- Deletion tiers (lines, and the check that proves each safe): T0 exports nothing uses: 721 lines. T1 three dead files and their tests: about 230. T2 exports one test names: 1,575 lines, about 1,250 go. T3 exports several tests name: 1,384 lines, about 300 to 600 go. T4 tests of archived migrations: about 420 test lines.…

## Well made
- Reachability: no source file is unreachable. The scan's blind spot (a file reached by a namespace, star or dynamic import marks all its exports used) was measured by the auditor at about 13 more dead exports (30 lines) outside schema.ts; the skeptic did not r…
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
- Switches: three fixed constants only (APP_DIRECTORY_OPEN = false, a documented legal gate with one reader; CSP_ENFORCE = true; DOCS_GUIDE_READY = true) and two environment switches that are real choices (KAIZEN_LIFE_SSO, REPLICATE_ALLOW_PRIVATE). No always-on…
- One-off code: rg for backfill, migrate, upgrade, convert and one-off in src/server and src/app/api found no finished one-off job still shipped, apart from the dispatcher's AI-picture marks, which the scheduled-work dimension holds (CR-11).
- Oracles and test seams are by design, not dead: buildInvoiceSnapshot, creditNoteSnapshot and their edit twins, nextState in support-state.ts, validateExport, STORE_MATCHER, replayAgentEval, closeDb, and reset helpers such as forgetUpsTokens and resetTicks.
- Guard data read only by tests is deliberate: i18n-glossary.ts, legal-wording-nb.ts, store-export-scope.ts, src/lib/signature-themes.ts and experiment-legacy.ts.
- platformAction() has no production caller yet; it is part of code review step 1.4 and one day old: not a finding.
- Nothing in this dimension argues from an empty table or an unused feature. The one place an empty table is used as evidence is narrow: a branch that exists only for rows written before a decision cannot matter where the table has never held a row (api_tokens,…
- Not covered here because other dimensions hold the evidence: unused public assets, unused tables, columns and indexes, the catalogues' size, the old no-store site (FM-3), and what the dispatcher's jobs cost when idle.

## Findings (13)

### DD-1 [P0 S eager confirmed] Every cold start evaluates the 19,614-line schema that no query reads
- evidence: src/db/client.ts imports the whole schema as a value (line 11), uses it as a type (line 31) and hands it to drizzle (line 78). Nothing else imports it at run time: rg over src, scripts and e2e finds client.ts, one scan test (src/server/store-export.scan.test.ts:4) and drizzle.config.ts. No code uses the query builder: rg for db().select, .insert, .query and for $inferSelect or InferSelectModel finds nothing outside …
- cost: 150 to 190 ms and about 18 MB on each cold start of a function that touches the database (measured on this machine on the schema alone; DS-1 and DP-1 measured 60 to 135 ms on whole routes; an estimate for Vercel either … (The server on every cold start, so the first shopper or owner to reach a fresh …)
- fix: 5 steps; first: 1. src/db/client.ts: delete line 11 (import * as schema from "./schema"). Line 31 becomes: type Database = NodePgDatabase; Line 78 becomes: return { pool, database: withRows(drizzle({ client: pool })) }; Nothing else in the file changes: Db, withRows(), db() …
- done when: After pnpm build, rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l prints 0 (6 today), and pnpm db:check exits 0.
- saving: 150 to 190 ms and about 18 MB per cold start by the skeptic's measure of the schema alone (60 to 135 ms by DS-1's and DP-1's whole-route measures; an estimate for Vercel), and about 0.8 MB off each of 6 server chunks (measured).
- after: nothing
- tracked: Code review step 3.14 Split schema.ts (finding FD5): Open. The same three lines are planned as DS-1 (db-schema) and DP-1 (deps) and found again as SG-6 and TC-…
- notes: This is the only item of this dimension with a run-time price. Splitting schema.ts into files by area is P3: once the import is gone it saves reading only. Not argued from use: the cost is paid whatever a store sells.

### DD-4 [P1 S process corrected] Nothing counts unused code, so it grows unseen
- evidence: ESLint runs Next's two presets with --max-warnings 0: they fail on an unused local or import, never on an unused export. None of the 46 scan tests mentions unused, orphan or importers, and package.json has no tool for it. An export keyword on a name its own file does not use switches off the compiler's and the linter's check: that is the 263 plus 655 suspects, found only because a scanner was written for this review…
- cost: No budget: each unit adds a few helpers and word constants nothing reads. In 47 days that came to about 2,700 lines, about 57 a day. (Maintainers and agents, later: each dead name is a false lead in a search and c…)
- fix: 6 steps; first: 1. Make the scan a library: copy docs/audits/bloat-review-2026-11/scripts/unused-code.mjs to scripts/lib/unused-scan.mjs and export unusedScan(root), which returns three sorted lists: unusedExports and testOnlyExports as 'file#name', testOnlyFiles as paths. K…
- done when: pnpm test src/server/unused.scan.test.ts passes, and with export const NEVER_USED = 1 added to any file under src/lib it fails naming that file.
- saving: Keeps DD-2 and DD-3 from growing back (about 57 lines a day at the measured rate). Costs about 9 seconds in the unit-test run; the quick gate before a deploy is not slowed.
- after: nothing
- notes: Lists, not counts: a count would let one dead export replace another. The skeptic's correction stands: the 2,205 own-file-only exports hide nothing and are not counted.

### DD-3 [P1 S dead confirmed] 331 exports are used by nothing at all, and some say they are in use
- evidence: 263 exports are imported by nothing and unused in their own file; one is a false alarm (Next reads register in src/instrumentation.ts). Another 69 were filed as tests-only only because a test imports their whole module; no test file contains their names. Together 331 exports, 721 lines, in 209 files: 105 types, 89 functions (most one-line helpers), 116 other constants, 21 re-exports; 23 are server functions (158 lin…
- cost: 721 lines. Nothing at run time or in any bundle. The price is a wrong fix: someone changes the copy nobody runs, or trusts a limit nothing enforces (MAX_CONTENT_TYPES = 50 is read by nothing). (People and agents changing discounts, erasure or delivery code.)
- fix: 6 steps; first: 1. Get the list: node scripts/unused.mjs (DD-4) prints unusedExports; the 69 others are the testOnlyExports whose name rg -w finds in no test file. Without DD-4, run the review's script: node docs/audits/bloat-review-2026-11/scripts/unused-code.mjs <outDir> a…
- done when: node scripts/unused.mjs reports 0 unused exports (262 today) and none of the 69 names appears in testOnlyExports; pnpm lint, typecheck, test and test:int pass.
- saving: 721 lines (measured), plus about 130 second-order lines (estimate).
- after: DD-4
- notes: The full list, largest first, is in scratchpad/work/ddplan/T0.txt (made by tiers.mjs from the skeptic's index); the scan regenerates it. This is code with no caller, not an unused feature, so the owner's clarification does not change it.

### DD-8 [P1 S dead confirmed] Three files only tests reach, and a rule that still describes one of them
- evidence: InlineHeadingEditor (143 lines) is rendered only by inline-edit.test.ts (41 lines, three cases, all about it); the builder and the live-site editor both use InlineMarkupEditor (page-builder.tsx:3281, site-editor.tsx:190). The rule at docs/rules/admin/website.md:302 still names InlineHeadingEditor, twice, as the heading's editor. WorkComingSoon (17 lines) stands in for Work pages 'built in a later step'; no page uses…
- cost: 171 lines of source, a 41-line test and two test cases, and one rule that sends a reader or an agent to an editor nobody uses. (Agents and people who follow the rule before touching in-place editing.)
- fix: 5 steps; first: 1. Delete src/components/inline-edit/heading-editor.tsx and src/components/inline-edit/inline-edit.test.ts. cleanHeadingText() in src/lib/inline-edit.ts stays: markup-editor.tsx and /api/platform/editor/text use it.
- done when: rg -n -w "InlineHeadingEditor|WorkComingSoon|store-modules" src docs --glob '!docs/audits/**' prints nothing, and pnpm typecheck and pnpm test pass.
- saving: About 230 lines (171 of source, 41 of test, about 20 of test cases and words; measured).
- after: nothing

### DD-2 [P2 M dead corrected] About 330 exports in production files are kept alive only by a test
- evidence: The scan lists 655 exports only tests import. 512 of them (3,208 lines) sit in 298 production files; 69 of those are named by no test and are counted in DD-3. That leaves 443 (2,959 lines): 324 named by one test file (1,575 lines, in 203 files: src/lib 262, src/server 38, src/components 21) and 119 by several (1,384 lines, in 89 files). In the skeptic's random sample of 60, 45 were dead but for their test (75%; 80% …
- cost: About 1,700 lines of source (1,500 to 2,000, estimate from two samples) and their test cases. Nothing at run time: the build drops them. (People and agents who read, search and change the code, and CI, which runs test…)
- fix: 6 steps; first: 1. Take the list from node scripts/unused.mjs (DD-4): testOnlyExports, grouped by how many test files name each (rg -w -l the name over *.test.ts and e2e).
- done when: node scripts/unused.mjs: testOnlyExports is empty and keptForTests holds about 100 to 130 names, each with a reason; pnpm test and pnpm test:int pass.
- saving: About 1,700 lines of source and roughly 1,000 to 2,000 test lines (estimate). Not additive with DD-7, which is a subset.
- after: DD-4; DD-3
- notes: Lists: scratchpad/work/ddplan/T2.txt and T3.txt, largest first, with the test files that name each. Do it folder by folder when the area is next touched; nothing here costs a visitor anything. The skeptic's corrections are kept: 298 files, about 330 exports, …

### DD-7 [P2 S duplicate confirmed] English words kept twice: old constants beside the catalogues, held equal by tests
- evidence: Between 86 and 121 of the suspect exports are word lists or sentence helpers no production file reads (363 to 572 lines, by the planner's two patterns; the skeptic's gave 85 to 119 and 360 to 577). 52 are read by nothing; 69 are named by a test, in 59 test files. Tests hold a catalogue section equal to the older constant: finance-words.test.ts:27-31 holds financeEn.payouts equal to three constants in payouts.ts that…
- cost: 363 to 572 lines, a subset of DD-2 and DD-3 (do not add them). A wording change must be made in two places or a test fails. Not shipped: the build keeps the catalogue's copy only. (Whoever edits interface text; CI.)
- fix: 5 steps; first: 1. List them: from node scripts/unused.mjs take the unused and tests-only exports whose names end WORDS, LABELS, TEXT, TEXTS, NOTE, COPY, NAMES, TITLES, or Words, Text, Label, Sentence (scratchpad/work/ddplan/words.txt holds today's 121).
- done when: rg -n "toEqual\(\w+_(WORDS|LABELS|TEXT|NAMES|COPY|NOTE)\)|toBe\(\w+_(WORDS|LABELS|TEXT|NAMES|COPY|NOTE)\)" src --glob '*.test.*' | wc -l prints 0 (37 today), and pnpm test passes.
- saving: Up to about 500 lines and 30 to 40 assertions (measured upper bound; part of DD-2's and DD-3's totals, not on top of them).
- after: DD-4
- notes: The size of the catalogues and how they load is the i18n dimension's; this is only the second copy.

### DD-5 [P2 S dead corrected OWNER-CHOICE] Three Work actions have no screen: a logged time entry's hours cannot be corrected
- evidence: These are the only 3 of 1,372 server actions no component imports. updateTimeEntryAction has no importer and no test. saveInvoiceLinesAction and saveInvoiceHeaderAction are called by one integration test only (work-invoices.int.test.ts:1498 and :1512); the invoice editor saves a whole draft through saveDraftInvoiceAction. The time-entry list imports only setEntryNoteAction and deleteTimeEntryAction (time-entry-list.…
- cost: 35 lines of actions, 97 lines of server code reached only through them, and their tests; and a gap in Work: a wrong entry must be deleted and logged again. (A Work user who mistyped hours; maintainers.)
- fix: 6 steps; first: Owner's choice for time entries, A or B. A is recommended: the server side is done and tested.
- done when: node scripts/unused.mjs lists none of updateTimeEntryAction, saveInvoiceLinesAction and saveInvoiceHeaderAction; under A, the component test changes an entry's minutes through the row.
- saving: About 130 lines removed (35 of actions, 97 of server code), or one finished feature for an afternoon's work and about 80 lines removed.
- after: nothing
- notes: A product choice, not waste. The question for the owner: should a logged entry's hours be editable, or is delete and log again the intended way?

### DD-12 [P2 S dead corrected OWNER-CHOICE] The invoice-PDF job has a route and a retry button, but nothing ever calls it
- evidence: /api/cron/document-pdfs makes the PDFs of invoices and credit notes that have none (pdfJob(), up to ten a run). Its own comment and docs/wave-1b-invoices.md:808 say to schedule it where the five-minute job is scheduled. It never was: src/app/api/cron has 13 route folders, pg_cron schedules 12 (baseline_4 lines 93 to 104, written from production as it stood), vercel.json lists only the daily job, and rg finds no fetc…
- cost: A 23-line route, the 29-line job and a retry sentence that is not true, and a deployed function whose trace is 101.9 MB (the same files serve the two download routes, so what deleting it saves at deploy is uncertain). W… (The shopper or owner who downloads an invoice first; the build and deploy; main…)
- fix: 5 steps; first: Owner's choice between two honest states. This is the same change as CR-11 step 1 in the scheduled-work plan: do it once, there.
- done when: cron-routes.scan.test.ts passes with document-pdfs out of NOT_SCHEDULED (A) or the route folder is gone (B); under A, commerce.cron_jobs has a row route.document-pdfs whose runs rise after an invoice is issued without a PDF.
- saving: A retry sentence that is true and no cold Chromium on a customer's first download; or about 60 lines and one deployed function removed (estimate).
- after: CR-1 (only for the scheduled form of A; the smaller form of A and B need nothing)
- tracked: no. docs/wave-1b-invoices.md:808 asks for the schedule; no plan lists it as missing. Planned as CR-11 in this review.
- notes: Found by the skeptic, not the auditor. Not argued from an empty table: the gap is in the wiring, whatever stores do. Worth settling before opening, because the sentence shown to an owner is the part that is wrong today.

### DD-13 [P2 S dead added] One unit test replays all 789 archived migrations on every run
- evidence: src/db/vat.test.ts lines 808 to 905 ('the tax migrations on a database that has data') build a second PGlite and apply the whole history to it: every file before the two tax migrations of 3 October (237 files), three test orders, the two tax files, then every file after them (line 851: for (const file of after) await apply(file)), read through migrationHistory(), which is the 789 archived files plus the live ones wi…
- cost: About 6 seconds of one worker and about 630 MB of memory on every pnpm test, locally and in CI (measured once here, on a loaded 4-CPU machine), for five assertions about a migration that cannot run again. It grows only … (CI on every push and the agent's own test run before it.)
- fix: 4 steps; first: 1. src/db/vat.test.ts: delete the describe block at lines 808-905 and the imports only it uses (migrationHistory from ./migration-files; PGlite, pg_trgm, vector, readFile and statementsOf if nothing else in the file uses them: pnpm lint names them).
- done when: rg -n "migrationHistory\(\)" src/db/vat.test.ts prints nothing, pnpm test passes, and the time vitest reports for src/db/vat.test.ts falls by about 6 seconds (compare before and after in the commit message).
- saving: About 6 s and about 630 MB of peak memory per unit-test run (measured here), and 98 test lines.
- after: nothing
- tracked: partly: code review findings FD2 (done 10 November) and FD3 with step 1.7 (done 11 November) removed this cost everywhere else; this block was kept and pointed…
- notes: Added by the planner. The verified report counted this file as one of 17 that read archived migrations and did not time it. Its 98 lines are not in DD-10's count.

### DD-10 [P2 S dead corrected] Tests that quote or replay migrations no database will run again
- evidence: Since the squash of 11 November (code review step 1.7, D572) a database is built from four baseline files; the 789 older files are an archive outside every path that applies migrations. 17 test files still read archived files 19 times. Opened, they are four kinds. (a) A whole file about one archived data migration: platform-dark-navy.test.ts (76 lines) only replays its file on hand-made CSS. (b) Two cases in each of…
- cost: About 320 test lines that prove nothing about any future run (block spans measured), one PGlite built for platform-dark-navy.test.ts alone, and two guards that look live but read a frozen file. (CI on every push; readers who take the tests for live rules.)
- fix: 7 steps; first: 1. Delete src/db/platform-dark-navy.test.ts whole.
- done when: rg -l "readMigration|findMigration|migrationHistory" src --glob '*.test.ts' | wc -l prints 0 (17 today), src/db/migration-files.ts is gone, and pnpm test passes.
- saving: About 320 test lines and one 40-line helper (measured by block spans), one PGlite build a run, and two guards that read the live migrations.
- after: DD-13 (for step 7 only)
- tracked: no (a follow-up of code review step 1.7, Done 11 November)
- notes: The planner re-measured the size (about 320 lines, not 150 to 300) by opening every read, and added kind (d): two tests that guard a live rule against the archive. The whole-history replay in vat.test.ts is DD-13.

### DD-11 [P2 M duplicate corrected] Small things kept from before: old redirects, a twin switch, a second scheduler, an old schema
- evidence: (a) Eight redirects (3 for Work, 5 for themes) send admin addresses from before D123 and D273 to the new ones; only the team ever had those addresses, and docs/work.md:2234 calls the Work ones temporary. Two unit tests cover the lists (85 lines) and four e2e specs still use the old addresses: work.spec.ts:30-41 and themes-unified.spec.ts:47-52 test the redirects, missing-font.spec.ts:127 enters through one, store-fe…
- cost: About 100 lines of source, 8 redirect patterns matched on requests, a trigger branch on writes of two columns, one extra function run a day, 34 leftover tables. Each is tiny; together they are what a newcomer trips over. (Maintainers; one daily function run; the database's catalogue.)
- fix: 6 steps; first: 1. Redirects, before opening (while nobody outside holds an old address): delete LEGACY_WORK_REDIRECTS (src/lib/work-paths.ts:15-26) and LEGACY_THEME_REDIRECTS (src/lib/theme-admin-paths.ts:28-39), their imports at next.config.ts:7-8 and their two spreads at …
- done when: rg -n "LEGACY_(WORK|THEME)_REDIRECTS|legacyModule|setBookingsModule|setDeliveriesModule" src next.config.ts prints nothing; in production select count(*) from commerce.stores where modules && array['bookings','deliveries'] is 0; the e2e suite passes.
- saving: About 100 lines of source and about 150 of tests, 8 redirect patterns, one trigger branch (measured counts, estimated lines). The daily run and the 34 tables are counted in CR-12 and DS-14.
- after: CR-12 and DS-14 for parts (c) and (d), which are planned there
- tracked: commerce_legacy only: docs/decisions.md:424 says it can be removed, not done; DS-14 and CR-12 plan parts (d) and (c). The modules twin is a written rule (platf…
- notes: Before opening is the one moment the redirects can go without asking anyone: after it, an owner's bookmark may hold an old address for good. The twin can wait until Features is next touched.

### DD-9 [P3 M dead corrected] Upgraders for three old page shapes: almost free to run, still fed by today's code, and pinned by a rule and a spec
- evidence: Stored page JSON is upgraded on read from three older shapes: pages before rows (upgradeLegacy, 10 lines), rows and blocks before D179 (responsive.ts:398-529, 132 lines; upgradeColumn at :440 is already a no-op) and text settings before D180 (typography.ts:641-827, 187 lines). They run in z.preprocess on every row and block. The skeptic measured about 10 microseconds for a page of 12 rows and 120 blocks, so there is…
- cost: About 240 removable lines and their tests, and two extra shapes to keep in mind when a block changes. About 10 microseconds per page read: nothing a shopper or the server would notice. (Whoever changes the page model. Not the server in any measurable way.)
- fix: 6 steps; first: Not now. If it is done, do it as one change with PM-9 (page-model), in this order.
- done when: The production count of step 2 is 0 in every table listed, and rg -n "upgradeRow|upgradeBlock|upgradeLegacy|upgradeResponsive" src prints nothing.
- saving: About 240 lines and part of seven test files (estimate from measured section sizes). No run-time saving.
- after: PM-9 (the same rewrite, planned in the page-model dimension); a production count of old-shaped documents, which this review could not run
- tracked: no; it contradicts a written rule (docs/responsive-editing.md:56, docs/rules/admin/website.md:38). PM-9 in this review covers the same upgrade steps from the r…
- notes: P3 because the saving is lines only, the gate needs production, and a rule says otherwise. The planner's correction: six production writers and the seed still produce the pre-D179 grid shape, so the block upgrader is live input handling today, not dead code. …

### DD-6 [P3 S eager corrected OWNER-CHOICE] Live drills can only be asked for by hand-written SQL, and their job polls every five minutes
- evidence: The only insert into commerce.live_drills is inside requestDrills() (live-drills.ts:45), and only its integration test calls requestDrills (rg over src: the definition and live-drills.int.test.ts). No page, action or assistant tool asks for a drill, and every read of the table is inside live-drills.ts, so no screen shows a result. This is close to what D406 intended: its reason is that the AI doing the development s…
- cost: Two queries and about 160 ms inside each five-minute dispatcher run: about 45 seconds of function time a day, the same whatever the store count. No extra function run. A request made by SQL skips requestDrills' own chec… (The server and database every five minutes, a little; the platform team, who mu…)
- fix: 4 steps; first: Owner's choice, A or B. Neither is urgent.
- done when: Either rg -n "requestDrills\(" src --glob '!*.test.*' shows a caller outside live-drills.ts (A), or docs/rules/admin/platform.md:233 says drills are asked for by SQL (B).
- saving: A usable feature for the platform team, or nothing but a true description. Taking the job out of each pass would save two queries a pass, which CR-2 counts.
- after: CR-2 (for the polling only)
- notes: P3: the engine works and has been used; what is left is a small idle cost that another finding handles and a product choice. Not a case for retiring anything.
