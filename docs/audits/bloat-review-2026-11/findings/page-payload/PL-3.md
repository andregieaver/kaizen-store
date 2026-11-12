# PL-3 ✓ The language, currency and country links prefetch whole front pages; a language or currency press never opens the one it fetched

What a page sends: document, payload and requests (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.12.
- **Second check:** confirmed.
- **Where:** `src/components/view-menu.tsx:56`, `src/components/view-menu.tsx:62`, `src/components/store-layout.tsx:214`, `src/components/store-layout.tsx:217`, `src/components/store-layout.tsx:236`, `src/components/store-layout.tsx:419`, `src/components/store-layout.tsx:537`, `src/components/site-parts.tsx:190`, `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:302`, `evidence/routes.json`
- **Evidence:** ViewMenu draws each choice as a next/link to that view's front page with default prefetch (view-menu.tsx:56), and its onClick always prevents the link and pushes the page the shopper is on instead (lines 62-72). So the prefetched front page is what a press opens only from the front page. Recounted from routes.json (docs/audits/bloat-review-2026-11/scripts/sources/plpl/rsc.mjs.txt): on the empty cart /s/demo/no-sv, no-da, no-sek, no-dkk, no-eur and no-en, three requests each, about 85 KB decoded per view: 18 requests, 498 KB raw. The same on the checkout; four views (12 requests) on /om-oss; two on the account and wishlist. On long pages the footer was not in view and nothing was fetched. Each view is another root layout, so its whole chrome comes too, the not-found copy of PL-2 included. On the cart and on /om-oss the front page's four first pictures also arrived after load, though neither page draws them; on the pages that prefetched two views they did not (cause not traced). The country lists are the same shape and were not measured, because the demo sells in one country: three next/link lists to every market's front page (store-layout.tsx:236, 419, 537; site-parts.tsx:190). There a press does open the front page, but each country in view is another whole layout. LanguageLinks, the other switcher, draws plain anchors and prefetches nothing. Next's reference (link.md:302-304): prefetch={false} never prefetches, in view or on hover.
- **Cost today:** Up to 18 requests and 498 KB raw per page view where the footer's list is in view (102 KB as measured locally, about 72 KB of compressed body), for stores that offer several languages or currencies. Each request passes through proxy.ts. It grows with the languages, currencies and countries a store offers and with page views: by the per-view measure, a store selling in ten countries would add about 30 requests and 850 KB decoded per view of a short page (estimate). Paid by: A shopper's browser and data plan; the server per request (the proxy and the CDN behind it).
- **Saving:** Measured: 18 requests and 498 KB raw (about 72 KB of compressed body) per view of the cart or checkout, 12 requests and 332 KB raw per view of a short content page, for a store with several languages or currencies; over half of the empty cart's prefetch bytes. Not measured: the country lists, about 3 requests and 85 KB decoded per country in view (estimate from the views' size).
- **Risk:** Low: a language, currency or country switch waits for its page as any first navigation does. The localization specs show a broken switch at once.

## The fix

1. src/components/view-menu.tsx:56: add prefetch={false} to the Link. Nothing else changes: the click handler already navigates with router.push, and without scripts the link still leads to that view's front page.
2. The country lists: add prefetch={false} to the Link at src/components/store-layout.tsx:236 (the header's menu), 419 (the phone menu) and 537 (the footer), and at src/components/site-parts.tsx:190 (a built footer's list). A country switch then waits for its page like any first visit.
3. e2e/performance.spec.ts: add a test. Phone context, cold, /s/demo/no/om-oss, wait 2 seconds after load, collect the requests that carry the next-router-prefetch header. Expect none whose path is another view of the store (/s/demo/no- followed by a language or currency).
4. docs/performance.md, under The rules: 'A link whose press does not open its href (a language, a currency), or that leads to another country's whole layout, is not prefetched.' A decision line in docs/decisions.md.

**Done when:** The new test in e2e/performance.spec.ts passes (0 prefetch requests to another view on /s/demo/no/om-oss; 12 today), and node docs/audits/bloat-review-2026-11/scripts/measure-routes.mjs shows the empty cart's prefetches fall from 42 to 24 requests.

**Tests and rules that hold today's behaviour, and change with it:**

- e2e/localization.spec.ts and e2e/language-switcher.spec.ts: choosing a language or currency keeps the page and its query. Must pass unchanged.
- src/lib/language-switch.test.ts and src/lib/language-rule.test.ts (the remembered language).
- e2e/store-pages.spec.ts:65-70 aborts prefetches on purpose (the Safari patch, D423): not affected.
- Rules docs/rules/storefront.md, 'Language and currency are apart from the country (D109)' and D479: each choice stays a real link to its view. Kept.

**Notes:** Same finding as SC-1 (storefront-client) and CA-4 (caching); one change. The country lists are added to the report's fix here because they are the same cost per link and an EU-wide store has many; the report measured only languages and currencies.
