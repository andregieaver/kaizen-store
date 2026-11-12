# SC-9 ✓ Open question, not yet a planned saving: on the local build, listing and search pages asked for one prefetch about 160 times a second

What a shopper's browser loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** low. **Step:** 0.14.
- **Second check:** corrected.
- **Where:** `evidence/prefetch-storm.md`, `evidence/routes.json`, `docs/audits/bloat-review-2026-11/scripts/sources/storm.mjs.txt`, `src/app/s/[store]/[market]/@drawer/[...rest]/page.tsx:1`, `src/components/product-card.tsx:74`
- **Evidence:** Re-tallied in this pass from m/routes.json: the category page made 10,358 requests in the measuring window, 5,144 RSC answers for one address (/s/demo/no/p/demo-bordlampe), 5,142 of them 1,435 bytes; the search page 10,950, of which 5,449 for /s/demo/no/search, 5,448 of them 1,435 bytes. The review's note (m/prefetch-storm.md) records the request's header: a segment prefetch of the @drawer slot's catch-all page of the target route. Almost all were served from the browser's cache. The other ten storefront pages made 38 to 107 requests. The note says production, where stores are on their own hosts, made 55 to 58 requests in 5 s and did not loop. The cause is not known, and nobody has reproduced it a second time; this pass could not run a server.
- **Cost today:** On a local build or in CI's e2e jobs, which use the same /s/ addresses: a busy loop in the browser for as long as a listing or search page is open. No bytes to speak of. Production was not seen to do it, so no shopper is known to pay. Paid by: CI and developers' machines; a shopper only if it also happens on a store's own host, which one 5-second check did not show
- **Saving:** Unknown until reproduced. If real in CI: steadier listing and search specs. Count no saving for it.
- **Risk:** Low: the first three steps only measure.
- **Already tracked:** No; written up during this review in scratchpad/m/prefetch-storm.md.

## The fix

1. Reproduce before anything else: on a production build with CI's seed run node work/storm.mjs 'http://localhost:3000/s/demo/no/search?q=lampe' 30 phone, and the same for /s/demo/no/category/belysning; then load a production store's listing and search page for 30 s each and count requests.
2. If it repeats on neither: close this. SC-6 step 5 (no address asked for more than 20 times) stays as the guard.
3. If it repeats locally only: run step 1 again after SC-8's move, which takes the slot off the root layout; the request that loops is the slot's catch-all segment of the target route.
4. If it still repeats: build the smallest case (a listing page, one Link, the slot) and read how the client router keeps a segment prefetch for a route with a catch-all slot (node_modules/next/dist/client/components/segment-cache). Meanwhile the listing card's link (product-card.tsx:74) can take prefetch={false} as a stopgap. Write the cause into docs/performance.md.

**Done when:** work/storm.mjs run for 30 s on the category and the search page of a production build reports under 200 requests each (10,358 and 10,950 in this review's recording), or the cause is written into docs/performance.md.

**Tests and rules that hold today's behaviour, and change with it:**

- No spec waits for network idle on a listing or search page without swallowing the timeout (the skeptic's check), so CI neither confirms nor rules it out today
- SC-6 step 5 adds the rule that would
- Rule docs/rules/storefront.md:596-603: [...rest] closes the drawer on any other page; a fix must keep that

**Notes:** A possible defect, not bloat a shopper is known to pay. The cheapest way to an answer is SC-6 step 5 running in CI.
