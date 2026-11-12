# CA-6 ✓ A prefetch loop on listing and search pages at /s/{store} addresses

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 0.14.
- **Second check:** confirmed.
- **Where:** `src/app/s/[store]/[market]/@drawer/[...rest]/page.tsx:2`, `src/app/s/[store]/[market]/@drawer/default.tsx:2`, `src/components/product-card.tsx:74`, `.next/server/app/s/demo/no/p/demo-bordlampe.segments`, `evidence/prefetch-storm.md`, `a scratch script`, `a scratch script`, `a scratch script`
- **Evidence:** Reproduced again in this pass on the local production build, and narrowed. /s/demo/no/category/belysning: 1,586 RSC requests in 4 s after load, 1,517 of them for one link (/s/demo/no/p/demo-bordlampe), each asking for the segment /s/$d$store/$d$market/@drawer/(__SLOT__)/$c$rest/__PAGE__ (the slot name is base64 in the header). The search page: 1,089 in 3 s, 1,067 for /s/demo/no/search. Each answer is right: 200, the 1,435-byte segment file that the build wrote (it exists under .next/server/app/s/demo/no/p/demo-bordlampe.segments), Cache-Control s-maxage=3600, x-nextjs-cache HIT. The page itself is quiet meanwhile: 0 history.pushState or replaceState calls, 0 DOM mutations and 0 new IntersectionObserver observations in the 4 s (loop.mjs). So the loop is inside the client router's prefetch scheduling, not a re-render, a navigation or a wrong answer. /s/demo/no/products and a tag page do not loop (48 and 64 requests in all). The measuring pass saw production on stores' own hosts not loop; production was not checked in this review.
- **Cost today:** On /s/{store} addresses: about 350 requests a second for as long as a listing or search page is open, each through the proxy. CI's end-to-end jobs run on these addresses. Whether a store reached at an /s/ address in production loops is not known. Paid by: CI on every run; the server and a shopper's browser wherever a store is reached at an /s/ address.
- **Saving:** Measured locally: about 10,300 of 10,358 requests on the category page of the measuring pass; about 350 requests a second while such a page is open.
- **Risk:** The cause is not known yet, so the effort may be more. A fix that moves or drops the slot can break the phone's cart drawer; the cart specs notice. Until fixed it inflates every local or CI measurement of listing and search pages.
- **Already tracked:** no. docs/audits/code-review-2026-11.md mentions a test that timed out under load, without this cause.

## The fix

1. Hold it first. e2e/performance.spec.ts: a test that loads /s/demo/no/category/belysning and /s/demo/no/search?q=lampe at phone size, waits 3 s after load and expects fewer than 100 requests. Mark it test.fail() until fixed, so CI records the state and turns red when it changes.
2. Narrow it with three one-line experiments on a local build, counting with the same test: (a) prefetch={false} on the product card's Link (src/components/product-card.tsx:74): does the loop stop, or move to another link? (b) remove src/app/s/[store]/[market]/@drawer/[...rest]/page.tsx (default.tsx stays): does it stop? (c) run the same build with a store host, as CI's hosts job does: do short addresses loop?
3. If (b) stops it, the slot's catch-all is the cause. Take the slot off the root layout as SC-8 (storefront-client dimension) plans, or close the drawer from CartDrawer when the pathname changes and drop the catch-all; run the test again.
4. If it is Next's own fault, build the smallest case (a listing with one Link, a parallel slot with a catch-all page, a Suspense that reads searchParams), report it upstream, keep the workaround, and write the cause into docs/performance.md.
5. Remove test.fail() when the count is under 100.

**Done when:** The new e2e test passes without test.fail(): under 100 requests in the 3 s after load on the category page and on the search page (about 1,200 to 1,500 today).

**Tests and rules that hold today's behaviour, and change with it:**

- The new test in e2e/performance.spec.ts is the hold.
- e2e/cart.spec.ts and e2e/navigation.spec.ts: the phone's cart drawer must still open over the page and close on any other page (rule: docs/rules/storefront.md:600-603, the @drawer slot and [...rest]).
- e2e/listing.spec.ts and the search specs run under this flood today; expect them to get faster, not to change.
- docs/audits/code-review-2026-11.md mentions a test that timed out under load, without this cause: add a line when the cause is known.

**Notes:** Same matter as SC-9 (storefront-client dimension), which ranks it P2 as an open question. Ranked P1 here because CI pays on every run, the scope in production is unknown, and this pass narrowed it: the answer is correct and cacheable and the page is idle, so it is the router's scheduling around the @drawer catch-all segment. A fault more than bloat, but the waste is real where it happens. Do the two plans as one.
