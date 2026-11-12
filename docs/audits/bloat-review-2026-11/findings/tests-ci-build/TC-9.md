# TC-9 ✓ CI keeps nothing between runs except pnpm's store

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** S. **Confidence:** low. **Step:** 2.42.
- **Second check:** corrected.
- **Where:** `.github/workflows/ci.yml:50-53`, `tsconfig.json:15`, `.gitignore:40`, `vitest.config.mts:8-18`, `docs/audits/code-review-2026-11.md:45`
- **Evidence:** Each job's only cache is setup-node's `cache: pnpm`. tsconfig.json sets incremental and .gitignore:40 ignores *.tsbuildinfo, so every type check in CI starts cold. Vitest 5's fsModuleCache defaults to true and writes node_modules/.vitest-cache; CI starts empty. The verified report put the Vitest half at about 3 CPU-seconds, the time esbuild needs for every file. My cold-against-warm samples under Vitest say more: 22 component files took 24.0 s cold and 16.3 s warm (1,521 modules), 41 unit files 10.9 s and 8.4 s (394 modules), about 5 ms a module. The unit tests reach 3,461 modules, so about 17 to 22 s of a cold unit run is transform (estimate). Still small.
- **Cost today:** Every type check starts from nothing on each of about 35 CI runs a day: 183 s here per check. Vitest's transforms cost roughly 20 s of each cold unit run and less in each integration shard (estimate from the samples). Paid by: CI
- **Saving:** Not measured: a full type check was ruled out for this review. An incremental check still parses the whole program and re-checks only changed files and what depends on their public shape, so most of the 183 s should go for a small commit. The Vitest part is about 20 s of a cold unit run (estimate).
- **Risk:** Low. A stale build-info file costs only time: tsc compares file versions by content. What could break: nothing in what is checked.
- **Already tracked:** No. Step 0.4's note records 'nothing is cached between runs' for the test database only.

## The fix

1. After TC-1 and TC-8 (the recorded seconds). In `static` and `pending`, after `pnpm install`, add a cache step for `tsconfig.tsbuildinfo` (and `tsconfig.app.tsbuildinfo` once TC-4 exists) with key `tsbuildinfo-${{ hashFiles('pnpm-lock.yaml', 'tsconfig*.json') }}-${{ github.sha }}` and restore-keys `tsbuildinfo-${{ hashFiles('pnpm-lock.yaml', 'tsconfig*.json') }}-`.
2. Compare the recorded type-check seconds of ten runs that restored the file with ten that did not. Keep the step only if the median falls by a third or more; otherwise remove it and write the result in the decision.
3. Second, smaller experiment in the same step: add `node_modules/.vitest-cache` to the cached paths of `static` and compare the unit run's seconds the same way.
4. Do not cache .next/cache (2.6 GB) or the test-database template (5.9 s to build, timed here).

**Done when:** Over ten runs each, the type-check seconds in CI's summary have a median at least a third lower with a restored tsconfig.tsbuildinfo than without; if not, the cache step is gone and the decision says so.

**Tests and rules that hold today's behaviour, and change with it:**

- tsconfig.json:15 `incremental: true` is what writes the file; nothing else changes.
- Code review step 0.4's note ('nothing is cached between runs') describes today; update it if a cache is kept.
- ESLint's cache is TC-12 and uses the same kind of step; keep the three paths in one cache step per job so a job restores once.

**Comes after:** TC-1; TC-8

**Notes:** An experiment with a stop rule, not a sure win. If TC-4's native compiler holds, the check may be fast enough cold and this is moot.
