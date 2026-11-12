# SC-6 ✓ The byte budgets are loose, count a file no modern browser loads, and cover one storefront route besides home

What a shopper's browser loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 1.3.
- **Second check:** corrected.
- **Where:** `e2e/performance.spec.ts:10`, `e2e/performance.spec.ts:16`, `e2e/performance.spec.ts:40`, `e2e/performance.spec.ts:126`, `e2e/signed-in/admin-scripts.spec.ts:18`, `src/lib/storefront-bundle.scan.test.ts:16`, `docs/performance.md:110`, `docs/audits/psi-followups.md:135`
- **Evidence:** FIRST_SCRIPTS_MAX is 972,000, set when the page measured 965 to 972 KB (the comment at line 10); D461 cut the page on 5 November and the budget stayed. The test sums every script[src] in the DOM after load (lines 16-19), so it counts the nomodule polyfill (112,594 bytes) and whatever lazy chunks were added by then. On this build that is about 811,890 bytes: room of about 160 KB, 16 %. Product: 890,379 against 1,040,000: 150 KB, 14 %. FIRST_SCRIPTS_BUDGETS has seven entries, one of them a storefront route (line 41); category, search, cart, checkout and account have none. The only after-load check is a total of 450,000 bytes until 2 s after load (line 127; home measured 406,542) with no count of requests. The import scan forbids four modules. The admin's spec already measures the better way: from the HTML the server sends, with a switch that prints the figures (admin-scripts.spec.ts:18-25). Growth that passed unseen: the cart's forms on the product page (SC-4, 10 November) and the tiles' call and scripts on every grid page (SC-12, 10 and 11 November).
- **Cost today:** About 150 to 160 KB of scripts can be added to the two budgeted storefront pages before a test fails. The working routes, and what a page asks for after load, are not held at all. Paid by: CI (it runs the check), then every shopper
- **Saving:** None by itself; it keeps what the other findings save and would have caught SC-4 and SC-12 on the day they arrived.
- **Risk:** Low: a tight budget fails on honest growth, which is its purpose. If the loop of SC-9 is real in CI, step 5 fails on the category and search pages: that is a result, not a flake; land step 5 for home and the content page first and treat the rest under SC-9.
- **Already tracked:** Partly: PSI PERF-11 (per-route bundle budgets) is ticked done in docs/audits/psi-followups.md:135. The budgets exist but are loose and cover home and one product page.

## The fix

1. e2e/performance.spec.ts: replace firstScripts(page) (lines 16-19) with the admin spec's way (e2e/signed-in/admin-scripts.spec.ts:18-23): the script tags of the HTML the server sends, nomodule tags left out, each fetched and measured. Keep the content checks (zod, the lightbox, the payment form) on the same list. Add the E2E_MEASURE=1 switch that prints each route's figure.
2. Set each budget to the measure plus 3 %: the front page 701,000 (680,264 on this review's build), the product page 801,000 (777,785). Fold FIRST_SCRIPTS_MAX into FIRST_SCRIPTS_BUDGETS.
3. Add storefront routes to FIRST_SCRIPTS_BUDGETS: /s/demo/no/om-oss (680,264 today: 701,000) and /s/demo/no/category/belysning, /s/demo/no/search?q=lampe, /s/demo/no/cart, /s/demo/no/checkout, /s/demo/no/account (778,166 each today: 801,500).
4. After load: in the SPEED_BUDGETS test (lines 126-180) count requests too. Home: 52 requests (48 measured) and weight 420,000 (406,542). Product: 436,000 (423,097). Add /s/demo/no/om-oss: 74 requests and 570,000 bytes (70 and 550,705).
5. In the same test: no address is asked for more than 20 times in one page load. Add the category and search pages to this check. It also answers SC-9 in CI: they pass, or the loop is shown.
6. Extend src/lib/storefront-bundle.scan.test.ts as SC-3 step 6 says.
7. docs/performance.md, Checking: budgets only fall; a change that lowers a measure by more than 3 % lowers its budget in the same change. Correct the comments at e2e/performance.spec.ts:10 and 34-39. Add a line under PERF-11 in docs/audits/psi-followups.md:135 that the budgets were tightened and widened to the working routes.
8. Each of SC-1 to SC-4 and SC-10 to SC-13 lowers the numbers it moves in its own change.

**Done when:** e2e/performance.spec.ts holds first-scripts budgets for at least 8 storefront routes (2 today), each within 3 % of its E2E_MEASURE=1 figure, a request budget for 3 pages and the 20-times rule, and the spec passes in CI.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/performance.spec.ts itself (CI's e2e job builds and runs it)
- docs/performance.md:110-117 says each budget has about 5 % of room: make it true and say 3 %
- docs/audits/psi-followups.md:135-137: PERF-11 is ticked done; the tick stays, with the new line
- src/lib/storefront-bundle.scan.test.ts

**Notes:** Do steps 1 to 3 first of everything in this dimension, at today's measure, so each later fix shows as a number that falls.
