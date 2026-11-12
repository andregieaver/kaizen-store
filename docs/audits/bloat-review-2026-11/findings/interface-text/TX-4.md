# TX-4 ✓ The page builder's whole English catalogue loads on every signed-in admin screen, for a default nobody uses

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Second check:** confirmed.
- **Where:** `src/components/admin/shortcut-sheet.tsx:19`, `src/components/admin/admin-frame.tsx:95`, `src/components/admin/responsive-edit.tsx:20`, `src/components/admin/responsive-edit.tsx:100`, `src/components/admin/responsive-edit.tsx:306`, `src/components/admin/typography-fields.tsx:276`, `src/components/admin/responsive-edit.test.ts:103`, `src/components/admin/admin-catalogues.scan.test.ts:31`, `docs/audits/psi-followups.md:482`, `.next/diagnostics/route-bundle-stats.json`
- **Evidence:** The admin frame draws the shortcut sheet, which imports typingIn from responsive-edit.tsx (shortcut-sheet.tsx:19). That file imports builderEn by value (line 20) only as the default of sizeNote(source, size, words = builderEn) at line 100. All 4 call sites outside tests pass words (responsive-edit.tsx:138 and 152, typography-fields.tsx:276 and 290); one test calls it without (responsive-edit.test.ts:103). In the build, chunk 0pmozty218j-z.js holds the builder's English and nothing else: 71,360 characters, 23,880 bytes gzip. I found it in the first-load chunks of 423 of the 449 admin routes in route-bundle-stats.json; the 26 without it are sign-in, print and preview pages.
- **Cost today:** 71 KB minified (24 KB gzip) downloaded once per deploy and run on every signed-in screen: about 6% of the 1.19 MB of first scripts of the orders list. Paid by: An owner's and a platform admin's browser.
- **Saving:** 71 KB minified / 24 KB gzip off the first scripts of 423 admin routes (measured). The page editors still load the builder's English through templates-helpers.ts until AC-9.
- **Risk:** None found: every caller already passes its words, and a caller that did not would fail to compile.
- **Already tracked:** PSI PERF-01 (open); responsive-edit.tsx is on the ALREADY list of admin-catalogues.scan.test.ts, not yet done

## The fix

1. src/components/admin/responsive-edit.tsx: line 20 becomes import type { BuilderMessages } from "@/lib/admin-messages/builder.en"; line 100 makes words a required parameter (no default).
2. src/components/admin/responsive-edit.test.ts:103 passes builderEn itself (the test imports it).
3. Move typingIn() (responsive-edit.tsx:305-309) to a new src/lib/typing-in.ts; responsive-edit.tsx re-exports it so page-builder.tsx and the test keep working; shortcut-sheet.tsx:19 imports it from @/lib/typing-in. The admin frame then no longer loads responsive-edit.tsx and what it imports.
4. Take "src/components/admin/responsive-edit.tsx" off ALREADY in src/components/admin/admin-catalogues.scan.test.ts (line 31); its second test fails until this is done.
5. Build; lower the budgets in e2e/signed-in/admin-scripts.spec.ts (lines 36-46) to the new measurements plus 4%, and write the figures into docs/performance.md and PSI PERF-01 (docs/audits/psi-followups.md:482).

**Done when:** After a build, no first-load chunk of /admin/[store]/orders in .next/diagnostics/route-bundle-stats.json holds the builder's sentence 'Set for {size}' (chunk 0pmozty218j-z.js, 71,360 characters, in 423 of 449 admin routes today), and admin-catalogues.scan.test.ts passes with responsive-edit.tsx off its list.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/admin-catalogues.scan.test.ts: the ALREADY list loses one entry (its test 'keeps the list as short as the code is' demands it).
- src/components/admin/responsive-edit.test.ts:103 and 186-188 (sizeNote and typingIn).
- e2e/signed-in/admin-scripts.spec.ts: budgets are lowered, never raised.
- No written rule changes; this is a step of PSI PERF-01.

**Notes:** The same change as step 1 of AC-1 (admin-client) and BN-3 (client-bundles); do it once.
