# DD-2 ✓ About 330 exports in production files are kept alive only by a test

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 4.3.
- **Second check:** corrected.
- **Where:** `src/server/orders.ts:604`, `src/server/discounts.ts:480`, `src/server/delivery-options.ts:792`, `src/server/delivery-readers.scan.test.ts:8`, `src/server/store-starters.ts:535`, `src/server/store-starters.ts:252`, `src/server/fiken-sync.ts:577`, `src/server/field-entities.ts:164`, `src/server/support-actions.ts:434`, `src/server/invoice-pdf.ts:152`, `src/server/store-trial.ts:50`, `src/server/two-step.ts:400`, `src/server/withdrawals.ts:188`, `src/lib/work-csv.ts:215`, `src/lib/work-csv.ts:309`, `src/lib/admin-api.ts:68`, `src/components/admin/analytics/overview-view.tsx:42`, `src/lib/responsive.ts:342`
- **Evidence:** The scan lists 655 exports only tests import. 512 of them (3,208 lines) sit in 298 production files; 69 of those are named by no test and are counted in DD-3. That leaves 443 (2,959 lines): 324 named by one test file (1,575 lines, in 203 files: src/lib 262, src/server 38, src/components 21) and 119 by several (1,384 lines, in 89 files). In the skeptic's random sample of 60, 45 were dead but for their test (75%; 80% by lines) and 15 were kept for a reason (test seams, guard lists, oracles). Largest dead ones: invoiceToCsv (34 lines) and creditNotesToCsv (28), listOrders (43; the admin uses listOrdersPage; 3 test files use it as set-up), setCartCode (its comment says 'as a cart reminder's link does'; the link calls addCartCode, cart/restore/[token]/route.ts:34; 3 test files use it as set-up), customerFieldExportMany, moveStarter, saveStarterDraft, starterCards, checkFikenDocument, OverviewView (only its test renders it), 11 helpers in responsive.ts. chosenDelivery's comment and the scan test's header (delivery-readers.scan.test.ts:8) both say cartSummary() and placeOrder() call it; both call resolveDelivery(). About one in ten names a screen that does not call it: openRequestCount ('the Requests tab's badge'), trialPausedAt ('for the banner'), twoStepMembers ('3 of 5 have it'), retryDocumentPdf, shopperCanAccessOrder ('for the order page and My account'). SCOPES_BEFORE_D440 guards tokens made before D440, and api_tokens has never held a row in production.
- **Cost today:** About 1,700 lines of source (1,500 to 2,000, estimate from two samples) and their test cases. Nothing at run time: the build drops them. Paid by: People and agents who read, search and change the code, and CI, which runs tests of code no user can reach.
- **Saving:** About 1,700 lines of source and roughly 1,000 to 2,000 test lines (estimate). Not additive with DD-7, which is a subset.
- **Risk:** Low to medium. Each deletion is proved by typecheck and the test suites. Two ways to go wrong: deleting a function a planned screen was about to use (step 3's question covers it), and deleting a test that was the only check of a database rule reached through the dead function (keep the case and call the rule another way, as DD-5 notes for updateTimeEntry).

## The fix

1. Take the list from node scripts/unused.mjs (DD-4): testOnlyExports, grouped by how many test files name each (rg -w -l the name over *.test.ts and e2e).
2. Tier 2, the 324 named by exactly one test file. For each, read its comment and its one test. If the comment says a test holds an invariant with it, or it is a reset helper or an oracle: move it to keptForTests with the reason, or move a pure test helper into a *-test-support.ts file. Otherwise delete the export and the test cases that only exercise it. Work by folder; src/lib holds 262 of them.
3. Where the comment names a screen (openRequestCount, trialPausedAt, twoStepMembers, retryDocumentPdf, shopperCanAccessOrder and the like, about one in ten): first check that the screen does the job another way. shopperCanAccessOrder is the first to look at because it is an access check: confirm the order page and My account reach returns through matchOrder() or findOrderFor() (src/server/withdrawals.ts:181), then delete it with its 6 test lines. If a screen truly lacks the thing, list it for the owner instead of deleting: that is a missing wire, not waste.
4. Tier 3, the 119 named by several test files. Keep the oracles and seams and list them in keptForTests (about 500 lines: buildInvoiceSnapshot, buildEditInvoiceSnapshot, editCreditNote, creditNoteSnapshot, nextState, validateExport, the registerProblems pair, SECRET_TABLES, NOT_EXPORTED). Switch tests that use an old interface as set-up to the one the app uses, then delete the old one: setCartCode to addCartCode (checkout-kinds.int.test.ts, vat-engine.int.test.ts, vat-money-review.int.test.ts), listOrders to listOrdersPage (fulfilment.int.test.ts, inventory-admin.int.test.ts, store-copy.int.test.ts). setBookingsModule and setDeliveriesModule go with DD-11; saveLines stays (DD-5).
5. Correct what the deletions make false: chosenDelivery's mention in src/server/delivery-readers.scan.test.ts:8 and in its own comment; any docs/rules line that names a deleted function (rg -w each name over docs/rules and CLAUDE.md).
6. After each folder: pnpm lint (names the second-order leftovers), node scripts/ratchet.mjs and node scripts/unused.mjs, then typecheck, pnpm test and pnpm test:int.

**Done when:** node scripts/unused.mjs: testOnlyExports is empty and keptForTests holds about 100 to 130 names, each with a reason; pnpm test and pnpm test:int pass.

**Tests and rules that hold today's behaviour, and change with it:**

- Each export's own test cases go with it: about 1,000 to 2,000 test lines in all (estimate; 1,458 test lines name these exports, oracles included).
- Set-up to switch: src/server/checkout-kinds.int.test.ts (10 lines use setCartCode), vat-engine.int.test.ts, vat-money-review.int.test.ts; fulfilment.int.test.ts, inventory-admin.int.test.ts and store-copy.int.test.ts (listOrders).
- src/server/returns.int.test.ts:429-431 and :593 and draft-orders.int.test.ts:898-902 (shopperCanAccessOrder).
- src/lib/admin-api-routes.test.ts:196-211 (SCOPES_BEFORE_D440): the case that no write added by D440 is in the old list goes with the list.
- Number-holding scan tests as in DD-3 (ratchet, sql-raw, payment-readers). Rule comments: src/server/delivery-readers.scan.test.ts:8.

**Comes after:** DD-4; DD-3

**Notes:** Lists: scratchpad/work/ddplan/T2.txt and T3.txt, largest first, with the test files that name each. Do it folder by folder when the area is next touched; nothing here costs a visitor anything. The skeptic's corrections are kept: 298 files, about 330 exports, validateExport is an oracle.
