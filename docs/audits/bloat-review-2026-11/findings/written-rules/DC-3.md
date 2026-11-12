# DC-3 ✓ Nothing caps the written rules, and one test makes the always-loaded file grow with every feature

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 1.1.
- **Second check:** corrected.
- **Where:** `src/lib/rules-index.test.ts:28-43`, `docs/consolidation.md:12-13`, `docs/audits/code-review-2026-11.md:291`, `CLAUDE.md:133-399`, `src/server/ratchet.scan.test.ts:1-58`, `scripts/ratchet.mjs:1-42`, `.github/workflows/ci.yml:10-14`
- **Evidence:** CLAUDE.md was cut from 382 KB to 32 KB on 30 October (consolidation.md:12-13), was 39.5 KB on 9 November (code review FH5) and is 43,361 bytes now: +35% in 12 days. docs/rules went from 374 KB to 566 KB in the same time. decisions.md gained 34 rows in the clone's 35 hours. rules-index.test.ts:30 and :38 fail when a rule heading has no line in CLAUDE.md, so each new rule adds an always-loaded line. A ratchet exists for code (src/server/ratchet.scan.test.ts with src/server/ratchet.baseline.json and scripts/ratchet.mjs); none exists for docs. CI runs nothing on a push of Markdown alone (ci.yml:10-14), and a run of ci.yml ends in a deploy, so a docs check cannot simply be added to its paths.
- **Cost today:** About 0.95 KB a day added to what every session loads (about 240 tokens a day, average since 30 October); about 16 KB a day in docs/rules. It follows the number of features built, not the task in hand. Paid by: An agent's session, every later one
- **Saving:** Stops the regrowth measured above and keeps the savings of DC-1, DC-2 and DC-4 from being spent again. No token figure is claimed.
- **Risk:** A hard cap can push agents to write cryptic text: the baseline, the plain error and the --raise switch avoid that. The unit test runs in CI only with a push that carries code; the small workflow covers Markdown-only pushes, and it reports, it does not block. If the workflow were added to ci.yml's paths instead, every rules edit would deploy production.
- **Already tracked:** no (step 1.10 sets one-time targets and an index test, no standing size check)

## The fix

1. Add scripts/lib/docs-count.mjs (node built-ins only) that returns: CLAUDE.md's bytes and lines; per file, the number of lines over 500 characters in CLAUDE.md, docs/rules/**/*.md and docs/decisions.md (docs/decisions/** after DC-2); and each rule over 4,000 bytes with its size.
2. Add scripts/docs-ratchet.mjs and src/lib/docs-budget.baseline.json on the model of scripts/ratchet.mjs and src/server/ratchet.baseline.json. The first baseline is today's: CLAUDE.md 43,361 bytes and 448 lines; long lines: CLAUDE.md 1, docs/rules 156, decisions.md 548; 24 rules over 4,000 bytes. The script refuses to raise a number, except CLAUDE.md's size with --raise "reason", which writes the reason into the baseline so a rise is a visible choice. --check prints what rose and exits 1.
3. Add src/lib/docs-budget.scan.test.ts on the model of src/server/ratchet.scan.test.ts:22-58: nothing rises; a number that fell must be lowered in the baseline; a file not in the baseline has no long line; a new rule is at most 4,000 bytes. Each failure says where the overflow belongs: detail in the feature's doc or the decision, CLAUDE.md only what every change needs.
4. Add .github/workflows/docs-budget.yml: on push to main with paths CLAUDE.md, docs/rules/**, docs/decisions.md, docs/decisions/** and .claude/rules/**; one job that checks out and runs node scripts/docs-ratchet.mjs --check. No install, no deploy. Leave ci.yml's paths as they are.
5. One bullet in CLAUDE.md's Conventions names the budget, the test and the script.
6. When DC-1 lands: lower the baseline, add hard ceilings to the test (CLAUDE.md at most 15,000 bytes and 200 lines) and add the check on .claude/rules front matter (DC-1 step 8). When DC-4 lands: docs/rules long lines 0. When DC-2 lands: decisions long lines 0.

**Done when:** pnpm test src/lib/docs-budget.scan.test.ts passes with a baseline equal to today's numbers, and node scripts/docs-ratchet.mjs --check exits 1 when a 600-character line is added to a file under docs/rules.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ratchet.scan.test.ts, scripts/ratchet.mjs, scripts/lib/ratchet-count.mjs: the pattern to copy; CLAUDE.md:418-421 describes it.
- src/lib/rules-index.test.ts:30 and :38: the check that makes CLAUDE.md grow; it goes with DC-1 step 3.
- .github/workflows/ci.yml:10-14 and CLAUDE.md:15-17: Markdown-only pushes run nothing. The new workflow is separate so this stays true for ci.yml.
- src/lib/ci-playwright.scan.test.ts:14 names the two workflows it reads; a third file does not affect it.

**Notes:** Ship this first, with today's numbers, so it does not wait for the owner's answer on DC-1. The skeptic's later ceiling of 10,000 bytes is not reachable by removing the index alone (12,555 bytes remain); I set 15,000 until DC-1's how-to has moved.
