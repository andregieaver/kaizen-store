# CA-7 ✓ partialPrefetching is unset: Next treats it as off, warns on every build and start, and will remove the choice

Caching and rendering (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.11.
- **Second check:** corrected.
- **Where:** `next.config.ts:42`, `evidence/build.log:5`, `src/app/s/[store]/[market]/layout.tsx:105`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:45`, `node_modules/next/dist/docs/01-app/02-guides/incremental-static-regeneration-cache-components.md:27`, `node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:312`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/prefetch.md`
- **Evidence:** Read in this pass. Next's doc: unset behaves like false and logs a warning; both features will be on everywhere in the next major and the option removed. The build log prints the warning (lines 5-11). For this app, off means three things. 1) Each link on screen is prefetched by itself: 11 to 50 requests per store page and 23 to 46 per admin screen. 2) A first visit to a page not built ahead waits for the whole render: 137 dynamic patterns have no fallback, 115 of them store routes; the ISR guide says that with Partial Prefetching such a visit gets the shell at once. 3) A forced move later. No link sets prefetch={true} (rg: 0), so there is no legacy full prefetch to migrate. But the store's root layout awaits params above any Suspense (layout.tsx:105), because <html lang> and the theme come from them, and the guide says a params read outside Suspense ties the shared shell to one URL. Adoption can go segment by segment with export const prefetch = 'partial' (adopting-partial-prefetching.md:312-350).
- **Cost today:** Today: the warning, the prefetch volume of CA-4 and CA-5, and blocking first visits. Later: a migration under time pressure at the next major. Paid by: Shoppers and owners (requests); an agent's session later.
- **Saving:** None from writing the value. With adoption, links to the same route share one shell and a store page not built ahead can answer with a shell at once (Next's docs); not measured on this app.
- **Risk:** Step 1 has none. Adoption changes what a click shows first and meets the router patch (D423). The admin's shells read cookies, so each still needs a server run per route; the sure cut there is CA-5. The storefront's adoption is L and is a separate step.

## The fix

1. next.config.ts:42: write partialPrefetching: false beside cacheComponents, with a comment that it is a recorded choice and names this plan. The warning goes; behaviour does not change.
2. After CA-4 and CA-5 are measured, adopt per segment, smallest risk first: export const prefetch = 'partial' in src/app/(docs)/layout.tsx and src/app/(docs-nb)/layout.tsx (already static). Measure prefetch requests on a docs article with CA-16's e2e budget before and after.
3. Then Kaizena Flow's site: src/app/(platform)/layout.tsx and src/app/(platform-nb)/layout.tsx. Load every route in next dev and clear the 'URL data outside of Suspense' insight where it shows.
4. The storefront last, after CA-1, as its own step (L): the root layout's params read (layout.tsx:105) must move under Suspense or the route be marked instant = false; design it before opening, when no shopper is disturbed. Record it as a step in the bloat plan, not here.
5. When every area is adopted, set partialPrefetching: true and remove the per-segment exports with Next's codemod (npx @next/codemod@canary remove-partial-prefetch ./src/app).

**Done when:** pnpm build no longer prints the partialPrefetching warning (grep -c partialPrefetching on the build's output gives 0; the warning is there today), and next.config.ts names the value.

**Tests and rules that hold today's behaviour, and change with it:**

- No test reads the config. e2e/docs.spec.ts, e2e/docs-host.spec.ts and e2e/navigation.spec.ts hold what a click shows.
- CLAUDE.md, Stack: names cacheComponents; add the recorded value.
- patches/next.patch (D423) patches the client router; e2e/store-pages.spec.ts:60-70 says which lines. Run it after each adoption step, since the patch touches prefetch handling.
- docs/performance.md: add the adoption order.

**Comes after:** CA-4 and CA-5 (measure the cheap cuts first); CA-1 (before the storefront's adoption in step 4)

**Notes:** A framework migration to schedule, with no saving of its own. Do not switch the global flag on now: what a default link would fetch for the storefront with it on was not tested by anyone in this review.
