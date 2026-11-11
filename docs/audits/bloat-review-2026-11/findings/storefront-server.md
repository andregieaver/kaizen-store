# What the server does for a storefront request (SD)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** A warm, cached storefront page is lean: a prerendered home page, store page or empty cart makes no database read of its own. The bloat sits around that page. The proxy that runs before every page view loads 1,311 modules (about 0.85 s cold, measured here) and asks the database on most views; a product page asks about 18 times per view where one answer (stock) changes; and every deploy (48 code commits on 11 Nov) throws all caches away with nothing to warm them, so most real visits to 59 of 60 stores take a cold path of about 30 statements, several of them one after another. Most of this is a handful of concrete knots (three imports, one page-list read, one start-up read of an empty table), not a rewrite.

## Measured

| Measure | Value | How |
|---|---|---|
| Proxy cold load | 848, 861, 856 ms and +167 MB; the packages a slim proxy needs (next/server, pg, drizzle, zod) load in 116-168 ms, +34 MB | Three runs each in a fresh node process requiring .next/server/middleware.js (script scripts/sd/load-proxy.cjs). Local machine, not Vercel. |
| Modules the proxy reaches | 1,311 modules, 20.6 MB of source (483 of 795 server files, 813 of 1,145 lib files, the whole schema); built as 18 chunks, 9.96 MB, loaded at start | Static walk of value imports from src/proxy.ts (scratchpad/work/sd/graph.mjs, same method as src/lib/pay-routes.graph.test.ts); chunk list read from .next/server/middleware.js and their sizes summed. |
| Modules a store page's layout reaches | 1,466 (21.4 MB of source); 1,011 without the one import customers.ts -> privacy-erasure.ts; 872 without that, admin-text.ts and schema.ts | Same walk from src/app/s/[store]/[market]/layout.tsx, with edges removed (scratchpad/work/sd/graph-cut.mjs). |
| Work before an instance's first request | 526, 567, 574 ms and +106 MB | Three fresh node processes calling register() of .next/server/instrumentation.js against the local review database (scratchpad/work/sd/load-instr.cjs). |
| Statements per view, warm server, anonymous, prerendered demo store | home 2-5 (only the proxy's tables), store page 4, All products 3, category 5, search 12, product 18-19, booking product 14, Kaizena Flow's home 2, empty cart 0 beyond the proxy | pg_stat_database.xact_commit and pg_stat_user_tables read before and 8 s after one curl to the already running local production server; noise floor of 1 (a static file) removed (scratchpad/work/sd/measure.sh). |
| Statements for a cold store home page (no shell, empty caches) | about 30-35, at least 6 in sequence before the first byte (estimate) | Traced by reading the layout, page and their readers in order; not measured, because a first visit would have written new files into .next. |
| Cached reads and their lifetimes | 85 'use cache' functions: 71 calls of cacheLife("hours"), 5 days, 2 with none (15 min default), 0 'use cache: remote' | rg over src without tests, and scratchpad/work/sd/nolife.mjs for the two without a life. |
| Shell lifetimes in the build | 668 prerendered entries at 1h; 6 at 15m (store home and All products in 3 markets); 2 at 1m | Route table of scratchpad/m/build.log (lines 1163-1165, 1410-1412 for the 15m rows). |
| Stores with shells made at build | 1 (the template store); the fallback shell for any other store is 0 bytes | ls of .next/server/app/s: demo/* has HTML, [store]/[market].html is empty; prerenderedShops() in src/server/shop.ts:94-101. |
| Commits that deploy, 11 Nov 2026 | 48 of 74 commits touched code | git log --name-only for that day (the clone is shallow: 10-11 Nov only); CLAUDE.md says each such push deploys. |
| Production calls per day of reads that are 'cached for hours' | store slug by id 7,181; ui_translations 3,569; ai_providers 3,046; terms 1,677; every published page with content 1,023; Kaizena Flow's own header and footer reads 540-900 each | Calls in scratchpad/m/prod-db-stats.md divided by its 78 days. |
| listPublishedPages() call sites | 37; at least 9 keep one page of the list; production returns 29 rows a call | rg 'listPublishedPages(' and '.find(' over src without tests; rows and calls from prod-db-stats.md. |
| Proxy runs per page view | at least 12 on the store home (1 document + 11 prefetches); 43-51 on cart and checkout | requests.byKind in scratchpad/m/routes.json. |

## Well made, and should stay

- A warm prerendered home page, store page or empty cart makes no database read of its own: in the counters only the proxy's tables moved (measured).
- Chat, referral capture, consent and running tests are decided in the cached shell, not per request: their tags are on the shell (.next/server/app/s/demo/no.meta, x-next-cache-tags).
- getProduct() runs its seven follow-up reads together (src/server/catalog.ts:413-457), and a menu's four reads run together (src/components/store-layout.tsx:71-76).
- The cart count and the signed-in customer cost nothing without a cookie (src/server/cart.ts:545-546, src/server/customers.ts:455-456).
- A store's own page is found by one row, not from the list (findPublishedPage, src/server/pages.ts:683-708), and a store's menus take page titles in SQL (publishedPageNames, pages.ts:715-736).
- Stock is the one catalogue fact read per request by design, and the rule is written (docs/rules/storefront.md:110-114).
- The proxy's A/B reads run only for visitors who carry the kaizen_ab cookie (src/proxy.ts:152), and its held-domain read is kept 30 s (src/server/holding.ts:18).
- Font stylesheets are served immutable for a year (src/app/api/fonts/css/[slug]/route.ts:44).
- Checked and not a server cost: routes.json shows 10,288 RSC requests for one product link on a category page and 5,449 on search, but the repeats have transfer 0 (the browser's cache). The loop itself belongs to the client dimension.

## Findings

### SD-1 Three imports pull most of the server into the proxy and into every storefront page

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.8.
- **Where:** `src/proxy.ts:3-16`, `src/server/holding.ts:9`, `src/server/house-switch.ts:8-11`, `src/server/customers.ts:17`, `src/lib/two-step.ts:13`, `src/db/client.ts:11`, `.next/server/middleware.js`
- **Evidence:** A walk of value imports from src/proxy.ts reaches 1,311 modules, 20.6 MB of source: 483 of 795 server files, 813 of 1,145 lib files and the whole schema. Built, the proxy loads 18 chunks (9.96 MB) at start; their source maps name 135 admin catalogue files, all four language files, Supabase's client and opentype.js. Loading .next/server/middleware.js in a fresh node process took 848, 861 and 856 ms and added 167 MB; next/server + pg + drizzle + zod alone take 116-168 ms and 34 MB. The chains: proxy -> holding.ts -> auth.ts (for audit(), used by a writer the proxy never calls) -> two-step.ts -> admin-text.ts -> every admin catalogue; proxy -> house-switch.ts -> pages.ts -> visibility -> customers.ts -> privacy-erasure.ts -> checkout, retention, follow-ups, owner-tools. The store layout reaches 1,466 modules; without the single import customers.ts -> privacy-erasure.ts it reaches 1,011; without that, admin-text.ts and schema.ts, 872 (the proxy: 702).
- **Cost today:** About 0.85 s and 167 MB each time a proxy instance starts cold (measured on this machine), before any page on any host, fully static pages included. One store home view runs the proxy at least 12 times. A cold page function loads the same knot (page.js alone took 395-409 ms, a lower bound). Paid by: A shopper's first byte; the server's memory and compute.
- **Fix:** 1) customers.ts stops importing eraseSubject at the top (the admin's delete path imports it, or it is imported inside the function). 2) two-step.ts gets its few sign-in words without admin-text.ts. 3) drizzle() is created without the schema (FD5). 4) The proxy's five reads (store facts, site switch, holding, private gate, running tests) move to leaf modules that import only the database client and pure lib; the writers stay where they are. 5) A graph test in the style of pay-routes.graph.test.ts: proxy.ts may not reach auth.ts, pages.ts or admin-text.ts, and the module counts of the proxy and the store layout may only fall.
- **Saving:** Estimate from the two local timings: proxy cold start from about 0.85 s to about 0.2 s and about 130 MB less. Measured by the walk: the store layout's graph falls 40% in modules and 48% in source with the three cuts. Production milliseconds were not measured.
- **Risk:** Low to medium. These are moves, not changes of behaviour, but server-only modules are tightly knit; proxy.test.ts and the address e2e tests cover the proxy's answers.
- **Already tracked:** Partly. FD5 / step 3.14 (Open) drops the schema import. Steps 3.13 (domain folders) and 4.1 (lint boundaries), both Open, do not name start-up weight or the proxy.

### SD-2 A product page asks the database about 18 times per view; one answer changes per view

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.3.
- **Where:** `src/components/product-parts.tsx:691-698`, `src/components/product-parts.tsx:996-1019`, `src/server/express-checkout.ts:59-66`, `src/server/express-checkout.ts:153-157`, `src/server/connect.ts:476-479`, `src/server/stock-requests.ts:79-86`, `src/server/producer-registrations.ts:107-114`, `src/server/price-breaks.ts:17-18`, `src/server/quote-requests.ts:64-67`, `src/db/client.ts:68`
- **Evidence:** Measured on the local production build, warm, one anonymous GET of a prerendered product (/s/demo/no/p/demo-keramikkopp): 19 and 18 statements committed, 2 of them the proxy's. Tables read twice in one view: inventory_levels, inventory_locations and inventory_reservations +8 each (stock is read by the buy part and again by the JSON-LD section), platform_settings +2 (getCheckoutUi() in expressOn() and in klarnaMessaging()), countries +2, vat_rates +2, shipping_rates +4, checkout_providers +2 (getCheckoutInfo() twice). Also per view: automations (back in stock), order_settings (quote mode), checkout_fields, payment_methods, stripe_accounts, price_breaks (for guests too). Two reads run alone first (blocked schemes at :997, quote mode at :1001). The pool holds 5 connections, so the 14 parallel reads queue. In production automations, price_breaks, checkout_fields and producer_registrations have never held a row.
- **Cost today:** About 16 statements beyond the proxy's per product view, in about 3 rounds through a 5-connection pool. It grows one for one with traffic. Paid by: The server and the database per request; the shopper waits on 'Checking stock' for the buy button.
- **Fix:** Read stock once per request (perRequest() exists) and hand it to both parts. Put what only the owner changes into one cached read per store and market, refreshed by the payment and settings writers: checkout UI, payments on and provider, the account, method choices and states, checkout fields, quote mode, back in stock on, whether the store has price breaks or producer schemes. Then a view asks only for stock, plus the buyer's own prices when signed in. For producer blocks (D342 reads per request because a registration lapses at midnight): skip the read when the store has no scheme, else cache until the store's next midnight, as campaignNotices() already times its life.
- **Saving:** Estimate: from about 16 to 1-3 statements per anonymous product view.
- **Risk:** Medium. A payment switch or webhook that misses its tag would show a pay button that cannot pay; checkout itself still checks. D373's per-shopper parts (signed in, buyer kind) stay per request, read from cookies.
- **Already tracked:** No. FF4 / step 3.8 (Open) covers the cart's and checkout's reads only.

### SD-3 Every deploy empties the caches and nothing warms them, so most real visits are cold

- **Kind:** no check. **Effort:** S. **Confidence:** medium. **Step:** 2.7.
- **Where:** `src/server/shop.ts:94-101`, `src/app/s/[store]/[market]/layout.tsx:47-49`, `scripts/await-deploy.mjs:53-56`, `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:600-605`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:251`, `docs/performance.md:84`
- **Evidence:** Only the template store is prerendered at build; the fallback shell for any other store is a 0-byte file (.next/server/app/s/[store]/[market].html), so its first visit after a deploy is drawn whole at request time. Next's guide says cached entries and prerenders 'are scoped to a single deployment' and that the plain 'use cache' store is 'per-instance, in-memory ... ephemeral on serverless'; no read here uses 'use cache: remote'. On 11 Nov, 48 of 74 commits touched code. await-deploy.mjs waits for /api/health and two API refusals, then stops. docs/performance.md:84 records a page that took 3.1 s to answer while a deploy went live. Production agrees: reads that are 'cached for hours' run 540 to 1,700 times a day each.
- **Cost today:** After each deploy the first visitor to each page of 59 stores waits for a cold function start plus about 30-35 statements (SD-5). Traffic is thin (102 orders in all), so a large share of real visits are such first visits. Not timed in production. Paid by: Shoppers (first byte), and owners looking at their store after a change.
- **Fix:** When /api/health reports the commit, the deploy job requests the front page and the All products page of each open store's markets (from the stores' sitemap), with a robot user agent so no visit is counted, skipping private stores. That is a few hundred requests per deploy. Batching pushes would cut the number of cold starts further; that part is the owner's choice and D5 can stay as it is.
- **Saving:** Estimate: the cold first view of each main page after each deploy (1-3 s) moves from a visitor to the deploy job.
- **Risk:** Low. More requests per deploy; the warm-up must not count as visits or reach private stores.

### SD-4 ✓ Every published page is read whole to pick one page or a few titles

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 0.6.
- **Where:** `src/server/pages.ts:664-680`, `src/server/pages.ts:797-800`, `src/server/pages.ts:859-863`, `src/app/s/[store]/[market]/page.tsx:28-30`, `src/server/legal-links.ts:24-26`, `src/components/site-chat.tsx:107-112`, `src/server/checkout-terms.ts:46`, `src/server/platform-navigation.ts:135-141`, `src/server/media-alts.ts:51-55`
- **Evidence:** listPublishedPages() selects the whole published document of every published page of an owner, parses each with zod, and looks up every picture of every page in media (withPageAlts). It has 37 call sites. At least 9 then keep one page (.find by id): the front page, All products, a role page, the chat's privacy link, a blog's listing page. Legal links, checkout terms and the product page's back link need titles and addresses only. Kaizena Flow's own header reads all its pages and all its articles this way to name menu links, while a store's header uses publishedPageNames(), which takes titles in SQL. Production: 79,778 calls, 29 rows a call, 9.8 ms mean, 781 s in all, second in total time after the cron calls; media has 43,240 sequential scans.
- **Cost today:** 9.8 ms and about 29 documents per cold fill, 1,023 fills a day: the app's largest read by total time. Paid by: The database and server CPU on every cold render; the shopper's first byte on a cold visit.
- **Fix:** Add publishedPageById(owner, id): one row, cached under the pages tag, for the callers that keep one page. Use publishedPageNames() for legal links, terms, the back link, the privacy link and the platform's menus. Keep listPublishedPages() for the sitemap and llms.txt, selecting only what they print.
- **Saving:** Estimate: over 90% of that statement's 781 s and of its media lookups; a cold home page parses 1 page, not about 29.
- **Risk:** Low. The same data through narrower reads; A/B versions keep working on the one page.

### SD-5 A cold page waits on reads one after another before its first byte

- **Kind:** eager. **Effort:** S. **Confidence:** medium. **Step:** 2.3.
- **Where:** `src/app/s/[store]/[market]/layout.tsx:108-128`, `src/app/s/[store]/[market]/layout.tsx:166`, `src/server/site-layouts.ts:33-60`, `src/server/site-cookies.ts:35`, `src/server/site-cookies.ts:44-49`, `src/server/site-cookies.ts:89-121`, `src/app/s/[store]/[market]/page.tsx:24-31`, `src/app/s/[store]/[market]/page.tsx:68`
- **Evidence:** Traced for a store's home page with no shell (an estimate, not measured). In order: the instance start reads ui_translations; the proxy reads the store's facts; the layout reads the store (1 statement, 8 subqueries), then header, footer and legal links together, each 2-3 deep (layout row, then media alts, then site tests; all pages, then media alts), then text styles alone (awaited inline at :166). Only then can <html> be sent. After that: menus (4 together), fonts (2), chat (3-4), referral (1), consent with 8 statements strictly in a row (the store's features a second time, chat agent, the modal scan, referral site, recommendations, experiments, the last scan, notes), running tests; then the page: all pages for the front page, tests, products and campaigns together, grids. The store's own row is thus read by the proxy, by the layout and again by siteCookies() in one request.
- **Cost today:** Estimate: 30-35 statements per cold page, at least 6 sequential waits before the first byte, 8 in a row for consent alone. Paid by: The shopper's first byte on a cold visit; the database.
- **Fix:** In the layout start text styles, site tests and the page names in the same Promise.all as header and footer (:123). siteCookies() takes features and visitCounting from the store its caller already holds and runs its other reads together. One cached read answers the four questions about experiments. The page starts its front page, products and campaigns together.
- **Saving:** Estimate: sequential waits before the first byte from about 6 to about 3; consent from 8 in a row to one wave; 3-4 fewer statements.
- **Risk:** Low.
- **Already tracked:** No. FF2 and FF5 / step 3.9 (Open) already cover the whole-catalogue read for the home page's JSON-LD and the product index in metadata; they are not repeated here.

### SD-6 The proxy asks the database before most page views, static pages included

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.8.
- **Where:** `src/proxy.ts:55-59`, `src/proxy.ts:71`, `src/proxy.ts:109`, `src/server/redirect-resolve.ts:203-231`, `src/server/house-switch.ts:30-43`, `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29`
- **Evidence:** The matcher takes every page on every host. A store's facts are kept 10 s per instance (FACTS_MS) and so is the site switch. Measured: each view more than 10 s after the last one read stores, markets (twice) and store_currencies; on Kaizena Flow's own host platform_settings too. /, /blog/welcome, /themes and /docs each cost one platform_settings read per view, though / is fully static. At 60 stores' traffic a 10 s memory rarely holds. Next's guide: 'Proxy is not intended for slow data fetching'. Prefetches run the proxy too: 11 on a store's home, 42-50 on cart and checkout.
- **Cost today:** 1-2 statements and a pooled connection in front of the cached shell on most views; the first byte waits for them. Paid by: The shopper's first byte; the database.
- **Fix:** Answer from memory and refresh in the background (event.waitUntil) once the 10 s have passed; block only when the instance knows nothing of the store; cap the age (for example 60 s). Read the site switch in the same statement. Later these few facts can live in Edge Config, written by the writers that already call forgetStoreFacts().
- **Saving:** Estimate: the blocking read goes from most views to an instance's first view of a store.
- **Risk:** Low to medium. A change of address shape (D181) or of private mode (D339) is seen one request later per instance than today. Keep the hard cap, and keep blocking for a store last known to be private, so the rule's reason holds.

### SD-7 ✓ Every instance starts by reading an empty table, then polls it each minute

- **Kind:** ahead of use. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Where:** `src/instrumentation.ts:6-10`, `src/server/ui-text.ts:59-63`, `src/server/ui-text.ts:92-116`
- **Evidence:** register() imports ui-text.ts (383 modules and 7.6 MB of source by the import walk; a 2.4 MB chunk) and awaits startUi() before the instance takes a request; a timer repeats the read each minute. Production: 'select lang, count(*) ... from commerce.ui_translations group by lang' ran 278,393 times in 78 days, the second most called statement, and the table has never held a row. Measured here: register() took 526, 567 and 574 ms and 106 MB in a fresh process.
- **Cost today:** About 0.5 s per cold instance (local) and 3,569 statements a day, for interface languages translated by AI that no store has. Paid by: The first shopper or owner on each new instance; the database.
- **Fix:** Do not await at start. Load a language when a page first asks for one that is not hand-written (isBuiltIn(lang) is false): the market layout and the email senders await ensureUi() then (the emails already do). No timer while no such language exists. Split the reader from the platform admin's translating tools, so the import is small.
- **Saving:** Estimate: about 0.5 s off each cold start; 278,000 statements per 78 days gone.
- **Risk:** Low to medium. t() is synchronous, so a language that is not built in must be awaited before its first draw; a test should draw such a page in a fresh process.

### SD-8 Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.7.
- **Where:** `src/server/content-grid.ts:162-168`, `src/server/campaign-notices.ts:182-188`, `src/server/campaign-notices.ts:150-153`, `src/server/pages.ts:665-667`, `src/server/stores.ts:217-219`, `node_modules/next/dist/docs/01-app/01-getting-started/09-revalidating.md:195`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:141-144`
- **Evidence:** Of 85 cached functions, 71 set cacheLife("hours") (made again after 1 hour) and 2 set none (ownerSells, campaignNoticesAt), which gives the default of 15 minutes. The build log shows it: 668 prerendered entries at 1h, and the store home and All products at 15m. A shell is made again at the shortest life inside it, so each visited page is redrawn hourly and the two most visited every 15 minutes, although writers refresh the tags. Next's guide: for content its author changes, 'use cacheTag and a long cacheLife like max ... This reduces unnecessary time-based revalidation'. campaignNotices() caps its life at 3,600 s even with no campaign, and campaigns has never held a row.
- **Cost today:** Up to 24 redraws a day per visited page (96 for home and All products), each a cold fill of about 30 statements on a fresh instance. Paid by: The server and the database. No visitor waits: the old shell is served meanwhile.
- **Fix:** Give the two functions a life. Define one named profile in next.config.ts (for example 'tagged', made again after 7 days) and move to it the reads whose writers refresh their tag: stores first (store-writers.scan.test.ts already holds those writers), then pages, terms, fonts and text styles. Reads that depend on the clock keep their own; campaigns with no start or end ahead take the long one. A scan test: every 'use cache' sets a life and a tag.
- **Saving:** Estimate: background redraws fall from per hour to per change. Today much of the gain comes at night and on quiet days, because deploys already empty the caches (SD-3).
- **Risk:** Medium. A writer that misses its tag leaves a page stale for days, not for an hour: extend the writers' scan to pages and the catalogue before lengthening those.
- **Already tracked:** No. FF3 / step 3.10 (Open) is about finer tags, not lifetimes.

### SD-9 Pages ask about features no store uses

- **Kind:** ahead of use. **Effort:** M. **Confidence:** medium. **Step:** 2.3.
- **Where:** `src/server/site-cookies.ts:52-57`, `src/server/experiments.ts:130-133`, `src/server/experiments.ts:155-158`, `src/server/experiments.ts:178-181`, `src/server/experiments.ts:234-237`, `src/server/campaign-notices.ts:27-56`, `src/server/catalog.ts:383-399`, `src/components/product-parts.tsx:997`, `src/server/stores.ts:232-281`
- **Evidence:** Tables that have never held a row in production and are read on the storefront path: cookie_notes (70,278 reads), campaigns, recommendation_settings, producer_registrations, price_breaks, price_lists, checkout_fields, automations, market_availability, search_rules, search_synonyms, product_market_texts, product_passports. Measured locally per view: price_lists +10 and market_availability +1 scans on a category view; price_breaks, automations and checkout_fields on each product view; search_rules +2, search_synonyms +1 and market_availability +11 per search. A store's experiments are asked four separate ways per page (siteTests, storeHasExperiments, runningExperimentIds, experimentOfPage).
- **Cost today:** Estimate: 8-10 of a cold home page's 30 or so statements and 4 of a product view's 16 answer 'nothing' for every store. Paid by: The database and the server per cold render and per product view.
- **Fix:** Let the cached store carry what it uses: one exists() each inside readStore()'s single statement for campaigns, experiments, cookie notes, recommendations, referrals, price lists and breaks, producer schemes, checkout fields and back in stock. Each reader returns its empty answer without a query when the fact is false. The first write of such a row refreshes the store's tag (refreshStoreById() exists).
- **Saving:** Estimate: the statements above, on every cold page and every product view.
- **Risk:** Medium. A feature's first row must refresh the store's tag, or pages ignore it until the store is next written; the store-writers scan can hold that.

### SD-10 The store is looked up by its id again and again

- **Kind:** duplicate. **Effort:** M. **Confidence:** medium. **Step:** 0.8.
- **Where:** `src/server/stores.ts:190-193`, `src/server/menus.ts:283-288`, `src/server/content-grid.ts:133`, `src/server/content-grid.ts:151-156`, `src/server/content-site.ts:46`, `src/server/field-tiles.ts:176`, `src/server/custom-fields.ts:817`, `src/components/content-grid-section.tsx:70`, `src/components/store-part-section.tsx:84`, `src/components/search-section.tsx:53`
- **Evidence:** 'select slug from commerce.stores where id = $1' is written 27 times in src/server, each followed by getStore(slug). One cached helper exists (storeSlugOf(), 13 uses). Production: 560,090 calls, the most called statement (7,181 a day). On the storefront it runs uncached in per-request parts through storeAndMarket(): each filterable grid, each working page's part, the search part. The drawing code carries only place.owner (an id), though the route that started it holds the store. Which share comes from jobs was not established here.
- **Cost today:** 1 statement per grid or part per view, more per cold fill; 560,090 calls in 78 days in all. Paid by: The database and the server per request.
- **Fix:** One storeById(id), cached under the store's tag, for all 27 places. Better: put the store and market the route already resolved into 'place', so the parts need no lookup at all.
- **Saving:** Estimate: 1-3 statements per view on pages with grids or parts; 27 copies become one.
- **Risk:** Low.

### SD-11 The same shopper facts are read several times in one request

- **Kind:** duplicate. **Effort:** S. **Confidence:** high. **Step:** 2.3.
- **Where:** `src/components/store-layout.tsx:285`, `src/components/store-layout.tsx:576`, `src/components/cart-link.tsx:27`, `src/server/cart.ts:544-556`, `src/server/customers.ts:454-463`, `src/components/product-parts.tsx:935`, `src/components/product-parts.tsx:946`, `src/components/product-parts.tsx:1006`, `src/server/express-checkout.ts:63`, `src/server/request-memo.ts:13-20`
- **Evidence:** The cart link is drawn twice (header and phone bar) and each runs getCartCount(), so a shopper with a cart costs two identical counts on every page. getCustomer() runs a session query on each call, and a product page calls it up to five times for a signed-in shopper (buy part, member notice, back-in-stock offer, express check, quote). perRequest() exists and is used only by the cart, checkout and order pages. Read from the code; not measured with cookies.
- **Cost today:** 1 extra statement per view for a shopper with a cart; up to 4 extra on a product page for a signed-in shopper. Paid by: The database per request; the shoppers closest to buying.
- **Fix:** Wrap getCustomer() and getCartCount() in perRequest() (or React's cache), so each runs once per request.
- **Saving:** Those statements, on every page a shopper with a cart or an account opens.
- **Risk:** Low.

### SD-12 Whole rows and documents are read for one fact

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.3.
- **Where:** `src/server/fonts.ts:176-182`, `src/server/ai.ts:206-211`, `src/server/chat-agent.ts:93`, `src/server/page-modals.ts:16-27`, `src/server/site-cookies.ts:44-48`
- **Evidence:** fontPreloadFile() reads a family's whole stylesheet to find one file name ('select css from commerce.fonts', 42,211 calls). aiFor() runs 'select *' on ai_providers, keys included, where the chat button needs only 'is there a text model' (237,563 calls over four shapes, jobs included). getChatAgent() runs 'select *' on chat_agents, instructions included, for a name and a greeting. usesRememberedModals() runs jsonb_path_exists over every published page to get one yes or no (68,878 calls, 121 s).
- **Cost today:** 121 s of JSON scanning in 78 days, and wider rows than needed on every cold fill. Small beside the findings above. Paid by: The database per cold render.
- **Fix:** Keep the preload file name in a column written when the font is installed. Give the widget a two-column read (or a hasAi(storeId)). Set a flag when a page with such a modal is published.
- **Saving:** The modal scan goes; the other reads shrink to a few bytes. Small.
- **Risk:** Low.

### SD-13 The browser's side has budgets; the server's side has none

- **Kind:** no check. **Effort:** M. **Confidence:** high. **Step:** 1.2.
- **Where:** `docs/performance.md:34-37`, `docs/performance.md:110-113`, `src/lib/pay-routes.graph.test.ts:1-40`, `e2e/performance.spec.ts:40`
- **Evidence:** First scripts have a byte budget per route and a scan keeps zod out of visitors' scripts. Nothing counts what a request costs on the server: no test for the proxy's import graph (1,311 modules), for a page's statements per view (18 on a product page), or that a cached read sets a life and a tag (2 set no life). The import walk and the statement count used in this review are each a few lines, in the style of tests the repo already has.
- **Cost today:** No bytes today. It is why SD-1, SD-2 and SD-8 could grow unseen. Paid by: Everyone later: shoppers, the server, the database.
- **Fix:** Three checks in the house style. A graph ratchet for src/proxy.ts and the store layout: the module count may only fall. An integration test that draws home, product, category and cart against the seeded database and holds statements per view to a budget, counted in the execute wrapper of src/db/client.ts. A scan that every 'use cache' sets cacheLife and cacheTag.
- **Saving:** Keeps the savings of SD-1, SD-2 and SD-8 from growing back. No direct saving.
- **Risk:** Low.
- **Already tracked:** No. ratchet.scan.test.ts (step 1.2, Done) ratchets unchecked reads and casts, not graphs or statements per view.
