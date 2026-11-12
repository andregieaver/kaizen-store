# Phase 2: Load on demand

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** The structural half: each page, function, document and AI call loads what it uses, when it uses it. Before opening is the cheapest time for it, and phase 1's budgets show each step as a number that falls. **A person will notice:** A store page arrives as a static file with nothing in it twice. A product view asks the database for stock and nothing else. A publish redraws one page, not the whole store. Admin screens hand the browser only the words they show, and the builder paints before its editors load. The AI manager answers on a third of the tokens. A session reads a 10 KB core.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 2.1 Send the store's layout and its fixed style sheets once

The cart drawer's slot (@drawer) sits on the root layout, so every storefront document renders and ships the whole layout twice, with the store's 404 page inside: 35 rows and about 26 KB a document. Move the slot off the root layout and read the cart count once per render. On a screen 768 px or wider the cart link then opens the cart page directly: no drawer rendered and thrown away, and no prefetch of it. Draw the 1,760-byte breakpoint sheet once per document, not once per row (PreviewBreakpoints covers the admin's canvases).

- **Closes:** [SC-8](../findings/storefront-browser/SC-8.md), [PL-2](../findings/page-payload/PL-2.md), [PM-1](../findings/page-builder-model/PM-1.md), [CS-5](../findings/styles/CS-5.md), [SC-7](../findings/storefront-browser/SC-7.md), [PF-7](../findings/prefetching/PF-7.md), [CS-4](../findings/styles/CS-4.md), [PM-7](../findings/page-builder-model/PM-7.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** The served /s/demo/no document opens one html element in its inline payload (two today), holds under 2,000 bytes of duplicate rows (26,534 today) and is under 112,000 bytes raw (138,523); the theme sheet's and the breakpoint sheet's hrefs each appear 2 times, whatever the number of rows; and at 1280 px a press on the cart link makes one document request and no router request for /cart, all held in e2e/performance.spec.ts and e2e/cart.spec.ts.
- **Platform:** Kaizena Flow's own store pages carry the same layout and lose the same second copy; / and /admin already send one.

## 2.2 Serve store pages with nothing per visitor as static files, and let Add to cart answer a number

Every prerendered store page is 'resuming': a render function runs on each view to place two cart badges and a country hint. One small per-visitor answer (src/app/api/shop/mine/route.ts: the cart count, the saved ids and the hint), asked only when a marker cookie says there is something, lets home, built, blog and info pages become static. addToCart returns the new count and drops its refresh(), so one press no longer redraws the page and re-fetches every prefetched link. After opening, count page runs by user agents on Next's bot list in Vercel's logs; if the share is not small, narrow htmlLimitedBots so crawlers get the cached page.

- **Closes:** [CA-1](../findings/caching/CA-1.md), [CA-17](../findings/caching/CA-17.md), [CA-15](../findings/caching/CA-15.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; What a shopper's browser gets.
- **Done when:** After pnpm build, .next/prerender-manifest.json gives compute 'static' for /s/demo/no, /s/demo/no/om-oss and the blog routes (all 'resuming' today), held in scripts/render-modes.baseline.json, and e2e/cart.spec.ts shows the Add to cart answer carrying the count with no redraw of the route.
- **Platform:** Kaizena Flow's front page, served from its own store, becomes a static file with the rest; its baseline entry from step 0.2 moves to static.

## 2.3 Route every link through one wrapper with a stated policy, and keep built pages' presses inside the app

947 links have no stated policy, and 400 files import next/link directly. Three wrappers (a PolicyLink with policy sight, intent or never) make header tools, the bottom bar, footers, menus and closed sub-menus fetch on intent; a ratchet count, directLinks, only lets direct next/link imports fall. Built pages' tiles, buttons and pictures use a BlockLink that stays in the app for an address of the app and keeps the plain anchor for pay paths, files and outside links: a tile press today is a whole document and 42 requests. The first Add to cart then asks again for at most 10 links, not 32.

- **Closes:** [PF-3](../findings/prefetching/PF-3.md), [PF-8](../findings/prefetching/PF-8.md), [PF-12](../findings/prefetching/PF-12.md), [PF-10](../findings/prefetching/PF-10.md), [PF-4](../findings/prefetching/PF-4.md)
- **Effort:** L. **Areas it moves:** What a shopper's browser gets.
- **Done when:** e2e/prefetch.spec.ts passes with at most 6 router prefetch requests on the phone home read to the footer (47 today), 0 documents and at most 8 requests after a tap on a built page's tile (1 and 42 today) and at most 10 after the first add to cart, and pnpm test fails for a new file that imports next/link directly.
- **Platform:** The platform admin and Kaizena Flow's site use the same three wrappers, and the pay-routes graph test still forbids app navigation into a pay path.

## 2.4 Bound what a real listing fetches ahead, and decide partial prefetching by trial

A real listing prefetches every product tile and up to six swatch links under each: about 96 requests for 48 products, and the test stores are too small to show it. Seed a 48-product category and bound it at 20 router requests read to the end, with swatches on intent. Run the partial-prefetching trial on the product page, the seeded listing, the store home and the admin's orders page, and write its table into docs/performance.md and the decision into docs/decisions.md: either all links to one route share one shell, or the first screen of tiles is fetched on sight and the rest on touch. The next major Next release forces the choice.

- **Closes:** [PF-13](../findings/prefetching/PF-13.md), [PL-5](../findings/page-payload/PL-5.md), [PF-9](../findings/prefetching/PF-9.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets.
- **Done when:** e2e/prefetch.spec.ts holds the seeded 48-product category read to the end on a phone at no more than 20 router requests, and docs/performance.md holds the trial's before-and-after table with the decision recorded in docs/decisions.md.
- **Platform:** The trial's fourth page is an admin page, so the choice is made for /admin/platform's lists too.
- **The owner's question first:** On a full listing, may only the first screen of product tiles be fetched ahead on sight, and the rest when touched (or all through one shared product shell)? A yes lets the shopper's browser reach an A.

## 2.5 Let each working route and each recommending grid load its own parts

Listing, search, cart, checkout, account, order, wishlist and cookies pages share one bundle of every working part, 98 KB larger than a built page's. Move the shell of StorePartSection to a server file with no section imports (src/components/store-part-frame.tsx), and give each route a small module that imports its own sections. A store page with a recommending grid downloads 650 KB more once recommendations answer (zod, the page model and all four languages): the grid takes its words as a prop, from the browser files of src/lib/messages.

- **Closes:** [SC-2](../findings/storefront-browser/SC-2.md), [BN-9](../findings/client-bundles/BN-9.md), [BN-16](../findings/client-bundles/BN-16.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets.
- **Done when:** After pnpm build, route-bundle-stats.json shows /category/[slug], /tag/[slug] and /search at or under 715,000 bytes (785,994 today) with at most 37 client modules by the review's route.mjs (54 today), and e2e/recommendations.spec.ts counts at most 335,000 bytes of script after /api/recommendations answers (649,561 today).
- **Platform:** Kaizena Flow's site draws no cart or listing; its blog and theme-store pages already load their own parts, and the baseline of step 1.2 holds them.

## 2.6 Give the storefront a stylesheet of its own, and count what is in it

One 183 KB sheet serves stores, the site, the docs and the admin: 28% of it styles only the admin, and 3,480 of the 5,931 files Tailwind reads can rename it though no public page draws them. Make two Tailwind entries: the site's reads the site's code and the 11 admin parts a public page imports, each named on a line of its own. A script (stylesheet-audiences.mjs) prints the bytes each audience alone names, with a stated tolerance of 15 KB raw of classes no store page can draw; a third entry is weighed only above it. A second script, or a line on Platform, Usage and limits, reports per store the bytes of owner-written style text and the share of pages that need motion.css, with the two trigger lines written into docs/performance.md. No finding covers the two reports; they are what take styles from a B to an A.

- **Closes:** [SC-5](../findings/storefront-browser/SC-5.md), [CS-1](../findings/styles/CS-1.md), [BN-12](../findings/client-bundles/BN-12.md), GAP-styles-2, GAP-styles-3
- **Effort:** M. **Areas it moves:** Styles; What a shopper's browser gets.
- **Done when:** The stylesheet that /s/demo/no links is at most 135,000 bytes raw (183,124 today) with the site budgets lowered to it, src/lib/stylesheet-sources.scan.test.ts passes, the build's peak before and after is in docs/build-memory.md (no more than about 150 MB higher), and docs/performance.md holds the audiences figure and the first style-text reading.
- **Platform:** Kaizena Flow's public site and docs get the site's sheet; the admin, /admin/platform included, keeps its own two.
- **The owner's question first:** After the split, a Tailwind class typed in a part's Advanced tab can show on the builder's canvas and not on the live site. Is it enough to say in the docs that only classes styled by the owner's own CSS are promised, or should the site's sheet keep a short fixed list of utility names owners may type?

## 2.7 Draw a listing's grid once and read its list once

A product grid with Filter and sort is sent twice when nothing is chosen: the built grid is the Suspense fallback and the streamed copy replaces it, so each product is 18 times in the markup and 18 in the payload, and a category asks the database again for the list it already drew. In src/components/content-grid-section.tsx keep the built grid in the shell and stream only the controls and the Show more link; memoise the grid's loader per request.

- **Closes:** [PL-6](../findings/page-payload/PL-6.md), [PM-8](../findings/page-builder-model/PM-8.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page.
- **Done when:** The served /s/demo/no/products document holds each product's data-item-id once in its markup and once in its payload (18 and 18 for 9 products today) and is under 150,000 bytes raw (170,329 today), held in e2e/listing.spec.ts.
- **Platform:** Kaizena Flow's site has no filterable product grid; its grids of articles and themes draw through the same section and are sent once.

## 2.8 Ask the database for stock only on a product view

An anonymous view of a prerendered product sends about 18 statements. One answer, stock, changes per view, and it is read twice. Put what only an owner sets (checkout's look, payment state, checkout fields, quote mode, back in stock, price breaks, producer schemes) in one cached read per store and market, src/server/buy-facts.ts, tagged so its writers refresh it, and carry it in the prerendered page. The buy button then no longer waits for payment facts.

- **Closes:** [SD-2](../findings/storefront-server/SD-2.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The product's surface.
- **Done when:** One anonymous GET of a prerendered goods product on a warm production build commits 3 statements or fewer beyond the proxy's (about 16 today) and reads only the inventory tables, by scripts/server-budget.mjs with its budget at 4.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and has no stock.

## 2.9 Let cached reads follow their tags, and let a publish make only its own page stale

71 of 85 cached reads expire after an hour though every writer refreshes a tag, and home and All products redraw every 15 minutes. Give a read whose every writer refreshes a tag a week's life, and keep the clock only where the answer holds one (the 30-day reference price). One tag, pages:{store}, covers all of a store's pages, so one publish makes all 261 built pages of the demo stale: add page:{id} for reads of one page's document, and cache a product layout once per store, not once per product. The alt-text job refreshes a store's tags once when its queue is empty, then only the pages that hold the picture.

- **Closes:** [SD-8](../findings/storefront-server/SD-8.md), [CA-10](../findings/caching/CA-10.md), [PM-15](../findings/page-builder-model/PM-15.md), [PM-16](../findings/page-builder-model/PM-16.md), GAP-page-model-2
- **Effort:** L. **Areas it moves:** What the server loads and asks; The page builder's model and a built page.
- **Done when:** pnpm build's route table shows no storefront route at 15m (6 today) and .next/prerender-manifest.json shows a store's own pages at 604800, a unit test of the save action with next/cache stubbed sees a body-only publish call updateTag with page:{id} and not pages:{store}, and a unit test of the alt-text route sees at most one store-wide refresh across 10 runs (10 today).
- **Platform:** The platform's pages take page:{id} with a null owner, and the docs routes (251 at 3,600 s today) get the week's life.

## 2.10 Read a cold store page, the cart and the checkout in one wave, with nothing that grows with the catalogue

A cold frame asks about 20 statements, some one after another and one per optional feature whether the store uses it or not; siteCookies() alone asks 8 or 9 in a row. Start the independent reads together, fold the feature questions into one site-facts read, and take menu titles from the page index of step 0.19. No finding covers the catalogue's reads or the cart and checkout, so the plan brings code review steps 3.8 to 3.10 in with numbers: the front page's JSON-LD from a small cached read of handles, a tag per product and a lists tag, and the cart's and checkout's independent reads in one wave. Seed one test store with 500 products, so a read that grows with the catalogue fails a budget.

- **Closes:** [SD-5](../findings/storefront-server/SD-5.md), [SD-9](../findings/storefront-server/SD-9.md), [DQ-7](../findings/queries/DQ-7.md), GAP-server-1
- **Effort:** L. **Areas it moves:** What the server loads and asks; The database; The product's surface.
- **Done when:** scripts/server-budget.mjs counts 20 statements or fewer for the first request of a store's home after a restart (30 to 35 today) and holds cart and checkout in at most two waves; query-budget.int.test.ts counts at most 4 statements for siteCookies() (8 or 9 today); and a cold home and product page of the 500-product store read no more rows than those of a 10-product store.
- **Platform:** Kaizena Flow's own frame (21 statements cold today) is read through the same loaders with a null owner and falls with them.

## 2.11 Turn the proxy's and the page's readers into leaf modules

The proxy runs before every page and prefetch and reaches 1,309 source files to do six small reads. Reading a page pulls in the code for saving pages and most of the server, because reader and writer share a file. Move the proxy's readers to leaf modules, with one file of tag names and one short-memory helper, so it answers from memory and refreshes in the background. Move page reads to src/server/page-reads.ts, which may not reach src/server/pages.ts. The graph test of step 1.5 holds both.

- **Closes:** [SD-1](../findings/storefront-server/SD-1.md), [SD-6](../findings/storefront-server/SD-6.md), [SG-2](../findings/server-module-graph/SG-2.md), [SF-2](../findings/server-functions/SF-2.md), [SG-8](../findings/server-module-graph/SG-8.md), [PM-12](../findings/page-builder-model/PM-12.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks; The page builder's model and a built page.
- **Done when:** src/server/route-load.graph.test.ts passes with src/proxy.ts at 120 source files or fewer by static value imports (1,309 today), reaching none of auth.ts, pages.ts, catalog.ts, stores.ts, seo.ts, stripe.ts or src/lib/admin-text.ts, and src/server/page-reads.ts at 130 modules or fewer (pages.ts reaches 1,307 today).
- **Platform:** One proxy stands before the platform admin and Kaizena Flow's site too, and the platform's pages are read through page-reads.ts.

## 2.12 Let nothing ride with a function that cannot use it: Stripe, the page model, the taxonomy

getStore() imports the Stripe SDK to learn whether two keys exist, and every route that reads a store builds the whole page model, 468 schemas for a theme's few fields. Read the key facts without the SDK, and cut the page model so that src/server/stores.ts reaches no block schema (a constraint on code review step 3.2). The 13 MB product taxonomy is traced into every function, the health check included, and a product page parses it to show one category: trace it only beside routes that can read it, held by a scan test, and store on a product the category name the shop shows.

- **Closes:** [SG-9](../findings/server-module-graph/SG-9.md), [DP-12](../findings/dependencies/DP-12.md), [SF-8](../findings/server-functions/SF-8.md), [SG-13](../findings/server-module-graph/SG-13.md), [AS-2](../findings/files/AS-2.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** A next analyze export shows /api/visit with no stripe module at or under 500 modules and 1.0 MB, the graph test shows src/server/stores.ts reaching no file that defines a block schema, and after pnpm build .next/server/app/api/health/route.js.nft.json lists no file under src/data/product-taxonomy (6 files and 12.7 MB today).
- **Platform:** The platform reads its settings and stores through the same getStore() path, and its routes lose the same traces.

## 2.13 Load the admin's words by area on admin routes too, and take English defaults out of the code

Every admin page and action loads all 67 areas in both languages: 3.46 MB of catalogue source, where its code names a median of 15. Give every area its module and move the admin's adminText() calls by codemod (561 to 688 files), until src/lib/admin-text.ts holds no table of every area. Where a function took English words as a default, the words become a required argument. On the server the proxy and the storefront then reach 16 catalogue files or fewer (37 after step 0.6). In the browser the 38 import sites that compile an English catalogue into client scripts go, leaving common and sign-in.

- **Closes:** [SG-4](../findings/server-module-graph/SG-4.md), [AC-9](../findings/admin-browser/AC-9.md), [BN-8](../findings/client-bundles/BN-8.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks; Interface text; What an owner's browser gets.
- **Done when:** admin-text-reach.scan.test.ts holds its five named admin entries to at most 28 areas and 1.66 MB of catalogue source each (67 and 3.46 MB today) and the proxy to 16 catalogue files, a next analyze export shows /admin/[store]/orders at or under 6.5 MB of server code (12,068 KB today), and admin-bundle.scan.test.ts finds no path from an admin client module to a catalogue other than common.en and sign-in.en (38 import sites today).
- **Platform:** The platform's areas are among the 67 and move in the same codemod, and the platform home is one of the five named entries.
- **The owner's question first:** Is a third language for the admin (Swedish or Danish) wanted in the first half year? If yes, this step moves before opening: until it is done each language adds about 1.5 MB to every function.

## 2.14 Hand each admin page only the words its parts read, and do not send them again with a save

Admin documents hand whole areas of words to the browser: the product editor is handed 238 KB and reads about 79 KB, every screen carries 34 KB of shell words and reads 12, and each save or poll re-sends 51 to 66 KB of unchanged shell words and menu. Hand down typed cuts of the big areas, and the assistant's button apart from its chat. Record per screen the bytes handed and the bytes in groups read, as a baseline beside the spec, and work down every site that hands over 50 KB until it hands at most 1.25 times what its parts read. Record the bytes a save answers with on the product editor and the builder, and end the repeat: the two big areas as content-hashed client modules, or a save that answers without drawing the route again. The stewards' findings stop at the measured pages; the per-screen baseline and the save's answer are the added parts an A needs.

- **Closes:** [AC-4](../findings/admin-browser/AC-4.md), [PL-1](../findings/page-payload/PL-1.md), [TX-2](../findings/interface-text/TX-2.md), [AD-5](../findings/admin-server/AD-5.md), [PM-10](../findings/page-builder-model/PM-10.md), GAP-text-1, GAP-text-3
- **Effort:** L. **Areas it moves:** What an owner's browser gets; Interface text; What the server loads and asks; The page builder's model and a built page.
- **Done when:** measure-routes.mjs writes html/admin-product-editor.html under 290,000 bytes (426,497 today) and the page editor's texts object is at most 205,000 bytes (276,922), e2e/signed-in/admin-text-fallbacks.spec.ts reports no fallback, no screen in the words baseline is under 80% read, and a builder save answers with under 20 KB of interface words.
- **Platform:** The platform admin's screens are in the words baseline, and its shell hands down the same cut words in both languages.

## 2.15 Let the builder paint first: the rich text editor and a store language load after

The page builder loads 3.3 MB of script before its first paint, the rich text editor and all four storefront languages among it; the draft-order editor carries the four languages too. Load the rich text editor after first paint, load one storefront language when a preview needs it, and none in the draft-order editor. The admin's import walk then forbids lib/i18n and lib/messages in admin client code.

- **Closes:** [AC-5](../findings/admin-browser/AC-5.md), [AC-6](../findings/admin-browser/AC-6.md), [BN-6](../findings/client-bundles/BN-6.md), [TX-7](../findings/interface-text/TX-7.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; Interface text.
- **Done when:** After a build, route-bundle-stats.json shows /admin/[store]/pages/[pageId] at or under 2,300,000 bytes (3,303,372 today) with no 'ProseMirror' chunk in its first load, and no admin route's first-load chunks hold 'Det gäller alla beställningar vännen gör.' (40 routes today).
- **Platform:** The platform's builder at /admin/platform/pages is the same editor and paints first the same way.

## 2.16 Load the builder's dialogs and each block's field form when they are opened

The stewards' items stop at about 2.2 MB for the builder. The bar for an A is 1,800,000 bytes and no finding carries the last step, so the plan adds it. This is code review step 3.4 with a number, after its steps 3.1 and 3.2: next/dynamic for the template, saved-layout, translation, theme, dual-frame and find-and-replace dialogs, and one field module per block type that brings its own words. The words that travel with a dialog (150 to 200 KB) then leave the editor's document too.

- **Closes:** GAP-owner-browser-1
- **Effort:** L. **Areas it moves:** What an owner's browser gets; The page builder's model and a built page.
- **Done when:** /admin/[store]/pages/[pageId] is at or under 1,800,000 bytes in route-bundle-stats.json, the page editor's document holds a texts object of at most 130,000 bytes in the budget of e2e/signed-in/admin-scripts.spec.ts, and the signed-in builder specs pass.
- **Platform:** The platform's page builder loads the same dialogs and field modules on demand.

## 2.17 Keep the session without the whole Supabase client, and hold what a screen has loaded by idle

After step 0.8 Supabase's client still loads on every admin screen once it is idle (259 KB), and no budget counts script fetched after the HTML's own. The stewards' items leave an idle store home near 930,000 bytes against a bar of 800,000, so the plan adds this step. Try two ways and keep one: the auth client alone with the same cookie storage (about 117 KB), or a small refresh route called before the token expires (0 KB; it changes the rule in docs/platform.md and how two tabs share a refresh token). Uploads keep importing the full client on the press. Add a case to e2e/signed-in/admin-scripts.spec.ts that sums every script response until the page is idle.

- **Closes:** GAP-owner-browser-2
- **Effort:** M. **Areas it moves:** What an owner's browser gets.
- **Done when:** The new case in e2e/signed-in/admin-scripts.spec.ts shows an idle store home with at most 800,000 bytes of script (1,428,740 today) and none of Supabase's realtime, storage or database client in it.
- **Platform:** The platform admin signs in through the same session part, and its two-step page keeps the stand-in's test.

## 2.18 Lighten the admin's shell and the store Home

The store Home runs 29 to 46 statements before it shows anything: put the setup checklist and the demo card behind Suspense, so first content comes after 14. The shell reads one thing after another and checks Stripe's set-up on every render: read in one wave after the guard, read memberships once per request (four shapes today), and make no Stripe check per render. Every admin request from a session without two-step calls Supabase Auth: keep the answer, and clear it when a factor is added or removed (code review step 3.8; security-sensitive).

- **Closes:** [AD-2](../findings/admin-server/AD-2.md), [AD-4](../findings/admin-server/AD-4.md), [AD-8](../findings/admin-server/AD-8.md), [AD-3](../findings/admin-server/AD-3.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The product's surface.
- **Done when:** src/server/admin-statements.baseline.json holds controlCenter() at 14 statements or fewer (22 or more today) and the store shell at 2 for the guard plus one wave, and with trust-fixtures an aal1 account with no factor makes 0 getUser calls across two readSession() runs while an account with a factor is still held at the challenge.
- **Platform:** The shell is shared with /admin/platform; the platform Home's own loaders follow in step 4.4, named here as the house rule asks.

## 2.19 Keep a page's facts in columns, so lists, menus and grids open no document

A page's title, its titles by language and its remembered-modal flag live only inside its content JSON, so menus, the modal check, the admin's page lists, pickers and AI tools read and parse whole documents, two per page in the admin (the draft and the published copy). Add stored generated columns on commerce.pages, read them in publishedPageNames() and usesRememberedModals(), and let listPages() read list fields and page at 100. A grid of pages or articles selects its cards' facts in SQL and fetches a document only for a row with neither an excerpt nor a description.

- **Closes:** [DS-4](../findings/database-shape/DS-4.md), [PM-6](../findings/page-builder-model/PM-6.md), [AD-14](../findings/admin-server/AD-14.md), [PM-5](../findings/page-builder-model/PM-5.md), GAP-page-model-1
- **Effort:** M. **Areas it moves:** The database; The page builder's model and a built page; What the server loads and asks.
- **Done when:** rg for JSON operators and jsonb_path_exists on published prints no line inside publishedPageNames() or usesRememberedModals(), 'select id, slug, draft, published' is in src/server/pages.ts only inside getPageForEdit(), and an integration test draws a 24-article grid whose articles have excerpts and reads no published document.
- **Platform:** The platform's pages are rows of the same table with a null owner, so /admin/platform/pages and Kaizena Flow's blog grid read the columns too.

## 2.20 Answer a store's own domain without a deployment

Every store domain is compiled into each deployment: 4 to 8 routing rules per domain against Vercel's cap of 2,048, of which the app's own routes take about 705, and a full production deploy per domain change. That is a ceiling near 270 stores with a domain. First, with no decision needed, show the count of routing rules on Platform, Usage and limits and print it from scripts/route-budget.mjs. Then, with the owner's yes and after step 2.11, look the host up when the request arrives and keep the answer in the proxy's short memory, so .next/routes-manifest.json is the same with 0 or 300 domains. It replaces decision P8 for own domains and is every store's front door: a mistake takes stores off the air where today it is caught at build.

- **Closes:** [SF-13](../findings/server-functions/SF-13.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks.
- **Done when:** In CI's hosts job a domain activated after the build serves its store's front page, and .next/routes-manifest.json holds the same number of redirects and rewrites whether the database has 0 or 300 active store domains.
- **Platform:** kaizenaflow.com and the docs host stay compiled routes of the app, and the count of rules is shown in /admin/platform.
- **The owner's question first:** May a store's own domain be resolved at request time, replacing decision P8's compiled routing rules? If P8 stays, the ceiling still needs an answer before about 250 stores have a domain, and the server area stops at a B.

## 2.21 Send the AI manager a lean default round

Every AI manager call sends 124 tool definitions and a prompt that lists every playbook and the admin map: 161,661 characters whatever the question, up to 11 times a turn. This is code review step 3.18 with numbers: send the core tools, the page's area and one routed area, with the rest one load_tools call away; list playbooks by feature; make no embedding request before the first model call for a person's few memories. Set the turn's ceiling of 400,000 tokens again in the same change. The eval cases of step 1.11 show whether the model still finds its tools.

- **Closes:** [AI-1](../findings/ai-calls/AI-1.md), [AI-9](../findings/ai-calls/AI-9.md), [AI-11](../findings/ai-calls/AI-11.md), [FT-4](../findings/features/FT-4.md), [AI-6](../findings/ai-calls/AI-6.md)
- **Effort:** M. **Areas it moves:** AI calls; The product's surface.
- **Done when:** src/server/ai-round.scan.test.ts draws the default round of a shop-only store under 52,000 characters with no page and under 80,000 on an orders page (161,661 today), agent-eval-replay.int.test.ts passes on a new recording that holds the lean cases, and a case in src/lib/tool-budget.test.ts shows chooseTools() sending at most 40 store tools when no area is asked.
- **Platform:** The platform's assistant runs the same loop, and its 39 tools get the same core-and-area cut.
- **The owner's question first:** What should the AI manager offer unprompted (question 8 of the code review)? In particular: always carry its 17 plan, reminder and saved-skill tools at about 3,800 tokens a round, or load them when the talk turns to them or the store has a plan, goal or reminder alive (a round with no page then falls to about 33,000 characters)?

## 2.22 Slim the tool schemas and send one page group, so no round is over 70,000 characters

After the lean round a turn on a settings, website or products page is still 75,000 to 97,000 characters. The bar is 70,000 and the stewards' findings do not reach it, so the plan adds page groups. Drop maxLength, minLength and pattern from the schemas the model sees (5,562 characters in a lean orders round), cut a long tool result so that it is still valid JSON, and split update_product. Give the four largest areas (settings, website, marketing, products) page groups taken from the admin map's sections: the page's group is sent, and the rest of its area is one load_tools call away. The scan draws no page and the largest page of each of the nine working areas, for a shop-only store and for one with every feature on.

- **Closes:** [AI-8](../findings/ai-calls/AI-8.md), GAP-ai-2
- **Effort:** M. **Areas it moves:** AI calls.
- **Done when:** src/server/ai-round.scan.test.ts shows no default round over 70,000 characters and no maxLength, minLength or pattern key in the round's tools, the int test of a cut result passes, and the lean eval cases pass in a new recording.
- **Platform:** The platform's tools are grouped by the platform admin's sections in the same map.

## 2.23 Pay less per token: count and use cached input, and give small jobs a quick model

No request asks for prompt caching, cached tokens are not read, stored or priced, and a store is charged the full price either way. Count cached_input_tokens in commerce.ai_usage, price them at their own rate and show them; then put the fixed part of the round first and the time last, with a fixed tool order and cache markers. One text model does every job: move the 8 named small jobs (the memory pass, tone, the support summary, recommendation order, search understanding, the listing check and two more) to a quick model (code review step 3.20), and give the memory pass a feature name of its own.

- **Closes:** [AI-3](../findings/ai-calls/AI-3.md), [AI-7](../findings/ai-calls/AI-7.md)
- **Effort:** M. **Areas it moves:** AI calls.
- **Done when:** In production a week after the change, select sum(cached_input_tokens)::float / nullif(sum(input_tokens), 0) from commerce.ai_usage where feature = 'ai_manager' gives at least 0.5, and select model, count(*) from commerce.ai_usage where feature in ('support_tone', 'support_summary', 'recommendations') group by 1 shows the quick model on those rows.
- **Platform:** The platform's provider settings gain the quick model beside the text model, and the platform's own AI usage is priced with cached tokens too.

## 2.24 Keep one file per decision, with a generated index

docs/decisions.md is one 1.33 MB file: 548 lines hold 97.8% of it in lines the search tool cannot show, and a row runs to 18 KB. Split it into docs/decisions/D{n}.md with a generated index of 564 rows that each start with the id, every line under 500 characters. src/lib/decisions.scan.test.ts holds that no id appears twice and that no decisions file is over 200 KB. The frozen Migration versions list moves to a file of its own.

- **Closes:** [DC-2](../findings/written-rules/DC-2.md), [AS-8](../findings/files/AS-8.md)
- **Effort:** M. **Areas it moves:** The written rules; The code itself.
- **Done when:** ls docs/decisions/D*.md | wc -l prints 564, awk 'length($0)>500' docs/decisions.md docs/decisions/D*.md | wc -l prints 0 (548 today), and src/lib/decisions.scan.test.ts passes.
- **Platform:** The platform's decisions are files like the stores'.

## 2.25 Bring the always-loaded core under 10.5 KB, make every living doc searchable, and measure what a session loads

After step 0.27 CLAUDE.md is under 15 KB; the bar is 10,500 bytes and 160 lines. Move the database, e2e, typed-row and AI-eval how-to into .claude/rules files loaded by path, where a fresh session and a subagent are shown to receive them; otherwise they sit in docs/rules as rules read on demand. Wrap the long prose lines of every living doc (321 lines in 61 files), hold table rows over 500 characters at 410 and falling, and shorten each rule over 4,000 bytes when it is next changed (24 today). scripts/session-load.mjs reads session transcripts and prints what a session loaded and read: sample 20 working sessions, and hold source file size with two counts in the code ratchet. No finding covers the wrap of other docs or the measurement; an A needs both.

- **Closes:** GAP-rules-2, GAP-rules-3
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** wc -c -l CLAUDE.md prints under 10,500 bytes and 160 lines with every never-sentence still in it, the docs budget shows 0 prose lines over 500 characters in living docs, and node scripts/session-load.mjs over 20 sessions shows at most 25 KB of written rules and docs read per code change at the median.
- **Platform:** The same core and rule files guide work on the platform.
- **The owner's question first:** May the database, e2e, typed-row and AI-eval how-to load only when those folders are opened (CLAUDE.md to under 10.5 KB)? It can be declined on its own; the core then stays at the 15 KB ceiling.

## 2.26 Shorten the gate: a type check without tests, a related test run, and a fresh worker only where a trial needs it

The type check is one 8,003-file program: about 3 minutes and a 7 GB heap limit. Give the gate tsconfig.app.json without tests, try the native TypeScript 7 compiler beside tsc for a week, and keep restored build info as the fallback (CI keeps nothing between runs but pnpm's store). Add pnpm test:changed, with every directory-reading test named *.scan.test.ts so it always runs. Run two trials in the Vitest config of step 0.26: the components project with isolate off, and one database file's time split into worker start, PGlite start, template load and tests; then lower the unit run's ceiling to the result. No finding examined the 281 component and database files that are three quarters of the unit run; the trials are the added part.

- **Closes:** [TC-4](../findings/tests-ci-build/TC-4.md), [TC-9](../findings/tests-ci-build/TC-9.md), [TC-6](../findings/tests-ci-build/TC-6.md), GAP-build-3
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** The gate's type check has a median of 60 s or less over ten runs in scripts/ci-budgets.json (about 3 minutes today), pnpm test:changed after a one-line change in src/lib runs fewer than 250 files (1,215 in a full run), and the full unit run takes 3 min 30 s or less where it took 5 min 34 s, with both trials' results in a decision row.
- **Platform:** One gate for stores and platform.
- **The owner's question first:** What must run before a push? A: everything, as today (about 5 minutes after these fixes; 11 to 12 now). B: lint, the type check and the tests the change touches, with the whole unit suite in the deploy gate, so each deploy waits about 3.5 minutes more (the planner's advice). C: as B before the push with the gate unchanged, so a failing unit test outside the six money files can be live until someone reads the red run.
