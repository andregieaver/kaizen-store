# functions: Server functions: size, cold start, per-request overhead

One import cycle of 229 server modules makes 559 of 562 pages, 181 of 268 route handlers and the proxy load the same 11 MB of server code: re-measured in this pass, such an entry needs 0.84 to 1.09 s and 71 to 83 MB to start where a route outside the cycle needs 0.16 s and 14 MB, and a start hook adds 0.33 s before any request. None of this rests on a feature being unused; every store pays it after each deploy (90 commits to main on 11 November), on scale-out and after idle, and it grows at opening as many quiet stores meet cold instances. Thirteen findings stand (eleven verified, two added) and seven of them are import changes with no data moved: on the import graph they take the visit beacon from 1,306 source files to about 100, the proxy from 1,309 to about 95 and a storefront page from about 1,420 to about 600, where the page renderer is the floor. Added by this pass: every store's own domain is compiled into each deployment (4 to 8 routing rules a store against Vercel's 2,048 a deployment, of which this app's own dynamic routes already take 685, and a full redeploy per domain change), and the list of those domains is parsed again for every link a page draws.

## Measures
- Built server entries: 830 (562 pages, 268 route handlers), plus the proxy and the start hook: 832 trace files
- Files traced per entry: median 50.2 MB in 651 files; smallest 14.3 MB; largest 133.3 MB; 743 entries over 45 MB, 83 under 20 MB. The 38.5 GB sum over entries is a sum of traces, not a size that is stored or shipped
- What is in a typical trace: sharp and libvips 18.9 MB in 741 of 830 traces; server chunks 16.9 MB median; taxonomy JSON 12.7 MB (6 files) in 830 of 830 and in the proxy's; Next 1.3 MB; Chromium with playwright-core 77.9 MB in 12 traces; source maps in none. /api/health: 216 files, 15.5 …
- Server JS listed for loading at start, per entry: pages: 559 of 562 list an identical 11.50 MB (145 chunks); handlers: 181 of 268 list an identical 10.85 MB (113 chunks); the other 87 handlers list a median 4.98 MB
- Cold load in a fresh node process (no request, no database), 2 runs each in this pass: /api/health 159 to 163 ms, 14.4 MB heap, 17 chunks 1.14 MB | /api/ab/assign 240 ms, 22.2 MB | /api/fonts/css/[slug] 385 to 411 ms, 39.6 MB | /api/visit 933 to 945 ms, 77.6 MB, 118 chunks 10.91 MB, sharp's native binary loaded | /robots.txt 907 to 932 ms, 77.6…
- Proxy cold load: 838 to 884 ms (2 runs), 70.9 MB heap, 151 MB RSS, sharp's native binary loaded, 19 chunk files 9.54 MB; trace 343 files, 45.7 MB (sharp 18.9, taxonomy 12.7, chunks 12.5)
- Start hook (instrumentation register): 331 to 336 ms of module loading before its first database connection (2 runs), 25.7 MB heap, 4 chunk files 2.33 MB; src/server/ui-text.ts reaches 383 source files, the reader alone would reach 52 (5 once the schema is out of the client)
- The import cycle: 229 files of src/server in one cycle (96,162 lines); importing any one reaches 1,305 files, 384,586 lines, 19.4 MB of source; reached by 179 of 265 route.ts handlers, 436 of 560 pages by their own imports, 18 of 24 layouts and the proxy (1,309 files). Cutting…
- Files reached, today and after the planned cuts (simulated on the graph): /api/visit 1,306 | 633 after FN-1's six cuts | 480 with the 13 admin-text importers of FN-5 | 99 with FN-4, FN-6 and stores.ts without the Stripe SDK. Proxy 1,309 | 636 | 483 | about 95 with FN-2's leaf readers. Storefront home 1,419 | 758 | 606 | 578. Produc…
- Small public handlers that load everything: 24 handlers of 7 to 52 lines of their own (robots.txt, the sitemaps, llms.txt, favicon.ico, the admin's manifest, the blog feeds, unsubscribe, private-mode enter and unlock, the four visit beacons, shop tiles, the product feed) each reach 1,306 to 1,309 files…
- Does a lazy import stay out of the start chunks: yes in this build: 6 handlers outside the cycle reach 15 files only through await import(); 0 of the 15 are in the chunks those handlers list for loading at start
- The import graph against the build: /api/health: 54 source files in its start chunks, 54 on the graph; /api/ab/assign 111 and 113; font stylesheet 312 and 315; /api/visit 1,294 and 1,306 (verified report)
- Admin catalogues: src/lib/admin-text.ts has 596 importers on the graph and is reached by 240 of 265 route.ts handlers, 76 of 78 entries under src/app/s and the proxy. Exactly 14 files inside the cycle's closure import it; with those 14 changed (FN-5) 30 handlers reach it, and …
- Packages bundled into the beacon's start chunks, by bytes of source: Supabase's packages 1.19 MB (auth-js 518 KB, postgrest-js 179, storage-js 140, realtime-js 118, phoenix 114, supabase-js 44, ssr 44, iceberg-js 28); opentype.js 482 KB; zod 362 KB; drizzle-orm 218 KB. Loaded from node_modules besides: sharp with libvips, pg
- Drizzle schema at run time: 6 built files hold the table definitions; src/db/client.ts is its only non-test importer and brings 47 src/lib files with it; 600 KB of JS, 75 to 114 ms to evaluate and 7.32 MB of heap per copy, two copies per instance (verified report, not re-run)
- Server actions and cached functions: 1,454 ids in the global manifest (10.4 MB as JSON, 11.2 MB as .js), each listed for 55.7 entries on average, median 2; 74 ids, all cached functions of src/server modules inside the cycle, are listed for 500 to 804 entries each
- Taxonomy data: 12.67 MB in 6 files in every trace; 87 entries (86 handlers, 1 page) cannot reach the reader by any import, static or lazy, counting layouts; Next applies a route's excludes after its includes
- Build output: .next/server 1.4 GB on disk; 5,174 server chunk files hold 4,662 distinct contents, so 512 are copies: 123.6 MB of 195.5 MB; three chunks make 107.5 MB of the copies (18 x 4.0 MB, 10 x 2.7 MB, 5 x 3.9 MB). Build 263 s, peak 7.26 GiB
- The store hosts list, parsed per call: one JSON.parse of the list: 0.003 ms at 10 stores with a domain (1.2 KB), 0.024 ms at 100 (12 KB), 0.38 ms at 1,000 (122 KB), 2.5 ms at 5,000 (606 KB). marketPath() parses it 2 or 3 times a call; the saved store pages hold 67 to 102 links; the proxy parses it…
- Routing rules per store domain against the platform's cap: 4 rules with no store domain; +4 per store with a primary domain, +5 with its www alias, +8 with two country domains; 300 stores with www and apex: 1,504 rules. This build's routes manifest: 685 dynamic routes, 9 redirects, 8 header rules, 3 rewrites. Vercel:…
- Requests per page view that pass the proxy's matcher: 13 to 16 for the storefront home, a product, the product list, a blog post; 30 to 54 for a content page, account, wishlist, cart, checkout (document plus router prefetches)
- Calls that show idle cost in production: 278,393 runs of the start hook's 'ui_translations group by lang' query in 78 days (about 3,570 a day); nine every-minute cron routes are 12,960 calls a day by their schedule; 42,211 reads of commerce.fonts by slug. These count deploys, scheduled work and the …
- Route settings: no runtime export anywhere (all Node); 42 of 265 route.ts handlers set maxDuration; all 13 cron routes set one; the shopper chat route (/api/chat) sets none and its AI calls carry their own 30 s timeout
- Deploy churn: 90 commits to main on 11 November (a shallow clone). A push of docs alone deploys nothing, so deploys are fewer than commits; each domain change of a store asks for one more (FN-13)

## Well made
- Nothing in this dimension argues from 'no store uses it'. Every finding is a cost paid per cold start, per request, per build or per store, whatever a store uses. The two that lean on production's counts (the start hook's query, the nine every-minute routes) …
- The routes outside the cycle show the floor and are well made: /api/health loads 17 chunks (1.14 MB) and starts in 159 to 163 ms with 14.4 MB; /api/ab/assign 1.56 MB, 240 ms, 22.2 MB; /api/consent and /api/csp-report reach 55 and 54 source files.
- A server-side await import() does give a chunk that loads on demand in this build: the files six light handlers import only lazily are absent from their start chunks, and the start hook's own entry file is 169 bytes: its 2.33 MB of chunks load only when regis…
- Chromium is traced only into the routes that launch it (three cron routes, the replicator's tick, two admin PDF routes, the shopper's document PDF, the PDF job); Playwright, @sparticuz/chromium, unpdf and mammoth are imported on demand (src/server/browser.ts:…
- The proxy's per-request work is light when warm: no fetch, pure decisions in src/lib, one store-facts read per store per instance per 10 s (src/server/redirect-resolve.ts:203-232), A/B tests read only with the kaizen_ab cookie, held-domain lookups only for ho…
- No client component imports a server-only module, directly or through src/lib: 0 of 495 client files on the graph; 787 modules carry import "server-only".
- Environment variables are validated when used, not at import. The database pool is created on the first db() call, 5 connections, 5 s idle (src/db/client.ts:14, 63-71, 95-98). Keeping an instance running until its idle connections close (attachDatabasePool, l…
- No route sets a runtime; nothing is on the edge runtime, which fits cacheComponents. All 13 cron routes have a maxDuration; eleven run through trackedRoute(), the five-minute dispatcher runs its jobs through runJobs(), and /api/cron/document-pdfs is left out …
- Next loads a handler's own code lazily (userland behind a require), and source maps (about 672 MB of the build) are in no function trace.
- JSON imported as modules is small (google-fonts.json 71 KB, no-saft.json 88 KB). The 13 MB taxonomy is read from disk on first use, not at import, and the product page reads it inside a cached function.
- src/lib/page-content.ts (4,319 lines) costs little at import: it is not among the costliest files of the cold-load profile. The zod cost at start comes mostly from the AI manager's tool definitions (src/lib/owner-tools.ts, about 44 ms in the profile), which F…
- The docs' Markdown (0.8 MB) and HarfBuzz's wasm (0.7 MB) are traced only into the 22 and 1 entries that read them.
- One import-graph test already exists and is sound: src/lib/pay-routes.graph.test.ts keeps forbidden modules off the pay routes and follows import() too, so the lazy imports planned here cannot hide a module from it.
- The list of every store's hosts does not reach the browser (the verified client-bundles report: no client chunk parses NEXT_PUBLIC_STORE_HOSTS).

## Findings (13)

### SF-1 [P0 M eager confirmed] One import cycle makes nearly every function load the whole application
- evidence: Re-measured in this pass. Source, from my own graph (TypeScript parser, 4,136 non-test files of src, type-only imports dropped): 229 files of src/server form one cycle (96,162 lines); importing any one of them reaches 1,305 files, 384,586 lines. 179 of 265 route.ts handlers, 436 of 560 pages by their own imports, 18 of 24 layouts and the proxy reach it. Build: 559 of 562 pages list the same 11.50 MB (145 chunks) of …
- cost: About 0.75 to 0.9 s and 63 to 69 MB of heap per cold instance above the 0.16 s and 14 MB floor, on about 740 of 830 entries. Also a 50 MB median trace and a 10.4 MB action manifest. (The first shopper or owner on each new instance: after every deploy (90 commits…)
- fix: 9 steps; first: 0. First do FN-7 steps 1 and 2 (scripts/route-load.mjs and src/server/route-load.graph.test.ts), so each cut below is a number in a baseline that may only fall.
- done when: src/server/route-load.graph.test.ts passes with the largest import cycle in src/server at 19 files or fewer (229 today) and src/app/s/[store]/[market]/page.tsx at 760 files or fewer (1,419 today), by node scripts/route-load.mjs.
- saving: Estimate, not built. Steps 1 to 5 with FN-5: on the graph the beacon goes from 1,306 to 480 files, the storefront home from 1,419 to 606, shop.ts from 1,305 to 294. Placed between measured routes (113 files: 240 ms and 22 MB; 315 files: 385 to 411 ms and 40 M…
- after: SF-7 steps 1 and 2 (the reach script and its test)
- tracked: no. Code review step 3.13 Domain folders (FV4, FH6; Open) moves files into folders but names no cycle, and its limits say circular imports were spot-checked on…
- notes: Steps 1 to 5 are six small edits and stand alone; do them before opening, when only imports move and no real order is on the payment paths. Step 1 is the same edit as SD-1 step 3 and DP-11 step 4 of this review: make it once. The admin gains only together wit…

### SF-2 [P1 M eager confirmed] The proxy runs before every page and prefetch, and loads the whole application to do six small reads
- evidence: The proxy is a Node function (Next 16's default) and its matcher takes every page address with its prefetches: one page view sends 13 to 54 requests through it (verified report, from the local production build; not re-run). Re-measured here: its trace is 343 files and 45.7 MB (sharp and libvips 18.9, taxonomy 12.7, chunks 12.5); a cold load takes 838 to 884 ms (2 runs) with 70.9 MB of heap, 151 MB RSS and sharp's na…
- cost: About 0.65 s and 50 MB more than a lean route on every cold proxy instance, in front of every page of every store, cached pages included. (Every shopper and visitor whose request meets a new proxy instance; the server'…)
- fix: 11 steps; first: Moves only: no function body changes, and every old import path keeps working because the old module imports the leaf (never the other way). The names are those of SD-1 step 1 of this review, which plans the same change: make it once.
- done when: src/server/route-load.graph.test.ts passes with src/proxy.ts at 120 files or fewer by static value imports (1,309 today) and reaching none of src/server/auth.ts, pages.ts, catalog.ts, stores.ts or src/lib/admin-text.ts.
- saving: Estimate: the proxy reaches about 95 files instead of 1,309 and starts near /api/ab/assign's measured 240 ms and 22 MB (113 files) instead of 838 to 884 ms and 71 MB. sharp leaves its trace with this fix; the taxonomy only with FN-8.
- after: SF-7 steps 1 and 2 (the graph test that holds the result)
- notes: Same work as SD-1 step 1 of the storefront-data plan; this entry adds the four places of redirect-writers.test.ts that pin the present layout, which that plan names only in passing. Before opening is the cheap time: no shopper meets a mistake in the move.

### SF-3 [P0 S eager corrected] Every instance waits on a start hook that loads 2.3 MB of unrelated code before it asks the database for the interface texts
- evidence: register() must finish before an instance takes a request. It imports src/server/ui-text.ts, which holds the reader (lines 29-129) beside the platform admin's translation tools and so imports ./ai and ./auth: 383 source files on my graph. Re-measured: the hook's chunk is 2.33 MB, and it spends 331 to 336 ms loading modules before its first database connection (2 runs), with 25.7 MB of heap; then one awaited query. T…
- cost: About 0.33 s on every cold start of every function (twice the lightest route's own start), 25 MB of heap and a second connection pool, plus one database round trip at start. The module loading is the waste: it is the sa… (The first request on every new instance of every route and of the proxy; the da…)
- fix: 6 steps; first: 1. New src/lib/built-in-languages.ts holding BUILT_IN_LANGUAGES and isBuiltIn() (src/lib/ui-catalog-all.ts:5-7); ui-catalog-all.ts imports and re-exports them, so its six importers do not change.
- done when: src/server/route-load.graph.test.ts holds src/instrumentation.ts at 60 files or fewer by static value imports (383 today through ui-text.ts), and the built hook loads less than 1 MB of chunks before its first database connection (2.33 MB today, by the cold-load script).
- saving: Estimate: 0.25 to 0.3 s and about 20 MB off every cold start together with FN-6 (the skeptic's figure); about 0.2 s without it, because the hook then still evaluates the schema (75 to 114 ms). The start query and the minute poll stay.
- after: SF-6 for the full saving (without it the hook still loads the schema); SF-7 steps 1 and 2
- notes: The skeptic dropped the auditor's optional step of not awaiting the hook; it stays dropped. The empty ui_translations table is what one expects before opening and is no argument here: the finding is the unrelated code every instance loads. Same split as SD-7 …

### SF-4 [P0 S eager confirmed] The visit beacons load the whole application because of one re-exported helper
- evidence: The beacon needs analytics-visits.ts (144 files on my graph). It also imports sameSite from src/server/chat-route.ts, which only re-exports it from src/lib/same-site.ts (a pure function of nine lines) and itself imports the chat agent, the AI client, the shop and support, and through them the cycle. 60 non-test files import chat-route.ts: 39 take only sameSite, 16 only fail and sameSite (counted from the import clau…
- cost: About 0.7 s and 55 MB more than needed on each cold beacon instance. (The server per cold start; the shopper's browser holds the beacon request open …)
- fix: 7 steps; first: The names are those of DP-10 of this review, which plans the same change: make it once.
- done when: src/server/route-load.graph.test.ts passes with each of the four /api/visit routes under 160 files by static value imports (1,306 today), and rg -n 'sameSite' src/server/chat-route.ts prints nothing.
- saving: Estimate: the beacon reaches 145 files instead of 1,306 and starts in about 0.25 s with 22 to 25 MB, by /api/ab/assign's measured 240 ms and 22.2 MB at 113 files. With FN-6 and FN-9 step 3 it reaches 99 files.
- after: SF-7 steps 1 and 2 (to hold it)
- notes: The cheapest large saving in this dimension: an afternoon, no behaviour change, and it frees the function every page view calls.

### SF-5 [P0 S eager corrected] The admin's words in both languages are loaded by almost every function, shoppers' pages included
- evidence: admin-text.ts imports every admin catalogue in English and Norwegian (136 non-test files under src/lib/admin-messages, 66,061 lines) and answers adminText(lang, area) from them. auth.ts imports src/lib/two-step.ts, which imports admin-text.ts for two sign-in sentences (lines 58-63 and 91-94). Built, the catalogues are one 2.75 MB chunk that takes 35 to 39 ms to load and 82 to 91 ms to evaluate with 15.0 MB of heap, …
- cost: About 120 to 130 ms and 15 MB per cold instance on nearly every function; both languages always, whatever the request's language or audience. (Every cold start: shoppers' pages, the proxy, the beacons, the font route; the …)
- fix: 6 steps; first: The names are those of SD-1 step 4 of this review, which plans part of the same change: make it once.
- done when: src/server/route-load.graph.test.ts passes with src/proxy.ts, the four /api/visit routes and src/app/s/[store]/[market]/layout.tsx not reaching src/lib/admin-text.ts (all reach it today) and with 30 or fewer route handlers reaching it (240 of 265 today).
- saving: Estimate from the chunk's measured cost (120 to 130 ms and 15 MB) and the share of catalogue source that stays loaded (548 of 3,561 KB): about 100 to 110 ms and 13 MB off each cold start of the roughly 740 entries inside the cycle, the proxy and the beacons a…
- after: SF-7 steps 1 and 2 (to hold it)
- notes: Corrected again in this pass. The verified report changed three importers and so tied the storefront's saving to FN-1's six cuts; there are 14 importers inside the cycle's closure, and with all 14 changed the saving needs none of those cuts (SD-1 of this revi…

### SF-6 [P0 S eager confirmed] The Drizzle schema is built at every start though no code reads it
- evidence: src/db/client.ts is the only non-test importer of schema.ts (searched) and passes it to drizzle(); drizzle-kit reads the file by path for migrations. No code calls the query builder or a relational query (searched for db().select, insert, update, delete and .query.*.find*: none). Built, six files under .next/server hold the table definitions (rg -l -F '.table("theme_schedules"' .next/server -g '*.js' counts 6). The …
- cost: 75 to 114 ms and 7.3 MB per copy per cold start, and 0.6 MB of JS in every function that touches the database. (Every cold start; the server's memory.)
- fix: 6 steps; first: The same edit as DP-1 and DS-1 of this review: make it once.
- done when: After pnpm build, rg -l -F '.table("theme_schedules"' .next/server -g '*.js' | wc -l prints 0 (6 today), and pnpm db:check exits 0.
- saving: Measured by the verified report: about 75 to 114 ms and 7.3 MB per copy per cold start; /api/health's own start (159 to 163 ms) falls by about half. It also removes 47 src/lib files from the reach of every database route.
- after: nothing
- tracked: yes: code review FD5, step 3.14 'Split schema.ts', Open (docs/audits/code-review-2026-11.md:116, 268, 484). This separates the one-line half from the file spli…
- notes: Do it first: three lines, measured, and every other finding's numbers get cleaner once the schema is out of every chunk.

### SF-7 [P0 S process confirmed] Nothing counts what a server entry loads, so the cycle grew unseen
- evidence: The browser's scripts have a budget test (storefront-bundle.scan.test.ts) and unchecked reads have a ratchet. One import-graph test exists, src/lib/pay-routes.graph.test.ts, and it checks only that the pay routes reach no forbidden module, not how much anything loads. I searched the 44 scan tests of src/lib and src/server and ci.yml for nft, cycle, circular and .next/server: nothing counts a server entry's imports, …
- cost: No direct cost. Without it, FN-1 to FN-6 grow back with the next features, as they grew in. (Everyone who pays FN-1 to FN-6, later.)
- fix: 5 steps; first: One test file, one baseline and one script, shared with DP-6 and SD-13 step 1 of this review (SD-1 step 5 calls the same test src/proxy.graph.test.ts): make one.
- done when: pnpm test runs src/server/route-load.graph.test.ts green, and the same test fails when the line import "@/server/chat-route" is added to src/app/api/health/route.ts (a local check, never committed).
- saving: No direct saving. It keeps the other findings' savings and makes each later cut a visible number.
- after: nothing
- tracked: partly: code review step 4.1 (FH7, FH8; Open) plans lint rules for boundaries, but lists no cycle or reach rule.
- notes: Corrected in this pass: one graph test did exist (pay-routes.graph.test.ts), for forbidden modules on the pay routes, not for size; its walker is the house style to reuse. Steps 1 and 2 come before every cut of FN-1 to FN-5.

### SF-8 [P2 M oversize corrected] 13 MB of taxonomy JSON rides in every function, and a shopper's product page parses it to show one category
- evidence: Re-measured: the "/**" include puts 6 files, 12.67 MB, into 830 of 830 traces and into the proxy's (4.08 MB gzipped, verified report). It is 82% of the trace of a light entry (/api/health: 216 files and 15.5 MB, of which 12.7). Eight server modules import the reader. Counting the layouts above a page and lazy imports, 87 entries (86 handlers and 1 page) cannot reach the reader by any import today. Next applies a rou…
- cost: 12.7 MB (4.1 MB gzipped) in every function package, and about 35 to 45 ms and 16 to 22 MB of heap once per storefront instance that fills the cache for a categorised product. Not per request. (The server's memory per storefront instance; the build and deploy (package size…)
- fix: 5 steps; first: 1. scripts/route-load.mjs (FN-7) gains --taxonomy-free: it lists the routes, as Next names them (/api/health), whose entry and the layouts above it cannot reach src/server/product-taxonomy.ts by static or lazy import, and writes them to src/data/taxonomy-free…
- done when: After pnpm build, .next/server/app/api/health/route.js.nft.json lists no file under src/data/product-taxonomy (6 today), and src/server/route-load.graph.test.ts fails when a listed route is given an import of src/server/product-taxonomy.ts.
- saving: Steps 1 to 4: 12.7 MB off 87 traces now, more as FN-1 and FN-2 split modules; what that saves on Vercel depends on how it groups those light handlers into functions, which was not visible. Step 5: 12.7 MB off every storefront function's package and 16 to 22 M…
- after: SF-7 steps 1 and 2 (the walk that derives and holds the list)
- tracked: no. docs/build-memory.md mentions the 13 MB only for Tailwind's scan (fixed).
- notes: The skeptic cut the count of entries that can drop the files from 195 to 88; this pass counts 87. The '10.5 GB summed' figure is a sum over traces, not something stored, and is not used.

### SF-9 [P1 S eager corrected] sharp, a font parser and Supabase's client load at start in functions that draw no picture, and every reader of a store loads the Stripe SDK
- evidence: Twelve server modules import sharp statically (listed under where). sharp and libvips are 18.9 MB in 741 of 830 traces, and a cold /api/visit and a cold proxy both have sharp's native binary and five of its packages in require.cache (re-measured). require('sharp') alone costs 46 to 52 ms and 21 MB of RSS (verified report). Read from the source maps of the chunks the beacon loads at start: Supabase's packages are 1.1…
- cost: About 90 to 110 ms and 21 MB of RSS per cold instance: sharp 46 to 52 ms, Supabase's client about 40 ms, Stripe 7 to 9 ms; opentype.js was not timed alone. Plus 18.9 MB per trace for sharp. (Every cold start; the function package.)
- fix: 7 steps; first: Steps 1, 2 and 5 are DP-2 of this review and step 3 is DP-3 step 1: make each once, with those names.
- done when: src/server/lazy-packages.scan.test.ts passes (0 static value imports of sharp or opentype.js under src outside tests; 13 today), and a fresh-process load of the built /api/shop/tiles route leaves no .node file in require.cache (1 today).
- saving: Estimate from the measured package costs: about 46 to 52 ms and 21 MB of RSS per cold instance for sharp on the roughly 740 entries that load it; 7 to 9 ms for Stripe; about 40 ms more for Supabase's client only where step 4 is taken.
- after: SF-1 and FN-2 for the trace share (sharp leaves a function's package only when the entry cannot reach an importer at all, lazy or not)
- notes: The skeptic corrected Stripe's cost to 7 to 9 ms (the auditor timed the unbundled package) and the file list. Added in this pass: opentype.js (482 KB of source) is in the beacon's start chunks. Step 3 alone is worth little in time; take it when stores.ts or s…

### SF-10 [P3 M eager corrected] Nine full-application functions are called every minute, and before opening they find nothing to do
- evidence: Nine cron routes are scheduled every minute (read in the baseline migration, lines 93-104: autopilot, broadcasts, cookie-scan, dream-factory, integrations, pack-pictures, page-jobs, page-looks, theme-shots): 12,960 calls a day by the schedule. Each is its own entry. Re-measured traces: page-jobs 451 files and 47.3 MB; cookie-scan 615 files and 125.4 MB with Chromium. On the graph /api/cron/page-jobs reaches 1,308 fi…
- cost: 12,960 invocations a day and up to nine warm instances of about 80 MB, three with a 125 MB package. Today that is idle cost. Once stores use these features the queues hold work most minutes and the calls are no longer i… (The server (invocations, memory); the database (one http_post and one ledger up…)
- fix: 3 steps; first: 1. Do not build a router here. The scheduled-work plan of this review owns the change: CR-1 (one every-minute tick that asks the database which queues hold due work and calls only those routes, with a 15-minute sweep as the safety net) and DP-7 (the due check…
- done when: CR-1's own check holds (in production, select count(*) from cron.job where schedule = '* * * * *' returns 1; 9 today), and the tick route is in src/server/route-load.baseline.json at 120 files or fewer.
- saving: From the schedule: about 12,960 heavy calls a day become 1,440 light ones while the queues are empty. The saving shrinks as stores arrive and the queues fill, so it is worth least when the platform is busiest.
- after: CR-1 of the scheduled-work plan (owns the scheduler change); SF-1 steps 1 to 5
- tracked: no existing plan; inside this review it is CR-1 (scheduled work) and DP-7 (the Chromium routes).
- notes: P3 here because the work is planned once, under CR-1, and because the idle calls are what one expects before opening: with stores using these features the calls do work. The skeptic made the same correction.

### SF-11 [P3 S duplicate corrected] The build writes the same large server chunks many times
- evidence: Re-measured by comparing chunk files without their last (source map) line: 5,174 server chunk files hold 4,662 distinct contents; 512 are copies, 123.6 MB of 195.5 MB. Three chunks make 107.5 MB of the copied bytes: the 4.0 MB application chunk written 18 times (67.7 MB), the 2.7 MB admin catalogue chunk 10 times (24.2 MB) and a 3.9 MB page chunk 5 times (15.6 MB). Each entry loads one copy. .next/server is 1.4 GB o…
- cost: Disk and upload in the build. Whether the copies add to the build's peak memory, or to a function's package when Vercel groups entries that use different copies, was not measured. (The build and CI.)
- fix: 3 steps; first: 1. No code change of its own: there is no setting for it. The lever is the size of the three chunks, and FN-1 and FN-5 shrink exactly those.
- done when: scripts/route-budget.mjs prints less than 60 MB of identical server chunk copies on a CI build (123.6 MB today).
- saving: Estimate: up to about 105 MB of JS and a like share of source maps off the build output once the three chunks are split or shrunk. No effect on the build's peak memory is shown.
- after: SF-1; SF-5; SF-7 step 3
- tracked: related only: code review FH10, step 1.8 'Give the build room' (Open) covers the 8 GB limit, not this cause.
- notes: Not worth work of its own now: the copies are real, but no cost beyond disk is measured, and the saving is a by-product of FN-1 and FN-5.

### SF-12 [P1 S eager added] The list of every store's own domains is parsed again for every link a page draws
- evidence: storeHosts() runs JSON.parse on process.env.NEXT_PUBLIC_STORE_HOSTS on every call and keeps nothing (paths.ts:35-42). The value is every store's active domains, written into the code when a deployment is built (next.config.ts:95, 103). marketPath(), which makes each internal link of a store page, reaches storeHosts() twice (marketCountryHost() at line 154, and again through marketHost() at line 140) and a third time…
- cost: Nothing to speak of today, with few domains. It grows with the number of stores that have a domain, for every store's pages, whether or not the store being served has one. Estimate at 1,000 such stores: about 64 ms of p… (The server per render and per proxied request; the shopper waits for it on ever…)
- fix: 4 steps; first: 1. src/lib/paths.ts:35-42: keep the last parse. Module variables parsedFrom (the text last parsed), parsed (its StoreHosts) and byHost (a Map from host to slug, from each store's primary and hosts). storeHosts() reads raw = process.env.NEXT_PUBLIC_STORE_HOSTS…
- done when: The new case in src/lib/store-hosts.test.ts passes: 1,000 calls of marketPath() with a 1,000-store hosts list call JSON.parse once (2,000 or more today).
- saving: Estimate from the measured parse: at 1,000 stores with a domain, about 64 ms per render of a page with 85 links and 1.1 ms per proxied request become one 0.4 ms parse per instance. Nothing today.
- after: nothing
- notes: Added by this pass. A cost that follows the number of stores, not use, and ten lines remove it; do it before opening. FN-13 would remove the list altogether, but this is worth having whichever way FN-13 is decided.

### SF-13 [P1 L eager added OWNER-CHOICE] Every store's own domain is compiled into each deployment: routing rules against a cap of 2,048, and a full redeploy per change
- evidence: A store's active domains are read from the database when a deployment is built (next.config.ts:95, src/lib/store-hosts-build.ts) and become routing rules and a constant in the code (decision P8, docs/platform.md:19). Counted here by running storeHostRoutes() on sample input: 4 rules with no store domain at all, then 4 more for each store with a primary domain, 5 with its www alias, 8 with two country domains; 300 st…
- cost: Little today: few stores have a domain. At opening, each store that connects or changes a domain costs one full production deployment for everyone (build minutes, all caches emptied, all functions cold) and 4 to 8 routi… (The build and CI per domain change; every store's shoppers through the cold sta…)
- fix: 9 steps; first: 0. For the owner to decide: let a store's domain answer without a deployment, by looking the host up when the request arrives. This replaces decision P8's 'routed as configuration built into each deployment' for own domains; the generic {store}.{store domain}…
- done when: In CI's hosts job a domain activated after the build serves its store's front page, and .next/routes-manifest.json holds the same number of redirects and rewrites whether the database has 0 or 300 active store domains.
- saving: Estimate: one production deployment fewer per domain change (each a full build that empties the caches and restarts every function cold), 4 to 8 routing rules fewer per store with a domain, and no ceiling near 270 such stores. No per-request gain: a remembere…
- after: SF-2 (the proxy's leaf readers and short-memory.ts) before step 3; The owner's decision before step 3; SF-7 step 3 for the count in step 1
- tracked: no. docs/platform.md P8 records the design as decided (2026-09-26) and docs/cells.md:57 notes that a domain change needs a deploy; neither names the routes cap…
- notes: Added by this pass. Before opening is the cheap time: no real store's domain is at stake yet. Step 1 is worth doing today whatever is decided. If the owner keeps P8, the ceiling still needs an answer before about 250 stores have a domain: a higher limit from …
