# Files that ship or are stored (AS)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** The files this repo stores are mostly lean: all 150 files in public/ are referenced, every script and small folder is in use, supabase/ was cleaned this week (one snapshot, 789 migrations squashed), and pictures and fonts are stored once and cached for a year with no resizing per request. The bloat is in what gets packed into server functions. Two assets, the image library (sharp with libvips, 19.8 MB) and the product taxonomy (13.3 MB of JSON), make up 33 MB of the median function's 52.8 MB, and both ride in the proxy that runs before every page; the image library is also loaded at every cold start of that proxy (measured on the built bundle). The rest is small: one image tag that asks for a picture Next refuses, public files with no cache lifetime, six oversize flags, and a Tailwind scan of 22.5 MB that holds no class.

## Measured

| Measure | Value | How |
|---|---|---|
| Tracked files | 101.2 MB in 7,577 files: src 70.9 MB, supabase 11.3 MB, docs 9.7 MB, public 5.6 MB, e2e 1.6 MB, content 0.9 MB, scripts 0.5 MB | git ls-files piped to stat, summed by top-level folder |
| Git history (informational only) | 48.85 MiB in packs; the clone is shallow (101 commits), so this says nothing about the full history | git count-objects -vH; git rev-parse --is-shallow-repository |
| public/ | 150 files, 5.6 MB: 88 theme art WebP 4.77 MB, 12 WordPress zips 0.63 MB, 33 flags 175 KB (six of them 165 KB), 14 demo SVG, one favicon 26 KB. 0 files unreferenced | find and du; each file name searched with rg in src, scripts, content, supabase/migrations and seed.sql; theme art matched against src/lib/signature/*.ts |
| Route traces that carry the taxonomy | 831 of 832 (.nft.json files), 13.28 MB each | node script over .next/server/**/*.nft.json of the finished build (build-summary.txt exit=0), sizes by stat |
| Route traces that carry libvips (sharp) | 742 of 832, 19.8 MB each; Chromium (70.1 MB) is in 12; the docs' Markdown (0.9 MB) in 22 | same script |
| Median route trace | 52.8 MB; 19.7 MB without the taxonomy and sharp (63% less). Largest 140.1 MB (customer PDF route) | same script, sum of traced file sizes per route |
| Proxy (runs before every page request) | trace 48.1 MB: sharp and libvips 19.8, taxonomy 13.3, 44 JS chunks 13.2. Loading the built bundle in bare node: 0.99 to 1.13 s and +173 MB RSS, and sharp's native addon ends up loaded | nft breakdown of .next/server/middleware.js.nft.json; three runs of a read-only script that requires .next/server/middleware.js and lists .node files in require.cache (machine load average 4.7 on 4 CPUs, so the seconds are under contention) |
| Cost of loading sharp | 38 to 55 ms and +23 MB RSS | node -e require('sharp'), three runs, warm disk |
| Import reach | src/proxy.ts reaches 1,311 of 4,139 non-test source files; 774 of 828 page and route entries reach both sharp and product-taxonomy.ts | regex graph of static imports over src (type-only imports skipped), breadth-first walk from each entry and its layouts |
| Taxonomy at run time | 13.28 MB raw, 4.08 MB gzip. structure.json: 28 ms parse, 11.4 MB heap. Each language file: 9 to 14 ms, 4.7 to 6.5 MB heap. Read once per instance, only when asked | node --expose-gc script reading the five files; gzip -6 |
| Fonts in production | 163 font files, 5.7 MB, as bytea in Postgres; `select css from commerce.fonts where slug = $1` ran 42,211 times in 78 days | prod-db-stats.md; src/server/fonts.ts and the two font routes read |
| Image tags | 10 next/image tags, 9 marked unoptimized, 1 not; remotePatterns is empty | rg over src; .next/images-manifest.json |
| Tailwind's input | 61 MB read: src without data 57.3 MB (of which tests 18.5 MB in 1,771 files) plus 4.0 MB of baseline SQL. Built CSS 204 KB, 1,837 class names: 0 owed to the SQL, 12 owed only to tests | find and awk for sizes; token sets of the SQL, the tests and the code intersected with class names in .next/static/chunks/*.css |
| supabase/ | archive 789 files 6.5 MB, baseline 4 files 4.0 MB, one snapshot 2.7 MB (kept out of Vercel by .vercelignore) | du, ls, git ls-files |
| Instruction and decision files | docs/decisions.md 1,329,266 bytes in 930 lines (1.24 MB in 892 lines on 9 Nov per the code review); CLAUDE.md 43,361 bytes (39.5 KB on 9 Nov) | wc -c, wc -l; compared with docs/audits/code-review-2026-11.md rows FH4 and FH5 |
| Server build output | 5,174 chunks, 205 MB of JS and 704 MB of source maps; the maps are not traced into any function | find over .next/server/chunks; .map files counted in a page's nft (0) |

## Well made, and should stay

- public/: all 150 files are referenced from code, seed data or the docs. Nothing dead.
- Pictures: each upload is kept as two files made in the browser (1600 px and 480 px), stored once under a unique name with a one-year cache (src/server/media.ts:80). Nothing is resized on the server per request. sharp is used only by jobs and admin tools, never to draw a shopper's page.
- Chromium (70.1 MB) is traced into only the routes that launch it, is loaded by dynamic import (src/server/browser.ts:11-15), and a test holds the list (src/lib/chromium-trace.test.ts).
- The taxonomy's loader is lazy and well made: each file is read once per instance and only when a product has a standard category or a listing has attribute facets (src/server/product-taxonomy.ts:40-52). No request parses it twice. The four languages match the storefront's hand-written languages.
- Fonts: files are named by content hash and sent with a one-year immutable cache; the stylesheet is cached a year at the CDN; variable fonts are cut to the weights used; HarfBuzz's wasm is in one route only. 5.7 MB in Postgres is small. One thing to verify with a single HEAD request in production: the file route sends max-age only (src/app/api/fonts/files/[file]/route.ts:16) while the stylesheet route also sends s-maxage; I could not check from here whether Vercel's CDN keeps the file.
- Share pictures (og.png) are fallbacks only and are cached a day at the CDN (src/lib/share-card.tsx:30). Favicon routes only redirect to a stored 64 px icon.
- supabase/: snapshots were pruned to one (D532) and 789 migrations squashed to four files (D572) on 10 and 11 November. The archive is history that 17 test files read through src/db/migration-files.ts. It costs nothing at run time.
- scripts/ (38 files, 0.53 MB): every script is named in package.json, CI, a test or a doc. 0.4 MB of it is the theme art recipes. wordpress-plugin/, shopify/, e2e-live/ and test/ are small and in use.
- WordPress zips: 12 files, 0.63 MB, static. kaizen-store-wordpress.zip is a byte copy of 1.3.6 (cmp). They cost nothing per request; 11 versions in 30 days add about 60 KB each. Not worth a change now.
- Theme art: 88 WebP files (4.77 MB) are seeds copied once into each demo store's library, plus six page backgrounds. Static files; no function carries them.
- content/: 168 Markdown files, 0.9 MB, traced into 22 routes only.
- Other files in src/data (ledger chart, SAF-T sample, API contract baseline, eval recording) are small and each has a reader.
- Heavy browser assets (the 3.5 MB AVIF encoder, the 3D viewer and its decoders, the video encoder) are loaded by dynamic import only when used.
- Tailwind's scope rule (D378) works: tests add only 12 of 1,837 class names to the CSS.
- Binary files under docs: two (a 662 KB mock-up and a 194 KB reference picture). Nothing to do.

## Findings

### AS-1 ✓ The image library (sharp, 19.8 MB) rides in 742 of 832 functions and in the proxy, and is loaded at every cold start

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.2.
- **Where:** `src/server/theme-highlights.ts:3`, `src/server/theme-shots.ts:38`, `src/server/theme-store.ts:35`, `src/server/seo.ts:48`, `src/server/house-switch.ts:15`, `src/proxy.ts:11`, `src/app/s/[store]/[market]/page.tsx:17`, `src/app/s/[store]/[market]/layout.tsx:33`, `src/server/product-import.ts:6`, `src/server/browser.ts:11`, `.next/server/middleware.js.nft.json`
- **Evidence:** Twelve server modules import sharp at the top of the file (ai-vision, content-packs, page-looks, picture-editor, ai-picture-marks, theme-highlights, product-import, replicate-images, brand-marks, replicate, theme-shot-files, ai-pictures). The proxy reaches one of them through a constant: proxy.ts imports house-switch.ts, which imports STORES_TAG from seo.ts, which imports theme-store, theme-shots, theme-highlights, sharp. The storefront's page and layout import seo.ts directly. In the finished build, 742 of 832 traces list libvips, and the proxy's trace is 48.1 MB of which 19.8 MB is sharp and libvips. I loaded the built proxy bundle in bare node three times: sharp's native addon was in require.cache each time. No storefront request ever draws with sharp; only jobs and admin tools do.
- **Cost today:** 19.8 MB in each of 742 function packages (38% of the storefront home's 52.1 MB, 41% of the proxy's 48.1 MB). At each cold start: 38 to 55 ms and +23 MB of memory to load it (measured here with require('sharp'), three runs). Paid by: Every visitor whose request meets a cold instance (the proxy runs before every page, prerendered ones too), and the server in memory per instance.
- **Fix:** Step 1: add one helper (src/server/sharp.ts) that returns (await import("sharp")).default, as browser.ts already does for Chromium. The twelve modules import only sharp's types and call the helper inside the function that draws. Step 2: a scan test that fails on a static import of sharp outside the helper. Step 3, with the boundary work: cut the import chains so the package leaves the proxy's and the storefront's traces.
- **Saving:** Steps 1 and 2: 38 to 55 ms and 23 MB less per cold start on 742 routes and the proxy (measured on this machine; an estimate for Vercel). Step 3: 19.8 MB less per package (measured from the traces).
- **Risk:** Low. The first picture job on an instance pays the load instead. Step 3 is larger (M to L) and depends on untangling imports.
- **Already tracked:** no. Nearest: FD5 (step 3.14, Open) covers schema.ts in every cold start; FV4/FH6 (step 3.13, Open) and FH7/FH8 (step 4.1, Open) cover module boundaries. None names sharp.

### AS-2 ✓ The product taxonomy (13.3 MB of JSON) is packed into every function, the proxy and the health check included

- **Kind:** oversize. **Effort:** M. **Confidence:** medium. **Step:** 2.8.
- **Where:** `next.config.ts:69`, `src/server/product-taxonomy.ts:25`, `src/server/catalog.ts:548`, `src/server/listing.ts:575`, `src/server/redirect-resolve.ts:19`, `src/data/product-taxonomy/structure.json`
- **Evidence:** next.config.ts traces src/data/product-taxonomy/* into the key "/**". 831 of 832 traces list it. /api/health traces 16.4 MB, of which 13.3 MB is the taxonomy; the font file route 20.4 MB, of which 13.3 MB. The five files are 13.28 MB raw and 4.08 MB gzipped. The loader itself is lazy: nothing is read until a product has a standard category or a listing has attribute facets. Narrowing the glob alone would free only 54 routes, because 774 of 828 entries reach product-taxonomy.ts through static imports (the proxy through redirect-resolve.ts, which imports catalogTag from catalog.ts).
- **Cost today:** 13.3 MB (4.1 MB zipped) in each function package. When used: 28 ms and 11.4 MB of heap for the structure, 9 to 14 ms and 4.7 to 6.5 MB per language, once per instance. Paid by: The server: package size at each cold start, and memory on instances that show a categorised product. The effect of package size on cold-start time was not measured.
- **Fix:** Keep the lazy loader. When the imports are untangled (AS-1 step 3, AS-3), replace "/**" with the globs of the routes whose import closure reaches product-taxonomy.ts, and hold that with a scan test built like chromium-trace.test.ts. The alternative is three Postgres reference tables read by id, so no function carries the files; load them with a script, not a migration, or 100,000 rows would slow every test database.
- **Saving:** 13.3 MB per function that can never read it (measured per trace). Nothing at run time: it is already lazy.
- **Risk:** A route left out of the glob fails with a missing file when it reads the taxonomy, so the scan test must exist before the glob narrows.

### AS-3 Nothing checks what a server function carries

- **Kind:** no check. **Effort:** S. **Confidence:** high. **Step:** 1.2.
- **Where:** `src/lib/storefront-bundle.scan.test.ts:5`, `src/lib/chromium-trace.test.ts:8`, `next.config.ts:51`, `src/server/house-switch.ts:15`, `src/server/redirect-resolve.ts:19`, `.github/workflows/ci.yml:1`
- **Evidence:** The browser's scripts have an import walk and per-page budgets (storefront-bundle.scan.test.ts, e2e/performance.spec.ts, e2e/signed-in/admin-scripts.spec.ts). The server side has only the Chromium list. No test or CI step reads a .nft.json, and no test limits what src/proxy.ts may import. So the proxy grew to 1,311 source files and 48.1 MB, partly through two imports of a cache-tag constant. I simulated cutting those two imports: the proxy still reaches sharp and the taxonomy through pages.ts, so the tangle is general.
- **Cost today:** No direct cost. It is why 33 MB of the median function's 52.8 MB is two assets most routes never use, and nothing stops the next one. Paid by: Every visitor (cold starts) and the build, later.
- **Fix:** 1. A scan test with the same walk as the browser's: src/proxy.ts may not reach sharp, product-taxonomy, product-import or theme-*; and the number of source files it reaches (1,311 today) is a ratchet that may only fall. 2. A CI step after the e2e job's build: a short node script sums each .nft.json and fails over a budget for the proxy, the storefront home, checkout and the median route, and writes the numbers to the job summary.
- **Saving:** Prevents regrowth. It also gives AS-1 and AS-2 a number to drive down.
- **Risk:** Low. Budgets set at today's sizes fail nothing on day one.
- **Already tracked:** partly: step 4.1 'Lint rules for the boundaries' (FH7, FH8), Open. It does not mention function size or the proxy.

### AS-4 Search suggestions ask Next's image service for pictures it refuses

- **Kind:** dead. **Effort:** S. **Confidence:** medium. **Step:** 0.12.
- **Where:** `src/components/search-box.tsx:144`, `src/lib/picture-sizes.ts:6`, `src/server/media.ts:93`, `.next/images-manifest.json`, `node_modules/next/dist/server/image-optimizer.js:259`
- **Evidence:** Nine of the ten next/image tags carry `unoptimized`, as picture-sizes.ts says they must. The tag in the search box does not. Stored pictures have absolute Supabase Storage addresses (media.ts:93). next.config.ts has no `images` key, and the build's images manifest shows remotePatterns empty. Next's optimizer answers an address on a host it was not given with 400, '"url" parameter is not allowed' (image-optimizer.js:259-261). Demo products use local SVG files, which Next leaves alone, so the tests would not see it.
- **Cost today:** One failed request per suggested product with an uploaded picture, up to six each time the list is drawn, and an empty thumbnail. I read this from the code and the build; I did not see it in a browser. Paid by: A shopper's browser, and Vercel's image endpoint.
- **Fix:** Add `unoptimized` to the tag (or draw it with LineThumbnail). Add a scan test: every `<Image` in src carries `unoptimized`.
- **Saving:** Up to six failed requests per suggestion list, and working thumbnails.
- **Risk:** None.

### AS-5 Public files are checked again on every page view, and six flags and two textures are far bigger than their job

- **Kind:** oversize. **Effort:** S. **Confidence:** medium. **Step:** 0.12.
- **Where:** `next.config.ts:106`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md`, `src/components/language-links.tsx:71`, `src/lib/language-flags.ts:29`, `public/flags/es.svg`, `public/flags/hr.svg`, `src/lib/signature/botanica.ts:549`, `src/lib/signature/botanica.ts:565`, `src/lib/signature/atelier.ts:615`
- **Evidence:** Next's guide says files in public are sent with `Cache-Control: public, max-age=0`, and next.config.ts adds no cache rule for them. So each flag, each theme background and the favicon is asked for again on every page view. Flags: the median is 247 bytes, but es.svg is 88.9 KB (13.4 KB brotli), hr.svg 40.4 KB (13.5 KB), mt 14.2 KB, li 7.9 KB, pt 7.9 KB, cy 5.8 KB: six files are 165 of the 175 KB. They are drawn at 20 by 15 pixels; the comment beside the tag says 'a few hundred bytes'. Botanica's repeating 512 px paper tile is 114 KB and its sprig 65 KB; Atelier's paper is 67 KB.
- **Cost today:** One conditional request per public file per page view. Up to 13 KB per heavy flag, and 179 KB of decoration on a first visit to a Botanica store. Paid by: A shopper's browser.
- **Fix:** A headers rule in next.config.ts for /flags/:path*, /demo/:path* and /kaizen/:path* with `public, max-age=86400, stale-while-revalidate=604800`. Replace the six heavy flags with simplified drawings (under 1 KB each at this size). Encode the paper tiles again at a lower quality or at 256 px.
- **Saving:** Estimate: three to six round trips per page view in a store with several languages on a signature theme; 13 KB per Spanish or Croatian flag; about 100 KB on Botanica's first view.
- **Risk:** A file changed under the same name stays up to a day in browsers. Theme art already takes a new name when it changes.

### AS-6 The PDF routes carry all of react-dom (8.1 MB) to use one server renderer

- **Kind:** oversize. **Effort:** S. **Confidence:** medium. **Step:** 4.3.
- **Where:** `next.config.ts:23`, `src/server/document-html.tsx:5`
- **Evidence:** DOCUMENT_PDF_FILES traces react-dom/** whole. The trace of /api/cron/document-pdfs is 107.1 MB: Chromium 70.1, taxonomy 13.3, playwright-core 11.7, react-dom 8.07. The package's cjs folder holds development and profiling builds of 1.2 MB each and server builds for browsers, edge and bun; the node production server build is 0.30 MB. Four traces carry react-dom.
- **Cost today:** About 7.4 MB on each of four functions, the heaviest in the deployment (the largest is 140.1 MB). Paid by: The server (package size of the PDF functions).
- **Fix:** Name the files instead of the folder: package.json, index.js, server.js, server.node.js and the production node builds under cjs. Let document-readers.test.ts hold the list, and download one invoice PDF on a preview deployment before it reaches production.
- **Saving:** About 7.4 MB per PDF function (estimate from file sizes).
- **Risk:** A missed file breaks invoice PDFs in production only, so it needs the preview check. Low value; do it last.

### AS-7 Tailwind reads 22.5 MB that cannot hold a class: the migrations' SQL and the test files

- **Kind:** dead. **Effort:** S. **Confidence:** medium. **Step:** 2.4.
- **Where:** `src/app/globals.css:7`, `src/app/globals.css:9`, `docs/build-memory.md:25`, `supabase/migrations/20261111172840_baseline_2_data.sql`
- **Evidence:** globals.css points Tailwind at all of src except data, and at supabase/migrations/*.sql. I compared the 1,837 class names in the built CSS with the tokens in the SQL, the tests and the code: no class name exists only in the SQL, and 12 exist only in tests (w3, order-1038, col-1 and the like). The SQL is 4.0 MB in four baseline files; tests are 18.5 MB of the 57.3 MB under src without data.
- **Cost today:** 22.5 MB of the 61 MB the PostCSS worker reads on each build and each dev start, and 12 stray selectors. The time and memory this costs were not measured. Paid by: The build, which peaked at 7.6 GB of Vercel's 8 GB in today's run, and developers.
- **Fix:** Delete line 9 of globals.css. Add `@source not` lines for ../**/*.test.ts, ../**/*.test.tsx and the fixtures folders. This follows the rule in CLAUDE.md (point @source at code, never at data).
- **Saving:** Estimate: about a third less for Tailwind to scan. Small.
- **Risk:** A class used only inside SQL would be lost; the comparison found none.
- **Already tracked:** partly: step 1.8 (FH10, build memory), Open; the rule is D378 in docs/build-memory.md.

### AS-8 The decisions log is one 1.33 MB file and grew 7% in two days

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 4.4.
- **Where:** `docs/decisions.md:1`, `CLAUDE.md:1`, `docs/audits/code-review-2026-11.md:254`, `docs/audits/code-review-2026-11.md:291`
- **Evidence:** docs/decisions.md is 1,329,266 bytes in 930 lines, the longest line 17,985 characters. The code review measured 1.24 MB in 892 lines on 9 November. 43 commits have touched it since. CLAUDE.md is 43,361 bytes, up from 39.5 KB on 9 November, and is loaded into every agent session.
- **Cost today:** Estimate at four characters a token: about 11,000 tokens per session for CLAUDE.md, and about 330,000 for the decisions log, which no session can open whole. Paid by: An agent's session.
- **Fix:** As step 1.10 says: one file per hundred decisions with a generated index, migration versions in their own file, and CLAUDE.md's index moved to the area files. Add a size ratchet for both files so neither grows again.
- **Saving:** About 10,000 tokens per session (the code review's estimate).
- **Risk:** Low.
- **Already tracked:** FH4 and FH5, step 1.10 'Make the written rules cheap to read', Open.
