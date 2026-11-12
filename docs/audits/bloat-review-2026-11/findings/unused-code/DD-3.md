# DD-3 ✓ 331 exports are used by nothing at all, and some say they are in use

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.36.
- **Second check:** confirmed.
- **Where:** `src/server/discounts.ts:413`, `src/server/discounts.ts:418`, `src/server/standing-orders.ts:1135`, `src/server/privacy-erasure.ts:447`, `src/server/delivery-options.ts:829`, `src/server/support-agent.ts:54`, `src/server/content-types.ts:261`, `src/server/deals.ts:715`, `src/server/developer-apps.ts:275`, `src/lib/analytics-targets.ts:202`, `src/lib/fiken-settings.ts:17`, `src/lib/content-types.ts:48`, `src/lib/quotes.ts:58`, `docs/rules/admin/marketing.md:81`, `src/instrumentation.ts:6`
- **Evidence:** 263 exports are imported by nothing and unused in their own file; one is a false alarm (Next reads register in src/instrumentation.ts). Another 69 were filed as tests-only only because a test imports their whole module; no test file contains their names. Together 331 exports, 721 lines, in 209 files: 105 types, 89 functions (most one-line helpers), 116 other constants, 21 re-exports; 23 are server functions (158 lines). The planner ran rg -w on 17 of the largest (forgetStandingOrders, setDeliveryNote, orderContentTypes, dealOfThing, appWebhook, isCreator, previewStarters, usageHistory, runNextScan, getRedirect, accountingSystem, ACT_KINDS, MAX_CONTENT_TYPES, VAT_TYPE_CODES, CONTENT_TOOLS and two more): each is one line, its definition. Some carry comments that claim callers. applyCode() says the cart, the checkout's code check and placeOrder() all apply a code through it (discounts.ts:413-417), and the rule at docs/rules/admin/marketing.md:81 repeats it; the cart and checkout use previewCartCodes() and stackForBasket() (cart-summary.ts:22, checkout.ts:58). forgetStandingOrders() was replaced by the erasure job's own code, which throws where the dead copy swallows a Stripe error. isTargetMetric exists twice, word for word: the one in platform-briefing.ts:9 is imported, the one in analytics-targets.ts:202 is not.
- **Cost today:** 721 lines. Nothing at run time or in any bundle. The price is a wrong fix: someone changes the copy nobody runs, or trusts a limit nothing enforces (MAX_CONTENT_TYPES = 50 is read by nothing). Paid by: People and agents changing discounts, erasure or delivery code.
- **Saving:** 721 lines (measured), plus about 130 second-order lines (estimate).
- **Risk:** Low. Typecheck and lint fail if anything used one; no test names them. A name reached only by a string would not be caught, but the scan found no file reached that way and these names appear nowhere else in src, scripts, e2e or the seed. The real risk is deleting a function a planned unit meant to call: it comes back from git in a minute.

## The fix

1. Get the list: node scripts/unused.mjs (DD-4) prints unusedExports; the 69 others are the testOnlyExports whose name rg -w finds in no test file. Without DD-4, run the review's script: node docs/audits/bloat-review-2026-11/scripts/unused-code.mjs <outDir> and read deadExports in its JSON.
2. Delete the 23 server functions first, each with its doc comment: among them forgetStandingOrders (src/server/standing-orders.ts:1135), setDeliveryNote (delivery-options.ts:829), applyCode (discounts.ts:413-430), orderContentTypes (content-types.ts:261), dealOfThing (deals.ts:715), appWebhook (developer-apps.ts:275), isCreator (creators.ts:420), previewStarters (design-presets.ts:1525), platformSiteApprovalWords (site-tools.ts:1025), usageHistory (usage.ts:133), runNextScan (cookie-scan-runner.ts:41), clientById (oauth-clients.ts:123), getRedirect (redirects.ts:468), accountingSystem (accounting.ts:16), and updateTimeEntryAction only if DD-5 decides to delete it.
3. Delete the constants and one-line helpers, then the 105 types and 21 re-exports. Of the two isTargetMetric keep the one in src/lib/platform-briefing.ts:9 and delete src/lib/analytics-targets.ts:202. Keep register in src/instrumentation.ts.
4. After each batch run pnpm lint: with --max-warnings 0 it names every import or private helper that the deletion left unused; delete those too (the second-order code, about 130 lines by the skeptic's estimate).
5. Correct the words that claim a caller: docs/rules/admin/marketing.md:81 names applyCode(); say previewCartCodes() and stackForBasket(). For every other deleted name run rg -w over docs/rules and CLAUDE.md and correct a hit; older design docs (docs/wave-*.md) are history and stay.
6. Run node scripts/ratchet.mjs (files that lose a function with an unchecked read fall below their baseline) and node scripts/unused.mjs, then pnpm lint, typecheck, test and test:int.

**Done when:** node scripts/unused.mjs reports 0 unused exports (262 today) and none of the 69 names appears in testOnlyExports; pnpm lint, typecheck, test and test:int pass.

**Tests and rules that hold today's behaviour, and change with it:**

- By definition no test names these 331.
- Tests that hold a number per file and may need it lowered: src/server/ratchet.scan.test.ts (its fourth case), src/lib/sql-raw.scan.test.ts (uses per file), src/lib/payment-readers.scan.test.ts (count per file).
- Rule to correct: docs/rules/admin/marketing.md:81 (applyCode). The comment at src/server/delivery-readers.scan.test.ts:8 about chosenDelivery() belongs to DD-2.

**Comes after:** DD-4

**Notes:** The full list, largest first, is in scratchpad/work/ddplan/T0.txt (made by tiers.mjs from the skeptic's index); the scan regenerates it. This is code with no caller, not an unused feature, so the owner's clarification does not change it.
