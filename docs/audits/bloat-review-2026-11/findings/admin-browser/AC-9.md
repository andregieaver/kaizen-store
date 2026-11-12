# AC-9 ✓ English text for 23 areas is still compiled into client scripts and then handed down again in the HTML

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** high. **Step:** 2.13.
- **Second check:** corrected.
- **Where:** `src/components/admin/responsive-edit.tsx:20`, `src/components/admin/responsive-edit.tsx:100`, `src/lib/field-group-editor.ts:31`, `src/lib/field-group-editor.ts:54`, `src/components/admin/modal-fields.tsx:38`, `src/components/admin/templates-helpers.ts:1`, `src/lib/work-ui.ts:22`, `src/lib/work-ui.ts:370`, `src/lib/redirect-admin.ts:9`, `src/components/admin/demo-content-card.tsx:6`, `src/components/admin/admin-catalogues.scan.test.ts:18`, `src/components/admin/admin-catalogues.scan.test.ts:44`
- **Evidence:** Walking every admin route's client closure (the Work invoice route of AC-7 left out) I find 38 import sites that bring an area's English or Norwegian file into client code besides common and sign-in: builder.en through responsive-edit.tsx on 422 routes (AC-1 takes it down to the builder's 39), fields.en through lib/field-group-editor.ts on 73 (eleven functions there default their words to fieldsEn), blocks.en through modal-fields.tsx and builder.en through templates-helpers.ts on the 39 builder routes, work.en through lib/work-ui.ts and lib/work-timer-ui.ts on 14, redirects.en through three lib files on 5 to 7, analytics in English and Norwegian through lib/analytics-words.ts on 5, and 25 more sites on 1 to 6 routes each. The page hands the same areas down in the account's language. The scan test lists 14 direct importers and checks only "use client" files, so it cannot see a lib module that takes English as a default argument.
- **Cost today:** 24 to 150 KB raw of English per affected screen that the page also hands down in the account's language; a Norwegian account downloads English it never shows. Paid by: An owner's browser on the affected screens (the builder most: about 150 KB).
- **Saving:** Estimate: about 150 KB raw on the builder, 65 KB on the Work screens, 24 to 45 KB on 73 field screens, 22 KB on the home.
- **Risk:** Low: a missing argument is a compile error. A part drawn where its area is not handed would fetch English late, which the fallbacks spec fails on, so each move needs its page to hand the area.
- **Already tracked:** Partly: admin-catalogues.scan.test.ts holds a list of 14 direct importers that may only shrink (PSI PERF-01). The indirect ones are not seen.

## The fix

1. Lib modules that default to English: make the words a required parameter and let callers pass them (a client part passes useAdminText()'s result; a server caller passes adminText(lang, area)). In order of reach: src/lib/field-group-editor.ts lines 54-517 (eleven functions), src/lib/work-ui.ts lines 370, 406 and 532 and src/lib/work-timer-ui.ts, src/lib/redirect-admin.ts, redirects.ts and redirect-words.ts, src/components/admin/privacy/styles.ts, src/lib/bonus-admin.ts, src/lib/analytics-words.ts, src/lib/segments.ts, src/lib/drafts-words.ts, src/lib/support-inbox-text.ts, src/lib/return-admin.ts, then affiliate-admin, campaigns, experiment-words, experiment-results, shipping-method-form, store-copy-wizard, discounts, order-list-words and tax-profile.
2. Client modules on the scan test's list read with useAdminText() instead: responsive-edit.tsx lines 20 and 100 (sizeNote takes its words), templates-helpers.ts lines 1 and 16, modal-fields.tsx line 38, support/conversation-actions.tsx, delete-reminder-button.tsx, company-fields.tsx, the two gift card forms, orders/send-parcel.tsx, orders/order-table.tsx, orders/view-tools.tsx, demo-content-card.tsx and audience-fields.tsx. Take each off ALREADY in admin-catalogues.scan.test.ts lines 18-33 as it goes.
3. Each page that draws one of these parts must hand the area (AdminTextScope); the fallbacks spec fails where one does not.
4. Unit tests that call these functions without words pass the English file themselves.
5. Replace the scan test's matcher with the walk of AC-11, with today's 38 sites as a list that may only shrink.

**Done when:** The walking scan test of AC-11 finds no path from an admin client module to a file of src/lib/admin-messages other than common.en and sign-in.en (38 import sites today), and ALREADY holds only admin-text.tsx and admin-text-context.tsx.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/admin-catalogues.scan.test.ts (the ALREADY list of 14, which may only shrink).
- e2e/signed-in/admin-text-fallbacks.spec.ts (a part drawn where its area is not handed).
- The unit tests of each lib module touched: field-group-editor, work-ui, redirect-admin, redirects, bonus-admin, analytics-words, segments, drafts-words, return-admin and the rest.
- src/components/admin/responsive-edit.test.ts line 19 (sizeNote).
- docs/platform-admin-i18n.md section 3.3 and D540 in docs/decisions.md.

**Comes after:** AC-1; AC-11

**Notes:** Do the builder's four sites with AC-5 and the fields module with AC-3; the long tail of sites on 1 to 7 routes is worth doing when each area is next touched, which is why this is P2 as a whole.
