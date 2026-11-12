# SD-6 ✓ The proxy reads the database before a page view whenever its 10-second memory has lapsed

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 2.20.
- **Second check:** corrected.
- **Where:** `src/proxy.ts:55-59`, `src/proxy.ts:71`, `src/proxy.ts:109`, `src/server/redirect-resolve.ts:203-231`, `src/server/redirect-live.ts:186-199`, `src/server/experiments.ts:59-68`, `src/server/holding.ts:17-36`, `src/server/house-switch.ts:30-43`, `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29`
- **Evidence:** The matcher takes every page on every host (proxy.ts:55-59). A store's facts are kept 10 s per instance (FACTS_MS, redirect-resolve.ts:203) and so is the site switch. Seen again in my measurements: the first /wishlist/saved call after a pause read stores, markets, store_currencies and platform_settings; the next one read nothing. remembered() does not share a read in flight (redirect-live.ts:192-199: it awaits load() and only then stores the value), so requests that arrive together after the memory lapsed each run it; a page load sends 12 to 52 requests through the proxy (routes.json). The same helper exists three times (redirect-live.ts:192, experiments.ts:62, holding.ts:17-36). Next's guide: 'Proxy is not intended for slow data fetching'.
- **Cost today:** One statement (two on Kaizena Flow's own host) and a pooled connection in front of the cached shell on the first request of most visits; the first byte waits a few milliseconds for it. With many stores each visited now and then, a 10 s memory per instance rarely holds between visits. Paid by: The shopper's first byte; the database.
- **Saving:** Estimate: a burst after 10 s of quiet reads once instead of once per request in flight: a few statements under load. Small beside SD-1 and SD-2.
- **Risk:** Low for steps 1 to 3. A rejected load must not stay in the in-flight map (delete it in finally). The background refresh is left out because of D339.

## The fix

1. remembered() shares a read in flight: a map of running loads beside the memory, so a second caller for the same key awaits the first (src/server/redirect-live.ts:186-199; with SD-1 step 1a this is the new src/server/short-memory.ts).
2. experiments.ts:59-68 and holding.ts:17-36 use that one helper instead of their own copies.
3. on Kaizena Flow's own host src/proxy.ts starts siteStore() (:71) and the store's facts together where both are needed, instead of one after the other.
4. Not now: answering from older facts and refreshing in the background. It would stretch the written bound of D339 (a store switched to private is hidden on every instance within about 10 seconds; the comment at proxy.ts:26 says the same for address shapes) to a hard cap plus one request, to save one small statement per visit.

**Done when:** A unit test shows 20 concurrent remembered() calls for one key run the loader once, and rg finds one definition of the helper in src/server (three today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/redirect-live.test.ts or a new src/server/short-memory.test.ts: 20 concurrent calls for one key run the loader once; a failed load is not remembered.
- src/proxy.test.ts, src/server/private-mode.int.test.ts, store-address.int.test.ts, experiments.int.test.ts.
- docs/wave-7-storefront.md E (D339) and the comment at src/proxy.ts:25-27: the 10-second bound is unchanged.

**Comes after:** SD-1

**Notes:** Done as part of SD-1 step 1a at no extra cost. I dropped the verified fix's background refresh: its gain is one small statement and it weakens a privacy bound an owner relies on.
