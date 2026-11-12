# PL-7 ✓ Every page of every store asks the server for a wishlist almost no visitor has

What a page sends: document, payload and requests (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.15.
- **Second check:** confirmed.
- **Where:** `src/components/wishlist-heart.tsx:21`, `src/components/wishlist-heart.tsx:38`, `src/components/wishlist-heart.tsx:113`, `src/components/store-layout.tsx:283`, `src/components/site-parts.tsx:172`, `src/app/s/[store]/[market]/wishlist/saved/route.ts:9`, `src/server/wishlists.ts:36`, `src/server/wishlists.ts:44`, `src/server/wishlists.ts:64`, `src/server/customers.ts:416`, `src/lib/cookie-consent.ts:467`
- **Evidence:** WishlistCount in the header and every heart call load(), which fetches {market}/wishlist/saved once per document (wishlist-heart.tsx:21-30, 38). The header's wishlist link is always drawn. In routes.json the call fired on all 12 storefront pages, the empty cart and checkout included: a 15-byte answer, private, no-store (asked again from the local server in this pass: 200, cache-control private, no-store). The route resolves the shop, then reads the customer and wishlist cookies; a visitor with neither gets an empty list without a query (wishlists.ts:36-41, 64-66). Both cookies are httpOnly (wishlists.ts:44-50, customers.ts:416-422), so the page cannot know there is nothing to ask for.
- **Cost today:** One uncached function call, and a pass through proxy.ts, per document load per visitor, for every store. No database query for a visitor without cookies. It grows one for one with page views. Paid by: The server per request; a shopper's browser (one more request).
- **Saving:** One function call per storefront document load for every visitor who has never saved a product and is not signed in: nearly all of them.
- **Risk:** Low. A shopper whose marker was cleared while the httpOnly cookies stayed sees empty hearts until they save again or sign in; the wishlist page itself reads on the server and is right. Team browsers that hold a wishlist cookie from before the change have no marker: before opening that is nobody else.

## The fix

1. src/server/wishlists.ts:44: where the wishlist cookie is first set, also set a marker the page can read: kaizen_mine_{storeId} with the value 1, not httpOnly, sameSite lax, secure in production, path /, the same 365 days. Leave it when the wishlist cookie is deleted (line 455): a stale marker only costs the old request.
2. src/server/customers.ts:416 (startSession): set the same marker, so a signed-in customer's saved products are asked for on any device they sign in on.
3. src/components/wishlist-heart.tsx:21-30: in load(), before the fetch, test document.cookie for a cookie whose name starts with kaizen_mine_ and whose value is 1. Without one, call setSaved([]) and return: no request. (Any store's marker counts; on a host shared by several stores that only costs the old request.) The press itself needs no change: toggleWishlistAction's answer already carries the saved products (line 80-81).
4. src/lib/cookie-consent.ts, beside wishlist_... (line 467): declare the cookie in KNOWN_COOKIES: name 'kaizen_mine_...', pattern /^kaizen_mine_[0-9a-f-]{36}$/, provider Kaizena Flow, category necessary, 365 days, on store, feature shop, and its purpose in en, nb, sv and da ('Tells the page that you have saved products or an account here, so it asks for them only then.'). Update the expected lists in src/lib/cookie-consent.test.ts:47-71.
5. e2e/wishlist.spec.ts: add that a cold load of /s/demo/no makes no request to /wishlist/saved; and that after a heart is pressed a full reload makes one and shows the heart pressed and the header's count 1.
6. Docs: the comment at wishlist-heart.tsx:7-11 and D34's rule say the saved products are fetched once per page: add 'only when the marker cookie says there may be some'. Lower PL-13's after-load fetch budget by one per storefront page.

**Done when:** A cold load of each measured storefront page makes 0 requests to /wishlist/saved (1 on each of 12 today, by measure-routes.mjs), and the two new assertions in e2e/wishlist.spec.ts pass.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/wishlist.spec.ts (the heart knows on the product page after a full load).
- src/lib/cookie-consent.test.ts:47-71 (the lists of declared cookies: the new one joins the store's necessary ones) and src/lib/cookie-scan.test.ts (the scan knows Kaizena Flow's own cookies from the same list).
- src/server/wishlists.int.test.ts and the customer sign-in integration tests (the marker is set beside the cookies).
- src/lib/visit-record.test.ts:125 and docs/store-features.md:290 list the route's address: the route stays.
- Rule D58 (docs/rules/storefront.md, Cookie consent): a necessary cookie is declared with its purpose in four languages and needs no consent. Kept by step 4.
- The comment in wishlist-heart.tsx:7-11: the pages stay the same for everyone and cached. Kept: nothing per visitor is drawn on the server.

**Notes:** Same finding as SC-10 (storefront-client), which plans the other fix: seed the saved products through the layout's per-request stream and delete the route. Do one, not both. The marker is chosen here because CA-1 (caching) wants the layout to have no per-request part at all, so that built pages are served whole from the CDN, and names this same marker as its way to ask for the cart count only when there is a cart. If CA-1 is not taken, SC-10's seed is as good and needs no new cookie.
