# SF-8 ✓ 13 MB of taxonomy JSON rides in every function, and a shopper's product page parses it to show one category

Server functions: size, cold start, per-request overhead (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 2.12.
- **Second check:** corrected.
- **Where:** `next.config.ts:67-69`, `src/server/product-taxonomy.ts:24-44`, `src/server/catalog.ts:371-375`, `src/server/catalog.ts:546-557`, `src/server/listing.ts:253`, `src/server/listing.ts:575`, `docs/rules/storefront.md:190-193`, `node_modules/next/dist/build/collect-build-traces.js:472-521`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md:93-126`
- **Evidence:** Re-measured: the "/**" include puts 6 files, 12.67 MB, into 830 of 830 traces and into the proxy's (4.08 MB gzipped, verified report). It is 82% of the trace of a light entry (/api/health: 216 files and 15.5 MB, of which 12.7). Eight server modules import the reader. Counting the layouts above a page and lazy imports, 87 entries (86 handlers and 1 page) cannot reach the reader by any import today. Next applies a route's excludes after its includes, on the combined set of files (collect-build-traces.js:472-521, read in this pass), so an exclude for a route wins over the "/**" include. At run time the files load on first use and stay for the instance's life: structure.json 16 to 22 ms and 7 to 10.8 MB of heap, each language about 9 ms and 4.5 to 6.2 MB (verified report; not re-run). catalog.ts:548 reads the structure and two languages to give a product page one category path, a Google id and a few attribute names; it does so inside the cached getProduct (line 372), so on a cache fill, and only for a product that has a standard category.
- **Cost today:** 12.7 MB (4.1 MB gzipped) in every function package, and about 35 to 45 ms and 16 to 22 MB of heap once per storefront instance that fills the cache for a categorised product. Not per request. Paid by: The server's memory per storefront instance; the build and deploy (package size); a cold start that must fetch a larger package. The heap cost grows with stores: more categorised products mean more instances that end up holding the files.
- **Saving:** Steps 1 to 4: 12.7 MB off 87 traces now, more as SF-1 and SF-2 split modules; what that saves on Vercel depends on how it groups those light handlers into functions, which was not visible. Step 5: 12.7 MB off every storefront function's package and 16 to 22 MB of heap per storefront instance. Estimates, except the file sizes and parse costs.
- **Risk:** A route that can read the files but lost them fails at run time with a missing file, hence the derived list and its test; the reader forgets a failed read and tries again, so the failure would repeat and show in the logs. Step 5 makes stored names go stale when the release changes.
- **Already tracked:** no. docs/build-memory.md mentions the 13 MB only for Tailwind's scan (fixed).

## The fix

1. scripts/route-load.mjs (SF-7) gains --taxonomy-free: it lists the routes, as Next names them (/api/health), whose entry and the layouts above it cannot reach src/server/product-taxonomy.ts by static or lazy import, and writes them to src/data/taxonomy-free-routes.json (87 today).
2. next.config.ts: add outputFileTracingExcludes built from that file, each listed route (its brackets escaped as output.md shows, \\[ and \\]) mapped to ["./src/data/product-taxonomy/*"]. Keep the "/**" include; extend its comment at lines 67-69: the listed routes cannot reach the reader, and a test holds the list.
3. src/server/route-load.graph.test.ts: the committed list equals what the walk computes now, so a route that gains a path to the reader fails the test until the list is written again (and so gets the files back).
4. Build and check two traces: .next/server/app/api/health/route.js.nft.json lists no taxonomy file, and a product page's still lists six. After SF-2 the proxy cannot reach the reader either: add its entry to the list (the build names it middleware; confirm the key by building once). Every module split of SF-1 step 7 lengthens the list; a lazy import does not.
5. Later, when the product editor or the feeds are next changed, not now: store what the shop shows (the category's path per language, the Google id, the chosen attributes' English names) on the product when it is saved, so catalog.ts and listing.ts never open the files, and narrow the include to the product editor, imports and the AI tools. scripts/product-taxonomy.mjs must then re-derive the stored names when the release changes. Before opening there are few products to backfill.

**Done when:** After pnpm build, .next/server/app/api/health/route.js.nft.json lists no file under src/data/product-taxonomy (6 today), and src/server/route-load.graph.test.ts fails when a listed route is given an import of src/server/product-taxonomy.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- docs/rules/storefront.md:190-193 (D327) says the files are 'traced into every route': reword to every route that can reach the reader. Step 5 would change the rule's 'read on the server only by product-taxonomy.ts'.
- src/server/product-taxonomy.int.test.ts, src/lib/product-taxonomy.test.ts, src/server/product-tools.int.test.ts, e2e/signed-in/standard-taxonomy.spec.ts (the editor's category picker and a product page with a category).
- next.config.ts:67-69 (the comment that accepts every route carrying the files).

**Comes after:** SF-7 steps 1 and 2 (the walk that derives and holds the list)

**Notes:** The skeptic cut the count of entries that can drop the files from 195 to 88; this pass counts 87. The '10.5 GB summed' figure is a sum over traces, not something stored, and is not used.
