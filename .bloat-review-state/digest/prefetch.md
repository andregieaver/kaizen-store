# prefetch: Prefetching: what the router asks for unasked

Next's default (fetch every link in view) decides for all but 4 of 947 links, and no test or budget watches it. Re-measured here: a phone shopper who reads the demo store's home page to the footer makes 47 router requests (729 KB decoded) for pages not asked for, 24 of them for the home pages of eight other language, currency and country views; the admin home makes 28; and a multi-country store's front door makes 12 (254 KB) for links whose press loads a whole document anyway. The endless prefetch loop is real but local and CI only (624 router requests in 4 s on the search results page as built, 55 with route guessing off), and one config line stops it. The plan is three changes of a few lines first (the loop, the other views, the links that leave their root layout), then one small link wrapper that states a policy per link group, held by a request budget; none of it argues from an unused feature, and all of it is cheapest before opening.

## Measures
- Links that set a prefetch policy: 4 call sites of 947 <Link uses in 400 files (3 Link, 1 ButtonLink of 107 ButtonLink uses); none pass prefetch={true}; no router.prefetch(), no next/form, no staleTimes. By area: 335 admin files, 64 storefront and platform files, 1 global.
- The loop's cause, proven by switching it off: Router requests in 4 s on /s/demo/no/search?q=lampe at 1440x900: 624 as built, 55 with route guessing off, 47 with a two-line bail-out (the skeptic's phone runs: 495, 23, 21)
- The loop on a category page: /s/demo/no/category/hjem at 1440x900: 2,040 router requests in 5 s, 1,994 of them one address and one segment (@drawer/.../$c$rest/__PAGE__); 47 distinct requests for 20 links
- The loop's rate, one open tab: About 165 requests a second reach the server (1,335 of 2,643 request events in 8 s went on the network; the rest are answered by the browser's HTTP cache)
- Pages that loop at CI's screen size: 9 of 11 demo-store pages never go idle at 1280x720 (product, category, search results, empty cart, checkout that bounces to the cart, om-oss, the blog index, account, wishlist)
- What one looping page costs: Server 4.7 s of CPU per 9 s against 0.16 s quiet; browser 2.79 s of main-thread time per 8 s against 0.08 s; heap 3 to 13 MB
- CI exposure: 25 e2e spec files open /s/demo addresses in 101 goto calls (the skeptic counted 99), at Desktop Chrome 1280x720. The signed-in job also runs without the store domain: 12 of its spec files open /s/ addresses in 20 goto calls (exposed where the store has a coun…
- Store home on a phone, top of the page: 11 router requests for 4 links (search 3, wishlist 3, cart 3, account 2), 19.8 KB decoded, 31 KB on the wire; plus 3 script chunks (24 KB on the wire) those answers name
- Store home on a phone, read to the footer: 47 router requests for 18 links, 729.3 KB decoded, 204.0 KB on the wire; plus 10 script chunks, 87 KB on the wire
- Share taken by the other views: 8 links (3 languages, 3 currencies, 2 countries): 24 of the 47 requests, 662.0 of 729.3 KB decoded, 135.4 of 204.0 KB on the wire. The demo's built /products page: the same 24 of 48.
- Store home at 1440x900, top of the page: 17 router requests for 7 links: 3 product links of the header menu 8, search, account and wishlist 6, cart 3
- One product link: 2 requests: the route tree (1,035 B decoded, 2.4 KB on the wire) and the product page's shell (10.1 to 10.5 KB decoded, 5.1 KB on the wire)
- Product page on a phone: 12 router requests at the top (40.3 KB on the wire); 48 distinct for 19 links read to the end
- The first add to cart of a visit: 32 more router prefetch request events, 20 of them on the network (28.9 KB), after a load that made 12; the action's answer carried x-action-revalidated: 1. The second add carried 2 and asked for nothing.
- A multi-country store's front door: /s/demo: 12 router requests for its 3 country links, 254 KB decoded, 58.6 KB on the wire. Pressing one loaded a document (21,354 B) and 56 more requests: nothing fetched ahead was used.
- Kaizena Flow's own home page: 8 router requests for 4 links; 4 of them for /admin and the demo store, whose press loads a document (pressing /admin: 1 document of 6,256 B and 38 requests; pressing /sign-up, same root layout: 4 requests)
- Admin home: 28 router requests for 13 links, 171 KB decoded, 98 KB on the wire: 24 for the 12 store-admin links (8.9 to 11.5 KB a link), 2 for /admin, 4 for the View store link (62 KB decoded; local only)
- What one router.refresh() asks for again: 25 prefetch requests and 1 navigation on the admin product list (78 and 116 KB on the wire in two runs); 23 on the store home at desktop width
- A press on a product tile of a built page: A full page load: 42 requests, 104.5 KB on the wire. A <Link> press to a product page from the same page: 5 requests, 12.9 KB.
- A cold prefetch on the server: 75 and 78 ms for the first tree prefetch of a route not yet rendered, 6 to 12 ms after; store routes have no shared fallback shell and only the template store is built ahead
- Listings in the test data: The demo and test stores have 10 products each; a listing page holds up to 48 (LISTING_LIMIT). No measurement of this review saw a real listing.

## Well made
- Storefront prefetch answers are cacheable once rendered (s-maxage 900 s for a home page, 3,600 s otherwise, with stale-while-revalidate), and no link asks for a full dynamic prefetch. They are not static from the start: a store's first ask of each route and v…
- The admin's prefetch answers are prerendered shells without any store's or person's data, and admin paths are outside the proxy's matcher (src/proxy.ts:54-60).
- The language switcher of built headers and footers (src/components/language-links.tsx) uses plain anchors and router.push on press: no prefetch.
- Search results' tracked product links are plain anchors with nofollow, so a prefetch can never record a click (src/components/product-card.tsx:69-72); export, CSV and print links pass prefetch={false}.
- No <Link> points at a route handler: a scan of Link and ButtonLink hrefs for export, csv, pdf, xml, label, feed, download and the like found only pages (the planner's rg); the files themselves are reached by plain anchors or prefetch={false}.
- Filter chips and Show more on a listing cost no request: on /s/demo/no/category/hjem?stock=1&min=100&kind=physical the chip links (?min=100, ?stock=1) are in the HTML and the router asked for neither (the planner's run). The same route with other search param…
- Links inside a closed <details>, a hidden part or display:none do not count as in view, so the header's closed country, language and currency menus and the phone's slide-out menu prefetch nothing until opened.
- Prefetched answers live five minutes in the browser's router cache: 70 of 85 cacheLife() calls are the 'hours' profile and nothing sets staleTimes, so soft navigation within a visit does not ask again. Every full page load starts from nothing, which is why PF…
- The cart link on a phone is prefetching well spent: the tap is one navigation request of 4,859 B and the drawer opens from the prefetched shell.
- The @drawer slot follows Next's documented pattern for closing a modal (parallel-routes.md:468-486) and D64 explains it. The loop is the framework's fault, not the route's.
- The proxy has to see prefetch requests (it rewrites short addresses and holds the private-store gate, src/proxy.ts:96-151) and reads a store's facts at most every few seconds, never per request. The remedy is fewer prefetches, not skipping the proxy.
- Production's store hosts are spared the loop by construction: every /s/ address redirects to the store's host (src/lib/store-hosts.ts:89-104), and route guessing refuses an address that does not spell its route.
- The admin's service worker precaches only its offline shell (src/lib/admin-sw.ts:19), and the only resource hint in the app is the font preload (src/components/font-preloads.tsx:25).
- No finding in this dimension argues from an unused feature or an empty table. These are costs per page view, per press and per save: they grow with shoppers, owners and stores.

## Findings (13)

### PF-1 [P0 S eager corrected] Next's route guessing and the cart drawer's catch-all slot make an endless prefetch on the local build and in CI: about 165 requests a second reach the server per open page
- evidence: Cause, as the skeptic proved and re-run here. Next 16.4.3 guesses a link's route tree from a route of the same shape it already learned (experimental.optimisticRouting, on by default at config-shared.js:212; cache.js:344 reads the flag that define-env.js:206 sets). The guess fills params from the address along the main branch only, so the rest param of the @drawer/[...rest] slot is never filled, and the code keeps t…
- cost: Per looping page (the skeptic's measures): 4.7 s of server CPU per 9 s (0.16 s when quiet), 2.8 s of browser main-thread time per 8 s (0.08 s when quiet), a heap that grows from 3 to 13 MB in 8 s. waitForLoadState('netw… (CI's e2e job: 25 spec files open /s/demo addresses in 101 goto calls at 1280x72…)
- fix: 6 steps; first: next.config.ts:79-88: add optimisticRouting: false to the experimental block, with a comment that says why (the @drawer/[...rest] slot and the TODO at next/dist/client/components/segment-cache/optimistic-routes.js:590-594) and when it may go. The NextConfig t…
- done when: e2e/prefetch.spec.ts 'a store page goes quiet' passes in CI's e2e job on the three pages: fewer than 60 router prefetch requests in the 3 s after load and none in the next 2 s (today the search results page makes 624 in 4 s at 1440x900 and never stops).
- saving: Measured: 624 to 55 router requests in 4 s on the search results page at 1440x900 (the skeptic: 495 to 23 on a phone); per the skeptic, server CPU for an open store page from 4.7 s to 0.16 s per 9 s. 101 goto calls in 25 e2e spec files run on a page that goes…
- after: nothing
- tracked: no (not in the code review's Progress table, the PSI follow-ups, docs/performance.md or the rules)
- notes: The alternative that keeps guessing is two lines in patches/next.patch, in both the dist/client and dist/esm copies of optimistic-routes.js (the existing patch carries both copies of its file). It measured 47 requests against 55: not worth a second patch to c…

### PF-2 [P0 S eager corrected] Every page of a store with several languages, currencies or countries prefetches the home page of each other view, and for languages and currencies the press does not open it
- evidence: The standard footer lists the view choices as <Link>s to each view's front page (LocaleChoice as a list at store-layout.tsx:531, countries at 537; a built header's or footer's Countries part at site-parts.tsx:184-208). Each is prefetched when it comes into view: 3 requests a link, the other view's layout (55 KB decoded), its home page (29 KB) and the drawer slot's default (0.6 KB). Re-measured by the planner on the …
- cost: Per page view that reaches the footer: 24 requests and 662 KB decoded in the browser, 24 proxy runs, and up to 8 server renders of pages nobody opened when the cache is cold or stale. A built header that shows the Count… (The shopper's browser and data plan; the proxy and the server per request. Only…)
- fix: 4 steps; first: src/components/view-menu.tsx:56: add prefetch={false} to the <Link>. Keep the href (the no-script fallback) and the onClick handler.
- done when: e2e/prefetch.spec.ts 'no other view is fetched ahead' passes: 0 router prefetch requests for another view (24 today) and at most 23 in all on the phone home page read to the footer (47 today).
- saving: Measured: 24 of 47 requests, 662 of 729 KB decoded and 135 of 204 KB on the wire on the home page read to the footer; the same on every page whose footer is seen. Up to 8 fewer cold or stale renders per visit to a quiet store.
- after: PF-1
- notes: Once PF-3's wrapper exists the two country links may move from none to intent, since their press opens what was fetched; languages and currencies stay at none because their press goes elsewhere. Depends on PF-1 only for the shared spec file and for counts tak…

### PF-3 [P1 S eager corrected] The header tools, bottom bar and footer are prefetched on every full page load, with the script chunks of pages nobody asked for
- evidence: Each link costs a route-tree request plus one per segment not yet held. Planner's runs on the demo store: a phone at the top of the home page, 11 router requests for 4 links (search 3, wishlist 3, cart 3, account 2); at the top of a product page, 12 (40.3 KB on the wire: the home page behind the logo and the bottom bar is the largest, 3 requests and 29.6 KB decoded); at 1440x900, 17 for 7 links. Read to the footer o…
- cost: Per full page load on a phone: 11 to 12 router requests and 3 script chunks at the top (about 55 KB on the wire here); 23 router requests with the footer (other views left to PF-2). One proxy run each; on a quiet store … (The shopper's browser; the proxy and the server per request. It grows with page…)
- fix: 8 steps; first: Create src/components/policy-link.tsx ('use client'): PolicyLink takes next/link's props without prefetch, plus policy: 'view' | 'intent' | 'none'. It renders <Link prefetch={policy === 'view' || (policy === 'intent' && asked) ? null : false}> and sets asked …
- done when: e2e/prefetch.spec.ts budgets pass: at most 6 router prefetch requests on the phone home page read to the footer (47 today) and at most 6 at the top of the phone product page (12 today).
- saving: By subtraction from measured counts: phone home 11 to 3 router requests and 3 to 2 script chunks at the top; with PF-2, 47 to 3 router requests and 10 to 2 chunks read to the footer; product page 12 to 3 at the top. At desktop width the top goes from 17 to 8 …
- after: PF-1
- notes: This finding creates the shared wrapper that PF-4, PF-5, PF-6, PF-8, PF-10 and PF-13 use. Do PF-2 first: it is five one-word edits and takes 24 of the 47.

### PF-4 [P1 M oversize corrected] The links shoppers press most on built pages are full page loads: a whole document and every prefetch made again where one small answer would do
- evidence: The page builder's blocks link with plain anchors: the content grid's tile title, picture and button (content-grid.tsx:147, 226-236, 304, 310), icon lists (icon-list-view.tsx:48), the link over a column (page-parts.tsx:448-458) and, opened by the planner, the button, dual button, picture and video blocks too (page-block.tsx:180, 246, 302, 366). The demo's home page and its /products page are built pages: the planner…
- cost: Per press on a built page's tile or button: a whole document, every script evaluated again and 12 prefetches repeated. What the page fetched ahead before the press is lost. (The shopper's browser on every step from a built page; the server renders a doc…)
- fix: 7 steps; first: Create src/components/block-link.tsx: BlockLink({ href, external, newTab, plain, ...rest }) returns <PolicyLink policy='intent'> (PF-3) only when the address is a page of the app: it starts with one '/', is not a pay path (isPayPath() of src/lib/pay-routes.ts…
- done when: e2e/prefetch.spec.ts 'a press on a built page's tile stays in the app' passes: 0 document requests and at most 8 requests after the tap (1 document and 42 requests today, the skeptic's click.mjs).
- saving: Estimate from the two measured presses, as the skeptic cut it: about 37 fewer requests and about 60 KB less on the wire per press (104.5 KB against 12.9 KB plus the product page's 33.5 KB of scripts, which are needed once either way).
- after: PF-1; PF-3
- notes: Before opening is the cheap time to change how built pages navigate. The skeptic changed the kind from duplicate to oversize and cut the saving from 105 KB to about 60 KB; both kept.

### PF-5 [P1 S eager corrected] The admin prefetches its whole sidebar on every load and again after every refresh, to fetch nearly the same loading skeleton twelve times
- evidence: Planner's run on the admin home, signed in as the test owner at 1440x900: 28 router requests for 13 links, 171 KB decoded, 98 KB on the wire: 2 for each of the 12 store-admin links of the rail (a route tree and a page answer of 8.9 to 11.5 KB that holds the loading skeleton), 2 for /admin and 4 for the View store link (local only). The skeptic's measures stand: the Products and Customers answers differ in the segmen…
- cost: Per admin load 24 to 38 requests and 110 to 225 KB decoded; about 25 more per refresh or save; about 150 a minute while the Live page is open (the skeptic's estimate from the measured refresh). The answers are prerender… (The owner's browser and connection; the CDN. It grows with owners and with how …)
- fix: 6 steps; first: Create src/components/admin/ui/link.tsx: AdminLink = PolicyLink (PF-3's src/components/policy-link.tsx; create that file here if PF-3 has not landed) with policy intent unless a policy is given. Export it from src/components/admin/ui/index.ts.
- done when: e2e/signed-in/prefetch.spec.ts passes: 0 router prefetch requests in the 3 s after the admin home loads (28 today in my run, 24 of them for the 12 store-admin links) and at most 2 after hovering one rail link.
- saving: Measured: 24 requests and about 110 KB decoded per load of the admin home (28 and 171 KB with the two local extras); about 25 requests per refresh, save and Live tick.
- after: PF-3
- tracked: no for the cost. Related: docs/audits/code-review-2026-11.md step 0.10 (FS1, In progress), whose done-criterion leans on the prefetched skeleton.
- notes: One line could do much of this without touching links: export const prefetch = 'force-disabled' on the admin's gated layout (Next's prefetch segment config; route trees are still fetched). It also stops the fetch on hover, so the skeleton would never be ready…

### PF-6 [P2 S duplicate confirmed] Each row of an admin list fetches the same shell again
- evidence: The skeptic's measure on the product list with four rows: 8 requests, four identical route trees (741 B) and four identical page answers (9,746 B each); the answer has no product in it, only the editor's shell. The rows are <Link>s in products-bulk.tsx:259; most other lists go through the shared primitives ListRow and RowLead (ui/list.tsx:28, 51; 114 uses in 88 files, counted here), the card tile (ui/card.tsx:82) an…
- cost: Two requests and about 10.5 KB decoded per row in view, all copies. A list of 25 rows in view would make 50 requests and about 260 KB (estimate by multiplication). Repeated after every refresh or save (PF-5). (The owner's browser; the CDN. It grows with real catalogues, order lists and cu…)
- fix: 5 steps; first: src/components/admin/ui/list.tsx:28 (ListRow) and :51 (RowLead), src/components/admin/ui/card.tsx:82, src/components/admin/ui/page-header.tsx:37 and src/components/admin/ui/focus-frame.tsx:36, 47: use AdminLink (PF-5), policy intent.
- done when: e2e/signed-in/prefetch.spec.ts 'a list's rows wait to be pointed at' passes: 0 router prefetch requests for product editors after the product list loads (8 on a four-row list today).
- saving: Measured: 8 requests and 42 KB decoded on a four-row list; in proportion on longer lists.
- after: PF-5
- notes: Four primitives carry most of the admin's 947 links' rows and buttons, so this is a small change with a wide reach. Do it in the same change as PF-5.

### PF-7 [P1 S eager corrected] On wide screens the cart link prefetches a drawer and its scripts that are never shown, and a press renders the drawer before reloading the page
- evidence: The cart link's prefetch is 3 requests at any width (planner's run at 1440x900: the route tree 686 B, the children slot's default 845 B, the drawer page 5.9 KB decoded), and per the skeptic the drawer page names 2 script chunks that are then loaded (14.3 KB on the wire). From 768 px the drawer reloads the address as soon as it mounts (cart-drawer.tsx:44-47; D64 says so). The skeptic's press at 1440 px: one router na…
- cost: Per full page view at 768 px or wider: 3 router requests (7.2 KB decoded) and 2 script chunks (14.3 KB on the wire), never used. Per cart open there: one server render of the drawer thrown away, then the full cart page. (Desktop and tablet shoppers' browsers; the proxy per request; the server per ca…)
- fix: 4 steps; first: Create src/components/cart-anchor.tsx ('use client'): CartAnchor({ href, className, children }) keeps phone = false until mounted, then follows matchMedia('(min-width: 768px)') (move the DESKTOP constant of cart-drawer.tsx:10 to a shared place and use it in b…
- done when: e2e/prefetch.spec.ts 'the cart on a wide screen is a plain page' passes: 0 router prefetch requests for the cart at 1280x720 (3 today) and one document request, no router navigation, on the press.
- saving: Measured by the skeptic: 5 requests per full page view at desktop width (3 router, 2 scripts; about 25 KB on the wire here) and one drawer render per cart open.
- after: PF-1
- notes: The other <Link>s to the cart (the phone menu's at store-layout.tsx:406, the wishlist's, the checkout's back link) are rarely in view at desktop width and are left; PF-3 moves the phone menu's to intent.

### PF-8 [P2 S eager confirmed] Links in closed drop-down and mega menus are prefetched while invisible
- evidence: The panels under a menu link are hidden with 'invisible ... opacity-0' and stay laid out (menu-view.tsx:131, 167). Next counts a link as in view when its box meets the viewport plus 200 px, by intersection ratio alone (links.js:95-97, 213). The skeptic's browser test (work/pf2/io.mjs): a link in a visibility:hidden panel counts as in view; one in a closed <details>, a hidden part or display:none does not. No menu in…
- cost: Nothing on the demo store. On a store with nested menus, 2 to 3 requests per sub-link on every full page load at desktop width, plus the chunks their pages name: 30 sub-links would be 60 to 90 requests (estimate by mult… (Desktop shoppers' browsers and the server, on stores with real catalogue menus:…)
- fix: 3 steps; first: src/components/menu-view.tsx: in the row layout, draw the links of a dropdown (the anchor() call at 113) and of a mega menu's panel (142, 146) with PolicyLink policy intent (PF-3 gives anchor() its policy argument). The top links keep view.
- done when: The menu-view unit test shows intent on every sub-link, and the new e2e/menus.spec.ts case sees 0 router prefetch requests for a sub-link before its top link is hovered.
- saving: All of it: sub-links are fetched only on hover or focus (estimate; no nested menu in the test data to measure).
- after: PF-3
- notes: Same file and same change as PF-3's menu step; listed apart because its cost only shows on stores with nested menus.

### PF-9 [P2 M process confirmed] Partial Prefetching was planned, never switched on, and the next major Next release forces it
- evidence: The plan's stack line reads cacheComponents + partialPrefetching (docs/plan.md:120); the config sets only cacheComponents (next.config.ts:42). Every start logs that the option is unset and that both will be on everywhere in the next major release (start.log:8-14, read here). From Next's docs, not measured (no build was allowed): a default link then fetches one App Shell per route, shared by all links to that route, …
- cost: Today: the duplicate shells of PF-6 and one prefetch per link everywhere, and a warning in every build and start log. Later: a forced migration on Next's date, with shoppers watching. (Shoppers' and owners' browsers now; the team at the next major upgrade.)
- fix: 4 steps; first: next.config.ts:42: add partialPrefetching: false beside cacheComponents: true, with a comment that the choice is recorded and the spike below decides it. This stops the warning. Do it in PF-1's change.
- done when: The start log of a production build no longer prints the partialPrefetching warning (rg -c partialPrefetching on the log gives 0; start.log:8-14 has it today), and docs/performance.md holds the spike's request counts for the admin home, a list and the store home with the decision.
- saving: Estimate from the docs, as the skeptic left it: on the home page read to the footer, 18 link prefetches become 11 route shells; admin list rows become one. Nothing measured.
- after: PF-1; PF-3; PF-5
- tracked: docs/plan.md:120 names it as part of the recommended stack; no plan has a step for it
- notes: The config line is S and belongs with PF-1; the spike is M; adopting it across the storefront, where every layout and page reads URL data at its top, is larger and is not planned here.

### PF-10 [P1 M process corrected] Nothing sets or checks what the router may fetch ahead
- evidence: 943 of 947 links take Next's default; the four that set the prop do it to protect a file link, none for cost (re-counted here: 400 files import next/link, 335 of them in the admin). The speed budget counts bytes until two seconds after load at the top of a phone page (performance.spec.ts:152-155), so it sees 11 of the 47 router requests and holds no request count at all; its comment already notes a page that 'never …
- cost: No direct cost; it is why PF-1 to PF-8 and PF-11 to PF-13 could grow unseen. (Everyone the other findings name.)
- fix: 4 steps; first: The wrappers exist after PF-3 and PF-5 (src/components/policy-link.tsx, src/components/block-link.tsx, src/components/admin/ui/link.tsx). State the policy per group in docs/performance.md, 'What the router fetches ahead'. view: the cart link on phones, a head…
- done when: pnpm test passes with the ratchet's directLinks baseline in place (a new file that imports next/link fails it), and both prefetch specs pass in CI with a budget for the store home, a product page, a listing, the cart, the front door and the admin home.
- saving: Keeps the gains of the other findings: phone home 47 to 3 router requests read to the footer, admin home 28 to 0 at rest (by subtraction from measured counts).
- after: PF-1; PF-3; PF-5
- notes: The skeptic raised the effort from S to M because a flat ban on next/link would touch 400 files; the ratchet is the answer. Before opening is the cheap time to set the rule: no page has been tuned around today's accidental behaviour.

### PF-11 [P0 S eager added] Links that leave their root layout are fetched ahead, and pressing them loads a whole document anyway: a multi-country store's front door fetches every country's home page for nothing
- evidence: Missed by the report. The app has 14 root layouts (layout.tsx files that draw <html>, and platform-root.tsx:65 for the platform groups): a store's front door (s/[store]/(chooser)) and its market pages (s/[store]/[market]) are two of them, the admin a third, Kaizena Flow's own pages a fourth. Next's docs: navigating across root layouts causes a full page load (layout.md:145). The links between them are <Link>s all th…
- cost: Per visit to a multi-country store's front door: 4 requests and about 85 KB decoded per country, none usable (demo: 12 and 254 KB; ten countries would be 40 and about 850 KB, by multiplication). Each is a proxy run and,… (The shopper's browser at the front door; the proxy and the server per request; …)
- fix: 6 steps; first: src/app/s/[store]/(chooser)/page.tsx:96 and :121: add prefetch={false} to both <Link>s (or draw plain anchors: the press is a document load either way).
- done when: e2e/prefetch.spec.ts passes both cases: 0 router prefetch requests on /s/demo (12 today) and at most 4 on / with none for /admin or a store (8 today, 4 of them wasted).
- saving: Measured: 12 requests, 254 KB decoded and 58.6 KB on the wire per visit to the demo store's front door, with up to 3 cold or stale renders; 4 of 8 requests per view of Kaizena Flow's home page.
- after: PF-1
- notes: Seven one-word edits; do them in the same change as PF-2. Depends on PF-1 only for the shared spec file. Not searched to the end: other pairs of root layouts (the theme store to its preview frame, the docs to the site) may hold a few more such links; the poli…

### PF-12 [P2 S eager added] The first add to cart of a visit throws the router's whole prefetch cache away: 20 more requests on a phone, at the moment the shopper buys
- evidence: Missed by the report, which read the mechanism for the admin and did not measure it. A cart is made on the first add, and making it sets the cart's cookie (cart.ts:698-726). Next answers a server action that changed a cookie as one that revalidated static and dynamic data (action-handler.js:123-126), and the router then evicts the entire prefetch cache and asks again for every link in view (server-action-reducer.js:…
- cost: Once per visit that adds to a cart: 20 requests on the network on a phone at the top of a product page, more with the footer in view (every link in view is asked again). Each is a proxy run, and they share the phone's c… (The shopper's browser at the moment of buying; the proxy and the server per req…)
- fix: 3 steps; first: No change to the cart: the cookie has to be set when the cart is made (D14: the one cookie a cart has), and the eviction is Next's. The cost is the number of links in view, so PF-2, PF-3 and PF-7 remove most of it: on a phone only the cart link keeps viewport…
- done when: e2e/prefetch.spec.ts 'the first add to cart asks for little again' passes: at most 10 router prefetch request events after the first add on a phone (32 today, 20 of them on the network).
- saving: Estimate from the measured list: from 32 request events (20 on the network) to the cart link's own, 7 events in my run (its tree, the market layout, its default and the drawer page, some asked twice).
- after: PF-1; PF-3
- notes: Not worth a change of its own beyond the budget case: minting the cart outside a server action (a route handler) would be a larger change for 20 requests once a visit. Worth reporting upstream with PF-1: Next's TODO at server-action-reducer.js:223-227 describ…

### PF-13 [P2 S eager added] A real listing prefetches every product tile, and up to six swatch links under each: nothing bounds it, and the test stores are too small to show it
- evidence: Missed by the report because the test data cannot show it. The demo and test stores have 10 products each (counted in the local database), and the demo's /products and home pages are built pages whose tiles are plain anchors (PF-4), so no measurement of this review saw a real listing. A category, tag, brand or related-products listing draws ProductCard, whose title is a <Link> with no policy (product-card.tsx:74), u…
- cost: Estimate by multiplication, not measured: a 48-tile listing read to the end is 96 requests, about 360 KB on the wire and 550 KB decoded, and up to 48 shell renders when the store has been quiet for an hour; with swatche… (The shopper's browser on every listing; the proxy and the server (a render per …)
- fix: 5 steps; first: src/components/product-card.tsx:103 (GroupSwatches): draw each swatch with PolicyLink policy intent (PF-3).
- done when: e2e/prefetch.spec.ts holds a ceiling for a seeded 48-product category read to the end on a phone, and src/components/product-card.test.ts shows intent on every swatch link.
- saving: Swatches: all of their prefetches until one is pointed at (estimate; no combined listing in the test data). Tiles: none yet; the number becomes visible and held, and the spike decides.
- after: PF-1; PF-3
- notes: The review's brief names product tiles as a group that should keep viewport prefetch, and this plan keeps it: the tile is the likely next press. What is added is the bound and the swatches. If the spike shows the renders on quiet stores cost more than the hea…
