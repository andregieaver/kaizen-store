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
| src/lib/admin-strings.baseline.json | src/lib/admin-strings.scan.test.ts | UPDATE_ADMIN_STRINGS=1 pnpm exec vitest run src/lib/admin-strings.scan.test.ts | English written into admin markup, per file |
| src/lib/permissions.baseline.json | src/lib/permissions.scan.test.ts and src/lib/permissions.matrix.test.ts | never rewritten (the oracle from before roles; scripts/permission-baseline.mjs made it once) | what each admin entry point asked for before roles |
| src/lib/docs-budget.baseline.json | src/lib/docs-budget.scan.test.ts | node scripts/docs-ratchet.mjs | the written rules (see The written rules below) |
| src/components/admin/admin-bundle.baseline.json | src/components/admin/admin-bundle.scan.test.ts | WRITE_ADMIN_BUNDLE_BASELINE=1 pnpm exec vitest run src/components/admin/admin-bundle.scan.test.ts | admin client modules that reach zod (a new one fails; a rewrite is the deliberate step) |
| src/lib/admin-messages/imports.baseline.json | src/lib/admin-messages/imports.scan.test.ts | WRITE_ADMIN_IMPORTS_BASELINE=1 pnpm exec vitest run src/lib/admin-messages/imports.scan.test.ts | value imports of code in the admin's catalogue files, `file -> target` |
| src/lib/message-keys.baseline.json | src/lib/message-keys.scan.test.ts | WRITE_MESSAGE_KEYS_BASELINE=1 pnpm exec vitest run src/lib/message-keys.scan.test.ts | interface keys that no code names and no matched table covers |
| scripts/bundle-budget.baseline.json and src/lib/bundle-budget.test.ts | node scripts/bundle-budget.mjs (CI's e2e job, after the build) | node scripts/bundle-budget.mjs --write after pnpm build | first-load script bytes of every route, 15,000 bytes of room each, and the routes whose first scripts hold each of eight markers |

The bundle budget needs a build, so it runs in CI, not in the list run before a push.
A route more than 15,000 bytes or 5% over its baseline (whichever is more), or a marker in more routes, fails. A new route, a removed one or one that fell is a
note: --write adds it or locks the gain in.
Two markers (the storefront language and the cookie purposes) are allowed to be in no chunk at all, since step 0.16 made them server-only; their count is 0 and the check fails if either returns to a client chunk's first scripts.
A route that must grow takes it on purpose with --write --accept, so the growth shows in the baseline's diff; say why in the commit.
| src/server/admin-statements.baseline.json | src/server/admin-statements.int.test.ts | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/admin-statements.int.test.ts (it writes today's counts, so a rise is accepted deliberately, shown in the diff, with the reason in the commit message) | statements the admin's five screens send (store shell, store Home, orders list, products list, platform Home), counted by src/db/statement-count.ts |
| src/server/ratchet.baseline.json, key queryBudget | src/server/query-budget.int.test.ts (alone, on the fresh database: CI's integration shard 1, first) | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/query-budget.int.test.ts (with FIRST=1 a rise is accepted, shown in the diff) | statements and rows read of each idle dispatcher job, the minute and daily routes and two cold frames, with 1 and 20 stores, and their growth |
| src/server/ratchet.baseline.json, key orderWrites | src/server/order-writes.int.test.ts | UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/order-writes.int.test.ts (with FIRST=1 a rise or a new table is accepted, shown in the diff) | statements, rows inserted and updated, and the tables written by one guest order of three lines and by one counted visit |
| scripts/render-modes.baseline.json | node scripts/render-modes.mjs (CI's e2e job, after the build) | node scripts/render-modes.mjs --write after pnpm build | compute, holes, platform-wide tags and revalidate of twelve routes, and the demo store's resume data |
| src/server/use-cache.baseline.json | src/server/use-cache.scan.test.ts | WRITE_CACHED_READS=1 pnpm exec vitest run src/server/use-cache.scan.test.ts | each cached read's cacheLife and cacheTag arguments (a change fails; a new read is a note) |
| scripts/server-budget.json | node scripts/server-budget.mjs (CI's e2e job, after Playwright) | node scripts/server-budget.mjs --write after a change that cut statements (it never raises one) | statements of eight store pages, the cart with three lines and the checkout, warm and cold, today's count + 2 |

The server's measure 7, refreshes and store draws, is held by Platform, Usage and limits (`#cache`, `docs/capacity.md`) and `src/server/cache-events.int.test.ts`, which fails when 11 job refreshes of one subject in a day are not flagged, when 10 are, or when a platform tag is.

## The written rules

`node scripts/docs-ratchet.mjs --check` and src/lib/docs-budget.scan.test.ts hold, against src/lib/docs-budget.baseline.json:

- CLAUDE.md's bytes and lines, and the bytes loaded in every session (CLAUDE.md, its imports, unpathed .claude/rules files), are
  reported; what is held is the part outside the Storefront and Admin index (above), since a new rule adds its index line.
- No new import in CLAUDE.md, and no .claude/rules file without a paths list.
- Lines over 500 characters: none in CLAUDE.md; counts that only fall in the rules, the decisions' prose and the living docs.
- Table rows over 500 characters, per file, which only fall (not docs/decisions.md, whose rows the 4,000-byte rule holds).
- A new rule or decision is at most 4,000 bytes; the old large ones are listed and may not grow.
- A rule file's headings are at most 10,000 bytes together; a decision number stands once.
- The ten never-sentences stay in CLAUDE.md; a tracker row is at most 300 characters; one line of CLAUDE.md names the plan.
- A dated report or evidence folder under docs/audits has an ignore file that covers it.
- `node scripts/docs-ratchet.mjs` lowers the baseline; no flag raises it.

## CLAUDE.md

The bytes of CLAUDE.md outside its Storefront and Admin sections only fall: src/lib/docs-budget.scan.test.ts fails when they rise
above src/lib/docs-budget.baseline.json (key claudeOutsideIndex).
Inside the two sections a new rule adds one line, at most 200 characters, that equals the start of its heading in docs/rules
(src/lib/rules-index.test.ts pairs them).
When the figure falls, lower the baseline in the same change: the test says so.

## Decisions and the rules' names (step 0.41)

src/lib/decisions.scan.test.ts fails when a decision number stands twice, when a row stands outside the one Settled table, or when
a stub row from `node scripts/claim-decision.mjs` is left without its text for over 14 days.
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
