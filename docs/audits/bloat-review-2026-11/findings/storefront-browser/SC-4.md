# SC-4 ✓ The product page loads the cart's forms, and every product kind's picker

What a shopper's browser loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.16.
- **Second check:** corrected.
- **Where:** `src/components/shop-notes.tsx:1`, `src/app/s/[store]/[market]/cart/cart-contents.tsx:64`, `src/app/s/[store]/[market]/cart/cart-contents.tsx:67`, `src/app/s/[store]/[market]/cart/cart-contents.tsx:71`, `src/components/product-parts.tsx:1`, `src/components/product-parts.tsx:7`, `src/components/product-parts.tsx:11`, `src/components/product-parts.tsx:20`, `src/components/product-parts.tsx:79`, `src/components/lazy/shop.tsx:8`, `docs/performance.md:38`
- **Evidence:** Import chain read in this pass: product page, product-parts.tsx:1, shop-notes.tsx:1, cart-contents.tsx (for the server function cartView), and with that file its client imports: checkout-button, cart-gift, discount-code-form, gift-card-form, cart-quantity. cartView() and loadCartView() (cart-contents.tsx:67-200) import only lib and server modules and ./bonus (server-only); they hold no component. shop-notes.tsx was added on 10 November 2026 (commit df657d9), five days after D461 had taken these parts off the product page; no budget failed. Sizes in the product page's chunks (the skeptic's split; the larger ones re-read in the review's working files (not kept)): checkout-button 10,040, cart-gift 3,754, discount-code-form 1,979, gift-card-form 1,956, cart-quantity 1,147 = 18,876 raw. product-parts also imports the pickers statically: range-picker 8,322, quote-request 7,113, appointment-picker 5,879, gift-card-buy 4,109 = 25,423 raw. A product draws at most one of them.
- **Cost today:** 18,876 raw / about 4.5 KB gzip of cart forms on every product page of every store. A further 25,423 raw / about 7.4 KB gzip of pickers on products that are not stays, appointments, gift cards or price on request. The product page's first scripts are 777,785 raw / 245,716 gzip. Paid by: A shopper's browser on the first product page
- **Saving:** Measured: 18,876 raw / about 4.5 KB gzip on every product page from step 1. Conditional on step 5 passing its tests: 25,423 raw / about 7.4 KB gzip more on plain products.
- **Risk:** Low for steps 1 to 4: a file move; a wrong import fails the type check, and the cart and shop-components specs run the same reads. Medium for step 5: it meets the reason behind the written rule (a press before a part's own script runs is lost); the named specs decide.

## The fix

1. New server file src/app/s/[store]/[market]/cart/cart-view.ts starting with import 'server-only'. Move cartView(), loadCartView(), cartQuote() and the types CartView and Filled (cart-contents.tsx:64-209) there with the imports they use. cart-contents.tsx imports cartView and the two types from ./cart-view. The perRequest key ('cart:{storeId}:{market}') stays the same, so the cart's pieces and the notes still share one read.
2. src/components/shop-notes.tsx line 1: import cartView from '@/app/s/[store]/[market]/cart/cart-view'.
3. Hold it: in src/lib/storefront-bundle.scan.test.ts (or beside src/lib/pay-routes.graph.test.ts) add a walk of src/components/product-parts.tsx's static imports that fails if it reaches cart/cart-contents.tsx, components/checkout-button.tsx or cart/cart-gift.tsx.
4. Lower the product page's budget (e2e/performance.spec.ts:41) to the new measure plus 3 % (SC-6).
5. Apart, and only if its tests pass: add lazyView stand-ins for RangePicker, AppointmentPicker, GiftCardBuy and QuoteRequest to src/components/lazy/shop.tsx and import them from there in product-parts.tsx (lines 7, 11, 20, 79). The server still asks for the script with a page that draws one. Run e2e/bookings.spec.ts, the gift card and quote specs and e2e/gallery.spec.ts five times each on Chromium and WebKit. If one press is lost, back this step out and write the result into docs/performance.md:38-51 so it is not tried again.

**Done when:** The product page's first scripts (script tags of the server's HTML for /s/demo/no/p/demo-keramikkopp, nomodule left out) are at most 760,000 bytes raw (777,785 today), and the new import walk of product-parts.tsx passes.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/shop-components.spec.ts (D558: the notes on product, cart and category pages)
- src/lib/shop-notes.test.ts, src/lib/store-parts.test.ts
- src/lib/pay-routes.graph.test.ts (walks cart-contents as a pay route's piece; cart-view.ts joins the walk)
- e2e/cart.spec.ts; e2e/performance.spec.ts:41 (the product page's budget)
- Rule docs/performance.md:38-51 for step 5: what a shopper came to press at once stays in the first scripts. Step 1 does not touch the rule.
- Rule docs/rules/admin/website.md, Basket notes (D558): the notes read cartView(), shared with the cart's pieces. Unchanged.

**Notes:** Step 1 is a prerequisite of SC-2: the category and tag pages draw the basket notes. Step 5 is P2 on its own.
