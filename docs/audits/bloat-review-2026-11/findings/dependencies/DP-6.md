# DP-6 ✓ Nothing limits what a route's server function loads, so nearly every route came to load everything

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 1.5.
- **Second check:** confirmed.
- **Where:** `src/lib/storefront-bundle.scan.test.ts:1`, `src/lib/pay-routes.graph.test.ts:1-60`, `e2e/performance.spec.ts:21`, `e2e/signed-in/admin-scripts.spec.ts:36`, `src/server/document-readers.test.ts:11`, `src/server/ratchet.baseline.json`, `next.config.ts:69`, `.github/workflows/ci.yml:75`, `.github/workflows/ci.yml:152`
- **Evidence:** The browser side has three guards (a static import scan for visitors, byte budgets for visitor routes, byte budgets for seven admin screens) and they have worked: shoppers' scripts are clean. The server side has one module-level check, for invoice-pdf.ts. Result, read from the build by the skeptic: the median route loads 11.6 MB of server JS and only 28 of 830 routes load under 3 MB. Every large finding of this dimension is one small import of a helper from a large module: sameSite from chat-route.ts (DP-10), six functions for a panel most screens never open (DP-11), an error class from owner-tools.ts (follow-ups.ts:14), two constants from the page model (theme.ts:9, visit-record.ts:8). A 60-line walker finds each in under a second; the planner's is a scratch script No check ties package.json to imports either (CI runs only pnpm audit), and the working plan's own dependency item was wrong about pg (DP-9).
- **Cost today:** No direct cost. It is why DP-1, DP-2, DP-10 and DP-11 could grow unnoticed, and each new feature added to a hub module now lands in every function. Paid by: Every later change. CI carries the check: a unit test that reads source files (under a second) and a script over files the build already wrote.
- **Saving:** Holds the gains of DP-1, DP-2, DP-10 and DP-11 and makes the hub's size a number that can only fall. None by itself.
- **Risk:** Low. Budgets need raising on purpose now and then; that is the point. The walker reads import lines with a regular expression, as two tests already do; a new import form it does not see would under-count, not fail.
- **Already tracked:** no. Code review step 4.1 (lint rules for the boundaries, Open) is the nearest and does not measure what a route loads. Same gap as SD-13, AS-3 and AC-11 of this review: merge them into one step.

## The fix

1. src/server/route-load.graph.test.ts (started in DP-10), in the house style of src/lib/pay-routes.graph.test.ts but following static value imports only. Entries and what each may not reach: the four /api/visit routes and src/app/api/shop/tiles/route.ts (chat-route.ts, owner-tools.ts, owner-assistant.ts, dream-factory.ts, sharp, opentype.js, @supabase/supabase-js, playwright-core); src/proxy.ts, src/app/s/[store]/[market]/layout.tsx and page.tsx (owner-tools.ts, owner-assistant.ts, dream-factory.ts, playwright-core); the admin layouts (owner-assistant.ts, DP-11); src/app/api/health/route.ts (stores.ts). Rules that cannot hold yet start as a named exception list that may only shrink.
2. The same test ratchets each entry's count of source files reached against src/server/route-load.baseline.json: a count may only fall, and when it falls the test fails until node scripts/route-load.mjs lowers the baseline, exactly as ratchet.scan.test.ts and scripts/ratchet.mjs work today. Start values: the proxy 1,311, the store layout 1,466, /api/visit 1,308, the admin orders route 1,396, /api/health 54.
3. scripts/route-budget.mjs, run after pnpm build in CI's e2e job (.github/workflows/ci.yml:152): for a named list of routes (/api/visit, /api/health, /api/shop/tiles, /s/[store]/[market], /admin/[store]/orders, the proxy) sum the server chunks the entry loads and the files in its .nft.json, and fail over a budget of today's figure plus 4% or on a package in the trace that was not there before. Print, but do not assert, a fresh-process load time (the skeptic's cold3.cjs is the model): timings are too noisy in CI to gate on.
4. src/lib/dependencies.scan.test.ts: every key of package.json's dependencies has a non-test importer under src, scripts or a config file, or sits in a short list with its reason (three and @tiptap/pm: required peers; server-only); no non-test file under src imports a devDependency other than for types.
5. docs/performance.md: a section 'What a function loads' with the measured figures, the rule (a route imports a helper from the file that defines it; a package most requests do not need is loaded with import() where it is used) and the names of the three guards. docs/audits/code-review-2026-11.md: add the guards to the table of step 4.5 ('Check that each guard exists') and note under 4.1 that these three exist.

**Done when:** pnpm test runs src/server/route-load.graph.test.ts and src/lib/dependencies.scan.test.ts green, and scripts/route-budget.mjs fails when run locally on a build made with one extra line in the beacon (import '@/server/chat-route') and passes without it.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/pay-routes.graph.test.ts and src/lib/storefront-bundle.scan.test.ts: the walkers to reuse; unchanged
- src/server/ratchet.scan.test.ts with src/server/ratchet.baseline.json and scripts/ratchet.mjs: the ratchet pattern to copy
- e2e/performance.spec.ts and e2e/signed-in/admin-scripts.spec.ts: the byte-budget pattern (today's figure plus about 4%)
- docs/performance.md, docs/capacity.md and docs/build-memory.md say nothing about cold start or trace size today: performance.md gains the section
- docs/audits/code-review-2026-11.md steps 4.1 (lint rules for the boundaries, Open) and 4.5 (check that each guard exists)
- The same gap is the storefront review's SD-13, the assets review's AS-3 and the admin-client review's AC-11: one step, one set of files

**Comes after:** DP-10 (creates the test's first version); DP-1, DP-2, DP-11 and SD-1 land first where their rules are to be asserted without an exception list

**Notes:** Effort raised from S to M: it is three small checks, a baseline file and a CI line. The dependency scan is the cheapest of the three and answers the brief's question (is each package imported, and from the right list) for good. Do it right after the P0 cuts, while the numbers are fresh.
