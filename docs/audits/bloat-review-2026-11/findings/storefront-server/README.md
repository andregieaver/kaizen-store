# What the server does for a storefront request (SD)

Part of `docs/audits/bloat-review-2026-11.md`, on commit 0bd814c. Read by one reviewer, challenged by a second (who re-opened every citation, re-measured every number and applied the owner's note that the platform is not open yet) and planned by a third. A tick (✓) marks a finding the second reviewer confirmed or corrected; one the planner added has none. Each finding has a file of its own beside this one.

**In short.** A warm, cached storefront page is lean (a prerendered home page or a store's own page makes no database read of its own); the cost sits around the page and none of it depends on which features a store uses, so every store pays it once the platform opens. A product page asks the database about 18 times a view where only stock changes per view, the proxy in front of every page loads 1,311 modules (0.8 to 0.95 s and 168 MB cold on this machine) where its five reads need about 50 to 100, and every page load makes a second function call to learn the wishlist is empty and, with a product grid, a third (3 statements) for tile stock that is off by default. Cached pages are drawn again by the clock (1 hour for 71 of 85 cached reads, 15 minutes for the home page), by every deploy (up to 52 on 11 Nov) and by any one owner saving AI settings, which expires every store's pages (319 of the build's 1,316 prerendered entries carry that one tag). Nothing here removes or hides a feature: 16 fixes make cost follow use, five of them small and safe enough to do first, and before opening is the cheapest time for all of them.

## Findings

| ID | Finding | Kind | Priority | Effort | Step |
|---|---|---|---|---|---|
| [SD-10](SD-10.md) ✓ | The store is looked up by its id again and again | duplicate | P0 | S | 0.20 |
| [SD-11](SD-11.md) ✓ | The same shopper facts are read several times in one request | duplicate | P0 | S | 0.22 |
| [SD-14](SD-14.md) | Product tiles ask the server for stock on every page load, also in stores that show none | eager | P0 | S | 0.15 |
| [SD-15](SD-15.md) | Every page load calls a function to learn that the wishlist is empty | eager | P0 | S | 0.15 |
| [SD-16](SD-16.md) | One owner saving AI settings expires the cached pages of every store | eager | P0 | S | 0.21 |
| [SD-1](SD-1.md) ✓ | The proxy and every storefront page load about half of the server's code at cold start | eager | P1 | M | 2.20 |
| [SD-2](SD-2.md) ✓ | A product page asks the database about 18 times per view; one answer changes per view | eager | P1 | M | 2.13 |
| [SD-8](SD-8.md) ✓ | Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page | eager | P1 | M | 2.15 |
| [SD-13](SD-13.md) ✓ | The browser's side has budgets; the server's side has none that can see these costs | no check | P1 | M | 1.11 |
| [SD-3](SD-3.md) ✓ | Every deploy empties the caches and nothing warms them | no check | P2 | S | 0.3 |
| [SD-4](SD-4.md) ✓ | Every published page is read whole to pick one page or a few titles | oversize | P2 | M | 0.24 |
| [SD-5](SD-5.md) ✓ | A cold page waits on reads one after another before its first byte | eager | P2 | S | 2.18 |
| [SD-6](SD-6.md) ✓ | The proxy reads the database before a page view whenever its 10-second memory has lapsed | eager | P2 | S | 2.20 |
| [SD-7](SD-7.md) ✓ | Every instance loads the interface-text tools and reads the translations table before its first request, then polls it each minute | eager | P2 | M | 0.8 |
| [SD-9](SD-9.md) ✓ | A store's pages ask about every optional feature, whether that store uses it or not | eager | P3 | S | 2.18 |
| [SD-12](SD-12.md) ✓ | Whole rows and documents are read for one fact | oversize | P3 | S | tolerated |

## Measured

| Measure | Value | How |
|---|---|---|
| Proxy cold load | 920 and 948 ms, +167 and +168 MB (my two runs, with a build and browsers using the machine); the verifier measured 795 to 840 ms; next/server + pg + drizzle + zod alone 133 to 172 ms and 34 MB (the verifier's, not re-run) | node docs/audits/bloat-review-2026-11/scripts/sources/sd/load-proxy.cjs.txt: a fresh node process requires .next/server/middleware.js. Local machine, not Vercel. |
| Modules the proxy reaches, today and with its reads in leaf modules | 1,311 modules, 20.6 MB of source today. With the 16 import edges of SD-1 step 1 cut: 97 modules, 1.95 MB; with the schema import also gone: 52 modules, 0.5 MB | Static walk of value imports from src/proxy.ts: docs/audits/bloat-review-2026-11/scripts/sources/sd/graph-cut.mjs.txt (re-run) and my docs/audits/bloat-review-2026-11/scripts/sources/sdp/list.mjs.txt with the CUT list. |
| Modules the store layout reaches | 1,466 today; 1,011 without customers.ts -> privacy-erasure.ts; 999 when, besides that and the schema, only two-step.ts stops importing admin-text.ts; 872 when all 8 importers of admin-text.ts on this path stop | docs/audits/bloat-review-2026-11/scripts/sources/sdp/list.mjs.txt and docs/audits/bloat-review-2026-11/scripts/sources/sdp/importers.mjs.txt from src/app/s/[store]/[market]/layout.tsx. The 8 importers: lib/two-step.ts and server/customer-tiers.ts, store-closure.ts, plan-reminders.ts, shopper-emails.ts, company-locations.ts, staff-alerts.ts, endpoint-emails.ts. |
| Modules the interface-text start-up code reaches | 383 (7.6 MB of source) today; 93 (2.2 MB) with the translating tools split from the reader; 47 (0.77 MB) once the schema import is gone. /api/health reaches 54 | docs/audits/bloat-review-2026-11/scripts/sources/sdp/list.mjs.txt from src/server/ui-text.ts with the four tool imports cut; same walk from src/app/api/health/route.ts. |
| Statements per view, warm local production server, anonymous | product page about 18 (20 commits in a 6 s window whose idle floor is 1; one was the minute poll of SD-7); search 11 to 12; category about 2; /api/shop/tiles for 10 products 4 over the floor (3 by the code); /wishlist/saved 0 of its own. The verifier's other numbers (home 0, store page 0, All products about 3) were not re-run cleanly: other reviewers shared the database | docs/audits/bloat-review-2026-11/scripts/sources/sdp/measure.sh.txt: pg_stat_database.xact_commit and pg_stat_user_tables of the local review database before and 6 s after one curl. Three requests for a static file gave +1 each (the floor). |
| Function calls a page load makes after the document | /wishlist/saved on 12 of 12 store pages measured (twice on checkout); /api/shop/tiles on 2 (home and All products); the proxy also runs for the first | Counted the responses of each store page in scratchpad/m/routes.json (local build, Chromium, cold browser). |
| Prerendered entries that carry the platform-wide tag ai-providers | 319 of 1,316, among them the template store's home, product and text pages and Kaizena Flow's home; the store pages also carry the platform-wide tag catalog | grep -rl ai-providers over .next/server/app/**/*.meta; read x-next-cache-tags of s/demo/no.meta, s/demo/no/p/demo-keramikkopp.meta, s/demo/no/om-oss.meta and index.meta. |
| Cached reads and their lifetimes | 85 'use cache' functions; 71 calls of cacheLife("hours"), 5 of days; 2 functions with no life (ownerSells, campaignNoticesAt: the 15-minute default); 0 'use cache: remote' | Re-ran docs/audits/bloat-review-2026-11/scripts/sources/sd/nolife.mjs.txt and rg -c over src without tests. |
| Shell lifetimes in the build | 668 prerendered entries at 1h, 6 at 15m (store home and All products in 3 markets), 2 at 1m (the verifier's count; not re-counted) | Route table of scratchpad/m/build.log. |
| Stores with shells made at build | 1 (the template store); the fallback shell for any other store is a 0-byte file | ls -la of .next/server/app/s and .next/server/app/s/[store]/[market].html; prerenderedShops() in src/server/shop.ts:93-100. |
| Commits on 11 Nov 2026 | 90 commits; the verifier found 52 of 89 touched code by 23:38 UTC (an upper bound on deploys) | git log --since/--until --oneline \| wc -l (mine); the split by changed files is the verifier's. |
| Callers of the whole-page list | 35 call sites of listPublishedPages() by my count (the verifier counted 36); 9 keep one page by id; production returns 29 rows a call, 79,778 calls, 781 s in 78 days | rg 'listPublishedPages\(' over src without tests, minus the definition and one comment; figures from scratchpad/m/prod-db-stats.md. |
| Writers the product page's cached facts would depend on | 12 server files write the tables behind them: settings.ts, connect.ts, mollie.ts, payment-methods.ts, checkout-rules.ts, order-settings.ts, quote-requests.ts, draft-orders.ts, suppliers.ts, automations.ts, products.ts, price-lists.ts (producer-registrations.ts for the scheme rows) | rg '(update\|insert into\|delete from) commerce.<table>' over src without tests and fixtures, for payment_providers, stripe_accounts, checkout_providers, mollie_connections, payment_methods, checkout_fields, order_settings, automations, price_breaks, price_list_breaks, product_schemes. |

## Well made, and should stay

- A store's own page is found by one row, not from the list (findPublishedPage, src/server/pages.ts:683-708), and a store's menus take page titles in SQL (publishedPageNames, pages.ts:715-736). A menu's four reads run together (src/components/store-layout.tsx:73-78).
- getProduct() runs its seven follow-up reads together (src/server/catalog.ts:424-431), and the optional texts per country are subqueries of its one cached statement (catalog.ts:386-393): an unused table there costs nothing worth a change.
- The cart count and the signed-in customer cost no database read without a cookie (src/server/cart.ts:545-546, src/server/customers.ts:455-456). The wishlist's handler likewise reads nothing for a visitor with no list (src/server/wishlists.ts:36-42, measured); the waste there is the call, not the read (SD-15).
- Chat, referral capture, consent and running tests are decided in the cached shell, not per request: their tags are on the shell (.next/server/app/s/demo/no.meta lists store, pages, experiments, text-styles, catalog, campaigns, terms, chat, affiliate, cookies, recommend).
- Stock is the one catalogue fact read per request by design, and the rule is written (docs/rules/storefront.md:110-114). Every fix here keeps it.
- The proxy's A/B reads run only for visitors who carry the kaizen_ab cookie (src/proxy.ts:152), and its held-domain read is kept 30 s (src/server/holding.ts:17).
- Visit counting sends its beacon only while the owner has it on (src/components/store-visits.tsx:12-13, the flag from the cached store; the column defaults to false, src/db/schema.ts:788): cost follows use. The country suggestion reads request headers only, no database (src/components/country-hint-section.tsx:18-22).
- Font stylesheets are served immutable for a year (src/app/api/fonts/css/[slug]/route.ts:40).
- A category view makes about 2 statements when warm (measured): the listing's own page of ids and the terms. Search makes 11 to 12; it is used when a shopper searches, so its cost follows use; only its settings reads repeat (SD-9).
- An optional feature that costs nothing per request, per cold start or per scheduled run is not a finding here, whether or not any store uses it yet.
- Checked by the verifier and not a server cost: the 5,200 repeated RSC requests on a category page of the local build come from the browser's cache (88 KB transferred in all). That loop belongs to the client dimension.
