# Every finding of the bloat review, by area

Part of `docs/audits/bloat-review-2026-11.md`. One folder per area: its `README.md` has the area in short, its measures and what is well made; each finding has a small file of its own with the evidence, the fix in steps, the tests and rules that change with it, and the check that says it is done. A tick (✓) marks a finding that passed its second check. "Step" is the step of the plan that closes it; *tolerated* means an A lives with it; *your choice* means it is the owner's product choice.

## What a shopper's browser loads (SC)

A shopper's first page is mostly well kept, and nothing here argues for removing a feature: a cold home page sends 680 KB of scripts (213 KB gzip), 63 % of it React and Next, with no third-party script and no font file. What is left is cost that does not follow use and that grows with page views once stores open. Folder: `storefront-browser/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [SC-1](storefront-browser/SC-1.md) ✓ | Every document load prefetches the pages behind its links; language and currency links prefetch a page a press never opens | eager | P0 | S | 0.12 |
| [SC-3](storefront-browser/SC-3.md) ✓ | Admin words, whole catalogues and an unused library ride in every shopper's first scripts | oversize | P0 | S | 0.16 |
| [SC-4](storefront-browser/SC-4.md) ✓ | The product page loads the cart's forms, and every product kind's picker | eager | P0 | S | 0.16 |
| [SC-6](storefront-browser/SC-6.md) ✓ | The byte budgets are loose, count a file no modern browser loads, and cover one storefront route besides home | no check | P0 | S | 1.3 |
| [SC-10](storefront-browser/SC-10.md) ✓ | Every document load asks the server for the wishlist, also for visitors who have none | eager | P0 | S | 0.15 |
| [SC-12](storefront-browser/SC-12.md) | Every page with a product grid loads the tile's Add to cart script and asks the server for stock, also in a store whose tiles show neither (the default) | eager | P0 | S | 0.15 |
| [SC-2](storefront-browser/SC-2.md) ✓ | Listing, search, cart, checkout, account, wishlist and cookies pages all load one bundle of every working part | eager | P1 | M | 2.9 |
| [SC-7](storefront-browser/SC-7.md) ✓ | On a wide screen a press on the cart renders the cart as a drawer, throws it away, then loads the cart page | duplicate | P1 | S | 2.2 |
| [SC-8](storefront-browser/SC-8.md) ✓ | The whole store layout is sent twice in every page, with the store's 404 page inside, because the cart drawer's slot sits on the root layout | duplicate | P1 | M | 2.2 |
| [SC-13](storefront-browser/SC-13.md) | A store in a language translated by AI sends its whole interface text in every page; the browser reads 114 of its 1,673 texts | oversize | P1 | S | 0.8 |
| [SC-5](storefront-browser/SC-5.md) ✓ | One stylesheet for stores, site and admin: shoppers download the admin's utility classes | oversize | P2 | M | 2.11 |
| [SC-9](storefront-browser/SC-9.md) ✓ | Open question, not yet a planned saving: on the local build, listing and search pages asked for one prefetch about 160 times a second | eager | P2 | S | 0.14 |
| [SC-11](storefront-browser/SC-11.md) ✓ | Small parts a plain store's page never draws are in every page's first scripts | eager | P2 | S | 0.16 |

## The built client bundles, by page (BN)

Shoppers' pages are lean and the admin is where the weight is: a store page's first scripts are 680 to 778 thousand bytes, about 447 thousand of them React and Next, while the 432 signed-in admin routes have a median of 1,155,530 bytes and every one carries Supabase's client (253 KB) and zod (114 KB) before it is used. Seven small import changes (BN-1, BN-3, BN-4, BN-5, BN-7, BN-14, BN-2) take the admin's median to about 604 KB in a simulation on the built chunks, 13 preview screens from 3.2 MB to 0.8 to 1.4 MB, one Work screen from 4.27 MB to about 1.4 MB, and stop Kaizena Flow's front page from downloading 437 KB of admin scripts it cannot use; routes over 1.3 MB fall from 90 to about 26, the builder's own. Folder: `client-bundles/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [BN-1](client-bundles/BN-1.md) ✓ | Every signed-in admin screen loads the whole Supabase client in its first scripts, for a session listener and for uploads nobody has pressed yet | eager | P0 | S | 0.9 |
| [BN-2](client-bundles/BN-2.md) ✓ | Kaizena Flow's front page prefetches the admin and downloads its signed-in frame, which a press on Sign in cannot use | eager | P0 | S | 0.12 |
| [BN-3](client-bundles/BN-3.md) ✓ | The keyboard shortcut sheet brings the page builder's English and field code to every admin screen | eager | P0 | S | 0.9 |
| [BN-4](client-bundles/BN-4.md) ✓ | zod is in every signed-in admin screen's first scripts through three small imports | oversize | P0 | S | 0.9 |
| [BN-5](client-bundles/BN-5.md) ✓ | The rich text editor is in the first scripts of 34 screens that are not the builder: lists, orders, customers, deals and the product editor | eager | P0 | M | 0.10 |
| [BN-7](client-bundles/BN-7.md) ✓ | One Work screen loads 4.27 MB: the admin's whole text in both languages | eager | P0 | S | 0.11 |
| [BN-11](client-bundles/BN-11.md) ✓ | The script budgets watch 15 of 560 routes, and the visitor's one counts a legacy file twice | no check | P0 | S | 1.2 |
| [BN-14](client-bundles/BN-14.md) | Thirteen preview screens load the whole page builder to draw a page | eager | P0 | S | 0.10 |
| [BN-6](client-bundles/BN-6.md) ✓ | The page builder and the draft order editor ship all four storefront languages whole | oversize | P1 | M | 2.29 |
| [BN-9](client-bundles/BN-9.md) ✓ | Twelve storefront routes, the product page among them, carry the cart's, checkout's, order's and account's forms | eager | P1 | M | 2.9 |
| [BN-10](client-bundles/BN-10.md) ✓ | Three tables a shopper's page never reads at first paint are in its first scripts | oversize | P1 | S | 0.16 |
| [BN-15](client-bundles/BN-15.md) | The AI manager's chat is a 496 KB script, about 95% of it three tables read for two labels | oversize | P1 | S | 0.11 |
| [BN-16](client-bundles/BN-16.md) | A store page with a recommending grid downloads 650 KB more script once recommendations answer: zod, the page model and all four languages | oversize | P1 | M | 2.10 |
| [BN-8](client-bundles/BN-8.md) ✓ | Whole English catalogues are imported as default values, and the check sees only the direct ones | eager | P2 | M | 2.26 |
| [BN-12](client-bundles/BN-12.md) ✓ | One stylesheet for shoppers and owners: a quarter of what a shopper downloads styles only the admin | oversize | P2 | M | 2.11 |
| [BN-13](client-bundles/BN-13.md) ✓ | 40% of the built client JavaScript is second copies of modules; a browser meets about 14% of it while moving around | duplicate | P3 | M | tolerated |

## What a page sends: document, payload and requests (PL)

On the wire a storefront document is light (13.7 to 21.3 thousand bytes gzipped); only the admin's two editors are heavy (108 and 136 thousand), and about 70% of that is message catalogues, of which the product editor's parts read a third (239 KB handed, 79 KB read). The waste is in what repeats and in what follows a load: the store's layout is rendered and sent twice for a 404 nobody sees (29.7 thousand bytes raw per document, and again inside the 79 KB every Add to cart sends back), a visitor who does nothing causes 11 to 50 prefetches and one or two uncached server calls per storefront view (the wishlist, the tiles, and on a search page a suggestion call nobody typed for), and Kaizena Flow's own pages pull about 141 KB of admin sign-in files. Folder: `page-payload/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [PL-3](page-payload/PL-3.md) ✓ | The language, currency and country links prefetch whole front pages; a language or currency press never opens the one it fetched | eager | P0 | S | 0.12 |
| [PL-4](page-payload/PL-4.md) ✓ | Kaizena Flow's own pages download the admin's sign-in scripts for every visitor | eager | P0 | S | 0.12 |
| [PL-7](page-payload/PL-7.md) ✓ | Every page of every store asks the server for a wishlist almost no visitor has | eager | P0 | S | 0.15 |
| [PL-8](page-payload/PL-8.md) ✓ | Stock and Add to cart on tiles: off by default, yet every view of a product grid pays a server call and three queries | eager | P0 | S | 0.15 |
| [PL-11](page-payload/PL-11.md) ✓ | Every open admin tab asks for AI manager notices each minute, with three queries for one number | eager | P0 | S | 2.34 |
| [PL-13](page-payload/PL-13.md) ✓ | No budget watches a document, its payload, an action's answer, an admin page's requests or what most pages ask for after load | no check | P0 | S | 1.3 |
| [PL-14](page-payload/PL-14.md) | A search results page asks the server for suggestions nobody typed for | eager | P0 | S | 0.15 |
| [PL-1](page-payload/PL-1.md) ✓ | The admin's message catalogues travel as props in every document and with each page opened | oversize | P1 | M | 2.27 |
| [PL-2](page-payload/PL-2.md) ✓ | Every storefront page carries the whole layout twice, and renders its live parts twice per request, for a 404 it is not showing | duplicate | P1 | M | 2.2 |
| [PL-5](page-payload/PL-5.md) ✓ | Prefetching runs per link because partialPrefetching is unset: 11 to 50 requests after a storefront load, 23 to 46 in the admin | eager | P1 | M | 2.8 |
| [PL-9](page-payload/PL-9.md) ✓ | A store in an AI-translated language will carry the whole interface catalogue in every document | oversize | P1 | S | 0.8 |
| [PL-10](page-payload/PL-10.md) ✓ | Shoppers load the admin's common words, the consent catalogue and the filter dialog on every page | eager | P1 | S | 0.16 |
| [PL-6](page-payload/PL-6.md) ✓ | A listing sends its product grid twice, and a category asks the database again for the list it already drew | duplicate | P2 | M | 2.12 |
| [PL-12](page-payload/PL-12.md) ✓ | The default icon is a 26 KB .ico revalidated on every visit | oversize | P3 | S | tolerated |

## Prefetching: what the router asks for unasked (PF)

Next's default (fetch every link in view) decides for all but 4 of 947 links, and no test or budget watches it. Re-measured here: a phone shopper who reads the demo store's home page to the footer makes 47 router requests (729 KB decoded) for pages not asked for, 24 of them for the home pages of eight other language, currency and country views; the admin home makes 28; and a multi-country store's front door makes 12 (254 KB) for links whose press loads a whole document anyway. Folder: `prefetching/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [PF-1](prefetching/PF-1.md) ✓ | Next's route guessing and the cart drawer's catch-all slot make an endless prefetch on the local build and in CI: about 165 requests a second reach the server per open page | eager | P0 | S | 0.14 |
| [PF-2](prefetching/PF-2.md) ✓ | Every page of a store with several languages, currencies or countries prefetches the home page of each other view, and for languages and currencies the press does not open it | eager | P0 | S | 0.12 |
| [PF-11](prefetching/PF-11.md) | Links that leave their root layout are fetched ahead, and pressing them loads a whole document anyway: a multi-country store's front door fetches every country's home page for nothing | eager | P0 | S | 0.12 |
| [PF-3](prefetching/PF-3.md) ✓ | The header tools, bottom bar and footer are prefetched on every full page load, with the script chunks of pages nobody asked for | eager | P1 | S | 2.6 |
| [PF-4](prefetching/PF-4.md) ✓ | The links shoppers press most on built pages are full page loads: a whole document and every prefetch made again where one small answer would do | oversize | P1 | M | 2.7 |
| [PF-5](prefetching/PF-5.md) ✓ | The admin prefetches its whole sidebar on every load and again after every refresh, to fetch nearly the same loading skeleton twelve times | eager | P1 | S | 0.13 |
| [PF-7](prefetching/PF-7.md) ✓ | On wide screens the cart link prefetches a drawer and its scripts that are never shown, and a press renders the drawer before reloading the page | eager | P1 | S | 2.2 |
| [PF-10](prefetching/PF-10.md) ✓ | Nothing sets or checks what the router may fetch ahead | no check | P1 | M | 2.6 |
| [PF-6](prefetching/PF-6.md) ✓ | Each row of an admin list fetches the same shell again | duplicate | P2 | S | 0.13 |
| [PF-8](prefetching/PF-8.md) ✓ | Links in closed drop-down and mega menus are prefetched while invisible | eager | P2 | S | 2.6 |
| [PF-9](prefetching/PF-9.md) ✓ | Partial Prefetching was planned, never switched on, and the next major Next release forces it | no check | P2 | M | 2.8 |
| [PF-12](prefetching/PF-12.md) | The first add to cart of a visit throws the router's whole prefetch cache away: 20 more requests on a phone, at the moment the shopper buys | eager | P2 | S | 2.6 |
| [PF-13](prefetching/PF-13.md) | A real listing prefetches every product tile, and up to six swatch links under each: nothing bounds it, and the test stores are too small to show it | eager | P2 | S | 2.8 |

## Styles (CS)

Styles are one of the leaner areas, and no finding here rests on a feature being unused. Every page of every surface loads one stylesheet of 183 KB (25.8 KB Brotli); compiling the proposed split with the project's own Tailwind gives shoppers a sheet of 130 KB (19.8 KB Brotli: 28% less raw, 22% less on the wire), leaves the admin's as it is, needs no more scan memory than today (204-212 MB against 221-223 MB), and stops admin-only and test-only edits from renaming the shoppers' file. Folder: `styles/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CS-7](styles/CS-7.md) ✓ | Shop pages use admin-only colour roles that have no value outside the admin | no check | P0 | S | 0.34 |
| [CS-9](styles/CS-9.md) | The admin's form, print and editing parts are drawn on public pages without the colours they read: the main button on Kaizena Flow's status and report pages has no fill | no check | P0 | S | 0.34 |
| [CS-8](styles/CS-8.md) ✓ | Kaizena Flow's own pages fetch the admin's stylesheet and two admin answers after load | eager | P0 | S | 0.12 |
| [CS-3](styles/CS-3.md) ✓ | Nothing holds the stylesheet's size, its sources or the style text in a document | no check | P0 | S | 1.3 |
| [CS-1](styles/CS-1.md) ✓ | Shoppers download the admin's classes: one stylesheet serves every surface | eager | P1 | M | 2.11 |
| [CS-4](styles/CS-4.md) ✓ | The fixed breakpoint sheet is drawn again with every row | duplicate | P1 | S | 2.3 |
| [CS-6](styles/CS-6.md) ✓ | Tailwind reads tests, SQL and message files: 37% of its candidates, 10 junk classes | dead | P2 | S | 0.35 |
| [CS-5](styles/CS-5.md) ✓ | Layout-level style sheets are carried three times in each store document | duplicate | P3 | S | 2.2 |
| [CS-2](styles/CS-2.md) ✓ | A store with no builder motion still downloads motion.css | eager | P3 | M | 2.49 |

## What an owner's browser loads in the admin (AC)

The admin's browser load is moderately bloated, and the worst of it is cheap to fix before opening: a plain screen loads 1.15 MB of script (median of 449 routes), of which 481 KB is Supabase's client, zod and the builder's English, brought in by three stray imports. 26 screens load an editor they never draw, an order screen carries 0.69 MB for custom fields the store may not have, one Work screen ships a 1.7 MB chunk of text, and the builder loads 3.3 MB at once. Folder: `admin-browser/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [AC-1](admin-browser/AC-1.md) ✓ | Three stray imports put Supabase, zod and the builder's English on every admin screen | eager | P0 | S | 0.9 |
| [AC-2](admin-browser/AC-2.md) ✓ | 26 screens load an editor they never draw, because lists, previews and editors share one views file | eager | P0 | S | 0.10 |
| [AC-3](admin-browser/AC-3.md) ✓ | Order, customer and deal screens load the rich text editor and the builder's schema for custom fields, whether or not the store has any | eager | P0 | S | 0.10 |
| [AC-7](admin-browser/AC-7.md) ✓ | The Work invoice screen ships the whole admin catalogue, both languages, in one 1.7 MB chunk | oversize | P0 | S | 0.11 |
| [AC-10](admin-browser/AC-10.md) ✓ | The script budget covers 9 of 449 admin routes and none of the HTML | no check | P0 | S | 1.2 |
| [AC-11](admin-browser/AC-11.md) ✓ | The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out | no check | P0 | S | 1.4 |
| [AC-4](admin-browser/AC-4.md) ✓ | Pages hand whole text areas to the browser where their parts read a few branches; one area on every screen is read by nothing | oversize | P1 | M | 2.27 |
| [AC-5](admin-browser/AC-5.md) ✓ | The page builder loads everything at once: 3.3 MB of script before the first paint | eager | P1 | M | 2.29 |
| [AC-6](admin-browser/AC-6.md) ✓ | The builder and the draft order editor load the storefront's text in all four languages | oversize | P1 | M | 2.29 |
| [AC-8](admin-browser/AC-8.md) ✓ | The AI manager's chat downloads every tool definition, the admin map and the Norwegian page names to label a tool call | oversize | P1 | S | 0.11 |
| [AC-12](admin-browser/AC-12.md) ✓ | Every navigation link in view is prefetched one by one: 23 to 46 background requests per admin screen | eager | P1 | S | 0.13 |
| [AC-14](admin-browser/AC-14.md) | The Products list sends every product of the store to the browser: no paging, about 0.9 KB a product | oversize | P1 | M | 0.19 |
| [AC-9](admin-browser/AC-9.md) ✓ | English text for 23 areas is still compiled into client scripts and then handed down again in the HTML | duplicate | P2 | M | 2.26 |
| [AC-13](admin-browser/AC-13.md) | The notice badge asks the server every minute from every open admin tab: four database statements a time, one of them thrown away | eager | P2 | S | 2.34 |

## What the server does for a storefront request (SD)

A warm, cached storefront page is lean (a prerendered home page or a store's own page makes no database read of its own); the cost sits around the page and none of it depends on which features a store uses, so every store pays it once the platform opens. A product page asks the database about 18 times a view where only stock changes per view, the proxy in front of every page loads 1,311 modules (0.8 to 0.95 s and 168 MB cold on this machine) where its five reads need about 50 to 100, and every page load makes a second function call to learn the wishlist is empty and, with a product grid, a third (3 statements) for tile stock that is off by default. Folder: `storefront-server/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [SD-10](storefront-server/SD-10.md) ✓ | The store is looked up by its id again and again | duplicate | P0 | S | 0.20 |
| [SD-11](storefront-server/SD-11.md) ✓ | The same shopper facts are read several times in one request | duplicate | P0 | S | 0.22 |
| [SD-14](storefront-server/SD-14.md) | Product tiles ask the server for stock on every page load, also in stores that show none | eager | P0 | S | 0.15 |
| [SD-15](storefront-server/SD-15.md) | Every page load calls a function to learn that the wishlist is empty | eager | P0 | S | 0.15 |
| [SD-16](storefront-server/SD-16.md) | One owner saving AI settings expires the cached pages of every store | eager | P0 | S | 0.21 |
| [SD-1](storefront-server/SD-1.md) ✓ | The proxy and every storefront page load about half of the server's code at cold start | eager | P1 | M | 2.20 |
| [SD-2](storefront-server/SD-2.md) ✓ | A product page asks the database about 18 times per view; one answer changes per view | eager | P1 | M | 2.13 |
| [SD-8](storefront-server/SD-8.md) ✓ | Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page | eager | P1 | M | 2.15 |
| [SD-13](storefront-server/SD-13.md) ✓ | The browser's side has budgets; the server's side has none that can see these costs | no check | P1 | M | 1.11 |
| [SD-3](storefront-server/SD-3.md) ✓ | Every deploy empties the caches and nothing warms them | no check | P2 | S | 0.3 |
| [SD-4](storefront-server/SD-4.md) ✓ | Every published page is read whole to pick one page or a few titles | oversize | P2 | M | 0.24 |
| [SD-5](storefront-server/SD-5.md) ✓ | A cold page waits on reads one after another before its first byte | eager | P2 | S | 2.18 |
| [SD-6](storefront-server/SD-6.md) ✓ | The proxy reads the database before a page view whenever its 10-second memory has lapsed | eager | P2 | S | 2.20 |
| [SD-7](storefront-server/SD-7.md) ✓ | Every instance loads the interface-text tools and reads the translations table before its first request, then polls it each minute | eager | P2 | M | 0.8 |
| [SD-9](storefront-server/SD-9.md) ✓ | A store's pages ask about every optional feature, whether that store uses it or not | eager | P3 | S | 2.18 |
| [SD-12](storefront-server/SD-12.md) ✓ | Whole rows and documents are read for one fact | oversize | P3 | S | tolerated |

## What the server does for an admin navigation (AD)

All 12 findings of the audit stand (8 confirmed, 4 corrected) and this pass added three; none argues for removing, hiding or merging a feature, and none rests on a table being empty. The admin's lists, streaming and cache tags are well made: the waste is in the shell and the home screens, and it is paid per owner tab and per save, so it grows with stores and owners, not with data. Folder: `admin-server/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [AD-1](admin-server/AD-1.md) ✓ | The store menu is rebuilt with 220 slow permission lookups on every shell render | eager | P0 | S | 0.17 |
| [AD-7](admin-server/AD-7.md) ✓ | The products list reads the whole editor context and a per-product check it does not need | oversize | P0 | S | 0.19 |
| [AD-9](admin-server/AD-9.md) ✓ | Progress polls redraw the whole admin, and a notice poll runs in every visible owner tab | eager | P0 | S | 0.17 |
| [AD-12](admin-server/AD-12.md) ✓ | Nothing counts what a screen costs the server, so the Home grew to 30 statements unseen | no check | P0 | M | 1.9 |
| [AD-13](admin-server/AD-13.md) | At least 39 saves draw the whole route twice: the action redraws it, then the browser asks again | duplicate | P0 | S | 0.18 |
| [AD-2](admin-server/AD-2.md) ✓ | The store Home runs 29 or more statements before it shows anything, one of them for nothing | eager | P1 | M | 2.32 |
| [AD-3](admin-server/AD-3.md) ✓ | Every admin request from a session without two-step calls Supabase Auth | eager | P1 | S | 2.33 |
| [AD-4](admin-server/AD-4.md) ✓ | The store shell reads one thing after another, and checks Stripe set-up on every render | eager | P1 | S | 2.32 |
| [AD-5](admin-server/AD-5.md) ✓ | Every save and poll re-sends 51 to 66 KB of unchanged shell words and menu | oversize | P1 | M | 2.28 |
| [AD-10](admin-server/AD-10.md) ✓ | Three lists load everything; the customers list also groups every order before it cuts to 100 | oversize | P1 | M | 0.19 |
| [AD-14](admin-server/AD-14.md) | The pages and articles lists read and check every page's whole content, twice, to show a title and a state | oversize | P1 | M | 2.17 |
| [AD-6](admin-server/AD-6.md) ✓ | The platform Home holds its first paint for 18 statements and reads whole lists to show a number | oversize | P2 | S | 4.4 |
| [AD-8](admin-server/AD-8.md) ✓ | An account's memberships are read two to four times per request, in four shapes | duplicate | P2 | M | 2.32 |
| [AD-11](admin-server/AD-11.md) ✓ | The orders list re-reads store facts it already holds and waits in a row for the count | duplicate | P2 | S | 4.4 |
| [AD-15](admin-server/AD-15.md) | The Payments settings page reads one table three or four times and waits on Stripe and Mollie before it paints | eager | P2 | S | 4.4 |

## The server code every route loads (SG)

One import cycle of 229 files in src/server makes 181 of 268 route handlers, 559 of 562 pages and the proxy each load about 10 MB of server code (the AI manager's tools, the admin's whole text in two languages, the schema, Stripe, sharp): a fat route takes 0.9 to 1.3 s and 97 MB of heap to load cold on this machine against 0.16 to 0.24 s and 26 MB for /api/health, and every instance first pays 0.27 to 0.30 s for a start hook and about 0.09 s to read a 10.4 MB list of server references. None of it depends on what a store uses, so it grows with stores, traffic and the deploy on every push once the platform opens. Folder: `server-module-graph/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [SG-3](server-module-graph/SG-3.md) ✓ | The visit beacon and 52 other routes import the chat agent to get a ten-line function | eager | P0 | S | 0.4 |
| [SG-1](server-module-graph/SG-1.md) ✓ | One import cycle of 229 server files makes almost every route load everything | eager | P0 | S | 0.6 |
| [SG-6](server-module-graph/SG-6.md) ✓ | schema.ts (19,614 lines) is evaluated in every function and used by none at run time | dead | P0 | S | 0.4 |
| [SG-5](server-module-graph/SG-5.md) ✓ | Every instance start loads 856 modules and queries the database before the first request | eager | P0 | S | 0.8 |
| [SG-4](server-module-graph/SG-4.md) ✓ | The admin's whole interface text, both languages, loads wherever one word is needed | oversize | P0 | S | 2.25 |
| [SG-14](server-module-graph/SG-14.md) ✓ | Nothing measures or limits the server graph, so it only grows | no check | P0 | S | 1.8 |
| [SG-15](server-module-graph/SG-15.md) ✓ | The admin shell loads the AI manager's whole engine on every admin page | eager | P1 | S | 0.5 |
| [SG-18](server-module-graph/SG-18.md) | Eighteen modules import the payment settings file for a three-line key reader, and the Stripe SDK comes with it | eager | P1 | S | 0.6 |
| [SG-17](server-module-graph/SG-17.md) | The page renderer imports the theme store's server code for every page of every store | eager | P1 | S | 0.6 |
| [SG-2](server-module-graph/SG-2.md) ✓ | The proxy that runs before every store page loads the whole graph | eager | P1 | M | 2.20 |
| [SG-7](server-module-graph/SG-7.md) ✓ | The sharp image library is loaded at cold start by routes that never touch a picture | eager | P1 | S | 0.5 |
| [SG-16](server-module-graph/SG-16.md) | Every cold function reads a 10.4 MB list of server references before its first request | oversize | P2 | S | 1.8 |
| [SG-10](server-module-graph/SG-10.md) ✓ | The AI manager's tool catalogue is converted to JSON Schema at import, on routes with no AI | eager | P2 | S | 0.5 |
| [SG-11](server-module-graph/SG-11.md) ✓ | The build writes the same server chunks many times: 124 MiB of 196 MiB is repeats | duplicate | P2 | S | 4.5 |
| [SG-8](server-module-graph/SG-8.md) ✓ | Reader and writer share a file, so a new import between features re-joins reads to writes | no check | P2 | L | 2.20 |
| [SG-13](server-module-graph/SG-13.md) ✓ | The 13 MB taxonomy is traced into every function, including those that cannot read it | oversize | P3 | S | 2.23 |
| [SG-9](server-module-graph/SG-9.md) ✓ | getStore() imports the Stripe SDK to learn which payment modes have keys | eager | P3 | S | 2.22 |
| [SG-12](server-module-graph/SG-12.md) ✓ | Four storefront languages are imported for every server route; a request needs one | eager | P3 | M | tolerated |

## Server functions: size, cold start, per-request overhead (SF)

One import cycle of 229 server modules makes 559 of 562 pages, 181 of 268 route handlers and the proxy load the same 11 MB of server code: re-measured in this pass, such an entry needs 0.84 to 1.09 s and 71 to 83 MB to start where a route outside the cycle needs 0.16 s and 14 MB, and a start hook adds 0.33 s before any request. None of this rests on a feature being unused; every store pays it after each deploy (90 commits to main on 11 November), on scale-out and after idle, and it grows at opening as many quiet stores meet cold instances. Folder: `server-functions/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [SF-1](server-functions/SF-1.md) ✓ | One import cycle makes nearly every function load the whole application | eager | P0 | M | 0.6 |
| [SF-3](server-functions/SF-3.md) ✓ | Every instance waits on a start hook that loads 2.3 MB of unrelated code before it asks the database for the interface texts | eager | P0 | S | 0.8 |
| [SF-4](server-functions/SF-4.md) ✓ | The visit beacons load the whole application because of one re-exported helper | eager | P0 | S | 0.4 |
| [SF-5](server-functions/SF-5.md) ✓ | The admin's words in both languages are loaded by almost every function, shoppers' pages included | eager | P0 | S | 0.7 |
| [SF-6](server-functions/SF-6.md) ✓ | The Drizzle schema is built at every start though no code reads it | eager | P0 | S | 0.4 |
| [SF-7](server-functions/SF-7.md) ✓ | Nothing counts what a server entry loads, so the cycle grew unseen | no check | P0 | S | 1.8 |
| [SF-2](server-functions/SF-2.md) ✓ | The proxy runs before every page and prefetch, and loads the whole application to do six small reads | eager | P1 | M | 2.20 |
| [SF-9](server-functions/SF-9.md) ✓ | sharp, a font parser and Supabase's client load at start in functions that draw no picture, and every reader of a store loads the Stripe SDK | eager | P1 | S | 0.5 |
| [SF-12](server-functions/SF-12.md) | The list of every store's own domains is parsed again for every link a page draws | eager | P1 | S | 0.20 |
| [SF-13](server-functions/SF-13.md) | Every store's own domain is compiled into each deployment: routing rules against a cap of 2,048, and a full redeploy per change *(your choice)* | eager | P1 | L | 2.35 |
| [SF-8](server-functions/SF-8.md) ✓ | 13 MB of taxonomy JSON rides in every function, and a shopper's product page parses it to show one category | oversize | P2 | M | 2.23 |
| [SF-10](server-functions/SF-10.md) ✓ | Nine full-application functions are called every minute, and before opening they find nothing to do | eager | P3 | M | 3.1 |
| [SF-11](server-functions/SF-11.md) ✓ | The build writes the same large server chunks many times | duplicate | P3 | S | 4.5 |

## Caching and rendering (CA)

The caching code is sound, not bloated: 85 cached reads in 49 files, 82 tagged, tags per store, and Kaizena Flow's own site and docs truly static. What is left is rendering that runs per request for little, and it grows with shoppers and stores, not with any unused feature: every store page view runs a render function, and on home, built and blog pages its only job is two cart badges and a country hint (97,919 of the demo home's 138,523 bytes); one Add to cart redraws the whole page and re-fetches 15 links (193 KB, measured); Bing, Google's shop and ads crawlers and every link preview get a full render even of the 508 static pages; and links prefetch pages nobody opens (11 to 50 requests a store page, 23 to 46 an admin screen). Folder: `caching/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CA-3](caching/CA-3.md) ✓ | To read one page, the code loads every published page with its whole content | oversize | P0 | M | 0.24 |
| [CA-4](caching/CA-4.md) ✓ | Language and currency links prefetch whole front pages that their click never opens | eager | P0 | S | 0.12 |
| [CA-5](caching/CA-5.md) ✓ | Each admin screen prefetches 13 to 22 other screens, and the storefront, on sight | eager | P0 | S | 0.13 |
| [CA-11](caching/CA-11.md) ✓ | One store owner saving their AI key marks every page of every store stale | oversize | P0 | S | 0.21 |
| [CA-16](caching/CA-16.md) | Nothing holds what is static: one cookie read in a shared part can move every store page to per-request, and no check would say so | no check | P0 | S | 1.11 |
| [CA-1](caching/CA-1.md) ✓ | Every store page view runs a render function, to place two cart badges and a country hint | eager | P1 | M | 2.4 |
| [CA-2](caching/CA-2.md) ✓ | Cached reads and built pages live in one instance and one deploy; each deploy empties them for every store *(your choice)* | no check | P1 | M | 3.19 |
| [CA-6](caching/CA-6.md) ✓ | A prefetch loop on listing and search pages at /s/{store} addresses | eager | P1 | M | 0.14 |
| [CA-15](caching/CA-15.md) | Bing, Google's shop and ads crawlers and every link preview get a full render of every page, static ones included | eager | P1 | S | 2.5 |
| [CA-17](caching/CA-17.md) | One Add to cart redraws the whole page and re-fetches every prefetched link, to change one number | eager | P1 | S | 2.4 |
| [CA-7](caching/CA-7.md) ✓ | partialPrefetching is unset: Next treats it as off, warns on every build and start, and will remove the choice | no check | P2 | S | 0.14 |
| [CA-9](caching/CA-9.md) ✓ | The same one-line store lookup is written 27 times, and three tiny facts are asked of the database about 11,000 times a day by scheduled work | duplicate | P2 | S | 0.20 |
| [CA-10](caching/CA-10.md) ✓ | Pages are rebuilt every hour and dropped after a quiet day, though every write already refreshes a tag | eager | P2 | S | 2.15 |
| [CA-13](caching/CA-13.md) ✓ | The theme store's list needs a function per view and draws the list twice; a theme's neighbours reload every theme's snapshot | eager | P2 | S | 0.20 |
| [CA-8](caching/CA-8.md) ✓ | A store's robots.txt, sitemap, llms.txt, blog feed and favicon answer with no HTTP cache | eager | P3 | S | tolerated |
| [CA-12](caching/CA-12.md) ✓ | A per-instance poll every minute and a five-minute prune that could run far less often | eager | P3 | S | 0.8 |

## The page builder's model and a built page's render (PM)

The page model itself is lean: a stored page is about 340 bytes a block and a two-block page's own markup is 1.6 KB. The waste is in how pages are read, cached and wrapped: every storefront document carries the layout twice (27 KB), 45 of the demo store's 261 built entries keep a copy of every page of the store to find one page or one title, and all 261 carry one cache tag, so publishing one page makes the whole store's site render again. Folder: `page-builder-model/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [PM-2](page-builder-model/PM-2.md) ✓ | Finding one page, or a title, loads every published page of the store with its whole content | oversize | P0 | M | 0.24 |
| [PM-3](page-builder-model/PM-3.md) ✓ | The five-minute knowledge job reads and parses every published page of every site with chat on, and re-cuts wordless pages for ever | eager | P0 | S | 0.27 |
| [PM-4](page-builder-model/PM-4.md) ✓ | Page reads filter the owner with `is not distinct from`, which no index can serve | oversize | P0 | S | 0.23 |
| [PM-11](page-builder-model/PM-11.md) ✓ | A product page's first scripts carry the cart's parts through one import, and every built page a few parts it does not hold | eager | P0 | S | 0.16 |
| [PM-14](page-builder-model/PM-14.md) ✓ | No budget sees a realistic built page, the document's size or a list that reads whole pages | no check | P0 | S | 1.3 |
| [PM-1](page-builder-model/PM-1.md) ✓ | Every storefront page renders and ships the whole layout twice, because the cart drawer's slot sits on the root layout | duplicate | P1 | M | 2.2 |
| [PM-5](page-builder-model/PM-5.md) ✓ | The admin's page lists, pickers and AI tools read and parse the draft and the published copy of every page to show titles | oversize | P1 | S | 2.17 |
| [PM-6](page-builder-model/PM-6.md) ✓ | Facts about a page are dug out of its JSON on each read; the table has no column for them | eager | P1 | M | 2.16 |
| [PM-8](page-builder-model/PM-8.md) ✓ | A product grid with Filter and sort is sent twice when nothing is chosen | duplicate | P1 | M | 2.12 |
| [PM-10](page-builder-model/PM-10.md) ✓ | The page editor's document carries 277 KB of interface text inline | oversize | P1 | S | 2.27 |
| [PM-15](page-builder-model/PM-15.md) | One cache tag covers all of a store's pages: publishing one page, or describing one picture, makes every built page of the store render again | eager | P1 | M | 2.14 |
| [PM-9](page-builder-model/PM-9.md) ✓ | Every read of a stored page runs the editor's whole input schema and the old-shape upgrades | eager | P2 | M | 3.17 |
| [PM-12](page-builder-model/PM-12.md) ✓ | The page renderer and the page reader pull in the code for saving pages and most of the server | eager | P2 | L | 2.21 |
| [PM-16](page-builder-model/PM-16.md) | A product's layout is cached once per product, whole | duplicate | P2 | S | 2.14 |
| [PM-7](page-builder-model/PM-7.md) ✓ | Each row repeats the same stylesheet text in the payload and the same cached store lookups | duplicate | P3 | S | 2.3 |
| [PM-13](page-builder-model/PM-13.md) ✓ | Some block types overlap; whether to merge them is a product choice, not waste *(your choice)* | duplicate | P3 | M | your choice |

## Scheduled and background work (CR)

Scheduled work is a fixed floor today, not a load: Supabase calls the app 13,250 times a day and those calls send about 170,000 statements, nearly all finding nothing because the platform is not open, so no feature here should be retired for being unused. The one measured waste is pg_cron's own run log, never pruned: 564 MB, 77% of the 731 MB database, fixed by one small migration (CR-5). Folder: `scheduled-work/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CR-4](scheduled-work/CR-4.md) ✓ | AI upkeep re-reads whole catalogues, sites and libraries every five minutes to learn nothing changed | eager | P0 | M | 0.28 |
| [CR-5](scheduled-work/CR-5.md) ✓ | pg_cron's own run log is never pruned and is 77% of the database | dead | P0 | S | 0.25 |
| [CR-1](scheduled-work/CR-1.md) ✓ | Nine routes are called every minute whether or not anything waits | eager | P1 | M | 3.1 |
| [CR-2](scheduled-work/CR-2.md) ✓ | The dispatcher runs all 83 jobs every five minutes: one cadence for everything, one ledger write per job, five connections | eager | P1 | M | 3.3 |
| [CR-3](scheduled-work/CR-3.md) ✓ | The marketing and autopilot minute routes: 28 idle statements a minute now, and per-store, per-order work every minute once a feature is on | eager | P1 | M | 3.2 |
| [CR-6](scheduled-work/CR-6.md) ✓ | The cookie scan's due check reads every site every minute without a usable index, and failing sites are retried hourly ahead of healthy ones | eager | P1 | S | 0.23 |
| [CR-9](scheduled-work/CR-9.md) ✓ | The invoice job re-asks the same waiting stores every five minutes, with no back-off and no order | eager | P1 | S | 0.30 |
| [CR-14](scheduled-work/CR-14.md) ✓ | Nothing limits or measures scheduled work, so each feature adds a poll | no check | P1 | S | 3.3 |
| [CR-15](scheduled-work/CR-15.md) | The listings' check hashes every product on the platform every five minutes, and a listing the AI cannot answer for is asked again every run at the head of the queue | eager | P1 | S | 0.29 |
| [CR-7](scheduled-work/CR-7.md) ✓ | The theme-shots route rebuilds its whole wanted list every minute | eager | P2 | S | 3.1 |
| [CR-8](scheduled-work/CR-8.md) ✓ | Kaizena Flow's own payouts are read from Stripe every five minutes | eager | P2 | S | 3.3 |
| [CR-10](scheduled-work/CR-10.md) ✓ | The docs search index is rewritten row by row on every docs change | oversize | P2 | S | 3.5 |
| [CR-11](scheduled-work/CR-11.md) ✓ | An unscheduled PDF route is deployed with Chromium, and a 'finished' backfill is still fed by every copied AI picture | dead | P2 | S | 3.7 |
| [CR-12](scheduled-work/CR-12.md) ✓ | The daily job is scheduled twice, at the same minute | duplicate | P2 | S | 1.22 |
| [CR-16](scheduled-work/CR-16.md) | Six more five-minute jobs re-check every store that has the feature on, and the ledger's order never rotates | eager | P2 | M | 3.6 |
| [CR-17](scheduled-work/CR-17.md) | The daily job runs about 40 functions in one request under one ledger row, so a prune that fails is not seen | no check | P2 | M | 3.4 |
| [CR-13](scheduled-work/CR-13.md) ✓ | Status checks are kept raw for 91 days though the page shows one bar a day | oversize | P3 | S | tolerated |

## How data is asked for (DQ)

All 14 verified findings stand, none argues from a feature being unused, and each now has ordered steps, the tests and rules that hold it, and one check; two were added. Today's cost is small (the listed app statements total about 39 minutes of database time in 78 days) because production holds only the team's demo stores, so what counts before opening is shape: one read fetches every published page whole to find one page (79,778 calls, 781 s), 122 store filters are written so the store index cannot serve them, the five-minute dispatcher starts 78 jobs on 5 connections, and 91,200 of 216,877 transactions deleted nothing. Folder: `queries/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DQ-2](queries/DQ-2.md) ✓ | Every published page is read whole to find one page or a few titles | oversize | P0 | M | 0.24 |
| [DQ-4](queries/DQ-4.md) ✓ | Each request for an AI connection sums the store's whole month of AI usage | eager | P0 | S | 0.21 |
| [DQ-6](queries/DQ-6.md) ✓ | The knowledge job reads every page whole every five minutes and re-cuts pages that have no text, forever | eager | P0 | S | 0.27 |
| [DQ-8](queries/DQ-8.md) ✓ | "is not distinct from" on store_id keeps the index from serving the hottest reads, so they scan all stores' rows | oversize | P0 | S | 0.23 |
| [DQ-9](queries/DQ-9.md) ✓ | The store's slug is looked up by id again and again: the most-called statement in production | duplicate | P0 | S | 0.20 |
| [DQ-11](queries/DQ-11.md) ✓ | Nothing counts queries: no budget per page or per tick, and production's statement statistics are not part of any routine | no check | P0 | M | 1.10 |
| [DQ-1](queries/DQ-1.md) ✓ | Nine routes are called every minute whether or not there is work, and one of their questions grows with the number of stores | eager | P1 | M | 3.1 |
| [DQ-3](queries/DQ-3.md) ✓ | "Where is this picture used" scans every page's text for each picture, and the job re-checks every picture daily | eager | P1 | M | 0.28 |
| [DQ-5](queries/DQ-5.md) ✓ | The five-minute dispatcher starts 78 jobs at once on 5 connections, and several redo work on every tick that grows with the number of stores | eager | P1 | M | 3.3 |
| [DQ-7](queries/DQ-7.md) ✓ | A page's frame asks about 20 questions each time its cache is cold, some of them one per feature for every store, and the cache is cold far more often than the code assumes | eager | P1 | M | 2.18 |
| [DQ-15](queries/DQ-15.md) | Five document jobs find their due work by re-checking every store's recent orders, invoices and refunds on each tick | eager | P1 | M | 3.6 |
| [DQ-10](queries/DQ-10.md) ✓ | Some reads fetch whole JSON documents where a field, a card or a count is needed | oversize | P2 | M | 4.4 |
| [DQ-12](queries/DQ-12.md) ✓ | Every server instance reads the interface translations before it serves and polls them each minute | eager | P2 | S | 0.8 |
| [DQ-13](queries/DQ-13.md) ✓ | 341 loops hold a database call in their body; the ones that matter are jobs that loop over sites | eager | P2 | M | tolerated |
| [DQ-14](queries/DQ-14.md) ✓ | 387 list reads have no limit by a heuristic count; a handful read a whole store's documents or samples | oversize | P2 | M | 2.19 |
| [DQ-16](queries/DQ-16.md) | The catalogue's listing reads call a VAT function and an alt-text function once per product row, and Postgres cannot fold them into the query | oversize | P2 | S | 2.19 |

## The database's shape (DS)

The database's shape is sound for a platform about to open: dead objects are rare (1 table, 5 columns, 34 leftover tables), triggers are gated by column and nearly every log has a retention rule; that 245 of 486 tables have held no row says only that the doors are still closed, and nothing is retired for it. What is worth fixing before opening is where cost does not follow use or grows with stores: pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it, every cold start evaluates a 1 MB schema file that no query uses (115 to 135 ms and 9 to 12 MB measured), 122 store filters are written so the store index cannot serve them, and page lists read whole documents (4.2 ms a call against 0.8 ms from a plain column, measured in a local Postgres 18). Folder: `database-shape/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DS-8](database-shape/DS-8.md) ✓ | pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it | oversize | P0 | S | 0.25 |
| [DS-1](database-shape/DS-1.md) ✓ | Every server start loads the whole schema file, which no query uses | eager | P0 | S | 0.4 |
| [DS-7](database-shape/DS-7.md) ✓ | `store_id is not distinct from` keeps Postgres from using the store indexes | oversize | P0 | M | 0.23 |
| [DS-15](database-shape/DS-15.md) | Indexes are declared in two places and nothing compares them, which is how duplicates reached orders and order_lines | no check | P1 | S | 0.26 |
| [DS-9](database-shape/DS-9.md) ✓ | Thirteen indexes duplicate another; orders carries 34, five of them starting (store_id, placed_at) | oversize | P1 | S | 0.26 |
| [DS-4](database-shape/DS-4.md) ✓ | A page's title, its titles by language and its flags live only inside its content JSON, so lists read and parse whole pages | oversize | P1 | M | 2.16 |
| [DS-5](database-shape/DS-5.md) ✓ | The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date | eager | P1 | M | 0.27 |
| [DS-10](database-shape/DS-10.md) ✓ | Where each picture is used is found by text-searching every page's JSON, again every day for every picture | eager | P1 | S | 0.28 |
| [DS-3](database-shape/DS-3.md) ✓ | Two scheduled jobs do work that does not follow use: a prune every minute and an invoice retry every five minutes for 120 days | eager | P1 | S | 0.30 |
| [DS-13](database-shape/DS-13.md) ✓ | Retention gaps: carts and processed webhook events are never deleted, the status prune scans on every tick, and the docs index is rewritten whole *(your choice)* | oversize | P1 | M | 3.5 |
| [DS-12](database-shape/DS-12.md) ✓ | Nothing counts what a new table, trigger, index or scheduled job adds to the running cost *(your choice)* | no check | P1 | S | 1.18 |
| [DS-6](database-shape/DS-6.md) ✓ | Kaizena Flow's own site and tools are kept more than one way: null-store rows, platform_* twin tables, and a copy in its own store *(your choice)* | duplicate | P1 | L | 3.9 |
| [DS-2](database-shape/DS-2.md) ✓ | Each server start waits for a read of the interface-text table, and every warm instance asks again each minute | eager | P2 | S | 0.8 |
| [DS-14](database-shape/DS-14.md) ✓ | A very short list of dead database objects: one table, five columns and a leftover schema | dead | P2 | S | 3.8 |
| [DS-11](database-shape/DS-11.md) ✓ | Ending one sandbox runs at least 800 deletes and holds about 2,100 locks, one pass per store table per round | oversize | P3 | S | 4.4 |

## What every AI call carries (AI)

The shopper chat is lean (about 5,000 characters of prompt and tools a call); the AI manager is the heavy part: about 161,700 characters a call (roughly 40,400 tokens, an estimate at 4 characters a token), 91% of it 124 tool definitions that do not depend on the question, on up to 11 calls a turn. A lean default drawn with the app's own functions is 48,600 characters on Home and 77,000 on an orders page; it is already step 3.18 of the code review, still Open, and the eval meant to guard it does not test whether the model finds a tool (9 manager cases, none uses load_tools), so that check comes first. Folder: `ai-calls/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [AI-4](ai-calls/AI-4.md) ✓ | The owner's browser downloads the model's whole tool catalogue and admin map | oversize | P0 | S | 0.11 |
| [AI-1](ai-calls/AI-1.md) ✓ | Every AI manager call sends 124 tool definitions, whatever the question or screen *(your choice)* | eager | P1 | M | 2.36 |
| [AI-2](ai-calls/AI-2.md) ✓ | The AI connection is fetched, key and month's cost included, by screens and polls that only draw a button | eager | P1 | S | 0.21 |
| [AI-3](ai-calls/AI-3.md) ✓ | Nothing asks for prompt caching or measures it, and the store is charged the full price either way | eager | P1 | M | 2.38 |
| [AI-5](ai-calls/AI-5.md) ✓ | The knowledge, product and picture index jobs rescan per store to find nothing | eager | P1 | M | 0.28 |
| [AI-6](ai-calls/AI-6.md) ✓ | The autopilot's, follow-ups' and saved-skills' tools ride on every AI manager round *(your choice)* | eager | P1 | S | 2.36 |
| [AI-10](ai-calls/AI-10.md) ✓ | Nothing limits how large an AI call may grow | no check | P1 | S | 1.19 |
| [AI-13](ai-calls/AI-13.md) | The alt-text job walks every site that has an AI-written alt text, every five minutes, and retries a failed picture every day with no end | eager | P1 | S | 0.28 |
| [AI-14](ai-calls/AI-14.md) | The agents' eval cannot tell whether the model finds a tool, so the default tool set cannot be lowered safely | no check | P1 | S | 1.19 |
| [AI-7](ai-calls/AI-7.md) ✓ | One text model does every job, small ones included | oversize | P2 | M | 2.39 |
| [AI-8](ai-calls/AI-8.md) ✓ | Tool schemas say more than the model needs | oversize | P2 | M | 2.37 |
| [AI-9](ai-calls/AI-9.md) ✓ | A turn does needless work before the first model call | eager | P2 | S | 2.36 |
| [AI-11](ai-calls/AI-11.md) ✓ | The prompt lists every playbook and the admin map, whatever the store or the kind of turn | eager | P2 | S | 2.36 |
| [AI-12](ai-calls/AI-12.md) ✓ | Every open admin tab asks for AI manager notices once a minute | eager | P2 | S | 2.34 |

## Interface text (TX)

The words themselves are in good order: 2,003 storefront keys in four languages and 29,040 admin texts in two, none missing, and only 34 keys nothing reads (0.1%). The bloat is in how they are loaded. Folder: `interface-text/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [TX-4](interface-text/TX-4.md) ✓ | The page builder's whole English catalogue loads on every signed-in admin screen, for a default nobody uses | eager | P0 | S | 0.9 |
| [TX-5](interface-text/TX-5.md) ✓ | Every visitor loads the purposes of all known cookies in four languages | eager | P0 | S | 0.16 |
| [TX-1](interface-text/TX-1.md) ✓ | Every server instance, and the proxy, evaluates all 134 admin catalogue files and all four storefront languages when it starts | eager | P1 | M | 0.7 |
| [TX-2](interface-text/TX-2.md) ✓ | Admin pages hand whole areas of words to the browser in every document | oversize | P1 | M | 2.27 |
| [TX-3](interface-text/TX-3.md) ✓ | A store in an AI-translated language would send the whole catalogue of 1,673 texts in every document | oversize | P1 | S | 0.8 |
| [TX-7](interface-text/TX-7.md) ✓ | The page builder and the draft-order editor load all four storefront languages | eager | P1 | M | 2.29 |
| [TX-8](interface-text/TX-8.md) ✓ | A shopper's scripts carry the admin's shared words, and three browser languages they do not read | eager | P1 | S | 0.16 |
| [TX-9](interface-text/TX-9.md) ✓ | Nothing measures where the words go, so each of the leaks above could return | no check | P1 | M | 1.4 |
| [TX-11](interface-text/TX-11.md) ✓ | 34 texts that no code reads | dead | P2 | S | 0.36 |
| [TX-12](interface-text/TX-12.md) | Every instance start reads every AI-translated language whole, one after another, and builds it before the first request | eager | P2 | S | 0.8 |
| [TX-6](interface-text/TX-6.md) ✓ | Every server instance asks the table of AI translations every minute, whether or not it serves such a language | eager | P3 | S | 0.8 |
| [TX-10](interface-text/TX-10.md) ✓ | English refusals are kept twice and matched back to their Norwegian by regular expression | duplicate | P3 | M | tolerated |

## The product's surface (FT)

The surface is large (560 pages, 110 store links, 254 AI manager tools, 83 five-minute jobs, 481 tables) but it is built with care: a new shop's default Basic view has 29 links, no admin screen is orphaned, and a feature a store does not use costs it close to nothing in the navigation, an AI round or scheduled work. One place breaks that and is cheap to fix before shoppers arrive: the cart page works out the whole basket twice per view (at least 14 statements too many), and every basket spends 5 statements learning that bonus, referrals and checkout rules are not in use. Folder: `features/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [FT-15](features/FT-15.md) | The cart page works out the whole basket twice per view, and every basket asks the database about bonus, referrals and checkout rules whether or not the store uses them | eager | P0 | S | 0.22 |
| [FT-8](features/FT-8.md) ✓ | Order rules ('Automation') and Workflows are two engines for one job *(your choice)* | duplicate | P1 | M | 3.11 |
| [FT-5](features/FT-5.md) ✓ | Kaizena Flow's site is kept twice since the switch of 7 November | duplicate | P1 | M | 3.9 |
| [FT-2](features/FT-2.md) ✓ | Nothing makes a new feature state what it costs a store that does not use it *(your choice)* | no check | P1 | S | 1.18 |
| [FT-4](features/FT-4.md) ✓ | The AI manager sends up to 124 tool definitions a round whatever the store uses; gating tools by feature would not lower that | eager | P1 | M | 2.36 |
| [FT-3](features/FT-3.md) ✓ | Nine dispatcher jobs only prune old rows and run 288 times a day, and two run logs are pruned every minute | eager | P2 | S | 0.31 |
| [FT-12](features/FT-12.md) ✓ | An owner's own look can be kept in two places: saved themes and the theme library *(your choice)* | duplicate | P2 | S | 3.12 |
| [FT-7](features/FT-7.md) ✓ | What a new owner sees: 29 links in Basic, 94 in Advanced, 35 under Settings. A product question, mostly planned already *(your choice)* | oversize | P2 | M | your choice |
| [FT-1](features/FT-1.md) ✓ | Most features have no switch; adding more is a product choice, because a switch saves almost no running cost *(your choice)* | eager | P3 | S | tolerated |
| [FT-9](features/FT-9.md) ✓ | Campaigns and discount codes overlap at their edges; one page is planned, one engine is not worth it *(your choice)* | duplicate | P3 | S | tolerated |
| [FT-10](features/FT-10.md) ✓ | Four store engines have a platform twin with its own tables and runner: about 2,100 lines, built by the owner's own rule *(your choice)* | duplicate | P3 | L | your choice |
| [FT-13](features/FT-13.md) ✓ | Bonus, referrals and creators are three reward models; whether to fold creators into referrals is a product choice *(your choice)* | duplicate | P3 | L | your choice |

## Families and twins (FM)

Copy-paste is not this codebase's problem: 1.5% of code lines sit in 8-line clones and 41 twin pairs were found in 3,974 files, and carriers, payment providers, emails, CSV, PDF and the AI tools each have one core. What matters is two loading faults that every store pays at each cold start whatever it uses: both languages of the admin's words (2.8 MB built) load with 802 of 830 server entries, and three small helpers imported through the chat modules make 11 routes, the four visit beacons and the recommendations beacon among them, load about 11.4 MB of server code each where a beacon needs about 2 MB; both fixes are small and safe and come first, with a server-side import check to hold them. Folder: `families/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [FM-2](families/FM-2.md) ✓ | One import of sameSite through the chat module makes the four visit beacons, and five admin export routes, load the whole server core | eager | P0 | S | 0.4 |
| [FM-14](families/FM-14.md) | Two more public routes load the whole server core for three small helpers: the recommendations beacon and the docs' feedback | eager | P0 | S | 0.4 |
| [FM-1](families/FM-1.md) ✓ | Both languages of the admin's words (2.8 MB built) load with 802 of 830 server entries, the storefront's included | eager | P0 | M | 0.7 |
| [FM-13](families/FM-13.md) ✓ | No check holds server import reach or copies, so heavy imports and twins arrive unseen | no check | P0 | S | 1.17 |
| [FM-3](families/FM-3.md) ✓ | kaizenaflow.com exists twice: the old no-store site is still built and kept beside the store that now serves it *(your choice)* | duplicate | P1 | M | 3.9 |
| [FM-5](families/FM-5.md) ✓ | The parity rule names platform_* tables as the way and does not say when the store's module with a scope is expected *(your choice)* | no check | P1 | S | 3.10 |
| [FM-4](families/FM-4.md) ✓ | The platform's events pipeline is written a second time beside the stores': 26 to 55% of its lines are the stores' own | duplicate | P2 | M | 3.10 |
| [FM-6](families/FM-6.md) ✓ | Five CSV imports repeat the same orchestration, pages and client flow around one shared job core | duplicate | P2 | M | 3.13 |
| [FM-7](families/FM-7.md) ✓ | 1,266 server actions, 50 on the shared wrapper; the count of the rest is not held | duplicate | P2 | L | 1.17 |
| [FM-8](families/FM-8.md) ✓ | Lists, tables, dates and selects are still hand-made per screen, and the counts are not held while the kit waits | duplicate | P2 | L | 1.17 |
| [FM-10](families/FM-10.md) ✓ | Work's combined lists and the account's Domains pages repeat the store's, 29 to 77% the same | duplicate | P2 | M | 3.14 |
| [FM-11](families/FM-11.md) ✓ | Ten small pairs of near-copies, about 840 identical lines | duplicate | P2 | M | 4.2 |
| [FM-9](families/FM-9.md) ✓ | Fiken's sync engine is a copy of Tripletex's: about 250 to 400 identical lines, and no third system is planned | duplicate | P3 | M | 4.2 |
| [FM-12](families/FM-12.md) ✓ | Small helpers are rewritten per file: addDays in 10 files, isUuid in 23, isUniqueViolation in 9 | duplicate | P3 | M | 3.15 |

## Dependencies (DP)

The dependency list is lean, and none of this dimension's case rests on what stores use today: 51 runtime packages, none without an importer, and every heavy browser library loads only on the press that needs it. The cost is in when server code loads: the page-view beacon takes about 1.0 s and 177 MB before its first answer where a lean route takes 0.22 s and 64 MB, and with three small import cuts (DP-10, DP-1, DP-3 step 1) its own code, bundled here, loads in 128-144 ms and 50 MB against 549-590 ms and 158 MB today. Folder: `dependencies/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DP-1](dependencies/DP-1.md) ✓ | 481 table definitions are loaded and indexed in every function for a query API nobody calls | eager | P0 | S | 0.4 |
| [DP-10](dependencies/DP-10.md) ✓ | The page-view beacon loads the whole server through a one-line re-export | eager | P0 | S | 0.4 |
| [DP-4](dependencies/DP-4.md) ✓ | supabase-js, its realtime client and zod are 39% of the first scripts of every admin page | eager | P0 | S | 0.9 |
| [DP-5](dependencies/DP-5.md) ✓ | The rich text editor is sent to 21 admin lists and detail pages that may never show it | eager | P0 | S | 0.10 |
| [DP-11](dependencies/DP-11.md) | Every admin screen loads the AI manager's whole server side through two action files, so the storefront review's cut alone changes nothing for the admin | eager | P1 | S | 0.5 |
| [DP-2](dependencies/DP-2.md) ✓ | sharp's native library and a font parser load on nearly every cold start | eager | P1 | S | 0.5 |
| [DP-6](dependencies/DP-6.md) ✓ | Nothing limits what a route's server function loads, so nearly every route came to load everything | no check | P1 | M | 1.8 |
| [DP-12](dependencies/DP-12.md) | Every route that reads a store builds the whole page model: 468 schemas for a theme's few fields | eager | P2 | M | 2.22 |
| [DP-7](dependencies/DP-7.md) ✓ | Three Chromium routes are woken every minute whether or not there is work | eager | P2 | M | 3.1 |
| [DP-8](dependencies/DP-8.md) ✓ | A 26 MB icon package is installed and parsed each build for 26 paths | oversize | P2 | S | 0.36 |
| [DP-9](dependencies/DP-9.md) ✓ | The existing plan's dependency item (FH12) points at the wrong Postgres driver, and its note on three is incomplete | no check | P2 | S | 0.4 |
| [DP-3](dependencies/DP-3.md) ✓ | The Stripe and Supabase SDKs are evaluated by 97% of routes; reading a store imports the Stripe SDK to see if two keys exist | eager | P3 | M | tolerated |

## Files that ship or are stored (AS)

The files the repo stores are lean (102 MB tracked, all 150 files in public/ referenced, pictures and fonts stored once); the waste is in what every server function carries and in what a browser is sent, and none of it rests on a feature being unused. sharp's native library (19.8 MB) is in 742 of 832 route traces and the taxonomy (13.3 MB) in 831, 33 MB of the median trace's 52.6 MB, and sharp loads at each cold start of the proxy (35 to 57 ms, 22.5 MB) though no shopper's page draws with it. Folder: `files/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [AS-3](files/AS-3.md) ✓ | Nothing checks what a server function carries or what the proxy imports | no check | P0 | S | 1.8 |
| [AS-4](files/AS-4.md) ✓ | Search suggestions ask Next's image service for uploaded pictures and get a 400, so real stores will show empty thumbnails; the service itself is open and unused | dead | P0 | S | 0.32 |
| [AS-9](files/AS-9.md) ✓ | The font file route does not tell the CDN to keep the file, unlike the stylesheet route beside it | eager | P0 | S | 0.32 |
| [AS-10](files/AS-10.md) ✓ | The build's page worker runs with source maps on: about 4.7 MB of heap per MB of server code it loads, and 704 MB of maps written that no function carries | oversize | P0 | S | 1.20 |
| [AS-1](files/AS-1.md) ✓ | The image library (sharp, 19.8 MB) is in 742 of 832 route traces and the proxy's, and loads when the proxy or a route as plain as robots.txt starts | eager | P1 | S | 0.5 |
| [AS-11](files/AS-11.md) | Nothing is kept between 480 and 1600 pixels, so 3x phones and Retina laptops download the 1600 px file for every product tile | oversize | P1 | M | 0.33 |
| [AS-5](files/AS-5.md) ✓ | Flags are downloaded even while the switcher hides them, public files have no cache lifetime, and six flags and two textures are far bigger than their job | eager | P2 | S | 0.32 |
| [AS-8](files/AS-8.md) ✓ | The decisions log is one 1.33 MB file and keeps growing; CLAUDE.md is 43 KB in every agent session | oversize | P2 | M | 2.40 |
| [AS-12](files/AS-12.md) | Videos, 3D models and theme photographs are stored with a one-hour or five-minute cache, though their addresses never change; pictures get a year | eager | P2 | S | 0.32 |
| [AS-2](files/AS-2.md) ✓ | The product taxonomy (13.3 MB of JSON) is traced into every route, the proxy and the health check included | oversize | P3 | M | 2.23 |
| [AS-6](files/AS-6.md) ✓ | The PDF routes carry all of react-dom (8.1 MB) to use two server builds of it | oversize | P3 | S | tolerated |
| [AS-7](files/AS-7.md) ✓ | Tailwind reads 22.5 MB that adds nothing to the CSS today: the test files and the migrations' SQL | dead | P3 | S | 0.35 |

## Code nothing uses (DD)

There is little dead code: about 2,700 lines of 772,000 (0.35%), thin over some 400 files and dropped by the build, and none of it is a feature waiting for opening: it is code with no caller. The one run-time price is the 19,614-line schema that every cold start evaluates for a query builder nobody calls (150 to 190 ms and about 18 MB, measured here): three lines to change, the same fix as DS-1 and DP-1. Folder: `unused-code/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DD-1](unused-code/DD-1.md) ✓ | Every cold start evaluates the 19,614-line schema that no query reads | eager | P0 | S | 0.4 |
| [DD-4](unused-code/DD-4.md) ✓ | Nothing counts unused code, so it grows unseen | no check | P1 | S | 1.17 |
| [DD-3](unused-code/DD-3.md) ✓ | 331 exports are used by nothing at all, and some say they are in use | dead | P1 | S | 0.36 |
| [DD-8](unused-code/DD-8.md) ✓ | Three files only tests reach, and a rule that still describes one of them | dead | P1 | S | 0.36 |
| [DD-2](unused-code/DD-2.md) ✓ | About 330 exports in production files are kept alive only by a test | dead | P2 | M | 4.3 |
| [DD-7](unused-code/DD-7.md) ✓ | English words kept twice: old constants beside the catalogues, held equal by tests | duplicate | P2 | S | 3.15 |
| [DD-5](unused-code/DD-5.md) ✓ | Three Work actions have no screen: a logged time entry's hours cannot be corrected *(your choice)* | dead | P2 | S | your choice |
| [DD-12](unused-code/DD-12.md) ✓ | The invoice-PDF job has a route and a retry button, but nothing ever calls it *(your choice)* | dead | P2 | S | 3.7 |
| [DD-13](unused-code/DD-13.md) | One unit test replays all 789 archived migrations on every run | dead | P2 | S | 0.39 |
| [DD-10](unused-code/DD-10.md) ✓ | Tests that quote or replay migrations no database will run again | dead | P2 | S | 0.39 |
| [DD-11](unused-code/DD-11.md) ✓ | Small things kept from before: old redirects, a twin switch, a second scheduler, an old schema | duplicate | P2 | M | 0.37 |
| [DD-9](unused-code/DD-9.md) ✓ | Upgraders for three old page shapes: almost free to run, still fed by today's code, and pinned by a rule and a spec | dead | P3 | M | 3.17 |
| [DD-6](unused-code/DD-6.md) ✓ | Live drills can only be asked for by hand-written SQL, and their job polls every five minutes *(your choice)* | eager | P3 | S | your choice |

## Copied code (CP)

Copied code is not where this codebase's bloat is, and that holds after a third look: 1.0% of non-test code is an exact copy (4,803 of 472,586 lines) and 4.75% a near-copy with every name and literal normalised; unit and integration tests (1.8% and 3.2%) and the e2e folder (1.7% and 7.4%) are no worse. The fourteen checked findings are true duplicates or missing checks, none rests on a feature being unused, and their corrected savings add up to about 5,500 lines (1.2%); my two additions are small too: about 1,100 to 1,500 test lines of repeated scaffolding (448 integration tests stub a module the test config already stubs) and helpers re-solved under one name (addDays in 10 files, countryName exported from 6 with three different answers for a missing code). Folder: `copied-code/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [CP-2](copied-code/CP-2.md) ✓ | A store's address by its id is looked up by hand in 27 places beside a cached helper that already exists; it is production's most-called statement | duplicate | P0 | S | 0.20 |
| [CP-14](copied-code/CP-14.md) ✓ | Nothing in CI measures copied code, so each new kind or twin is made by copying a neighbour | no check | P0 | S | 1.17 |
| [CP-1](copied-code/CP-1.md) ✓ | Five file imports each repeat the upload, register, start-check, start-apply and cursor code, the browser flow, the findings table, the pages and the routes (leases and retries are already shared) | duplicate | P1 | M | 3.13 |
| [CP-3](copied-code/CP-3.md) ✓ | Admin form fields, tables and loading skeletons are spelled out per file because the UI kit has no piece for them | duplicate | P1 | L | 4.1 |
| [CP-4](copied-code/CP-4.md) ✓ | The platform console has a second engine for workflows, own endpoints and integration deliveries beside the stores' engines *(your choice)* | duplicate | P1 | M | 3.10 |
| [CP-5](copied-code/CP-5.md) ✓ | Work's account-level screens are copies of the store-level ones, and 58 Work actions are wrapped in a seven-line shell | duplicate | P1 | M | 3.14 |
| [CP-7](copied-code/CP-7.md) ✓ | The one wrapper for server actions is marked Done but carries 3 of the admin's 235 action files, and nothing counts the rest | no check | P1 | L | 4.1 |
| [CP-6](copied-code/CP-6.md) ✓ | Tripletex and Fiken are twins: the sync runner, the settings page and the actions | duplicate | P2 | M | 4.2 |
| [CP-8](copied-code/CP-8.md) ✓ | Small helpers are declared again in file after file | duplicate | P2 | S | 3.15 |
| [CP-9](copied-code/CP-9.md) ✓ | Three SQL fragments are typed out in dozens of files: the product title with its fallback, the usage counter and the order event | duplicate | P2 | S | 3.15 |
| [CP-11](copied-code/CP-11.md) ✓ | The affiliate and bonus settings forms are one form written twice | duplicate | P2 | S | 4.2 |
| [CP-12](copied-code/CP-12.md) ✓ | On the storefront an order's totals are drawn in two places (and a third, looser, in checkout) and the product card's query is written twice | duplicate | P2 | S | 3.16 |
| [CP-13](copied-code/CP-13.md) ✓ | English words are kept twice: in a lib module and again in the English catalogue | duplicate | P2 | S | 3.15 |
| [CP-15](copied-code/CP-15.md) | Integration tests repeat their scaffolding: 448 stub a module the config already stubs, next/cache is stubbed in five spellings, and 233 build their own store | duplicate | P2 | S | 4.3 |
| [CP-16](copied-code/CP-16.md) | Day arithmetic, country names and the money label are re-solved under one name in many modules with different bodies; the copy detector sees none of it | duplicate | P2 | S | 3.15 |
| [CP-10](copied-code/CP-10.md) ✓ | Eleven server files hand-write the same claim-with-a-lease statement for their own queue table; ten more use skip locked in other ways | duplicate | P3 | M | tolerated |

## Tests, CI and the build (TC)

The tests are not the bloat: 325,579 lines of tests against 768,202 of source, no snapshots, and the browser suite does not repeat the unit tests (37 of 781 end-to-end tests use no page). The waste is in how the checks run, and it is paid per push whoever uses the platform: one push type-checks the same commit five times (183 s each here, 70% of the build) and builds it four times; every unit test file first loads 1.9 MB of admin English in a fresh worker (a 187-file sample takes 90 s today and 27 s without both); lint re-reads about 6,200 files on one thread (about 3 minutes, 1 s with a cache); and 229 server modules form one import cycle that 12 import lines close. Folder: `tests-ci-build/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [TC-1](tests-ci-build/TC-1.md) ✓ | One push type-checks the same commit five times; three of the checks hide inside CI's builds | duplicate | P0 | S | 0.38 |
| [TC-3](tests-ci-build/TC-3.md) ✓ | Every unit test file loads all the admin's English first, in a worker of its own; 91% cannot use the English | eager | P0 | S | 0.39 |
| [TC-5](tests-ci-build/TC-5.md) ✓ | The 19,614-line Drizzle schema is loaded at run time for a query builder nobody calls | dead | P0 | S | 0.4 |
| [TC-12](tests-ci-build/TC-12.md) | Lint reads all 6,213 files on one thread every time, with no cache: about 3 minutes, and it is on the deploy path | eager | P0 | S | 0.38 |
| [TC-2](tests-ci-build/TC-2.md) ✓ | 229 server modules import each other in one cycle; 12 import lines close it | eager | P1 | M | 0.6 |
| [TC-4](tests-ci-build/TC-4.md) ✓ | The type check is one 8,003-file program: 3 minutes and a 7 GB heap limit, with no single type to blame | oversize | P1 | M | 2.42 |
| [TC-6](tests-ci-build/TC-6.md) ✓ | Every push pays the full checks twice: once by the agent, again by CI *(your choice)* | no check | P1 | S | 2.43 |
| [TC-8](tests-ci-build/TC-8.md) ✓ | Nothing measures the build, the type check, lint or the test run, and the build is at its limit | no check | P1 | S | 1.20 |
| [TC-13](tests-ci-build/TC-13.md) | Each test file that opens the database spends half a second importing Drizzle and the schema, one small module at a time | eager | P1 | S | 0.39 |
| [TC-7](tests-ci-build/TC-7.md) ✓ | Three cold builds per push; the hosts job builds the whole app for 25 tests | duplicate | P2 | M | 3.18 |
| [TC-9](tests-ci-build/TC-9.md) ✓ | CI keeps nothing between runs except pnpm's store | no check | P2 | S | 2.42 |
| [TC-10](tests-ci-build/TC-10.md) ✓ | 86 test files read the source tree with 67 private walkers; two parse every file | duplicate | P2 | S | 4.3 |
| [TC-11](tests-ci-build/TC-11.md) ✓ | The same mocks and store-makers are written out in hundreds of test files | duplicate | P2 | M | 4.3 |
| [TC-14](tests-ci-build/TC-14.md) | A push that changes only tests builds and deploys production again | eager | P2 | S | 0.38 |

## The written rules and the agents' context (DC)

These costs are paid per agent session and grow with every feature built, not with shoppers, so the owner's clarification changes none of them. Every session and every subagent loads 44 KB (about 11,000 tokens, estimate at 4 characters a token); 71% of it is a 295-line index of which a typical change needs 2 to 4 lines, and taking it out saves about 29.5 KB (about 7,400 tokens) each time. Folder: `written-rules/`.

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [DC-1](written-rules/DC-1.md) ✓ | Every session loads a 295-line feature index; a typical change needs 2 to 4 of its lines *(your choice)* | eager | P0 | M | 2.1 |
| [DC-3](written-rules/DC-3.md) ✓ | Nothing caps the written rules, and one test makes the always-loaded file grow with every feature | no check | P0 | S | 1.1 |
| [DC-4](written-rules/DC-4.md) ✓ | Half of the rules' text is in lines the search tool cannot show | oversize | P0 | S | 0.40 |
| [DC-2](written-rules/DC-2.md) ✓ | decisions.md cannot be searched with the harness's search tool, a row runs to 18 KB, and the newest 197 rows sit under the wrong heading | oversize | P1 | M | 2.40 |
| [DC-5](written-rules/DC-5.md) ✓ | CLAUDE.md sends agents to a 73 KB plan written before the platform was multi-tenant | eager | P1 | S | 0.41 |
| [DC-12](written-rules/DC-12.md) | Sessions working at once take the same decision number: 5 of 24 merges in 35 hours renumbered one, twice across 64 and 77 files | no check | P1 | S | 0.41 |
| [DC-6](written-rules/DC-6.md) ✓ | The trackers a fix must consult keep their finished work in the way: the code review's table grows 0.9 KB a step, and 12 open PSI items hide among 93 ticked | oversize | P2 | S | 0.41 |
| [DC-7](written-rules/DC-7.md) ✓ | Dated reports, draft notes, review evidence and generated tables turn up in every docs search | oversize | P2 | S | 0.40 |
| [DC-8](written-rules/DC-8.md) ✓ | A feature's facts are written at four to six levels, in different words; lists copied from code drift | duplicate | P2 | S | 0.41 |
| [DC-10](written-rules/DC-10.md) ✓ | The Migration versions list has been frozen since 4 October, and the instruction to record versions there now fills decision rows with release notes *(your choice)* | dead | P2 | S | 2.41 |
| [DC-13](written-rules/DC-13.md) | A table's definition is in the repo four times, and a search for its name returns more lines from old migrations and Drizzle's snapshot than from code | oversize | P2 | S | 0.40 |
| [DC-9](written-rules/DC-9.md) ✓ | The saved parity-wave workflow asks for specs with no size limit and tells every agent to read them whole; it is dormant | no check | P3 | S | 0.41 |
| [DC-11](written-rules/DC-11.md) ✓ | The parity report commits 270 KB of generated tables beside the rows they are made from *(your choice)* | duplicate | P3 | S | your choice |

