# SD-8 ✓ Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.15.
- **Second check:** confirmed.
- **Where:** `src/server/content-grid.ts:162-168`, `src/server/campaign-notices.ts:149-153`, `src/server/campaign-notices.ts:182-188`, `src/server/pages.ts:665-667`, `src/server/stores.ts:217-219`, `src/server/store-writers.scan.test.ts:13-25`, `next.config.ts:42`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:108-120`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:137-170`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:400-447`
- **Evidence:** Re-counted: 85 cached functions, 71 calls of cacheLife("hours") (made again after 1 hour), 5 of days, and 2 functions with no life (ownerSells, content-grid.ts:162-168; campaignNoticesAt, campaign-notices.ts:182-188), which take the default of 15 minutes. Next's guide: an outer cache without a life takes the default; a shorter inner life can shorten it, a longer one cannot extend it. So campaignNoticesAt follows a campaign's start or end (good) but never lasts more than 15 minutes. The verifier read the build's route table: 668 entries at 1h, and the store home and All products at 15m. Next's guide also says when a redraw happens: a request that arrives after the period is served the old copy and the content is made again in the background. So a page visited less often than once an hour is drawn again on nearly every visit, about 30 statements each time, although its writers refresh its tags. The guide recommends a long life with tags for content its author changes. The store's own read (stores.ts:217-219) depends on more tables than the writers' scan holds: it holds writers of commerce.stores only (store-writers.scan.test.ts:13-25), while the read also joins markets, store_currencies, page_roles, return_settings, menus, payment_providers and stripe_accounts (stores.ts:233-272). Today's one-hour life is the net under those.
- **Cost today:** Up to 24 redraws a day per visited page (96 for home and All products), each about 30 statements on a fresh instance. For a small store the redraws track visits, not changes: a page seen every two hours is drawn again on every visit. It grows with stores x visited pages. Paid by: The server and the database. No visitor waits: the old shell is served meanwhile.
- **Saving:** Estimate: background redraws fall from one per hour (or per visit, for a quiet page) to one per change. With many deploys a day part of the gain is lost, because a deploy empties the caches anyway (SD-3). Step 1 alone: the home page and All products from 96 possible redraws a day to 24.
- **Risk:** Medium. A writer that misses its tag leaves a page stale for days, not for an hour, so each move waits for its scan. Noticed by the scans, and in production by an owner whose change does not show on the site (their own next view is fresh, because actions use updateTag). Step 1 is low risk: it only lengthens two functions that already follow shorter inner lives.
- **Already tracked:** No. FF3 / step 3.10 (Open) is about finer tags, not lifetimes.

## The fix

1. Step 1, small: next.config.ts (beside cacheComponents at :42) redefines the default profile as { stale: 300, revalidate: 3600, expire: 86400 }. The two functions without a life then last an hour unless an inner read is shorter, which is what the comment at campaign-notices.ts:186 intends. The store home and All products leave the 15-minute row.
2. the same file defines a named profile, tagged: { stale: 300, revalidate: 604800, expire: 2592000 }.
3. move reads to cacheLife("tagged") only behind a writers' scan, in this order. (a) The store: first extend src/server/store-writers.scan.test.ts to the other tables readStore() reads (markets, store_currencies, page_roles, return_settings, menus, payment_providers, stripe_accounts), then change stores.ts:218. (b) Pages: a page-writers scan (a writer of commerce.pages refreshes pagesTag), then listPublishedPages, findPublishedPage, publishedPageNames (pages.ts:665-722) and siteLayoutFor (site-layouts.ts:31). (c) Fonts, text styles and terms the same way.
4. leave on the clock what depends on it: catalogue reads with prices (the 30-day reference and timed prices), campaignNotices() with its computed life (campaign-notices.ts:149-153), and anything that reads now().
5. the scan of SD-13 step 2 (every 'use cache' sets a life and a tag, with a short list of named exceptions).

**Done when:** pnpm build's route table shows no storefront route at 15m (6 today) after step 1, and the rows of a store's own pages (/s/[store]/[market]/[slug]) at 1w instead of 1h after step 3.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/store-writers.scan.test.ts (extended first); src/lib/campaign-notices.test.ts; the test that holds LOOKUP_LIFE of src/server/redirect-resolve.ts:41 to its cacheLife() call (an explicit life, untouched).
- next.config.ts; the type of cacheLife() is generated from it at build, so cacheLife("tagged") type-checks only after a build or next typegen.
- docs/performance.md: a section on cache lives; docs/rules/storefront.md:110-114 (catalogue reads) unchanged; CLAUDE.md Conventions: a new cached read sets a life and a tag, and takes the tagged profile only where a scan holds its writers. No written rule asks for the one-hour life (searched docs/rules, docs/performance.md and docs/decisions.md, as the verifier did).

**Comes after:** SD-13; SD-16

**Notes:** Changed from the verified fix in one way: the two functions get their life from a redefined default profile, not an explicit call, because an explicit outer life would stop them following a campaign that starts in ten minutes. A long life makes SD-16 more urgent: a platform-wide tag on long-lived pages turns one owner's save into every store's only redraw.
