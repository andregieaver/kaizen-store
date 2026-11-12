# DC-2 ✓ decisions.md cannot be searched with the harness's search tool, a row runs to 18 KB, and the newest 197 rows sit under the wrong heading

The written rules and the agents' context (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.40.
- **Second check:** corrected.
- **Where:** `docs/decisions.md:8-378`, `docs/decisions.md:420-707`, `docs/decisions.md:708-904`, `docs/decisions.md:782`, `docs/decisions.md:897`, `src/lib/docs-content.test.ts:43`, `src/lib/parity.ts:313-317`, `scripts/parity.mjs:44`, `src/lib/parity.test.ts:441`, `README.md:17`, `docs/audits/code-review-2026-11.md:254`
- **Evidence:** decisions.md is 1,330,879 bytes in 931 lines, 564 rows. 545 rows are over 500 characters, and lines that long hold 97.8% of the file. The Grep tool in content mode prints no text for such a line: a search for '^\| D566 \|' returned '897:[Omitted long matching line]' in this session. A Read of one line returns it whole (tested at 2,535 and 17,985 characters), so a look-up is two calls and costs the row: median 1,940 bytes, p90 3,731, largest 17,985 (D442, line 782, which tells the docs portal's build in four dated instalments with test lists and a CI run). A table row is always one line, so no wrapping can fix this inside a table. From line 708, D366 to D573 (197 rows) follow the last paragraph of '### Migration versions' with no blank line and no header, so they do not render as a table. Rows are not uniform: 170 have 2 cells, 379 have 4, 15 have 3, 5 or 6 (a pipe inside code). Three readers parse the rows by the pattern '| Dnnn |' at a line's start: docs-content.test.ts:43, and parity.ts:313-317 as used by scripts/parity.mjs:44 and parity.test.ts:441. Every row opens with a bold lead; cut at its first bracket, stop or colon it is 42 characters at the median and 250 at most.
- **Cost today:** One look-up: a search that shows only a line number, then a Read of the whole row, about 490 tokens at the median and up to 4,500 (estimates). A keyword search of the decisions shows no text at all. The file grew by 34 rows in 35 hours. Paid by: An agent's session
- **Saving:** A search then shows the decision's text instead of a line number, for all 564 decisions, and the table renders again. docs/decisions.md falls from 1.33 MB to about 75 KB (index and prose, estimate). No token saving is claimed for a look-up by ID: it already costs the row's own size.
- **Risk:** The split is mechanical but the rows are not uniform (2 to 6 cells, one escaped pipe): the whitespace-collapsed comparison in step 3 catches a lost or doubled cell. If the index rows lose the '| Dnnn |' shape, docs-content.test.ts and parity.test.ts fail at once. 564 new files change every blame line of the decisions; the old file stays in history. Shortening old texts by hand risks losing a reason: do not do it in this change.
- **Already tracked:** Code review step 1.10 (FH4), Open: split with a generated index and a scan test. New here: the search tool's 500-character limit as the reason for a file per decision, the misplaced 197 rows, the index kept as rows so no reader changes, and the proof of no changed word.

## The fix

1. Now, on its own: move lines 708-904 of docs/decisions.md to directly after line 378 (the Settled table's last row) with a small node script, not by hand (the lines run to 18 KB). Check that rg -c '^\| D\d+ \|' docs/decisions.md still prints 564 and that wc -c is unchanged.
2. Now: one line in CLAUDE.md's core on looking a decision up: search for '^\| D178 \|' to get the line number, then read that one line. Put it in with DC-1's commit (the DC-3 ratchet refuses a rise on its own).
3. With step 1.10: add scripts/decisions.mjs with three commands shaped like scripts/parity.mjs (split, write, check). 'split' runs once: for each row write docs/decisions/D{n}.md with line 1 '# D{n}: {bold lead}', line 2 'Date: {the cell that is a date, or empty}', then the other cells as paragraphs, broken at sentence ends so no line is over 500 characters and no break falls inside a code span. It changes no word and proves it: each file's text with whitespace collapsed must equal its row's cells with whitespace collapsed, or the script exits 1.
4. 'write' regenerates the Settled table in docs/decisions.md between two markers as an index: one row per decision, '| D566 | **short title** | date | [text](decisions/D566.md) |', the short title being the bold lead up to its first bracket, stop or colon. Rows still begin '| Dnnn |', so the three readers pass unchanged. Keep the prose sections (Selling from Norway, Open) in docs/decisions.md.
5. Move lines 420-707 (the Migration versions prose and list) to docs/decisions/migration-versions.md (DC-10 decides whether the instruction to add to it goes).
6. Add src/lib/decisions.scan.test.ts: each docs/decisions/D*.md starts '# D{n}:' matching its file name; the index equals what 'write' would produce ('check'); no ID twice; no line over 500 characters in docs/decisions.
7. Update the words that say where a decision's text is: README.md:17, the look-up line from step 2 (now 'open docs/decisions/D178.md'), docs/parity/WAVES.md:75, and the messages at src/lib/docs-content.ts:449 and src/lib/parity.ts:304.
8. Set step 1.10 in the code review's Progress table to Done with the date and the commit, and correct FH4's row (line 254): the limit that matters is the search tool's 500 characters, and per-hundred files would be 147 to 349 KB.

**Done when:** ls docs/decisions/D*.md | wc -l prints 564; awk 'length($0)>500' docs/decisions.md docs/decisions/D*.md | wc -l prints 0 (today 548 in decisions.md); rg -c '^\| D\d+ \|' docs/decisions.md prints 564; src/lib/decisions.scan.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/docs-content.test.ts:43 and :185: a docs portal article's 'sources' must have a row in docs/decisions.md. The index keeps the rows.
- src/lib/parity.ts:313-317 (decisionIds), scripts/parity.mjs:44, src/lib/parity.test.ts:180 and :441: the same row pattern.
- docs/audits/code-review-2026-11.md:432: step 1.10's done-when ('no decisions file is over about 100 KB'). A file per decision meets it (largest 18 KB); the index is about 60 KB (estimate: 564 rows of about 110 bytes).
- CLAUDE.md:77 and README.md:17 name the file; 81 mentions in 45 docs keep working because docs/decisions.md stays as the front door.
- 19,273 citations of decision IDs in source need no change: the ID is the file name.

**Comes after:** Steps 1 and 2: nothing; Steps 3 to 8: DC-10 (where the migration list goes) and DC-3 (the ratchet then holds the 500-character line)

**Notes:** Steps 1 and 2 take minutes and are safe; do them at once. A file per decision also ends hand-merging of one table by sessions working at once (DC-12).
