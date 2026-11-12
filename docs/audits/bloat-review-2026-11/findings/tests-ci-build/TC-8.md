# TC-8 ✓ Nothing measures the build, the type check, lint or the test run, and the build is at its limit

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 1.12.
- **Second check:** corrected.
- **Where:** `docs/build-memory.md:40-46`, `scripts/next-build.mjs:1-10`, `next.config.ts:79-88`, `node_modules/next/dist/docs/01-app/02-guides/memory-usage.md:122-131`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/enablePrerenderSourceMaps.md:9-41`, `e2e/performance.spec.ts:21-58`, `.github/workflows/ci.yml:55-57`
- **Evidence:** docs/build-memory.md says the margin on Vercel is about 0.8 GB and was crossed on 11 November while collecting page data with one worker. The build prerendered 850 pages on 27 October and 1,426 here (build.log). This machine's build peaked at 7.61 GB for the whole machine and wrote about 3.9 GB, of which 672 MB is server source maps (verified report). Budgets exist for browser scripts and page weight only (e2e/performance.spec.ts); no CI step records build seconds, peak memory, type-check seconds, lint seconds, unit seconds or how many modules a route reaches. The numbers in this review had to be measured by hand. Next's memory guide names two switches, experimental.serverSourceMaps: false and enablePrerenderSourceMaps: false (default true since 16.3); next.config.ts sets neither.
- **Cost today:** A deploy that fails at random at the 8 GB edge, and growth nobody sees until it does: each new route and each new import adds to it. Today a killed deploy costs a retry; once stores are open it delays a fix that owners and shoppers wait for. Paid by: The build, and the owner when a deploy is killed
- **Saving:** No time saved by itself. It turns silent growth into a red run with a number, and gives TC-4, TC-9 and TC-12 their before and after. The source-map switches are unknown until measured; Next's guide only says they can reduce build memory.
- **Risk:** Low. A ceiling set too tight fails runs on a slow runner; start at plus 25% and use the median of ten runs. What could break: nothing in the app. The source-map switches change only error positions in Vercel's logs.
- **Already tracked:** Partly. FH10 step 1.8 (Open) and its question 2 cover the 16 GB machine or a prebuilt deploy. Budgets for build, check and test time and the source-map switches are not tracked.

## The fix

1. scripts/next-build.mjs: after `next build` returns, print one line with the wall seconds and the peak memory. Read the peak from /sys/fs/cgroup/memory.peak where it exists; where it does not, run the build with spawn and sample /proc/meminfo every 2 s, as this review's scratchpad/m/run-build.sh did. On Vercel the line lands in the build log, so every deploy shows its margin to 8 GB.
2. New scripts/timed.mjs: `node scripts/timed.mjs <label> -- <command>` runs the command, appends label and seconds (and the peak, as above) to $GITHUB_STEP_SUMMARY when set, exits with the command's code, and fails when the seconds pass the label's ceiling in a new scripts/ci-budgets.json. Start each ceiling at the first recorded value plus 25%.
3. .github/workflows/ci.yml: wrap `pnpm lint`, `pnpm typecheck` and `pnpm test` in static (55-57), the gate's three steps (299-305) and `pnpm build` in the e2e job (152) with it.
4. The third budget is the import ratchet of TC-2 (largest cycle, reach of catalog.ts).
5. An experiment, on Vercel only, measured under an 8 GB cgroup cap as docs/build-memory.md did: add `serverSourceMaps: false` to the ON_VERCEL spread at next.config.ts:82, then `enablePrerenderSourceMaps: false`. Keep a switch only if the capped peak falls by 0.3 GB or more, and add the row to the table in docs/build-memory.md. The prerender switch acts after 'Generating static pages'; the kill of 11 November came earlier, while collecting page data, so it may not touch the phase that failed.
6. Words: docs/build-memory.md 'Watch' names the budget file; a note on code review step 1.8.

**Done when:** Every CI run's summary lists seconds for lint, type check, unit run and build and the build's peak memory; a run fails when one passes its ceiling in scripts/ci-budgets.json; and Vercel's build log ends with the peak-memory line.

**Tests and rules that hold today's behaviour, and change with it:**

- docs/build-memory.md (D378) is the record of what was measured; new measurements go in its table.
- scripts/next-build.mjs is `pnpm build` everywhere; a unit test for the peak reader (pure parsing of the two files' text) belongs beside scripts/lib, as scripts/await-deploy.mjs has its exported deployVerdict tested.
- src/lib/ci-playwright.scan.test.ts looks for 'playwright install' in job text: wrapping other steps does not affect it.
- Without server source maps an error on Vercel shows compiled positions; CLAUDE.md's logging rule (log.ts, ids and counts) is unaffected, CI's builds keep the maps.

**Notes:** Do steps 1 to 3 early: every other finding here has a done-when that reads these numbers.
