# AC-3 ✓ Order, customer and deal screens load the rich text editor and the builder's schema for custom fields, whether or not the store has any

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.10.
- **Second check:** corrected.
- **Where:** `src/components/admin/staff-fields-section.tsx:2`, `src/components/admin/staff-fields-section.tsx:31`, `src/components/admin/entity-fields-card.tsx:5`, `src/components/admin/fields-form.tsx:35`, `src/components/admin/fields-form.tsx:41`, `src/components/admin/fields-form.tsx:451`, `src/components/admin/term-page-fields.tsx:10`, `src/lib/custom-fields.ts:5`, `src/lib/page-content.ts:149`, `src/lib/page-content.ts:286`, `src/components/lazy/lazy-view.tsx:13`, `src/app/admin/(gated)/[store]/orders/[orderId]/page.tsx:843`
- **Evidence:** The order screen is 1,998,644 bytes raw / 611,343 gzip, a customer 1,936,135, a deal 1,858,910. One path brings the excess on all three: StaffFieldsSection imports EntityFieldsCard, which imports entity-fields, fields-form and RichTextEditor (Tiptap), and custom-fields.ts imports two helpers from page-content.ts; fields-form.tsx imports EMPTY_DOC from page-content.ts itself. StaffFieldsSection returns null when the store has no group for that kind of thing (line 31), but a route loads every client module its server modules import, drawn or not. With the card out of the order route's client modules my closure falls from 207 files (2.00 MB of source) to 141 (0.96 MB) and reaches neither Tiptap nor page-content.ts. The verified report sized the seven chunks at 693,851 bytes (Tiptap 435,421 of it). The repo already has the tool: lazyView(dynamic(...)) in src/components/lazy, where the server still draws the part and asks for its script with the page.
- **Cost today:** About 0.69 MB raw / 217 KB gzip on every order, customer and deal screen of a store with no custom fields for them; 435 KB of it wherever no rich text field is shown. Paid by: An owner's browser, on the screens used most in daily work. A store that never sets up custom fields pays the same as one that uses them: the cost does not follow use.
- **Saving:** From measured chunks: an order screen from 2.00 MB to about 1.3 MB raw (611 to about 395 KB gzip) while the store has no fields for orders; 435 KB raw less wherever no rich text field is shown.
- **Risk:** Low to medium. For a store with groups the card's script is a chunk of its own, asked for with the page; until it has run, the card's Save does nothing (it is a button, not a form post, so nothing is submitted wrongly). A rich text field appears a moment after its form: keep a placeholder of the same height. It would show in the customers-staff and deals specs and in the new order spec.
- **Already tracked:** No. Code review step 3.2 would split page-content into a folder (Open) but does not name this.

## The fix

1. Create src/components/admin/lazy/fields.tsx ("use client") after the pattern of src/components/lazy/blocks.tsx: `export const EntityFieldsCard = lazyView(dynamic(() => import("../entity-fields-card").then((m) => m.EntityFieldsCard)));` with the import() written inside dynamic(), as lazy-view.tsx lines 5-11 require.
2. src/components/admin/staff-fields-section.tsx line 2: import EntityFieldsCard from "./lazy/fields". Keep the return null at line 31. Leave src/app/admin/(gated)/[store]/fields/store/page.tsx line 5 on the direct import: that screen is the form.
3. Add the stand-in to src/test/eager-lazy-views.ts (vi.mock of "@/components/admin/lazy/fields" with the real component), so unit tests that draw with renderToStaticMarkup see the card.
4. For stores with groups but no rich text field: add RichTextEditor to the same lazy file, with a fallback box of the editor's height, and import it from there in fields-form.tsx line 41 and term-page-fields.tsx line 10. The value stays in the form's state, so Save never loses it.
5. Move the rich text part of src/lib/page-content.ts (the types from Mark to RichTextDoc, EMPTY_DOC, isLinkAddress, cleanRichText, richTextPlain at lines 115-312, and richTextIsEmpty at 2273; they need only HEX6 and isOpacity from ./colour and the RICH_TEXT_MAX constant) into src/lib/rich-text-doc.ts; page-content.ts adds `export * from "./rich-text-doc"` so its public surface is unchanged. Change the imports at src/lib/custom-fields.ts line 5, fields-form.tsx line 35 and term-page-fields.tsx line 12 to the new file.
6. Add an order screen to BUDGETS in e2e/signed-in/admin-scripts.spec.ts.

**Done when:** route-bundle-stats.json after a build: /admin/[store]/orders/[orderId] at or under 1,350,000 bytes (1,998,644 today) with no Tiptap chunk in its firstLoadChunkPaths, and the same for customers/[customerId] and deals/[dealId].

**Tests and rules that hold today's behaviour, and change with it:**

- src/components/admin/fields-form.test.ts, fields-form-flexible.test.ts and fields-form-helpers.test.ts.
- src/lib/page-content.test.ts and the tests of custom-fields (rich text cleaning must behave the same from the new file).
- src/test/eager-lazy-views.ts: the new stand-in.
- e2e/signed-in/customers-staff.spec.ts, deals.spec.ts, orders-list.spec.ts and content-types.spec.ts; add a spec that fills and saves a staff field on an order of a store with a group.
- src/lib/storefront-bundle.scan.test.ts forbids lib/page-content in a visitor's scripts: rich-text-doc.ts has no zod, so it may be imported where page-content may not.
- docs/performance.md, the lesson of 31 October (a part that is not interactive when the page has loaded) and docs/custom-fields.md.
- Code review step 3.2 (one definition per block, Open) will split page-content into a folder with the same public surface: step 5 here is its first slice and must not change what page-content exports.

**Notes:** Steps 1 to 3 alone give the whole saving where no group applies and are the part to do first; steps 4 and 5 serve stores that use custom fields without rich text.
