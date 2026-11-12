# SG-8 ✓ Reader and writer share a file, so a new import between features re-joins reads to writes

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** L. **Confidence:** medium. **Step:** 2.20.
- **Second check:** corrected.
- **Where:** `src/server/text-styles.ts:11`, `src/server/fonts.ts:15`, `src/server/menus.ts:25`, `src/server/taxonomy.ts:23`, `src/server/site-layouts.ts:9`, `src/server/custom-fields.ts:52-61`, `src/server/house-switch.ts:8-17`, `src/server/theme-shots.ts:34-39`, `src/server/theme-shots.ts:349-355`
- **Evidence:** A feature is one file under src/server holding its cached storefront read, its admin save and its audit entry. 30 of the 49 server files with a 'use cache' read also import audit from auth.ts (the skeptic's recount), and 193 server modules import auth.ts within the storefront home page's graph. This is why the cycle of SG-1 formed and why the proxy of SG-2 is fat. One clear case I opened: theme-shots.ts holds the reader the theme store uses (lookOf and themeShotsFor, lines 349-355) beside the job that makes the photographs (imports of media, theme-highlights and theme-shot-files, lines 34-39), so reading the theme list reaches sharp. But as a saving of its own the split is small: with SG-1, SG-4 and SG-6 done, removing auth.ts from the storefront home page altogether takes off 19 modules and 32 KB.
- **Cost today:** Little that is not already counted in SG-1, SG-2 and SG-17. What is left on a storefront page after the other cuts is about 3.5 MB: Next's own runtime about 0.5 MB, the four storefront languages 0.4 MB, the rest src/lib and src/server code the page uses. Paid by: Engineers and agents, who cannot add an import between two feature files without widening every route; later, the server per cold instance if the cycle re-forms.
- **Saving:** Not megabytes. The first draft's 'toward 2 to 3 MB and under 1,000 modules' could not be reproduced: Next's runtime alone is 544 modules on a page. The value is that SG-1's and SG-2's gains stay.
- **Risk:** Many files move if done everywhere, which is why it is not: one feature per change with the importers updated, inside step 3.13. Before opening there is no live traffic to disturb.
- **Already tracked:** Related: code review step 3.13 Domain folders (FV4, FH6), Open. The reader and writer rule is new.

## The fix

1. Write the rule in docs/performance.md ('What a server route loads') and one line under Conventions in CLAUDE.md: a feature's cached reads and tag names live in x-read.ts (database client, typed-rows, pure src/lib); x.ts keeps the writes and imports the reader; a reader never imports auth.ts.
2. Enforce it with SG-14's test, not by moving every file: the proxy, the storefront layout and the visit routes may not reach src/server/auth.ts once their readers are split.
3. Split now only where a measured route pays: the proxy's five readers (SG-2 step 3), the interface-text reader (SG-5), the theme photographs' reader (SG-17 step 3).
4. Do the rest inside code review step 3.13 (Domain folders), so each file moves once: when a feature gets its folder, its reads and writes become two files.

**Done when:** docs/performance.md names the reader and writer rule, and src/server/route-load.graph.test.ts asserts that src/proxy.ts reaches no src/server/auth.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- Code review step 3.13 Domain folders (FV4, FH6), Open: add the reader and writer rule to its text.
- src/server/route-load.graph.test.ts (SG-14) is the check.
- src/server/store-writers.scan.test.ts and src/server/replica-readers.scan.test.ts name files by path: when a reader moves, their lists move with it.

**Comes after:** SG-2; SG-14

**Notes:** Effort L is for doing it everywhere; the rule and the three splits named are S and belong to SG-2, SG-5, SG-14 and SG-17.
