# BN-8 ✓ Whole English catalogues are imported as default values, and the check sees only the direct ones

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 2.13.
- **Second check:** confirmed.
- **Where:** `src/components/admin/admin-catalogues.scan.test.ts:18`, `src/components/admin/admin-catalogues.scan.test.ts:48`, `src/components/admin/responsive-edit.tsx:20`, `src/components/admin/responsive-edit.tsx:100`, `src/components/admin/modal-fields.tsx:38`, `src/components/admin/templates-helpers.ts:1`, `src/lib/field-group-editor.ts:31`, `src/lib/redirect-admin.ts:9`, `src/components/admin/demo-content-card.tsx:6`, `src/components/admin/orders/order-table.tsx:9`, `src/lib/store-features.ts:14`, `src/lib/store-features.ts:240`
- **Evidence:** Many modules import an area's whole English catalogue as a value, nearly always for a default argument (words = builderEn at responsive-edit.tsx:100; c = commonEn.features at store-features.ts:240, 246 and 466). The scan test looks only at files that start with 'use client' and import a catalogue directly (line 48) and lists 14. rg finds 44 plain modules under src/lib with a value import of an .en catalogue; the skeptic's walk from the 495 client components found about 25 of them reachable from client code, none of which the test can see. Per route the verified report measured 84 KB of catalogues on average over the 432 signed-in routes: the builder's family 146 KB (builder 70, blocks 53, fields 23), the AI manager's page 167, the product editor 112, the admin home 92, orders 84. The same words are also handed down in the document as props, so an English reader gets them twice and a Norwegian reader downloads English never shown.
- **Cost today:** 14 to 97 KB raw per admin screen beyond BN-3's 70 KB. Paid by: An owner's browser on the builder, the product editor, orders, the home and the AI manager's page.
- **Saving:** Estimate from module sizes: the builder 76 KB beyond BN-3's 70; the product editor 42; the admin home 22; orders 14; the AI manager's page 97.
- **Risk:** Medium: many call sites and tests lean on the defaults; the type checker finds every one. A page that does not hand an area down shows English fetched late, which the fallbacks spec fails on.
- **Already tracked:** Partly: PERF-01 and D540 removed the fallback, and the test's list of 14 may only shrink; the plain modules and the default-argument pattern are not tracked. Same ground as AC-9.

## The fix

1. Client modules on the scan test's list read with useAdminText() instead of importing: responsive-edit.tsx lines 20 and 100 (sizeNote takes its words as a required argument), templates-helpers.ts lines 1 and 16, modal-fields.tsx line 38, orders/order-table.tsx, orders/view-tools.tsx, orders/send-parcel.tsx, demo-content-card.tsx, audience-fields.tsx, company-fields.tsx, delete-reminder-button.tsx, support/conversation-actions.tsx and the two gift card forms. Take each off ALREADY (lines 18 to 33) as it goes.
2. Plain modules a client can reach: make the words a required parameter and keep import type of the catalogue; callers pass useAdminText()'s result in the browser or adminText(lang, area) on the server. In order of reach: src/lib/field-group-editor.ts, src/lib/redirect-admin.ts, src/lib/store-features.ts (requirementLabel, featureOffText, needWords; also BN-10 step 2), then the rest the new walk prints.
3. Each page that draws one of these parts hands the area down (AdminTextScope); e2e/signed-in/admin-text-fallbacks.spec.ts fails where one does not.
4. Unit tests that call these functions without words pass the English file themselves.
5. Replace the test's file filter with BN-4's import walk from every admin client module, with today's reachable sites as a list that may only shrink.

**Done when:** The walking scan finds no path from an admin client module to a file of src/lib/admin-messages/*.en other than common.en and sign-in.en, and ALREADY in admin-catalogues.scan.test.ts holds only admin-text.tsx and admin-text-context.tsx (14 entries today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/admin-catalogues.scan.test.ts (the list of 14, which may only shrink; keep both of its assertions).
- e2e/signed-in/admin-text-fallbacks.spec.ts (a part drawn where its area is not handed down).
- The unit tests of each module touched (field-group-editor, redirect-admin, store-features, responsive-edit.test.ts line 19 for sizeNote).
- docs/platform-admin-i18n.md section 3.3 and D540 in docs/decisions.md: the fallback is fetched per area; a default argument that imports the area defeats it.

**Comes after:** BN-3; BN-4

**Notes:** P2 as a whole because the long tail is on 1 to 7 routes each: do the builder's sites with the builder's work and each other site when its area is next touched; the new walk (step 5) is the part worth doing at once, with BN-4.
