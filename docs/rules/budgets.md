# Rules: Budgets and checks

Numbers the repository holds, and the checks that hold them. A sentence about a budget, a check or how CI runs goes here, never in
CLAUDE.md: CLAUDE.md is loaded by every session and is held at its size (below). Step 1.1 of the bloat review
(docs/audits/bloat-review-2026-11.md) adds the table of every baseline file.

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
