# PF-9 ✓ Partial Prefetching was planned, never switched on, and the next major Next release forces it

Prefetching: what the router asks for unasked (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 2.4.
- **Second check:** confirmed.
- **Where:** `next.config.ts:41-43`, `docs/plan.md:120`, `evidence/start.log:8-14`, `node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:15-17,57-79`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:38-59`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/prefetch.md:39-58`, `src/app/s/[store]/[market]/layout.tsx:104-105`
- **Evidence:** The plan's stack line reads cacheComponents + partialPrefetching (docs/plan.md:120); the config sets only cacheComponents (next.config.ts:42). Every start logs that the option is unset and that both will be on everywhere in the next major release (start.log:8-14, read here). From Next's docs, not measured (no build was allowed): a default link then fetches one App Shell per route, shared by all links to that route, and content that depends on params or searchParams comes after the press unless the link passes prefetch={true}. For this app: admin rows and the links to one route collapse to one fetch per route (the 18 links of the home page are 11 routes, the skeptic's count), but every storefront page depends on the store and market params, which the market layout reads at its top (layout.tsx:105), so by default almost nothing of a store page would be fetched ahead. A segment can opt in alone with export const prefetch = 'partial' (prefetch.md:39-45).
- **Cost today:** Today: the duplicate shells of PF-6 and one prefetch per link everywhere, and a warning in every build and start log. Later: a forced migration on Next's date, with shoppers watching. Paid by: Shoppers' and owners' browsers now; the team at the next major upgrade.
- **Saving:** Estimate from the docs, as the skeptic left it: on the home page read to the footer, 18 link prefetches become 11 route shells; admin list rows become one. Nothing measured.
- **Risk:** Medium. It changes what is ready at a press; done blind it would make store pages slower to appear, which is why the spike measures before anything ships. The config line alone changes nothing: unset already behaves as false. Before opening there is nobody to notice a wrong first attempt.
- **Already tracked:** docs/plan.md:120 names it as part of the recommended stack; no plan has a step for it

## The fix

1. next.config.ts:42: add partialPrefetching: false beside cacheComponents: true, with a comment that the choice is recorded and the spike below decides it. This stops the warning. Do it in PF-1's change.
2. A time-boxed local spike, not pushed (after PF-1, PF-3 and PF-5 so the counts are clean): add export const prefetch = 'partial' to src/app/admin/(gated)/[store]/layout.tsx (a server component), build, and run e2e/signed-in/prefetch.spec.ts with its hover and row cases set to view, to count what a shared shell saves for the rail and for list rows.
3. Same spike on the storefront: prefetch = 'partial' on src/app/s/[store]/[market]/layout.tsx; count the home page, a product page and PF-13's 48-product listing with e2e/prefetch.spec.ts; note what of a page is still ready at a press.
4. Write the counts and the decision into docs/performance.md and a row of docs/decisions.md: which segments opt in now, which links would earn prefetch={true} (product tiles and the main menu are the candidates), and what is left for the major upgrade.

**Done when:** The start log of a production build no longer prints the partialPrefetching warning (rg -c partialPrefetching on the log gives 0; start.log:8-14 has it today), and docs/performance.md holds the spike's request counts for the admin home, a list and the store home with the decision.

**Tests and rules that hold today's behaviour, and change with it:**

- docs/plan.md:120 names partialPrefetching as part of the stack; correct that line to what the decision says.
- src/lib/next-config-prefetch.test.ts (PF-1) can also hold that partialPrefetching is written out.
- Next's adoption guide offers instant() tests for what must stay ready at a press (adopting-partial-prefetching.md:89-110): use them in the spike if a segment opts in.

**Comes after:** PF-1; PF-3; PF-5

**Notes:** The config line is S and belongs with PF-1; the spike is M; adopting it across the storefront, where every layout and page reads URL data at its top, is larger and is not planned here.
