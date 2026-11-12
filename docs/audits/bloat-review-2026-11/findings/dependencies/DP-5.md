# DP-5 ✓ The rich text editor is sent to 21 admin lists and detail pages that may never show it

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** confirmed.
- **Where:** `src/components/admin/term-page-fields.tsx:10`, `src/components/admin/term-page-fields.tsx:98`, `src/components/admin/terms.tsx:23`, `src/app/admin/(gated)/[store]/pages/views.tsx:9`, `src/components/admin/fields-form.tsx:41`, `src/components/admin/fields-form.tsx:451`, `src/components/admin/staff-fields-section.tsx:31`, `src/components/lazy/lazy-view.tsx:13`, `src/components/lazy/shop.tsx:15`, `src/test/eager-lazy-views.ts:17`, `src/components/admin/fields-form.test.ts:18-23`, `node_modules/next/dist/server/app-render/create-component-styles-and-scripts.js`, `docs/performance.md:38`, `e2e/signed-in/admin-scripts.spec.ts:36-46`
- **Evidence:** The tiptap/ProseMirror chunk is 435,421 bytes raw, 136,315 gzip, and 73 admin routes name it (both re-measured). 21 of them are not editors: the lists of pages, articles, headers, footers, product layouts and content, the category screens, and the order, customer and deal detail pages. Two static imports cause all of it. Walked again on 13 of those routes: every chain to @tiptap/react runs through terms.tsx to term-page-fields.tsx:10 (a category's description) or through fields-form.tsx:41 (a rich-text custom field); with those two edges cut none reaches tiptap. Next writes a script tag for every file in a page's entry list whether or not the component is drawn, so the order page sends the editor when StaffFieldsSection returns null because the store has no field group, and the pages list sends it although the categories manager is drawn only on the categories view. The budget file shows the price: the pages list's first scripts are 2,093,288 bytes against 1,284,745 for the admin home.
- **Cost today:** 435 KB raw / 136 KB gzip of script on 21 screens whether or not an editor is drawn. Paid by: An owner's browser on the page, article and content lists and on every order, customer and deal page. Order and customer pages are what staff open most once a store sells, so this grows with real use.
- **Saving:** 435 KB raw / 136 KB gzip off the first scripts of 21 routes (measured chunk size).
- **Risk:** Low. After a move within the admin the editor's box shows empty for a moment before the editor arrives; on a full load the server still draws it. The builder's own pages are untouched. A break would show in e2e/pages.spec.ts and the fields-form unit tests.
- **Already tracked:** Adjacent: code review step 3.4 (FB8), Open, loads the builder's dialogs on demand; it does not cover these lists and detail pages. The admin-client review's AC-2 (26 screens load an editor through a shared views file) overlaps: do the two together.

## The fix

1. Create src/components/admin/lazy/editors.tsx ('use client') in the style of src/components/lazy/shop.tsx: export const RichTextEditor = lazyView(dynamic(() => import('../rich-text-editor').then((m) => m.RichTextEditor)), () => <div aria-busy='true' className={...the editor's own outer box classes, copied from rich-text-editor.tsx, so the form does not jump} />); The import() must be written inside dynamic(), as lazy-view.tsx says. ssr stays on: the server still draws the editor where it is used, and Next asks for its script only on a page that draws it.
2. src/components/admin/term-page-fields.tsx:10 and src/components/admin/fields-form.tsx:41: import RichTextEditor from '@/components/admin/lazy/editors' (or the relative path). No other line changes.
3. src/test/eager-lazy-views.ts: add a vi.mock of '@/components/admin/lazy/editors' that hands back the real RichTextEditor (with the file's pick() helper), so src/components/admin/fields-form.test.ts ('every type of field draws') still sees the editor's markup.
4. Leave page-builder.tsx, block-fields.tsx, page-builder-fields.tsx and markup-input.tsx alone: the builder's own pages need the editor at once (code review step 3.4 covers its dialogs).
5. Run the signed-in suite with E2E_MEASURE=1; lower the '/pages' budget in e2e/signed-in/admin-scripts.spec.ts and add '/orders/{order}' and '/products/categories' to BUDGETS (the spec already resolves '{page}' from the database; resolve an order id the same way).
6. docs/performance.md, 'The admin as people use it': one line that an editor the screen may not draw is loaded where it is drawn, naming lazy/editors.tsx.

**Done when:** The pages list measured by e2e/signed-in/admin-scripts.spec.ts with E2E_MEASURE=1 falls from 2,093,288 bytes to under 1,700,000, and the HTML of an order page has no script tag for the chunk that contains 'ProseMirror-'.

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/fields-form.test.ts, fields-form-flexible.test.ts, fields-form-helpers.test.ts: must pass; the first needs the new mock in src/test/eager-lazy-views.ts (a vitest setup file, vitest.config.mts:15)
- e2e/pages.spec.ts and e2e/signed-in/text-styles.spec.ts type into ProseMirror editors: must pass; Playwright waits for the editor to appear
- e2e/signed-in/admin-scripts.spec.ts: '/pages' budget (2,180,000) lowered; two screens added
- docs/performance.md:38-48 (a client component only some pages draw is loaded where it is drawn; not one a person types into at once): the placeholder is a div, so nothing typed is lost
- The admin-client review's AC-11 (an import guard for the admin) can list @tiptap as allowed only from named editor modules

**Notes:** The fix uses the house lazyView() stand-in instead of the skeptic's dynamic(..., { ssr: false }): it keeps the server drawing the field, which a unit test holds, and it is the pattern docs/performance.md already names. @dnd-kit (14 KB gzip) still rides with term-page-fields.tsx; too small to chase.
