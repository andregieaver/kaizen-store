# Prefetching: what the router asks for unasked (PF)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** Next's default (fetch every link in view) decides for all but 4 of 947 links, and no test or budget watches it. Re-measured here: a phone shopper who reads the demo store's home page to the footer makes 47 router requests (729 KB decoded) for pages not asked for, 24 of them for the home pages of eight other language, currency and country views; the admin home makes 28; and a multi-country store's front door makes 12 (254 KB) for links whose press loads a whole document anyway. The endless prefetch loop is real but local and CI only (624 router requests in 4 s on the search results page as built, 55 with route guessing off), and one config line stops it. The plan is three changes of a few lines first (the loop, the other views, the links that leave their root layout), then one small link wrapper that states a policy per link group, held by a request budget; none of it argues from an unused feature, and all of it is cheapest before opening.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [PF-1](PF-1.md) ✓ | Next's route guessing and the cart drawer's catch-all slot make an endless prefetch on the local build and in CI: about 165 requests a second reach the server per open page | eager | P0 | S | 0.14 |
| [PF-2](PF-2.md) ✓ | Every page of a store with several languages, currencies or countries prefetches the home page of each other view, and for languages and currencies the press does not open it | eager | P0 | S | 0.12 |
| [PF-11](PF-11.md) | Links that leave their root layout are fetched ahead, and pressing them loads a whole document anyway: a multi-country store's front door fetches every country's home page for nothing | eager | P0 | S | 0.12 |
| [PF-3](PF-3.md) ✓ | The header tools, bottom bar and footer are prefetched on every full page load, with the script chunks of pages nobody asked for | eager | P1 | S | 2.6 |
| [PF-4](PF-4.md) ✓ | The links shoppers press most on built pages are full page loads: a whole document and every prefetch made again where one small answer would do | oversize | P1 | M | 2.7 |
| [PF-5](PF-5.md) ✓ | The admin prefetches its whole sidebar on every load and again after every refresh, to fetch nearly the same loading skeleton twelve times | eager | P1 | S | 0.13 |
| [PF-7](PF-7.md) ✓ | On wide screens the cart link prefetches a drawer and its scripts that are never shown, and a press renders the drawer before reloading the page | eager | P1 | S | 2.2 |
| [PF-10](PF-10.md) ✓ | Nothing sets or checks what the router may fetch ahead | no check | P1 | M | 2.6 |
| [PF-6](PF-6.md) ✓ | Each row of an admin list fetches the same shell again | duplicate | P2 | S | 0.13 |
| [PF-8](PF-8.md) ✓ | Links in closed drop-down and mega menus are prefetched while invisible | eager | P2 | S | 2.6 |
| [PF-9](PF-9.md) ✓ | Partial Prefetching was planned, never switched on, and the next major Next release forces it | no check | P2 | M | 2.8 |
| [PF-12](PF-12.md) | The first add to cart of a visit throws the router's whole prefetch cache away: 20 more requests on a phone, at the moment the shopper buys | eager | P2 | S | 2.6 |
| [PF-13](PF-13.md) | A real listing prefetches every product tile, and up to six swatch links under each: nothing bounds it, and the test stores are too small to show it | eager | P2 | S | 2.8 |

## Measured

| Measure | Value | How |
|---|---|---|
| Links that set a prefetch policy | 4 call sites of 947 <Link uses in 400 files (3 Link, 1 ButtonLink of 107 ButtonLink uses); none pass prefetch={true}; no router.prefetch(), no next/form, no staleTimes. By area: 335 admin files, 64 storefront and platform files, 1 global. | rg over src without tests, re-run by the planner (rg -l 'from "next/link"', rg -o '<Link\b', rg 'prefetch=') |
| The loop's cause, proven by switching it off | Router requests in 4 s on /s/demo/no/search?q=lampe at 1440x900: 624 as built, 55 with route guessing off, 47 with a two-line bail-out (the skeptic's phone runs: 495, 23, 21) | the review's working files (not kept) in its three modes, re-run by the planner (the router chunk rewritten in flight; nothing on disk changed, nothing built) |
| The loop on a category page | /s/demo/no/category/hjem at 1440x900: 2,040 router requests in 5 s, 1,994 of them one address and one segment (@drawer/.../$c$rest/__PAGE__); 47 distinct requests for 20 links | the review's working files (not kept) --json and a count per address and segment, planner's run |
| The loop's rate, one open tab | About 165 requests a second reach the server (1,335 of 2,643 request events in 8 s went on the network; the rest are answered by the browser's HTTP cache) | the skeptic's the review's working files (not kept) (CDP responseReceivedExtraInfo); not re-run by the planner |
| Pages that loop at CI's screen size | 9 of 11 demo-store pages never go idle at 1280x720 (product, category, search results, empty cart, checkout that bounces to the cart, om-oss, the blog index, account, wishlist) | the skeptic's the review's working files (not kept); not re-run by the planner |
| What one looping page costs | Server 4.7 s of CPU per 9 s against 0.16 s quiet; browser 2.79 s of main-thread time per 8 s against 0.08 s; heap 3 to 13 MB | the skeptic's /proc/<pid>/stat and CDP Performance.getMetrics; not re-run |
| CI exposure | 25 e2e spec files open /s/demo addresses in 101 goto calls (the skeptic counted 99), at Desktop Chrome 1280x720. The signed-in job also runs without the store domain: 12 of its spec files open /s/ addresses in 20 goto calls (exposed where the store has a country in its address; not split). The hosts job sets NEXT_PUBLIC_STORE_DOMAIN and is spared. | rg -c 'goto\([^)]*/s/demo' e2e; .github/workflows/ci.yml:116-157, 170-191, 215-251; playwright.config.ts:11-15 |
| Store home on a phone, top of the page | 11 router requests for 4 links (search 3, wishlist 3, cart 3, account 2), 19.8 KB decoded, 31 KB on the wire; plus 3 script chunks (24 KB on the wire) those answers name | watch.mjs, planner's run; the chunks from the skeptic's chunks-of-prefetch2.mjs |
| Store home on a phone, read to the footer | 47 router requests for 18 links, 729.3 KB decoded, 204.0 KB on the wire; plus 10 script chunks, 87 KB on the wire | watch.mjs --scroll slow + uniq.mjs, planner's run (same counts as the auditor's and the skeptic's); the chunks from the skeptic |
| Share taken by the other views | 8 links (3 languages, 3 currencies, 2 countries): 24 of the 47 requests, 662.0 of 729.3 KB decoded, 135.4 of 204.0 KB on the wire. The demo's built /products page: the same 24 of 48. | uniq.mjs grouping of the planner's two runs |
| Store home at 1440x900, top of the page | 17 router requests for 7 links: 3 product links of the header menu 8, search, account and wishlist 6, cart 3 | watch.mjs, planner's run |
| One product link | 2 requests: the route tree (1,035 B decoded, 2.4 KB on the wire) and the product page's shell (10.1 to 10.5 KB decoded, 5.1 KB on the wire) | watch.mjs on /s/demo/no/products at 1440x900, planner's run (the three product links of the header menu) |
| Product page on a phone | 12 router requests at the top (40.3 KB on the wire); 48 distinct for 19 links read to the end | the review's working files (not kept) (load phase), planner's run; the read-to-the-end count is the skeptic's |
| The first add to cart of a visit | 32 more router prefetch request events, 20 of them on the network (28.9 KB), after a load that made 12; the action's answer carried x-action-revalidated: 1. The second add carried 2 and asked for nothing. | the review's working files (not kept) and addcart2.mjs on a phone at the top of a product page, two runs with the same numbers |
| A multi-country store's front door | /s/demo: 12 router requests for its 3 country links, 254 KB decoded, 58.6 KB on the wire. Pressing one loaded a document (21,354 B) and 56 more requests: nothing fetched ahead was used. | watch.mjs and the review's working files (not kept) on /s/demo at 1440x900, planner's run |
| Kaizena Flow's own home page | 8 router requests for 4 links; 4 of them for /admin and the demo store, whose press loads a document (pressing /admin: 1 document of 6,256 B and 38 requests; pressing /sign-up, same root layout: 4 requests) | watch.mjs and click.mjs on / at 1440x900, planner's run |
| Admin home | 28 router requests for 13 links, 171 KB decoded, 98 KB on the wire: 24 for the 12 store-admin links (8.9 to 11.5 KB a link), 2 for /admin, 4 for the View store link (62 KB decoded; local only) | watch.mjs signed in as the test owner, planner's run |
| What one router.refresh() asks for again | 25 prefetch requests and 1 navigation on the admin product list (78 and 116 KB on the wire in two runs); 23 on the store home at desktop width | the skeptic's the review's working files (not kept); not re-run |
| A press on a product tile of a built page | A full page load: 42 requests, 104.5 KB on the wire. A <Link> press to a product page from the same page: 5 requests, 12.9 KB. | the skeptic's click.mjs and softnav.mjs; not re-run |
| A cold prefetch on the server | 75 and 78 ms for the first tree prefetch of a route not yet rendered, 6 to 12 ms after; store routes have no shared fallback shell and only the template store is built ahead | the skeptic's curl runs; .next/prerender-manifest.json and src/server/shop.ts:93-101 as the skeptic read them |
| Listings in the test data | The demo and test stores have 10 products each; a listing page holds up to 48 (LISTING_LIMIT). No measurement of this review saw a real listing. | psql on the local test database (count per store); src/server/listing.ts:59 |

## Well made, and should stay

- Storefront prefetch answers are cacheable once rendered (s-maxage 900 s for a home page, 3,600 s otherwise, with stale-while-revalidate), and no link asks for a full dynamic prefetch. They are not static from the start: a store's first ask of each route and view runs a render, and a stale one a background render (the skeptic's correction, kept).
- The admin's prefetch answers are prerendered shells without any store's or person's data, and admin paths are outside the proxy's matcher (src/proxy.ts:54-60).
- The language switcher of built headers and footers (src/components/language-links.tsx) uses plain anchors and router.push on press: no prefetch.
- Search results' tracked product links are plain anchors with nofollow, so a prefetch can never record a click (src/components/product-card.tsx:69-72); export, CSV and print links pass prefetch={false}.
- No <Link> points at a route handler: a scan of Link and ButtonLink hrefs for export, csv, pdf, xml, label, feed, download and the like found only pages (the planner's rg); the files themselves are reached by plain anchors or prefetch={false}.
- Filter chips and Show more on a listing cost no request: on /s/demo/no/category/hjem?stock=1&min=100&kind=physical the chip links (?min=100, ?stock=1) are in the HTML and the router asked for neither (the planner's run). The same route with other search params shares its shell.
- Links inside a closed <details>, a hidden part or display:none do not count as in view, so the header's closed country, language and currency menus and the phone's slide-out menu prefetch nothing until opened.
- Prefetched answers live five minutes in the browser's router cache: 70 of 85 cacheLife() calls are the 'hours' profile and nothing sets staleTimes, so soft navigation within a visit does not ask again. Every full page load starts from nothing, which is why PF-4 matters.
- The cart link on a phone is prefetching well spent: the tap is one navigation request of 4,859 B and the drawer opens from the prefetched shell.
- The @drawer slot follows Next's documented pattern for closing a modal (parallel-routes.md:468-486) and D64 explains it. The loop is the framework's fault, not the route's.
- The proxy has to see prefetch requests (it rewrites short addresses and holds the private-store gate, src/proxy.ts:96-151) and reads a store's facts at most every few seconds, never per request. The remedy is fewer prefetches, not skipping the proxy.
- Production's store hosts are spared the loop by construction: every /s/ address redirects to the store's host (src/lib/store-hosts.ts:89-104), and route guessing refuses an address that does not spell its route.
- The admin's service worker precaches only its offline shell (src/lib/admin-sw.ts:19), and the only resource hint in the app is the font preload (src/components/font-preloads.tsx:25).
- No finding in this dimension argues from an unused feature or an empty table. These are costs per page view, per press and per save: they grow with shoppers, owners and stores.
