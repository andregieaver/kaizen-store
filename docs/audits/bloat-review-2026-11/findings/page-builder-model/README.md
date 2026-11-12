# The page builder's model and a built page's render (PM)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** The page model itself is lean: a stored page is about 340 bytes a block and a two-block page's own markup is 1.6 KB. The waste is in how pages are read, cached and wrapped: every storefront document carries the layout twice (27 KB), 45 of the demo store's 261 built entries keep a copy of every page of the store to find one page or one title, and all 261 carry one cache tag, so publishing one page makes the whole store's site render again. The owner filter `is not distinct from` cannot use an index (60,000 rows read to return 27 on a test table) and a five-minute job re-reads every published page of every site with chat on. None of this rests on a feature being unused: each cost grows with stores, pages or products, and each is cheapest to change before opening.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [PM-2](PM-2.md) ✓ | Finding one page, or a title, loads every published page of the store with its whole content | oversize | P0 | M | 0.19 |
| [PM-3](PM-3.md) ✓ | The five-minute knowledge job reads and parses every published page of every site with chat on, and re-cuts wordless pages for ever | eager | P0 | S | 0.21 |
| [PM-4](PM-4.md) ✓ | Page reads filter the owner with `is not distinct from`, which no index can serve | oversize | P0 | S | 0.18 |
| [PM-11](PM-11.md) ✓ | A product page's first scripts carry the cart's parts through one import, and every built page a few parts it does not hold | eager | P0 | S | 0.13 |
| [PM-14](PM-14.md) ✓ | No budget sees a realistic built page, the document's size or a list that reads whole pages | no check | P0 | S | 1.2 |
| [PM-1](PM-1.md) ✓ | Every storefront page renders and ships the whole layout twice, because the cart drawer's slot sits on the root layout | duplicate | P1 | M | 2.1 |
| [PM-5](PM-5.md) ✓ | The admin's page lists, pickers and AI tools read and parse the draft and the published copy of every page to show titles | oversize | P1 | S | 2.19 |
| [PM-6](PM-6.md) ✓ | Facts about a page are dug out of its JSON on each read; the table has no column for them | eager | P1 | M | 2.19 |
| [PM-8](PM-8.md) ✓ | A product grid with Filter and sort is sent twice when nothing is chosen | duplicate | P1 | M | 2.7 |
| [PM-10](PM-10.md) ✓ | The page editor's document carries 277 KB of interface text inline | oversize | P1 | S | 2.14 |
| [PM-15](PM-15.md) | One cache tag covers all of a store's pages: publishing one page, or describing one picture, makes every built page of the store render again | eager | P1 | M | 2.9 |
| [PM-9](PM-9.md) ✓ | Every read of a stored page runs the editor's whole input schema and the old-shape upgrades | eager | P2 | M | 3.10 |
| [PM-12](PM-12.md) ✓ | The page renderer and the page reader pull in the code for saving pages and most of the server | eager | P2 | L | 2.11 |
| [PM-16](PM-16.md) | A product's layout is cached once per product, whole | duplicate | P2 | S | 2.9 |
| [PM-7](PM-7.md) ✓ | Each row repeats the same stylesheet text in the payload and the same cached store lookups | duplicate | P3 | S | 2.1 |
| [PM-13](PM-13.md) ✓ | Some block types overlap; whether to merge them is a product choice, not waste *(your choice)* | duplicate | P3 | M | your choice |

## Measured

| Measure | Value | How |
|---|---|---|
| Block types and sub-parts | 37 block types; 83 sub-parts (20 product, 14 site, 42 shop, 7 theme store) | The skeptic's re-run of the bundled page model (work/pm/model.mjs, parts.mjs); the code review of November counted 34 types |
| Settings in the model | 197 distinct top-level keys; 842 summed over the 37 types; 303 optional fields and 35 with a default | work/pm/model.mjs; rg -c for .optional() and .default( in src/lib/page-content.ts (verified report) |
| A realistic stored page | Orbit theme home: 6 rows, 31 blocks, 10,549 B of JSON (340 B a block); ids 20%; per-size values 101 B. Production: pages 9.1 MB for 1,389 rows, page_versions 5.4 MB for 642 (a page keeps up to 50 versions) | Verified report's bundle and walk; m/prod-db-stats.md; VERSIONS_KEPT in src/lib/page-versions.ts:6 read in this pass |
| Cost of reading one stored page | 0.80 to 0.93 ms of zod for three theme home pages of 10.5 to 13 KB; 0.2 ms for Orbit's 1.5 KB product layout; 73 parsePageContent call sites in 29 files | Verified report's timing bundle; the product layout timed in this pass (work/pmplan/layouts2.mjs, 200 runs after warm-up) |
| A two-block page as a visitor gets it (/s/demo/no/om-oss) | 110,415 B document; the page's own markup 1,583 B; payload 69,548 B | m/html/store-page.html decoded (work/pmsk/dec.mjs), re-run in this pass |
| Second copy of the layout in the payload | 27,070 B on every captured storefront document: 38.9% of /om-oss, 31.6% of the home page; 0.3 to 1.3 KB once compressed; none on Kaizena Flow's own front page | work/pmsk/nf2.mjs re-run in this pass on store-page.html, store-home.html and site-home.html |
| What moves to fix it | 22 route folders and page.tsx; 26 files import from the folder through the alias (44 lines); 17 test files name the folder | ls of src/app/s/[store]/[market]; rg -l and rg -c in this pass |
| listPublishedPages in production | 79,778 calls, 29 rows a call, 2.33 M rows, 781 s: cache misses from deploys, crawlers and tests, not shoppers | m/prod-db-stats.md (pg_stat_statements, 78 days) |
| Built entries that keep the whole page list | 45 of the demo store's 261 prerendered entries (30 product pages, 9 blog, 3 products, 3 home), 117,432 B, 4.6% of all their resume data | work/pmplan/rdcall.mjs in this pass: the resume data cache at the end of `postponed` in every .meta under .next/server/app/s/demo, inflated and searched for the list's entry |
| Built entries that carry the store's one pages tag | 261 of 261 (45 carry the catalogue's tag); 17 cacheTag places in 13 files read under it; 55 places in 31 files refresh it | x-next-cache-tags of every .meta under .next/server/app/s/demo, counted with a node one-liner in this pass; rg -c |
| Owner filter and the index | `store_id is not distinct from $1`: Seq Scan, 59,973 rows removed to return 27. `store_id = $1`: index scan, 27 rows. 122 uses in 40 files of src/server | The skeptic's EXPLAIN ANALYZE on PGlite 0.5.13 (PostgreSQL 18.6), work/pmsk/pg.mjs; rg -c re-run in this pass |
| Knowledge job | 542 ms of each five-minute run; 91,200 delete calls that removed 782 rows in all (about 1,170 a day); about 24,100 calls of the page statement at about 40 whole pages a call | m/prod-db-stats.md |
| Products grid sent twice | 16,702 B streamed copy (18 product links, 9 pictures) in 55,163 B of markup on /s/demo/no/products; no such block on the home page | work/pmsk/grid.mjs re-run in this pass on store-products.html and store-home.html |
| Page editor's inline interface text | 276,922 B in one payload row, 76% of the editor's payload and 85.5 KB of its 135.7 KB gzip; at least 74,898 B (27%) is in branches no client file that asks for the area names | work/pmsk/admin.mjs re-run; work/pmplan/areas.mjs in this pass (the editor's client files, dynamic imports followed, 1,629 files; a lower bound) |
| Client scripts on every store page whatever its blocks | layout group: 7 chunks, 213,284 B raw, 72,978 B gzip; product page: 12 chunks, 315,368 B raw, 107,369 B gzip, one of them (28,584 B) the cart's | work/pmsk/crm.mjs re-run in this pass on the built manifests of p/[handle] and cart |
| Server code behind the page renderer | 1,396 modules and 21.1 MB of source reachable from page-article.tsx; built store home 12,230,360 B, of which the page model 61 KB, six signature themes 128 KB, the builder's block words 111 KB | work/pm/graph.mjs (verified report); m/analyze/s_store_market.json read in this pass |
| Writers of page documents | 9 insert statements in 4 server files, at least 18 update statements in 10 files, 4 SQL functions in the baseline, the seed; the pre-D179 grid shape is still written by 6 source files and the seed | rg for 'insert into commerce.pages' and 'update commerce.pages' over src and supabase; rg for the {mobile, tablet, desktop} shape, in this pass |
| Signature themes' product layouts | 1,362 to 1,504 B as written, 13 blocks in 2 rows, in each of the six themes; Orbit's 1,485 B as stored | esbuild bundle of src/lib/signature in the scratch folder (work/pmplan/layouts.mjs, layouts2.mjs) |

## Well made, and should stay

- Stored page JSON is sparse: 303 optional settings stay absent, per-size values exist only where set (101 B in the 10.5 KB Orbit home), pictures are addresses never data, and the limits hold (100 blocks, 50 rows, 50,000 characters of HTML). 35 fields have a default (mostly an empty string, null or an empty list) and those are written out; ids are 20% of a page.
- No stored setting was found without a reader, but the scan behind this is a token match on key names and cannot prove it for every block.
- A block's markup is lean: the two-block page's main is 1,583 B, the whole storefront document has one inline style attribute, and per-size differences are CSS classes, not duplicated markup.
- Picture enrichment is batched and never saved: withPageAlts() reads alt texts and small copies for all pictures of the pages it is given in one query, and asks nothing for a page without pictures (src/server/media-alts.ts:26-55).
- Page versions cost only when used: the same content is not stored again (md5 compare), a page keeps its newest 50, and the list reads titles only (src/server/page-versions.ts:22-45, src/lib/page-versions.ts:6). 50 whole copies is a product choice about how far back to go; it is paid per page that is edited that often.
- Saving a page is one person's press: the builder has no autosave (no timer or debounce in src/components/admin/page-builder.tsx), and a draft save does not refresh the site's cache (pages/actions.ts:107).
- Interactive block parts load only where drawn: 19 lazyView stand-ins in src/components/lazy/blocks.tsx; the page model is kept out of visitor scripts by a scan test (docs/performance.md).
- Who sees a part costs nothing unless conditional, and then little: Always and Never are decided without a hole; a condition reads only the kinds of fact it asks about, each once per request (src/components/visible-part.tsx:16-27, src/server/visibility.ts:45-76).
- A header or footer built in the builder is read as one row by its id (src/server/site-layouts.ts:28-45), and findPublishedPage() reads one row; a page at its own address keeps only itself in its resume state (1,155 B on /om-oss).
- Content grids are capped at 48 items and cached by tag (src/server/content-grid.ts:278). A grid of pages or articles still reads each item's whole document for a card; PM-2's light read and PM-6's columns cover it.
- The chat agent is off unless a store turns it on (chat_agents.enabled defaults to false), so the knowledge job does nothing for a store without chat; its waste is in what it repeats for those with it (PM-3).
- The admin's English catalogue is no longer bundled as a fallback (D540, docs/performance.md:183), so the editor's inline texts (PM-10) are not a second copy of something in the scripts.
- The page studio's prompt and patterns are small per call and run only when someone asks (judged clean by the AI dimension; nothing in this dimension contradicts it).
