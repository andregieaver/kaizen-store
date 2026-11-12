# CS-3 ✓ Nothing holds the stylesheet's size, its sources or the style text in a document

Styles (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 1.2.
- **Second check:** corrected.
- **Where:** `e2e/performance.spec.ts:11`, `e2e/performance.spec.ts:40`, `e2e/performance.spec.ts:126`, `src/app/globals.css:6`, `docs/performance.md:61`, `docs/build-memory.md:34`
- **Evidence:** e2e/performance.spec.ts has budgets for first scripts (lines 11 and 40-50) and for page weight (line 126). Page weight includes the stylesheet, but the budget is 450,000 bytes for pages measured at 311 and 331 KB, so the sheet could double unnoticed. No budget names CSS; none of the scan tests looks at classes or at globals.css's @source lines (rg for globals.css in tests finds five readers, none of the source lines). One sheet takes its classes from every file in src, tests included: the verified report found 13 of 115 commits (11%) adding a utility class that did not exist before, 6 of them only in admin folders or tests (not re-run by the planner). No number is kept for the style text a page builder page puts in a document either; the planner's estimate for a launch theme's home page is 45 to 71 KB.
- **Cost today:** Each deploy that adds or drops a class renames the one sheet (assumed from hashed chunk names), and every returning shopper fetches 25.8 KB Brotli again: about one commit in nine in the sample, half of them for admin-only or test-only edits. Before opening there are no returning shoppers; after, every store's visitors pay on each such deploy. Size itself can only rise: there is no number to fail against. Paid by: A shopper's browser after deploys; the team, which cannot see the sheet growing.
- **Saving:** No bytes by itself. It keeps what CS-1, CS-4 and CS-6 save, and makes the sheet's growth a failing number instead of a surprise.
- **Risk:** Low. A budget set too tight fails pushes for ordinary growth; 3 to 4% of room and the rule of step 4 are the answer. The measure is raw bytes of files, so it does not wobble between runs.
- **Already tracked:** Partly: PSI PERF-11 (per-route budgets, ticked done in docs/audits/psi-followups.md:135) covers first scripts only; nothing covers styles.

## The fix

1. e2e/performance.spec.ts: add STYLESHEET_BUDGETS, raw bytes of the build's stylesheets a page's HTML links (link[rel=stylesheet] whose href starts with /_next/static/, each fetched with page.request and its body measured; the fonts' route is not counted): '/s/demo/no' 189,000 and '/' 189,000 (183,124 today), '/admin/sign-in' 211,000 (204,207 today). Print the figures when E2E_MEASURE=1, as e2e/signed-in/admin-scripts.spec.ts does.
2. In the same file add an inline-style budget for '/s/demo/no': the text of all <style> elements in the HTML the server sends, at most 6,000 bytes (4,552 today), and the number of times the breakpoint sheet's href (kz-bp-) appears in that HTML, at most 4 (4 today; CS-4 and SC-8 lower it to 2).
3. src/lib/stylesheet-sources.scan.test.ts, rule 'Tailwind reads code only': every @source line of src/app/globals.css (and of src/app/admin/admin-entry.css once CS-1 adds it) points inside src; the lines that leave out tests, src/test, src/lib/messages, src/lib/admin-messages, src/db and src/data are present (they arrive with CS-6).
4. docs/performance.md: a short 'Styles' part with today's figures (183 KB raw, 25.8 KB Brotli; the admin's 21 KB), the rule that a budget only falls (a change that lowers a figure by more than 3% lowers its budget in the same change), and where the sources are held.
5. Each of CS-1, CS-4 and CS-6 lowers the numbers it moves in its own change: after CS-1 the site's two budgets become 135,000.
6. When the page-model plan's realistic built page exists (PM-14: a store on a launch theme in the e2e seed), give it the same two CSS budgets; the demo store's theme is too plain to show row sheets.

**Done when:** e2e/performance.spec.ts holds a stylesheet budget for 3 routes, each within 4% of its E2E_MEASURE=1 figure, and an inline-style budget for the store's front page, and the spec passes in CI.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/performance.spec.ts itself (CI's e2e job builds and runs it).
- docs/performance.md 'Checking' (lines 70-79) lists what the spec holds: add the stylesheet and inline-style budgets there.
- The storefront-client plan's SC-6 tightens the script budgets in the same file; land the two together so the file is edited once.
- CLAUDE.md, Commands: 'keep Tailwind's @source lines in globals.css pointed at code, never at data or snapshots'. Step 3 turns that sentence into a test.

**Notes:** Do steps 1 and 2 first of everything in this dimension, at today's figures, so each later fix shows as a number that falls. The refetch after a deploy is 25.8 KB Brotli, not 32 KB, and 11% of commits, not 26% (the skeptic's corrections). Same family as SC-6, PL-13, BN-11 and PF-10.
