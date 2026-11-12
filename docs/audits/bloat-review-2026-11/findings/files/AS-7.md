# AS-7 ✓ Tailwind reads 22.5 MB that adds nothing to the CSS today: the test files and the migrations' SQL

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P3. **Effort:** S. **Confidence:** medium. **Step:** 0.35.
- **Second check:** corrected.
- **Where:** `src/app/globals.css:7`, `src/app/globals.css:9`, `docs/build-memory.md:34`, `docs/decisions.md:719`
- **Evidence:** globals.css points Tailwind at all of src except data (lines 7-8) and at supabase/migrations/*.sql (line 9); D378 chose both. The second check compared the built CSS's 1,833 class names with the code, the tests and the SQL: none exists only in the SQL, ten only in tests. The css dimension's second check (CS-6) ran Tailwind's scanner with and without these sources: 0.1 to 0.35 s of 0.42 to 0.74 s, and 436 bytes of CSS.
- **Cost today:** 22.5 MB of the 61.2 MB Tailwind reads on each build and dev start, 0.1 to 0.35 s (measured by CS-6), and ten stray selectors. Paid by: The build and developers. Small.
- **Saving:** About a third less text for Tailwind to scan; 0.1 to 0.35 s per build and 436 bytes of CSS (CS-6's measurement).
- **Risk:** A class used only inside a future migration's SQL would be lost if line 9 goes; today there is none.
- **Already tracked:** Partly: code review step 1.8 (FH10), Open; the rule is D378 in docs/build-memory.md. The same finding as css CS-6.

## The fix

1. Do it inside css CS-6, not apart. src/app/globals.css after line 8: @source not "../**/*.test.ts"; and @source not "../**/*.test.tsx";.
2. Remove line 9 (the migrations' SQL) only together with a written line in docs/build-memory.md: content seeded by a migration uses classes the code already names. D378 put the SQL in on purpose.
3. Compare the built stylesheet's class names before and after; only the ten names that tests alone use may go.

**Done when:** The built stylesheet has the same class names as today minus the ten that only tests name (order-1038, col-1, row-1 and the like), by the comparison script.

**Tests and rules that hold today's behaviour, and change with it:**

- docs/build-memory.md:34 and D378 (docs/decisions.md:719).
- CLAUDE.md, Commands: keep Tailwind's @source lines pointed at code, never at data or snapshots.
- No test pins the @source lines (CS-6).

**Comes after:** css CS-6 (the same change)

**Notes:** P3 on its own: a fraction of a second per build. Its worth is that a word in a test can no longer change the production stylesheet; CS-6 carries it.
