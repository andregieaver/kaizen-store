# DQ-9 ✓ The store's slug is looked up by id again and again: the most-called statement in production

How data is asked for (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.16.
- **Second check:** corrected.
- **Where:** `src/server/content-grid.ts:48`, `src/server/content-grid.ts:129-141`, `src/server/content-grid.ts:150-156`, `src/components/content-grid-section.tsx:70`, `src/components/search-section.tsx:53`, `src/components/store-part-section.tsx:84`, `src/components/instagram-section.tsx:28`, `src/server/menus.ts:282-288`, `src/server/pages.ts:208-212`, `src/server/request-memo.ts:13-20`, `src/server/ai.ts:207-212`, `src/server/knowledge.ts:301-311`, `src/server/media-library.ts:866-874`
- **Evidence:** 'select slug from commerce.stores where id = $1' ran 560,090 times, more than any other statement. My rg finds it on 27 lines. Page components know the store by id (GridPlace.owner, content-grid.ts:48), though the page was reached by slug. storeAndMarket() (content-grid.ts:151-156) is not cached and not shared within a request, and has 11 callers (my rg). Three of them are parts drawn per request (the filterable grid, search and store parts, as the verified report found), so there the lookup runs on every shopper request; the others sit inside cached functions and run when the cache is cold. A cached twin exists (storeSlugOf, menus.ts:283-288, kept for days because 'addresses do not change') and so does a per-request memo (perRequest, request-memo.ts:13). The same habit for settings: aiFor() reads the provider row with select * on every call (237,563 calls in four shapes, mostly from five-minute jobs that ask once per site: knowledge.ts:306, media-library.ts:870), and the one-row platform_settings is read by 43 statements in 29 files.
- **Cost today:** At least 7,180 round trips a day today for a value that does not change. Each is a primary-key read, tiny in database time, but a round trip a page part waits for. After opening the per-request share grows with shopper traffic. Paid by: The server and the database on every render of a store page's dynamic parts; each a round trip the part waits for.
- **Saving:** Estimate: nearly all 560,090 calls, and most of the 237,563 provider reads inside one job run.
- **Risk:** Low. A store's slug does not change (menus.ts:282 says so); if that ever changes, the cached read needs the store's tag. A wrong slug handed down in GridPlace would show as an empty grid or search on a store page, which the e2e spec opens.

## The fix

1. 1 (S, first). Move storeSlugOf() from src/server/menus.ts:282-288 to src/server/stores.ts (it needs only readDb; menus.ts re-exports it) so nothing imports in a circle. In src/server/content-grid.ts make storeAndMarket() (151-156) and customWhere() (133) call storeSlugOf(storeId) instead of their own select; customWhere keeps its cacheTag(storeTag(slug)).
2. Replace the other exact copies with storeSlugOf(): run rg -n 'select slug from commerce.stores where id' src (27 lines; pages.ts:210, content-site.ts:46, field-tiles.ts:174-177, product-data.ts:27-30 among them). Leave a copy only where the read is inside a transaction that must see its own write, with a comment.
3. Carry the slug so nothing is looked up: add storeSlug to GridPlace (content-grid.ts:48) and fill it where a page hands its place to its components (the page already holds the store from resolveShop()). Then content-grid-section.tsx:70, search-section.tsx:53, store-part-section.tsx:84 and instagram-section.tsx:28 call getOpenStore(place.storeSlug) and marketIn() directly; storeAndMarket() stays for callers that truly have only an id.
4. The AI provider row: read the enabled providers once per job run and hand them down. Add enabledProviders() next to aiFor() in src/server/ai.ts (one statement, the columns named instead of select *) and an optional providers argument on aiFor(); the per-site loops at knowledge.ts:301-311, media-library.ts:866-874 and in alt-texts.ts read it once before the loop. Within a request wrap the provider read in perRequest().
5. Leave the 43 reads of platform_settings to DQ-7 (the frame) and to each screen's own next change.

**Done when:** rg -c 'select slug from commerce.stores where id' over src (tests left out) gives at most 3 lines (27 today), and on production a week after the deploy the calls of that statement in pg_stat_statements grow by fewer than 500 a day (at least 7,180 a day today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/place-lang.test.ts names storeAndMarket and storeSlugOf; the content grid's int tests (src/server/content-grid-custom.int.test.ts and its siblings) and src/server/listing.int.test.ts draw grids through GridPlace.
- src/server/ai.int.test.ts, src/server/chat.int.test.ts and src/server/media-library.int.test.ts for the provider read handed down.
- e2e/store-pages.spec.ts: a store page with a filterable grid, search and a store part.
- No written rule holds the lookup; menus.ts:282 states that a store's address does not change, which is what makes the cached read safe.

**Notes:** Steps 1 and 2 are an hour's work and remove most of the calls; step 3 removes the wait for the per-request parts. The storefront-data dimension describes the same lookup; do it once.
