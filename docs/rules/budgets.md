# Rules: Budgets and checks

Numbers the repository holds, and the checks that hold them. A sentence about a budget, a check or how CI runs goes here, never in
CLAUDE.md: CLAUDE.md is loaded by every session and is held at its size (below). Step 1.1 of the bloat review
(docs/audits/bloat-review-2026-11.md) adds the table of every baseline file.

## Every budget

A number only falls. When a scan test fails it says which command to run.
A number rises only where its row says so, with a decision.

| Baseline file | Test that holds it | How to lower it | What it counts |
|---|---|---|---|
| src/server/ratchet.baseline.json | src/server/ratchet.scan.test.ts | node scripts/ratchet.mjs | unchecked reads, casts through unknown, switched-off any rules, writes by id without the store |
| src/server/ratchet.baseline.json, key adminRepeats | src/server/ratchet.scan.test.ts | node scripts/ratchet.mjs (--first accepts a rise, shown in the diff) | the admin's action files off the wrapper, tables, native selects, literal Europe/Oslo and confirm( calls |
| src/lib/copies.baseline.json | src/lib/copies.scan.test.ts | node scripts/copies.mjs lowers; --write --reason "…" accepts a copy made on purpose | exact copies across and inside files, near copies, twin pairs (each with its reason), helpers identical in three files |
| src/server/unused.baseline.json | src/server/unused.scan.test.ts | node scripts/unused.mjs lowers; --write --first adds an export (shown in the diff); a reason is written by hand | exports nothing imports (by name), exports only tests use (by count, only falls), tests-only files, public files and API routes nothing names, each with its reason |
| src/lib/surface-budget.baseline.json | src/lib/surface-budget.scan.test.ts and the new-store case in src/db/commerce.test.ts | node scripts/surface-budget.mjs lowers; --raise D<n> raises, and only when decision D<n> has an 'Idle cost:' line | 14 surface counts, the hot tables' indexes and triggers, a new store's rows, the twins kept on purpose |
| src/lib/admin-strings.baseline.json | src/lib/admin-strings.scan.test.ts | UPDATE_ADMIN_STRINGS=1 pnpm exec vitest run src/lib/admin-strings.scan.test.ts | English written into admin markup, per file |
| src/lib/permissions.baseline.json | src/lib/permissions.scan.test.ts and src/lib/permissions.matrix.test.ts | never rewritten (the oracle from before roles; scripts/permission-baseline.mjs made it once) | what each admin entry point asked for before roles |
| src/lib/docs-budget.baseline.json | src/lib/docs-budget.scan.test.ts | node scripts/docs-ratchet.mjs | the written rules (see The written rules below) |
| src/components/admin/admin-bundle.baseline.json | src/components/admin/admin-bundle.scan.test.ts | WRITE_ADMIN_BUNDLE_BASELINE=1 pnpm exec vitest run src/components/admin/admin-bundle.scan.test.ts | admin client modules that reach zod (a new one fails; a rewrite is the deliberate step) |
| src/lib/admin-messages/imports.baseline.json | src/lib/admin-messages/imports.scan.test.ts | WRITE_ADMIN_IMPORTS_BASELINE=1 pnpm exec vitest run src/lib/admin-messages/imports.scan.test.ts | value imports of code in the admin's catalogue files, `file -> target` |
| src/lib/message-keys.baseline.json | src/lib/message-keys.scan.test.ts | WRITE_MESSAGE_KEYS_BASELINE=1 pnpm exec vitest run src/lib/message-keys.scan.test.ts | interface keys that no code names and no matched table covers |
| none (KEPT and its ceiling, in src/lib/admin-dates.scan.test.ts) | src/lib/admin-dates.scan.test.ts | lower a count in KEPT, and the ceiling, by hand once a cut is gone (the test fails while KEPT is higher than the code) | admin code (src/app/admin, src/components/admin): a literal Europe/Oslo, 0; dates cut from a UTC string (.slice(0, 10) or (0, 16)) kept with a reason, 11 in 8 files (D786) |
| none (the three KEPT lists and CEILINGS in src/lib/dates.scan.test.ts) | src/lib/dates.scan.test.ts | lower a count and its ceiling by hand once a case is gone | code outside the admin: a literal Europe/Oslo, 15 lines in 10 files; UTC cuts in storefront and email code, 16 (keys, labelled UTC); dates formatted without a zone, 2 (browser only) (D796) |
| scripts/bundle-budget.baseline.json and src/lib/bundle-budget.test.ts | node scripts/bundle-budget.mjs (CI's e2e job, after the build) | node scripts/bundle-budget.mjs --write after pnpm build | first-load script bytes of every route, 15,000 bytes of room each, and the routes whose first scripts hold each of eight markers |

The bundle budget needs a build, so it runs in CI, not in the list run before a push.
A route more than 15,000 bytes or 5% over its baseline (whichever is more), or a marker in more routes, fails. A new route, a removed one or one that fell is a
note: --write adds it or locks the gain in.
Two markers (the storefront language and the cookie purposes) are allowed to be in no chunk at all, since step 0.16 made them server-only; their count is 0 and the check fails if either returns to a client chunk's first scripts.
A route that must grow takes it on purpose with --write --accept, so the growth shows in the baseline's diff; say why in the commit.
| src/server/admin-statements.baseline.json | src/server/admin-statements.int.test.ts | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/admin-statements.int.test.ts (it writes today's counts, so a rise is accepted deliberately, shown in the diff, with the reason in the commit message) | statements the admin's five screens send (store shell, store Home, orders list, products list, platform Home), counted by src/db/statement-count.ts |
| src/server/ratchet.baseline.json, key queryBudget | src/server/query-budget.int.test.ts (alone, on the fresh database: CI's integration shard 1, first) | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/query-budget.int.test.ts (with FIRST=1 a rise is accepted, shown in the diff) | statements and rows read of each idle dispatcher job, the minute and daily routes and two cold frames, with 1 and 20 stores, and their growth |
| src/server/ratchet.baseline.json, key orderWrites | src/server/order-writes.int.test.ts | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/order-writes.int.test.ts (with FIRST=1 a rise or a new table is accepted, shown in the diff) | statements, rows inserted and updated, and the tables written by one guest order of three lines and by one counted visit |
| src/server/ratchet.baseline.json, key shopJourney | src/server/shop-journey.int.test.ts | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/shop-journey.int.test.ts (with FIRST=1 a new table or more growth is accepted, shown in the diff) | the tables each page of a shop-only store scans (eleven stops, frame to the admin's products list), their rows read (a note), and the rows eight stops read more with 19 other stores |
| scripts/render-modes.baseline.json | node scripts/render-modes.mjs (CI's e2e job, after the build) | node scripts/render-modes.mjs --write after pnpm build | compute, holes, platform-wide tags and revalidate of twelve routes, and the demo store's resume data |
| src/server/use-cache.baseline.json | src/server/use-cache.scan.test.ts | WRITE_CACHED_READS=1 pnpm exec vitest run src/server/use-cache.scan.test.ts | each cached read's cacheLife and cacheTag arguments (a change fails; a new read is a note) |
| scripts/server-budget.json | node scripts/server-budget.mjs (CI's e2e job, after Playwright) | node scripts/server-budget.mjs --write after a change that cut statements (it never raises one) | statements of ten store pages (a product with a price break and one under a producer scheme included), the cart with three lines and the checkout, warm and cold, today's count + 2 |
| src/server/ai-round.baseline.json | src/server/ai-round.scan.test.ts | node scripts/ai-round.mjs lowers; --first accepts a rise (shown in the diff, its reason in the commit) | the characters of every agent's round (the AI manager's on no page and each area's, for a shop-only store and one with every feature on, and seven fixed rounds), tools over 2,500 characters, each agent's output limit and reasoning effort |
| src/server/route-load.baseline.json | src/server/route-load.graph.test.ts | node scripts/route-load.mjs --write lowers; --first accepts a rise (shown in the diff); a heavy handler's reason is written by hand | files each of 18 server entries reaches by static imports, the largest import cycle in src/server, the forbidden modules and packages each entry reaches today, route handlers over 1,500 files (each with its reason) |
| scripts/trace-budgets.json | src/lib/trace-sizes.test.ts (the summing) and node scripts/trace-sizes.mjs --check (CI's e2e job, after the build) | node scripts/trace-sizes.mjs --write after pnpm build (it never raises a figure; --first accepts a rise, shown in the diff) | megabytes traced beside the median function, the proxy, the store home, the store checkout, /api/health and /api/visit; traces that carry sharp, the product taxonomy, Chromium, react-dom, a file under public/ or a .map file |
| scripts/route-budget.json | node scripts/route-budget.mjs (CI's e2e job, after the build) | node scripts/route-budget.mjs --write after pnpm build (it never raises a figure; --first accepts a rise, shown in the diff) | chunk bytes at start of the largest route of each kind, the server-reference manifest's bytes and entries, routing rules (at most 1,600), storefront messages behind the store layout (at most 590,000), no admin sentence outside the admin; cold loads are printed, not held yet |
| scripts/ci-budgets.json | scripts/timed.mjs (every check of CI runs through it; src/lib/ci-recorder.scan.test.ts holds that) and the weekly .github/workflows/ci-budgets.yml | node scripts/ci-budgets-check.mjs --suggest (GH_TOKEN) prints ceilings of 1.25 times the median of the last ten CI runs on main; a ceiling only falls | seconds of each check, build, install and Playwright run, the build's peak memory and the push's runner minutes (empty until ten runs have been read) |
| e2e/signed-in/admin-handed.baseline.json | e2e/signed-in/admin-scripts.spec.ts (CI's signed-in job) | E2E_MEASURE=1 on the signed-in build prints the figures; write the lower ones by hand | five screens in English and Norwegian: document, words handed, script by idle; two saves' answers |
| none (RUN_BYTES, a constant in e2e/performance.spec.ts) | e2e/performance.spec.ts, `script run by idle` (CI's e2e job; Chromium only) | E2E_MEASURE=1 prints `[run-bytes]`; write the figure by hand when it falls (more than 5 % under fails, as one over does) | script bytes V8 ran by idle on a phone, within 5 %: the demo store's home, a product, the listing and the cart (step 1.14) |
| none (ADMIN_RUN_BYTES, a constant in e2e/signed-in/admin-run.spec.ts) | e2e/signed-in/admin-run.spec.ts (CI's signed-in job; Chromium only) | E2E_MEASURE=1 prints the figures; write the figure by hand when it falls | script bytes run by idle with the CPU slowed 4 times, within 5 %: the admin's home, orders, a product's editor and the page builder; largest paint and blocking time printed, not held (step 1.14) |
| none (constants in the script) | docs/audits/bloat-review-2026-11/scripts/stylesheet-audiences.mjs, CI's e2e job after the build | lower the constants | classes no store page can draw: 25,000 raw and 4,200 Brotli (17,000 and 2,000 from step 2.11); then no admin-only class in the site's sheet |

Step 1.1's scan looks for *.baseline.json under src only; e2e/signed-in/admin-handed.baseline.json is named here by hand, as are the two constants of step 1.14 that are not baseline files.

`pnpm check` runs lint, the type check and the unit tests through the same recorder (the pre-push rule, timed): `pnpm check # lint, the type check and the unit tests, timed (the pre-push rule)` is the line CLAUDE.md's Commands would show, kept here to hold its size.
Each build ends with `Build: N s, peak memory X GB (source)` (`scripts/next-build.mjs`, on Vercel too); `docs/build-memory.md` has the figures.

The server's measure 7, refreshes and store draws, is held by Platform, Usage and limits (`#cache`, `docs/capacity.md`) and `src/server/cache-events.int.test.ts`, which fails when 11 job refreshes of one subject in a day are not flagged, when 10 are, or when a platform tag is.

## The written rules

`node scripts/docs-ratchet.mjs --check` and src/lib/docs-budget.scan.test.ts hold, against src/lib/docs-budget.baseline.json:

- CLAUDE.md's bytes and lines, and the bytes loaded in every session (CLAUDE.md, its imports, unpathed .claude/rules files), are
  reported in the baseline; CLAUDE.md's own ceiling is written in the test (below).
- No new import in CLAUDE.md, and no .claude/rules file without a paths list.
- Lines over 500 characters: none in CLAUDE.md; counts that only fall in the rules, the decisions' prose and the living docs.
- Table rows over 500 characters, per file, which only fall (not docs/decisions.md, whose rows the 4,000-byte rule holds).
- A new rule or decision is at most 4,000 bytes; the old large ones are listed and may not grow.
- A rule file's headings are at most 10,000 bytes together; a decision number stands once.
- The ten never-sentences stay in CLAUDE.md; a tracker row is at most 300 characters; one line of CLAUDE.md names the plan.
- A dated report or evidence folder under docs/audits has an ignore file that covers it.
- `node scripts/docs-ratchet.mjs` lowers the baseline; no flag raises it.

## CLAUDE.md

CLAUDE.md is a core with a map of the rule files (bloat review step 2.1): src/lib/docs-budget.scan.test.ts fails when it passes
10,500 bytes or 160 lines. The two numbers are written in the test, not in the baseline, so no script raises them; they never rise.
The how-to that left it is in .claude/rules, loaded by path: the same test fails when a file there has no paths list, names a path
no file matches, or when the moved how-to is written back into CLAUDE.md.
A new rule gets a heading in its area's file under docs/rules and no line in CLAUDE.md: src/lib/rules-index.test.ts holds every
heading unique and the map naming every rule file.

## Decisions and the rules' names (step 0.41)

src/lib/decisions.scan.test.ts fails when a decision number stands twice, when a row stands outside the one index between the two
markers of docs/decisions.md, or when a claimed decision's file (`node scripts/claim-decision.mjs`) is left without its text for over
14 days. Each decision is a file docs/decisions/D{n}.md, none over 200,000 bytes and no line over 500 characters, and the index is
written by `node scripts/decisions.mjs write` (step 2.40); the test fails with that command when the index or a file is off.
The name check in src/lib/docs-budget.scan.test.ts fails when CLAUDE.md or a file under docs/rules cites a function or component
that no code defines.

## Sentences from the plan

Steps of the bloat review write their sentence under a heading of their own below this line.

### Where the words and the scripts may go (step 1.4)

- src/components/admin/admin-bundle.scan.test.ts: the frame reaches no zod, Supabase client or catalogue; ZOD_REACH only shrinks.
- src/lib/admin-text-reach.scan.test.ts: the admin's words are not imported outside the admin.
- src/lib/admin-messages/imports.scan.test.ts: a catalogue file holds text only; the listed imports only shrink until step 2.50.
- src/lib/message-keys.scan.test.ts: a key nothing reads fails; tables read by matching are named in MATCHED_TABLES.
- The three baselines (admin-bundle, imports, message-keys) are rewritten by the writer each failure message names, which writes
  today's figures: a rewrite is the deliberate step that accepts growth, shown in the diff.

### Migrations in tests (step 0.39)

Never edit a baseline; tests check the database the live files build, and the archive is history no test reads
(src/lib/ci-once.scan.test.ts fails when a test reads it).

### A store page's first scripts (step 1.27)

src/lib/storefront-bundle.scan.test.ts holds by name the client modules the server code of the market layout, a built page, the
product page, a listing and the cart imports (src/lib/storefront-bundle.baseline.json: the lists only shrink), the pairs `import()`
newly reaches, the admin's words, the cookie purposes, and the bytes of the four messages/*-browser.ts files (only falls).
Rewrite the baseline with `WRITE_STOREFRONT_BASELINE=1 pnpm exec vitest run src/lib/storefront-bundle.scan.test.ts`; a new page
entry gets an empty reason, which the test refuses until you write why it cannot be a lazy stand-in.

### The admin's hand-downs (step 1.28)

src/components/admin/admin-words-handed.scan.test.ts holds every site that hands words to the browser (src/components/admin/admin-words-handed.baseline.json):
bytes handed in English and Norwegian, bytes named by the client parts, areas nothing names. Rewrite it with
`WRITE_ADMIN_WORDS_BASELINE=1 pnpm exec vitest run src/components/admin/admin-words-handed.scan.test.ts`. A site fails when it grows
by more than 2,000 bytes or a tenth, or hands an area nothing under it reads; a new site passes unless it hands over 50 KB. The writer
writes today's figures, so a rewrite is the deliberate step that accepts growth, shown in the baseline's diff; it never writes in a
newly handed area that nothing reads.

### Source file size (step 1.24)

The code ratchet (scripts/ratchet.mjs, src/server/ratchet.scan.test.ts, src/server/ratchet.baseline.json) also holds two counts that
only fall: source files over 100 KB (filesOver100Kb, 17 on 17 November 2026) and over 2,000 lines (filesOver2000Lines, 12), tests
aside. A file this large is read by window; split it, or move code out of it, and run `node scripts/ratchet.mjs` to lower the count.
What a session really loads is measured from its own transcript: `node scripts/session-load.mjs --step <id>` writes one file of paths,
bytes and counts under docs/audits/bloat-review-2026-11/session-load/ (src/lib/session-load.test.ts); `--summary` prints the medians
of the first 20 'before' and the first 20 'after' files. The rules area's measure 8 holds always loaded plus rules and docs read at 25,000 bytes.

### The storefront's server side (step 1.11)

src/server/use-cache.scan.test.ts lists every cached read's `cacheLife()` and `cacheTag()` in src/server/use-cache.baseline.json (a changed life or tag
fails, and the rewrite's diff shows it in review; a new or removed read is only noted), asks each to have both unless NO_LIFE or NO_TAG names it with a reason, and holds that no file under
src/app/admin/(gated)/[store] refreshes a tag that names no store but the five in PLATFORM_TAG_FROM_STORE. The three lists only shrink.

### A store on a launch theme (step 1.6)

CI's e2e job seeds e2e-orbit before the build (`pnpm seed:themed`, e2e/seed/themed-store.seed.ts): a demo store wearing Orbit
whole, made by the platform's own functions, with two font families and its photographs in three sizes as fixtures.
e2e/performance.spec.ts holds four of its pages (the home, its first product, the listing and the about page): the document, its
payload and main, the style text and the identical rows of each; on the home also each stylesheet's bytes (a new sheet fails),
at most 2 font files and 80 KB, each preloaded, no picture more than 1.5 times too wide on a 3x phone and the pictures' bytes,
the router requests after load (the count plus 2), and the home as stored. Each figure is its first measure plus 5 %.
A first figure is not the end: after phase 2 the themed pages are judged against the bare store's bars (router requests, the
page's own calls, duplicate rows, late scripts), and step 4.5's table lists each figure beside its bar.

## Searches

Default searches (ripgrep and the tools built on it) skip docs/shopify-parity.md, docs/wave-10-notes, docs/ab-testing-spike,
the dated PSI reports docs/audits/psi-2026-*.md, every folder named evidence under docs/audits, supabase/archive and
supabase/migrations/meta.
The three ignore files are docs/.rgignore, docs/audits/.rgignore and supabase/.rgignore. To search a skipped file or folder, name
it as the search path: a glob does not lift the filter.
A review's evidence tables go in a folder named evidence, or stay out of the repository.
A prose line of Markdown under docs is at most 500 characters: node scripts/wrap-docs.mjs wraps, and node scripts/wrap-docs.mjs
--check counts. Table rows over 500 characters are left and may only fall (715 in 99 files on 16 November 2026).
There are 0 prose lines over 500 that can be wrapped; 27 unbreakable lines (one code span) are left as they are.

## Each check runs once in CI (step 0.38)

On Vercel the build skips the type check and runs with one worker and no Turbopack cache, to fit its 8 GB machine (D378,
`docs/build-memory.md`); CI's browser jobs skip it too (`SKIP_BUILD_TYPECHECK`), since `static` and the quick gate check every
push (`src/lib/ci-once.scan.test.ts`).

`pnpm lint` keeps a cache in node_modules/.cache/eslint (delete the folder to lint from nothing); CI restores it in `static` and
`pending`. It stays right only while no lint rule reads more than one file (`src/lib/ci-once.scan.test.ts`).

A push of tests alone (`*.test.ts`, `e2e/**`, `src/test/**`) is checked but not deployed (`scripts/deploy-needed.mjs`).

## The visitor's pages

e2e/performance.spec.ts (first scripts, documents, stylesheets, wire bytes and late scripts of the visitor's pages)
and e2e/prefetch.spec.ts (router requests of five pages) hold figures in CI's e2e job. They only fall.
`E2E_MEASURE=1 pnpm exec playwright test e2e/performance.spec.ts` prints each figure.
Two counts in src/server/ratchet.baseline.json hold the statements that read a whole page document (pageDocumentReads)
and the places that refresh a store's whole pages tag (pagesTagRefreshes); `node scripts/ratchet.mjs` lowers them.

### Every agent's round (step 1.19)

src/server/ai-round.scan.test.ts draws every agent's round (src/server/ai-round.ts) and holds it to src/server/ai-round.baseline.json. A change
that raises a round raises the baseline in the same commit (`node scripts/ai-round.mjs --first`), with its reason in the commit message; a
new tool over 2,500 characters is split, or the commit says why it is kept whole. A change to which tools a round sends needs a new eval run
on Platform → AI and its recording committed, as a prompt change does. A changed output limit or reasoning effort is a decision: update the
baseline and docs/decisions.md. Each AI manager round is a row of commerce.ai_usage with its turn, round, cached input tokens and whether it
called load_tools, and a log line `ai_manager.round` (numbers only); Platform → AI → Usage shows tokens per call from those rows.

The money path (step 1.7): e2e/performance.spec.ts makes a store that takes payments in test mode with SQL
(testStore("betaling"), its payment_providers and stripe_accounts rows) and asks a second `pnpm start` of the same build
(playwright.config.ts, E2E_MONEY_PORT, 3001), the only server with platform keys, dummy values in Stripe's test shape. The
payment stand-in: on the server, STRIPE_TEST_URL with STRIPE_ALLOW_TEST_URL=1 points the Stripe SDK at
e2e/fixtures/stripe-stub.mjs (this machine's address only, never on Vercel); in the browser, the test's own route serves
e2e/fixtures/stripe-js-stub.js for https://js.stripe.com/**. Held for a cart with two lines and the checkout at its payment
step, each at its first figure plus 5 %: the first scripts, the document, its payload and main, the router requests until quiet,
none on the settled payment form, and the other hosts (none on the cart, the provider's script alone on the checkout; any other
host fails).
After phase 2 the two-line cart is judged against the bare store's bars, and the checkout at its payment step has first scripts
of at most 670,000 bytes.
