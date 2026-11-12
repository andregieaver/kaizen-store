# Phase 2: Load on demand

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** The structural half: each page, function, document and AI call loads what it uses, when it uses it. Before opening is the cheapest time for it, and phase 1's budgets show each step as a number that falls. Order where it matters: 2.2 before 2.3, 2.4 before 2.5, 2.14 before 2.15, 2.16 before 2.17 and 2.18, 2.20 before 2.35, 2.36 before 2.37, 2.27 and 2.29 before 2.30, 1.21 before 2.11, 2.11 before 2.49, 2.25 and 2.26 before 2.50, and 2.9 and 2.22 before 2.47. Step 2.1 is first because it only waits for the owner's yes. **A person will notice:** A store page arrives as a static file with nothing in it twice. A product view asks the database for stock and nothing else. A publish redraws one page, not the whole store. Admin screens hand the browser only the words they show, and the builder paints before its editors load. The AI manager answers on a third of the tokens. With the owner's yes, an agent session starts with a quarter of today's standing rules.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 2.1 Leave a map in CLAUDE.md, and bring the always-loaded core under 10.5 KB

Every session and subagent loads CLAUDE.md's 295-line feature index (43,361 bytes in all), of which a change needs two to four lines. Replace it with a map of the seven rule files and a three-line look-up, and change src/lib/rules-index.test.ts so it no longer asks for a line per rule: that takes the file under 15 KB. Then move the database, e2e, typed-row and AI-eval how-to into .claude/rules files loaded by path, where a fresh session and a subagent are shown to receive them; otherwise they sit in docs/rules as rules read on demand. Every sentence that guards an action taken without opening a file stays in the core. The docs budget of step 1.1 then holds 10,500 bytes and 160 lines as a hard ceiling. The owner has said yes to both halves. It is the largest saving per agent session in the plan. The commit message lists each block that left CLAUDE.md and the file that now holds it, so the owner can read what changed in his instruction file.

- **Closes:** [DC-1](../findings/written-rules/DC-1.md)
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** wc -c -l CLAUDE.md prints under 10,500 bytes and 160 lines (43,361 and 448 today) with every never-sentence still in it, src/lib/rules-index.test.ts passes, a fresh session that opens src/db/client.ts can quote the database rule's first sentence, and the proof of path loading is also run in a subagent, or the text stays in docs/rules.
- **Platform:** The rules cover stores and platform alike, and the map names the file that holds the platform's rules.
- **Decided (the owner, 12 November: the recommended way):** Yes to both halves. The 295-line feature index leaves CLAUDE.md for a map of the seven rule files and a three-line look-up, and the database, e2e, typed-row and AI-eval how-to load only when their folders are opened; the critic says the rules area needs both for an A. Every never-sentence stays in the file. *Asked:* CLAUDE.md is your instruction file. First: may its 295-line feature index go, leaving a map of the seven rule files and a three-line look-up (44 KB to under 15 KB per session)? Second, and it can be declined on its own: may the database, e2e, typed-row and AI-eval how-to load only when those folders are opened (to under 10.5 KB)? Without the first yes the rules area cannot reach a B; without the second it stops short of an A, at the 15 KB ceiling.
- **To carry it out:** [steps/2.1.md](steps/2.1.md) (review)

## 2.2 Send the store's layout once

The cart drawer's slot (@drawer) sits on the storefront's root layout, so every storefront document renders and ships the whole layout twice, with the store's 404 page inside: 35 rows and about 26 KB a document, and the theme's sheet three times. Move the slot off the root layout and read the cart count once per render. On a screen 768 px or wider the cart link then opens the cart page directly: no drawer rendered and thrown away, and no prefetch of it. This restructures the storefront's routes: the cart specs and the phone's drawer are the things to watch.

- **Closes:** [SC-8](../findings/storefront-browser/SC-8.md), [PL-2](../findings/page-payload/PL-2.md), [PM-1](../findings/page-builder-model/PM-1.md), [CS-5](../findings/styles/CS-5.md), [SC-7](../findings/storefront-browser/SC-7.md), [PF-7](../findings/prefetching/PF-7.md), GAP-page-model-s6
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page; Styles.
- **Done when:** The served /s/demo/no document opens one html element in its inline payload (two today), holds under 2,000 bytes of duplicate rows (26,534 today) and is under 112,000 bytes raw (138,523); /s/demo/no/om-oss is at most 82,000 bytes (110,415), lowered to 80,000 by step 2.3; and at 1280 px a press on the cart link makes one document request and no router request for /cart, with 0 router requests for the cart before the press; the html-element and duplicate-row assertions run on every budgeted document; all held in e2e/performance.spec.ts and e2e/cart.spec.ts.
- **Platform:** Kaizena Flow's own store pages carry the same layout and lose the same second copy; / and /admin already send one.
- **To carry it out:** [steps/2.2.md](steps/2.2.md) (review)

## 2.3 Draw each fixed style sheet once per document

The 1,760-byte breakpoint sheet is drawn again with every row: 6 times on a three-row page, 9 to 13 on a launch theme's home. Take it out of each row's styles (src/components/part-styles.tsx) and let the layout draw it once. An admin preview that draws site rows draws its own through PreviewBreakpoints, held by a scan rule. Then draw one part sheet for all of a page's rows, with the theme layers read once per article. With step 2.2 in, each sheet is in a document twice, whatever the number of rows: once in the HTML and once in the payload.

- **Closes:** [CS-4](../findings/styles/CS-4.md), [PM-7](../findings/page-builder-model/PM-7.md)
- **Effort:** S. **Areas it moves:** Styles; The page builder's model and a built page.
- **Done when:** A three-row test page's HTML holds the breakpoint sheet's href 2 times (6 today) and the theme sheet's 2 times (3 today), held in e2e/performance.spec.ts, and the themed home's style-text budget of step 1.6 is lowered to the new figure; the six-row page of step 1.3 holds 1 part sheet, or that sentence leaves this step and the 2 KB tolerance stays; /s/demo/no/om-oss is at most 80,000 bytes; and Orbit's home holds at most 35 KB raw of style text.
- **Platform:** Kaizena Flow's pages keep their default-size sheet once, and the platform admin's previews draw PreviewBreakpoints like a store's.
- **To carry it out:** [steps/2.3.md](steps/2.3.md) (review)

## 2.4 Serve store pages with nothing per visitor as static files, and let Add to cart answer a number

Every prerendered store page is 'resuming': a render function runs on each view to place two cart badges and a country hint. Add one small per-visitor answer, src/app/api/shop/mine/route.ts: the cart count, the saved ids and the hint. It is asked only when the marker cookie of step 0.15 says there is something. Home, built, blog and info pages can then be static. addToCart returns the new count and drops its refresh(), so one press no longer redraws the page and re-fetches every prefetched link.

- **Closes:** [CA-1](../findings/caching/CA-1.md), [CA-17](../findings/caching/CA-17.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; What a shopper's browser gets.
- **Done when:** After pnpm build, .next/prerender-manifest.json gives compute 'static' for /s/demo/no, /s/demo/no/om-oss and the blog routes (all 'resuming' today), held in scripts/render-modes.baseline.json, and e2e/cart.spec.ts shows one Add to cart as 1 request whose answer is under 5,000 bytes and carries the count, with no redraw of the route (16 requests and 193 KB today).
- **Platform:** Kaizena Flow's front page, served from its own store, becomes a static file with the rest; its baseline entry from step 0.3 moves to static.
- **To carry it out:** [steps/2.4.md](steps/2.4.md) (strong)

## 2.5 Give crawlers on Next's bot list the cached page

Bing, Google's shop and ads crawlers and every link preview get a full render of every page, static ones included, because Next streams nothing to user agents on its bot list. Once step 2.4 makes pages whole static files and step 1.11 holds the title in the head, narrow htmlLimitedBots in next.config.ts to the link-preview fetchers, which never run scripts. A new no-script test reads the home, a product, a category and an article as Bingbot and finds the title, description, canonical, price and JSON-LD. After the deploy, check one product page in Bing Webmaster Tools and Google's Rich Results Test. After opening, count page runs by these user agents in Vercel's logs and write the share into docs/performance.md.

- **Closes:** [CA-15](../findings/caching/CA-15.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks.
- **Done when:** On pnpm start, curl -sD - -A 'Mozilla/5.0 (compatible; bingbot/2.0)' http://localhost:3000/docs shows x-nextjs-cache: HIT (private, no-cache, no-store today), and the new no-script crawler test passes.
- **Platform:** Kaizena Flow's site and its docs are pages crawlers read; /docs is the page in the check.
- **To carry it out:** [steps/2.5.md](steps/2.5.md) (cheap)

## 2.6 Route every link through one wrapper with a stated policy

947 links have no stated policy, and 400 files import next/link directly. PolicyLink (policy sight, intent or never; step 0.13 made its first form) makes header tools, the bottom bar, footers, menus and closed sub-menus fetch on intent. State the policy per group in docs/performance.md. A ratchet count, directLinks, only lets direct next/link imports fall, and a new file that imports it fails. The ratchet waits for this step because a new file needs the wrapper to import. The first Add to cart then asks again for at most 10 links, not 32.

- **Closes:** [PF-3](../findings/prefetching/PF-3.md), [PF-8](../findings/prefetching/PF-8.md), [PF-12](../findings/prefetching/PF-12.md), [PF-10](../findings/prefetching/PF-10.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets.
- **Done when:** e2e/prefetch.spec.ts passes with at most 6 router prefetch requests on the phone home, a product page, a content page and the cart, at the top and read to the footer (47 on the home today), at most 10 after the first add to cart (32), and pnpm test fails for a new file that imports next/link directly. It also holds the home at 1280 px at 8 router requests or fewer, and 0 for a sub-link before its top link is hovered. Once the admin's in-page links go through the policy link, e2e/signed-in/prefetch.spec.ts counts 0 router prefetches at rest on all eight admin screens of step 0.13.
- **Platform:** The platform admin and Kaizena Flow's site use the same wrappers.
- **To carry it out:** [steps/2.6.md](steps/2.6.md) (review)

## 2.7 Keep a press on a built page's tile inside the app

A press on a built page's product tile, button or picture is a plain anchor: a whole document and 42 requests, where a link inside the app costs 5. Built pages' links use a BlockLink that stays in the app for an address of the app and keeps the plain anchor for pay paths, files and outside links.

- **Closes:** [PF-4](../findings/prefetching/PF-4.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets.
- **Done when:** e2e/prefetch.spec.ts 'a press on a built page's tile stays in the app' passes with 0 documents and at most 8 requests after the tap (1 and 42 today), and the pay-routes graph test still forbids app navigation into a pay path.
- **Platform:** Kaizena Flow's own pages are built pages: their buttons and tiles stay in the app the same way.
- **To carry it out:** [steps/2.7.md](steps/2.7.md) (review)

## 2.8 Bound what a real listing fetches ahead, and decide partial prefetching by trial

A real listing prefetches every product tile and up to six swatch links under each: about 96 requests for 48 products, and the test stores are too small to show it. Seed a 48-product category and bound it at 20 router requests read to the end, with swatches on intent. Run the partial-prefetching trial on the product page, the seeded listing, the store home and the admin's orders page, and write its table into docs/performance.md and the decision into docs/decisions.md: the first screen of tiles is fetched on sight and the rest on touch, unless the trial shows that one shared shell for all links to a route does clearly better; then the shell replaces it. The next major Next release forces the choice.

- **Closes:** [PF-13](../findings/prefetching/PF-13.md), [PL-5](../findings/page-payload/PL-5.md), [PF-9](../findings/prefetching/PF-9.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets.
- **Done when:** e2e/prefetch.spec.ts holds the seeded 48-product category read to the end on a phone at no more than 20 router requests, and docs/performance.md holds the trial's before-and-after table with the decision recorded in docs/decisions.md.
- **Platform:** The trial's fourth page is an admin page, so the choice is made for /admin/platform's lists too.
- **Decided (the owner, 12 November: the recommended way):** Yes. On a full listing only the first screen of product tiles is fetched ahead on sight and the rest when touched, and on a computer the main menu's links wait for the pointer (step 2.6 sets that policy); the critic says the shopper's browser needs this for an A. The trial decides whether one shared product shell replaces the rule; without a clear gain the first-screen rule stands, since it needs no router setting. *Asked:* On a full listing, may only the first screen of product tiles be fetched ahead on sight, and the rest when touched (or all through one shared product shell)? A yes lets the shopper's browser reach an A.
- **To carry it out:** [steps/2.8.md](steps/2.8.md) (review)

## 2.9 Let each working route load its own parts

Listing, search, cart, checkout, account, order, wishlist and cookies pages share one bundle of every working part, 98 KB larger than a built page's. Move the shell of StorePartSection to a server file with no section imports (src/components/store-part-frame.tsx), and give each route a small module that imports its own sections.

- **Closes:** [SC-2](../findings/storefront-browser/SC-2.md), [BN-9](../findings/client-bundles/BN-9.md), GAP-shopper-browser-s3
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets.
- **Done when:** The script tags of the server's HTML total at most 650,000 bytes raw for a category, a tag and the search page and at most 670,000 for the cart and the checkout and at most 650,000 for the account, wishlist, order and cookies pages (778,166 each today), the listing routes have at most 37 client modules by the review's server-graph.mjs (54 today), and the budgets of steps 1.2 and 1.3 are lowered to these figures.
- **Platform:** Kaizena Flow's site draws no cart or listing; its blog and theme-store pages already load their own parts, and the baseline of step 1.2 holds them.
- **To carry it out:** [steps/2.9.md](steps/2.9.md) (review)

## 2.10 Let a recommending grid bring its own words

A store page with a recommending grid downloads 650 KB more once recommendations answer: zod, the page model and all four storefront languages. The grid takes its words as a prop, from the browser files of src/lib/messages, and the scan that keeps the page model out of a store page's first scripts covers its later ones too.

- **Closes:** [BN-16](../findings/client-bundles/BN-16.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets; The page builder's model and a built page.
- **Done when:** e2e/recommendations.spec.ts counts at most 140,000 bytes of script after /api/recommendations answers (649,561 today), with no whole language, no zod and no page model in it.
- **Platform:** Store-only by the house rule's exception: recommendations are for goods, and Kaizena Flow sells plans.
- **To carry it out:** [steps/2.10.md](steps/2.10.md) (strong)

## 2.11 Give the storefront a stylesheet of its own

One 183 KB sheet serves stores, the site, the docs and the admin: 28% of it styles only the admin, and 3,480 of the 5,931 files Tailwind reads can rename it though no public page draws them. Make two Tailwind entries: the site's reads the site's code and the 11 admin parts a public page imports, each named on a line of its own. The audiences script of step 1.23 then shows at most 15 KB raw of classes no store page can draw. Measure the build's peak before and after. Do it after step 1.21: the build has 0.8 GB of room and was killed once, a second Tailwind entry adds about 150 MB, and the way back (keep one sheet) would leave three styles measures short for good. A Tailwind class typed in a part's Advanced tab is not promised on the live site: the docs portal's article on the Advanced tab says that only classes styled by the owner's own CSS are promised, and the site's sheet keeps no list of utility names.

- **Closes:** [SC-5](../findings/storefront-browser/SC-5.md), [CS-1](../findings/styles/CS-1.md), [BN-12](../findings/client-bundles/BN-12.md), GAP-styles-s5
- **Effort:** M. **Areas it moves:** Styles; What a shopper's browser gets; What an owner's browser gets.
- **Done when:** The stylesheet that /s/demo/no links is at most 135,000 bytes raw and 20,600 Brotli (183,124 and 25,832 today) and the admin's two sheets at most 208,000 raw (204,207), with the budgets of step 1.3 lowered to them; src/lib/stylesheet-sources.scan.test.ts fails both ways, for a line no public page reaches and for an admin part a public page imports that has no line; stylesheet-audiences.mjs exits non-zero when a class only admin files name is in the site's sheet; and the build's peak before and after is in docs/build-memory.md (no more than about 150 MB higher). An article under content/docs carries the sentence on classes typed in the Advanced tab.
- **Platform:** Kaizena Flow's public site and docs get the site's sheet; the admin, /admin/platform included, keeps its own two.
- **Decided (the owner, 12 November: the recommended way):** The docs say it, and the site's sheet keeps no list of utility names. Only classes styled by the owner's own CSS are promised on the live site; a fixed list would add bytes to every store page for a few owners who type classes. *Asked:* After the split, a Tailwind class typed in a part's Advanced tab can show on the builder's canvas and not on the live site. Is it enough to say in the docs that only classes styled by the owner's own CSS are promised, or should the site's sheet keep a short fixed list of utility names owners may type?
- **To carry it out:** [steps/2.11.md](steps/2.11.md) (review)

## 2.12 Draw a listing's grid once and read its list once

A product grid with Filter and sort is sent twice when nothing is chosen: the built grid is the Suspense fallback and the streamed copy replaces it, so each product is 18 times in the markup and 18 in the payload, and a category asks the database again for the list it already drew. In src/components/content-grid-section.tsx keep the built grid in the shell and stream only the controls and the Show more link; memoise the grid's loader per request.

- **Closes:** [PL-6](../findings/page-payload/PL-6.md), [PM-8](../findings/page-builder-model/PM-8.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; The page builder's model and a built page.
- **Done when:** The served /s/demo/no/products document holds each product's data-item-id once in its markup and once in its payload (18 and 18 for 9 products today) and is at most 120,000 bytes raw (170,329 today), held in e2e/listing.spec.ts.
- **Platform:** Kaizena Flow's site has no filterable product grid; its grids of articles and themes draw through the same section and are sent once.
- **To carry it out:** [steps/2.12.md](steps/2.12.md) (review)

## 2.13 Ask the database for stock only on a product view

An anonymous view of a prerendered product sends about 18 statements. One answer, stock, changes per view, and it is read twice. Put what only an owner sets (checkout's look, payment state, checkout fields, quote mode, back in stock, price breaks, producer schemes) in one cached read per store and market, src/server/buy-facts.ts, tagged so its writers refresh it, and carry it in the prerendered page. The buy button then no longer waits for payment facts.

- **Closes:** [SD-2](../findings/storefront-server/SD-2.md), GAP-server-s5
- **Effort:** M. **Areas it moves:** What the server loads and asks; The product's surface.
- **Done when:** One anonymous GET of a prerendered goods product on a warm production build sends 2 statements or fewer beyond the proxy's for a plain store, 3 with producer schemes and 4 with price breaks (about 16 today), and reads only the inventory tables, by scripts/server-budget.mjs with its budgets set at those numbers and a trial extra read that fails it, and the product page's reads are off the exceptions list of step 1.12.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and has no stock.
- **To carry it out:** [steps/2.13.md](steps/2.13.md) (review)

## 2.14 Let a publish make only its own page stale

One tag, pages:{store}, covers all of a store's pages, and 55 places refresh it: one publish makes all 261 built pages of the demo render again. Add page:{id} for reads of one page's document, so a change to a page's body makes that page's entries stale. A change other pages show (a title, an address, a header, a footer) stays store-wide. Cache a product layout once per store, not once per product. The alt-text job refreshes a store's tags once when its queue is empty, then only the pages that hold the picture.

- **Closes:** [PM-15](../findings/page-builder-model/PM-15.md), [PM-16](../findings/page-builder-model/PM-16.md), GAP-page-model-2, GAP-page-model-s3
- **Effort:** M. **Areas it moves:** The page builder's model and a built page; What the server loads and asks.
- **Done when:** An e2e in the signed-in suite publishes a change to the body of /om-oss: the home page and a product page then answer x-nextjs-cache: HIT, /om-oss shows the new words, and a title change reaches the home page's menu. The nine places that publish a body refresh the store-wide tag only for scope 'site', each held by a unit test. A unit test fails when the page index or a card's facts gains a field that listFacts() lacks. A unit test of the alt-text route sees at most one store-wide refresh across 10 runs (10 today). src/server/product-layouts.int.test.ts counts one read of a layout's document for two products. And the .meta reader of step 1.11 prints the tag of /om-oss's page on 3 of 261 entries.
- **Platform:** The platform's pages take page:{id} with a null owner.
- **To carry it out:** [steps/2.14.md](steps/2.14.md) (strong)

## 2.15 Let tagged reads live until their tag is refreshed

71 of 85 cached reads expire after an hour though every writer refreshes a tag, and home and All products redraw every 15 minutes. Give a read whose every writer refreshes a tag a week's life, and keep the clock only where the answer holds one: the 30-day reference price, campaigns, VAT labels. Do it after step 2.14, so the week is set on the final tags, and let use-cache.scan.test.ts hold each read's life.

- **Closes:** [SD-8](../findings/storefront-server/SD-8.md), [CA-10](../findings/caching/CA-10.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks.
- **Done when:** pnpm build's route table shows no storefront route at 15m (6 today), .next/prerender-manifest.json shows a store's own pages at 604800, and use-cache.scan.test.ts lists only the named clock reads, the grid of pages and the feed at an hour (71 reads today).
- **Platform:** The docs routes (251 at 3,600 s today) and Kaizena Flow's pages get the week's life.
- **To carry it out:** [steps/2.15.md](steps/2.15.md) (strong)

## 2.16 Keep a page's title and flags in columns

A page's title, its titles by language and its remembered-modal flag live only inside its content JSON, so menus and the modal check dig through whole documents: 57,930 and 68,878 calls in 78 days, the modal check alone 121 s. Add stored generated columns on commerce.pages in one migration (add only), and read them in publishedPageNames() and usesRememberedModals().

- **Closes:** [DS-4](../findings/database-shape/DS-4.md), [PM-6](../findings/page-builder-model/PM-6.md)
- **Effort:** M. **Areas it moves:** The database; The page builder's model and a built page.
- **Done when:** rg for JSON operators and jsonb_path_exists on published prints no line inside publishedPageNames() or usesRememberedModals(), and a plan test shows both answered for one owner without reading a document.
- **Platform:** The platform's pages are rows of the same table with a null owner and get the same columns.
- **To carry it out:** [steps/2.16.md](steps/2.16.md) (review)

## 2.17 Let page lists, pickers and grids open no document

The admin's page lists, pickers and AI tools read two whole documents a page (the draft and the published copy) at 16 call sites. A grid of pages or articles reads whole documents to draw its cards. listPages() reads list fields from the columns of step 2.16 and pages at 100. A grid selects its cards' facts in SQL and fetches a document only for a row with neither an excerpt nor a description. The last readers of whole lists move too: Kaizena Flow's two static-params functions, the admin's search picker and the ten lines in src/server/seo.ts read the page index of step 0.24, and the feed reads the card facts for its newest 50 with the limit in SQL. The page lists among the six lists with no limit (code review, from step 4.4) get their limit here.

- **Closes:** [AD-14](../findings/admin-server/AD-14.md), [PM-5](../findings/page-builder-model/PM-5.md), GAP-page-model-1, GAP-page-model-s1
- **Effort:** M. **Areas it moves:** What the server loads and asks; The page builder's model and a built page; The database.
- **Done when:** 'select id, slug, draft, published' is in src/server/pages.ts only inside getPageForEdit(), and an integration test draws a 24-article grid whose articles have excerpts and reads no published document; listPublishedPages is named on at most 3 lines (37 today); src/server/ratchet.baseline.json names every statement that selects draft or published for more than one row, each with its reason; and an int test on a store of 30 pages and 60 articles counts at most 3 page documents for a cold home, a built page and a product page, none for the blog's listing and at most 50 rows for the feed.
- **Platform:** /admin/platform/pages and Kaizena Flow's blog grid read the columns too.
- **To carry it out:** [steps/2.17.md](steps/2.17.md) (strong)

## 2.18 Read a cold store page's frame in one wave

A cold frame asks about 20 statements, some one after another and one per optional feature whether the store uses it or not; siteCookies() alone asks 8 or 9 in a row. Start the independent reads together. Fold the feature questions into one site-facts read (src/server/site-facts.ts) that keeps the tags of the readers it replaces. Take menu titles from the page index of step 0.24 and the modal flag from the column of step 2.16, and let a search read its rules once.

- **Closes:** [SD-5](../findings/storefront-server/SD-5.md), [SD-9](../findings/storefront-server/SD-9.md), [DQ-7](../findings/queries/DQ-7.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database; The product's surface.
- **Done when:** query-budget.int.test.ts counts at most 5 statements for a store's cold frame with none of the features on (about 20 today) and at most 4 for siteCookies() (8 or 9), scripts/server-budget.mjs counts 20 or fewer for the first request of a store's home after a restart (30 to 35 today), and the frame's reads are off the exceptions list of step 1.12.
- **Platform:** Kaizena Flow's own frame (21 statements cold today) is read through the same loaders with a null owner and falls with them.
- **To carry it out:** [steps/2.18.md](steps/2.18.md) (strong)

## 2.19 Read nothing that grows with the catalogue, and read the cart and checkout in one wave

No finding covers the catalogue's reads or a cart with lines and the checkout, so the plan brings code review steps 3.8 to 3.10 in with numbers. The front page's JSON-LD comes from a small cached read of handles, never the product summaries. Product metadata takes its market codes from getProduct(). A product has a tag of its own and lists share a lists tag, so saving one product refreshes those two and not the store's. The cart's and the checkout's independent reads start in one wave after the shopper is known. Two parts come here from step 4.4, because they grow with a store. The catalogue's listing calls a VAT function and an alt-text function once per product row, so a listing of 2,000 products scans commerce.countries 2,000 times: ask each VAT rate once and join the alt text. And the lists with no limit that are not page lists (those are step 2.17's) get a limit, an aggregate or a time bound.

- **Closes:** GAP-server-1, GAP-server-s7, [DQ-14](../findings/queries/DQ-14.md), [DQ-16](../findings/queries/DQ-16.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database.
- **Done when:** scripts/server-budget.mjs holds a cart with three lines and the checkout at the count left after these cuts, in at most two waves, and fails when one request sends the same statement with the same values twice: a trial second call of cartSummary() fails it. A cold home and product page of the 500-product store read no more rows than those of a 10-product store. A unit test shows saving one product refreshing its own tag and the lists tag only. On a database seeded with 2,000 products one listProducts() raises the scans of commerce.countries by at most 10 (at least 2,000 today), and src/server/list-limits.scan.test.ts finds a limit, an aggregate or a time bound on each of the six lists.
- **Platform:** Kaizena Flow's store has plans, not a catalogue of goods; its front page reads through the same loaders.
- **To carry it out:** [steps/2.19.md](steps/2.19.md) (strong)

## 2.20 Turn the proxy's readers into leaf modules

The proxy runs before every page and prefetch and reaches 1,309 source files to do six small reads. Move its readers to leaf modules, with one file of tag names and one short-memory helper, so it answers from memory and refreshes in the background. The graph test of step 1.8 forbids it the modules named below.

- **Closes:** [SD-1](../findings/storefront-server/SD-1.md), [SD-6](../findings/storefront-server/SD-6.md), [SG-2](../findings/server-module-graph/SG-2.md), [SF-2](../findings/server-functions/SF-2.md), [SG-8](../findings/server-module-graph/SG-8.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks.
- **Done when:** src/server/route-load.graph.test.ts passes with src/proxy.ts at 120 source files or fewer by static value imports (1,309 today) and 1.0 MB of chunks or fewer (9,729 KB), reaching none of auth.ts, pages.ts, catalog.ts, stores.ts, seo.ts, stripe.ts, sharp, src/lib/admin-text.ts or any catalogue file of src/lib/admin-messages.
- **Platform:** One proxy stands before the platform admin and Kaizena Flow's site too.
- **To carry it out:** [steps/2.20.md](steps/2.20.md) (review)

## 2.21 Read a page without importing the code that saves pages

Reading a page pulls in the code for saving pages and most of the server, because reader and writer share src/server/pages.ts: it reaches 1,307 modules. Move page reads to src/server/page-reads.ts, with the tag names in a leaf module, and forbid it src/server/pages.ts in the graph test.

- **Closes:** [PM-12](../findings/page-builder-model/PM-12.md)
- **Effort:** M. **Areas it moves:** The page builder's model and a built page; What the server loads and asks.
- **Done when:** src/server/route-load.graph.test.ts passes with src/server/page-reads.ts at 130 modules or fewer (pages.ts reaches 1,307 today) and no path from it to src/server/pages.ts, and the graph test also forbids src/components/page-article.tsx the files src/server/pages.ts, design-presets.ts, page-ai.ts and src/lib/signature.
- **Platform:** The platform's pages are read through page-reads.ts.
- **To carry it out:** [steps/2.21.md](steps/2.21.md) (strong)

## 2.22 Read a store without the Stripe SDK and without the whole page model

getStore() imports the Stripe SDK to learn whether two keys exist, and every route that reads a store builds the whole page model: 468 schemas for a theme's few fields. Read the key facts without the SDK, and cut the page model so that src/server/stores.ts reaches no block schema (a constraint on code review step 3.2). This is the last cut on what a storefront page loads, so its check carries that bar.

- **Closes:** [SG-9](../findings/server-module-graph/SG-9.md), [DP-12](../findings/dependencies/DP-12.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** A next analyze export shows each of the five beacons (the four /api/visit routes and /api/recommendations/events) with no stripe module at or under 500 modules and 1.0 MB, each under 130 source files by the graph test, and /s/[store]/[market] at or under 1,500 modules and 4.0 MB with no admin text, AI tool, theme-store code or sharp; the graph test shows src/server/stores.ts reaching no file that defines a block schema.
- **Platform:** The platform reads its settings and stores through the same getStore() path, and its routes lose the same traces.
- **To carry it out:** [steps/2.22.md](steps/2.22.md) (strong)

## 2.23 Trace the product taxonomy only beside routes that can read it

The 13 MB product taxonomy is traced into every function, the health check included, and a product page parses it to show one category. Trace it only beside routes that can read it, held by a scan test, and store on a product the category name the shop shows. sharp's native library is traced the same way, only where a route can draw.

- **Closes:** [SF-8](../findings/server-functions/SF-8.md), [SG-13](../findings/server-module-graph/SG-13.md), [AS-2](../findings/files/AS-2.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** After pnpm build .next/server/app/api/health/route.js.nft.json lists no file under src/data/product-taxonomy (6 files and 12.7 MB today), src/server/route-load.graph.test.ts fails when a route off the list imports src/server/product-taxonomy.ts, and a product page reads its category's name from the product's row.
- **Platform:** The platform's routes lose the same traces.
- **To carry it out:** [steps/2.23.md](steps/2.23.md) (review)

## 2.24 Shrink the server-reference manifest

Every cold function reads a 10.4 MB list of 81,027 server references before its first request: 80 to 91 ms on the review's machine. The cuts of phase 0 take about a seventh. Production cannot time a step that runs inside Next, so the step has no condition: scripts/route-budget.mjs (step 1.8) times Next's own loader on the built manifest in a fresh process and prints entries per route. Tag names get a leaf module that writers import, and the cached readers listed by more than 500 routes move to reader files that no writer imports, first the ones the admin shell reaches. Report the per-route cost to Next. Effort is M to L.

- **Closes:** GAP-server-s4
- **Effort:** L. **Areas it moves:** What the server loads and asks.
- **Done when:** scripts/route-budget.mjs prints the manifest under 5 MB and 40,000 entries (10.4 MB and 81,027 today), an admin route lists a median of 60 references or fewer (115 today) and /api/visit lists 0 (74 today), and the loader's time on CI's machine is held under 45 ms.
- **Platform:** The manifest is one file for stores and platform; 547 of its 807 routes are admin routes, the platform's among them.
- **To carry it out:** [steps/2.24.md](steps/2.24.md) (strong)

## 2.25 Load the admin's words by area on admin routes too

Every admin page and action loads all 67 areas in both languages: 3.46 MB of catalogue source, where its code names a median of 15. Give every area its module and move the admin's adminText() calls by codemod (561 to 688 files), until src/lib/admin-text.ts holds no table of every area. Where a function took English words as a default, the words become a required argument. The 218 modules that import a catalogue file directly, for a constant or a fallback, are step 2.50's: this step's done-when is set at what its own codemod reaches. No third admin language is planned for the first half year, so this step and step 2.50 stay in phase 2; both land before any third language is added.

- **Closes:** [SG-4](../findings/server-module-graph/SG-4.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks; Interface text.
- **Done when:** admin-text-reach.scan.test.ts holds every admin entry to a median of at most 30 areas and 1.31 MB of catalogue source (67 areas and 3.46 MB today), src/lib/admin-text.ts holds no table of every area, and the server code of /admin/[store]/orders in a next analyze export is lower than before the step, with its figure in the baseline of step 1.8. The lines of 18 areas, 0.9 MB and 6.5 MB are step 2.50's.
- **Platform:** The platform's areas are among the 67 and move in the same codemod, and the platform home is one of the admin entries held.
- **Decided (the owner, 12 November: the recommended way):** No third admin language is planned for the first half year, so this step and step 2.50 stay in phase 2. If one is wanted sooner, both steps land before the language is added. *Asked:* Is a third language for the admin (Swedish or Danish) wanted in the first half year? If yes, this step and step 2.50 move before opening: until they are done each language adds about 1.5 MB to every function.
- **To carry it out:** [steps/2.25.md](steps/2.25.md) (review)

## 2.26 Take English catalogues out of the admin's client code

38 import sites compile an English catalogue into client scripts as a default: about 150 KB on the builder, 65 KB on the Work screens, 24 to 45 KB on 73 field screens and 22 KB on the home. Hand the words down as props, as step 2.27 does for the documents, and leave only common and sign-in. Do the builder's four sites with step 2.29, and the rest area by area.

- **Closes:** [AC-9](../findings/admin-browser/AC-9.md), [BN-8](../findings/client-bundles/BN-8.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; Interface text.
- **Done when:** admin-bundle.scan.test.ts finds no path from an admin client module to a catalogue other than common.en and sign-in.en (38 import sites today), and the bundle baseline of step 1.2 shows /admin/[store], orders, products, settings and /admin/platform each at or under 680,000 bytes, with the median admin route at or under 650,000 (1,152,953 today).
- **Platform:** The platform's client parts are among the 38 sites, and the platform home is one of the five screens held.
- **To carry it out:** [steps/2.26.md](steps/2.26.md) (strong)

## 2.27 Hand each admin page only the words its parts read

Admin documents hand whole areas of words to the browser: the product editor is handed 238 KB and reads about 79 KB, and every screen carries 34 KB of shell words and reads 12. Hand down typed cuts of the big areas, and the assistant's button apart from its chat. Then work down the words baseline of step 1.28, which lists all 188 sites: every site that hands over 50 KB, until it hands at most 1.25 times the groups its parts name. 'Read' here means named, counted from source in both languages; a share read at load could only be met by fetching a panel's words when it opens, which loses a press. The stewards' findings stop at the measured pages; the work-down over all 24 large sites is the added part an A needs.

- **Closes:** [AC-4](../findings/admin-browser/AC-4.md), [PL-1](../findings/page-payload/PL-1.md), [TX-2](../findings/interface-text/TX-2.md), [PM-10](../findings/page-builder-model/PM-10.md), GAP-text-1
- **Effort:** L. **Areas it moves:** What an owner's browser gets; Interface text; The page builder's model and a built page; What a shopper's browser gets.
- **Done when:** In the words baseline of step 1.28 the five budgeted screens are handed at most 1.1 times the groups their parts name, no site that hands over 50 KB hands more than 1.25 times, no site hands an area that none of its parts names, and the list of parts that take a whole area holds only the builder's two. The browser's record of step 1.5 stays as a cross-check that may only rise. Shared words are at or under 15.5 KB in English and 16 KB in Norwegian (34.0 and 45.3 today); the store home's document is at most 140,000 characters (165,942), the product editor's under 290,000 bytes (426,497) and the builder's under 480,000 (585,943) with a texts object of at most 205,000 (276,922), which step 2.30 lowers to 445,000 and 130,000; and e2e/signed-in/admin-text-fallbacks.spec.ts reports no fallback.
- **Platform:** The platform admin's screens are in the words baseline, and its shell hands down the same cut words in both languages.
- **To carry it out:** [steps/2.27.md](steps/2.27.md) (strong)

## 2.28 Do not send the words again with a save

Each save or poll re-sends 51 to 66 KB of unchanged shell words and menu, and the builder's save re-sends its two big areas. End the repeat one of two ways and keep the one that measures better: the two big areas as content-hashed client modules the browser keeps, or a save that answers without drawing the route again. The record of step 1.5 shows the bytes a save answers with.

- **Closes:** [AD-5](../findings/admin-server/AD-5.md), GAP-text-3
- **Effort:** M. **Areas it moves:** What the server loads and asks; What an owner's browser gets; Interface text.
- **Done when:** In e2e/signed-in/admin-scripts.spec.ts a builder save and a product save each answer with under 20 KB of interface words, and a redraw of the store shell re-sends under 30 KB of shell JSON (51 to 66 KB today).
- **Platform:** The platform admin's shell and builder save through the same path.
- **To carry it out:** [steps/2.28.md](steps/2.28.md) (strong)

## 2.29 Let the builder paint first: the rich text editor and a store language load after

The page builder loads 3.3 MB of script before its first paint, the rich text editor and all four storefront languages among it; the draft-order editor carries the four languages too. Load the rich text editor after first paint, load one storefront language when a preview needs it, and none in the draft-order editor. The admin's import walk then forbids lib/i18n and lib/messages in admin client code.

- **Closes:** [AC-5](../findings/admin-browser/AC-5.md), [AC-6](../findings/admin-browser/AC-6.md), [BN-6](../findings/client-bundles/BN-6.md), [TX-7](../findings/interface-text/TX-7.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; Interface text.
- **Done when:** After a build, route-bundle-stats.json shows /admin/[store]/pages/[pageId] at or under 2,300,000 bytes (3,303,372 today) with no 'ProseMirror' chunk in its first load, and no admin route's first-load chunks hold 'Det gäller alla beställningar vännen gör.' (40 routes today).
- **Platform:** The platform's builder at /admin/platform/pages is the same editor and paints first the same way.
- **To carry it out:** [steps/2.29.md](steps/2.29.md) (cheap)

## 2.30 Load the builder's dialogs and each block's field form when they are opened

The stewards' items stop at about 2.2 MB for the builder. The bar for an A is 1,800,000 bytes and no finding carries the last step, so the plan adds it. This is code review step 3.4 with a number, after its steps 3.1 and 3.2: next/dynamic for the template, saved-layout, translation, theme, dual-frame and find-and-replace dialogs, and one field module per block type that brings its own words. The words that travel with a dialog (150 to 200 KB) then leave the editor's document too. Before work starts, the step holds the cut simulation's table (the script is in the repo since step 0.1), summing to at least 310,000 bytes: the settings panel loaded when a part is first selected, the custom-fields form, the terms manager and the brand icon list. If the table sums to less, the builder's own split (code review step 3.1) joins the step.

- **Closes:** GAP-owner-browser-1, GAP-owner-browser-s2
- **Effort:** L. **Areas it moves:** What an owner's browser gets; The page builder's model and a built page.
- **Done when:** /admin/[store]/pages/[pageId] is at or under 1,800,000 bytes in route-bundle-stats.json, the page editor's document holds a texts object of at most 130,000 bytes in the budget of e2e/signed-in/admin-scripts.spec.ts, the signed-in builder specs pass, the cut table summing to at least 310,000 bytes is in the step's section of the tracker before work starts, the builder's document is at or under 445,000 bytes, and its script by idle is at or under 2,500,000 bytes (3,454,740 today).
- **Platform:** The platform's page builder loads the same dialogs and field modules on demand.
- **To carry it out:** [steps/2.30.md](steps/2.30.md) (strong)

## 2.31 Keep the session without the whole Supabase client

After step 0.9 Supabase's client still loads on every admin screen once it is idle (259 KB). The stewards' items leave an idle store home near 930,000 bytes against a bar of 800,000, so the plan adds this step. Try two ways and keep one: the auth client alone with the same cookie storage (about 117 KB), or a small refresh route called before the token expires (0 KB; it changes the rule in docs/platform.md and how two tabs share a refresh token). Uploads keep importing the full client on the press. The by-idle budget of step 1.5 shows the result.

- **Closes:** GAP-owner-browser-2
- **Effort:** M. **Areas it moves:** What an owner's browser gets.
- **Done when:** The by-idle case in e2e/signed-in/admin-scripts.spec.ts shows an idle store home with at most 800,000 bytes of script (1,428,740 today) and none of Supabase's realtime, storage or database client in it.
- **Platform:** The platform admin signs in through the same session part, and its two-step page keeps the stand-in's test.
- **To carry it out:** [steps/2.31.md](steps/2.31.md) (review)

## 2.32 Lighten the admin's shell and the store Home

The store Home runs 29 to 46 statements before it shows anything: put the setup checklist and the demo card behind Suspense, so first content comes after 14. The shell reads one thing after another and checks Stripe's set-up on every render: read in one wave after the guard, read memberships once per request (four shapes today), and make no Stripe check per render.

- **Closes:** [AD-2](../findings/admin-server/AD-2.md), [AD-4](../findings/admin-server/AD-4.md), [AD-8](../findings/admin-server/AD-8.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The product's surface.
- **Done when:** src/server/admin-statements.baseline.json holds controlCenter() at 14 statements or fewer in at most 2 waves (22 or more today) and the store shell at 2 for the guard plus one wave (6, five of them in a row, today), and 0 statements after the response on the second shell render of a store with an active test account.
- **Platform:** The shell is shared with /admin/platform; the platform Home's own loaders follow in step 4.4, named here as the house rule asks.
- **To carry it out:** [steps/2.32.md](steps/2.32.md) (review)

## 2.33 Make no Supabase Auth call per request for an account without a second factor

Every admin request from a session without two-step calls Supabase Auth. Keep the answer in the mirror the app already writes (two_step_since), reconcile it at sign-in, and clear it when a factor is added or removed (code review step 3.8). This is security-sensitive: an account with a verified factor must never be let in on an old session. So the tests cover enrol, remove, reset by an owner and re-enrol, and a person with access first checks the project's JWT signing keys.

- **Closes:** [AD-3](../findings/admin-server/AD-3.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks.
- **Done when:** With trust-fixtures an aal1 account with no factor makes 0 getUser calls across two readSession() runs (1 each today) while an account with a factor is still held at the challenge, and code review step 3.8 reads Done.
- **Platform:** The platform admin signs in through the same session read; platform admins have a second factor (D254), so they keep the check.
- **To carry it out:** [steps/2.33.md](steps/2.33.md) (review)

## 2.34 Let an untouched tab ask for notices less often

Every open admin tab asks for AI manager notices once a minute: 60 requests an hour, whatever the answer. After step 0.17 each costs two statements. Ask on mount, when the tab is shown and when the path changes; keep the one-minute timer only for ten minutes after the count was last above zero or the assistant was used, and while an approval waits. A notice from scheduled work then reaches an untouched tab up to ten minutes late, and at once on the next click.

- **Closes:** [AC-13](../findings/admin-browser/AC-13.md), [PL-11](../findings/page-payload/PL-11.md), [AI-12](../findings/ai-calls/AI-12.md)
- **Effort:** S. **Areas it moves:** What an owner's browser gets; AI calls; What a shopper's browser gets; What the server loads and asks.
- **Done when:** A case with a clock in e2e/signed-in/ai-manager-panel.spec.ts sees at most 2 requests to /admin/account/notices/feed in ten minutes from an untouched tab (10 today) and at most 6 in an hour (60).
- **Platform:** The platform admin's badge is the same component.
- **Decided (the owner, 12 November: the recommended way):** Yes. The badge in a tab nobody touches may be up to ten minutes late; it shows at once on the next click and stays at one minute while an approval waits. The critic says the owner's browser needs this for an A. *Asked:* May the notice badge in a tab nobody touches be up to ten minutes late (60 requests an hour become 6)? It shows at once on the next click, and stays at one minute while an approval waits. With a no the owner's browser's measure stays short of its bar: 60 requests an hour from each untouched tab grows with owners and is not a small tolerance.
- **To carry it out:** [steps/2.34.md](steps/2.34.md) (cheap)

## 2.35 Answer a store's own domain without a deployment

Every store domain is compiled into each deployment: 4 to 8 routing rules per domain against Vercel's cap of 2,048, of which the app's own routes take about 705, and a full production deploy per domain change. That is a ceiling near 270 stores with a domain; step 1.8 prints the count on every build. After step 2.20, look the host up when the request arrives and keep the answer in the proxy's short memory, so .next/routes-manifest.json is the same with 0 or 300 domains. It replaces decision P8 for own domains and is every store's front door: a mistake takes stores off the air where today it is caught at build. Land it in two pushes: first the lookup beside the compiled rules, then the rules' removal once CI's hosts job and a day in production show the lookup answering every active domain.

- **Closes:** [SF-13](../findings/server-functions/SF-13.md)
- **Effort:** L. **Areas it moves:** What the server loads and asks.
- **Done when:** In CI's hosts job a domain activated after the build serves its store's front page, and .next/routes-manifest.json holds the same number of redirects and rewrites whether the database has 0 or 300 active store domains.
- **Platform:** kaizenaflow.com and the docs host stay compiled routes of the app.
- **Decided (the owner, 12 November: the recommended way):** Yes. A store's own domain is looked up when the request arrives, in place of decision P8's compiled routing rules; the critic says the server area needs it for an A, and it lifts the ceiling of about 270 domains. It lands in two pushes so the compiled rules stay until the lookup is seen to answer. *Asked:* May a store's own domain be resolved at request time, replacing decision P8's compiled routing rules? If P8 stays, the ceiling still needs an answer before about 250 stores have a domain, and the server area stops at a B.
- **To carry it out:** [steps/2.35.md](steps/2.35.md) (strong)

## 2.36 Send the AI manager a lean default round

Every AI manager call sends 124 tool definitions and a prompt that lists every playbook and the admin map: 161,661 characters whatever the question, up to 11 times a turn. This is code review step 3.18 with numbers: send the core tools, the page's group and the group a router picks from the question, with the rest one load_tools call away. The 17 plan, reminder and saved-skill tools are not carried on every round: they load when the talk turns to them or the store has a plan, goal or reminder alive. The groups are made here and once, taken from the admin map's sections: every area whose tools outside the core are over 12,000 characters has groups, orders included, and the router returns the group of the best-matching page from its first version, never a whole area. Also: list playbooks by feature; make no embedding request before the first model call for a person's few memories. Set the turn's ceiling again from the lean round in the same change: TURN_TOKENS_MAX at most 250,000 (400,000 today). A website's prompt loses at least 2,500 characters and an autopilot step's prompt loses the admin map. If this step and step 2.37 land together, one eval recording covers both. The eval cases of step 1.19 show whether the model still finds its tools.

- **Closes:** [AI-1](../findings/ai-calls/AI-1.md), [AI-9](../findings/ai-calls/AI-9.md), [AI-11](../findings/ai-calls/AI-11.md), [FT-4](../findings/features/FT-4.md), [AI-6](../findings/ai-calls/AI-6.md), GAP-ai-s1, GAP-ai-2
- **Effort:** M. **Areas it moves:** AI calls; The product's surface.
- **Done when:** src/server/ai-round.scan.test.ts draws no first round over 56,000 characters for any of the 20 questions on any page drawn, and the round with no page and no question at 34,000 or fewer once the 17 plan, reminder and skill tools load on demand (161,661 today), for a shop-only store and for one with every feature on. src/lib/tool-router.test.ts finds the needed group for at least 11 of the 18 questions that need one. A lean eval case that needs a tool in another group of the page's own area passes in the committed recording, and agent-eval-replay.int.test.ts passes on it. A case in src/lib/tool-budget.test.ts shows chooseTools() sending at most 12 store tools when no area is asked; a turn of a person with 3 memories makes 0 embedding requests; TURN_TOKENS_MAX is at most 250,000; and the decision that the 17 tools load on demand is a row in docs/decisions.md.
- **Platform:** The platform's assistant runs the same loop, and its 39 tools get the same core-and-area cut.
- **Decided (the owner, 12 November: the recommended way):** The AI manager offers its core tools, the page's group and the group the router picks from the question; the rest is one load_tools call away. Its 17 plan, reminder and saved-skill tools load when the talk turns to them or the store has a plan, goal or reminder alive; the critic says only this is an A for the AI area and the surface. *Asked:* What should the AI manager offer unprompted (question 8 of the code review)? In particular: always carry its 17 plan, reminder and saved-skill tools at about 3,800 tokens a round, or load them when the talk turns to them or the store has a plan, goal or reminder alive (a round with no page then falls to about 33,000 characters)? Only loading them on demand is an A: kept on every round, the AI area and the surface stop at a B on this measure, with the 15,400 characters named.
- **To carry it out:** [steps/2.36.md](steps/2.36.md) (strong)

## 2.37 Slim the tool schemas, so no first round is over 56,000 characters

After the lean round of step 2.36 a first round still carries schema text the model does not need. Drop maxLength, minLength and pattern from the schemas the model sees (5,562 characters in a lean orders round; bounds take 4,006 to 7,654 a round), cut a long tool result so that it is still valid JSON, and split update_product. The page groups that this step first held are made in step 2.36, so the router returns a group from its first version. The scan of step 1.19 already draws every working area's largest page and the planners' 20 questions.

- **Closes:** [AI-8](../findings/ai-calls/AI-8.md)
- **Effort:** M. **Areas it moves:** AI calls; The product's surface.
- **Done when:** src/server/ai-round.scan.test.ts shows no first round over 56,000 characters for any of the 20 questions on any admin page and none over 34,000 with no page and no question, no maxLength, minLength or pattern key in the round's tools and no tool over 2,500 characters outside a named list that only shrinks; the lean eval cases pass in a new recording; and Platform, AI shows a median AI manager call of 15,000 input tokens or fewer, a 90th percentile of 25,000 or fewer and a median turn of 45,000 or fewer over a week of the team's use.
- **Platform:** The platform's tools are grouped by the platform admin's sections in the same map.
- **To carry it out:** [steps/2.37.md](steps/2.37.md) (strong)

## 2.38 Use cached input

No request asks for prompt caching, and a store is charged the full price either way. Step 1.19 already counts cached_input_tokens in commerce.ai_usage, prices them at their own rate and shows them. This step uses the cache: put the fixed part of the round first and the time last, with a fixed tool order and cache markers. A reminder's time must still be right when the clock is the last thing in the prompt.

- **Closes:** [AI-3](../findings/ai-calls/AI-3.md)
- **Effort:** M. **Areas it moves:** AI calls; The product's surface.
- **Done when:** In production a week after the change, select sum(cached_input_tokens)::float / nullif(sum(input_tokens), 0) from commerce.ai_usage where feature in ('ai_manager', 'analytics_question') and kind = 'text' gives at least 0.5, and at least 0.8 on rounds after a turn's first; an eval case that asks for a reminder 'tomorrow at 9' sends the right time; and limits-enforce.int.test.ts counts a month with cached tokens as costing less.
- **Platform:** The platform's own AI usage is priced with cached tokens too.
- **To carry it out:** [steps/2.38.md](steps/2.38.md) (strong)

## 2.39 Give small jobs a quick model

One text model does every job. Move the 8 named small jobs to a quick model (code review step 3.20): the memory pass, tone, the support summary, recommendation order, search understanding, the listing check, category suggestion and highlight words. Each provider gets a default quick model, every completeText call site says main or quick, and the memory pass gets a feature name of its own. Run the agents' eval on the new model, as the conventions ask. Only 3 of the 8 jobs have fixed cases: each of the other 5 gets at least 5. A job moves to the quick model only when its cases pass on it; otherwise the tier list names it as kept on main, with the failing case.

- **Closes:** [AI-7](../findings/ai-calls/AI-7.md), GAP-ai-s4
- **Effort:** M. **Areas it moves:** AI calls.
- **Done when:** A scan test finds no completeText call site without main or quick (33 sites today); a recorded run shows each of the 8 jobs on its cases; in production select feature, model, count(*) from commerce.ai_usage group by 1, 2 shows the quick model on every job that moved, all 8 named; and a week of commerce.ai_usage has 0 rows whose model has no row in commerce.ai_model_prices.
- **Platform:** The platform's provider settings gain the quick model beside the text model.
- **To carry it out:** [steps/2.39.md](steps/2.39.md) (strong)

## 2.40 Keep one file per decision, with a generated index

docs/decisions.md is one 1.33 MB file: 548 lines hold 97.8% of it in lines the search tool cannot show, and a row runs to 18 KB. Split it into docs/decisions/D{n}.md with a generated index of 564 rows that each start with the id and stay under 200 characters, every other line under 500. src/lib/decisions.scan.test.ts holds that no decisions file is over 200 KB; the docs budget of step 1.1 already fails an id that appears twice. The frozen Migration versions list moves to a file of its own. After the split a claimed number is a new file, so two sessions cannot conflict in one table.

- **Closes:** [DC-2](../findings/written-rules/DC-2.md), [AS-8](../findings/files/AS-8.md)
- **Effort:** M. **Areas it moves:** The written rules; The code itself.
- **Done when:** ls docs/decisions/D*.md | wc -l prints 564, awk 'length($0)>500' docs/decisions.md docs/decisions/D*.md | wc -l prints 0 (548 today), no index row is over 200 characters, and src/lib/decisions.scan.test.ts passes.
- **Platform:** The platform's decisions are files like the stores'.
- **To carry it out:** [steps/2.40.md](steps/2.40.md) (cheap)

## 2.41 Retire the frozen Migration versions list and the order to add to it

CLAUDE.md tells every session to record a migration's version in a list that has been frozen since 4 October, so 205 of 564 decision rows carry release notes. The ledger supabase_migrations.kaizen_files already records what was applied and when. Replace the instruction in CLAUDE.md, docs/ci-migrations.md, docs/capacity.md and README.md, and head the list's own file, made in step 2.40, with one line: frozen, the ledger is the record. The advisor check after each migration stays. A clean check is not written down; a new advisor finding is written as a line in docs/audits/psi-followups.md with the migration's file name, and CLAUDE.md's sentence says so.

- **Closes:** [DC-10](../findings/written-rules/DC-10.md)
- **Effort:** S. **Areas it moves:** The written rules.
- **Done when:** rg -n -i "record (the file's|the migration|its) versions?|version recorded in" CLAUDE.md README.md docs/capacity.md docs/ci-migrations.md | wc -l prints 0 (3 today). CLAUDE.md says that a new advisor finding goes to docs/audits/psi-followups.md and asks for no note when the check is clean.
- **Platform:** The platform's tables are migrated by the same files, so the rule is one for both.
- **Decided (the owner, 12 November: the recommended way):** A clean advisor check is not written down any more. Only a new advisor finding is written, as a line in docs/audits/psi-followups.md with the migration's file name; the check itself stays after every migration. *Asked:* After a migration, should 'advisors checked, nothing new' still be written down, and where? The check itself stays either way; today 205 of 564 decision rows carry the note.
- **To carry it out:** [steps/2.41.md](steps/2.41.md) (cheap)

## 2.42 Shorten the gate's type check

The type check is one 8,003-file program: about 3 minutes and a 7 GB heap limit, so Vercel's build cannot run it. Try the native TypeScript 7 compiler beside tsc for a week first, then give the gate tsconfig.app.json without tests if it is still needed, and keep restored build info as the fallback (CI keeps nothing between runs but pnpm's store).

- **Closes:** [TC-4](../findings/tests-ci-build/TC-4.md), [TC-9](../findings/tests-ci-build/TC-9.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build.
- **Done when:** The gate's type check has a median of 60 s or less over ten runs in scripts/ci-budgets.json (about 3 minutes today) under a 4 GB heap limit, from a fresh checkout with no build info too, and the decision row says which route reached 60 s (the native compiler, the app-only config or restored build info); the gate's three steps together take 90 s or less (5 min 11 s today); and Vercel's build runs no second check.
- **Platform:** One gate for stores and platform.
- **To carry it out:** [steps/2.42.md](steps/2.42.md) (review)

## 2.43 Add a related test run for the push

The pre-push rule costs an agent session 11 to 12 minutes of machine time before each push. Add pnpm test:changed, which runs the tests a change can reach, with every directory-reading test named *.scan.test.ts so it always runs. Before a push a session runs lint, the type check and pnpm test:changed. The deploy gate runs the same related tests for the push's commits after its three steps, and the whole unit suite keeps running beside the deploy and reports, as today. CLAUDE.md's Workflow sentence is changed to say so. pnpm check runs that rule through the recorder of step 1.20. pnpm check lints only the files changed against origin/main when no lint cache exists, and the whole tree when eslint.config.mjs or pnpm-lock.yaml changed, so a session's first push runs no cold lint of unchanged files.

- **Closes:** [TC-6](../findings/tests-ci-build/TC-6.md), GAP-build-s4
- **Effort:** S. **Areas it moves:** Tests, CI and the build.
- **Done when:** pnpm test:changed after a one-line change in src/lib runs fewer than 250 files (1,215 in a full run). In a fresh clone with no caches, pnpm check after a one-line change in src/lib takes 5 min 30 s or less if the native compiler passed its trial in step 2.42; otherwise the recorder shows that only the cold type check is over its line, which is the stated tolerance (about 3 minutes, so about 7 min 30 s). A second run takes 2 minutes or less. The gate with the related tests has a median of 3 min 10 s or less in scripts/ci-budgets.json (90 s plus at most 100 s for the related run), and a trial push with a failing unit test the change reaches deploys nothing. CLAUDE.md states the rule and the decision is a row.
- **Platform:** One gate for stores and platform.
- **Decided (the owner, 12 November: the recommended way):** The way the panel suggests in the build's card. Before a push a session runs lint, the type check and the tests the change can reach (about 2 minutes); the deploy gate runs the same related tests after its three steps (about 2.5 to 3 minutes in all), and the whole unit suite keeps running beside the deploy and reports, as today. It is the cheapest to run, the gate checks more than today's six money files, and going back is one sentence in CLAUDE.md and one line in ci.yml. *Asked:* What must run before a push? A: everything, as today (about 5 minutes after these fixes; 11 to 12 now). B: lint, the type check and the tests the change touches, with the whole unit suite in the deploy gate, so each deploy waits about 3.5 minutes more (the planner's advice). C: as B before the push with the gate unchanged, so a failing unit test outside the six money files can be live until someone reads the red run.
- **To carry it out:** [steps/2.43.md](steps/2.43.md) (review)

## 2.44 Show by trial whether component and database tests need a fresh worker

After step 0.39, three quarters of the unit run is 281 component and database files that no finding examined: 0.74 s and 3.0 s a file. Run two trials in the Vitest config of that step. One: the components project with isolate off, three runs, one of them shuffled; keep it if every file passes and the 22-file sample falls from 16.3 s to 10 s or less. Two: split one database file's time into worker start, PGlite start, template load and tests; if PGlite's start is over 0.5 s a file, try the db project with isolate off. Then lower the unit run's ceiling to the result.

- **Closes:** GAP-build-3
- **Effort:** S. **Areas it moves:** Tests, CI and the build.
- **Done when:** A decision row holds both trials' results, and the full unit run takes 3 min 30 s or less where it took 5 min 34 s, with its ceiling in scripts/ci-budgets.json lowered to the new median plus 25%.
- **Platform:** Test code only: nothing differs for the platform.
- **To carry it out:** [steps/2.44.md](steps/2.44.md) (cheap)

## 2.45 Cut what the largest paint waits for on a themed page

No themed store page has been shown at 90 on a slow phone: kaizenaflow.com scored 83 to 88 with its largest paint at 3.7 to 4.3 s, and 90 needs roughly 3.3 to 3.5 s. The plan's other cuts take about 26 KB compressed off some 400 KB that the largest paint waits for. When step 1.14 has a week of figures, block the fonts, the scripts and the stylesheet in turn on the launch-theme store's home, product page and listing in production, and write the largest paint each time into docs/performance.md. Then cut what the table names until the line holds. The evidence so far points at fonts (without them the same page scored 93): preload only the family the first screen draws, cut each family's file to the letters the store's languages use, and keep the cart drawer's prefetch out of the first three seconds.

- **Closes:** GAP-shopper-browser-s1
- **Effort:** M. **Areas it moves:** What a shopper's browser gets.
- **Done when:** The nightly job of step 1.14 shows a median of 90 or more and blocking time of 200 ms or less on the launch-theme store's home, product page and listing and on Kaizena Flow's front page for seven nights in a row, the blocking table is in docs/performance.md, and font bytes before the largest paint are held as a budget in the nightly file.
- **Platform:** Kaizena Flow's front page is one of the four pages the nightly job reads, so it is held to the same line.
- **To carry it out:** [steps/2.45.md](steps/2.45.md) (strong)

## 2.46 Keep schemas apart from the helpers beside them, so zod loads only where a screen runs one

After step 0.9 zod (116,870 bytes) is still on about 144 admin routes, though only 4 of 332 admin client files call a schema. It arrives because a helper or a constant shares a file with a schema: 145 files under src/lib import zod, and admin components import 67 of them directly. Where a client part takes only a helper or a constant, move the schema into a file of its own beside it. Start with the product editor, which carries about 290 KB this way, then src/lib/custom-fields.ts (23 importers) and product-input.ts (18), then theme.ts, motion.ts, visibility.ts, colour.ts and typography.ts. The import walk of step 1.4 then lets zod be reached only from a named list of client modules, each with the schema it runs. Do it after step 1.4. Effort is M to L.

- **Closes:** GAP-owner-browser-s1
- **Effort:** L. **Areas it moves:** What an owner's browser gets.
- **Done when:** After pnpm build, 'ZodError' is in the first-load chunks of at most 60 routes (432 today, about 144 after step 0.9), /admin/[store]/products/[productId] is at or under 1,100,000 bytes in .next/diagnostics/route-bundle-stats.json (2,130,796 today), and admin-bundle.scan.test.ts names each client module that may reach zod with the schema it runs and fails for a new one.
- **Platform:** The platform admin's screens are among the routes counted, and the shared src/lib files are split once for both.
- **To carry it out:** [steps/2.46.md](steps/2.46.md) (strong)

## 2.47 Take the order writer off pages that only show products

After every other cut the product page still reaches about 1,930 modules, and a listing, the search, the cart and the checkout about 1,995. The cause: src/app/s/[store]/[market]/cart/actions.ts imports startCheckout and startExpress at its top, so every page with an Add to cart button loads the order writer, and with it draft orders, emails, staff alerts, billing and the books. Load checkout.ts, the alert and email senders and the Stripe SDK inside the action that uses them, split src/server/express-checkout.ts into its facts and the press, and let step 2.9's per-route sections serve the server side too. Do it after steps 2.9 and 2.22, one file's edges per commit, with a test order placed after each deploy: the cuts are on order and payment paths. The product page, a category, the search, the cart and the checkout become entries of the graph test and of scripts/route-budget.mjs.

- **Closes:** GAP-server-s1
- **Effort:** L. **Areas it moves:** What the server loads and asks.
- **Done when:** src/server/route-load.graph.test.ts shows the product page, a category and the search reaching none of src/server/checkout.ts, stripe.ts, ledger.ts, staff-alerts.ts or billing.ts; a next analyze export shows those three at or under 1,800 modules and 4.8 MB, and the cart, the checkout and the account at or under 1,800 and 5.0 MB (2,516 to 2,546 modules and 12.3 MB today); each is an entry of the graph test and of scripts/route-budget.mjs; and the checkout, express checkout and quote specs pass.
- **Platform:** Kaizena Flow's own store runs on the same routes (D484), so its product pages lose the same imports.
- **To carry it out:** [steps/2.47.md](steps/2.47.md) (strong)

## 2.48 Give a placed order a ceiling, and stage placeOrder where the first figures are over it

Step 1.12 counts what one placed order writes, but the count has no ceiling and nobody has judged it. Read that step's figures and the per-trigger times, and write four ceilings into docs/performance.md and the write budget: the same statements with 10 and with 2,000 earlier orders in the store, at most 3 more for each added line, triggers under a fifth of the order's database time, and a counted visit at most 3 statements and 2 rows. A fifth line is the surface's: the optional features' triggers together take under 2 ms of a shop-only store's paid order, or the slowest get a first-line test of the store's switch. Where a figure is over, do code review step 3.7 for that part: multi-row inserts for lines and holds, and a trigger that probes a switched-off feature folded into one gate. Do it after step 1.12.

- **Closes:** GAP-database-s7, GAP-surface-s5
- **Effort:** M. **Areas it moves:** The database; The product's surface; What the server loads and asks.
- **Done when:** The write budget of step 1.12 asserts the four ceilings and the 2 ms line and passes in pnpm test:int, and it fails on a scratch per-line statement added to insertOrderLine() in src/server/order-insert.ts.
- **Platform:** placeOrder serves every store, Kaizena Flow's own store among them; the platform's plan billing goes through Stripe and writes no shop order.
- **To carry it out:** [steps/2.48.md](steps/2.48.md) (strong)

## 2.49 Load motion.css where a page uses it

src/app/motion.css is 18.7 KB raw and 3.4 KB Brotli, a sixth of the site's sheet, and no launch theme uses it, so every store pays for it at opening. The reading that decides is step 1.23's, taken now on the six launch themes and the team's 60 stores, not one taken a quarter after opening. If under half of published store pages need the sheet, build it: a prebuild step writes motion.css under a hashed name, MotionSupport (src/components/motion-support.tsx) links it when the page, header or footer needs it, the site's entry drops the import and the admin's keeps it, and a test ties every [data-fx-*] selector to a code path that sets the flag. If half or more need it, the step is not built and the sheet stays as the stated tolerance, with that figure written beside it. Do it after step 2.11.

- **Closes:** GAP-styles-s4, [CS-2](../findings/styles/CS-2.md)
- **Effort:** M. **Areas it moves:** Styles; What a shopper's browser gets.
- **Done when:** A store page without builder motion links no motion stylesheet, the site's sheet is at most 116,500 bytes raw and 17,400 Brotli with the budget of step 1.3 lowered to it, and e2e/motion.spec.ts and e2e/animation.spec.ts pass; or docs/performance.md holds step 1.23's reading that half or more of published store pages use motion, with the sheet named as the tolerance.
- **Platform:** Kaizena Flow's own pages are drawn through the same MotionSupport, so a platform page with motion links the sheet and one without does not.
- **To carry it out:** [steps/2.49.md](steps/2.49.md) (strong)

## 2.50 Let a catalogue file be imported by its area module only, and import no code

After step 2.25's codemod, 218 modules still import a file of src/lib/admin-messages directly (68 outside the admin folders, 150 inside), for English constants and fallbacks such as words ?? experimentsEn. With those left, a median admin page reaches 30 areas and 1.31 MB against 18 and 0.9 MB, a store page 21 files against 8, and the visit beacon 2 against 0. Each of the 218 takes its words as an argument or reads the area's module, and an English constant that server code, the AI manager or a test reads moves to a small label module beside its readers. The 36 value imports inside 14 catalogue files go in the same step. Do it after steps 2.25 and 2.26.

- **Closes:** GAP-text-s1
- **Effort:** M. **Areas it moves:** Interface text; What the server loads and asks.
- **Done when:** admin-text-reach.scan.test.ts lists no importer of src/lib/admin-messages but the area modules, the common words' context file and tests (218 today); the proxy and every beacon reach 0 catalogue files and the storefront layout at most 8 files and 0.21 MB; a median admin page reaches at most 18 areas and 0.9 MB and none over 28 areas and 1.66 MB; a next analyze export shows /admin/[store]/orders at or under 6.5 MB of server code (12,068 KB today); and the walk of src/lib/admin-messages/imports.scan.test.ts from every catalogue file reaches no zod, no component and no file of src/server.
- **Platform:** The platform admin's pages and Kaizena Flow's own site read the same catalogues, so their entries are in the same scan and fall with the stores'.
- **To carry it out:** [steps/2.50.md](steps/2.50.md) (strong)
