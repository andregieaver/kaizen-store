# BN-6 ✓ The page builder and the draft order editor ship all four storefront languages whole

The built client bundles, by page (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.29.
- **Second check:** confirmed.
- **Where:** `src/lib/i18n.ts:9`, `src/lib/i18n.ts:17`, `src/components/admin/page-builder-fields.tsx:13`, `src/components/admin/page-builder-fields.tsx:1537`, `src/components/admin/block-fields.tsx:21`, `src/components/admin/block-fields.tsx:2684`, `src/components/admin/modal-preview.tsx:18`, `src/components/admin/modal-preview.tsx:34`, `src/components/content-grid.tsx:9`, `src/components/content-grid.tsx:63`, `src/components/admin/drafts/draft-summary.tsx:3`, `src/components/admin/drafts/draft-summary.tsx:35`
- **Evidence:** Chunk 1u2592k6jkhim.js (318,693 bytes, 102,965 gzip) is lib/i18n with messages nb, sv, da and en merged, in the first-load list of 40 routes: the builder's 39 and the draft order editor. Five client call sites read it through t(lang), one language at a time and a few keys each: the grid's preview (page-builder-fields.tsx:1537, then ContentGridView, which calls t() itself at content-grid.tsx:63), a form's usual words (block-fields.tsx:2684, plain strings), a modal's two words (modal-preview.tsx:34) and the unit price bases of a draft order (draft-summary.tsx:35). A second module with the four languages' returns texts (32,258 bytes) rides with it. The four source files are 383,069 bytes and hold 345 functions in English alone, so a whole language cannot cross from the server as a prop.
- **Cost today:** 343 KB raw (about 110 KB gzip) on each load of the builder and 368 KB on the draft order editor, of which one language (about 68 KB) can be read at a time. Paid by: An owner's browser each time a page, header, footer, article or layout is opened in the builder, and on each draft order.
- **Saving:** Simulated on the real chunks: 343 KB off the builder's first scripts (3,186 to 2,591 KB together with BN-1) and 368 KB off the draft order editor. One language, about 68 to 80 KB, comes back after load when a preview first needs it (estimate from the source sizes).
- **Risk:** Medium. A preview inside the builder must find every key it draws in each language of the store; one missed shows English or an empty placeholder until the language arrives. It would show in the builder specs and by eye in a Norwegian store.
- **Already tracked:** Not as a step. docs/performance.md (D212) states that the admin reads all four languages through t(). Same change as AC-6 and TX-7.

## The fix

1. src/components/content-grid.tsx: ContentGridView takes its words as a prop m and no longer imports lib/i18n (this is BN-16 step 2; do it once). Its server callers pass t(data.lang): content-grid-section.tsx, src/app/s/[store]/[market]/blog/blog-listing.tsx lines 164 and 242, src/components/platform-routes/terms.tsx lines 100 and 116.
2. New file src/components/admin/site-words.ts: siteWordsLater(lang) with one import() per hand-written language module (@/lib/messages/nb, sv, da, en; English for any other), kept in a Map as admin-text-later.ts keeps its areas, and a hook useSiteWords(lang) that returns Messages or null until the module has arrived.
3. src/components/admin/page-builder-fields.tsx lines 13 and 1537: drop the import; const m = useSiteWords(data.lang); while it is null show note(gw.finding), as the lines above do for a grid still loading; pass m to ContentGridView.
4. src/components/admin/modal-preview.tsx lines 18 and 34: the two words (close, dialog) from useSiteWords(lang ?? 'en'); mount the preview only when it is open and the words are there.
5. src/components/admin/block-fields.tsx lines 21 and 2684 to 2688 and 2814: usualForm becomes a hook on useSiteWords(lang === 'nb' ? 'nb' : 'en'); the placeholders that use it are empty until it arrives.
6. src/components/admin/drafts/draft-summary.tsx lines 3 and 35: take bases as a prop (plain strings); the server page of the draft editor passes t(adminLang).unitPrice.bases down through draft-editor.tsx.
7. Add lib/i18n and lib/messages/{lang} to the forbidden list of BN-4's admin scan for every admin client module, with no exceptions left.

**Done when:** After pnpm build, no route's first-load chunks contain a whole language (marker 'nettbutikk med levering i'; 40 routes today), /admin/[store]/pages/[pageId] is at or under 2,970,000 bytes in route-bundle-stats.json (3,303,372 today, before BN-1) and /admin/[store]/orders/drafts/[draftId] at or under 1,250,000 (1,607,368 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/storefront-bundle.scan.test.ts line 16 (lib/i18n is not a visitor's script): content-grid.tsx stops importing it, which BN-16 also needs.
- Unit tests that draw ContentGridView or the builder's grid preview (rg ContentGridView and content-grid in src/**/*.test.ts) pass the words; src/test/eager-lazy-views.ts.
- e2e/signed-in/shop-components.spec.ts, products-grid.spec.ts, the builder-* specs and quotes.spec.ts (draft orders); run the grid's preview once in a store whose language is Norwegian and once in one translated by AI (ui-registry): a missing key shows English.
- Rule docs/performance.md lines 52 to 62 (D212): a language's whole module is the server's and the admin's. Kept, with one addition to write there: the admin's browser loads one language, when a preview needs it.
- Code review step 3.4 (Open) is about the builder's dialogs; this is beside it, not part of it.

**Comes after:** BN-16 (step 2 there is step 1 here)

**Notes:** The report's first fix (hand the texts down from the server) works only for the three sites that read plain strings; the messages hold functions, which is why the plan loads one language on demand instead.
