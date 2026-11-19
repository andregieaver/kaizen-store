# storefront-data: What the server does for a storefront request

A warm, cached storefront page is lean (a prerendered home page or a store's own page makes no database read of its own); the cost sits around the page and none of it depends on which features a store uses, so every store pays it once the platform opens. A product page asks the database about 18 times a view where only stock changes per view, the proxy in front of every page loads 1,311 modules (0.8 to 0.95 s and 168 MB cold on this machine) where its five reads need about 50 to 100, and every page load makes a second function call to learn the wishlist is empty and, with a product grid, a third (3 statements) for tile stock that is off by default. Cached pages are drawn again by the clock (1 hour for 71 of 85 cached reads, 15 minutes for the home page), by every deploy (up to 52 on 11 Nov) and by any one owner saving AI settings, which expires every store's pages (319 of the build's 1,316 prerendered entries carry that one tag). Nothing here removes or hides a feature: 16 fixes make cost follow use, five of them small and safe enough to do first, and before opening is the cheapest time for all of them.

## Measures
- Proxy cold load: 920 and 948 ms, +167 and +168 MB (my two runs, with a build and browsers using the machine); the verifier measured 795 to 840 ms; next/server + pg + drizzle + zod alone 133 to 172 ms and 34 MB (the verifier's, not re-run)
- Modules the proxy reaches, today and with its reads in leaf modules: 1,311 modules, 20.6 MB of source today. With the 16 import edges of SD-1 step 1 cut: 97 modules, 1.95 MB; with the schema import also gone: 52 modules, 0.5 MB
- Modules the store layout reaches: 1,466 today; 1,011 without customers.ts -> privacy-erasure.ts; 999 when, besides that and the schema, only two-step.ts stops importing admin-text.ts; 872 when all 8 importers of admin-text.ts on this path stop
- Modules the interface-text start-up code reaches: 383 (7.6 MB of source) today; 93 (2.2 MB) with the translating tools split from the reader; 47 (0.77 MB) once the schema import is gone. /api/health reaches 54
- Statements per view, warm local production server, anonymous: product page about 18 (20 commits in a 6 s window whose idle floor is 1; one was the minute poll of SD-7); search 11 to 12; category about 2; /api/shop/tiles for 10 products 4 over the floor (3 by the code); /wishlist/saved 0 of its own. The verifier's other …
- Function calls a page load makes after the document: /wishlist/saved on 12 of 12 store pages measured (twice on checkout); /api/shop/tiles on 2 (home and All products); the proxy also runs for the first
- Prerendered entries that carry the platform-wide tag ai-providers: 319 of 1,316, among them the template store's home, product and text pages and Kaizena Flow's home; the store pages also carry the platform-wide tag catalog
- Cached reads and their lifetimes: 85 'use cache' functions; 71 calls of cacheLife("hours"), 5 of days; 2 functions with no life (ownerSells, campaignNoticesAt: the 15-minute default); 0 'use cache: remote'
- Shell lifetimes in the build: 668 prerendered entries at 1h, 6 at 15m (store home and All products in 3 markets), 2 at 1m (the verifier's count; not re-counted)
- Stores with shells made at build: 1 (the template store); the fallback shell for any other store is a 0-byte file
- Commits on 11 Nov 2026: 90 commits; the verifier found 52 of 89 touched code by 23:38 UTC (an upper bound on deploys)
- Callers of the whole-page list: 35 call sites of listPublishedPages() by my count (the verifier counted 36); 9 keep one page by id; production returns 29 rows a call, 79,778 calls, 781 s in 78 days
- Writers the product page's cached facts would depend on: 12 server files write the tables behind them: settings.ts, connect.ts, mollie.ts, payment-methods.ts, checkout-rules.ts, order-settings.ts, quote-requests.ts, draft-orders.ts, suppliers.ts, automations.ts, products.ts, price-lists.ts (producer-registrations.t…

## Well made
- A store's own page is found by one row, not from the list (findPublishedPage, src/server/pages.ts:683-708), and a store's menus take page titles in SQL (publishedPageNames, pages.ts:715-736). A menu's four reads run together (src/components/store-layout.tsx:7…
- getProduct() runs its seven follow-up reads together (src/server/catalog.ts:424-431), and the optional texts per country are subqueries of its one cached statement (catalog.ts:386-393): an unused table there costs nothing worth a change.
- The cart count and the signed-in customer cost no database read without a cookie (src/server/cart.ts:545-546, src/server/customers.ts:455-456). The wishlist's handler likewise reads nothing for a visitor with no list (src/server/wishlists.ts:36-42, measured);…
- Chat, referral capture, consent and running tests are decided in the cached shell, not per request: their tags are on the shell (.next/server/app/s/demo/no.meta lists store, pages, experiments, text-styles, catalog, campaigns, terms, chat, affiliate, cookies,…
- Stock is the one catalogue fact read per request by design, and the rule is written (docs/rules/storefront.md:110-114). Every fix here keeps it.
- The proxy's A/B reads run only for visitors who carry the kaizen_ab cookie (src/proxy.ts:152), and its held-domain read is kept 30 s (src/server/holding.ts:17).
- Visit counting sends its beacon only while the owner has it on (src/components/store-visits.tsx:12-13, the flag from the cached store; the column defaults to false, src/db/schema.ts:788): cost follows use. The country suggestion reads request headers only, no…
- Font stylesheets are served immutable for a year (src/app/api/fonts/css/[slug]/route.ts:40).
- A category view makes about 2 statements when warm (measured): the listing's own page of ids and the terms. Search makes 11 to 12; it is used when a shopper searches, so its cost follows use; only its settings reads repeat (SD-9).
- An optional feature that costs nothing per request, per cold start or per scheduled run is not a finding here, whether or not any store uses it yet.
- Checked by the verifier and not a server cost: the 5,200 repeated RSC requests on a category page of the local build come from the browser's cache (88 KB transferred in all). That loop belongs to the client dimension.

## Findings (16)

### SD-1 [P1 M eager corrected] The proxy and every storefront page load about half of the server's code at cold start
- evidence: My walk of value imports from src/proxy.ts reaches 1,311 modules, 20.6 MB of source (483 server files, 813 lib files, the schema). Loading the built proxy in a fresh node process took 920 and 948 ms and added 167 to 168 MB (the verifier: 795 to 840 ms; the bare libraries 133 to 172 ms). What the proxy calls is small: five readers. They sit in files that also hold writers, so the imports of those writers come along. …
- cost: About 0.8 to 0.95 s and 168 MB each time a proxy instance starts cold (this machine, not Vercel), before any page on any host, static pages included. Cold starts come with each new instance and each deploy (up to 52 on … (A shopper's first byte on a cold instance; the server's memory and compute. The…)
- fix: 6 steps; first: Step 1, the proxy's readers become leaf modules. Moves only; every old import path keeps working through a re-export. (a) New src/server/short-memory.ts holds remembered() and forgetRemembered() from src/server/redirect-live.ts:186-204; redirect-live.ts re-ex…
- done when: src/proxy.graph.test.ts passes with the proxy at 120 modules or fewer (1,311 today) and the market layout at 900 or fewer (1,466 today), by the same import walk; as a second reading, work/sd/load-proxy.cjs on a fresh build loads the proxy in under 300 ms on the machine where it took 800 to 950.
- saving: By the walk: the proxy from 1,311 modules to about 50 to 100 (20.6 MB of source to 0.5 to 2 MB); the layout from 1,466 to about 880. Estimate from the local timings: proxy cold start from about 0.8 s to about 0.2 s and about 130 MB less. Page functions were n…
- after: nothing
- tracked: Partly. Step 3.14 (FD5, Open) covers fix step 2. Steps 3.13 (domain folders) and 4.1 (lint boundaries), both Open, do not name the proxy or start-up weight.
- notes: Step 1 with step 5 is the large part and stands alone: it takes the proxy to about 97 modules without steps 2 to 4. Step 3 and the two-step half of step 4 are ten-minute changes. Corrected against the verified report: the admin-text cut needs eight importers …

### SD-2 [P1 M eager confirmed] A product page asks the database about 18 times per view; one answer changes per view
- evidence: Measured again: one anonymous GET of the prerendered /s/demo/no/p/demo-keramikkopp on the warm local build committed 20 times in a window whose idle floor is 1. Tables read: inventory_levels, inventory_locations and inventory_reservations +8 each (stock is read by the buy part at product-parts.tsx:1012 and again by the JSON-LD part at :694), payment_providers +7, shipping_rates +4, checkout_providers +2 and vat_rate…
- cost: About 16 statements beyond the proxy's per product view. It grows one for one with shopper traffic, on the page where the buy button is: the largest per-request cost on the storefront once the platform opens. (The server and the database per request; the shopper waits on 'Checking stock' …)
- fix: 8 steps; first: Step 1, safe and alone worth shipping: share within one request through perRequest() (src/server/request-memo.ts:13-20). getVariantStock() keyed by the store and the sorted ids (src/server/catalog.ts:566-569; its callers at product-parts.tsx:694 and :1012 the…
- done when: One anonymous GET of a prerendered goods product on a warm production build commits 4 statements or fewer beyond the proxy's (about 16 today) and reads only the inventory tables, by the pg_stat_database method of work/sdp/measure.sh; then the budget of SD-13 holds it.
- saving: Estimate: from about 16 to 1 to 3 statements per anonymous product view (stock; schemes and breaks only for stores that have them), and the buy button no longer waits for payment facts. Step 1 alone: 3 statements.
- after: nothing
- tracked: No. FF4 / step 3.8 (Open) covers the cart's and checkout's reads only; FF10 / step 3.11 (Open) splits the file, not the reads.
- notes: Step 1 is small and safe enough to do first, with SD-11. Changed from the verified fix in one way: the facts are read by the page and handed down, not read inside the buy part, because Next documents the in-memory cache as not kept between requests on serverl…

### SD-3 [P2 S process corrected] Every deploy empties the caches and nothing warms them
- evidence: Only the template store is prerendered at build (prerenderedShops(), shop.ts:93-100); the fallback shell for any other store is a 0-byte file (.next/server/app/s/[store]/[market].html), so its first visit after a deploy is drawn whole at request time. Next's guide: all cache stores 'are scoped to a single deployment. A new deploy starts fresh', and neither caching directive carries over to a new deploy. 90 commits w…
- cost: Today the team and crawlers meet the cold pages. After opening, the first visitor to each page of each store after each deploy waits for a cold function start (SD-1) plus about 30 statements (SD-5). Cold draws are store… (Shoppers (first byte) and owners looking at their store after a change, once th…)
- fix: 3 steps; first: Step 1, now: scripts/await-deploy.mjs:52-56 gains page checks. After production reports the commit it requests Kaizena Flow's home and one page of the template store (addresses from a new SMOKE_PAGES variable set in .github/workflows/ci.yml beside PRODUCTION_…
- done when: The release job's log lists the page checks with status 200 after each deploy, and src/lib/await-deploy.test.ts shows that a page answering 500 fails the job.
- saving: Step 1 saves no statements; it moves the first cold start after each deploy from a visitor to the job and catches a broken storefront at deploy. Step 2, estimate: the 1 to 3 s cold first view of each busy page after each deploy (from the one case in docs/perf…
- after: SD-1
- notes: Before opening there is nobody to warm for, so only step 1 is worth doing now. SD-8 does not replace this: a deploy empties the caches whatever their life. The deploy cadence after opening is the owner's choice.

### SD-4 [P2 M oversize corrected] Every published page is read whole to pick one page or a few titles
- evidence: listPublishedPages() selects the whole published document of every published page of an owner, parses each, and looks up every picture of every page in media (withPageAlts, media-alts.ts:53-57). I count 35 call sites. Nine keep one page by id: the front page (page.tsx:29), All products (pages.ts:799), a role page (:862), the chat's privacy link, a blog's listing page, two account pages, the platform's role page and …
- cost: Per cold fill: about 10 ms in the database, every published document of the owner over the wire and through zod, and one media lookup for all their pictures. Today about 1,023 fills a day from the team, crawlers and dep… (The database and server CPU on every cold render; the shopper's first byte on a…)
- fix: 5 steps; first: Step 1: src/server/pages.ts gains publishedPageById(owner, id, type): 'use cache', cacheLife("hours"), cacheTag(pagesTag(owner)); one row by id, parsed and passed through withPageAlts().
- done when: rg 'listPublishedPages\(' over src (tests aside) shows no caller that picks one page by id after it (9 today), and src/server/legal-links.ts and src/server/platform-navigation.ts no longer import it.
- saving: Estimate: a cold storefront fill reads and parses 1 to 3 pages instead of every published page (29 a call on average today), and the all-pages read leaves the path to the first byte. In database time the statement is about 10 s a day today, so the gain is col…
- after: nothing
- notes: Worth doing when pages.ts is next touched, or together with SD-5 step 2, which takes the same read out of the layout's blocking wave.

### SD-5 [P2 S eager confirmed] A cold page waits on reads one after another before its first byte
- evidence: Read in order for a store's home page with no shell (an estimate, not measured: a first visit to another store would write into .next). The proxy reads the store's facts; the layout reads the store, then header, footer and legal links together (layout.tsx:123-128), each 2 to 3 reads deep, then text styles alone (awaited inside the JSX at :166). Only then can <html> be sent. After that: menus, fonts, chat, then conse…
- cost: Estimate: 30 to 35 statements per cold page, about 5 waits in a row before the first byte, 8 in a row for consent. With the database in the same region each wait is a few milliseconds, so tens of milliseconds per cold d… (The shopper's first byte on a cold visit; the database.)
- fix: 5 steps; first: Step 1: src/app/s/[store]/[market]/layout.tsx:123-128 starts textStylesCssFor(store.id) in the same Promise.all as the header and footer; :166 uses the result.
- done when: The first request for a store's home page after a restart of a local production server makes at least 3 fewer statements than before the change (work/sdp/measure.sh), and layout.tsx has one awaited Promise.all before <html> and no await inside its JSX.
- saving: Estimate: waits in a row before the first byte from about 5 to about 3; consent from 8 in a row to one wave; 2 to 4 fewer statements per cold draw. Small in time; cheap to do.
- after: nothing
- tracked: No. FF2 and FF5 / step 3.9 (Open) cover the whole-catalogue read for the home page's JSON-LD and the product index in metadata; they are not repeated here.
- notes: Tens of milliseconds per cold draw: do it when the layout is next opened, for example with SD-15, which adds a part to the same file.

### SD-6 [P2 S eager corrected] The proxy reads the database before a page view whenever its 10-second memory has lapsed
- evidence: The matcher takes every page on every host (proxy.ts:55-59). A store's facts are kept 10 s per instance (FACTS_MS, redirect-resolve.ts:203) and so is the site switch. Seen again in my measurements: the first /wishlist/saved call after a pause read stores, markets, store_currencies and platform_settings; the next one read nothing. remembered() does not share a read in flight (redirect-live.ts:192-199: it awaits load(…
- cost: One statement (two on Kaizena Flow's own host) and a pooled connection in front of the cached shell on the first request of most visits; the first byte waits a few milliseconds for it. With many stores each visited now … (The shopper's first byte; the database.)
- fix: 4 steps; first: Step 1: remembered() shares a read in flight: a map of running loads beside the memory, so a second caller for the same key awaits the first (src/server/redirect-live.ts:186-199; with SD-1 step 1a this is the new src/server/short-memory.ts).
- done when: A unit test shows 20 concurrent remembered() calls for one key run the loader once, and rg finds one definition of the helper in src/server (three today).
- saving: Estimate: a burst after 10 s of quiet reads once instead of once per request in flight: a few statements under load. Small beside SD-1 and SD-2.
- after: SD-1
- notes: Done as part of SD-1 step 1a at no extra cost. I dropped the verified fix's background refresh: its gain is one small statement and it weakens a privacy bound an owner relies on.

### SD-7 [P2 M eager corrected] Every instance loads the interface-text tools and reads the translations table before its first request, then polls it each minute
- evidence: register() imports ui-text.ts and awaits startUi() before the instance takes a request (instrumentation.ts:8-9); a timer repeats the read each minute (ui-text.ts:109-116). ui-text.ts holds the reader and the platform admin's translating tools in one file, so it imports ai.ts and auth.ts (:14-15). My walk: 383 modules and 7.6 MB of source from ui-text.ts; with the four tool imports cut (ai.ts, auth.ts, ui-translate.t…
- cost: Up to about 0.4 to 0.5 s per cold instance of a light function (local, upper bound, the verifier's timing); less on storefront functions today, more once SD-1 has slimmed them. One statement per live instance per minute… (The first request on each new instance (cron and API routes most of all); the d…)
- fix: 3 steps; first: Step 1, with SD-1: split src/server/ui-text.ts. The reader (state, loadLanguage, refresh, ensureUi, startUi, reloadUi and the texts getter, lines 29-125) moves to a new src/server/ui-text-read.ts that imports the database client and pure lib only. The transla…
- done when: The import walk from src/instrumentation.ts reaches 100 modules or fewer (383 today), held by the graph test of SD-1 step 5.
- saving: Step 1, by the walk: 290 fewer modules at the start of every instance (383 to 93; to 47 with the schema gone); the 0.4 to 0.5 s on light functions was not re-timed after the cut. Step 2, estimate: one statement per instance per minute for instances that never…
- after: SD-1
- notes: Step 1 is small (S) and should ride with SD-1. Step 2 is the part that needs care and has no gain until the table holds a language, so it waits; the poll's database time today is negligible.

### SD-8 [P1 M eager confirmed] Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page
- evidence: Re-counted: 85 cached functions, 71 calls of cacheLife("hours") (made again after 1 hour), 5 of days, and 2 functions with no life (ownerSells, content-grid.ts:162-168; campaignNoticesAt, campaign-notices.ts:182-188), which take the default of 15 minutes. Next's guide: an outer cache without a life takes the default; a shorter inner life can shorten it, a longer one cannot extend it. So campaignNoticesAt follows a c…
- cost: Up to 24 redraws a day per visited page (96 for home and All products), each about 30 statements on a fresh instance. For a small store the redraws track visits, not changes: a page seen every two hours is drawn again o… (The server and the database. No visitor waits: the old shell is served meanwhil…)
- fix: 5 steps; first: Step 1, small: next.config.ts (beside cacheComponents at :42) redefines the default profile as { stale: 300, revalidate: 3600, expire: 86400 }. The two functions without a life then last an hour unless an inner read is shorter, which is what the comment at ca…
- done when: pnpm build's route table shows no storefront route at 15m (6 today) after step 1, and the rows of a store's own pages (/s/[store]/[market]/[slug]) at 1w instead of 1h after step 3.
- saving: Estimate: background redraws fall from one per hour (or per visit, for a quiet page) to one per change. With many deploys a day part of the gain is lost, because a deploy empties the caches anyway (SD-3). Step 1 alone: the home page and All products from 96 p…
- after: SD-13; SD-16
- tracked: No. FF3 / step 3.10 (Open) is about finer tags, not lifetimes.
- notes: Changed from the verified fix in one way: the two functions get their life from a redefined default profile, not an explicit call, because an explicit outer life would stop them following a campaign that starts in ten minutes. A long life makes SD-16 more urg…

### SD-9 [P3 S eager corrected] A store's pages ask about every optional feature, whether that store uses it or not
- evidence: On a cold draw a store's page runs separate cached statements for the chat agent, remembered modals, the affiliate site, recommendation settings, cookie notes and campaigns, and asks about running experiments four separate ways: experimentOfPage (experiments.ts:130), storeHasExperiments (:155), siteTests (:178) and runningExperimentIds (:234), each its own 'use cache' with its own statement. Per search I measured 11…
- cost: Estimate: about 6 to 8 of a cold page's 30 or so statements answer 'not used' for a store that uses none of these; each is a sub-millisecond indexed read. A few milliseconds per cold draw. (The database and the server per cold render.)
- fix: 3 steps; first: Step 1: src/server/experiments.ts gains one cached runningTests(storeId) (one statement: each running test's id, target page, the page's type and place, goal, goal block and variants with their pages), and experimentOfPage, storeHasExperiments, siteTests and …
- done when: rg -c '"use cache"' src/server/experiments.ts prints 2 (5 today: the one read and siteVersionContent remain) and experiments.int.test.ts passes.
- saving: Estimate: 3 to 4 statements and a few milliseconds per cold draw beyond what SD-2 and SD-5 save, and one statement per search. Small.
- after: SD-2; SD-5
- notes: P3 because the gain is a few sub-millisecond reads per cold draw. Do step 1 when experiments.ts is opened for SD-1 step 1g. Nothing in this finding is a case to retire, park or hide a feature.

### SD-10 [P0 S duplicate confirmed] The store is looked up by its id again and again
- evidence: 'select slug from commerce.stores where id = ...' is written 27 times in 21 files of src (my rg), almost always followed by getStore(slug). A cached helper exists, storeSlugOf() (menus.ts:283-288, cached for days, 13 uses), but storeAndMarket() (content-grid.ts:151-156) runs its own uncached statement, and the per-request parts call it: each filterable grid (content-grid-section.tsx:70), each working page's part (st…
- cost: 1 statement per grid or part per view on the storefront; it grows with shopper traffic on pages built with such parts. The production count mostly measures jobs. (The database and the server per request; the scheduled jobs per run.)
- fix: 3 steps; first: Step 1: storeAndMarket() (src/server/content-grid.ts:151-156) and customWhere() (:133) take the slug from the cached storeSlugOf(). Move storeSlugOf() from src/server/menus.ts:282-288 to a leaf src/server/store-slug.ts (menus.ts re-exports), so content-grid.t…
- done when: rg -c 'select slug from commerce\.stores where id' src/server/content-grid.ts prints nothing (2 today), and one warm GET of the search page shows no read of commerce.stores by id in work/sdp/measure.sh's table deltas beyond the proxy's.
- saving: Estimate: 1 to 3 statements per view on pages with grids, parts or search. The 7,181 calls a day in production fall only as the jobs move to the helper.
- after: nothing
- notes: Narrowed from the verified fix (M, all 27 places) to the one function the storefront's per-request parts call (S); the rest follows by ratchet.

### SD-11 [P0 S duplicate confirmed] The same shopper facts are read several times in one request
- evidence: The cart link is drawn twice (the header at store-layout.tsx:287 or site-parts.tsx:179, and the phone bar at :583) and each runs getCartCount() (cart-link.tsx:26, cart.ts:544-556), so a shopper with a cart costs two identical counts on every page. getCustomer() runs a session query on each call (customers.ts:454-463); on a product page a signed-in shopper meets it in the member notice (:935), the buy part (:1006) an…
- cost: 1 extra statement per view for a shopper with a cart; 2 to 4 extra on a product page for a signed-in shopper. It grows with real shoppers, who do not exist yet. (The database per request; the shoppers closest to buying.)
- fix: 3 steps; first: Step 1: getCustomer(storeId) (src/server/customers.ts:454-463) runs its read through perRequest(`customer:${storeId}`, ...). Outside a render nothing is shared (request-memo.ts:9-11), so an action that signs someone in or out and reads again is not affected.
- done when: With a cart cookie, one GET of a store's home page reads commerce.cart_lines once (twice today), and with a session cookie a product page reads commerce.customer_sessions once, by the table deltas of work/sdp/measure.sh.
- saving: 1 statement per view for a shopper with a cart and 2 to 4 per product view for a signed-in shopper.
- after: nothing
- notes: Two small edits. SD-15 adds one more caller of getCustomer() to every page, so do this first or with it.

### SD-12 [P3 S oversize confirmed] Whole rows and documents are read for one fact
- evidence: fontPreloadFile() reads a family's whole stylesheet to find one file name (fonts.ts:176-182; 42,211 calls in production). aiFor() runs 'select *' on ai_providers, keys included (ai.ts:206-211), where the chat button needs 'is there a text model, can it speak' (chat-agent.ts:139; 237,563 calls over four shapes, jobs included). getChatAgent() runs 'select *' on chat_agents, instructions included, for a name and a gree…
- cost: 121 s of JSON scanning in 78 days (about 1.5 s a day) and wider rows than needed on every cold fill. The modal scan grows with a store's page count. (The database per cold render.)
- fix: 4 steps; first: Step 1: chatWidgetFor() (src/server/chat-agent.ts:135-141) asks a new two-column read in src/server/ai.ts (does the site have an enabled provider with a text model, can it speak) instead of aiFor(); no key leaves the database for the widget.
- done when: chatWidgetFor() calls neither aiFor() nor a 'select *' (rg over src/server/chat-agent.ts:135-160), and fontPreloadFile() is at days.
- saving: The widget's reads shrink to a few bytes and no longer carry keys or instructions; the modal scan falls with SD-8. Small.
- after: SD-8
- notes: P3: every one of these is cached, and together they cost about 1.5 s of database time a day. Step 1 has a second reason to do it when SD-16 touches the same function: an API key should not travel into a cached widget read.

### SD-13 [P1 M process confirmed] The browser's side has budgets; the server's side has none that can see these costs
- evidence: First scripts have a byte budget per route and a scan keeps zod out of visitors' scripts. The one server-side number is the first byte of two warm store pages, under 250 ms (e2e/performance.spec.ts:127-130; measured under 10 ms). It cannot see any finding here: the shell answers first and the statements run in the stream after it. Nothing counts the proxy's import graph (1,311 modules), a page's statements per view …
- cost: No bytes today. It is why SD-1, SD-2, SD-8, SD-14, SD-15 and SD-16 could grow unseen, and they will grow faster once real stores switch features on. (Everyone later: shoppers, the server, the database.)
- fix: 5 steps; first: Step 1: src/proxy.graph.test.ts (SD-1 step 5): forbidden modules and ceilings that may only fall for src/proxy.ts, the market layout and src/instrumentation.ts. Share reach() with src/lib/pay-routes.graph.test.ts through a test helper.
- done when: CI runs the graph test and the use-cache scan in pnpm test and scripts/server-budget.mjs in the e2e job, and a branch that adds three statements to the product page fails the job.
- saving: No direct saving. It keeps the savings of SD-1, SD-2, SD-8, SD-14, SD-15 and SD-16 from growing back.
- after: SD-1
- tracked: No. ratchet.scan.test.ts (step 1.2, Done) ratchets unchecked reads and casts, not graphs, statements per view or cache lives.
- notes: Set the budgets before opening, while the numbers are still easy to bring down. Corrected the title: one server-side number exists (first byte of two warm pages) but it cannot see these costs.

### SD-14 [P0 S eager added] Product tiles ask the server for stock on every page load, also in stores that show none
- evidence: The store's two switches (stock on tiles, Add to cart on tiles) are off until an owner turns them on (DEFAULT_PRODUCT_SETTINGS, shop-tiles.ts:21). A grid's own choice is absent by default and means 'follow the store', so tileAsk() returns an ask for every product grid (shop-tiles.ts:35-39) and each tile mounts an island that fetches /api/shop/tiles (tile-shop.tsx:33). Only when the answer arrives does the browser le…
- cost: Per load of a page with a product grid, in every store that has not switched the feature on: one function call, 3 statements (one of them the stock of every product on the page) and an answer nobody uses. It grows one f… (The server and the database per page load; the shopper's browser (one request a…)
- fix: 3 steps; first: Step 1, keeps D557 as written: tileFacts() (src/server/shop-tiles.ts:23-29) returns { settings, facts: {}, buttons } right after reading the settings when both are off and no grid of the page asks on its own. The island adds own=1 to its request when an ask h…
- done when: On a store with both switches off, loading its home page and All products in a browser makes 0 requests to /api/shop/tiles (1 each today, routes.json), asserted in e2e/shop-components.spec.ts; with tile stock on, exactly 1.
- saving: Measured cost today: 1 function call and 3 statements per load of a page with a product grid. All of it goes for every store with the default settings; a store that shows tile stock pays as now.
- after: nothing
- notes: Missed by the report because its statement counts were made with curl, which does not run the page's scripts. This is the plainest case in the dimension of cost that does not follow use: the feature is off by default and every store pays for it on its busiest…

### SD-15 [P0 S eager added] Every page load calls a function to learn that the wishlist is empty
- evidence: The header's heart shows a count (WishlistCount, store-layout.tsx:283 and site-parts.tsx:172), and its hook fetches {market}/wishlist/saved with cache 'no-store' on every full page load (wishlist-heart.tsx:21-30, :37-40). routes.json: 12 of 12 store pages measured made the call (checkout twice), the store's text page, the cart and the account among them. The address looks like a page, so the proxy runs for it too (t…
- cost: One extra function call and one extra proxy run per full page load, for every visitor of every store, to say 'nothing saved' to nearly all of them. No database read unless the visitor has a list. It grows one for one wi… (The server per page load; the shopper's browser (one request).)
- fix: 4 steps; first: Step 1: a server component WishlistSeed (new src/components/wishlist-seed.tsx) awaits savedProductIds(store.id) (src/server/wishlists.ts:64-73) and renders a small client component, SavedSeed, exported from src/components/wishlist-heart.tsx, which calls setSa…
- done when: The route measurement run again (work/measure-routes.mjs into routes.json) shows 0 requests to /wishlist/saved on all 12 store pages (12 pages make it today), and e2e/wishlist.spec.ts passes.
- saving: One function call and one proxy run per full page load, for every visitor (measured: 1 per load on 12 of 12 store pages). A shopper with a list or a session pays the same 1 to 2 statements as today, inside the document's own request.
- after: SD-11
- notes: Found the same way as SD-14: by reading what a page load asks for after the document. The design note 'the pages stay cached and fast' (route.ts:4-7) is kept: the page's shell stays the same for everyone.

### SD-16 [P0 S eager added] One owner saving AI settings expires the cached pages of every store
- evidence: The chat button's cached read carries one tag for the whole platform, 'ai-providers' (ai.ts:242, chat-agent.ts:138). The market layout draws that read on every page, so every prerendered store page carries the tag: 319 of the build's 1,316 prerendered entries do, the template store's home, product and text pages and Kaizena Flow's own home among those I opened. A store owner's own action refreshes that tag: saveStor…
- cost: Per save of AI settings by any owner: every visited page of every store is drawn cold on its next visit (about 30 statements each, SD-5) and that visitor waits for it. It grows with stores x pages x owners who touch the… (Shoppers of other stores (first byte after the flush); the server and the datab…)
- fix: 4 steps; first: Step 1: src/server/ai.ts:242 gains aiTag(storeId) = `ai:${storeId ?? "kaizen"}`; AI_TAG stays only as the platform's, aiTag(null).
- done when: After a build, grep -rl 'ai-providers' .next/server/app --include='*.meta' | wc -l prints 0 (319 today), store pages carry ai:{storeId} and ai:kaizen, and the scan fails when a store's action names a platform-wide tag.
- saving: A platform-wide expiry per owner's save becomes one store's. Not measurable before opening; after it, stores x visited pages cold draws avoided per save by any owner.
- after: nothing
- tracked: No. FF3 / step 3.10 (Open) covers the platform-wide catalogue tag and VAT changes, not this tag or a store owner's action.
- notes: Read from the code and the build's tags; the flush itself was not triggered here, because that would write. Free to fix before opening; after SD-8 lengthens lives it would be the main cause of platform-wide redraws.
