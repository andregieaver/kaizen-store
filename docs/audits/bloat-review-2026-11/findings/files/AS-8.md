# AS-8 ✓ The decisions log is one 1.33 MB file and keeps growing; CLAUDE.md is 43 KB in every agent session

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 2.24.
- **Second check:** confirmed.
- **Where:** `docs/decisions.md:1`, `CLAUDE.md:1`, `docs/audits/code-review-2026-11.md:67`, `docs/audits/code-review-2026-11.md:254`, `src/server/ratchet.scan.test.ts:1`
- **Evidence:** Re-measured: docs/decisions.md is 1,330,879 bytes in 931 lines, the longest line 17,985 characters; CLAUDE.md is 43,361 bytes in 448 lines and is loaded into every agent session (this one too). The code review measured 1.24 MB and 39.5 KB on 9 November. The history here is shallow, so growth before 10 November rests on the review's own line 254.
- **Cost today:** Estimate at four characters a token: about 11,000 tokens per session for CLAUDE.md; the decisions log (about 330,000) cannot be opened whole by any session. Paid by: An agent's session.
- **Saving:** About 10,000 tokens per agent session (the code review's estimate).
- **Risk:** Low. A rule moved out of CLAUDE.md must still be found when it applies; docs-context plans how.
- **Already tracked:** Yes: FH4 and FH5, code review step 1.10 'Make the written rules cheap to read', Open. Not new.

## The fix

1. Do code review step 1.10 as this review's docs-context findings DC-1 to DC-3 plan it: one file per hundred decisions with a generated index, migration versions in their own file, CLAUDE.md's feature index moved to the area files. This dimension adds no second plan.
2. Add the guard here: in scripts/lib/ratchet-count.mjs count the bytes of CLAUDE.md (43,361 today) and the longest line under docs/decisions* (17,985 today); src/server/ratchet.scan.test.ts lets both only fall; node scripts/ratchet.mjs lowers them.

**Done when:** wc -c CLAUDE.md prints under 15,000 and no decisions file is over 200 KB, both held by ratchet.scan.test.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- The test that makes each new feature add a line to CLAUDE.md (docs-context DC-3 names it) changes with step 1, or the ratchet and that test fight.
- CLAUDE.md is the owner's instruction file: its trim is the owner's call (code review open question 5).
- docs/audits/code-review-2026-11.md: set step 1.10 to Done with the date and commit.

**Comes after:** docs-context DC-1, DC-2 and DC-3; code review step 1.10

**Notes:** A pointer, not a second plan: docs-context owns the fix and the owner's decision on CLAUDE.md. Kept here only so the assets list is complete.
