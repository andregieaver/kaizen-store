# FM-8 ✓ Lists, tables, dates and selects are still hand-made per screen, and the counts are not held while the kit waits

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** L. **Confidence:** medium. **Step:** 1.17.
- **Second check:** confirmed.
- **Where:** `src/components/admin/ui/list.tsx:14`, `src/components/admin/ui/index.ts:1`, `docs/audits/code-review-2026-11.md:69`, `docs/audits/code-review-2026-11.md:72`, `scripts/lib/ratchet-count.mjs:72`
- **Evidence:** Counted by the planner over src/app/admin and src/components/admin (1,155 TSX files): 154 tables in 116 files; 436 native selects in 198 files; Europe/Oslo in 67 files and slice(0, 10) in 46; confirm( in 42 files; 31 files with a hand-made GET filter form; no shared pager (0 uses of one). The kit (src/components/admin/ui: bars, button, card, chip, focus-frame, insight, list, page-header) has no table, select, date or confirm part; its List is used in 89 files. The verified report measured 6,110 lines inside the tables, 2,000 of them in headers. Code review steps 1.12 to 1.15 plan the kit and scan tests at the end of each step; all four are open.
- **Cost today:** Up to about 2,000 lines of table markup a column-list part would not need (estimate: the header lines), and dates on the wrong day for a store outside Norway (FS5 in the code review), which matters once stores in other countries open. Paid by: The owner's admin and an agent's session.
- **Saving:** Up to about 2,000 lines of markup once the kit is used (estimate). The larger gain is one behaviour everywhere.
- **Risk:** Low. Step 1 is S and changes no screen. What could annoy: a count that blocks a screen with a good reason for a native select; the ratchet has no way to raise a number, so such a screen waits for the kit's Select or the count's pattern is narrowed with a note.
- **Already tracked:** code review steps 1.12, 1.13, 1.14 and 1.15: all Open. Their findings (FS4, FS5) already plan scan tests once built; holding the counts before that is the only new part.

## The fix

1. Hold today's numbers before building anything. In scripts/lib/ratchet-count.mjs add six counts over the two admin folders' TSX files: '<table' (154), '<select' (436), files with 'Europe/Oslo' (67), files with 'slice(0, 10)' (46), files with a call of confirm( (42), and raw form actions by one fixed pattern (record the number it gives; 86 to 128 by pattern). Wire them into scripts/ratchet.mjs, src/server/ratchet.baseline.json and src/server/ratchet.scan.test.ts as FM-7 step 1 does.
2. Then the kit as code review steps 1.12 to 1.15 say (Table, Select, the date formatter, ConfirmButton), list pages first; each conversion lowers a count.

**Done when:** src/server/ratchet.baseline.json holds the six counts at the numbers above and src/server/ratchet.scan.test.ts fails when a new admin screen adds a table, a native select, an Oslo date or a confirm( call.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ratchet.scan.test.ts and ratchet.baseline.json: gain the six counts.
- docs/audits/code-review-2026-11.md steps 1.12, 1.13, 1.14 and 1.15 (Open) and findings FS2, FS4, FS5, FS6: add a change-log line that the counts are held from now; the steps' own scan tests still come when each is built.
- docs/admin-style.md and the admin's look rule (D149): the kit's new parts are described there when built.
- Storefront rule D82 (choosing uses Dropdown, never a native select) is the storefront's; the admin's 436 native selects break no rule today.

**Comes after:** FM-7 step 1 shares the same three files; do both in one change

**Notes:** The kit itself is the code review's plan and is not restated. Only step 1 is new. The same ground is reported by the copied-code area (CP-3).
