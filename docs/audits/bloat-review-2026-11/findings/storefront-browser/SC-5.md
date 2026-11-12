# SC-5 ✓ One stylesheet for stores, site and admin: shoppers download the admin's utility classes

What a shopper's browser loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 2.11.
- **Second check:** confirmed.
- **Where:** `src/app/globals.css:6`, `src/app/globals.css:7`, `src/app/admin/layout.tsx:13`, `src/app/s/[store]/[market]/layout.tsx:43`, `src/components/inline-edit/site-editor.tsx:10`, `src/components/inline-edit/rich-text-inline.tsx:8`, `src/components/work/hosted-invoice.tsx:3`, `.next/static/chunks/3-w0shgm-eqtf.css`, `docs/build-memory.md:18`
- **Evidence:** The build has one main stylesheet, 183,124 bytes (32,180 gzip), render-blocking, imported by 16 files (14 root layouts and the global error and not-found pages); globals.css reads class names from all of src (globals.css:6-9). Its utilities layer is 117,814 bytes in 1,486 rules. Re-estimated in this pass (the review's working files (not kept)): 480 rules, 50,000 bytes raw and 8,723 gzip on their own, are for classes named only in src/components/admin or src/app/admin, after keeping the admin files that non-admin code draws. None of those classes appears in the migrations' SQL, the other place Tailwind reads. Those kept files, found by walking static and dynamic imports from every non-admin component and route without passing through src/server (the review's working files (not kept)), are 11: action-form, admin-text-context, admin-text, colour-field, colour-library, css-code-editor, design-cards, modal, rich-text-editor, text-styles and work/print-button. They come in through the staff's on-site editing (components/inline-edit: 7 of the 11), Kaizena Flow's sign-up and status forms, and the hosted invoice's print button. The report's fix did not have this list; without it the staff's editor on the live site would lose its styles.
- **Cost today:** About 50 KB raw / 8.7 KB gzip of render-blocking CSS on a shopper's first page that only the admin uses (estimate by substring match). The file's address changes when any class anywhere in src changes, so a deploy of admin work alone makes every returning shopper download the whole 32 KB sheet again. With many deploys a day and real returning shoppers that will matter more than the 8.7 KB. Paid by: A shopper's browser
- **Saving:** Estimate: about 50,000 bytes raw / 8,700 gzip off the render-blocking stylesheet of every storefront and site page (27 % raw), and a storefront stylesheet address that admin-only work no longer changes.
- **Risk:** Medium. A class a storefront part takes from an admin file not in the list, or from page data, would lose its rule; it shows as a visibly unstyled part, which only the e2e suite and a look at the pages catch. A second Tailwind pass must fit under Vercel's 8 GB: the margin was about 0.8 GB when last measured.

## The fix

1. Measure first. Build with a second Tailwind entry under an 8 GB memory cap, as docs/build-memory.md describes, and stop if the peak passes it: the doc records about 7.2 GB, and this review's uncapped local build peaked at 7,609,552 KB.
2. Split src/app/globals.css: everything after its @source lines moves to src/app/base.css. globals.css becomes: @import 'tailwindcss' source(none); @source '../'; @source not '../data'; @source not '../components/admin'; @source not './admin'; the 11 explicit @source lines of step 3; @source '../../supabase/migrations/*.sql'; @import './motion.css'; @import './base.css'.
3. Keep in the storefront sheet the admin files non-admin code draws: src/components/admin/action-form.tsx, admin-text-context.tsx, admin-text.tsx, colour-field.tsx, colour-library.tsx, css-code-editor.tsx, design-cards.tsx, modal.tsx, rich-text-editor.tsx, text-styles.tsx and work/print-button.tsx. First check on a small build that Tailwind 4 honours a positive @source for a file inside a folder excluded by @source not (put a canary class in one and look for it in the sheet). If it does not, move these 11 files out of components/admin instead.
4. New src/app/admin/admin-tailwind.css: @import 'tailwindcss' source(none); @source '../../'; @source not '../../data'; @source '../../../supabase/migrations/*.sql'; @import '../motion.css'; @import '../base.css'. src/app/admin/layout.tsx:13 imports it in place of ../globals.css: the builder draws storefront parts inside the admin, so the admin reads everything.
5. New src/lib/stylesheet-sources.scan.test.ts: recompute step 3's list from the source (the walk of the review's working files (not kept)) and fail when an admin file that non-admin code can draw is not named in globals.css.
6. Classes that reach a storefront as data: list the classes in the admin sheet that are not in the storefront sheet and search the seeded pages' JSON and the theme content in supabase/migrations/*.sql for each (this pass found none of the 480 rules' classes there).
7. Update docs/build-memory.md (two entries, the measured peak) and docs/performance.md; a decision line.

**Done when:** The stylesheet the storefront's HTML links (/s/demo/no) is at most 135,000 bytes raw (183,124 today), the build's peak memory under an 8 GB cap is written into docs/build-memory.md, and stylesheet-sources.scan.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- The whole e2e suite is the check for a lost style; most of all e2e/signed-in (the admin and the builder), the on-site editing specs (rg -l 'inline-edit|Edit text' e2e), e2e/platform-languages.spec.ts and the sign-up specs (ActionForm outside the admin)
- e2e/performance.spec.ts page-weight budgets (lower them by the stylesheet's fall)
- Rule docs/build-memory.md:18-40 and CLAUDE.md: keep Tailwind's @source lines pointed at code, never at data or snapshots. Kept in both entries.
- Rule docs/admin-style.md: admin.css reads only the colour roles; not changed.

**Notes:** P2 because the saving is an estimate, the risk is a silent visual one, and the build's memory margin is thin. The stable address is the stronger reason; take it up when deploys to production with real returning shoppers are frequent, or when the build's memory is next worked on.
