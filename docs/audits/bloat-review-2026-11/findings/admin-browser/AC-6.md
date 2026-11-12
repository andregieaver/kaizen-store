# AC-6 ✓ The builder and the draft order editor load the storefront's text in all four languages

What an owner's browser loads in the admin (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.15.
- **Second check:** corrected.
- **Where:** `src/components/admin/block-fields.tsx:21`, `src/components/admin/block-fields.tsx:2684`, `src/components/admin/modal-preview.tsx:18`, `src/components/admin/modal-preview.tsx:34`, `src/components/admin/page-builder-fields.tsx:13`, `src/components/admin/page-builder-fields.tsx:1537`, `src/components/content-grid.tsx:9`, `src/components/content-grid.tsx:63`, `src/components/admin/drafts/draft-summary.tsx:3`, `src/components/admin/drafts/draft-summary.tsx:35`, `src/lib/i18n.ts:9`, `src/lib/storefront-bundle.scan.test.ts:14`
- **Evidence:** Chunk 1u2592k6jkhim.js (318,693 bytes raw / 103,098 gzip) holds messages/da, nb, sv and en and is in the first load of 40 admin routes: the 39 builder routes and the draft order editor. Any import of lib/i18n brings all four (i18n.ts lines 9-12). In the builder's client closure four modules import it as a value: block-fields.tsx (the form's usual words, one of them a function), modal-preview.tsx (two strings), page-builder-fields.tsx line 1537 (the grid preview, with the function listing.count) and the shared content-grid.tsx line 63, which hands the whole object on to Price and CampaignBadge. Cutting those four edges removes 21 files and 472 KB of source from the builder's closure; the browser texts (messages/*-browser.ts) stay through lib/browser-text.ts. The draft order editor reads one branch of plain strings (unitPrice.bases, messages/en.ts line 712). The storefront's scan test forbids lib/i18n in a visitor's scripts and leaves the admin out.
- **Cost today:** About 350 KB raw / about 113 KB gzip on 40 routes (the chunk and a 49,242-byte chunk of returns texts on 39). Paid by: An owner's browser in the builder and on a draft order.
- **Saving:** Estimate: about 350 KB raw / 113 KB gzip off the first load of the 39 builder routes and about 319 KB off the draft order editor; about 80 to 90 KB of it comes back after load in the builder when a preview first needs the store's language.
- **Risk:** Low to medium. content-grid.tsx is drawn by the storefront too: its wrapper keeps the same props, so only the admin's call changes. A grid preview shows its waiting note a moment longer on first draw. A store in a language translated by AI sees English in the builder's preview, as it does today in the browser (the registry of such languages is the server's). It would show in the builder specs and shop-components.spec.ts.
- **Already tracked:** No.

## The fix

1. Create src/components/admin/site-words.ts: siteWordsLater(lang) with one import() per hand-written language module (@/lib/messages/nb, sv, da, en; English for any other language), kept in a Map per language as admin-text-later.ts keeps its areas, and a hook useSiteWords(lang) that returns Messages or null until the module has arrived.
2. src/components/content-grid.tsx: move the body of ContentGridView into src/components/content-grid-tiles.tsx as ContentGridTiles, taking m as a prop and importing nothing from lib/i18n. ContentGridView stays in content-grid.tsx as two lines: const m = t(data.lang); return <ContentGridTiles ... m={m} />. The storefront's callers (content-grid-section.tsx, blog-listing.tsx, platform-routes/terms.tsx, recommended-grid.tsx) do not change.
3. src/components/admin/page-builder-fields.tsx lines 12, 13 and 1537-1549: drop the lib/i18n import; const m = useSiteWords(data.lang); while it is null show note(gw.finding); draw <ContentGridTiles ... m={m} />.
4. src/components/admin/modal-preview.tsx lines 18 and 34: useSiteWords(lang ?? "en"); mount PageModal only when the preview is open and the words are there.
5. src/components/admin/block-fields.tsx lines 21 and 2684: usualForm becomes a hook on useSiteWords(lang === "nb" ? "nb" : "en"); the placeholders that use it are empty until it arrives.
6. src/components/admin/drafts/draft-summary.tsx lines 3 and 35: take bases as a prop; draft-editor.tsx line 27 and draft-sent-panel.tsx line 17 pass it on from their server pages (t(adminLang).unitPrice.bases).
7. Add lib/i18n and lib/messages/{lang} to the admin import guard of AC-11.

**Done when:** route-bundle-stats.json after a build: no admin route has a first-load chunk holding the four language modules (40 routes carry 1u2592k6jkhim.js today), and /admin/[store]/orders/drafts/[draftId] is at or under 1,300,000 bytes (1,607,368 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/storefront-bundle.scan.test.ts: content-grid-tiles.tsx must not import lib/i18n; the walk does not follow recommended-grid's import().
- Unit tests that draw ContentGridView or the builder's grid preview (rg content-grid in src/**/*.test.ts) and src/test/eager-lazy-views.ts.
- e2e/signed-in/shop-components.spec.ts, products-grid.spec.ts, the builder specs, and quotes.spec.ts for draft orders; run the grid preview once in a Norwegian store.
- docs/rules/storefront.md, Interface text (D212): a language's whole module is the server's and the admin's; add that the admin's browser loads one language when a preview needs it.

**Notes:** The messages hold functions, so the whole object cannot cross from the server as a prop; that is why the admin loads one language module itself. The split also takes lib/i18n out of the chunk the storefront's recommended grid loads on demand (not measured here; the storefront's review should count it).
