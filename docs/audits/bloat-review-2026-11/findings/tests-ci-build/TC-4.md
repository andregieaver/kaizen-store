# TC-4 ✓ The type check is one 8,003-file program: 3 minutes and a 7 GB heap limit, with no single type to blame

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 2.42.
- **Second check:** corrected.
- **Where:** `tsconfig.json:25-33`, `package.json:10`, `.github/workflows/ci.yml:35-37`, `.github/workflows/ci.yml:300-302`, `scripts/next-build.mjs:1-9`, `next.config.ts:34-46`, `docs/build-memory.md:23`, `docs/build-memory.md:39`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md:14-40`, `src/components/admin/product-editor.tsx:25-26`
- **Evidence:** tsconfig.json includes **/*.ts and excludes only node_modules, so tests, e2e, docs and scripts are in the one program: 8,003 files, of which 1,221 unit tests, 556 integration tests and 232 e2e files (verified report, from .next/cache/.tsbuildinfo). The verified probes: an empty file needs 121 MB; schema.ts and its imports 573 MB; every admin catalogue 537 MB; page-content.ts 358 MB; one admin component, product-editor.tsx, 2,599 MB and 33.9 s for 3,026 files, because it imports server actions and TypeScript follows them into the server code. That is 4 to 6 MB per 1,000 lines for a program of about 1.12 million lines of its own plus 556,829 of definitions. Tests and e2e are 39% of the project's own syntax trees and 24% of the whole program by characters. Next 16.4's doc says `next build` runs the project's own tsc and supports TypeScript 7, and that typescript.tsconfigPath selects the project. I did not re-run the probes: a full type check was ruled out for this review.
- **Cost today:** 182.9 s here and a 7,168 MB heap limit each time it runs: 5 times per push in CI today (TC-1), once before every push in each agent session, and about 3 of the gate's 5 min 11 s before each deploy. Vercel's 8 GB machine cannot run it (docs/build-memory.md), so the deployed build is never the checked one. Paid by: CI, every agent session, the owner in minutes before each deploy and in the risk that an unchecked build deploys
- **Saving:** Step 2: the gate's check holds 39% fewer syntax trees of the project's own files and 24% fewer characters in all; check time was not measured, so expect a fifth to a third off about 3 minutes before each deploy (estimate). Step 3: unmeasured here; the vendor's figures say several times faster, and if that holds the check fits Vercel's machine. Step 5: nothing on a cold full check.
- **Risk:** Medium. Step 2: a type error in a test is no longer caught before the deploy, only by static beside it; tests do not ship, so nothing wrong reaches production. Step 3: two compilers may disagree; noticed in the week both run. Step 4 puts memory back on Vercel's build, which is at its edge; do it only with the measured peak.
- **Already tracked:** No. FH10 step 1.8 (Open) gives the build room or builds in CI; nothing addresses the size of the check itself.

## The fix

1. Measure where check time goes, once: on a machine with 8 GB free run `pnpm exec next typegen && pnpm exec tsc --noEmit --incremental false --generateTrace <a folder outside the repo>` and list the 20 slowest files from the trace. Put the list in the decision; it says whether a few files (the product editor's reach into server actions is the first suspect) are worth an explicit return type or a type-only entry point.
2. Give the gate its own project. New tsconfig.app.json: `{ "extends": "./tsconfig.json", "exclude": ["node_modules", "**/*.test.ts", "**/*.test.tsx", "e2e", "e2e-live", "docs", "scripts", "test", "src/test", "playwright.config.ts", "playwright.live.config.ts", "vitest.config.mts", "vitest.integration.config.mts"] }`. package.json: add `"typecheck:app": "next typegen && tsc --noEmit -p tsconfig.app.json"`. ci.yml:302: the gate runs `pnpm typecheck:app`. Static (ci.yml:56) and the local rule keep the whole `pnpm typecheck`.
3. Try the native compiler for the check alone. `pnpm add -D ts7@npm:typescript@^7` (an alias, so `typescript` stays 6.0.3 for ESLint's parser), a script `typecheck:native` that runs that package's tsc with --noEmit after `next typegen`. Run it beside `pnpm typecheck` in static for a week without failing the job; compare errors on a commit with one seeded type error and record seconds and peak memory with TC-8's recorder. If they agree, the gate and the local rule switch to it.
4. If the native check, or the app-only project, fits under Vercel's 8 GB with the compile (measure under a cgroup cap as docs/build-memory.md did), set `typescript: { tsconfigPath: "tsconfig.app.json" }` and let Vercel's build check again; that closes the watch item at docs/build-memory.md:39.
5. Later, and only with kept build info (TC-9): make src/lib (266,547 lines) a referenced project. First move the types that 10 lib files import from server, components, app or db into lib.
6. Words: docs/build-memory.md:23 (new figures), the comment at ci.yml:35-37, CLAUDE.md's Commands list (typecheck:app), a decision row, a note on code review step 1.8.

**Done when:** `pnpm exec tsc -p tsconfig.app.json --listFilesOnly | rg -c '\.test\.tsx?$|/e2e/'` prints nothing, and the gate's type-check seconds in CI's summary are at least 20% below static's full check on the same run.

**Tests and rules that hold today's behaviour, and change with it:**

- tsconfig.json stays as it is, so `next build` (which reads it) and editors see the same program as today; after TC-1 no CI build checks.
- `pnpm lint` must stay green after the alias install: eslint-config-next's TypeScript parser needs `typescript` to resolve to 6.x.
- .gitignore:40 already ignores *.tsbuildinfo, so tsconfig.app.tsbuildinfo is not committed.
- docs/build-memory.md (D378) is the written rule for why Vercel skips the check; step 4 reverses it only with a measured peak under the cap, recorded in that file's table.
- CLAUDE.md:12 (type check before every push) is unchanged: agents edit tests too, so they keep the whole check.

**Comes after:** TC-1; TC-8 (the recorder, for steps 3 and 4)

**Notes:** Steps 1 and 2 are small (S) and can ship right after TC-1. The brief's suspects (as const catalogues, the Drizzle schema's inferred types, zod over page-content) were measured by the auditor and the skeptic and are each about a tenth of the program: rewriting them as explicit interfaces would not fix the check.
