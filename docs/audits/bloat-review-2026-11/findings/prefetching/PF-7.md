# PF-7 ✓ On wide screens the cart link prefetches a drawer and its scripts that are never shown, and a press renders the drawer before reloading the page

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.2.
- **Second check:** corrected.
- **Where:** `src/components/cart-link.tsx:51-72`, `src/components/cart-drawer.tsx:10,43-50`, `src/app/s/[store]/[market]/@drawer/(.)cart/page.tsx:19-43`, `docs/decisions.md:75`, `docs/pci.md:108-113`, `src/components/pay-route-guard.tsx:57-65`
- **Evidence:** The cart link's prefetch is 3 requests at any width (planner's run at 1440x900: the route tree 686 B, the children slot's default 845 B, the drawer page 5.9 KB decoded), and per the skeptic the drawer page names 2 script chunks that are then loaded (14.3 KB on the wire). From 768 px the drawer reloads the address as soon as it mounts (cart-drawer.tsx:44-47; D64 says so). The skeptic's press at 1440 px: one router navigation (the server renders the drawer), then a document load of the cart page (17.4 KB), then the page's prefetches again. Entering a pay route is meant to be a full page load (docs/pci.md:108-113), so at this width the plain navigation is also the rule.
- **Cost today:** Per full page view at 768 px or wider: 3 router requests (7.2 KB decoded) and 2 script chunks (14.3 KB on the wire), never used. Per cart open there: one server render of the drawer thrown away, then the full cart page. Paid by: Desktop and tablet shoppers' browsers; the proxy per request; the server per cart open.
- **Saving:** Measured by the skeptic: 5 requests per full page view at desktop width (3 router, 2 scripts; about 25 KB on the wire here) and one drawer render per cart open.
- **Risk:** Low. A tablet turned from portrait to landscape swaps the element once; the cart count badge is a child and survives. D64's behaviour on phones is untouched. A regression would show in cart.spec.ts at either width.

## The fix

1. Create src/components/cart-anchor.tsx ('use client'): CartAnchor({ href, className, children }) keeps phone = false until mounted, then follows matchMedia('(min-width: 768px)') (move the DESKTOP constant of cart-drawer.tsx:10 to a shared place and use it in both). While phone is false it renders a plain <a href>; while true it renders <PolicyLink policy='view'> (or next/link with the default). The first HTML is the same anchor either way, so nothing mismatches.
2. src/components/cart-link.tsx:63-71 (the header variant of CartLinkShell): draw the link with CartAnchor. The bottom bar's variant (53) is phones only and stays a view link.
3. e2e/prefetch.spec.ts: add 'the cart on a wide screen is a plain page': at 1280x720 /s/demo/no makes no router prefetch request for /s/demo/no/cart (3 today); pressing the header's cart link makes one document request for the cart and no router navigation request before it (1 navigation, then 1 document today).
4. docs/decisions.md D64: add a sentence that from 768 px the cart link is a plain navigation and is not fetched ahead; phones are unchanged.

**Done when:** e2e/prefetch.spec.ts 'the cart on a wide screen is a plain page' passes: 0 router prefetch requests for the cart at 1280x720 (3 today) and one document request, no router navigation, on the press.

**Tests and rules that hold today's behaviour, and change with it:**

- D64 (docs/decisions.md:75): the drawer on phones, the page from 768 px. Kept; the reload in cart-drawer.tsx:44-47 stays for a window widened while the drawer is open.
- docs/pci.md:108-113: entry into a pay route is a full page load. The fix makes the wide-screen entry a plain one, as the rule asks.
- e2e/cart.spec.ts covers both widths (phones at 390 and 360 px, lines 64 and 97; the default 1280 px elsewhere); e2e/a11y.spec.ts, e2e/csp.spec.ts and e2e/shop-components.spec.ts open the cart too.
- src/lib/pay-routes.graph.test.ts: the cart link is not a link to /checkout; unaffected.

**Comes after:** PF-1

**Notes:** The other <Link>s to the cart (the phone menu's at store-layout.tsx:406, the wishlist's, the checkout's back link) are rarely in view at desktop width and are left; PF-3 moves the phone menu's to intent.
