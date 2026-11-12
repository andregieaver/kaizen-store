# SC-7 ✓ On a wide screen a press on the cart renders the cart as a drawer, throws it away, then loads the cart page

What a shopper's browser loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 2.2.
- **Second check:** corrected.
- **Where:** `src/components/cart-drawer.tsx:10`, `src/components/cart-drawer.tsx:43`, `src/app/s/[store]/[market]/@drawer/(.)cart/page.tsx:19`, `src/app/s/[store]/[market]/@drawer/(.)cart/page.tsx:38`, `src/components/cart-link.tsx:53`, `src/components/cart-link.tsx:64`, `docs/rules/storefront.md:601`, `docs/pci.md:108`
- **Evidence:** Read in code in this pass. The header's cart link is a Link (cart-link.tsx:64), so a press is a client navigation that the (.)cart route intercepts; the server renders the drawer with CartContents (page.tsx:38-40); CartDrawer's effect then finds a screen of 768 px or more and calls window.location.reload() (cart-drawer.tsx:43-47), and the cart is fetched and rendered again as a document. The written rule says larger screens load the cart page (docs/rules/storefront.md:601-603), and docs/pci.md:108-113 wants every entry into a pay route to be a full page load, so the reload is the design; the intercepted render before it is the waste. Measured on the phone run only: every page prefetches /cart (3 RSC requests, 10,576 bytes) and fetches the drawer's chunks after load; two of them (28,536 raw, 14,343 transferred) belong to the drawer alone.
- **Cost today:** Per cart opening on a wide screen: one server render of the cart (its database reads and RSC bytes) that is discarded. Per document load on a wide screen: a 10.6 KB prefetch of a drawer that screen never shows; once per browser, about 14 KB of drawer-only chunks. Not run in a wide-screen browser; read from code. Paid by: The server per request, the database, and a shopper's browser on a computer
- **Saving:** Estimate (read from code, not run wide): one of two cart renders per wide-screen cart opening; 10,576 bytes of prefetch per wide-screen document load; about 14 KB of drawer-only chunks once per wide-screen browser.
- **Risk:** Low. Wide screens end on the same full page as today, one step sooner. A test that finds the cart link by its name sees one link, since the other is hidden. A store whose own breakpoints (D179) differ from 768 px is not affected: the drawer's own check uses the fixed 768 px too.

## The fix

1. src/components/cart-link.tsx, the header variant (lines 63-72): draw two links with the same content and name. A plain <a href> with 'hidden md:flex' in place of 'flex' (a full page load, shown from 768 px), and the Link with 'md:hidden' added (phones: the intercepted drawer). Tailwind's md is 768 px, the same as DESKTOP in cart-drawer.tsx:10. A link that is display:none never enters the viewport, so it is not prefetched, and it is not in the accessibility tree.
2. Keep cart-drawer.tsx:43-51 as it is: it is still the guard for a phone turned wide, and for the other Links to the cart (checkout-section.tsx:118 and 184, wishlist-view.tsx:304).
3. e2e/cart.spec.ts: add a wide-screen test. From a product page at 1280 px press the header's cart link; assert one document request for /cart and no request with the rsc header for /cart; and that the page made no prefetch request for /cart before the press.
4. docs/rules/storefront.md:601-603: add 'the header's cart link is a plain link from 768 px, so larger screens load the cart page at once'.

**Done when:** The new wide-screen test in e2e/cart.spec.ts passes: one document request and zero RSC requests for /cart when the header's cart link is pressed at 1280 px, and zero prefetch requests for /cart on that page.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/cart.spec.ts: the openCart helper waits for a load event on wide screens (still true); the phone drawer tests run at 390 and 360 px
- e2e/menus.spec.ts, e2e/backorder.spec.ts, e2e/unit-price.spec.ts (they open the drawer)
- e2e/target-size.spec.ts (the hidden link is not measured)
- Rule docs/rules/storefront.md:596-603 (D64) and docs/pci.md:108-113: kept; the fix does on wide screens what the rule asks, without the detour.

**Notes:** The cost is per cart opening on a computer, on the path to payment, so it grows with shoppers. If SC-8 is done by dropping the slot instead of moving it, this finding goes with it.
