# AS-2 ✓ The product taxonomy (13.3 MB of JSON) is traced into every route, the proxy and the health check included

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P3. **Effort:** M. **Confidence:** medium. **Step:** 2.23.
- **Second check:** corrected.
- **Where:** `next.config.ts:69`, `src/server/product-taxonomy.ts:25`, `src/server/catalog.ts:548`, `src/server/listing.ts:575`, `src/server/redirect-resolve.ts:19`, `src/lib/chromium-trace.test.ts:8`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md:93`
- **Evidence:** next.config.ts:69 traces src/data/product-taxonomy/* into the key "/**"; its comment gives the reason (the editor, imports, listings, feeds and the AI manager's tools all read it). Re-run: 831 of 832 traces list it, 13.28 MB each; /api/health's trace is 16.2 MB, of which 13.3 MB is the taxonomy. The loader is lazy (product-taxonomy.ts:40-52). By static imports 740 of 828 entries reach the loader (graph re-run), the proxy among them through redirect-resolve.ts:19 -> catalog.ts, so narrowing the key today frees 88 entries, and they are the smallest traces.
- **Cost today:** 13.3 MB (4.1 MB zipped) in every trace. Its effect on cold-start time was not measured: Vercel packs routes into shared functions and zips them. When read: 21 ms and 11.3 MB of heap for the structure, 8 to 10 ms and 4.7 to 6.5 MB per language, once per instance (second check). Paid by: The server: the size of every function. No store pays at run time for a taxonomy it does not use.
- **Saving:** 13.3 MB per trace that can never read it: about 90 today, more once the cycle is cut. Nothing at run time: it is already lazy.
- **Risk:** A route left out of the globs fails in production with a missing file the first time it reads the taxonomy, so the scan test must exist before the key narrows.

## The fix

1. Now: nothing. Keep the lazy loader and the files, and let AS-3's report show the count (831).
2. When the import cycle is cut (server-graph SG-1) and the entries that cannot reach src/server/product-taxonomy.ts are many more than today's 88: first add a scan test built like src/lib/chromium-trace.test.ts on the shared import walker of AS-3: every page.tsx and route.ts whose static or dynamic imports reach product-taxonomy.ts must match a key in next.config.ts that lists src/data/product-taxonomy/*.
3. Then replace "/**" at next.config.ts:69 with globs for the route families that still reach the loader (the admin's store routes, the storefront's product and listing pages, feeds, the Admin API, the crons that run imports and feeds), and keep the comment's reason.
4. Read the new count from scripts/trace-sizes.mjs and lower its budget.

**Done when:** scripts/trace-sizes.mjs reports the taxonomy in fewer than 831 traces, and the scan test passes: every entry that can reach product-taxonomy.ts is covered by a key.

**Tests and rules that hold today's behaviour, and change with it:**

- The comment at next.config.ts:67-68 is the written reason; the scan test keeps it true route by route.
- src/lib/chromium-trace.test.ts is the pattern.
- Tests of the loader (src/server/product-taxonomy*.test.ts, src/lib/product-taxonomy.test.ts) are not touched.

**Comes after:** AS-3; server-graph SG-1 (the import cycle)

**Notes:** P3 because its cost on anything a person feels is unmeasured, the saving today is in the 90 smallest traces, and it depends on the boundary work. Not worth doing: compressing the files on disk (9.2 MB less per trace, but a gunzip per read and no change to the zipped upload), or moving them into Postgres (the read is already once per instance). The run-time side (a shopper's product page with a standard category parses three files, about 40 ms and 22.6 MB once per instance) is functions SF-8; if that is planned, save the category's path and Google id with the product when the owner saves it, so a shopper's function never opens the files. Same as server-graph SG-13.
