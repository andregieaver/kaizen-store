# Addresses without a country (D181)

A store that sells in one country has no country in its addresses.

| Store | Before | Now |
| --- | --- | --- |
| On its own domain | `kaizenalabs.com/no/home` | `kaizenalabs.com/home` |
| On Kaizen's domain | `/s/kaizenalabs/no/home` | `/s/kaizenalabs/home` |
| In English (offered, not the country's own) | `/no-en/home` | `/en/home` |
| In euro / English and euro | `/no-eur/…`, `/no-en-eur/…` | `/eur/…`, `/en-eur/…` |

A store "sells in one country" when it offers exactly one: Several countries is off, or only one country is kept
(`store.markets.length === 1`, `offeredMarkets()`, D178). Its address is then its own country's own view: the language
the country is shown in by default (the owner sets it as the main language with Several languages off), so a store whose
main language is English has English at `/home`.

A store that sells in several countries keeps the country in every address, as before (`/s/demo/no/…`).

## How it works

Nothing inside the app moves. The routes are still `/s/[store]/[market]/…` and a market's slug is still `no`, `no-en`, …;
every route, cache key, cookie and table that names a market is unchanged.

- **Routing is the proxy's** (`src/proxy.ts`). Its second matcher (`STORE_MATCHER`, a literal held to the constant by a test)
  now covers every page path, so it sees each request for a store's page on Kaizen's address (`/s/{store}/…`) and on a store's
  own host (`/…`). `storeRequestAnswer()` (`src/server/redirect-resolve.ts`) reads the store's facts and asks the pure
  `addressDecision()` (`src/lib/store-address.ts`):
  - one country: a short address is **rewritten** to the long one (`/home` → `/no/home`, `/en/home` → `/no-en/home`,
    `/` → `/no`); an old long one is **moved, 308**, to the short one with the rest of the path and the query
    (`/no/home` → `/home`, `/no-en/x` → `/en/x`). Another country the store had (`/se/x`) and a language or currency it keeps
    but no longer offers (`/de/x`) are left to the routes, which move them (`marketMoved()`, D178) to an offered address,
    which `marketPath()` makes short. Anything else (a page, a product, an old shop's `/collections/x`) is the home
    country's, so manual redirects (D168) and the 404 report work from the catch-all route as for any market.
  - several countries: an address with the country is served as it is; a short choice moves back (`/en/x` → `/no-en/x`);
    an address with no country is looked up as a manual redirect (D168), then moved to the home country when it is live
    there (a working page, `MARKET_ROUTES`, or a live product, category, tag, page or article, `liveOf()`), else counted as
    missing and left a 404. So links in emails and search results keep working whichever way a store switches.
  - A move is only made for GET and HEAD; a POST (a server action) to a short address is still rewritten.
  - A/B tests (D148) run after the rewrite, on the long path, as before.
- **The proxy reads the database at most once per store and instance every `FACTS_MS` (10 s)** (`remembered()`), never per
  request; `setFeature()` and the Countries and Localisation settings forget this instance's facts at once
  (`forgetStoreFacts()`). So a switch of Several countries, languages or currencies takes effect **without a deployment**,
  within seconds. We chose this over routes built into the deployment (as P8's domains are) because stores are made and
  switched far more often than domains change, and a new store would otherwise need a deployment before its addresses work.
  The cost is a proxy call for every page request (no database call), where before only addresses without a country and
  A/B visitors had one.
- **Links follow in one place.** `getStore()` notes each store's address shape (`store.address`, `storeAddressOf()`) as it
  reads it (`rememberStoreAddress()`), and `marketPath()` reads it (`storeAddress()`): menus, the page builder's address
  preview (`https://kaizenalabs.com/home`), canonical and hreflang, the sitemap and llms.txt, emails (the email store
  loader, `knowStoreAddress()`), Stripe's return addresses and redirects all follow. A store not read in the process yet
  gets long links, which the proxy moves. On a store's own host the front page of a single-country store is an empty
  path: `marketHome()` (or `|| "/"`) wherever an address cannot be empty.
- Paths read in the browser and from requests understand both shapes: the pay routes' checks and policy
  (`isPayPath()`, `PAY_SOURCES` gains `/s/:store/cart…` and `/cart…`), the visit beacon (`placeOfPath(…, address)`), the
  language and currency menu (`ViewMenu` takes each choice's `marketPath()`), robots.txt (`storePrivatePaths()` and closed
  pages without the market too).

## Collisions

A first part that is a language or currency the store keeps (`en`, `eur`, `en-eur`, also those of countries it keeps but
does not offer, and `eur`, which every store has a rate for) is read as that choice, never as a page. Such page addresses are
reserved: `savePage()` refuses them for a store's pages and the builder's context lists them (`reservedChoiceSlugs()`).
A page that already has such an address keeps it but is reachable only with the country while the store sells in several;
the seed has none (its only short page address, `om-oss`, is no choice). A market-shaped page address that is no view of
the store (`no-way`, `om-oss`) is a page.

## Tests

`src/lib/store-address.test.ts` (shape, links, the decision both ways, the matcher, the market routes),
`src/proxy.test.ts`, `src/lib/pay-routes.test.ts`, `src/lib/visit-record.test.ts`,
`src/server/store-address.int.test.ts` (a store made as sign-up makes it, then switched), `e2e/marketless.spec.ts`.
