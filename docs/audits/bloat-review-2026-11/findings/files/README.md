# Files that ship or are stored (AS)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** The files the repo stores are lean (102 MB tracked, all 150 files in public/ referenced, pictures and fonts stored once); the waste is in what every server function carries and in what a browser is sent, and none of it rests on a feature being unused. sharp's native library (19.8 MB) is in 742 of 832 route traces and the taxonomy (13.3 MB) in 831, 33 MB of the median trace's 52.6 MB, and sharp loads at each cold start of the proxy (35 to 57 ms, 22.5 MB) though no shopper's page draws with it. Four small fixes go first (P0): search thumbnails of uploaded photographs answer 400 today (measured on the built app), font files are not kept by the CDN, the build's page worker runs with source maps on at 4.7 MB of heap per MB of code it loads (+498 MB for 107 MB, measured) on a build that already ran out of its 8 GB once, and nothing reports what a function carries. The completeness check added two: on 3x phones and Retina laptops every product tile downloads the 1600 px file because nothing is kept between 480 and 1600 px (measured in Chromium), and videos, 3D models and theme photographs are stored with a one-hour or five-minute cache where pictures get a year.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [AS-3](AS-3.md) ✓ | Nothing checks what a server function carries or what the proxy imports | no check | P0 | S | 1.8 |
| [AS-4](AS-4.md) ✓ | Search suggestions ask Next's image service for uploaded pictures and get a 400, so real stores will show empty thumbnails; the service itself is open and unused | dead | P0 | S | 0.32 |
| [AS-9](AS-9.md) ✓ | The font file route does not tell the CDN to keep the file, unlike the stylesheet route beside it | eager | P0 | S | 0.32 |
| [AS-10](AS-10.md) ✓ | The build's page worker runs with source maps on: about 4.7 MB of heap per MB of server code it loads, and 704 MB of maps written that no function carries | oversize | P0 | S | 1.20 |
| [AS-1](AS-1.md) ✓ | The image library (sharp, 19.8 MB) is in 742 of 832 route traces and the proxy's, and loads when the proxy or a route as plain as robots.txt starts | eager | P1 | S | 0.5 |
| [AS-11](AS-11.md) | Nothing is kept between 480 and 1600 pixels, so 3x phones and Retina laptops download the 1600 px file for every product tile | oversize | P1 | M | 0.33 |
| [AS-5](AS-5.md) ✓ | Flags are downloaded even while the switcher hides them, public files have no cache lifetime, and six flags and two textures are far bigger than their job | eager | P2 | S | 0.32 |
| [AS-8](AS-8.md) ✓ | The decisions log is one 1.33 MB file and keeps growing; CLAUDE.md is 43 KB in every agent session | oversize | P2 | M | 2.40 |
| [AS-12](AS-12.md) | Videos, 3D models and theme photographs are stored with a one-hour or five-minute cache, though their addresses never change; pictures get a year | eager | P2 | S | 0.32 |
| [AS-2](AS-2.md) ✓ | The product taxonomy (13.3 MB of JSON) is traced into every route, the proxy and the health check included | oversize | P3 | M | 2.23 |
| [AS-6](AS-6.md) ✓ | The PDF routes carry all of react-dom (8.1 MB) to use two server builds of it | oversize | P3 | S | tolerated |
| [AS-7](AS-7.md) ✓ | Tailwind reads 22.5 MB that adds nothing to the CSS today: the test files and the migrations' SQL | dead | P3 | S | 0.35 |

## Measured

| Measure | Value | How |
|---|---|---|
| Tracked files | 102.0 MB in 7,609 files: src 70.9 MB, supabase 11.3 MB, docs 10.5 MB, public 5.6 MB, e2e 1.6 MB, content 0.9 MB, scripts 0.5 MB | git ls-files piped to stat, summed by top-level folder (re-run in this pass at commit c7aea07) |
| Git history (informational only) | 48.85 MiB in packs; the clone is shallow (116 commits), so this says nothing about the full history | git count-objects -vH; git rev-parse --is-shallow-repository; git rev-list --count HEAD |
| public/ | 150 files, 5.60 MB: theme art and demo pictures 4.78 MB, WordPress zips 0.63 MB, flags 0.18 MB (six of them 165 KB raw, 39.8 KB brotli), favicon 26 KB. 0 unreferenced (second check) | du -sb per folder and find, re-run; the reference check is the second check's |
| Route traces that carry sharp's native library | 742 of 832, 19.81 MB each (libvips 18.71 MB, sharp 0.63 MB, the addon 0.42 MB) | node docs/audits/bloat-review-2026-11/scripts/sources/as-plan/nft.mjs.txt and docs/audits/bloat-review-2026-11/scripts/sources/as-plan/pkgs.mjs.txt over .next/server/**/*.nft.json of the finished build (build-summary.txt exit=0); 1.7 s |
| Route traces that carry the taxonomy | 831 of 832, 13.28 MB each (4.08 MB gzip, second check); only instrumentation.js is without | same script |
| Median route trace | 52.6 MB; 19.5 MB without sharp and the taxonomy. Proxy 47.9 MB, storefront home 51.9 MB, storefront checkout 52.4 MB, /api/health 16.2 MB, largest 139.8 MB (a customer's PDF route) | same script |
| What else is in a common trace | Besides the build's own chunks (17.1 MB in the storefront home's trace), sharp and the taxonomy, no package weighs more than 0.9 MB. Four traces carry all 150 files of public/ (5.6 MB): three platform theme screens and /api/cron/pack-pictures | docs/audits/bloat-review-2026-11/scripts/sources/as-plan/pkgs.mjs.txt: traced files grouped by package, per trace and summed over traces |
| Import reach | src/proxy.ts reaches 1,309 of 4,126 non-test source files by static imports; 740 of 828 page and route entries reach both a sharp importer and product-taxonomy.ts, 88 reach neither | node docs/audits/bloat-review-2026-11/scripts/sources/as-plan/graph.mjs.txt (the second check's regex import graph, re-run) |
| Proxy bundle, cold | 0.92 to 1.00 s and +197 MB RSS to load .next/server/middleware.js and await its exports in bare node (three runs at load 1.1 to 1.5); heap 78 MB | node --expose-gc docs/audits/bloat-review-2026-11/scripts/sources/as-plan/load-maps.cjs.txt. An estimate for Vercel |
| sharp alone | 50 to 57 ms and 22.1 to 22.7 MB RSS in three runs at load 2.8 (the second check measured 35 to 41 ms at low load) | node -e require('sharp'), timed with process.hrtime |
| Source maps in a build worker | One process loading 142 built entries (1,452 chunks, 106.6 MB of chunk JS): heap 290 MB and RSS 372 MB without --enable-source-maps, heap 788 MB and RSS 921 MB with it; 2.9 s against 5.1 s. 43 entries (70.5 MB): heap 214 against 543 MB. About 4.7 MB of heap per MB of chunk | node --expose-gc [--enable-source-maps] docs/audits/bloat-review-2026-11/scripts/sources/as-plan/load-many.cjs.txt 200 and 60; Next starts its build worker with that flag when enablePrerenderSourceMaps is on (next/dist/build/index.js:408, next/dist/lib/worker.js:71) |
| Server build output | 205 MB of chunk JS and 704 MB of source maps under .next/server; 0 maps in any of the 832 traces | find .next/server -name '*.map' and '*.js' summed; maps counted in the traces by the trace script |
| Next's image endpoint on the built app | /_next/image with a Supabase Storage picture address: 400 '"url" parameter is not allowed'. With /demo/themes/orbit/stars.webp and w=64: 200, an image | curl against the local production server on port 3000 |
| Hidden images | Chromium 153 fetches an <img> hidden with display:none (on itself or a parent) or inside a closed <details>; with loading=lazy it does not, and fetches it when the <details> opens | node docs/audits/bloat-review-2026-11/scripts/sources/as-plan/lazy-test.cjs.txt: a local page and a request log, headless Chromium |
| Which stored picture a browser takes | srcset 'small 480w, large 1600w' with a tile's sizes (50vw, 25vw from 768 px): 390 px at 2x takes the 480 file; 390 px at 3x, 360 px at 3x, 412 px at 2.625x and 1440 px at 2x take the 1600 file. A full-width picture takes the 1600 file on every phone tested | node docs/audits/bloat-review-2026-11/scripts/sources/as-plan/srcset-test.cjs.txt: headless Chromium 153 with deviceScaleFactor set, request log. Safari and Firefox not run |
| Bytes of the picture sizes (theme art, illustrations) | The 24 files in public/demo at least 1500 px wide: mean 71 KB as stored, 8 KB as a 480 px copy, 18 KB at 800 px, 22 KB at 960 px | sharp in memory: resize and WebP at quality 78 (480) and 80; nothing written |
| Public files' cache lifetime | Cache-Control: public, max-age=0 for /flags/no.svg and /demo/themes/botanica/paper.webp | curl -I against the local production server; Next's public-folder guide says the same |
| Fonts in production | 163 font files, 5.7 MB, as bytea in Postgres; the stylesheet query ran 42,211 times in 78 days (cold instances, deploys and the team's testing, not shoppers) | evidence/prod-db-stats.md lines 31 and 107 |
| Instruction and decision files | docs/decisions.md 1,330,879 bytes in 931 lines, longest line 17,985 characters; CLAUDE.md 43,361 bytes in 448 lines | wc -c, wc -l, awk (re-run) |
| supabase/ | archive 4.6 MB, migrations 6.7 MB (four baseline files and one 2.7 MB snapshot kept out of Vercel by .vercelignore), seed.sql 29 KB | du -sb (re-run) |

## Well made, and should stay

- public/: all 150 files are referenced (second check, by name). Nothing dead.
- Pictures: each upload is two files made in the browser, stored once under a random name with a one-year cache (src/server/media.ts:80). Nothing is resized on the server per request; sharp's 43 calls are all inside functions for jobs, imports and admin or AI tools (every call site read in this pass: all are in async functions).
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
