# caching: Caching and rendering strategy

The caching code is sound, not bloated: 85 cached reads in 49 files, 82 tagged, tags per store, and Kaizena Flow's own site and docs truly static. What is left is rendering that runs per request for little, and it grows with shoppers and stores, not with any unused feature: every store page view runs a render function, and on home, built and blog pages its only job is two cart badges and a country hint (97,919 of the demo home's 138,523 bytes); one Add to cart redraws the whole page and re-fetches 15 links (193 KB, measured); Bing, Google's shop and ads crawlers and every link preview get a full render even of the 508 static pages; and links prefetch pages nobody opens (11 to 50 requests a store page, 23 to 46 an admin screen). 16 findings stand (13 from the verified report, 3 added by this pass), 1 was refuted. Do first: the two prefetch cuts, the AI tag, the page-list split and a build check that holds what is static (nothing holds it today); the structural ones (cart count in the browser, deploys that skip superseded pushes, crawlers served from the cache) are cheapest before opening.

## Measures
- Cached reads ("use cache"): 85 directives in 49 files. Lifetimes: 70 "hours", 4 default (15 min), 4 "days", 3 "minutes", 2 inline with revalidate 1 s, 1 inline hourly, 1 seconds-or-days. 82 tagged, 3 untagged (brreg fetchUnit, listCountries, storeSlugOf). 0 "use cache: remote", 0 unstab…
- Tags and refreshes: 407 tag refresh call sites in 147 files counting refreshTagNow (401 in 144 without it); 34 of them refresh a store's pages tag. A store page carries two tags that name no store: catalog and ai-providers.
- Prerendered routes and how each is served: 772 routes: 508 static (462 docs, 33 site, 6 api, 4 theme store, 2 admin, 1 store), 262 resuming (148 store, 110 admin, /themes and /get-domain in two languages), 2 blocking (the docs search pages). 545 dynamic patterns: 137 with no fallback shell (115 store,…
- Demo store home: static part against per-request part: Shell 40,604 bytes with 0 flight pushes and 3 unresolved holes. Served document 138,523 bytes, Cache-Control private, no-cache, no-store. 97,919 bytes come from the function on each view. For contrast / is one static file of 39,845 bytes with its page data in…
- Holes per demo store page: Of 147 prerendered demo routes: 33 have three holes. On 21 of them the three are the shared ones and nothing else (home, the built page om-oss, 9 blog routes, cookies, deliveries, in three countries); cart, checkout and 6 account routes have the two cart link…
- Resume data carried by a prerendered store page: 25 cached entries, 33,509 bytes inflated (13,572 packed) in the demo home's 19,751-byte .meta; every key ends with the build id; longest key 352 characters; largest values: the store 8,556 bytes, a product grid 5,759, the published pages with content 4,275. T…
- Prefetch requests after load, visitor does nothing: Store pages 11 to 50 requests, 33 to 193 KB on the wire (the two looping pages left out); admin screens 23 to 46 requests, 77 to 160 KB; platform site 0 to 9. Empty cart page: 42 requests, 184,408 bytes on the wire, of which six language and currency views ta…
- Requests per store page load that pass the proxy's matcher: 13 on the home page, 14 on a product, the products page and a blog post, 36 on a built page, 44 on the empty cart: the page, the wishlist call and every prefetch. 1 on a docs page. The admin and /api are outside the matcher.
- One Add to cart on a product page (new): 16 requests and 193,042 decoded bytes in the 4 s after the press: the action's answer is 81,709 bytes (the whole page drawn again), then 15 prefetch requests (111,333 bytes) for links that were already prefetched, 62,294 of them the cart page.
- What a crawler on Next's list gets (new): With a Bingbot user agent / and /docs answer Cache-Control private, no-cache, no-store and no cache HIT; with a browser's they answer x-nextjs-cache HIT, s-maxage=3600. Next's default list matches Bingbot, Storebot-Google, AdsBot-Google, Google-InspectionTool…
- Link prefetch settings in source: 400 files import next/link; 4 links set prefetch={false}; 0 set prefetch={true}; partialPrefetching unset in next.config.ts; no segment exports prefetch.
- Prefetch loop, reproduced again: 1,586 RSC requests in 4 s after load on /s/demo/no/category/belysning, 1,517 for one link's @drawer/[...rest]/__PAGE__ segment; 1,089 in 3 s on the search page. Each answer is the right 1,435-byte segment file, 200, s-maxage=3600, a cache HIT. The page is qui…
- Production: cached reads that still ran (78 days, platform not open): All published pages with content 79,778 calls (29 rows a call, 781 s); cookie scans 70,257; platform settings 53,887; font css 42,211. Uncached tiny reads: store slug by id 560,090; ui_translations poll 278,393; ai_providers 237,563; AI pause flag 69,075. The…
- Deploy cadence (before opening): 115 commits in the two days the shallow clone holds; 80 touch something other than Markdown or docs, so CI deploys them. The deploy hook builds the head of main, not the run's commit.
- Checks that hold caching behaviour today: 0 tests or scripts read .next/prerender-manifest.json or a page's cache mode. 10 e2e assertions hold Cache-Control, all for no-store or immutable. 1 scan test holds a tag refresh (writers of commerce.stores).

## Well made
- Tag discipline: 82 of 85 cached reads carry a tag, almost all per store (store:, pages:, catalog:, terms:, fields:, cookies:, chat:, experiments:, recommend:, campaigns:). The global catalog tag is refreshed only by VAT changes (src/server/vat-admin.ts). That…
- Kaizena Flow's own site and the docs are truly static for people: /, /blog, /sign-up and 462 docs routes are compute static in the manifest and answer s-maxage=3600 with stale-while-revalidate (re-measured with curl: / and /docs are cache HITs). Crawlers on N…
- The store layout awaits params above any Suspense (src/app/s/[store]/[market]/layout.tsx:105). Next's ISR guide (incremental-static-regeneration-cache-components.md) says this is what creates a kept page per address while Partial Prefetching is off. Correct f…
- refreshTag() (src/server/refresh.ts:10-16) uses updateTag in an action and falls back to revalidateTag(tag, 'max') elsewhere, as Next's docs describe. The dispatcher refreshes page, theme and catalogue tags only for the stores whose schedules, themes or alt t…
- The proxy does not read the database on every request: a store's facts and the house-store switch are remembered 10 s per instance (src/server/redirect-resolve.ts:203-211, src/server/house-switch.ts:30-41). It does run for every matched request, 13 to 44 per …
- Arguments of cached functions are ids, slugs and the small Market object. The longest cache key on the demo home is 352 characters (re-measured). No whole Store object is passed into a cached function.
- Stock, the tiles' facts (/api/shop/tiles), the wishlist and recommendations answer no-store by written rule (D172, D557). Right: they are per visitor or change by the minute.
- HTTP caching is well set where it was thought about: product feeds (s-maxage=900), font files (one year, immutable), the fonts catalogue, the site's sitemap and llms.txt (one hour), share pictures (a day in browsers and at the CDN, a week stale: src/lib/share…
- Public pages keep their metadata static: 386 of 388 prerendered public pages hold <title> before </head> in the static file, and no generateMetadata outside the admin takes searchParams (68 checked by rg). This is what makes CA-15's change safe.
- commerce.search_cache keeps AI search answers in the database for 30 days, the right tool for a cache that must outlive an instance and a deploy.
- No link uses prefetch={true}, so switching Partial Prefetching on later has no legacy full prefetches to migrate.
- Demo store pages are prerendered per market with their product, category and page addresses. They cost build time only (1,426 pages in 28.9 s).
- Four small per-instance memos exist (src/server/limits.ts:26, redirect-live.ts:187, experiments.ts:63, holding.ts:19). A duplicate helper, but tiny; CA-9 should reuse remembered() rather than add a fifth.
- listGridProducts() keyed by an id list (the auditor's CA-14, refuted): its main callers ask for the same list for every shopper, so the entries are reused inside a warm instance. No cost was measured.

## Findings (16)

### CA-1 [P1 M eager corrected] Every store page view runs a render function, to place two cart badges and a country hint
- evidence: Re-measured in this pass. The prerender manifest marks 148 of the 149 prerendered store routes compute 'resuming' (a function on every view); / is 'static'. Demo home: the shell .next/server/app/s/demo/no.html is 40,604 bytes with 0 flight pushes and three unresolved holes: B:0 after the wishlist link in the header, B:2 before the cart link in the phone bar, B:1 after the footer. The local production server answers …
- cost: Per view of a store page: one render function run that redraws the page's server components from the resume data and streams 97,919 bytes after the shell (demo home), plus one function run for the wishlist call. The pla… (The server per request; the shopper's browser, which waits for the stream befor…)
- fix: 9 steps; first: 1. One per-visitor answer. New route src/app/api/shop/mine/route.ts, modelled on src/app/api/shop/tiles/route.ts (connection(), sameSite(), ?store=&market=, lockedOut(), no-store; /api addresses are outside the proxy's matcher, src/proxy.ts:54-60). It answers…
- done when: After pnpm build, .next/prerender-manifest.json gives compute 'static' for /s/demo/no and /s/demo/no/om-oss (both 'resuming' today), and on pnpm start curl -sD - http://localhost:3000/s/demo/no shows x-nextjs-cache: HIT with an s-maxage Cache-Control (private, no-cache, no-store today), while the e2e assertions on 'Ha…
- saving: Measured on the demo home: the render function run per view goes (it makes 97,919 of 138,523 bytes today). The bytes a browser receives do not fall: the page data moves into the static file, as on /. On the demo build 21 of 148 resuming store routes become st…
- after: nothing
- notes: Conflicts with SC-10 as planned in the storefront-client dimension: SC-10 moves the wishlist answer into the page's per-request stream, which adds a fourth hole and keeps every store page per-request. Do one or the other. If CA-1 is scheduled, skip SC-10's st…

### CA-2 [P1 M process corrected OWNER-CHOICE] Cached reads and built pages live in one instance and one deploy; each deploy empties them for every store
- evidence: Next's guide, read in this pass: a 'use cache' result stays 'in a per-instance, in-memory store that is ephemeral on serverless', and 'all of these stores are scoped to a single deployment', remote ones included, because the cache key holds the build id (08-caching.md:600-605; use-cache-remote.md:90-98). Measured: all 25 cache keys in the demo home's resume data end with the id in .next/BUILD_ID. src has no 'use cac…
- cost: After each deploy: the first visit to any page of any store but the demo is a blocking render with 25 or more database reads (count from the demo home; time not measured), and every instance's cached reads start empty. … (Shoppers of real stores (first view after a deploy), the database, the build.)
- fix: 6 steps; first: 1. The owner's choice, for when stores are open: keep one deploy per push (today), or let a run skip its deploy when a newer commit is already on main. The steps below assume the second.
- done when: Two pushes to main one minute apart produce one call of the Vercel deploy hook (two today), read from the two runs' logs, and /api/health reports the second commit; docs/rules/storefront.md says what 'cached' means.
- saving: Not measured. Each deploy skipped saves one Vercel build and keeps every store's built pages and every instance's cached reads alive until the next. With 80 deployable commits in two days, many arrive in bursts. It also stops an earlier run from deploying a l…
- after: nothing
- tracked: Partly. Step 1.8 (FH10, Open) of docs/audits/code-review-2026-11.md covers the build's memory and deploying what was checked; step 0.2 (FH1, In progress) the d…
- notes: The deploy pace is a chosen way of working before opening, not waste; this is a decision about how deploys behave once real stores are open. DQ-7 in the database dimension describes the same cold reads from the query side and also advises against a remote cac…

### CA-3 [P0 M oversize confirmed] To read one page, the code loads every published page with its whole content
- evidence: Opened in this pass. listPublishedPages() (pages.ts:664-679) selects the published JSON of every published page of an owner, parses each with the page schema, joins picture alt texts, and keeps the list as one cached value. rg finds 35 call sites. Nine are (await listPublishedPages(x)).find(...) for one page (the store's front page at page.tsx:29, pages.ts:799 and 862, platform-roles.ts:37, site-chat.tsx:110, blog-l…
- cost: About 29 page documents read and parsed per cold call today; at most about 190 KB of JSON a call (9.1 MB over 1,389 rows times 29, an upper bound: a row also holds its draft). It is paid once per store and type per cold… (The database; the server on each cold render; each built store page, whose resu…)
- fix: 6 steps; first: 1. This is DQ-2 of the database dimension; use its names so the work is done once. In src/server/pages.ts add publishedPageIndex(owner, type = 'page'): 'use cache', cacheLife('hours'), cacheTag(pagesTag(owner)), the same where and order as listPublishedPages …
- done when: rg -c 'listPublishedPages\(' over src without tests gives at most 20 lines (35 today), and the new integration test passes; on production a week after the deploy, the whole-content pages statement has fewer than a quarter of the calls of the new index statement in pg_stat_statements.
- saving: Estimate: over 90% of the bytes this statement reads at today's 29 rows a call; less for a store with few pages. Every store page's kept data shrinks by the list (4,275 bytes on the demo).
- after: DQ-8 (the owned() helper, if the database dimension's order is followed; not needed for the caching gain)
- tracked: no. Step 3.9 (FF2, FF5, Open) of docs/audits/code-review-2026-11.md is the same pattern for products, not pages.
- notes: Same change as DQ-2 (database dimension), which carries the step list in more detail; do it once. A read per page is also the first step toward a per-page tag, so that publishing one page stops marking every page of the store stale (the pages twin of step 3.1…

### CA-4 [P0 S eager confirmed] Language and currency links prefetch whole front pages that their click never opens
- evidence: Opened view-menu.tsx:50-76 in this pass: ViewMenu draws each language and currency as a next/link to that view's front page, but its click handler cancels the link and pushes the page the shopper is on. So the router prefetches a page the click does not open, except from the front page itself. Regrouped routes.json in this pass, demo's empty cart page at phone size: 42 prefetch requests, 625,516 bytes decoded, 184,4…
- cost: For a store with several languages or currencies on: up to about 510 KB decoded (105 KB on the wire) and 18 requests per page load where the footer's list is on screen, each a proxy run, plus up to six page renders on a… (The shopper's browser (phone data); the server per request.)
- fix: 2 steps; first: 1. src/components/view-menu.tsx:56: add prefetch={false} to the Link. Nothing else changes: the click handler already navigates with router.push, and without scripts the link still leads to that view's front page.
- done when: A cold phone load of /s/demo/no/cart on pnpm start makes 0 prefetch requests to /s/demo/no-sv, -da, -en, -sek, -dkk or -eur in the 3 s after load (18 today, 104,635 bytes on the wire), held by the new test in e2e/performance.spec.ts.
- saving: Measured on the cart page: 18 of 42 prefetch requests, 57% of the wire bytes (104,635 of 184,408) and 81% of the decoded bytes (509,776 of 625,516); 18 fewer proxy runs per such page load.
- after: nothing
- notes: The same line as SC-1 step 1 in the storefront-client dimension, which also covers the footer's other links; do it once. The cost falls only on stores that offer several languages or currencies, so it follows use, but for them it is plain waste.

### CA-5 [P0 S eager confirmed] Each admin screen prefetches 13 to 22 other screens, and the storefront, on sight
- evidence: Regrouped routes.json in this pass, signed in as an owner: Home 28 prefetch requests to 13 addresses (98,047 bytes on the wire); Orders 32 to 15 (111,733); Pages 46 to 22 (160,192); Settings 44 to 21 (151,731). The View store link alone (layout.tsx:132) is 4 requests, 62,376 bytes decoded and 18,183 on the wire on every screen. The four Link sites of the rail, the area links, the tabs and the sidebar were opened: no…
- cost: 23 to 46 requests and 77 to 160 KB on the wire per admin screen, each a function run in production, for screens the owner mostly does not open next; again after most saves. It grows with owners at work in the admin. (The owner's admin (bytes); the server per request.)
- fix: 5 steps; first: 1. src/app/admin/(gated)/[store]/layout.tsx:132: add prefetch={false} to the View store link.
- done when: Signed in as the test owner, /admin/{store}/orders makes at most 4 prefetch requests in the 3 s after load (32 today, 111,733 bytes on the wire), held by the new test in e2e/signed-in/.
- saving: Estimate: 28 to 44 of the 32 to 46 requests per screen. Measured ceiling: the 77 to 160 KB on the wire per screen, and as many function runs.
- after: nothing
- tracked: no. PERF-01 in docs/audits/psi-followups.md tracks the admin's scripts, not its prefetches.
- notes: Partial Prefetching would not cut this much: nearly every admin link goes to a different route, so there is little shell to share. AD-13 and AD-5 in the admin-data dimension reduce what a save redraws; they do not touch the prefetches.

### CA-6 [P1 M eager confirmed] A prefetch loop on listing and search pages at /s/{store} addresses
- evidence: Reproduced again in this pass on the local production build, and narrowed. /s/demo/no/category/belysning: 1,586 RSC requests in 4 s after load, 1,517 of them for one link (/s/demo/no/p/demo-bordlampe), each asking for the segment /s/$d$store/$d$market/@drawer/(__SLOT__)/$c$rest/__PAGE__ (the slot name is base64 in the header). The search page: 1,089 in 3 s, 1,067 for /s/demo/no/search. Each answer is right: 200, the…
- cost: On /s/{store} addresses: about 350 requests a second for as long as a listing or search page is open, each through the proxy. CI's end-to-end jobs run on these addresses. Whether a store reached at an /s/ address in pro… (CI on every run; the server and a shopper's browser wherever a store is reached…)
- fix: 5 steps; first: 1. Hold it first. e2e/performance.spec.ts: a test that loads /s/demo/no/category/belysning and /s/demo/no/search?q=lampe at phone size, waits 3 s after load and expects fewer than 100 requests. Mark it test.fail() until fixed, so CI records the state and turn…
- done when: The new e2e test passes without test.fail(): under 100 requests in the 3 s after load on the category page and on the search page (about 1,200 to 1,500 today).
- saving: Measured locally: about 10,300 of 10,358 requests on the category page of the measuring pass; about 350 requests a second while such a page is open.
- after: nothing
- tracked: no. docs/audits/code-review-2026-11.md mentions a test that timed out under load, without this cause.
- notes: Same matter as SC-9 (storefront-client dimension), which ranks it P2 as an open question. Ranked P1 here because CI pays on every run, the scope in production is unknown, and this pass narrowed it: the answer is correct and cacheable and the page is idle, so …

### CA-7 [P2 S process corrected] partialPrefetching is unset: Next treats it as off, warns on every build and start, and will remove the choice
- evidence: Read in this pass. Next's doc: unset behaves like false and logs a warning; both features will be on everywhere in the next major and the option removed. The build log prints the warning (lines 5-11). For this app, off means three things. 1) Each link on screen is prefetched by itself: 11 to 50 requests per store page and 23 to 46 per admin screen. 2) A first visit to a page not built ahead waits for the whole rende…
- cost: Today: the warning, the prefetch volume of CA-4 and CA-5, and blocking first visits. Later: a migration under time pressure at the next major. (Shoppers and owners (requests); an agent's session later.)
- fix: 5 steps; first: 1. next.config.ts:42: write partialPrefetching: false beside cacheComponents, with a comment that it is a recorded choice and names this plan. The warning goes; behaviour does not change.
- done when: pnpm build no longer prints the partialPrefetching warning (grep -c partialPrefetching on the build's output gives 0; the warning is there today), and next.config.ts names the value.
- saving: None from writing the value. With adoption, links to the same route share one shell and a store page not built ahead can answer with a shell at once (Next's docs); not measured on this app.
- after: CA-4 and CA-5 (measure the cheap cuts first); CA-1 (before the storefront's adoption in step 4)
- notes: A framework migration to schedule, with no saving of its own. Do not switch the global flag on now: what a default link would fetch for the storefront with it on was not tested by anyone in this review.

### CA-8 [P3 S eager corrected] A store's robots.txt, sitemap, llms.txt, blog feed and favicon answer with no HTTP cache
- evidence: Opened the six handlers in this pass: the store's robots, sitemap, llms.txt and feed set only Content-Type; faviconRedirect() (site-icons.ts:25-30) answers a 302 with public, max-age=3600 and no s-maxage, behind connection(). The build table marks all of them dynamic (build.log lines 1333-1459). The verified report's curl run found no Cache-Control on the four files; the site's own /sitemap.xml and /llms.txt answer …
- cost: One function run per crawler request per store file. On a cold instance a sitemap reads the store, its products and terms, and every page and article with content (CA-3). A crawler usually asks for each file about once … (The server per request; the database.)
- fix: 4 steps; first: 1. src/app/s/[store]/store-sitemap.xml/route.ts, llms.txt/route.ts and [market]/blog/feed.atom/route.ts (and blogs/[blog]/feed.atom/route.ts): add Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400 to the 200 answer.
- done when: curl -sD - on pnpm start shows an s-maxage Cache-Control on /s/demo/store-sitemap.xml, /s/demo/llms.txt, /s/demo/no/blog/feed.atom and /s/demo/robots.txt (none today), held by the e2e assertion.
- saving: Small. Only requests that arrive inside the window are served without a function; a file asked for once a day still starts a function run each time and is served a day old.
- after: nothing
- notes: P3 because the skeptic's correction stands: with about one crawler fetch a day per file, a one-hour window saves almost nothing. Do it when the handlers are next opened. CA-3 removes most of what a cold sitemap reads, which is the larger part of this cost.

### CA-9 [P2 S duplicate corrected] The same one-line store lookup is written 27 times, and three tiny facts are asked of the database about 11,000 times a day by scheduled work
- evidence: The verified report counted 27 copies of 'select slug from commerce.stores where id = $1' in src/server and 12 callers of the cached helper storeSlugOf() (menus.ts:284, cacheLife days, no tag); the statement is production's most-called: 560,090 calls in 78 days. Opened in this pass: aiFor() (ai.ts:206-210) reads ai_providers with select * on every call, 237,563 calls; aiAutonomyPaused() (ai-pause.ts:19-22) reads one…
- cost: About 11,100 statements a day (866,728 over 78 days), each a round trip from a function to the database. None is among the costliest statements (smallest listed: 17.5 s in 78 days). The count grows with stores and sched… (The database; the server per scheduled run and per cold render.)
- fix: 4 steps; first: 1. This is DQ-9 of the database dimension; follow its steps so the work is done once: move storeSlugOf() to src/server/stores.ts (menus.ts re-exports it), replace the exact copies (rg -n 'select slug from commerce.stores where id' src), and carry the slug in …
- done when: rg -c 'select slug from commerce.stores where id' over src without tests gives at most 3 lines (27 today); on production a week after the deploy that statement grows by fewer than 500 calls a day (about 7,180 a day today).
- saving: Estimate: over 90% of those calls, worth little database time today. The clearer gain is one helper instead of 27 copies.
- after: nothing
- notes: Same change as DQ-9, which ranks it P0 for the call count; from the caching side the time saved is small, so it is P2 here. Whichever dimension's order is followed, do it once.

### CA-10 [P2 S eager confirmed] Pages are rebuilt every hour and dropped after a quiet day, though every write already refreshes a tag
- evidence: Re-counted in this pass: 70 of 85 cached reads use cacheLife('hours'): revalidate after 1 hour, expire after 1 day (Next's table, cacheLife.md:138-146). 82 of 85 also carry a tag and 407 call sites refresh tags. The manifest shows revalidate 3600, expire 86400 on 538 of 772 prerendered routes; 6 are at 900 (the demo home and All products, because two reads use the default profile: campaign-notices.ts:28 and :183), 2…
- cost: Up to 24 background renders a day per visited page for content that did not change, each re-running the page's cached reads on a cold instance, and a blocking render for the first visitor after a quiet day. With many sm… (The server and the database; the first shopper after a quiet day.)
- fix: 5 steps; first: 1. Hold the writers first. New scan tests modelled on src/server/store-writers.scan.test.ts: a module that writes commerce.pages refreshes pagesTag (or is on a list that may only shrink); the same for commerce.platform_settings and commerce.menus with PLATFOR…
- done when: After a build, the docs routes that show initialRevalidateSeconds 3600 in .next/prerender-manifest.json (251 of the 538 routes at 3600 today, counted in this pass) show 604800, and the new scan tests pass.
- saving: Estimate: background renders fall from hourly to on change for those pages, and a quiet page stays served for 30 days instead of 1. Small while deploys reset everything several times a day (CA-2).
- after: CA-16 (records the periods); CA-3 (the page index read that moves)
- notes: The part that grows after opening is the quiet-day blocking render: many small stores means many rarely seen pages. A page gains only when every read it uses has moved, so start where the set is small (the docs and the platform's site).

### CA-11 [P0 S oversize confirmed] One store owner saving their AI key marks every page of every store stale
- evidence: Opened in this pass. chatWidgetFor() (chat-agent.ts:135-138) tags itself with chatTag(storeId) and the global AI_TAG ('ai-providers', ai.ts:242), and the chat widget is in every site layout. The demo home's .meta lists ai-providers among its tags, and so does Kaizena Flow's front page; the verified report counted the tag on 319 of 1,316 prerendered .meta files. A store's own save or removal of its AI settings calls …
- cost: One owner's save marks every page of every store and Kaizena Flow's site stale; each is rendered again on its next visit. With many stores this happens whenever any one of them touches its AI settings. How often owners … (The server and the database; the next visitor of every other store.)
- fix: 5 steps; first: 1. src/server/ai.ts:242: beside AI_TAG add export const aiTag = (storeId: string) => 'ai-providers:' + storeId. AI_TAG stays the platform provider's tag.
- done when: rg -n 'AI_TAG' 'src/app/admin/(gated)/[store]' returns nothing (3 lines today: the import and 2 updateTag calls), the new scan line passes, and after saving a store's AI settings on a local build the other store's pages still answer from the cache.
- saving: A store's AI save refreshes 1 store instead of every store and the platform's site.
- after: nothing
- tracked: no. Step 3.10 (FF3, Open) covers the catalogue tag only.
- notes: A tag that is too wide, and it gets worse with every store added. Cheapest to fix before opening. CA-16's baseline lists the tags on a store page that name no store, so the next global tag is seen when it appears.

### CA-12 [P3 S eager corrected] A per-instance poll every minute and a five-minute prune that could run far less often
- evidence: Opened in this pass. Every server instance reads commerce.ui_translations when it starts and every minute after (ui-text.ts:31 FRESH_MS = 60,000; startUi() at :106-115 sets the interval): 278,393 calls in 78 days. The dispatcher's 'cache' job (cart-reminders/route.ts:144) refreshes nothing: pruneSearchCache() (search-cache.ts:78-83) deletes kept search answers older than 30 days, 288 times a day. The dispatcher also…
- cost: About 3,570 polls and 288 prunes a day. Neither is among the costliest statements; the prune is about 15 s of database-bound time a day (288 times 53 ms). The polls grow with the number of live instances, not with store… (The database; the server per instance and per five minutes.)
- fix: 3 steps; first: 1. The poll is DQ-12 of the database dimension: with no migration, while the last answer had no translated language let the timer wait 10 minutes instead of one (a setTimeout chain in startUi(), src/server/ui-text.ts:106-115); reloadUi() already refreshes the…
- done when: The dispatcher's job list has no 'cache' entry (rg -n 'pruneSearchCache' src/app/api/cron shows it only in the daily route), and on production the ui_translations statement grows by fewer than 200 calls a day per instance with no translation edited.
- saving: About 3,500 statements a day (from the measured counts), worth very little database time. A tidy-up, not a cut.
- after: nothing
- notes: P3: the saving is tiny and the dispatcher's job frequencies belong to the scheduled-work dimension (DQ-5). Do it when ui-text.ts or the dispatcher is next opened.

### CA-13 [P2 S eager corrected] The theme store's list needs a function per view and draws the list twice; a theme's neighbours reload every theme's snapshot
- evidence: Opened in this pass. /themes and /no/themes are 'resuming' in the manifest (re-counted: with /get-domain they are the site's only prerendered pages that need a function per view). The filter reads searchParams inside a Suspense whose fallback is the whole unfiltered list (themes.tsx:52-59; a written choice: search engines and a first visit read every theme at once). So the shell (20,586 bytes) holds the list and the…
- cost: One function run and the list's HTML sent twice per /themes view; one read of all snapshots per theme preview on a cold cache. /themes is one page of Kaizena Flow's own site, so this grows with visitors to that page, no… (The server per request; the database; the visitor's browser (the list twice).)
- fix: 2 steps; first: 1. src/server/theme-store.ts:100: previewNeighbours(await themeStoreCards(), slug) in place of loadCards(). One line; the tags are the same.
- done when: Step 1: rg -n 'loadCards\(\)' src/server/theme-store.ts shows two call sites, in themeStoreCards and themeStoreCardsNow (three today). Step 2, if done: /themes has compute 'static' in the manifest.
- saving: Neighbours: one read of all snapshots per cold instance instead of one per theme. /themes, if made static: 1 function run per view becomes 0 and the list's HTML is sent once (about 71 KB to about 63 KB; the page data stays).
- after: nothing
- notes: Do step 1 now; it is one line. Step 2 is P3: one marketing page, and it trades a no-script filter for a static page.

### CA-15 [P1 S eager added] Bing, Google's shop and ads crawlers and every link preview get a full render of every page, static ones included
- evidence: Found and measured in this pass. With Cache Components, Next skips the prerendered page for user agents on its 'HTML-limited bots' list and renders the page per request (streaming.md:681-685: such bots 'skip the prerendered shell and render the page dynamically so metadata can be placed in the head'). The build writes the rule into every app page's entry in .next/prerender-manifest.json (experimentalBypassFor, a use…
- cost: One full page render per crawler request, on a mostly cold instance, with every cached read the page uses (25 on the demo home) asked of the database; also for the 508 pages a person gets from the cache. Volume in produ… (The server per crawler request; the database.)
- fix: 6 steps; first: 1. Measure first, outside this review: in Vercel's logs, count page-route function runs over 7 days whose user agent matches Next's default list (html-bots.js:15) against all page-route runs. If the share is small after opening, stop here.
- done when: On pnpm start, curl -sD - -A 'Mozilla/5.0 (compatible; bingbot/2.0)' http://localhost:3000/docs shows x-nextjs-cache: HIT (private, no-cache, no-store today), and the new no-script crawler test passes.
- saving: Per crawler request: a full render becomes a cache hit on static pages and a resume on the others, and a page first seen by a crawler is kept for the next person. Total not known until step 1 is measured.
- after: CA-16 (the title-in-head check); CA-1 (makes home, built and blog pages whole static files, so a crawler gets complete HTML with nothing streamed)
- notes: Added by the planner's completeness pass. The brief asked what makes each route dynamic; the report listed cookies, headers and searchParams, and missed that a user agent does it for every page. It argues from no unused feature: it is cost per crawler request…

### CA-16 [P0 S process added] Nothing holds what is static: one cookie read in a shared part can move every store page to per-request, and no check would say so
- evidence: Searched in this pass: no test or script in e2e, scripts, src or .github reads .next/prerender-manifest.json, x-nextjs-cache or a page's compute mode (rg: nothing). The 10 e2e assertions on Cache-Control all hold no-store or immutable; none holds that a public page stays cacheable. e2e/performance.spec.ts holds first scripts by bytes for 8 routes and page weight, largest picture and first byte for 2 store routes (li…
- cost: No running cost by itself. It is why the costs of CA-1, CA-4, CA-5, CA-10, CA-11 and CA-17 grew unseen, and why a fix to any of them can be undone by the next change without a red check. (Every later change: the server per request and shoppers, once a regression ship…)
- fix: 6 steps; first: 1. New script scripts/render-modes.mjs, run after a build. For a named list of routes it reads .next/prerender-manifest.json and each route's .html and .meta under .next/server/app and records: compute (static, resuming, blocking); holes (templates B:n withou…
- done when: node scripts/render-modes.mjs passes on CI's build, and a trial change that adds one cookies() read to the store's footer makes it fail, naming /s/demo/no and its holes going from 3 to 4.
- saving: None directly. It holds the gains of CA-1, CA-10, CA-11 and CA-15, and turns the next silent move from static to per-request into a red check.
- after: nothing
- tracked: no. The code review's ratchet (1.2, 1.3) counts unchecked reads and writes, not render modes.
- notes: Added by the planner's completeness pass. Land it before or with CA-1, so the baseline shows the move from resuming to static and then holds it. It is cheap because the build already writes everything it reads.

### CA-17 [P1 S eager added] One Add to cart redraws the whole page and re-fetches every prefetched link, to change one number
- evidence: Measured in this pass on the local production build, phone size, /s/demo/no/p/demo-keramikkopp: in the 4 s after one press of Add to cart the browser made 16 requests, 193,042 bytes decoded. The action's answer was 81,709 bytes: addToCart ends with refresh() (cart/actions.ts:139), so the server draws the whole page again and sends its payload. Then 15 prefetch requests, 111,333 bytes, for links the page had already …
- cost: Per Add to cart from a product page or a tile: one page render in the action (81.7 KB answer on the demo product) and about 15 more requests, each a proxy run and some a render. It grows with shoppers, on the path to pa… (The shopper's browser (phone data, a busy moment right after the press); the se…)
- fix: 5 steps; first: 1. After CA-1: addToCart already returns the new count and useOpenCartAfterAdd sets it in the browser (CA-1 step 6). Remove refresh() from addToCart (src/app/s/[store]/[market]/cart/actions.ts:139). Without refresh, updateTag or revalidateTag the action answe…
- done when: The new test in e2e/performance.spec.ts passes: after one Add to cart on the demo product page the browser makes 1 request in 3 s with an answer under 5 KB (16 requests and 193,042 decoded bytes today), and the cart link reads 'Handlekurv (1)'.
- saving: Measured ceiling per Add to cart on the demo product page: 15 of 16 requests and about 190 of 193 KB decoded; one page render and 15 proxy runs fewer.
- after: CA-1 (the count must be drawn in the browser first)
- tracked: no. AD-13 in the admin-data dimension is the admin's twin (saves that draw the route twice).
- notes: Added by the planner's completeness pass: the report noted for the admin that refresh() clears the client cache, but did not measure the storefront, where it happens on the most valuable press. It only becomes removable once CA-1 has moved the count into the …

## Refuted (not findings)
- CA-14 Cache entries keyed by lists of ids are almost never asked for twice: Not supported: the commonest callers (an unfiltered listing's page, a product's related products, a popular search) pass lists that are the same for all shoppers, one caller is itself cached, no hit rate was measured, a…
