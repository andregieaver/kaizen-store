# CS-6 ✓ Tailwind reads tests, SQL and message files: 37% of its candidates, 10 junk classes

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 1.2.
- **Second check:** confirmed.
- **Where:** `src/app/globals.css:1`, `src/app/globals.css:7`, `src/app/globals.css:9`, `docs/build-memory.md:34`, `docs/decisions.md:719`
- **Evidence:** globals.css:6-9 points Tailwind at all of src except src/data, and at supabase/migrations/*.sql. The planner compiled the sheet with and without the noise, with the project's own Tailwind: leaving out **/*.test.ts, **/*.test.tsx, src/test, src/lib/messages, src/lib/admin-messages, src/db and the SQL takes the scan from 5,931 files and 71,891 candidates to 3,984 files and 45,347, and the sheet from 1,750 classes to 1,740. The 10 lost are words in tests: order-1038, order-1042, col-1, row-1, row-2, m-1, sepia, block-1, md:mr-0, lg:ml-auto (436 B). The four migration files (4.0 MB) hold no class attribute (the verified report's regex; the planner's rg for className finds none). The SQL line dates from D378 (docs/decisions.md:719), a caution when the scan was first scoped; CLAUDE.md's own rule says the @source lines point at code, never at data. No test pins the lines.
- **Cost today:** 436 B of CSS, about 0.2 s of scan and about 55 MB of the Tailwind step's memory (221-223 MB against 160-169 MB, fresh process each). The real cost is coupling: a word in a test can add a class and rename the production stylesheet (part of the 6 admin-or-test-only commits of CS-3). Paid by: The build, slightly; a shopper's browser when a test-only change renames the sheet.
- **Saving:** 436 B of CSS, about 0.2 s and about 55 MB in the build's Tailwind step (measured); tests and texts can no longer rename the production stylesheet.
- **Risk:** Low. A class that only a message file or a migration names would be lost; today there is none (step 5 checks). Noticed as a missing style in e2e or by eye.
- **Already tracked:** Partly: D378 and docs/build-memory.md scoped the scan (done); this remainder is not tracked.

## The fix

1. Do it inside CS-1 (its steps 4 and 5 carry these lines). If CS-1 waits, do it alone: in src/app/globals.css delete line 9 (@source "../../supabase/migrations/*.sql") and add after line 8: @source not "../**/*.test.ts"; @source not "../**/*.test.tsx"; @source not "../test"; @source not "../lib/messages"; @source not "../lib/admin-messages"; @source not "../db".
2. Rewrite the comment at src/app/globals.css:1-5: Tailwind reads the code under src; not tests, interface texts, the schema, data or SQL.
3. src/lib/stylesheet-sources.scan.test.ts, rule 'Tailwind reads code only' (CS-3 step 3): the lines above are present and no @source leaves src.
4. docs/build-memory.md:34-35: change 'points Tailwind at src (without src/data) and the migrations' SQL' to the new list, with the reason: measured on 12 November 2026, the SQL and the message files add no class and the tests add 10 that nothing draws; a stored page is edited in production without a build, so it can never rely on the scan. Add the same sentence as a note to D378 in docs/decisions.md.
5. Build and compare the class lists: only the 10 classes above may be gone.

**Done when:** The built stylesheet holds none of the ten test-only classes (rg -o 'order-1038|order-1042|\.sepia\{' .next/static/chunks/*.css | wc -l gives 0; 3 today) and every other class it has today (1,739 of 1,749, compared with the planner's diffcls.mjs).

**Tests and rules that hold today's behaviour, and change with it:**

- New scan rule (step 3).
- Rule D378 (docs/decisions.md:719) and docs/build-memory.md:34-35 put the SQL in the scan on purpose, in case seeded content carried a class. Why that reason no longer holds: the four baseline files hold no class attribute, the classes kept in seeded pages are the themes' own names styled by the themes' CSS, and content made in production never passes through a build. Step 4 writes this down.
- CLAUDE.md, Commands: 'keep Tailwind's @source lines pointed at code, never at data or snapshots'. The change follows it.
- The e2e suite: no visible change is expected; it passes unchanged.

**Notes:** Too small to stand alone, but it pays for CS-1: with these lines the two entries together read 6,435 files against 5,931 today and need no more memory than today's one. Same finding as AS-7 (assets); merge them. P2 only because its own bytes are trivial; it rides with CS-1.
