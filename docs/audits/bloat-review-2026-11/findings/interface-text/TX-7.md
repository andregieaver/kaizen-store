# TX-7 ✓ The page builder and the draft-order editor load all four storefront languages

Interface text (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.29.
- **Second check:** corrected.
- **Where:** `src/components/admin/block-fields.tsx:21`, `src/components/admin/block-fields.tsx:2684`, `src/components/admin/modal-preview.tsx:18`, `src/components/admin/modal-preview.tsx:34`, `src/components/admin/drafts/draft-summary.tsx:3`, `src/components/admin/drafts/draft-summary.tsx:35`, `src/components/admin/page-builder-fields.tsx:13`, `src/components/admin/page-builder-fields.tsx:1537`, `src/components/content-grid.tsx:9`, `src/components/content-grid.tsx:63`, `src/lib/i18n.ts:9-17`, `.next/diagnostics/route-bundle-stats.json`
- **Evidence:** Five modules in the admin's client graph import t from lib/i18n, which imports every language whole: block-fields.tsx (the form group, line 2684), modal-preview.tsx (the modal group, line 34), draft-summary.tsx (unitPrice.bases, line 35), and page-builder-fields.tsx (line 1537) with content-grid.tsx (line 63), which draw the grid preview with t(data.lang) and pass the whole Messages on to Price and the campaign badge. My client graph finds 21 admin client entries that reach lib/i18n and none outside the admin. In the build, chunk 1u2592k6jkhim.js (314,914 characters) holds a sentence of the Swedish main file and is in the first-load chunks of 40 admin routes. On the measured page builder the two chunks with all four languages are 318,693 + 49,242 bytes raw, 103,098 + 15,315 gzip, 77% executed (verified report).
- **Cost today:** About 368 KB raw / 118 KB gzip of first scripts on 40 admin routes (the page, header, footer and layout editors and the draft-order editor): about a tenth of what the page builder transfers. Paid by: An owner's browser when a page, header, footer or draft order is opened.
- **Saving:** Draft-order editor: about 368 KB raw / 118 KB gzip (from the import graph; that page was not measured). Page editors: about three of the four languages off the first load, roughly 275 KB raw / 88 KB gzip (estimate); the fourth comes after load when a preview first needs the page's language.
- **Risk:** The grid preview waits for its language's module on first draw; a preview in another language than the page's needs that module too. An AI-translated language has no module and previews in English, as today. A unit test that cannot wait must be given the module beforehand.
- **Already tracked:** no (docs/performance.md says the admin reads them all; PSI PERF-01 is the open step for admin scripts)

## The fix

1. Draft-order editor: src/components/admin/drafts/draft-summary.tsx takes bases as a prop and drops its import of lib/i18n (lines 3 and 35); draft-editor.tsx and draft-sent-panel.tsx pass it on from their server pages, which read t(adminLang).unitPrice.bases. That route then loads no storefront language.
2. New src/components/admin/site-words.ts: siteWordsLater(lang) with one import() per hand-written language module (@/lib/messages/nb, sv, da, en; English for any other language), kept in a Map as admin-text-later.ts keeps its areas, and a hook useSiteWords(lang) that returns Messages or null until the module has arrived.
3. src/components/content-grid.tsx: move the body of ContentGridView into a new src/components/content-grid-tiles.tsx as ContentGridTiles, which takes m as a prop and imports nothing from lib/i18n. ContentGridView stays as two lines: const m = t(data.lang); return <ContentGridTiles ... m={m} />. The storefront's callers do not change.
4. src/components/admin/page-builder-fields.tsx (lines 13 and 1537): drop the lib/i18n import; const m = useSiteWords(data.lang); show the existing 'finding' note while it is null; then draw <ContentGridTiles ... m={m} />.
5. src/components/admin/modal-preview.tsx (lines 18 and 34) and block-fields.tsx (lines 21 and 2684) read through useSiteWords(); the modal preview mounts PageModal only when open and the words are there; the form placeholders are empty until they arrive.
6. Add lib/i18n and lib/messages/{lang} to the admin's import guard (AC-11's admin-bundle.scan.test.ts, or a copy of the walk of storefront-bundle.scan.test.ts over src/components/admin and src/app/admin) with site-words.ts as the one allowed importer by import().

**Done when:** After a build, no route in .next/diagnostics/route-bundle-stats.json has a first-load chunk holding a sentence of src/lib/messages/sv.ts (search 'Det gäller alla beställningar vännen gör.'; 40 admin routes today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/storefront-bundle.scan.test.ts: content-grid.tsx is not a visitor client entry today; after step 3 confirm the storefront's recommended grid (loaded with import()) no longer pulls lib/i18n.
- Unit tests that draw page-builder-fields.tsx or modal-preview.tsx with renderToStaticMarkup() cannot wait: settle the English module in src/test (as admin-english.ts does for the admin's areas).
- e2e/signed-in builder specs (builder-columns, builder-lines, builder-palette) and the drafts specs: the grid preview and the draft summary still show their words.
- Rule changed in wording: docs/performance.md:52-60 says the server, emails and the admin read every language through t(); after this the admin's client parts load one language's module when a preview needs it. D212's reason (the visitor's browser never loads a whole language) is untouched.

**Notes:** The same change as AC-6 (admin-client) and BN-6 (client-bundles); the steps follow AC-6 so there is one plan. Messages hold functions, so the whole object cannot cross from the server as a prop: that is why the builder loads one language module itself.
