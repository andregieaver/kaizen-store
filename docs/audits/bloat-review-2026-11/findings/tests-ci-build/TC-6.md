# TC-6 ✓ Every push pays the full checks twice: once by the agent, again by CI

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 2.43. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `CLAUDE.md:12`, `README.md:57`, `docs/capacity.md:97`, `.github/workflows/ci.yml:40-42`, `.github/workflows/ci.yml:266-269`, `.github/workflows/ci.yml:297-305`, `package.json:11-12`, `docs/audits/code-review-2026-11.md:43`, `docs/audits/code-review-2026-11.md:45`
- **Evidence:** CLAUDE.md:12 asks for lint, the type check and the tests before every push. Written and measured times: the unit run 5 min 34 s in a sandbox; the type check 183 s in this machine's build; lint about 3 minutes by my one-in-five sample (TC-12). The gate before the deploy runs lint, the type check and 6 smoke files (package.json:12); the full unit suite runs beside the deploy and does not hold it. There is no script for running only what a change touches, though Vitest 5 has `--changed <ref>` and `related`. By the import graph a change to one source file selects a median of 1 unit test file, 108 at the 90th percentile and 651 at most (money.ts); 84 directory-reading tests import nothing and must always run (verified report).
- **Cost today:** About 11 to 12 minutes of machine time and about 5 GB of memory before each push today (lint about 3, type check about 3, unit run 5 min 34 s), then lint and the type check twice more in CI. This is a deliberate safety rule, not waste by itself: a push to main is a deploy. Paid by: Every agent session, and the owner in elapsed time per change
- **Saving:** With B or C: a related run is typically 85 to 200 test files in place of 1,215, about 4 minutes of machine time per push per session (estimate from the written 5 min 34 s and the measured selection). B also ends the second full unit run. With A: only what TC-1, TC-3 and TC-12 bring.
- **Risk:** B: every deploy waits for the unit run in the gate, and a failing unit test is found there, minutes after the push, not before it; nothing deploys either way. C: a failing unit test outside the six smoke files can be live until someone reads the red run. `--changed` reads the import graph, so a test that depends on a file it does not import (a directory reader not yet renamed, a JSON read from disk) is missed; step 2's scan test is the guard. Before opening, a slower find hurts nobody; after opening, a slower deploy of a fix does.
- **Already tracked:** Partly. Step 0.2 (In progress) built the gate; widening it and the local rule are not tracked.

## The fix

1. No decision needed for the cheap half: do TC-1, TC-3, TC-12 and TC-5 first. They cut the cost of the present rule (lint to seconds after a session's first run, the unit run by about a quarter) without changing what is checked.
2. Make a related run possible. package.json: `"test:changed": "vitest run --changed origin/main --passWithNoTests && vitest run --project scans"`. For the second half, name every directory-reading test `*.scan.test.ts` (about 40 of the 84 are not, e.g. src/server/price-audit-scan.test.ts, src/lib/vat-readers.test.ts), add a `scans` project to the config of TC-3 (include src/**/*.scan.test.ts, excluded from `unit` and `db`), and add one scan test that fails when a unit test not named so calls readdirSync on src.
3. The owner chooses. A: keep the rule (everything before every push), now cheaper. B: before a push run lint, the type check and `pnpm test:changed`; the gate runs the whole unit suite in place of the six smoke files (ci.yml:303-305), so one place checks every push before it deploys and each deploy waits the unit run longer (5 min 34 s today, about 4 minutes after TC-3 by estimate). C: the local rule of B with the gate unchanged; the full unit suite reports beside the deploy, as the integration and browser suites do today.
4. Write the choice where the rule is written: CLAUDE.md:12, README.md:57, docs/capacity.md:97, a decision row, and step 0.2's note in the code review's Progress table.

**Done when:** The owner's choice is a decision row and CLAUDE.md:12 states it; `pnpm test:changed` exists and, after a one-line change to a file in src/lib, its two 'Test Files' lines add up to fewer than 250 files (1,215 in a full run).

**Tests and rules that hold today's behaviour, and change with it:**

- CLAUDE.md:12, README.md:57 and docs/capacity.md:97 state the rule; D5 (a push to main deploys) and D526 (the quick gate) are the decisions behind it.
- ci.yml:40-42 says why the gate is one job (each job is a runner to wait for): option B keeps it one job and makes it longer.
- package.json:12 `test:smoke` is named in ci.yml:305 and in CLAUDE.md's Workflow paragraph ('the money tests, D526'); option B changes both.
- Renaming tests to *.scan.test.ts changes no rule; src/lib/rules-index.test.ts and the docs that cite a renamed file by path (rg each name in CLAUDE.md and docs/rules) must be updated in the same change.

**Comes after:** TC-1; TC-3; TC-12

**Notes:** A process choice for the owner, not waste. My recommendation is B after TC-3: the deploy then waits about 4 more minutes, and what deploys has passed every unit test. If the wait matters more, C.
