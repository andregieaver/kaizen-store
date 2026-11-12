# PM-8 ✓ A product grid with Filter and sort is sent twice when nothing is chosen

The page builder's model and a built page's render (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.7.
- **Second check:** confirmed.
- **Where:** `src/components/content-grid-section.tsx:40`, `src/components/content-grid-section.tsx:80`, `src/components/content-grid-section.tsx:86`, `src/components/content-grid-section.tsx:97`, `src/components/content-grid-section.tsx:116`
- **Evidence:** The grid is the Suspense fallback in the prerendered shell (content-grid-section.tsx:40-44), and FilterableGrid streams a second grid in its place on each request. With no filter on page 1 the second holds the same items (`unfiltered && page === 1 ? null`, then `data.items`, :86-97, drawn again at :116). Re-run in this pass (work/pmsk/grid.mjs on the captured /s/demo/no/products): the streamed block S:1 is 16,702 B with 18 product links and 9 pictures, in a document of 55,163 B of markup; the home page, whose grid has no filters, has no such block.
- **Cost today:** 16.7 KB of markup on a store's main listing, and its twin in the payload; 2.5 KB gzip or 1.0 KB Brotli of the document. More important: the server draws every tile again on each request and the browser swaps the built grid for an identical one. About four times that at the grid's limit of 48 (estimate). Paid by: The server per request; a shopper's browser
- **Saving:** Measured: 16.7 KB raw of markup on the demo's /products (30% of its markup), 1.0 to 2.5 KB on the wire, plus its twin in the payload (estimate) and one grid render per request.
- **Risk:** Medium. Three things to watch: the controls now arrive above a grid that is already there (the same shift as today, when the controls replace the fallback); a filtered view sends the built grid hidden as well, so a filtered page is no smaller than now; a browser that shows the page before the stylesheet's rule applies could flash both grids. The two listing specs cover the behaviour; look at a filtered address on a slow connection by hand once.
- **Already tracked:** no (code review step 2.15, FF6, Open, plans filters without script and touches the same file)

## The fix

1. src/components/content-grid-section.tsx: change the shape at :40-46 from one boundary whose fallback is the grid to three siblings in one `flex flex-col gap-4` box: (a) <Suspense fallback={null}> around a new async ListingTop, (b) the built grid in a wrapper with data-grid-built, drawn in the shell, never a fallback, (c) <Suspense fallback={null}> around a new async ListingMore for the Show more link.
2. Split FilterableGrid's reads into one loader, memoised for the request with perRequest() (src/server/request-memo.ts) on the store, the block's id and the query string: shop, filters, scope, buyer, facets, the listed page (only when filtered or past page 1), terms. ListingTop and ListingMore both await it.
3. ListingTop draws ListingControls as today. When something is chosen or the page is past 1 it also draws the filtered grid (or the 'none' line) inside a wrapper with data-grid-listed. When nothing is chosen it draws the controls only: the shell's grid stays.
4. src/app/globals.css: one rule, [data-grid-listed] ~ [data-grid-built] { display: none }, so a streamed filtered grid takes the built one's place. Without script the built grid stays, as the fallback does today (code review step 2.15 plans filters without script; this does not change what it starts from).
5. ListingMore draws the count and the Show more link (:118-125) from the same loader, after the grid.
6. The tiles' stock and quantity parts (D557) need no change: both grids are the same ContentGridView with the same `tiles`.

**Done when:** node work/pmsk/grid.mjs on a capture of the new build's /s/demo/no/products counts 3 product links in its streamed blocks, as on the home page (21 today: block S:1 alone holds 18 in 16,702 bytes), and e2e/listing.spec.ts and e2e/products-page.spec.ts pass.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/listing.spec.ts and e2e/products-page.spec.ts (filters, sort, Show more, the count), e2e/custom-fields-ranges.spec.ts (the filter button answers at once: it stays in the first scripts), e2e/recommendations.spec.ts (the other Suspense shape in the same file, untouched).
- src/lib/grid-source.test.ts names the section; src/lib/listing-filters tests hold the parsing, unchanged.
- Rule docs/performance.md:38-52: a listing's filter button stays in the first scripts. Kept. Rule docs/rules/storefront.md (Sorting and filtering listings, D78/D83): the grid as set is the prerendered stand-in; reword to say it stays when nothing is chosen.

**Notes:** PL-6 (page payload) is the same finding. The listing is a store's busiest built page once shoppers arrive, so the per-request second render is the part that will grow. Do it with step 2.15 if that step is taken up first.
