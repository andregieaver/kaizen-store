# Caching and rendering (CA)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** The caching code itself is not bloated: 85 cached reads, 82 of them tagged, tags per store, and Kaizena Flow's own site and the docs are truly static. The waste is in how it meets the platform it runs on. Every store page view still runs a function that sends the whole page again (98 KB of 138 KB on the demo home) to place two cart badges; cached reads live in one instance's memory and die with each deploy, and there were 101 commits in the last two days; links prefetch pages nobody opens (510 KB on a cart page, 32 to 46 requests per admin screen). At 60 stores and 102 orders the bill is small today (the costliest app query used 781 s of database time in 78 days), but every item here grows with each page view and each deploy.

## Measured

| Measure | Value | How |
|---|---|---|
| Cached reads ("use cache") | 85 directives in 52 files. Lifetimes: 70 "hours", 4 default (15 min), 4 "days", 3 "minutes", 1 seconds-or-days, 3 inline. 82 tagged, 3 untagged (brreg, listCountries, storeSlugOf). 0 "use cache: remote", 0 unstable_cache. | rg for the directive in src without tests, then a node script (scripts/ca-usecache.mjs) that reads the cacheLife and cacheTag lines under each |
| Tags and refreshes | 37 tag names; 407 refresh call sites (updateTag, revalidateTag, refreshTag, staleTag); 57 of them refresh catalogTag(store); 535 refresh() calls in 248 files; 4 revalidatePath | rg counts in src without tests |
| Prerendered routes | 772 routes: 464 docs, 149 demo store, 112 admin shells, 35 site, 6 api, 6 theme store. 545 dynamic route patterns. Build: 1,426 pages generated in 28.9 s on 3 workers; whole build 263 s, machine peak 7.6 GB | .next/prerender-manifest.json grouped by path; build.log and build-summary.txt in /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m |
| Routes that need a function on every request | 262 of 772 prerendered routes are "resuming": all 148 demo store pages, 110 admin shells, /themes and /get-domain in both languages. 508 are static (the platform site, 462 docs routes). 136 dynamic patterns (every store route for a store other than the demo) have no fallback shell and block on first visit. | compute, response and fallback fields of prerender-manifest.json |
| Demo store home page: static part against per-request part | Static shell 40,564 bytes with no flight data. Served document 138,523 bytes. 97,959 bytes come from the function on each view, 96,691 of them the RSC payload. Visitor-specific HTML in it: 829 bytes (cart link twice, country hint). | .next/server/app/s/demo/no.html against the harness capture html/store-home.html and routes.json; hidden S: segments measured with node |
| What makes store pages dynamic | Home, built pages, blog: cookies() for the cart count (twice) and headers() for the country hint (stores with several countries). Product: plus connection() for stock, buy box and JSON-LD. Listings and search: searchParams. Theme store list: searchParams. Admin: cookies (sign-in). | Suspense holes located in the prerendered HTML and matched to components; rg for cookies(), headers(), connection(), searchParams |
| Resume data carried by each prerendered store page | 25 cached entries, 33,454 bytes raw (13.6 KB packed) on the demo home; largest: the store 8,556 bytes, a product grid 5,759. Every key ends with the build id. | inflated the postponed field of .next/server/app/s/demo/no.meta; compared with .next/BUILD_ID |
| Prefetch requests after load, visitor does nothing | Store pages 11 to 50 requests, 32 to 189 KB; admin screens 23 to 46 requests, 77 to 156 KB; platform site 0 to 9 | evidence/routes.md and routes.json (Chromium against pnpm start) |
| Link prefetch settings in source | 400 files import next/link; 4 links set prefetch={false}; 0 set prefetch={true}; partialPrefetching unset in next.config.ts | rg in src; next.config.ts:41-42; warning in build.log lines 6-12 |
| Production: cached reads that still ran (78 days) | All published pages with content 79,778 calls (29 rows a call, 781 s); cookie scans 70,257; platform settings 53,887; font css 42,211. Uncached tiny reads: store slug by id 560,090; ui_translations poll 278,393; ai_providers 237,563; AI pause flag 69,075. | evidence/prod-db-stats.md; each SQL text matched to its function in src by rg |
| Deploy cadence | 101 commits in two days (27 on 10 Nov, 74 on 11 Nov across 16 hours); 72 of the last 100 touch code. Every push to main gets its own deploy. | git log (shallow clone, two days only); .github/workflows/ci.yml:27-32 |
| HTTP caching of same-for-everyone answers | Good: /sitemap.xml, /llms.txt, /docs (s-maxage 3600, HIT), product feeds (s-maxage 900), font css and files (1 year, immutable), og cards (1 day). No Cache-Control: /s/{store}/robots.txt, store-sitemap.xml, llms.txt, blog/feed.atom. Favicons: 302 with max-age only. | curl -D against the local production server for 27 addresses; Cache-Control read in 153 non-admin, non-cron route handlers |
| The dispatcher's "cache" job | Refreshes nothing. It deletes rows of commerce.search_cache (kept AI search answers) older than 30 days, 288 times a day; last run 53 ms. | src/app/api/cron/cart-reminders/route.ts:144; src/server/search-cache.ts:78-83; prod-db-stats.md |

## Well made, and should stay

- Tag discipline: 82 of 85 cached reads carry a tag, almost all per store (store:, pages:, catalog:, terms:, fields:, cookies:, chat:, experiments:, recommend:, campaigns:). The global "catalog" tag is refreshed only by VAT changes (src/server/vat-admin.ts:39, 345, 372). That one product save refreshes the whole store's catalogue is already step 3.10 (FF3, Open) of docs/audits/code-review-2026-11.md, so it is not repeated as a finding.
- Kaizena Flow's own site and the docs are truly static: /, /blog, /sign-up and 462 docs routes are compute "static" in the manifest, answer s-maxage=3600 with stale-while-revalidate, and carry their flight data in the HTML (measured: / is 39,845 bytes, cache HIT, no function).
- The store layout awaits params above any Suspense (src/app/s/[store]/[market]/layout.tsx:105). Next's ISR guide says this is what creates a kept page per address while Partial Prefetching is off. Correct for the current setting.
- refreshTag() (src/server/refresh.ts:10-16) uses updateTag in an action and falls back to revalidateTag(tag, "max") elsewhere, as Next's docs describe. The dispatcher refreshes tags only for the stores whose schedules, themes or alt texts changed (src/app/api/cron/cart-reminders/route.ts:262-278).
- The proxy reads no database row per request: a store's facts are remembered 10 s per instance (src/server/redirect-resolve.ts:203), and redirects are looked up only when a request would be a 404.
- Arguments of cached functions are ids, slugs and the small Market object (10 fields). No whole Store object is passed into a cached function.
- Stock, the tiles' facts (/api/shop/tiles), the wishlist and recommendations answer no-store by written rule (D172, D557). Right: they are per visitor or change by the minute.
- HTTP caching is well set where it was thought about: product feeds (s-maxage 900, stale-while-revalidate), font stylesheets and files (one year, immutable, versioned address), share cards (one day), the fonts catalogue and the API catalogues (one hour).
- commerce.search_cache keeps AI search answers in the database for 30 days, which is the right tool for a cache that must outlive an instance and a deploy.
- No link uses prefetch={true}, so switching Partial Prefetching on later has no legacy full prefetches to migrate.
- Demo store pages are prerendered per market with their product, category and page addresses, and docs Markdown twins are static (209 SSG paths). They cost build time only.

## Findings

### CA-1 ✓ Every store page view runs a function that sends the whole page again, for two cart badges

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.2.
- **Where:** `src/components/cart-link.tsx:26`, `src/components/store-layout.tsx:285`, `src/components/store-layout.tsx:575`, `src/components/site-parts.tsx:178`, `src/components/country-hint-section.tsx:18`, `src/app/s/[store]/[market]/layout.tsx:207`, `src/components/wishlist-heart.tsx:24`, `src/app/s/[store]/[market]/wishlist/saved/route.ts:9`, `.next/prerender-manifest.json`
- **Evidence:** The prerender manifest marks all 148 prerendered store pages compute "resuming" (a function on every request); / is "static". Demo home: the static shell (.next/server/app/s/demo/no.html) is 40,564 bytes and holds no flight data. The served document is 138,523 bytes. The 97,959 bytes between come from the function on each view; 96,691 of them are the page's RSC payload. The HTML that depends on the visitor is 829 bytes: the cart link in the header (389), the cart link in the phone bar (434) and the country hint (6, empty). CartLink reads the cart cookie; CountryHintSection reads headers(). After load the page also fetches /wishlist/saved (a 15-byte answer, private no-store): a second function run.
- **Cost today:** Per store page view: one render function run that makes and sends about 98 KB (home page), one more function run for the wishlist fetch. The proxy runs as well. Paid by: The server per request; the shopper's browser, which waits for the stream before the page wakes up.
- **Fix:** Give the cart count to the browser the way the wishlist hearts already get theirs. Turn /wishlist/saved into one small "mine" answer (saved ids and cart count), asked only when a marker cookie says the visitor has a cart or a wishlist. CartLinkShell already draws the link without a count. Put the country hint in the same answer. Then the home page, built pages, blog pages and unfiltered listings have no holes and are served whole from the CDN, as / is. Product pages keep their stock hole (the written rule).
- **Saving:** Measured on the demo home: 98 KB of 138.5 KB no longer rendered and sent per view. Function runs per page view fall from 2 to 0 for a visitor with no cart or wishlist and from 2 to 1 for the rest (estimate; the split of visitors is not known).
- **Risk:** A shopper with a cart sees the count a moment after load. The httpOnly cart cookie rule holds: the endpoint reads it on the server and the marker says only yes or no. The count must still update after a cart action. If Kaizena Flow's site is served from its own store (D484), its pages gain the same way; production was not checked.

### CA-2 Cached reads live in one instance and one deploy, and the site deploys many times a day

- **Kind:** no check. **Effort:** M. **Confidence:** medium. **Step:** 2.7. **The owner's decision.**
- **Where:** `.github/workflows/ci.yml:27`, `src/server/shop.ts:94`, `src/server/stores.ts:216`, `next.config.ts:42`, `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:600`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:259`
- **Evidence:** Next's guide: a "use cache" result stays "in a per-instance, in-memory store that is ephemeral on serverless", and all stores "are scoped to a single deployment". Measured: every cache key in the demo home's resume data ends with the id in .next/BUILD_ID. src has no "use cache: remote" and no unstable_cache. Only the demo store is built ahead (prerenderedShops). The 136 other dynamic patterns, every store route among them, have fallback null and compute "blocking", so the first visit to each page of the 59 other stores after each deploy waits for a full render: 25 cached reads on the demo home. git log: 101 commits in two days, 72 touching code, and ci.yml gives every push to main its own deploy. Production, 78 days: reads cached "for hours" ran 79,778 times (all published pages), 70,257 (cookie scans), 53,887 (platform settings), 42,211 (font css).
- **Cost today:** First visit to any real store's page after a deploy: a blocking render with 25 or more database reads (count from the demo home; time not measured). 540 to 1,020 cold runs a day of each of those reads (counts divided by 78). Each deploy rebuilds 772 prerendered routes (1,426 pages; the build took 263 s here). Paid by: Shoppers of real stores (first view), the database, the build.
- **Fix:** 1) Let pushes share a deploy: keep pushing to main, but let the deploy step skip when a newer commit is waiting, or deploy at most every N minutes. 2) Put "use cache: remote" on the one or two reads every request-time path needs (loadStore, the platform's loadSettings) and measure the hit rate before going further. 3) Write in docs/rules/storefront.md what "cached" means here (one instance, one deploy), so new code does not lean on it.
- **Saving:** Not measured. Each deploy skipped saves one build and keeps every store's built pages and cached reads alive until the next one.
- **Risk:** D5 says a push to main deploys. Sharing deploys delays a change by minutes; it does not end testing in production. A remote cache adds a network lookup per read and platform fees; Next's docs say it pays only at a high hit rate.
- **Already tracked:** Partly. Step 1.8 (FH10, Open) of docs/audits/code-review-2026-11.md covers the build's memory and building once; step 0.2 (FH1, In progress) the deploy gate. Neither covers what a deploy does to the caches.

### CA-3 ✓ To read one page, the code loads every published page with its whole content

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 0.6.
- **Where:** `src/server/pages.ts:664`, `src/server/pages.ts:799`, `src/server/pages.ts:862`, `src/server/legal-links.ts:24`, `src/app/s/[store]/[market]/layout.tsx:127`, `src/app/s/[store]/[market]/page.tsx:29`, `src/server/platform-navigation.ts:138`, `src/server/seo.ts:465`, `src/server/seo.ts:687`
- **Evidence:** listPublishedPages() selects the published JSON of every published page of an owner and keeps the list as one cached value. It has 36 call sites. Nine are (await listPublishedPages(x)).find(...) for one page. The store layout reaches it through legalLinksFor() for four or five titles, so the list is in every store page's cached data. Kaizena Flow's header and footer (getPlatformChrome) load all pages and all articles for their titles. robots.txt and the sitemaps load them for a slug, a date and one flag. Production: 79,778 calls, 2,334,038 rows (29 a call), 9.8 ms mean, 781 s in 78 days: the app's most expensive query. The pages table is 9.1 MB for 1,389 rows.
- **Cost today:** About 29 page documents read and parsed per cold call; at most about 190 KB of JSON a call (9.1 MB / 1,389 rows x 29, an upper bound: the table also holds drafts). 10 s of database time a day. Paid by: The database; the server on each cold render; each built store page, whose resume data carries the list.
- **Fix:** Add two reads beside it: publishedPageById(owner, id), cached per page, and publishedPageHeads(owner, type) with id, slug, title, translated titles, publishedAt and the aiAssistants flag. Move the nine find-by-id callers, legalLinksFor, getPlatformChrome, robots, the sitemaps and generateStaticParams to them. Keep listPublishedPages for the few places that draw every page.
- **Saving:** Estimate: over 90% of the bytes this query reads. The resume data of every store page shrinks by the size of the list.
- **Risk:** Low. Same tag (pagesTag), same rows. A page that is drawn must still get its picture alt texts (withPageAlts).
- **Already tracked:** no. Step 3.9 (FF2, FF5, Open) is the same pattern for products, not pages.

### CA-4 ✓ Language and currency links prefetch whole front pages that their click never opens

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Where:** `src/components/view-menu.tsx:56`, `src/components/view-menu.tsx:62`, `src/components/store-layout.tsx:212`, `src/components/language-links.tsx:84`, `evidence/routes.json`
- **Evidence:** ViewMenu draws each language and currency as a next/link to that view's front page, but its click handler cancels the link and goes to the page the shopper is on. So the router prefetches a page the click does not open. Measured on the demo's empty cart page at phone size: 42 prefetch requests, 625,516 bytes decoded, 184 KB on the wire. 509,776 of the decoded bytes are the six views' front pages (no-sv, no-da, no-en, no-sek, no-dkk, no-eur: 3 requests and about 85 KB each). On the About page: 339,523 of 444,739. Those views are not built ahead, so each first prefetch renders that front page on the server. The newer LanguageLinks uses a plain <a> and does not prefetch.
- **Cost today:** Up to about 510 KB decoded and 18 requests per page view where the footer's list is on screen (short pages, or any page scrolled to its end), plus up to six page renders on a cold cache. Paid by: The shopper's browser (phone data); the server per request.
- **Fix:** prefetch={false} on ViewMenu's link, or a plain <a> as LanguageLinks has.
- **Saving:** Measured: 81% of the prefetch bytes on the cart page (509,776 of 625,516) and 18 of 42 requests.
- **Risk:** None seen: the click already moves with router.push to another address.

### CA-5 ✓ Each admin screen prefetches 15 to 22 other screens, and the storefront, on sight

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.9.
- **Where:** `src/components/admin/admin-rail.tsx:47`, `src/components/admin/store-admin-nav.tsx:94`, `src/components/admin/store-admin-nav.tsx:131`, `src/components/admin/store-admin-nav.tsx:195`, `src/app/admin/(gated)/[store]/layout.tsx:132`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:256`
- **Evidence:** Measured signed in as an owner (routes.json): Orders 32 prefetch requests to 15 addresses, 112 KB on the wire; Pages 46 to 22, 160 KB; Settings 44 to 21, 152 KB. Each /admin/{store}/... answer has no Cache-Control: the server computes it, two requests a link. The View store link alone is 4 requests and 62 KB decoded on every screen. Next's doc: an action that calls updateTag or refresh clears the whole client cache, and src has 535 refresh() calls, so the links are fetched again after a save (documented behaviour, not measured here).
- **Cost today:** 23 to 46 requests and 77 to 156 KB per admin screen (routes.md), each a function run in production, for screens the owner mostly does not open next. Paid by: The owner's admin (bytes); the server per request.
- **Fix:** prefetch={false} on View store. For the rail and the store's menu, prefetch when the pointer or focus reaches a link (the hover-prefetch link in Next's prefetching guide) instead of when it is on screen.
- **Saving:** Estimate: 30 to 45 of the 32 to 46 requests per screen. Measured upper bound: 109 to 156 KB per screen.
- **Risk:** The first click on a menu item waits for its shell (about 9 KB) instead of having it ready. Low.
- **Already tracked:** no. PERF-01 in docs/audits/psi-followups.md tracks the admin's scripts, not its prefetches.

### CA-6 ✓ A prefetch loop on listing and search pages at /s/{store} addresses

- **Kind:** eager. **Effort:** M. **Confidence:** medium. **Step:** 0.11.
- **Where:** `src/app/s/[store]/[market]/@drawer/[...rest]/page.tsx:2`, `src/app/s/[store]/[market]/@drawer/default.tsx:2`, `evidence/prefetch-storm.md`, `evidence/routes.md`
- **Evidence:** The measuring pass found the client router asking for one link's @drawer/[...rest]/__PAGE__ segment without stopping on a category page and the search page of the local production build: 2,686 requests in 8 s. routes.md counts 10,358 and 10,950 requests for those two pages, against 38 to 107 for the others. I asked for that segment once with curl: 200, 1,435 bytes, x-nextjs-postponed: 2, though a prerendered file for exactly that segment exists under .next/server/app/s/demo/no/category/hjem.segments. Production on stores' own hosts did not loop when the measuring pass checked.
- **Cost today:** On /s/{store} addresses: about 2,700 requests per 8 s for as long as a listing page is open, each through the proxy. CI's end-to-end jobs run on these addresses. Paid by: CI; the server and a shopper's browser wherever a store is reached at an /s/ address.
- **Fix:** Reproduce with the harness script (work/storm.mjs). Try the drawer slot without its catch-all page (default.tsx already returns null) and with prefetch = 'partial' on the segment. If it is Next's own fault, report it and hold the workaround with an end-to-end test that counts requests on a listing page.
- **Saving:** Measured locally: about 10,300 of 10,358 requests on the category page.
- **Risk:** Low. The cause is not known yet, so the effort may be more.
- **Already tracked:** no. docs/audits/code-review-2026-11.md mentions a test that timed out under load, without this cause.

### CA-7 partialPrefetching is unset: Next treats it as off, warns on every build and start, and will remove the choice

- **Kind:** no check. **Effort:** S. **Confidence:** medium. **Step:** 2.7.
- **Where:** `next.config.ts:42`, `evidence/build.log:6`, `src/app/s/[store]/[market]/layout.tsx:105`, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:44`, `node_modules/next/dist/docs/01-app/02-guides/incremental-static-regeneration-cache-components.md:27`
- **Evidence:** Next's doc: unset behaves like false and logs a warning; both features will be on everywhere in the next major and the option removed. For this app, off means three things. 1) Each link on screen is prefetched by itself: 11 to 50 requests per store page and 23 to 46 per admin screen (routes.md). 2) A first visit to a page not built ahead waits for the whole render: 136 dynamic patterns have fallback null and compute "blocking"; with it on, Next serves a shell at once. 3) A forced move later. No link sets prefetch={true} (rg: 0), so there is no legacy full prefetch to migrate. But the store's root layout awaits params above any Suspense, because <html lang> and the theme come from them, and Next's guide wants URL data read inside Suspense for a shared shell. The admin's 408 dynamic routes already have param-free shells (about 3.6 KB).
- **Cost today:** Today: the prefetch volume of CA-4 and CA-5 and blocking first visits. Later: a migration under time pressure at the next major. Paid by: Shoppers and owners (requests); an agent's session later.
- **Fix:** Do not flip the global flag now. Write partialPrefetching: false so the choice is recorded and the warning goes. Then adopt per segment with export const prefetch = 'partial': the docs and the platform site first (already static), then the admin, measuring prefetch requests with the harness each time. The storefront last, after CA-1, once the root layout's params question is solved.
- **Saving:** None from the flag itself. With adoption, links to the same route share one shell (Next's doc) and a store page not built ahead answers with a shell at once. Not measured on this app.
- **Risk:** Adoption changes what a click shows first. The admin's shells read cookies, so each still needs a server run per route and may not get cheaper; hover prefetch (CA-5) is the sure cut there. The storefront adoption is L and is a separate step.

### CA-8 A store's robots.txt, sitemap, llms.txt, blog feed and favicon are computed on every request with no HTTP cache

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 0.12.
- **Where:** `src/app/s/[store]/robots.txt/route.ts:9`, `src/app/s/[store]/store-sitemap.xml/route.ts:4`, `src/app/s/[store]/llms.txt/route.ts:4`, `src/app/s/[store]/[market]/blog/feed.atom/route.ts:7`, `src/app/s/[store]/favicon.ico/route.ts:7`, `src/app/favicon.ico/route.ts:7`, `src/lib/site-icons.ts:25`
- **Evidence:** The build table marks all of them dynamic. curl against the local production server: no Cache-Control header on /s/demo/robots.txt, /s/demo/store-sitemap.xml, /s/demo/llms.txt and /s/demo/no/blog/feed.atom. Both favicons answer a 302 with public, max-age=3600 (no s-maxage) behind connection(). For contrast: /sitemap.xml and /llms.txt answer s-maxage=3600 and HIT, and product feeds set s-maxage=900. The feed's comment says it is "cached with the store's pages"; that holds only inside one warm instance.
- **Cost today:** One function run per crawler or browser request per store. On a cold instance a sitemap reads the store, its products and terms, and every page and article with content (CA-3). Paid by: The server per request; the database.
- **Fix:** Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400 on the sitemap, llms.txt and the feed; 300 s on robots.txt, so a page closed to AI crawlers shows soon; s-maxage=86400 on the favicon redirects.
- **Saving:** Estimate: repeat requests inside the window are served by the CDN with no function. Crawler volume is not known.
- **Risk:** A change shows in these files up to the window later. The CDN copy is not purged by a cache tag.

### CA-9 ✓ Three tiny facts that almost never change are asked of the database 11,000 times a day

- **Kind:** duplicate. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Where:** `src/server/content-grid.ts:133`, `src/server/content-grid.ts:152`, `src/server/content-site.ts:46`, `src/server/custom-fields.ts:817`, `src/server/custom-fields.ts:857`, `src/server/menus.ts:284`, `src/server/stores.ts:191`, `src/server/ai.ts:206`, `src/server/ai-pause.ts:19`
- **Evidence:** "select slug from commerce.stores where id = $1" is written in 20 places (rg) and is production's most-called statement: 560,090 calls in 78 days. menus.ts says "addresses do not change" and has a cached helper with 13 callers; the other copies ask the database, several from inside cached functions. aiFor() reads ai_providers on every call from its 92 call sites: 237,563 calls. aiAutonomyPaused() reads one flag: 69,075 calls.
- **Cost today:** About 11,100 statements a day (866,728 / 78), each a round trip from a function to the database. Paid by: The database; the server per request and per scheduled run.
- **Fix:** One storeSlugOf(id) backed by a module-level Map (the mapping never changes, so it needs no expiry); the 20 copies call it. A 60-second per-instance memo for the provider row and the pause flag, as storeLimits() already has (docs/capacity.md:32).
- **Saving:** Estimate: over 90% of those calls.
- **Risk:** A changed AI provider or pause reaches other instances within the memo's minute. Low.

### CA-10 Pages are rebuilt every hour and dropped after a quiet day, though every write already refreshes a tag

- **Kind:** eager. **Effort:** S. **Confidence:** medium. **Step:** 2.7.
- **Where:** `src/server/stores.ts:218`, `src/server/pages.ts:666`, `src/server/platform-navigation.ts:77`, `next.config.ts:41`, `evidence/build.log:37`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md:150`
- **Evidence:** 70 of 85 cached reads use cacheLife("hours"): revalidate after 1 hour, expire after 1 day (Next's table). 82 of 85 also carry a tag and 407 call sites refresh tags. The route table shows Revalidate 1h, Expire 1d on 538 of 772 prerendered routes. The 251 docs pages are among them: their words change only with a deploy, yet they inherit the hour from the platform's menu read. After an hour the next visit starts a background render; after a day without visits the next visitor waits for a full one.
- **Cost today:** Up to 24 background renders a day per visited page for content that did not change, each re-running the page's cached reads on a cold instance. A blocking render for the first visitor after a quiet day, which is most pages of 59 small stores. Not counted in production. Paid by: The server and the database; the first shopper after a quiet day.
- **Fix:** A named profile in next.config.ts (for example tagged: stale 5 min, revalidate 7 days, expire 30 days) for reads whose every writer refreshes a tag. Keep "hours" or shorter where the clock matters: campaign notices, VAT labels, the status page. Start with the platform's reads and the docs.
- **Saving:** Estimate: background renders fall from hourly to on change for those pages. Small while deploys reset everything several times a day (CA-2).
- **Risk:** A writer that forgets its tag leaves a page old for a week, not an hour. Only writers of commerce.stores are held by a scan test (store-writers.scan.test.ts); add the same for pages and the catalogue first.

### CA-11 One store owner saving their AI key refreshes every page of every store

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.7.
- **Where:** `src/server/ai.ts:242`, `src/server/chat-agent.ts:139`, `src/app/admin/(gated)/[store]/settings/ai/actions.ts:34`, `src/app/admin/(gated)/[store]/settings/ai/actions.ts:50`, `src/app/admin/(gated)/platform/ai/actions.ts:52`
- **Evidence:** chatWidgetFor() tags itself with the global AI_TAG ("ai-providers"), and the chat widget is in every site layout. The tag is on every built page I opened: x-next-cache-tags in .next/server/app/s/demo/no.meta, s/demo/no/p/demo-keramikkopp.meta, s/demo/no/cart.meta, index.meta and themes.meta. A store's own save or removal of its AI settings calls updateTag(AI_TAG).
- **Cost today:** One owner's save marks every page of all 60 stores and Kaizena Flow's site stale; each is rendered again on its next visit. How often owners save AI settings is not known. Paid by: The server and the database; the next visitor of every other store.
- **Fix:** aiTag(storeId) for a store's own provider. Keep the global tag for the platform's provider only, which stores on Kaizena Flow's key do depend on.
- **Saving:** A store's AI save refreshes 1 store instead of 60 and the platform site.
- **Risk:** Low. chatWidgetFor must carry both tags, since a store may use the platform's key.
- **Already tracked:** no. Step 3.10 (FF3, Open) covers the catalogue tag only.

### CA-12 ✓ Timers that poll and prune for nobody

- **Kind:** ahead of use. **Effort:** S. **Confidence:** high. **Step:** 0.8.
- **Where:** `src/server/ui-text.ts:31`, `src/server/ui-text.ts:59`, `src/server/ui-text.ts:110`, `src/instrumentation.ts:8`, `src/app/api/cron/cart-reminders/route.ts:144`, `src/app/api/cron/cart-reminders/route.ts:263`, `src/server/search-cache.ts:78`, `src/server/status.ts:413`
- **Evidence:** Every server instance reads commerce.ui_translations when it starts and every minute after (setInterval): 278,393 calls in 78 days, on a table production says has never held a row. The dispatcher's "cache" job refreshes nothing: it deletes kept search answers older than 30 days, 288 times a day (53 ms last run). The dispatcher also marks the status page stale on every run that measured something, though statusOverview() already revalidates each minute.
- **Cost today:** About 3,570 polls and 288 prunes a day, for a feature no language uses yet and a 30-day rule. Paid by: The database; the server per instance and per five minutes.
- **Fix:** Poll ui_translations every ten minutes while it has no rows, every minute once it has. Move pruneSearchCache() to the daily retention job. Drop one of the two status refreshes.
- **Saving:** About 3,500 statements a day (from the measured counts).
- **Risk:** The first machine-translated language shows on other instances up to ten minutes later. Low.

### CA-13 The theme store's list is drawn twice and per request; a theme's neighbours reload every theme's snapshot

- **Kind:** eager. **Effort:** S. **Confidence:** medium. **Step:** 2.7.
- **Where:** `src/components/platform-routes/themes.tsx:52`, `src/components/platform-routes/themes.tsx:59`, `src/server/theme-store.ts:95`, `src/server/theme-store.ts:134`
- **Evidence:** /themes and /no/themes are "resuming" in the manifest; with /get-domain they are the platform site's only pages that need a function per view. The filter reads searchParams inside a Suspense whose fallback is the whole unfiltered list, so the shell (20,586 bytes) holds the list and the function draws it again; the served document is 70 KB (routes.md). themePreviewNeighbours(slug) calls loadCards() (every published theme with its whole snapshot, its photographs and prices) instead of the cached themeStoreCards(), so each theme's preview fills its own copy. Production: the snapshot query ran 10,851 times returning 107,917 rows (about ten themes a call); theme_shots 24,463 times returning 988,893 rows.
- **Cost today:** One function run and the list sent twice per /themes view; one read of all snapshots per theme preview on a cold cache. Paid by: The server per request; the database; the visitor's browser (the list twice).
- **Fix:** Filter the ten or so cards in the browser, keeping the address's query, so /themes is static. Let themePreviewNeighbours() read themeStoreCards().
- **Saving:** /themes: 1 function run per view becomes 0, and the list is sent once (estimate: about 70 KB to about 45 KB). Neighbours: one read of all snapshots instead of one per theme.
- **Risk:** A filtered address then shows the full list until its script runs. The rule that search engines read every theme at once is kept.

### CA-14 Cache entries keyed by lists of ids are almost never asked for twice

- **Kind:** oversize. **Effort:** S. **Confidence:** medium. **Step:** 2.7.
- **Where:** `src/server/catalog.ts:638`, `src/server/search.ts:359`, `src/server/search.ts:380`, `src/server/listing.ts:266`, `src/server/listing.ts:570`, `src/server/recommend.ts:512`, `src/server/field-tiles.ts:149`, `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache-remote.md:60`
- **Evidence:** listGridProducts() is a cached function whose key includes filter.ids. Search results, a filtered listing's page and a shopper's own recommendations pass their id list, so each distinct result set makes a new entry. shownFieldsForItems() is keyed the same way (ids and field ids). Next's doc: with keys of "mostly unique values per request" cache use is "near-zero". The hit rate was not measured.
- **Cost today:** Each such call pays the packing into and out of the cache and leaves an entry in the instance's memory that nobody reads again. Paid by: The server per request (CPU and memory).
- **Fix:** An uncached gridProductsByIds() for id lists, with the same query. Keep the cache for the listing shapes (categories, tags, sort, limit).
- **Saving:** Not measured: removes near-single-use entries from each instance's cache.
- **Risk:** Low. A repeated search by many shoppers loses a possible hit inside one warm instance.
