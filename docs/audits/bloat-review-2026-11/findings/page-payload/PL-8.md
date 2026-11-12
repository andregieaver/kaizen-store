# PL-8 ✓ Stock and Add to cart on tiles: off by default, yet every view of a product grid pays a server call and three queries

What a page sends: document, payload and requests (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.12.
- **Second check:** confirmed.
- **Where:** `src/lib/shop-tiles.ts:21`, `src/lib/shop-tiles.ts:35`, `src/components/content-grid-section.tsx:37`, `src/components/content-grid-section.tsx:139`, `src/components/content-grid.tsx:222`, `src/components/tile-shop.tsx:21`, `src/components/tile-shop.tsx:62`, `src/app/api/shop/tiles/route.ts:14`, `src/server/shop-tiles.ts:27`, `src/server/product-settings.ts:14`, `docs/rules/admin/website.md:728`
- **Evidence:** DEFAULT_PRODUCT_SETTINGS has both switches off (shop-tiles.ts:21), but a grid's ask defaults to 'store' for both (tileAsk, line 35), so every product tile draws a TileShop island (content-grid.tsx:222) that asks /api/shop/tiles to learn the settings with the facts. The route reads the settings, then the products with their variants, then the stock, whatever the settings say (shop-tiles.ts:27-52). In routes.json the home and the listing each made one GET after load (1,193 bytes decoded, no-store); a headless load in this pass shows the same call with a cart. The island then draws nothing, because both switches are off (tile-shop.tsx:62-66). The design is deliberate and two days old (D557): product-settings.ts:14 says the settings are read per request, never cached, so a change shows on the next view without refreshing the catalogue. This is the owner's clarification exactly: a store that never switches the feature on pays for it on every view.
- **Cost today:** Per view of any page with a product grid: one uncached function call, three queries (settings, products with variants, stock), a 1.2 KB answer, and the island's props and script, for every store that leaves the default. Paid by: The server and the database per request; a shopper's browser.
- **Saving:** One function call and three queries per view of a front page or listing with a product grid, for every store that leaves the default; about 0.3 KB of props per tile and the island's script.
- **Risk:** Low: a store that turns a switch on sees it after the tag refresh, like any catalogue change. A grid whose own choice is 'show' is untouched.

## The fix

1. src/server/product-settings.ts: beside getProductSettings() add productSettingsCached(storeId) with 'use cache', cacheLife('hours') and cacheTag(catalogTag(storeId)), as src/server/catalog.ts:643-645 does. In saveProductSettings() (line 27) call refreshTag(catalogTag(member.store.id)) (src/server/refresh.ts:10) after the write, so the change still shows on the next view. Correct the comment at lines 12-16.
2. src/lib/shop-tiles.ts: add the pure tileAskFor(own, store): what a grid still needs to ask once the store's two switches are known. 'show' for each of stock and quantity that will show, null for each that will not, and null for the grid when neither will. Unit cases in src/lib/shop-tiles.test.ts: defaults with no own choice give null; a grid's own 'show' gives an ask; a store's switch on gives an ask; a grid's own 'hide' beats the store.
3. src/components/content-grid-section.tsx:37 and 139: const tiles = place.owner ? tileAskFor(block.shopTiles, await productSettingsCached(place.owner)) : null. A grid that shows neither then draws no island, loads no script for it and asks nothing.
4. The route and tileFacts() stay as they are: stock is still asked per request, now only by grids that show it. The answer keeps its settings field for pages already in a browser.
5. e2e/shop-components.spec.ts:50-71: the second test inserts the settings row with SQL after the page was first drawn and expects the next load to show stock; a cached read cannot see a row written behind its back. Give it two stores: one whose row is inserted before its first page view (stock shows), one without a row (no request to /api/shop/tiles, no [data-tile-shop]). Add a signed-in check that saving Settings, Products shows on the next load of the store's front page.
6. Docs: docs/rules/admin/website.md:728 (D557): 'the store's two switches are read with the catalogue's cache and refreshed when saved; stock is asked per request, only by grids that show it'. Correct the comment at src/lib/shop-tiles.ts:6-8. Lower PL-13's after-load fetch budget for the home and the listing.

**Done when:** A cold phone load of /s/demo/no and of /s/demo/no/products makes 0 requests to /api/shop/tiles (1 each today, by measure-routes.mjs), held by the new assertion in e2e/shop-components.spec.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/shop-tiles.test.ts (tileAsk and tileShows; add tileAskFor).
- e2e/shop-components.spec.ts:30-71 (the first test, a grid that shows them, must pass unchanged; the second relies on the per-request read and changes as step 5 says).
- Rule docs/rules/admin/website.md:728 (D557): stock is never drawn on the server or cached. Kept: only the two switches join the catalogue's cache, whose tag the save refreshes.
- CLAUDE.md, Conventions: a writer refreshes the tag itself. Step 1 does.

**Notes:** Same finding and the same fix as SC-12 (storefront-client); one change. It is two days old, so nothing else depends on the per-request read yet.
