# TC-1 ✓ One push type-checks the same commit five times; three of the checks hide inside CI's builds

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.38.
- **Second check:** confirmed.
- **Where:** `.github/workflows/ci.yml:55-56`, `.github/workflows/ci.yml:109-110`, `.github/workflows/ci.yml:152`, `.github/workflows/ci.yml:206`, `.github/workflows/ci.yml:249`, `.github/workflows/ci.yml:297-305`, `next.config.ts:39-46`, `tsconfig.json:25-33`, `docs/build-memory.md:30`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useTypeScriptCli.md:58-62`
- **Evidence:** next.config.ts:46 skips the build's type check only on Vercel, so `pnpm build` in the e2e, hosts and signed-in jobs (ci.yml:152, 206, 249) each runs it. In this machine's build the TypeScript step took 182.9 s of 262.0 s (build.log: 'Finished TypeScript in 3.0min'). Next's doc says the build checks the complete project of the tsconfig, test files included, and that typescript.ignoreBuildErrors skips the step. The static job (ci.yml:56) and the quick gate (ci.yml:302) run `pnpm typecheck` on the same tsconfig. Lint runs twice (55, 299). `pnpm db:check` runs in each of the 3 integration shards (110, matrix at 86) although it reads only the repository. With a migration pending the gate's steps are skipped, so the count is four.
- **Cost today:** About 9 runner-minutes of repeated type check per push in the three build jobs (3 x 183 s measured here; GitHub's runners differ), each under a 7 GB heap limit, and about 3 more where static and the gate both check. At about 35 CI runs a day that is 5 to 7 runner-hours a day (estimate). The three browser jobs each end about 3 minutes later than needed, and `release` waits for all of them, so every migration release is about 3 minutes later. Paid by: CI on every code push; the owner waits longer for a release with a migration
- **Saving:** Steps 1-3: about 9 runner-minutes per push and about 3 minutes off the wall time of each browser job (from the 183 s measured here), so a release with a migration is about 3 minutes sooner. Step 5: one more type check (about 3 minutes) and one lint per push.
- **Risk:** Low for steps 1 to 4. What could break: a type error that only the build's own check would see. There is none: the build checks the same tsconfig project as `pnpm typecheck`, with the same route types from `next typegen`. It would be noticed by static going red on the same push. Step 5 is medium because it touches the release conditions; test it with a push that carries a seeded lint error: `pending` must fail and nothing may deploy.
- **Already tracked:** Partly. Code review FH10, step 1.8 (Open) tracks the three cold builds. The type check inside them and the doubled lint, type check and db:check are not tracked.

## The fix

1. next.config.ts:39-46: beside ON_VERCEL add `const SKIP_TYPECHECK = ON_VERCEL || process.env.SKIP_BUILD_TYPECHECK === "1";` and set `typescript: { ignoreBuildErrors: SKIP_TYPECHECK }`. Rewrite the comment at lines 44-45: the type check is the static job's and the quick gate's; CI's browser jobs set SKIP_BUILD_TYPECHECK; a local `pnpm build` checks as before.
2. .github/workflows/ci.yml: add `SKIP_BUILD_TYPECHECK: "1"` to the `env:` block of the jobs e2e (lines 137-141), hosts (188-195) and signed-in (233-238). Change nothing else in those jobs.
3. .github/workflows/ci.yml:109-110: give the step 'Migrations match the schema' `if: matrix.shard == 1`.
4. Words in the same change: docs/build-memory.md:30 (CI's builds no longer check; static and the gate do); the sentence in CLAUDE.md's Commands section about Vercel's build skipping the type check (add that CI's browser jobs skip it too); a commented line for SKIP_BUILD_TYPECHECK in .env.example; a decision row in docs/decisions.md; a note on step 1.8 in the Progress table of docs/audits/code-review-2026-11.md and a line in its change log.
5. Optional and separate (medium risk): lint and types once per push. In `pending`, drop `steps.status.outputs.pending == 'false' &&` from the lint and type-check steps (ci.yml:298 and 301) so they run on every push to main, with or without a migration. In `static`, give `pnpm lint` and `pnpm typecheck` (ci.yml:55-56) `if: github.event_name != 'push' || vars.AUTO_MIGRATE != 'true' || vars.DEPLOY_VIA_CI != 'true'`, so pull requests and a repository with the gate switched off still check there. `release` already requires `needs.pending.result == 'success'` (ci.yml:343), so a red lint or type check still holds a migration.

**Done when:** On the next push to main without a migration, the `pnpm build` logs of the e2e, hosts and signed-in jobs contain no 'Running TypeScript' line, the run shows `tsc` in two jobs only (static and pending), and 'Migrations match the schema' ran in one integration shard.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/ci-playwright.scan.test.ts reads ci.yml (Playwright image tags, the jobs that install a browser): untouched by these edits, must stay green.
- src/lib/next-config-headers.test.ts imports next.config.ts and src/lib/chromium-trace.test.ts reads its text; neither looks at the typescript key (rg).
- The written rule 'CI's builds still check' (docs/build-memory.md:30, next.config.ts:44-45) changes. Its purpose, a type error caught before or beside the deploy, is kept: static checks every push and pull request, the gate checks before every deploy without a migration, and `release` needs static.
- CLAUDE.md, Commands: the sentence on Vercel's build. docs/audits/code-review-2026-11.md: finding FH10, step 1.8 (Open).
- src/lib/env-example.scan.test.ts scans src only, so it does not force the new variable into .env.example; add it anyway, the README says the file names every variable.

**Notes:** Do steps 1 to 4 first, alone: three lines of YAML and one of TypeScript. Leave step 5 until TC-12 and TC-4 have made lint and the gate's check cheap; it then removes the last duplicate.
