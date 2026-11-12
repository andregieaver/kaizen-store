# SD-5 ✓ A cold page waits on reads one after another before its first byte

What the server does for a storefront request (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** medium. **Step:** 2.10.
- **Second check:** confirmed.
- **Where:** `src/app/s/[store]/[market]/layout.tsx:108-128`, `src/app/s/[store]/[market]/layout.tsx:166`, `src/app/s/[store]/[market]/layout.tsx:194-198`, `src/components/store-layout.tsx:467-473`, `src/server/site-layouts.ts:29-66`, `src/server/site-cookies.ts:31-37`, `src/server/site-cookies.ts:86-108`, `src/app/s/[store]/[market]/page.tsx:22-32`, `src/app/s/[store]/[market]/page.tsx:68`
- **Evidence:** Read in order for a store's home page with no shell (an estimate, not measured: a first visit to another store would write into .next). The proxy reads the store's facts; the layout reads the store, then header, footer and legal links together (layout.tsx:123-128), each 2 to 3 reads deep, then text styles alone (awaited inside the JSX at :166). Only then can <html> be sent. After that: menus, fonts, chat, then consent, where siteCookies() awaits its cached reads strictly in a row (site-cookies.ts:88-108: features, chat agent, the modal scan, the affiliate site, recommendations, experiments, then the scan and notes), then the page: all pages for the front page, tests, then products and campaigns together. The store's own row is read by the proxy, by the layout and again by siteCookies() (storeFeatures, :31-37) in one cold request. The legal links are read in the blocking wave even for a store with a built footer, which never shows them (layout.tsx:194-198; StoreFooter takes them as a prop, store-layout.tsx:467-473).
- **Cost today:** Estimate: 30 to 35 statements per cold page, about 5 waits in a row before the first byte, 8 in a row for consent. With the database in the same region each wait is a few milliseconds, so tens of milliseconds per cold draw, once per page per deploy and per redraw. One cold draw was measured by the verifier: Kaizena Flow's home, 27 statements. Paid by: The shopper's first byte on a cold visit; the database.
- **Saving:** Estimate: waits in a row before the first byte from about 5 to about 3; consent from 8 in a row to one wave; 2 to 4 fewer statements per cold draw. Small in time; cheap to do.
- **Risk:** Low. An async footer inside the layout streams with the page as the header already does.
- **Already tracked:** No. FF2 and FF5 / step 3.9 (Open) cover the whole-catalogue read for the home page's JSON-LD and the product index in metadata; they are not repeated here.

## The fix

1. src/app/s/[store]/[market]/layout.tsx:123-128 starts textStylesCssFor(store.id) in the same Promise.all as the header and footer; :166 uses the result.
2. the layout stops reading legal links (layout.tsx:127). StoreFooter (src/components/store-layout.tsx:467) becomes async and awaits legalLinksFor(store, market, afterSale) itself, so a store with a built footer never reads them and the read leaves the blocking wave.
3. siteCookies() (src/server/site-cookies.ts:71-108) takes the store's features and visitCounting as arguments: MarketExtras holds the cached store and passes them to SiteConsent (src/app/s/[store]/[market]/extras.tsx:35-44), which hands them on. It drops storeFeatures() for stores and runs its other reads in one Promise.all.
4. src/app/s/[store]/[market]/page.tsx:22-32 and :68 start the front page, the products and the campaign notices together.
5. the four questions about experiments become one cached read (SD-9 step 1).

**Done when:** The first request for a store's home page after a restart of a local production server makes at least 3 fewer statements than before the change (work/sdp/measure.sh), and layout.tsx has one awaited Promise.all before <html> and no await inside its JSX.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/cookie-consent.test.ts, cookie-consent-affiliate.test.ts, cookie-consent-modals.test.ts, src/server/cookie-scans.int.test.ts; e2e/cookies.spec.ts, e2e/site-layouts.spec.ts, e2e/store-pages.spec.ts.
- The comment at site-cookies.ts:30 says a feature's switch refreshes cookiesTag (refreshFeatureTags()): with the features taken from the store, the store's tag carries the change; keep both refreshes.
- src/lib/pay-routes.graph.test.ts: the extras stay inside MarketExtras; the layout's imports do not change kind.

**Notes:** Tens of milliseconds per cold draw: do it when the layout is next opened, for example with SD-15, which adds a part to the same file.
