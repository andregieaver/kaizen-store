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
