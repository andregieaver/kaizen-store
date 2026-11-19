# page-model: The page builder's model and a built page's render

The page model itself is lean: a stored page is about 340 bytes a block and a two-block page's own markup is 1.6 KB. The waste is in how pages are read, cached and wrapped: every storefront document carries the layout twice (27 KB), 45 of the demo store's 261 built entries keep a copy of every page of the store to find one page or one title, and all 261 carry one cache tag, so publishing one page makes the whole store's site render again. The owner filter `is not distinct from` cannot use an index (60,000 rows read to return 27 on a test table) and a five-minute job re-reads every published page of every site with chat on. None of this rests on a feature being unused: each cost grows with stores, pages or products, and each is cheapest to change before opening.

## Measures
- Block types and sub-parts: 37 block types; 83 sub-parts (20 product, 14 site, 42 shop, 7 theme store)
- Settings in the model: 197 distinct top-level keys; 842 summed over the 37 types; 303 optional fields and 35 with a default
- A realistic stored page: Orbit theme home: 6 rows, 31 blocks, 10,549 B of JSON (340 B a block); ids 20%; per-size values 101 B. Production: pages 9.1 MB for 1,389 rows, page_versions 5.4 MB for 642 (a page keeps up to 50 versions)
- Cost of reading one stored page: 0.80 to 0.93 ms of zod for three theme home pages of 10.5 to 13 KB; 0.2 ms for Orbit's 1.5 KB product layout; 73 parsePageContent call sites in 29 files
- A two-block page as a visitor gets it (/s/demo/no/om-oss): 110,415 B document; the page's own markup 1,583 B; payload 69,548 B
- Second copy of the layout in the payload: 27,070 B on every captured storefront document: 38.9% of /om-oss, 31.6% of the home page; 0.3 to 1.3 KB once compressed; none on Kaizena Flow's own front page
- What moves to fix it: 22 route folders and page.tsx; 26 files import from the folder through the alias (44 lines); 17 test files name the folder
- listPublishedPages in production: 79,778 calls, 29 rows a call, 2.33 M rows, 781 s: cache misses from deploys, crawlers and tests, not shoppers
- Built entries that keep the whole page list: 45 of the demo store's 261 prerendered entries (30 product pages, 9 blog, 3 products, 3 home), 117,432 B, 4.6% of all their resume data
- Built entries that carry the store's one pages tag: 261 of 261 (45 carry the catalogue's tag); 17 cacheTag places in 13 files read under it; 55 places in 31 files refresh it
- Owner filter and the index: `store_id is not distinct from $1`: Seq Scan, 59,973 rows removed to return 27. `store_id = $1`: index scan, 27 rows. 122 uses in 40 files of src/server
- Knowledge job: 542 ms of each five-minute run; 91,200 delete calls that removed 782 rows in all (about 1,170 a day); about 24,100 calls of the page statement at about 40 whole pages a call
- Products grid sent twice: 16,702 B streamed copy (18 product links, 9 pictures) in 55,163 B of markup on /s/demo/no/products; no such block on the home page
- Page editor's inline interface text: 276,922 B in one payload row, 76% of the editor's payload and 85.5 KB of its 135.7 KB gzip; at least 74,898 B (27%) is in branches no client file that asks for the area names
- Client scripts on every store page whatever its blocks: layout group: 7 chunks, 213,284 B raw, 72,978 B gzip; product page: 12 chunks, 315,368 B raw, 107,369 B gzip, one of them (28,584 B) the cart's
- Server code behind the page renderer: 1,396 modules and 21.1 MB of source reachable from page-article.tsx; built store home 12,230,360 B, of which the page model 61 KB, six signature themes 128 KB, the builder's block words 111 KB
- Writers of page documents: 9 insert statements in 4 server files, at least 18 update statements in 10 files, 4 SQL functions in the baseline, the seed; the pre-D179 grid shape is still written by 6 source files and the seed
- Signature themes' product layouts: 1,362 to 1,504 B as written, 13 blocks in 2 rows, in each of the six themes; Orbit's 1,485 B as stored

## Well made
- Stored page JSON is sparse: 303 optional settings stay absent, per-size values exist only where set (101 B in the 10.5 KB Orbit home), pictures are addresses never data, and the limits hold (100 blocks, 50 rows, 50,000 characters of HTML). 35 fields have a de…
- No stored setting was found without a reader, but the scan behind this is a token match on key names and cannot prove it for every block.
- A block's markup is lean: the two-block page's main is 1,583 B, the whole storefront document has one inline style attribute, and per-size differences are CSS classes, not duplicated markup.
- Picture enrichment is batched and never saved: withPageAlts() reads alt texts and small copies for all pictures of the pages it is given in one query, and asks nothing for a page without pictures (src/server/media-alts.ts:26-55).
- Page versions cost only when used: the same content is not stored again (md5 compare), a page keeps its newest 50, and the list reads titles only (src/server/page-versions.ts:22-45, src/lib/page-versions.ts:6). 50 whole copies is a product choice about how fa…
- Saving a page is one person's press: the builder has no autosave (no timer or debounce in src/components/admin/page-builder.tsx), and a draft save does not refresh the site's cache (pages/actions.ts:107).
- Interactive block parts load only where drawn: 19 lazyView stand-ins in src/components/lazy/blocks.tsx; the page model is kept out of visitor scripts by a scan test (docs/performance.md).
- Who sees a part costs nothing unless conditional, and then little: Always and Never are decided without a hole; a condition reads only the kinds of fact it asks about, each once per request (src/components/visible-part.tsx:16-27, src/server/visibility.ts:45-7…
- A header or footer built in the builder is read as one row by its id (src/server/site-layouts.ts:28-45), and findPublishedPage() reads one row; a page at its own address keeps only itself in its resume state (1,155 B on /om-oss).
- Content grids are capped at 48 items and cached by tag (src/server/content-grid.ts:278). A grid of pages or articles still reads each item's whole document for a card; PM-2's light read and PM-6's columns cover it.
- The chat agent is off unless a store turns it on (chat_agents.enabled defaults to false), so the knowledge job does nothing for a store without chat; its waste is in what it repeats for those with it (PM-3).
- The admin's English catalogue is no longer bundled as a fallback (D540, docs/performance.md:183), so the editor's inline texts (PM-10) are not a second copy of something in the scripts.
- The page studio's prompt and patterns are small per call and run only when someone asks (judged clean by the AI dimension; nothing in this dimension contradicts it).

## Findings (16)

### PM-1 [P1 M duplicate confirmed] Every storefront page renders and ships the whole layout twice, because the cart drawer's slot sits on the root layout
- evidence: Next's own code, read again in this pass: a root layout that has `children` and one more slot is wrapped in a boundary whose notFound value is the root layout drawn a second time around the not-found page (create-component-tree.js:551 and :659-670; its comment says it 'renders the RootLayout twice'). The market layout is a root layout and takes `drawer` (layout.tsx:104, :214). Re-run in this pass with the skeptic's …
- cost: 27 KB raw in every storefront document (0.7 to 1.3 KB gzip, about 0.3 KB Brotli, because it repeats), the same again in every layout segment file (54.7 KB against the page's 9.3 KB), and the header, footer, menus, the l… (The server per render (most); a shopper's browser (parse and memory, little on …)
- fix: 8 steps; first: 1. Apart and at once (S): in src/server/cart.ts:544 run getCartCount()'s body through perRequest('cart-count:' + shop.storeId + ':' + shop.market.slug, ...) from src/server/request-memo.ts, so the header's and the bottom bar's cart link share one query a requ…
- done when: node work/pmsk/nf2.mjs on a capture of the new build's /s/demo/no/om-oss prints 'no layout-level notFound copy' (today: 35 rows, 27,070 bytes), with e2e/cart.spec.ts and e2e/page-roles.spec.ts passing.
- saving: Measured: 27 KB raw off every storefront document and about half of the 54.7 KB layout segment; 0.3 to 1.3 KB on the wire. One of two layout renders at prerender and on every dynamic request (not timed). Estimate: more in production, where headers and footers…
- after: nothing
- notes: The same finding as SC-8 (storefront scripts) and PL-2 (page payload): do it once. Step 1 is safe today and belongs with the P0 items. Cheapest before opening: nothing but imports depends on these folders, and nobody holds a cached segment. If the storefront'…

### PM-2 [P0 M oversize confirmed] Finding one page, or a title, loads every published page of the store with its whole content
- evidence: listPublishedPages() (pages.ts:664-679) selects `published` for every page of a type, runs the full schema on each, then asks the media library about every picture of every page. My rg: 37 lines in 22 files outside tests (the definition and one comment among them), so 35 calls. 13 pick one page by id; others want slugs or titles. New in this pass: every product page calls it for one title, the back link to All produ…
- cost: Per cache miss: every page's JSON from the database, about 0.9 ms of zod per realistic page (about 26 ms for a 29-page store, estimate) and one pictures query naming every picture of the store. Per hit: decoding the who… (The database; the server per cold instance, per render and per resume; the build)
- fix: 6 steps; first: 1. src/server/pages.ts: add publishedPageById(owner, id, type = 'page'): 'use cache', cacheLife('hours'), cacheTag(pagesTag(owner)); one row (id, slug, published, published_at, first_published_at) where id = the id, the owner's filter written the indexable wa…
- done when: node work/pmplan/rdcall.mjs .next/server/app/s/demo after a build reports withList: 0 (45 of 261 today), and rg -c 'listPublishedPages\(' src --glob '!*.test.ts' sums to at most 14 lines (37 today).
- saving: Estimate: a render that needs one page reads 1 document where it reads all of them today (about 29 to 1 on production's average), and no prerendered page keeps the store's other pages (117 KB over the demo's 45 entries, measured). How much of production's 781…
- after: PM-4 (the owned() helper, so the new reads are born indexable; not needed for the saving itself)
- tracked: no (code review step 3.9, FF2 and FF5, Open, is the same pattern for the catalogue, not for pages)
- notes: The same change as CA-3 (caching), DQ-2 (queries) and SD-4 (storefront data); the function names here are theirs, so it is done once. It is also the first half of PM-15: once no drawn content comes from the list, a page can carry its own cache tag.

### PM-3 [P0 S eager confirmed] The five-minute knowledge job reads and parses every published page of every site with chat on, and re-cuts wordless pages for ever
- evidence: syncPageKnowledge() selects `p.published` for every published page and article with two sub-selects each (knowledge.ts:170-176), runs the full schema on each (:182) and only then compares versions (:187). A page that cuts to no passage (cutPassages returns [] for no text, lib/knowledge.ts:63-65) never gets a row to carry its version, so every run cuts it again: a transaction with a delete and no insert (:248-256). P…
- cost: 542 ms of each five-minute run today, for one or two sites. It grows with sites with chat on times published pages, every 300 s, changed or not: 1,000 such stores of 30 pages would pull about 30,000 documents and spend … (The database; the server per scheduled run)
- fix: 7 steps; first: 1. src/db/schema.ts, then pnpm db:generate: a table commerce.knowledge_sources (store_id uuid null references stores on delete cascade; page_id uuid null unique references pages on delete cascade; entry_id uuid null unique references content_entries on delete…
- done when: A new case in src/server/chat.int.test.ts runs syncPageKnowledge twice over a store with a wordless published page and counts zero rows read from `published` and zero transactions on the second run; on production a day after the deploy, the calls of 'delete from commerce.knowledge_chunks where page_id = $1' grow by fe…
- saving: Estimate: on a run where nothing was published the job's page work falls to two light statements a site (pages, entries) and no document; the empty transactions stop (91,200 in 78 days, measured).
- after: nothing
- notes: The same job as DQ-6 (queries), DS-5 (schema), CR-4 (cron) and AI-5 (AI); the table's name is theirs. This version needs no hourly net, because the address is worked out from the blogId without the document. Step 3 alone is a few lines and removes the empty t…

### PM-4 [P0 S oversize corrected] Page reads filter the owner with `is not distinct from`, which no index can serve
- evidence: ownedBy() is `store_id is not distinct from $1 and type = $2` (pages.ts:71); findPublishedPage(), publishedPageNames(), usesRememberedModals() and the grid of pages use the same form. The skeptic proved it on PostgreSQL 18.6 (PGlite) with a pages table of the same two unique keys and 2,000 owners of 30 pages: with `is not distinct from` the list query is a Seq Scan that removes 59,973 rows to return 27; with `store_…
- cost: Invisible at 1,389 rows. Every page lookup that misses the cache reads every store's page rows: 300,000 rows a lookup at 10,000 stores of 30 pages; the modal check walks the whole table to find one store's pages; openin… (The database)
- fix: 6 steps; first: 1. New src/server/owned.ts: export const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`), with a comment that it is the one way to filter a store's or Kaizena Flow's own rows. …
- done when: rg -c 'store_id is not distinct from' src/server --glob '!*.test.ts' sums to at most the commented column-to-column lines left (122 in 40 files today), the ratchet holds that number, and the skeptic's EXPLAIN (work/pmsk/pg.mjs) run with pages.ts's new list statement shows an index scan on the store's rows.
- saving: Measured on the test table: 60,000 rows read falls to 27 for the list, and 1,204 buffer pages to about 30. Nothing today at 1,389 rows; the saving arrives with stores.
- after: nothing
- notes: The same change as DQ-8 (queries) and DS-7 (schema); do it once, and first, because PM-2, PM-3, PM-5 and PM-6 write new reads that should use the helper from birth. It is the clearest cost in this dimension that grows with the number of stores, and with no re…

### PM-5 [P1 S oversize confirmed] The admin's page lists, pickers and AI tools read and parse the draft and the published copy of every page to show titles
- evidence: listPages() selects `draft, published` for every page of a type (pages.ts:136-140), runs the full schema on both and compares them with two JSON.stringify calls (samePageContent, page-content.ts:4317) to get a title, a state and a thumbnail. My rg: 16 call sites. Several keep only id and title (pages/actions.ts:408, admin/try/[sandbox]/actions.ts:219), one only slugs (shopify-copy.ts:555); the AI manager's list_page…
- cost: Per call: two documents a page from the database and about 2 ms a page of parsing and comparing (estimate from 0.9 ms a parse). A 30-page store is about 60 documents and 55 ms; 100 pages about 2 MB and 190 ms, to draw a… (An owner's admin; the database; an agent's session (the AI manager's page tools))
- fix: 4 steps; first: 1. src/server/pages.ts listPages(): read the list's fields in SQL, no document: id, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title (the fallback readDraft() gives a draft that does not parse), draft -> 'thumbnail' ->> 'url', the two flags from c…
- done when: rg -n 'select id, slug, draft, published' src/server/pages.ts shows the statement only in getPageForEdit(), and the new case in src/server/pages.int.test.ts passes.
- saving: Estimate: a 100-page list falls from about 2 MB and 190 ms to a few KB and a few ms; each AI tool call that lists pages the same.
- after: PM-4 (the owner's filter in the new statement)
- tracked: no (code review step 1.13, one way to search and page a list, Open, is about paging; this is about what a row reads)
- notes: The same read as AD-14 (admin data), which also orders the list view's other reads; do it once. Runs only in the admin and for agents.

### PM-6 [P1 M eager confirmed] Facts about a page are dug out of its JSON on each read; the table has no column for them
- evidence: `pages` holds an id, a type, a slug, two JSON documents and dates (schema.ts:8785-8806). usesRememberedModals() runs jsonb_path_exists over every published page of a site for one yes or no (page-modals.ts:20-26); the consent banner asks it on every page outside the pay routes (site-consent.tsx:52 through siteCookies): 68,878 calls and 121 s in production. publishedPageNames() pulls each title out by path for the men…
- cost: Two of production's most-called statements; each opens every published document of the store (and, until PM-4, passes over every other store's rows). Both are under `use cache`, which runs once per cold instance per sto… (The database; the server per cache miss)
- fix: 6 steps; first: 1. First PM-4 and PM-2: they confine both reads to the store's own rows and take most callers off whole documents, with no migration.
- done when: rg -n "published (->>|#>>)|jsonb_path_exists\(published" src/server/pages.ts src/server/page-modals.ts prints no line inside publishedPageNames() or usesRememberedModals(), and the new cases in src/db/commerce.test.ts pass.
- saving: Estimate: after PM-4 each call reads about 30 documents instead of the table; with the columns it reads none. Not measured.
- after: PM-4; PM-2
- notes: The verified report proposed columns written when a page is saved and named the risk itself (a second source of truth). Counting the writers in this pass (about 30) settles it for columns the database derives, as DS-4 (schema) also plans; do it once. The savi…

### PM-7 [P3 S duplicate corrected] Each row repeats the same stylesheet text in the payload and the same cached store lookups
- evidence: RowView draws PartStyles for its one row (page-article.tsx:223), and a store's PartStyles draws the breakpoint sheet again (part-styles.tsx:40-48), though the layout already drew it (store-theme.tsx:31). React keeps one copy in the HTML head, but the payload carries the text each time: in the captured one-row page the 1,760 B sheet is three text rows (the layout's, the layout's second copy from PM-1, and the row's).…
- cost: Orbit home: about 15.5 KB of style text in the payload against 4.8 KB if sent once (computed from the generated CSS, not from a rendered page). Almost none of it reaches the wire: a repeated breakpoint sheet costs 15 to… (The server per render; a shopper's browser, slightly)
- fix: 4 steps; first: 1. src/components/part-styles.tsx: give PartStyles a `bare` prop that leaves the BreakpointSheet out, for rows drawn inside a store's layout, which draws that sheet itself (store-theme.tsx:31). Previews in the admin keep it.
- done when: node work/pmsk/trows.mjs on a capture of a seeded six-row page (PM-14's page) counts the 1,760-byte breakpoint sheet once (the layout's), whatever the number of rows; today it is the layout's, the layout's second copy and one more per row.
- saving: Computed for the Orbit home: 10.7 KB raw of payload and 1.9 KB of HTML style; well under 0.5 KB on the wire (estimate). Cached reads fall from six a row to three a page.
- after: PM-1 (removes one of the three copies of the breakpoint sheet by itself)
- notes: True, and close to nothing for a visitor once compressed: the skeptic measured 15 to 18 B gzip a repeat. Not worth a change of its own; do it when page-article.tsx is next opened, for instance with code review step 3.2. CS-4 (stylesheets) is the same finding.

### PM-8 [P1 M duplicate confirmed] A product grid with Filter and sort is sent twice when nothing is chosen
- evidence: The grid is the Suspense fallback in the prerendered shell (content-grid-section.tsx:40-44), and FilterableGrid streams a second grid in its place on each request. With no filter on page 1 the second holds the same items (`unfiltered && page === 1 ? null`, then `data.items`, :86-97, drawn again at :116). Re-run in this pass (work/pmsk/grid.mjs on the captured /s/demo/no/products): the streamed block S:1 is 16,702 B …
- cost: 16.7 KB of markup on a store's main listing, and its twin in the payload; 2.5 KB gzip or 1.0 KB Brotli of the document. More important: the server draws every tile again on each request and the browser swaps the built g… (The server per request; a shopper's browser)
- fix: 6 steps; first: 1. src/components/content-grid-section.tsx: change the shape at :40-46 from one boundary whose fallback is the grid to three siblings in one `flex flex-col gap-4` box: (a) <Suspense fallback={null}> around a new async ListingTop, (b) the built grid in a wrapp…
- done when: node work/pmsk/grid.mjs on a capture of the new build's /s/demo/no/products counts 3 product links in its streamed blocks, as on the home page (21 today: block S:1 alone holds 18 in 16,702 bytes), and e2e/listing.spec.ts and e2e/products-page.spec.ts pass.
- saving: Measured: 16.7 KB raw of markup on the demo's /products (30% of its markup), 1.0 to 2.5 KB on the wire, plus its twin in the payload (estimate) and one grid render per request.
- after: nothing
- tracked: no (code review step 2.15, FF6, Open, plans filters without script and touches the same file)
- notes: PL-6 (page payload) is the same finding. The listing is a store's busiest built page once shoppers arrive, so the per-request second render is the part that will grow. Do it with step 2.15 if that step is taken up first.

### PM-9 [P2 M eager corrected] Every read of a stored page runs the editor's whole input schema and the old-shape upgrades
- evidence: parsePageContent() is pageInput.safeParse (page-content.ts:4305): the editor's schema with its checks and the preprocess steps that turn shapes from before D179 and D180 into today's (:4049, :4083, :4108, :4146, :4189). 73 call sites in 29 files. Measured by the skeptic: 0.80 to 0.93 ms for three theme home pages, about 15 times JSON.parse; about 35 to 40 ms to load the module and build its schemas in a cold process…
- cost: About 0.03 ms a block on each uncached read, and up to about 35 ms of each cold start of a function that imports the page model (most do; estimate). The larger cost is to whoever changes the model: three shapes to keep … (The server per cache miss and per cold start; an owner's admin; the team (upkee…)
- fix: 5 steps; first: 1. Make the writers write today's shape: src/lib/content-pack-pages.ts:77 and :162, src/lib/signature/kit.ts:85, src/lib/signature/meridian.ts:371 and the same field in atelier.ts and kinetic.ts (rg 'mobile: ?[0-9], ?tablet' src/lib --glob '!*.test.ts'), and …
- done when: node scripts/page-shapes.mjs prints 0 documents that differ from their parse on a freshly seeded database and on production, and rg -c 'upgradeRow|upgradeBlock|upgradeLegacy|upgradeResponsive' src --glob '!*.test.ts' prints nothing.
- saving: Estimate: about 240 lines of upgraders and parts of seven test files, and one stored shape instead of three. Run time: under 1 ms a page per uncached read; nothing a shopper would notice.
- after: Code review step 3.2 (one definition per block, Open) reshapes the same file: do step 4 inside it or right before it
- tracked: partly: code review step 3.2 (FB6 and FB9, Open) reshapes the same file but not the read path
- notes: Worth doing for the model's upkeep, not for speed. Step 1 is the part that should not wait: until the themes and packs write today's shape, every new store can add old-shaped documents. DD-9 (unused code) is the same finding and says no living code writes an …

### PM-10 [P1 S oversize confirmed] The page editor's document carries 277 KB of interface text inline
- evidence: Re-run in this pass (work/pmsk/admin.mjs on the captured editor): one payload row of 277,530 B whose texts object is 276,922 B, the eleven areas handed to AdminTextScope (builder 73.1 KB, blocks 55.8, website 46.1, products 26.2, fields 24.4, design 23.6, storeParts 7.0, schedules 5.5, blog 4.7, backdrops 2.8, animation 1.5). That is 76% of the 365,427 B payload and 85.5 KB of the document's 135.7 KB gzip; the page …
- cost: 277 KB raw and about 85 KB compressed in every load of the editor (the document is 585 KB), which the browser cannot keep as it would a script. At least 75 KB of it (about 23 KB compressed, estimate) is words no part of… (An owner's admin)
- fix: 5 steps; first: 1. src/lib/admin-text.ts: add derived areas, each a pick of an existing catalogue in every admin language, with its own type in AdminAreaMessages and its entry in CATALOGUES (no string moves between files): websiteEditor (list, media, picker, pictureMaker of …
- done when: node work/pmsk/admin.mjs on a capture of the new build's page editor reports a texts object of at most 205,000 bytes (276,922 today), and e2e/signed-in/admin-text-fallbacks.spec.ts passes.
- saving: Measured lower bound: 74,898 bytes raw off each editor document from steps 1 to 3 (about 23 KB compressed, estimate). Estimate: 150 to 200 KB raw once step 4 brings a component's words with its dialog.
- after: AC-4's derived areas (admin scripts dimension) use the same mechanism; whichever is done first adds it
- tracked: The direction is: PSI PERF-01 (done, with a 'left' list) and code review step 3.4 (FB8, Open). The size of the inline text and the unread share are new.
- notes: Effort S is for steps 1 to 3; step 4 is part of 3.2 and 3.4. PL-1 (page payload) and AC-4 and AC-5 (admin scripts) look at the same document from the other side: AC-4 leaves the editor's four big areas whole, which is what this narrows. An owner pays this on …

### PM-11 [P0 S eager corrected] A product page's first scripts carry the cart's parts through one import, and every built page a few parts it does not hold
- evidence: Turbopack groups every client component a route's server code imports (docs/performance.md:38-41). Sized by the skeptic from the built manifests: the store layout's group is 7 chunks, 213,284 B raw, 72,978 B gzip, on every page; the product page's is 12 chunks, 315,368 B raw, and holds one 28,584 B chunk (8,239 B gzip) that is also the cart page's and holds the checkout button. Read in this pass: product-parts.tsx:1…
- cost: On a product page: most of the 28.6 KB cart chunk (8.2 KB gzip) that nothing on the page draws. On any built page: about 14 KB minified (carousel 5.2, page-modal's library 4.7 for one function, theme preview stage 4.5).… (A shopper's browser)
- fix: 6 steps; first: 1. New server file src/app/s/[store]/[market]/cart/cart-view.ts starting with import 'server-only': move cartView(), loadCartView() and the types CartView and Filled out of cart-contents.tsx (:64-70 and the loader below them) with the imports they use. cart-c…
- done when: SHOW=1 node work/pmsk/crm.mjs on the built page_client-reference-manifest.js of p/[handle] and of cart: no chunk outside the layout's seven is in both pages' entries (today one, 28,584 bytes, with the checkout button), the product page's entry is at most 297,000 bytes raw (315,368 today), and the new import walk passe…
- saving: Estimate: about 20 KB raw (about 6 KB gzip) off every product page from steps 1 and 2, and about 14 KB minified (about 5 KB gzip) off every built page from steps 3 and 4.
- after: nothing
- tracked: docs/performance.md (D211, D461) sets the rule and the lazy stand-ins; the cart import (since D558 of 10 November) and these three modules are what is left
- notes: Steps 1 and 2 are SC-4's first step (storefront scripts) and steps 3 and 4 are SC-11's; do each once. The product page is the page shoppers land on most, and the import arrived one day before this review inside the budget's 5% of room, which is PM-14's point.

### PM-12 [P2 L eager confirmed] The page renderer and the page reader pull in the code for saving pages and most of the server
- evidence: The skeptic's static walk of imports from page-article.tsx (type-only imports left out, stopping at client components) reaches 1,396 modules and 21.1 MB of source; from pages.ts alone 1,307 modules and 20.5 MB, and 357 modules and 7.0 MB once taxonomy.ts and visibility.ts are dropped. pages.ts keeps the site's three reads beside savePage, the checker, fonts, audit and redirects (its imports at :31-49). Read in this …
- cost: A cold start of any storefront function loads about 12 MB of server code; the page model itself is 61 KB of it. Not timed. (The server per cold start; the build)
- fix: 4 steps; first: 1. First and small: move the cache-tag builders (pagesTag, PAGES_TAG) to a leaf module with no imports (src/server/tags.ts, which SG-2 also asks for) and import them from there in page-modals.ts, site-layouts.ts, content-grid.ts, blogs.ts and the other reader…
- done when: node work/pm/graph.mjs src/server/page-reads.ts reports under 400 modules (pages.ts reaches 1,307 today), and the new graph test passes.
- saving: Not measured. The walk shows what one module's closure loses (20.5 to 7.0 MB of source for pages.ts); what a route's function loses depends on every other path into the same code.
- after: PM-2 (the new reads are written into the new module); Code review steps 3.13 and 3.14 for the larger cut
- tracked: code review steps 3.13 (domain folders, FV4 and FH6, Open) and 3.14 (split schema.ts, FD5, Open)
- notes: The same finding as SG-1, SG-8 (server graph) and SD-1 (storefront data) seen from the page's side: fold it into their plan and the code review's steps. Steps 1 and 2 here are the page's share and cost little when PM-2 is done anyway. Effort L is for the whol…

### PM-13 [P3 M duplicate corrected OWNER-CHOICE] Some block types overlap; whether to merge them is a product choice, not waste
- evidence: 37 block types and 83 sub-parts (the skeptic's count from the bundled model). Accordion and FAQ already share one renderer (DetailsList, page-block.tsx:430); tabs has its own (:464). Button and dual button are two small functions over one buttonLook(). Email form and newsletter share one form (page-article.tsx: FormSection draws both). Custom field and field loop exist as blocks and as product parts; free shipping a…
- cost: Nothing per visitor and nothing per request. Per type: a schema, an editor, texts and tests to keep, and one more choice in the builder's palette. (The team (upkeep); an owner choosing in the palette)
- fix: 3 steps; first: 1. Nothing to remove on engineering grounds. Put the question to the owner under the Homer and Lisa rule: should a new owner see these near-twins as one in the palette (an FAQ as an accordion with a questions switch; one button with an optional second; one fo…
- done when: The owner has answered for each of the three pairs (FAQ and accordion, button and dual button, email form and newsletter), and the answer is a row in docs/decisions.md.
- saving: None at run time. Estimate: a few fewer entries in the palette, and fewer types to keep only if the owner chooses to merge them in the model.
- after: The owner's decision; PM-9 and code review step 3.2 if a type is to leave the stored model
- tracked: no (code review step 3.2 is about where a block is defined, not how many there are)
- notes: P3 because it saves nothing that runs: no visitor, request or build pays for a second palette entry. It is kept on the list only because before opening is the one moment when a change to the stored model costs a single pass over the team's own pages.

### PM-14 [P0 S process confirmed] No budget sees a realistic built page, the document's size or a list that reads whole pages
- evidence: The budgets hold first scripts for seven addresses and transferred weight for the demo's front page and one product page (performance.spec.ts:40-48, :126-129). The demo's pages are one row and two blocks (seed.sql:267-272), so per-row costs (PM-7) never show; the doubled layout (PM-1) is about 1 KB once compressed and passes under a 450 KB weight budget; the payload's 60 to 70% share of a document is not looked at. …
- cost: PM-1, PM-2, PM-5 and PM-8 arrived without a failing check, and the cart's scripts reached product pages on 10 November (PM-11) inside the product page's 5% of room. (CI now; the server, the database and shoppers later)
- fix: 5 steps; first: 1. e2e/performance.spec.ts: a new test makes a page in the demo store from a signature theme's home page (orbitHomePage(ORBIT_PACK, picture) from ../src/lib/signature/orbit, run through parsePageContent, inserted as e2e/pages.spec.ts inserts its pages: 6 rows…
- done when: pnpm test:e2e for e2e/performance.spec.ts prints and holds a document and a payload figure for four storefront addresses, one of them the six-row page, and src/server/ratchet.baseline.json holds the two new counts.
- saving: It keeps the other savings: without it PM-1, PM-2, PM-5, PM-8 and PM-11 can come back unseen.
- after: nothing
- tracked: no (docs/performance.md lists the present budgets)
- notes: SC-6 and PL-13 (storefront scripts and page payload) ask for the same kind of budget; put all of them in the one spec. Do step 1 and 2 before PM-1 and PM-8, so their saving is seen by the check that will hold it.

### PM-15 [P1 M eager added] One cache tag covers all of a store's pages: publishing one page, or describing one picture, makes every built page of the store render again
- evidence: Every cached read of a store's pages carries one tag, pages:{storeId} (pagesTag, pages.ts:69; 17 cacheTag places in 13 files, among them the header and footer at site-layouts.ts:31, the menus' names at pages.ts:722 and the product layout at product-layouts.ts:30). Because the layout draws the header, the footer and the menus, every route of the store uses a read with that tag. Measured on the build: all 261 prerende…
- cost: Per publish: every built page of the store is stale and renders again on its next visit: its pages, articles, product and category pages, in each country, language and currency view (261 entries for the demo's 3 pages a… (The server per render; the database (the cold reads); the first visitor to each…)
- fix: 7 steps; first: 1. After PM-2, so that no page draws another page's content out of the whole list.
- done when: A unit test of the store's save action with next/cache stubbed sees a body-only publish call updateTag with page:{id} and not with pages:{store} (today every publish calls it with pages:{store}), and the new cases in src/server/pages.int.test.ts pass (a body-only publish is scope 'page'; a changed title is 'site').
- saving: Estimate: a publish that changes only a page's body makes that page's own entries render again (one per market view) where today it makes every built page of the store do so: 261 entries on the demo, measured as carrying the tag.
- after: PM-2; Code review step 3.10 (the same mechanism for products; do the two together or one after the other)
- tracked: no (code review step 3.10, cache tags per product, FF3, Open, is the catalogue's twin and does not name pages)
- notes: Added by the planner as completeness critic: the brief asked what runs inside and outside `use cache`, and the report measured the reads but not what a write throws away. Confidence is medium because the tags were read from the build and the guide, and the re…

### PM-16 [P2 S duplicate added] A product's layout is cached once per product, whole
- evidence: productLayoutFor(storeId, productId) is a `use cache` function, so its entry is keyed by the store and the product, and it returns the chosen layout's whole parsed content (product-layouts.ts:27-63). A store with one standard layout and K products therefore gets K entries holding the same document, K statements that each return it, K runs of the page schema and K picture lookups on a cold instance; and each product …
- cost: About 1.5 KB per product of the instance's 50 MB cache (config-shared.js:102) and of each built product page's resume state, for a theme's layout; an owner's own layout of 10 KB makes it 10 KB a product (estimate). 2,00… (The server per cold instance (cache memory, parsing); the database (the same do…)
- fix: 2 steps; first: 1. src/server/product-layouts.ts: split the read in two. productLayoutIdFor(storeId, productId): today's statement with `select p.id` only, same tags. productLayoutById(storeId, layoutId): 'use cache', cacheLife('hours'), cacheTag(pagesTag(storeId)) (and page…
- done when: rg -n 'select p.id, p.published' src/server/product-layouts.ts prints nothing, and the new case in src/server/product-layouts.int.test.ts shows one read of the layout's document for two products.
- saving: Estimate: one cached copy and one parse of a layout per store where there is one per product: 1.5 KB (a theme's layout) to about 10 KB (an owner's own) less per product in cache and in each built product page's resume state.
- after: nothing
- notes: Added by the planner as completeness critic. Small for one product and it grows with products per store, which is the direction that matters after opening. Do it with PM-15, which gives the layout's read its own tag anyway.
