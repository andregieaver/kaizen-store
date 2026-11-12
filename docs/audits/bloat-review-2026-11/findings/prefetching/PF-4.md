# PF-4 ✓ The links shoppers press most on built pages are full page loads: a whole document and every prefetch made again where one small answer would do

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 2.7.
- **Second check:** corrected.
- **Where:** `src/components/content-grid.tsx:147,226-236,304,310`, `src/components/icon-list-view.tsx:48`, `src/components/page-parts.tsx:448-458`, `src/components/page-block.tsx:180,246,302,366`, `src/components/rich-text.tsx:83-90`, `src/components/product-card.tsx:68-77`, `src/lib/pay-routes.ts:46-49`, `docs/pci.md:108-113`, `src/lib/pay-routes.graph.test.ts:184-193`
- **Evidence:** The page builder's blocks link with plain anchors: the content grid's tile title, picture and button (content-grid.tsx:147, 226-236, 304, 310), icon lists (icon-list-view.tsx:48), the link over a column (page-parts.tsx:448-458) and, opened by the planner, the button, dual button, picture and video blocks too (page-block.tsx:180, 246, 302, 366). The demo's home page and its /products page are built pages: the planner's fetch of /s/demo/no/products shows its nine tiles as plain <a> and the router asked for none of them. The skeptic's measure on a phone: a tap on a home page tile is a document load of 42 requests and 104.5 KB on the wire (document 24.0 KB, 12 prefetches made again 40.3 KB, scripts 33.5 KB); a <Link> press to a product page from the same page is 5 requests and 12.9 KB. Soft navigation away from a built page is not new: menus are <Link>s and rich text already draws internal addresses with <Link> (rich-text.tsx:83-86). No rule or decision says why the blocks differ. One rule binds the fix: every entry into a pay route is a full page load (docs/pci.md:108-113), and the scan that holds it only sees a literal <Link> to /checkout (pay-routes.graph.test.ts:184-193), not an address an owner typed into a block.
- **Cost today:** Per press on a built page's tile or button: a whole document, every script evaluated again and 12 prefetches repeated. What the page fetched ahead before the press is lost. Paid by: The shopper's browser on every step from a built page; the server renders a document where a 5 KB segment would do. It grows with shoppers; built pages are the home page of most stores.
- **Saving:** Estimate from the two measured presses, as the skeptic cut it: about 37 fewer requests and about 60 KB less on the wire per press (104.5 KB against 12.9 KB plus the product page's 33.5 KB of scripts, which are needed once either way).
- **Risk:** Medium. Per-page CSS, owner code and the motion runtime after a soft navigation are already exercised by menu and rich-text links, but not from every block; a page that looks wrong after such a press would show in the motion, custom CSS and consent specs. An owner-typed address that is a file or a handler must stay a plain anchor: the unit test holds the list. PayRouteGuard reloads a pay page reached by a client link, so a missed pay address costs a double load, not a policy breach.

## The fix

1. Create src/components/block-link.tsx: BlockLink({ href, external, newTab, plain, ...rest }) returns <PolicyLink policy='intent'> (PF-3) only when the address is a page of the app: it starts with one '/', is not a pay path (isPayPath() of src/lib/pay-routes.ts), has no file extension in its last part, and is not under /api/, /admin, /auth/, /oauth/ or /r/. Otherwise, and when external, newTab or plain is set, it returns the plain <a> of today with the same attributes.
2. Use BlockLink in src/components/content-grid.tsx (147, 226, 304, 310; the title and picture of a tile share one href, so one fetch on intent), src/components/icon-list-view.tsx:48, src/components/page-parts.tsx:452 (ColumnLinkCover) and src/components/page-block.tsx (180 video, 246 picture, 302 button, 366 dual button; keep data-block-id and data-hover on the anchor).
3. Where the admin's builder canvas draws these blocks (PageBlockView's preview prop at page-block.tsx:62-71, and the editor's own preview of a content grid) pass plain, so nothing in the canvas navigates or fetches.
4. Add src/components/block-link.test.ts: with policy-link mocked, /s/demo/no/p/x and /om-oss give the wrapper; /s/demo/no/cart, /cart, /no/checkout, /s/demo/no/order/1, https://example.com, #contact, mailto:, /downloads/a.pdf, /api/x and an item with newTab give a plain anchor.
5. src/lib/pay-routes.graph.test.ts:184-193: widen the scan to the wrapper names (with PF-3) and add that block-link.tsx calls isPayPath.
6. e2e/prefetch.spec.ts: add 'a press on a built page's tile stays in the app': on a phone, tap a product tile of /s/demo/no; expect no document request and at most 8 requests in the 3.5 s after (1 document and 42 requests today).
7. docs/pci.md, 'Every entry into a pay route is a full page load': add that a builder block never client-navigates to a cart, checkout or order address (BlockLink), and that PayRouteGuard still reloads one reached another way.

**Done when:** e2e/prefetch.spec.ts 'a press on a built page's tile stays in the app' passes: 0 document requests and at most 8 requests after the tap (1 document and 42 requests today, the skeptic's click.mjs).

**Tests and rules that hold today's behaviour, and change with it:**

- docs/pci.md:108-113 and src/lib/pay-routes.graph.test.ts hold the pay-route rule: kept by the isPayPath branch and the widened scan; e2e/csp.spec.ts and e2e/cart.spec.ts show a pay page reached from a block is still a fresh document.
- A/B click goals count a button by data-block-id through a document click listener (src/components/ab/ab-marker.tsx:61-62): run e2e/ab-form-goal.spec.ts and e2e/ab-tests.spec.ts, since the page no longer unloads on the press.
- These presses have always started a fresh document: run e2e/components.spec.ts, e2e/custom-grid.spec.ts, e2e/products-page.spec.ts, e2e/store-pages.spec.ts, e2e/motion.spec.ts, e2e/modals.spec.ts, e2e/cookies.spec.ts and e2e/custom-css.spec.ts.
- src/components/icon-list-view.test.ts renders IconListView to a string: its items have no href and pass unchanged.
- src/lib/storefront-bundle.scan.test.ts: block-link.tsx may import lib/pay-routes (pure, no zod) and nothing from lib/page-content.

**Comes after:** PF-1; PF-3

**Notes:** Before opening is the cheap time to change how built pages navigate. The skeptic changed the kind from duplicate to oversize and cut the saving from 105 KB to about 60 KB; both kept.
