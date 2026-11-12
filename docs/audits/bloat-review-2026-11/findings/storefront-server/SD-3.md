# SD-3 ✓ Every deploy empties the caches and nothing warms them

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** no check. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 0.2.
- **Second check:** corrected.
- **Where:** `src/server/shop.ts:88-100`, `src/app/s/[store]/[market]/layout.tsx:47-49`, `scripts/await-deploy.mjs:52-56`, `.github/workflows/ci.yml:331`, `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:596-606`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:243-262`, `docs/performance.md:83-85`
- **Evidence:** Only the template store is prerendered at build (prerenderedShops(), shop.ts:93-100); the fallback shell for any other store is a 0-byte file (.next/server/app/s/[store]/[market].html), so its first visit after a deploy is drawn whole at request time. Next's guide: all cache stores 'are scoped to a single deployment. A new deploy starts fresh', and neither caching directive carries over to a new deploy. 90 commits were made on 11 Nov; the verifier found 52 of 89 touched code, and such a push deploys. await-deploy.mjs waits for /api/health and calls two API refusals (SMOKE_CHECKS, :52-56), then stops: it requests no page. docs/performance.md:84 records a page that took 3.1 s to answer while a deploy went live.
- **Cost today:** Today the team and crawlers meet the cold pages. After opening, the first visitor to each page of each store after each deploy waits for a cold function start (SD-1) plus about 30 statements (SD-5). Cold draws are stores x visited pages x deploys a day, so it grows with both the store count and the present habit of many deploys a day. Not timed in production. Paid by: Shoppers (first byte) and owners looking at their store after a change, once the platform is open; the database for each cold draw.
- **Saving:** Step 1 saves no statements; it moves the first cold start after each deploy from a visitor to the job and catches a broken storefront at deploy. Step 2, estimate: the 1 to 3 s cold first view of each busy page after each deploy (from the one case in docs/performance.md).
- **Risk:** Low. More requests per deploy; the warm-up must stay bounded as stores grow and must not reach private stores. A page check that fails for a reason outside the deploy (the template store closed) would fail the job: the address is a variable.

## The fix

1. Step 1, now: scripts/await-deploy.mjs:52-56 gains page checks. After production reports the commit it requests Kaizena Flow's home and one page of the template store (addresses from a new SMOKE_PAGES variable set in .github/workflows/ci.yml beside PRODUCTION_URL), each expecting 200. This starts the proxy and one page function before a visitor does, and shows at deploy a storefront module that cannot load, as the two API checks do for theirs.
2. Step 2, after opening, when visit counts exist: scripts/warm-deploy.mjs, run by the release job after await-deploy. It asks a token-guarded route (new src/app/api/cron/warm-targets/route.ts, inside trackedRoute() with a maxDuration) for at most 50 addresses: the front page and All products of open, public stores with the most page views in the last hour (commerce.visits; private stores and stores without visit counting are left out). It requests them four at a time with a robot user agent and stops after 60 seconds. Do not warm every store: at dozens of deploys a day the warm-up would cost more than the cold visits it saves.
3. put the question of how often production is deployed once shoppers are there to the owner, with the numbers of SD-3 and SD-8. The written rule D5 (push straight to main) can stay or change; it is not decided here.

**Done when:** The release job's log lists the page checks with status 200 after each deploy, and src/lib/await-deploy.test.ts shows that a page answering 500 fails the job.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/await-deploy.test.ts (deployVerdict and smokeProblems): add the page checks.
- .github/workflows/ci.yml:331, :397 and :418 run the script; docs/ci-migrations.md and the Workflow bullet of CLAUDE.md describe what a deploy waits for: add the page checks.
- For step 2: src/server/cron-routes.scan.test.ts holds a new cron route to maxDuration and trackedRoute(); the visit beacon is client-side, so a server request counts no visit.

**Comes after:** SD-1

**Notes:** Before opening there is nobody to warm for, so only step 1 is worth doing now. SD-8 does not replace this: a deploy empties the caches whatever their life. The deploy cadence after opening is the owner's choice.
