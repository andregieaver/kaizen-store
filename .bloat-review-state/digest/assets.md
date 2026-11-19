# assets: Files that ship or are stored but need not be

The files the repo stores are lean (102 MB tracked, all 150 files in public/ referenced, pictures and fonts stored once); the waste is in what every server function carries and in what a browser is sent, and none of it rests on a feature being unused. sharp's native library (19.8 MB) is in 742 of 832 route traces and the taxonomy (13.3 MB) in 831, 33 MB of the median trace's 52.6 MB, and sharp loads at each cold start of the proxy (35 to 57 ms, 22.5 MB) though no shopper's page draws with it. Four small fixes go first (P0): search thumbnails of uploaded photographs answer 400 today (measured on the built app), font files are not kept by the CDN, the build's page worker runs with source maps on at 4.7 MB of heap per MB of code it loads (+498 MB for 107 MB, measured) on a build that already ran out of its 8 GB once, and nothing reports what a function carries. The completeness check added two: on 3x phones and Retina laptops every product tile downloads the 1600 px file because nothing is kept between 480 and 1600 px (measured in Chromium), and videos, 3D models and theme photographs are stored with a one-hour or five-minute cache where pictures get a year.

## Measures
- Tracked files: 102.0 MB in 7,609 files: src 70.9 MB, supabase 11.3 MB, docs 10.5 MB, public 5.6 MB, e2e 1.6 MB, content 0.9 MB, scripts 0.5 MB
- Git history (informational only): 48.85 MiB in packs; the clone is shallow (116 commits), so this says nothing about the full history
- public/: 150 files, 5.60 MB: theme art and demo pictures 4.78 MB, WordPress zips 0.63 MB, flags 0.18 MB (six of them 165 KB raw, 39.8 KB brotli), favicon 26 KB. 0 unreferenced (second check)
- Route traces that carry sharp's native library: 742 of 832, 19.81 MB each (libvips 18.71 MB, sharp 0.63 MB, the addon 0.42 MB)
- Route traces that carry the taxonomy: 831 of 832, 13.28 MB each (4.08 MB gzip, second check); only instrumentation.js is without
- Median route trace: 52.6 MB; 19.5 MB without sharp and the taxonomy. Proxy 47.9 MB, storefront home 51.9 MB, storefront checkout 52.4 MB, /api/health 16.2 MB, largest 139.8 MB (a customer's PDF route)
- What else is in a common trace: Besides the build's own chunks (17.1 MB in the storefront home's trace), sharp and the taxonomy, no package weighs more than 0.9 MB. Four traces carry all 150 files of public/ (5.6 MB): three platform theme screens and /api/cron/pack-pictures
- Import reach: src/proxy.ts reaches 1,309 of 4,126 non-test source files by static imports; 740 of 828 page and route entries reach both a sharp importer and product-taxonomy.ts, 88 reach neither
- Proxy bundle, cold: 0.92 to 1.00 s and +197 MB RSS to load .next/server/middleware.js and await its exports in bare node (three runs at load 1.1 to 1.5); heap 78 MB
- sharp alone: 50 to 57 ms and 22.1 to 22.7 MB RSS in three runs at load 2.8 (the second check measured 35 to 41 ms at low load)
- Source maps in a build worker: One process loading 142 built entries (1,452 chunks, 106.6 MB of chunk JS): heap 290 MB and RSS 372 MB without --enable-source-maps, heap 788 MB and RSS 921 MB with it; 2.9 s against 5.1 s. 43 entries (70.5 MB): heap 214 against 543 MB. About 4.7 MB of heap p…
- Server build output: 205 MB of chunk JS and 704 MB of source maps under .next/server; 0 maps in any of the 832 traces
- Next's image endpoint on the built app: /_next/image with a Supabase Storage picture address: 400 '"url" parameter is not allowed'. With /demo/themes/orbit/stars.webp and w=64: 200, an image
- Hidden images: Chromium 153 fetches an <img> hidden with display:none (on itself or a parent) or inside a closed <details>; with loading=lazy it does not, and fetches it when the <details> opens
- Which stored picture a browser takes: srcset 'small 480w, large 1600w' with a tile's sizes (50vw, 25vw from 768 px): 390 px at 2x takes the 480 file; 390 px at 3x, 360 px at 3x, 412 px at 2.625x and 1440 px at 2x take the 1600 file. A full-width picture takes the 1600 file on every phone tested
- Bytes of the picture sizes (theme art, illustrations): The 24 files in public/demo at least 1500 px wide: mean 71 KB as stored, 8 KB as a 480 px copy, 18 KB at 800 px, 22 KB at 960 px
- Public files' cache lifetime: Cache-Control: public, max-age=0 for /flags/no.svg and /demo/themes/botanica/paper.webp
- Fonts in production: 163 font files, 5.7 MB, as bytea in Postgres; the stylesheet query ran 42,211 times in 78 days (cold instances, deploys and the team's testing, not shoppers)
- Instruction and decision files: docs/decisions.md 1,330,879 bytes in 931 lines, longest line 17,985 characters; CLAUDE.md 43,361 bytes in 448 lines
- supabase/: archive 4.6 MB, migrations 6.7 MB (four baseline files and one 2.7 MB snapshot kept out of Vercel by .vercelignore), seed.sql 29 KB

## Well made
- public/: all 150 files are referenced (second check, by name). Nothing dead.
- Pictures: each upload is two files made in the browser, stored once under a random name with a one-year cache (src/server/media.ts:80). Nothing is resized on the server per request; sharp's 43 calls are all inside functions for jobs, imports and admin or AI t…
- Chromium (70.1 MB) is traced only into the routes that launch it and is loaded by dynamic import (src/server/browser.ts:11-15); a test holds the list.
- The taxonomy's loader is lazy: each file is read once per instance, only when a product has a standard category or a listing has attribute facets (src/server/product-taxonomy.ts:40-52). A store that does not use standard categories pays nothing at run time.
- Fonts: files are named by content hash with a one-year immutable browser cache; the stylesheet is kept a year at the CDN. 5.7 MB in Postgres is small. The one gap is AS-9.
- Share pictures (og.png) are fallbacks and are kept a day at the CDN with a week of stale-while-revalidate (src/lib/share-card.tsx:30). Review pictures are kept five minutes on purpose: a picture can be withdrawn (src/app/api/reviews/picture/[id]/route.ts:26).
- supabase/: snapshots pruned to one (D532) and 789 migrations squashed to four files (D572) this week. The archive (4.6 MB) costs nothing at run time.
- scripts/: 27 top-level scripts, 0.5 MB with their helpers; each is named by package.json, CI, a test or a doc (counted by name in this pass; one load script only by its folder). wordpress-plugin/, shopify/, e2e-live/ and test/ are small and in use.
- WordPress zips: 12 files, 0.63 MB, static; a written rule keeps every version downloadable (docs/wordpress-plugin.md:125).
- Theme art: 88 WebP files are seeds; a store's copy is made inside Storage, not uploaded again. No function carries them except the four routes that read public/ by a computed path.
- content/: 168 Markdown files, 0.9 MB, traced into 22 routes only.
- Traces by package: nothing heavy beyond the build's own chunks, sharp and the taxonomy rides in the common trace (largest other package 0.9 MB).
- .vercelignore keeps only the Drizzle snapshot out of the build. Docs (10.5 MB), e2e and the migration archive are uploaded and not needed: about 17 MB of text per build, not worth a change.
- Heavy browser files (the AVIF encoder 3.5 MB, the 3D decoders, the video encoder) are separate static files loaded on the press that needs them.
- Under the owner's clarification: nothing in this dimension argues from a feature being unused. Every cost below is paid whether or not a store uses the feature behind it, or grows with shoppers.

## Findings (12)

### AS-1 [P1 S eager corrected] The image library (sharp, 19.8 MB) is in 742 of 832 route traces and the proxy's, and loads when the proxy or a route as plain as robots.txt starts
- evidence: Twelve server modules import sharp at the top of the file; rg finds 43 calls in them, and I read each: every one is inside an async function, none at module top level. The proxy reaches seven of the twelve by static imports (graph re-run: proxy.ts:11 -> house-switch.ts -> pages.ts -> visibility.ts -> customers.ts -> privacy-erasure.ts -> data-jobs.ts -> api-uploads.ts -> ai-pictures.ts is the shortest chain). In the…
- cost: At start: 35 to 57 ms and 22.5 MB RSS to load it, about 4% of the proxy's 0.9 s start and 11% of its 196 MB. On disk: 19.8 MB in 742 of 832 traces (38% of the storefront home's 51.9 MB, 41% of the proxy's 47.9 MB); Verc… (Every visitor whose request meets a cold instance (the proxy runs before every …)
- fix: 5 steps; first: 1. New file src/server/sharp.ts: import "server-only"; import type sharp from "sharp"; export type { Sharp, OverlayOptions } from "sharp"; export function loadSharp() that keeps one promise of (await import("sharp")).default and returns it, as src/server/brow…
- done when: After a build, loading .next/server/middleware.js in bare node and awaiting its exports maps no libvips (today /proc/self/maps lists libvips-cpp.so), and pnpm lint fails on a new value import of sharp in src outside src/server/sharp.ts.
- saving: Steps 1 to 4: 35 to 57 ms and 22.5 MB RSS less at each cold start of the proxy and of any function whose first route reaches an importer (measured in bare node here for the proxy and robots.txt; an estimate for Vercel). Step 5: 19.8 MB less in each trace that…
- after: AS-3 (for the count that step 5 drives down); server-graph SG-1/SG-2 or tests-ci TC-2 (the import cycle) for step 5 only
- tracked: no. Nearest: code review step 4.1 (lint rules, Open) and step 3.13 (domain folders, Open). None names sharp.
- notes: The same finding as deps DP-2 (which adds opentype.js, loaded the same way), server-graph SG-7 and functions FN-9: do it once. Small in time (about 4% of the proxy's start) but safe, and the lint rule is the first of the boundary rules. I did not propose excl…

### AS-2 [P3 M oversize corrected] The product taxonomy (13.3 MB of JSON) is traced into every route, the proxy and the health check included
- evidence: next.config.ts:69 traces src/data/product-taxonomy/* into the key "/**"; its comment gives the reason (the editor, imports, listings, feeds and the AI manager's tools all read it). Re-run: 831 of 832 traces list it, 13.28 MB each; /api/health's trace is 16.2 MB, of which 13.3 MB is the taxonomy. The loader is lazy (product-taxonomy.ts:40-52). By static imports 740 of 828 entries reach the loader (graph re-run), the …
- cost: 13.3 MB (4.1 MB zipped) in every trace. Its effect on cold-start time was not measured: Vercel packs routes into shared functions and zips them. When read: 21 ms and 11.3 MB of heap for the structure, 8 to 10 ms and 4.7… (The server: the size of every function. No store pays at run time for a taxonom…)
- fix: 4 steps; first: 1. Now: nothing. Keep the lazy loader and the files, and let AS-3's report show the count (831).
- done when: scripts/trace-sizes.mjs reports the taxonomy in fewer than 831 traces, and the scan test passes: every entry that can reach product-taxonomy.ts is covered by a key.
- saving: 13.3 MB per trace that can never read it: about 90 today, more once the cycle is cut. Nothing at run time: it is already lazy.
- after: AS-3; server-graph SG-1 (the import cycle)
- notes: P3 because its cost on anything a person feels is unmeasured, the saving today is in the 90 smallest traces, and it depends on the boundary work. Not worth doing: compressing the files on disk (9.2 MB less per trace, but a gunzip per read and no change to the…

### AS-3 [P0 S process confirmed] Nothing checks what a server function carries or what the proxy imports
- evidence: The browser's scripts have an import walk and byte budgets. The server side has only the Chromium list: no test, script or CI step reads a .nft.json, and nothing limits what src/proxy.ts may import (second check; I re-ran its graph: the proxy reaches 1,309 of 4,126 source files, and still 1,309 with the two cache-tag imports cut). The review's own scripts sum all 832 traces by route and by package in 1.7 s. That rep…
- cost: No direct cost. It is why 33 MB of the median trace's 52.6 MB is two assets most routes never use, why the proxy loads 13 MB of code before every page, and why nothing stops the next one. (Every visitor (cold starts of the proxy and of pages) and the build, later.)
- fix: 5 steps; first: 1. New script scripts/trace-sizes.mjs (plain node, no dependency), from /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/as-plan/nft.mjs and pkgs.mjs: walk .next/server for *.nft.json, resolve each listed file, sum by…
- done when: CI's e2e job summary shows the trace table for a push, and adding import "@/server/product-import" to src/proxy.ts locally makes pnpm test fail in ratchet.scan.test.ts.
- saving: None by itself. It holds every later gain and gives AS-1, AS-2 and the server-graph work a number that can only fall.
- after: nothing
- tracked: Partly: code review step 4.1 'Lint rules for the boundaries' (FH7, FH8), Open; step 3.13 'Domain folders', Open. Neither measures a function or the proxy.
- notes: The same gap as deps DP-6, server-graph SG-14, functions FN-7 and storefront-data SD-13 of this review: build it once. Before opening is the cheap time for the boundary work it guards, because every new feature adds to the tangle.

### AS-4 [P0 S dead confirmed] Search suggestions ask Next's image service for uploaded pictures and get a 400, so real stores will show empty thumbnails; the service itself is open and unused
- evidence: Ten next/image tags; nine carry unoptimized, as picture-sizes.ts:6 says they must; the one in the search box does not (re-counted with rg). Stored pictures have absolute Supabase Storage addresses (media.ts:93); next.config.ts has no images key, and the build's manifest shows remotePatterns [] and unoptimized false. Measured on the built app in this pass: /_next/image?url=<a Supabase Storage picture address>&w=48&q=…
- cost: One failed request per suggested product with an uploaded picture, up to six each time the list is drawn (search.ts:376), and an empty thumbnail. On Vercel an open /_next/image is also a billed transformation per distin… (A shopper's browser and Vercel's image endpoint, in every store whose products …)
- fix: 5 steps; first: 1. next.config.ts: add images: { unoptimized: true } to nextConfig, beside poweredByHeader. Every Image is then served as stored, the search box included, and /_next/image answers 404.
- done when: On the built app, curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/_next/image?url=%2Fdemo%2Fthemes%2Forbit%2Fstars.webp&w=64&q=75' prints 404 (200 today), and the new assertion in e2e/search.spec.ts passes.
- saving: Working thumbnails in every store with uploaded photographs, up to six failed requests less per suggestion list, and one public resizing endpoint closed.
- after: nothing
- notes: A bug more than bloat: do it before opening. I changed the fix from 'a scan test that every tag carries the prop' to the one config line, which makes the mistake impossible and closes the unused endpoint as well.

### AS-5 [P2 S eager corrected] Flags are downloaded even while the switcher hides them, public files have no cache lifetime, and six flags and two textures are far bigger than their job
- evidence: 1. The switcher draws an <img> per language's flag in its list and its menu (language-links.tsx:72) with no loading attribute; flags are off by default (language-switch.test.ts:14) and hidden with display:none (part-css.ts:706). Measured in headless Chromium 153: an image hidden with display:none, on itself or a parent, or inside a closed <details>, is fetched at page load; with loading=lazy it is not, and it is fet…
- cost: Per full page load (first view, reload, new tab; not an in-site navigation): one request per language's flag, shown or not, and one conditional request per public file already held. Up to 13 KB per heavy flag on a first… (A shopper's browser, in every store with more than one language and every store…)
- fix: 4 steps; first: 1. src/components/language-links.tsx:72: add loading="lazy" to the flag <img>. A hidden flag is then never fetched; one in a closed menu is fetched when the menu opens.
- done when: On a store page with the Languages part and flags off, the browser's request log has no request under /flags/ (one per language today); curl -sI /flags/no.svg shows max-age=86400; du -cb public/flags/* is under 20 KB (176 KB today).
- saving: Step 1: one request per language per full page load in a store that does not show flags (most are 0.2 KB; Spanish and Croatian 13 KB each). Step 2: estimate of two to six conditional requests less per repeat load within a day. Step 3: 13 KB per Spanish or Cro…
- after: nothing
- notes: Steps 1 and 2 are one line each; do them with the next change to the switcher or to next.config.ts. I changed step 3 from simplified drawings to small raster copies: same look, no flag loses its arms.

### AS-6 [P3 S oversize confirmed] The PDF routes carry all of react-dom (8.1 MB) to use two server builds of it
- evidence: DOCUMENT_PDF_FILES traces react-dom/** whole (next.config.ts:23). Re-run: four traces carry it, 8.07 MB each; the trace of /api/cron/document-pdfs is 106.8 MB. document-html.tsx loads react-dom/server through Node at run time (lines 18-22). In production server.node.js requires react-dom-server-legacy.node.production.js (0.26 MB) and react-dom-server.node.production.js (0.30 MB); both require react and react-dom, wh…
- cost: About 7.5 MB on each of four traces of 106.8 to 139.8 MB. No effect on anything a person feels was measured. (The server (the size of the PDF functions).)
- fix: 3 steps; first: 1. next.config.ts:23: replace the react-dom/** glob with two: .../react-dom/{package.json,index.js,server.js,server.node.js} and .../react-dom/cjs/{react-dom.production,react-dom-server.node.production,react-dom-server-legacy.node.production}.js.
- done when: scripts/trace-sizes.mjs shows react-dom at about 0.6 MB in its four traces (8.07 MB today), and an invoice PDF downloads from a preview deployment.
- saving: About 7.5 MB per PDF trace (estimate from file sizes), 5 to 7% of those traces.
- after: AS-3 (to read the number)
- notes: P3: the gain is a few percent of the four largest traces and nothing a person feels; the risk is invoices failing in production. Do it only if a function nears Vercel's size limit.

### AS-7 [P3 S dead corrected] Tailwind reads 22.5 MB that adds nothing to the CSS today: the test files and the migrations' SQL
- evidence: globals.css points Tailwind at all of src except data (lines 7-8) and at supabase/migrations/*.sql (line 9); D378 chose both. The second check compared the built CSS's 1,833 class names with the code, the tests and the SQL: none exists only in the SQL, ten only in tests. The css dimension's second check (CS-6) ran Tailwind's scanner with and without these sources: 0.1 to 0.35 s of 0.42 to 0.74 s, and 436 bytes of CS…
- cost: 22.5 MB of the 61.2 MB Tailwind reads on each build and dev start, 0.1 to 0.35 s (measured by CS-6), and ten stray selectors. (The build and developers. Small.)
- fix: 3 steps; first: 1. Do it inside css CS-6, not apart. src/app/globals.css after line 8: @source not "../**/*.test.ts"; and @source not "../**/*.test.tsx";.
- done when: The built stylesheet has the same class names as today minus the ten that only tests name (order-1038, col-1, row-1 and the like), by the comparison script.
- saving: About a third less text for Tailwind to scan; 0.1 to 0.35 s per build and 436 bytes of CSS (CS-6's measurement).
- after: css CS-6 (the same change)
- tracked: Partly: code review step 1.8 (FH10), Open; the rule is D378 in docs/build-memory.md. The same finding as css CS-6.
- notes: P3 on its own: a fraction of a second per build. Its worth is that a word in a test can no longer change the production stylesheet; CS-6 carries it.

### AS-8 [P2 M oversize confirmed] The decisions log is one 1.33 MB file and keeps growing; CLAUDE.md is 43 KB in every agent session
- evidence: Re-measured: docs/decisions.md is 1,330,879 bytes in 931 lines, the longest line 17,985 characters; CLAUDE.md is 43,361 bytes in 448 lines and is loaded into every agent session (this one too). The code review measured 1.24 MB and 39.5 KB on 9 November. The history here is shallow, so growth before 10 November rests on the review's own line 254.
- cost: Estimate at four characters a token: about 11,000 tokens per session for CLAUDE.md; the decisions log (about 330,000) cannot be opened whole by any session. (An agent's session.)
- fix: 2 steps; first: 1. Do code review step 1.10 as this review's docs-context findings DC-1 to DC-3 plan it: one file per hundred decisions with a generated index, migration versions in their own file, CLAUDE.md's feature index moved to the area files. This dimension adds no sec…
- done when: wc -c CLAUDE.md prints under 15,000 and no decisions file is over 200 KB, both held by ratchet.scan.test.ts.
- saving: About 10,000 tokens per agent session (the code review's estimate).
- after: docs-context DC-1, DC-2 and DC-3; code review step 1.10
- tracked: Yes: FH4 and FH5, code review step 1.10 'Make the written rules cheap to read', Open. Not new.
- notes: A pointer, not a second plan: docs-context owns the fix and the owner's decision on CLAUDE.md. Kept here only so the assets list is complete.

### AS-9 [P0 S eager confirmed] The font file route does not tell the CDN to keep the file, unlike the stylesheet route beside it
- evidence: The file route answers with 'public, max-age=31536000, immutable' and no s-maxage (route.ts:16); the stylesheet route sends s-maxage=31536000 as well (css route.ts:40). fontFile() has no cache of its own: each call reads the bytea row (fonts.ts:185-189). The second check could not say whether Vercel keeps a function's answer on max-age alone. Vercel's CDN guide answers it: 'To cache the response of Functions on Verc…
- cost: One function call and one read of about 35 KB of bytea (5.7 MB in 163 files) per font file for every visitor whose browser does not hold it yet: one to a few files per store per new visitor. Not counted in production's … (The server per request and the database, growing with new visitors once the pla…)
- fix: 4 steps; first: 1. src/app/api/fonts/files/[file]/route.ts:16: 'public, max-age=31536000, s-maxage=31536000, immutable'.
- done when: The second curl -sI of one /api/fonts/files/{name}.woff2 on a production host answers x-vercel-cache: HIT.
- saving: After the first request per region and deploy, font file requests stop at the CDN: no function call and no database read. The count depends on visitors and is not measurable before opening.
- after: nothing
- notes: Confidence raised from low to medium on Vercel's own documentation. One line; cheaper to make than to investigate further.

### AS-10 [P0 S oversize corrected] The build's page worker runs with source maps on: about 4.7 MB of heap per MB of server code it loads, and 704 MB of maps written that no function carries
- evidence: The second check counted 704 MB of .map files beside 205 MB of server chunks and none in any trace; I re-counted both. New in this pass, the mechanism: Next makes its one static worker (it collects page data and renders the static pages) with enableSourceMaps: config.enablePrerenderSourceMaps (build/index.js:396-408), and that starts the worker with --enable-source-maps (lib/worker.js:71). The build's settings show …
- cost: On Vercel's build: several hundred MB of the page worker's memory (estimate: up to about 960 MB if it loads all 205 MB of chunks, by the measured ratio; not measured in a build), about 2 s more per 100 MB of chunks load… (The build on Vercel's 8 GB machine. A build that runs out of memory fails the d…)
- fix: 4 steps; first: 1. next.config.ts, in nextConfig: add ...(ON_VERCEL ? { enablePrerenderSourceMaps: false } : {}). It is a top-level key, not under experimental. CI's builds and local builds keep their maps.
- done when: docs/build-memory.md's table has a row for each of the two settings with the build's peak under the 8 GB cap, and the kept setting's peak is below today's 7.2 GB.
- saving: Not yet measured in a build. Measured mechanism: 4.7 MB of heap per MB of server code a worker loads (+498 MB for 107 MB of chunks). If step 3 stays: 704 MB less written per build.
- after: nothing
- tracked: Partly: code review step 1.8 'Give the build room' (FH10), Open. It does not name source maps.
- notes: The second check filed this as an unmeasured experiment with low confidence. I measured the mechanism and raised it: the build is at its limit, the change is one line and safe, and a failed deploy is the dearest failure here. The build-wide numbers still need…

### AS-11 [P1 M oversize added] Nothing is kept between 480 and 1600 pixels, so 3x phones and Retina laptops download the 1600 px file for every product tile
- evidence: Added by the completeness check. Every picture is kept as two files, 480 px and at most 1600 px (picture-sizes.ts:11-13), offered to the browser as 'small 480w, large Nw' (line 25). A product tile says it fills half the screen on a phone and a quarter from 768 px (product-card.tsx:16). I served that srcset and sizes to headless Chromium 153 and logged which file it asked for: 390 px wide at 2x takes the 480 file; 39…
- cost: Per product tile on a 3x phone or a 2x laptop: the whole large file where a file of about 800 px would do, about 53 KB more for the art measured (71 against 18 KB); photographs are heavier. A listing shows up to 48 tile… (A shopper's browser and data plan, in every store with product pictures, on mos…)
- fix: 8 steps; first: 1. src/db/schema.ts, table media: add mediumUrl (medium_url) and mediumPath (medium_path), text, nullable; pnpm db:generate. Add only; media is not one of the hot tables.
- done when: The new e2e test passes: at 390 px and 3x the first product tile's currentSrc is the 800 px file (today the 1600 px file, by work/as-plan/srcset-test.cjs).
- saving: Estimate from the theme art: about 53 KB less per product tile (71 to 18 KB) on 3x phones and 2x laptops, and the same on the product page's main picture on 2x phones. Real photographs were not measured and should save more.
- after: nothing
- tracked: no. D336 (wave 7 unit B) chose two files; docs/performance.md has no rule on screen density.
- notes: Before opening is the cheap time: no real library needs a backfill, and every real picture has three files from its first day. A one-line alternative, if the owner prefers it: offer the small copy as 600w for tiles, so 3x phones take the 480 px file slightly …

### AS-12 [P2 S eager added] Videos, 3D models and theme photographs are stored with a one-hour or five-minute cache, though their addresses never change; pictures get a year
- evidence: Added by the completeness check. Pictures are uploaded by the server with cacheControl "31536000" (media.ts:80). Videos, 3D models and custom-field files go from the owner's browser straight to Storage with uploadToSignedUrl(path, token, file, { contentType }): no cacheControl, so supabase-js sends its default "3600" (storage-js index.mjs:598-599 and 1620). Each goes to a new random path (media.ts:192, 217, 309), so…
- cost: Not measured. After an hour (a background video, a product video, a 3D model) or five minutes (a theme photograph, a copied video) a returning visitor's browser must ask Storage again before it may reuse the file: one r… (A shopper's browser in stores that use videos or 3D models; owners and visitors…)
- fix: 5 steps; first: 1. Add cacheControl: "31536000" to the options of uploadToSignedUrl at src/components/admin/video-upload.tsx:129, src/components/admin/media-compress.ts:62, src/components/admin/product-media-tools.tsx:220 and src/components/admin/field-file-upload.ts:27. Eac…
- done when: rg -n 'uploadToSignedUrl\(' src/components shows cacheControl on all 9 calls (0 today), and a video uploaded on a test store answers cache-control: max-age=31536000 from Storage (curl -sI on its public address).
- saving: Not measured: one round trip to Storage less per video, model or theme photograph each time a visitor returns after its lifetime; origin fetches at the edge where Smart CDN is not on.
- after: nothing
- notes: Small per visitor, but the lifetime is fixed when a file is uploaded, so it is cheapest before real owners upload videos: do steps 1 and 2 before opening even though the saving is modest.
