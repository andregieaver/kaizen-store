# DC-6 ✓ The trackers a fix must consult keep their finished work in the way: the code review's table grows 0.9 KB a step, and 12 open PSI items hide among 93 ticked

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 0.41.
- **Second check:** confirmed.
- **Where:** `CLAUDE.md:444-448`, `docs/audits/code-review-2026-11.md:26-135`, `docs/audits/code-review-2026-11.md:31`, `docs/audits/code-review-2026-11.md:136-164`, `docs/audits/psi-followups.md:1-5`, `docs/audits/psi-followups.md:61`, `docs/audits/psi-followups.md:482`
- **Evidence:** CLAUDE.md:446-448 says to read the Progress table before starting a fix from the code review. Of its 73 steps, 14 are Done, 4 In progress and 55 Open. The 18 rows with notes total 16,641 bytes (average 925, largest 1,615); 15 are over 500 characters, so a search for a step shows no text. The document's own rule (line 31) asks only for the date and the commit in Notes, and a change log (lines 136-164, 3,330 bytes) tells the same steps again. CLAUDE.md:444-445 says to tick an item in psi-followups.md when a change does it: that file is 60,043 bytes with 93 ticked items and 12 open ones (2,428 bytes) at lines 61, 116, 120, 126, 145, 253, 270, 276, 353, 446, 477 and 482. No test or script reads either file.
- **Cost today:** About 5,400 tokens per fix session today for the Progress table, about 17,000 when all 73 rows carry notes of the same size (estimates). To see whether a change does an open PSI item, an agent reads up to 60 KB (about 15,000 tokens, estimate) for 2.4 KB of open items. Only sessions that work from these lists pay. Paid by: An agent's session
- **Saving:** About 4,000 tokens per fix session now and about 15,000 by the end of the plan (estimates). For the PSI list, about 3 KB to read instead of 60 KB when looking for open items.
- **Risk:** Low. A note cut too far loses how a step was verified: step 2's check against the decision and the change log prevents it. Moving PSI items changes their line numbers; nothing cites them by line.

## The fix

1. docs/audits/code-review-2026-11.md:31: make the rule exact: Notes holds the date, the commit and the decision's ID, at most 200 characters; what was found goes in the decision and in one line of the change log.
2. Rewrite the 18 rows with notes to that shape. Before cutting a note, check that each fact is in the step's decision or in the change log (lines 136-164); move a missing fact to the change log, do not drop it.
3. docs/audits/psi-followups.md: add a section '## Open' directly under the introduction and move the 12 unticked items into it, each keeping its ID. Leave the 93 ticked items in their dated sections. Say in the introduction that a new deferred item goes under Open and moves to its section when ticked.
4. CLAUDE.md:444-445: point at the Open section ('tracked in docs/audits/psi-followups.md under Open').
5. Add to DC-3's test: no row of the Progress table over 300 characters.

**Done when:** No row between '## Progress' and '**Change log**' in docs/audits/code-review-2026-11.md is over 300 characters (today 15 are over 500), and rg -n '^\s*- \[ \]' docs/audits/psi-followups.md lists all open items within one section before the first '## Done' heading.

**Tests and rules that hold today's behaviour, and change with it:**

- CLAUDE.md:444-448: the two instructions that make these files required reading.
- docs/audits/code-review-2026-11.md:28-35: the table's own rules (Notes holds date and commit; a wrong finding is corrected in its row; a change log line per session).
- No test or script reads either file (searched src, scripts and e2e for both names: none).

**Notes:** I added psi-followups.md to this finding (the skeptic named it in a note): same shape, same fix. This review's own plan should follow the same rule from its first day: status, date, commit, decision.
