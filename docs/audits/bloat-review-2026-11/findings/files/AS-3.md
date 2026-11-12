# AS-3 ✓ Nothing checks what a server function carries or what the proxy imports

Files that ship or are stored (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 1.8.
- **Second check:** confirmed.
- **Where:** `src/lib/storefront-bundle.scan.test.ts:5`, `src/lib/chromium-trace.test.ts:8`, `src/server/ratchet.scan.test.ts:1`, `scripts/ratchet.mjs:1`, `next.config.ts:51`, `src/proxy.ts:11`, `src/server/content-packs.ts:112`, `.github/workflows/ci.yml:152`, `a scratch script`, `a scratch script`, `a scratch script`
- **Evidence:** The browser's scripts have an import walk and byte budgets. The server side has only the Chromium list: no test, script or CI step reads a .nft.json, and nothing limits what src/proxy.ts may import (second check; I re-ran its graph: the proxy reaches 1,309 of 4,126 source files, and still 1,309 with the two cache-tag imports cut). The review's own scripts sum all 832 traces by route and by package in 1.7 s. That report is how I found, in this pass, that four routes carry every file of public/ (5.6 MB) because content-packs.ts:112 reads a file under public by a computed path: harmless, and invisible without the report.
- **Cost today:** No direct cost. It is why 33 MB of the median trace's 52.6 MB is two assets most routes never use, why the proxy loads 13 MB of code before every page, and why nothing stops the next one. Paid by: Every visitor (cold starts of the proxy and of pages) and the build, later.
- **Saving:** None by itself. It holds every later gain and gives AS-1, AS-2 and the server-graph work a number that can only fall.
- **Risk:** Low. The ratchets start at today's numbers, so nothing fails on day one. Trace sizes move a little with dependency updates, hence the 4% room.
- **Already tracked:** Partly: code review step 4.1 'Lint rules for the boundaries' (FH7, FH8), Open; step 3.13 'Domain folders', Open. Neither measures a function or the proxy.

## The fix

1. New script scripts/trace-sizes.mjs (plain node, no dependency), from a scratch script and pkgs.mjs: walk .next/server for *.nft.json, resolve each listed file, sum by route and by package. Print the median trace, the proxy's (middleware.js.nft.json), the storefront home's, the storefront checkout's and /api/health's, the number of traces that carry sharp, the taxonomy, Chromium, react-dom, public/ and any .map, and the 15 heaviest packages by bytes times traces.
2. scripts/trace-budgets.json with today's numbers plus 4% (the room the admin's script budgets use): median 52.6 MB, proxy 47.9 MB, storefront home 51.9 MB, storefront checkout 52.4 MB, /api/health 16.2 MB; and counts that may only fall: sharp 742, taxonomy 831, Chromium's package 12, react-dom 4, public/ 4, maps 0. With --check the script exits 1 when a size is over its budget or a count is over its number.
3. .github/workflows/ci.yml, job e2e, after 'pnpm build' (line 152): node scripts/trace-sizes.mjs --check >> "$GITHUB_STEP_SUMMARY".
4. The proxy's reach as a ratchet: move the import walk of src/lib/storefront-bundle.scan.test.ts into scripts/lib/import-walk.mjs (one walker for both; tests-ci TC-10 asks for that), and in scripts/lib/ratchet-count.mjs add proxyReach (files src/proxy.ts reaches by static value imports, 1,309 today) and proxyBanned (which modules of a ban list it reaches today: the sharp importers, src/server/product-taxonomy.ts, product-import.ts, theme-store.ts, theme-shots.ts). src/server/ratchet.scan.test.ts fails when the number rises or a banned module not in the baseline appears; node scripts/ratchet.mjs lowers the baseline.
5. docs/performance.md: a section 'What a server function carries' with the numbers and the two checks; docs/ci-migrations.md: the new CI step; the code review's Progress table: a note under step 4.1.

**Done when:** CI's e2e job summary shows the trace table for a push, and adding import "@/server/product-import" to src/proxy.ts locally makes pnpm test fail in ratchet.scan.test.ts.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ratchet.scan.test.ts and src/server/ratchet.baseline.json: two new keys; scripts/ratchet.mjs refuses to raise a number, as for the others.
- src/lib/storefront-bundle.scan.test.ts: its walk moves to a shared file; what it tests does not change.
- src/lib/chromium-trace.test.ts stays as it is.
- A unit test for the script's summing on a small fixture folder (scripts/lib/*.test or src/lib/trace-sizes.test.ts).
- CLAUDE.md, Conventions (the ratchet paragraph): name the two new counts.

**Notes:** The same gap as deps DP-6, server-graph SG-14, functions SF-7 and storefront-data SD-13 of this review: build it once. Before opening is the cheap time for the boundary work it guards, because every new feature adds to the tangle.
