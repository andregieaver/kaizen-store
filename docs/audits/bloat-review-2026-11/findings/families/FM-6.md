# FM-6 ✓ Five CSV imports repeat the same orchestration, pages and client flow around one shared job core

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 3.13.
- **Second check:** corrected.
- **Where:** `src/server/customer-import.ts:92`, `src/server/customer-import.ts:104`, `src/server/customer-import.ts:146`, `src/server/inventory-jobs.ts:227`, `src/server/product-import.ts:103`, `src/server/redirect-import.ts:77`, `src/server/order-history-import.ts:83`, `src/server/data-jobs.ts:297`, `src/server/data-jobs.ts:386`, `src/server/data-jobs.ts:617`, `src/components/admin/data/import-flow.tsx:1`, `src/components/admin/inventory/stock-import-flow.tsx:1`, `src/components/admin/customer-import-flow.tsx:1`, `src/components/admin/redirects/redirect-import-flow.tsx:1`
- **Evidence:** A shared core exists: the job store, runJob() and tickJob() in data-jobs.ts (653 lines), tickResponse() in data-routes.ts, the findings table and the job tracker. Around it, products, customers, redirects, stock and order history each write their own start-upload, register, check, apply and problems-CSV functions of the same shape (customer-import.ts:92, 112, 146, 173, 419), and data-jobs.ts picks between them with chains of 'job.kind ===' (lines 297 and 386-389) and ten one-line starters (lines 617-653). Against customer-import.ts, imports left out, the other four engines share 468 lines, 321 in runs of three or more: inventory-jobs 43%, redirect-import 47%, order-history-import 56%, product-import 26% of their own lines. isUniqueViolation is written out in five of the engines. Nine of the 41 twin pairs of the whole codebase are these engines among themselves, and nine more are their flows, views and pages. Sizes: the five engines 2,401 lines (430, 630, 639, 391, 311), four client flows that share 20 to 31 long lines pairwise.
- **Cost today:** One job done five ways, with about 1,000 lines measured as identical across engines, flows and pages. A change to how an import checks, resumes or reports must be made five times. Paid by: The build, CI and an agent's session. Not the browser: each import page loads only its own flow.
- **Saving:** About 900 to 1,300 lines (estimate from identical lines measured: engines 320 to 470, flows 155 to 220, pages about 300 to 400, plus part of the views).
- **Risk:** Low to medium. Imports write customers, stock and products. What could break: a kind's own rule lost in the shared path (a customer's consent, a stock count's location), noticed by that kind's integration test. Before opening no owner has an import in flight, so jobs half done under the old code are the team's own.

## The fix

1. Add src/server/import-kinds.ts: one description per kind (its JobKind, its permission from JOB_KEY, how to read the file into rows, how to judge a row, how to write a row, its problems-CSV columns, its storage folder). Start with customers and order history, the most alike (56%).
2. In src/server/data-jobs.ts write the orchestration once over a description: startUpload(member, kind, fileName), registerImport(member, kind, input), startCheck, startApply and problemsCsv, with the lease, cursor and pause handling the engines repeat (applyCursor, the 'until' budget). Replace the 'job.kind ===' chains at lines 297 and 386-389 with a lookup of the description, and the ten starters at lines 617-653 with two.
3. Move the engines one at a time (customers, order history, redirects, stock, products) so each keeps only its parsing and its writes; run that kind's integration test after each.
4. One client flow: src/components/admin/data/import-flow.tsx takes the kind and its words; delete stock-import-flow.tsx, customer-import-flow.tsx and redirects/redirect-import-flow.tsx. One views file for the findings and summary.
5. Pages keep their addresses. Add shared parts ImportUploadPage and ImportJobPage under src/components/admin/data and make each kind's page.tsx a short call with its kind.
6. isUniqueViolation: import the one in src/server/privacy-erasure.ts:366, or its new home (FM-12).

**Done when:** node a scratch script for the four engines against customer-import.ts reports under 80 lines in runs of three or more (321 today); rg --files src/components/admin | rg 'import-flow' lists one file (four today); the seven integration tests pass without an edit.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/data-jobs.int.test.ts, inventory-jobs.int.test.ts, product-import.int.test.ts, redirect-import.int.test.ts, review-import.int.test.ts, old-shop-import.int.test.ts and woocommerce-mover.int.test.ts: must pass unchanged; they hold what each kind writes.
- e2e/data-export.spec.ts and the signed-in specs that open an import page: unchanged addresses, so they pass as they are.
- Rules: 'Data in and out' (wave 2, D165, docs/wave-2-data.md), 'Customers in the admin' (D366), 'Inventory' (D172), 'Redirects and the 404 report' (D168), 'Moving in from another shop' (D384) in docs/rules/admin: each names its engine file; update the file names, not the behaviour.
- src/server/ratchet.scan.test.ts: moving reads between files moves their per-file counts; run node scripts/ratchet.mjs, which accepts a fall but not a rise in any one file, so move typed reads or type them on the way.

**Notes:** Imports are how a new owner moves in, so the weeks before opening are a good time: nothing is in flight. It is still upkeep, not running cost, so it ranks below the P0 and P1 items. The same family is reported by the copied-code area (CP-1).
