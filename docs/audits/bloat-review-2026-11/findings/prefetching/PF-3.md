# PF-3 ✓ The header tools, bottom bar and footer are prefetched on every full page load, with the script chunks of pages nobody asked for

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Second check:** corrected.
- **Where:** `src/components/store-layout.tsx:128,267,273,281,400,406,443,498,511,564,577`, `src/components/site-parts.tsx:156,163,170,224`, `src/components/platform-layout.tsx:79,223,230,264`, `src/components/cart-link.tsx:53,64`, `src/components/menu-view.tsx:77-105`, `src/components/menu-section.tsx:39,56`, `src/proxy.ts:54-60`, `node_modules/next/dist/docs/01-app/02-guides/prefetching.md:121-156,208-224`, `node_modules/next/dist/client/components/links.js:134-165,236-249`
- **Evidence:** Each link costs a route-tree request plus one per segment not yet held. Planner's runs on the demo store: a phone at the top of the home page, 11 router requests for 4 links (search 3, wishlist 3, cart 3, account 2); at the top of a product page, 12 (40.3 KB on the wire: the home page behind the logo and the bottom bar is the largest, 3 requests and 29.6 KB decoded); at 1440x900, 17 for 7 links. Read to the footer on a phone: cookies 2, withdraw 2, the footer menu's four links 8. The skeptic's addition stands: the answers name script chunks the router then loads (3 chunks, 24 KB on the wire at the top; 10 chunks, 87 KB read to the footer), and 10 of 18 routes answered STALE, each a background render. Every full load starts again from nothing. Next's own guide gives the pattern for links that should wait for intent (prefetching.md:121-156): prefetch={active ? null : false}, switched on by the pointer. A link with prefetch={false} is not prefetched on hover either (links.js:134-165, 236-249), which is why the wrapper must flip the prop. The 'checkout, 50 requests' of the first report was a checkout that bounces to the cart; no pay step was measured.
- **Cost today:** Per full page load on a phone: 11 to 12 router requests and 3 script chunks at the top (about 55 KB on the wire here); 23 router requests with the footer (other views left to PF-2). One proxy run each; on a quiet store a render per route when cold and one per hour or quarter hour when stale. Paid by: The shopper's browser; the proxy and the server per request. It grows with page views across all stores, whatever features they use.
- **Saving:** By subtraction from measured counts: phone home 11 to 3 router requests and 3 to 2 script chunks at the top; with PF-2, 47 to 3 router requests and 10 to 2 chunks read to the footer; product page 12 to 3 at the top. At desktop width the top goes from 17 to 8 while the three menu links keep viewport prefetch (5 with PF-7).
- **Risk:** Low to medium. A tap gives about 100 ms of warning, so a press on search, account or wishlist may wait for one cached answer where today the page is already held: noticed as a slower first paint of those pages on a phone, not as a failure. Moving the main menu's top links to intent as well is a speed trade to decide with a measurement, not waste, so they stay on view. A wrapper that dropped a prop (scroll, replace, aria-current, hrefLang) would show in the menu, language and navigation specs.

## The fix

1. Create src/components/policy-link.tsx ('use client'): PolicyLink takes next/link's props without prefetch, plus policy: 'view' | 'intent' | 'none'. It renders <Link prefetch={policy === 'view' || (policy === 'intent' && asked) ? null : false}> and sets asked on pointer enter, touch start and focus (calling any handler of the same name it was given). It imports only next/link and react. Children pass through, so server components keep drawing icons and counts inside it.
2. src/components/store-layout.tsx: use PolicyLink with policy intent for the logo (128), search, account and wishlist (267, 273, 281), the phone menu's account and cart (400, 406), the withdrawal link (443), cookies (498), the legal pages (511) and the bottom bar's home and account (564, 577).
3. src/components/site-parts.tsx: intent for a built header's or footer's search, account, wishlist and cookies parts (156, 163, 170, 224). src/components/platform-layout.tsx: intent for Kaizena Flow's logo, footer links and menu home link (79, 223, 230, 264); its sign-up links (138, 171) get policy view, written down as the site's main action.
4. src/components/menu-view.tsx: give anchor() a policy and MenuTreeView a prop for its top links. Top links of a row menu: view. Every link of a column menu (footers) and of the phone's drawer menu: intent. Sub-links: see PF-8. src/components/menu-section.tsx:39,56 (a built header's or footer's Menu part) passes view in a header and intent in a footer.
5. src/components/cart-link.tsx:53 (the phone's bottom bar): policy view, written down. The header's cart link (64) is PF-7.
6. src/lib/pay-routes.graph.test.ts:184-193: widen the scan from <Link to <(Link|PolicyLink) (and any later wrapper name), so a wrapper can never client-navigate to /checkout unseen.
7. e2e/prefetch.spec.ts: add budgets as measured counts with a little room: phone home read to the footer at most 6 router prefetch requests (47 today, 23 after PF-2); phone product page at the top at most 6 (12 today); home at 1280x720 at the top at most 12 (17 at 1440x900 today). Add 'a footer link waits to be pointed at': no request for /s/demo/no/cookies after scrolling to the footer; at least one after hovering it; pressing it changes the address with no document request.
8. docs/performance.md: a short section 'What the router fetches ahead' with the policy per link group (the table in PF-10).

**Done when:** e2e/prefetch.spec.ts budgets pass: at most 6 router prefetch requests on the phone home page read to the footer (47 today) and at most 6 at the top of the phone product page (12 today).

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/store-pages.spec.ts:57-84 (D423) presses the search link with its prefetches aborted: passes unchanged (the skeptic checked the logic; run it in WebKit too).
- The WebKit project's specs press these links (playwright.config.ts:21: store-pages, search, cookies, withdrawal, cart, account, products-page) and so do e2e/menus.spec.ts, e2e/navigation.spec.ts and e2e/legal-pages.spec.ts: run them all.
- src/components/menu-view.test.ts reads menu-view.tsx for the Suspense around MenuGlide: unaffected. Add to it a case with policy-link mocked to print its policy: a row menu's top links print view, a column's and a drawer's print intent.
- src/lib/storefront-bundle.scan.test.ts walks every client component a visitor can load: policy-link.tsx imports nothing forbidden.
- e2e/performance.spec.ts: the first-scripts budgets gain one small component; the speed budgets (SPEED_BUDGETS, bytes until 2 s after load) fall by about 30 KB of router answers and one chunk. Do not raise a budget for this change.
- D153 (the withdrawal link always reachable) and D58 (the cookies link): the links stay links with the same href; only the fetch ahead waits.

**Comes after:** PF-1

**Notes:** This finding creates the shared wrapper that PF-4, PF-5, PF-6, PF-8, PF-10 and PF-13 use. Do PF-2 first: it is five one-word edits and takes 24 of the 47.
