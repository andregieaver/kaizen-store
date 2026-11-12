# Phase 0: Before the doors open

Part of `docs/audits/bloat-review-2026-11.md`: its Progress table says where each step stands. **Goal:** Remove what costs something on every request, cold start, scheduled run or agent session, with small and safe changes, and make the changes that are cheapest while no real store, order or picture exists. Steps 0.1 and 0.2 go first, and 0.18 comes before 0.19; otherwise no step waits for another. **A person will notice:** Almost nothing on a screen changes, apart from two faults a shopper would have met on day one (empty search thumbnails, and a button with no fill on the status and report pages). Cold pages answer sooner, an admin screen loads about half the script, a store page stops asking the server for a wishlist and stock nobody has, the database falls from 731 MB to about 230 MB, and an agent session starts with a third of today's standing rules.

Each step names the findings it closes; a finding's own file has the evidence, the fix in detail, and the tests and rules that change with it.

## 0.1 Keep the 'before': put the review's scripts in the repo and store a daily reading of production

The detectors the plan's checks name (the copy and twin counters, the import-reach walker, the trace summers) and four deletion lists exist only in the review's scratch folder. Copy them to docs/audits/bloat-review-2026-11/scripts/ and lists/, and point every done-when at the repo path. Add one statement to the daily route that writes a dated reading into a small platform table, kept 90 days: the 40 costliest and the 40 most-called statements, each commerce table's rows, size and scan counters, and size by schema. Platform, Usage and limits shows the day's difference with four flags (a newcomer among the 25 top statements, a table over 1,000 rows read whole more than 10 times a day, a write that changed a row in under 1 of 10 calls, the cron schema over 80 MB). Do this first, so every later step has a 'before' to be measured against.

- **Closes:** GAP-code-1, GAP-database-1
- **Effort:** M. **Areas it moves:** The code itself; The database; Scheduled work.
- **Done when:** Each script, run with node from a fresh checkout, gives its number again (41 twin pairs, 4,098 exact copied lines across files, 1,308 files reached by /api/visit), and Platform, Usage and limits lists flags from two stored days, with an int test that scans a seeded 2,000-row table 20 times and sees its flag.
- **Platform:** The reading is the platform's own table, shown in /admin/platform, and it counts Kaizena Flow's store and its null-store rows with every other.

## 0.2 Let the deploy job, not a visitor, meet the first cold page

scripts/await-deploy.mjs waits for /api/health and stops. Add page checks from SMOKE_PAGES (Kaizena Flow's home and one page of the template store), so the job pays the first draw and a page that answers 500 fails the run. prerenderedShops() also returns the house store's markets while the switch is on, so kaizenaflow.com is built with each deploy, and CI seeds a house store with the switch on. Land it before steps 0.3 to 0.7: each of them changes what loads cold, and this is the check that catches a missed import in production.

- **Closes:** [SD-3](../findings/storefront-server/SD-3.md), GAP-server-2
- **Effort:** S. **Areas it moves:** What the server loads and asks.
- **Done when:** The release job's log lists each page check with status 200 and its cache header after a deploy, src/lib/await-deploy.test.ts shows that a page answering 500 fails the job, and the first request for Kaizena Flow's home after a deploy answers from a prerendered shell.
- **Platform:** Kaizena Flow's own front page is the first page checked, and it is prerendered with every deploy.

## 0.3 Cut the two import hubs: the unused schema and the chat module's helpers

src/db/client.ts hands the 19,614-line Drizzle schema to a query builder nobody calls, so 481 table definitions are built at every cold start: make the import type-only and call drizzle({ client: pool }), three lines. The four /api/visit beacons, /api/recommendations/events and /api/docs/feedback take sameSite and two more small helpers through src/server/chat-route.ts, which brings the chat, the AI layer and the support desk with it: import them from the files that define them. In the same change correct the note on the Postgres driver in the code review's dependency item.

- **Closes:** [DD-1](../findings/unused-code/DD-1.md), [DP-1](../findings/dependencies/DP-1.md), [DP-9](../findings/dependencies/DP-9.md), [SG-6](../findings/server-module-graph/SG-6.md), [SF-6](../findings/server-functions/SF-6.md), [DS-1](../findings/database-shape/DS-1.md), [TC-5](../findings/tests-ci-build/TC-5.md), [DP-10](../findings/dependencies/DP-10.md), [FM-2](../findings/families/FM-2.md), [FM-14](../findings/families/FM-14.md), [SG-3](../findings/server-module-graph/SG-3.md), [SF-4](../findings/server-functions/SF-4.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; The database; Tests, CI and the build; The code itself.
- **Done when:** After pnpm build, rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l prints 0 (6 today), pnpm db:check exits 0, and a next analyze export shows /api/visit at or under 710 modules (1,890 today).
- **Platform:** The same client and beacons serve the platform admin and Kaizena Flow's site, so their cold starts lose the same 115 to 135 ms.

## 0.4 Load sharp, the font parser and the AI manager's engine when they are used

Thirteen server modules import sharp or opentype.js at the top, so the image library loads with the proxy and about 740 routes that draw no picture: one helper, src/server/sharp-load.ts, returns the module on first use, as browser.ts does for Chromium. Two admin action files load the AI manager's whole server side with every admin page: load src/server/owner-tools.ts when the assistant is first used. Build the tool catalogue's JSON Schema when tools are first listed, not at import (MCP_TOOLS goes).

- **Closes:** [AS-1](../findings/files/AS-1.md), [DP-2](../findings/dependencies/DP-2.md), [SG-7](../findings/server-module-graph/SG-7.md), [SF-9](../findings/server-functions/SF-9.md), [DP-11](../findings/dependencies/DP-11.md), [SG-15](../findings/server-module-graph/SG-15.md), [SG-10](../findings/server-module-graph/SG-10.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; The code itself.
- **Done when:** src/server/lazy-packages.scan.test.ts passes with 0 static value imports of sharp or opentype.js outside tests and sharp-load.ts (13 today), a next analyze export shows /admin/[store]/orders without src/server/owner-tools.ts at or under 2,050 modules (2,349 today), and rg -n 'MCP_TOOLS' src prints nothing.
- **Platform:** The platform admin's pages drop the same engine, and its assistant loads it on first use like a store's.

## 0.5 Cut the import cycle of 229 server files

229 files of src/server import each other in one cycle, so almost every route loads everything; 12 import lines close it. Start with the edges where shoppers' pages enter: customers.ts loads privacy-erasure inside deleteCustomer, the bought SQL fragment and storeObligations() move to small files of their own, and orders.ts loads providerOf at its one use. Then the rest, one file's edges per commit: four pure helpers move to src/lib and the async calls become lazy imports. In the same pass take two more edges off every store page: the three-line key reader that brings Stripe (encryptionKey leaves settings.ts) and the theme store section that brings sharp.

- **Closes:** [SG-1](../findings/server-module-graph/SG-1.md), [SF-1](../findings/server-functions/SF-1.md), [TC-2](../findings/tests-ci-build/TC-2.md), [SG-18](../findings/server-module-graph/SG-18.md), [SG-17](../findings/server-module-graph/SG-17.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; Tests, CI and the build.
- **Done when:** src/server/ratchet.baseline.json holds largestCycle 20 or less and catalogReach 417 or less (229 and 1,305 today), and a next analyze export shows /s/[store]/[market] at or under 1,800 modules and 8.2 MB with no stripe module and no src/server/theme-store.ts (2,419 modules and 11,944 KB today).
- **Platform:** The cycle is one graph: the platform's pages and routes leave it in the same commits.

## 0.6 Give code outside the admin its own small word modules, so the admin's words leave shoppers' routes

src/lib/admin-text.ts imports all 136 catalogue files in both languages, and 35 files outside the admin import it. So 802 of 830 server entries, the proxy and every storefront page load 2.8 MB of words. Add one module per area that outside code reads (18 areas, src/lib/admin-words/{stem}.ts) and move the 35 importers to them. A scan test keeps the registry out of everything but src/app/admin and src/components/admin.

- **Closes:** [FM-1](../findings/families/FM-1.md), [SF-5](../findings/server-functions/SF-5.md), [TX-1](../findings/interface-text/TX-1.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; Interface text; The code itself.
- **Done when:** src/lib/admin-text-reach.scan.test.ts passes with no value import of lib/admin-text outside src/app/admin and src/components/admin (35 files today) and at most 37 catalogue files in the closure of src/proxy.ts, /api/visit and the storefront layout (135 today).
- **Platform:** Kaizena Flow's public site and sign-in pages read their areas through the same small modules, and the platform's areas are among the 18.

## 0.7 Make a language translated by AI cost what it uses: at start, per document and per minute

The start hook (src/instrumentation.ts) loads 856 modules, among them the translating tools, ai.ts and auth.ts, then reads every AI-translated language whole before the first request, and each instance polls the table every minute. Split the interface-text reader from the translating tools, read at start with two statements whatever the number of languages, build a language on first read, and poll a one-row version stamp every ten minutes, only where such a language is served. uiTextsFor() sends the browser its 114 texts, not all 1,673: 93 KB to under 9 KB in every document of such a store. The search-cache prune leaves the five-minute list with step 0.22.

- **Closes:** [SG-5](../findings/server-module-graph/SG-5.md), [SF-3](../findings/server-functions/SF-3.md), [SD-7](../findings/storefront-server/SD-7.md), [TX-3](../findings/interface-text/TX-3.md), [TX-12](../findings/interface-text/TX-12.md), [TX-6](../findings/interface-text/TX-6.md), [SC-13](../findings/storefront-browser/SC-13.md), [PL-9](../findings/page-payload/PL-9.md), [DQ-12](../findings/queries/DQ-12.md), [DS-2](../findings/database-shape/DS-2.md), [CA-12](../findings/caching/CA-12.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; Interface text; What a shopper's browser gets; The database.
- **Done when:** In src/server/languages.int.test.ts uiTextsFor(lang) holds exactly the 114 browser keys in under 9,000 bytes for a fully translated language (92,809 today), a unit test shows startUi() issuing 2 statements, and the review's import walk (step 0.1) counts 60 source files or fewer behind src/instrumentation.ts (383 today) with no src/server/ai.ts.
- **Platform:** Kaizena Flow's own site in more than one language (D312) reads through the same reader, so it gains the same start and the same document.

## 0.8 Take Supabase's client, zod and the builder's English off every signed-in screen

Three stray imports put 481 KB on 432 of 449 admin routes: typingIn() and AdminServiceWorker sit in files that pull in zod and the builder's English catalogue, and session.tsx imports the whole Supabase client for a listener. Move the two helpers to files of their own, take the English default of responsive-edit.tsx out of the keyboard sheet, and load the Supabase client with import() once the page is idle. Drop the 'setup' words area that every admin document carries and nothing reads. Kaizena Flow's public front page loads the same three through its sign-in link: check it in the same change.

- **Closes:** [AC-1](../findings/admin-browser/AC-1.md), [BN-1](../findings/client-bundles/BN-1.md), [BN-3](../findings/client-bundles/BN-3.md), [BN-4](../findings/client-bundles/BN-4.md), [DP-4](../findings/dependencies/DP-4.md), [TX-4](../findings/interface-text/TX-4.md)
- **Effort:** S. **Areas it moves:** What an owner's browser gets; Interface text; The code itself.
- **Done when:** After pnpm build, .next/diagnostics/route-bundle-stats.json shows /admin/[store] at or under 700,000 bytes (1,194,862 today), no route's first-load chunks hold 'GoTrueClient' (432 routes today), 'Set for {size}' is only on the builder's routes (423 today), and 'ZodError' is in at most 160 routes (432 today).
- **Platform:** The frame is shared: every /admin/platform screen drops the same 481 KB.

## 0.9 Load an editor, a catalogue or the AI's tool tables only on the screens that draw them

Lists, previews and editors share one views file, so 13 previews and the page lists load the 3.3 MB builder. Orders, customers, deals and the product editor load the rich text editor for custom fields the store may not have: 34 screens outside the builder. Split the views file, and load the custom-field editor with next/dynamic where a screen draws it. The Work invoice screen takes its words as props, not the whole admin catalogue in one 1.7 MB chunk. The AI manager's chat keeps tool labels and page names only, not every tool definition and the admin map.

- **Closes:** [AC-2](../findings/admin-browser/AC-2.md), [BN-14](../findings/client-bundles/BN-14.md), [AC-3](../findings/admin-browser/AC-3.md), [BN-5](../findings/client-bundles/BN-5.md), [DP-5](../findings/dependencies/DP-5.md), [AC-7](../findings/admin-browser/AC-7.md), [BN-7](../findings/client-bundles/BN-7.md), [AC-8](../findings/admin-browser/AC-8.md), [BN-15](../findings/client-bundles/BN-15.md), [AI-4](../findings/ai-calls/AI-4.md)
- **Effort:** M. **Areas it moves:** What an owner's browser gets; AI calls; The code itself; Interface text.
- **Done when:** After pnpm build, route-bundle-stats.json shows no route outside the builder's family with 'ProseMirror' in its first-load chunks (34 today, and 13 previews), no first-load chunk over 600,000 bytes (one of 1,704,595 today), and e2e/signed-in/ai-manager-panel.spec.ts counts at most 130,000 bytes of script on first opening the AI manager (496,206 today).
- **Platform:** The platform's page lists, previews, builder and AI manager are the same files, and Work's account-level invoice screen is the one named.

## 0.10 Stop prefetching what a press cannot use: other views, links that leave their layout, the admin's rail

Set prefetch off on the language, currency and country links (src/components/view-menu.tsx: a press never opens the page they fetch), on links that leave their root layout, on the footer's legal links and on the six links from Kaizena Flow's pages to /admin and to stores. In the admin, the rail and the rows of every list fetch when the pointer or focus reaches a link, and View store never. Today a phone home page read to the footer makes 47 router requests, 24 of them for other views; an admin screen makes 23 to 46, and about 25 again after every save.

- **Closes:** [PF-2](../findings/prefetching/PF-2.md), [PL-3](../findings/page-payload/PL-3.md), [SC-1](../findings/storefront-browser/SC-1.md), [PF-11](../findings/prefetching/PF-11.md), [PL-4](../findings/page-payload/PL-4.md), [BN-2](../findings/client-bundles/BN-2.md), [CA-4](../findings/caching/CA-4.md), [CS-8](../findings/styles/CS-8.md), [CA-5](../findings/caching/CA-5.md), [PF-5](../findings/prefetching/PF-5.md), [PF-6](../findings/prefetching/PF-6.md), [AC-12](../findings/admin-browser/AC-12.md)
- **Effort:** S. **Areas it moves:** What a shopper's browser gets; What an owner's browser gets; What the server loads and asks; Styles.
- **Done when:** e2e/prefetch.spec.ts passes with 0 router prefetch requests for another view on the phone home read to the footer (24 today) and at most 23 in all (47), and 0 requests to /admin after loading / (2 and one stylesheet today); e2e/signed-in/prefetch.spec.ts counts 0 in the 3 s after the admin home loads (28 today) and at most 2 after hovering one rail link.
- **Platform:** The platform admin's rail is the same component, and Kaizena Flow's own front page is the page that stops fetching /admin.

## 0.11 End the prefetch loop on /s/ addresses, and write both router settings down

On the local build and in CI, listing and search pages at /s/{store} addresses ask for one link's @drawer/[...rest] segment about 165 times a second without end. Set optimisticRouting: false in next.config.ts, with the reason and when it may go, and hold it with a spec that counts requests after load. Write partialPrefetching: false beside it as a recorded choice: unset, Next warns on every build and start, and the next major release will choose for the app. Step 2.4 decides whether to adopt it.

- **Closes:** [PF-1](../findings/prefetching/PF-1.md), [SC-9](../findings/storefront-browser/SC-9.md), [CA-6](../findings/caching/CA-6.md), [CA-7](../findings/caching/CA-7.md)
- **Effort:** S. **Areas it moves:** What a shopper's browser gets; What the server loads and asks; Tests, CI and the build.
- **Done when:** e2e/prefetch.spec.ts 'a store page goes quiet' passes in CI's e2e job on its three pages (fewer than 60 router prefetch requests in the 3 s after load and none in the next 2 s; the search page makes 624 in 4 s today), and pnpm build prints no partialPrefetching warning.
- **Platform:** The platform has no listing at an /s/ address of its own; load the theme store's list in the same spec.

## 0.12 Make no server call after load for a visitor with nothing to fetch

Every store page asks /wishlist/saved, a function call and a proxy run for a 15-byte answer: ask only when a marker cookie says the visitor has saved something, and list the cookie in KNOWN_COOKIES. Every page with a product grid loads the tile island and asks /api/shop/tiles for stock with three statements, though both tile switches are off by default: draw no island and make no call while they are off. The search results page posts for suggestions nobody typed for: ask after a key or a focus.

- **Closes:** [SC-10](../findings/storefront-browser/SC-10.md), [PL-7](../findings/page-payload/PL-7.md), [SD-15](../findings/storefront-server/SD-15.md), [SC-12](../findings/storefront-browser/SC-12.md), [PL-8](../findings/page-payload/PL-8.md), [SD-14](../findings/storefront-server/SD-14.md), [PL-14](../findings/page-payload/PL-14.md)
- **Effort:** S. **Areas it moves:** What a shopper's browser gets; What the server loads and asks; The product's surface.
- **Done when:** docs/audits/bloat-review-2026-11/scripts/measure-routes.mjs shows 0 requests to /wishlist/saved on all 12 store pages for a new visitor (1 on each today), 0 to /api/shop/tiles on /s/demo/no and /s/demo/no/products with the tile switches off, and 0 POST before a press on /s/demo/no/search?q=lampe, each held by an assertion in e2e/wishlist.spec.ts, e2e/shop-components.spec.ts and e2e/search.spec.ts.
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans, not goods, so its site has no wishlist, tile stock or product search to call for.

## 0.13 Send shoppers' first scripts only what the page draws

Every store route's first scripts carry the admin's common words, the features table, the purposes of 38 cookies in four languages, an unused library, and small parts a plain page never draws (the theme preview stage, the platform's language switch). Split the cookie patterns from their texts (src/lib/cookie-patterns.ts), keep the admin's words and the features table on the server, and load the filter dialog only where a listing draws it. On the product page move cartView() to a server file, so the cart's forms leave its scripts, and load a picker only for the product's own kind.

- **Closes:** [SC-3](../findings/storefront-browser/SC-3.md), [PL-10](../findings/page-payload/PL-10.md), [BN-10](../findings/client-bundles/BN-10.md), [TX-5](../findings/interface-text/TX-5.md), [TX-8](../findings/interface-text/TX-8.md), [SC-11](../findings/storefront-browser/SC-11.md), [SC-4](../findings/storefront-browser/SC-4.md), [PM-11](../findings/page-builder-model/PM-11.md)
- **Effort:** M. **Areas it moves:** What a shopper's browser gets; Interface text; The page builder's model and a built page.
- **Done when:** The script tags of the server's HTML, nomodule left out, total at most 615,000 bytes raw for /s/demo/no (680,264 today) and at most 735,000 for /s/demo/no/p/demo-keramikkopp (777,785), and none of them holds 'Sell to businesses', 'Waiting for payment' or 'Kommer ihåg om du valde ljusa'.
- **Platform:** Kaizena Flow's site pages share these first scripts and lose the same 48 to 65 KB.

## 0.14 Cut what an idle tab, a save and a menu cost in the admin

The store menu is rebuilt with 220 permission lookups on every shell render, 125 ms of blocking CPU: memoise the answers in src/lib/store-nav.ts. At least 39 saves draw the route twice, because the browser calls router.refresh() after an action that already refreshed: remove the second. Progress polls (refresh-while.tsx, pack-pictures.tsx) stop in hidden tabs and ask their job, not for a whole redraw. The notice badge's count runs two statements, not four, and asks less often after an answer of zero.

- **Closes:** [AD-1](../findings/admin-server/AD-1.md), [AD-13](../findings/admin-server/AD-13.md), [AD-9](../findings/admin-server/AD-9.md), [AC-13](../findings/admin-browser/AC-13.md), [PL-11](../findings/page-payload/PL-11.md), [AI-12](../findings/ai-calls/AI-12.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; What an owner's browser gets.
- **Done when:** The count test in src/lib/store-nav.test.ts shows 110 lookups per menu build (220 today), a scan test holds client router.refresh() calls in the admin at about 50 (90 today) with 0 after an action that always refreshes, and a signed-in spec with a clock sees at most 2 requests to /admin/account/notices/feed in ten minutes from an untouched tab (10 today).
- **Platform:** The platform admin uses the same shell, menu builder and notice feed.
- **The owner's question first:** May the notice badge in a tab nobody touches be up to ten minutes late (60 requests an hour become 6)? The statement cuts need no answer.

## 0.15 Read the products, customers and stores lists a page at a time

The Products list sends every product of the store to the browser (about 0.9 KB a product, no limit in listAdminProducts()), and it reads the whole editor context and a per-product check it does not show: 16 or more statements. The customers list groups every order before it cuts to 100, and the platform's Stores list loads everything. Give each a page of 100 with a count and a next page (code review steps 1.13 and 2.10), and let the products list read only what it shows.

- **Closes:** [AD-7](../findings/admin-server/AD-7.md), [AC-14](../findings/admin-browser/AC-14.md), [AD-10](../findings/admin-server/AD-10.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; What an owner's browser gets.
- **Done when:** With a store seeded with 500 products the Products document is under 300,000 characters and says '100 of 500', rg -c getEditorContext 'src/app/admin/(gated)/[store]/products/page.tsx' prints nothing, and an integration test shows listCustomers() for a store with 150 customers returning 100 rows and the count.
- **Platform:** The platform's Stores list is one of the three lists and pages the same way.

## 0.16 Stop asking for what does not change: the store's slug, the AI connection, the theme cards, the hosts list

select slug from commerce.stores where id is written by hand in 27 places and is production's most-called statement (560,090 calls in 78 days): use one cached helper, refreshed when a sandbox is kept. Screens and polls that only draw a button fetch the whole AI connection, key and month's cost included (12.4 reads per AI call): give them aiAbilities() from a 60-second memo with no key, sum the month's AI cost from daily rows plus today, and let search read the memo, with a search_ai budget taken only on a cache miss. A store's AI settings refresh that store's tag, not AI_TAG for every store (319 cached entries today). A theme's neighbours read the cached card list, and the hosts list is parsed once per instance, not once per link.

- **Closes:** [CP-2](../findings/copied-code/CP-2.md), [SD-10](../findings/storefront-server/SD-10.md), [CA-9](../findings/caching/CA-9.md), [DQ-9](../findings/queries/DQ-9.md), [AI-2](../findings/ai-calls/AI-2.md), [DQ-4](../findings/queries/DQ-4.md), GAP-ai-1, [SD-16](../findings/storefront-server/SD-16.md), [CA-11](../findings/caching/CA-11.md), [CA-13](../findings/caching/CA-13.md), [SF-12](../findings/server-functions/SF-12.md)
- **Effort:** M. **Areas it moves:** The database; What the server loads and asks; AI calls; The code itself.
- **Done when:** rg -c 'select slug from commerce[.]stores where id' src --glob '!*.test.ts' sums to at most 3 (27 today), after a build grep -rl 'ai-providers' .next/server/app --include='*.meta' | wc -l prints 0 (319 today), and an int test sends 200 different searches from one visitor in a minute and counts at most the budget's model calls, with 0 reads of commerce.ai_providers for a repeated search.
- **Platform:** The provider read keeps its platform branch, and the platform's own AI settings refresh the platform's tag only.

## 0.17 Work the cart and a shopper's facts out once per request, with no read for a feature that is off

The cart page calls cartSummary() twice per view, and each call sends 5 statements to learn that bonus, referrals and checkout rules are not in use. getCustomer(), getCartCount() and stock are read two to four times in one render. Run them through perRequest() (src/server/request-memo.ts), and skip the bonus, referral and rule reads while the store's features do not include them.

- **Closes:** [SD-11](../findings/storefront-server/SD-11.md), [FT-15](../findings/features/FT-15.md)
- **Effort:** S. **Areas it moves:** What the server loads and asks; The product's surface.
- **Done when:** cart-contents.test.ts asserts cartSummary is called once per cart render and ./bonus is not called for a store with features ['shop'], and with a cart cookie one GET of a store's home reads commerce.cart_lines once (twice today).
- **Platform:** Store-only by the house rule's exception: Kaizena Flow sells plans through Stripe and draws no cart.

## 0.18 Filter a store's rows the way its index can serve

Postgres cannot answer store_id is not distinct from $1 from an index, so the hottest reads scan every store's rows: about 1.2 billion rows in 78 days on pages, cookie_scans and terms (122 uses in 40 files). One owned() helper writes store_id = $1 for a store and store_id is null for the platform, and the ratchet counts the old wording per file. The cookie scan's every-minute due check gets two indexes on the expression it filters by, and a failing site backs off. Do it before the new page reads of 0.19 and 2.19 are written, so they are born right.

- **Closes:** [DQ-8](../findings/queries/DQ-8.md), [DS-7](../findings/database-shape/DS-7.md), [PM-4](../findings/page-builder-model/PM-4.md), [CR-6](../findings/scheduled-work/CR-6.md)
- **Effort:** M. **Areas it moves:** The database; The page builder's model and a built page; Scheduled work.
- **Done when:** The ratchet's count of 'store_id is not distinct from' in src/server is at most 3 commented column-to-column lines (122 today), a plan test on a seeded table of 200 owners shows an index scan for one owner's pages, and in production seq_tup_read on commerce.cookie_scans grows by under 1 M a day (about 21 M today).
- **Platform:** The is-null branch of owned() is the platform's: its pages, terms and cookie scans are found by index too.

## 0.19 Read one page, not all of them

listPublishedPages() (src/server/pages.ts) selects every published page of a store with its whole content. It has 35 callers; 13 keep one page by id and most of the rest want slugs or titles. It is 781 s of the app's listed statement time: 29 documents a call, 79,778 calls in 78 days. Add publishedPageById(owner, id), cached per page, and a page index (id, slug, titles, dates, flags), and move the find-by-id callers, the legal links, the platform's frame, robots, the sitemaps and llms.txt to them.

- **Closes:** [CA-3](../findings/caching/CA-3.md), [SD-4](../findings/storefront-server/SD-4.md), [DQ-2](../findings/queries/DQ-2.md), [PM-2](../findings/page-builder-model/PM-2.md)
- **Effort:** M. **Areas it moves:** What the server loads and asks; The database; The page builder's model and a built page.
- **Done when:** rg -c 'listPublishedPages(' over src without tests gives at most 14 lines (37 today) with no caller that picks one page by id after it, and after a build no prerendered entry of the demo store keeps the page list (45 of 261 today).
- **Platform:** Kaizena Flow's own pages are read through the same two functions with a null owner, and src/server/platform-navigation.ts is one of the callers moved.

## 0.20 Shed the database's dead weight: the scheduler's log, 13 duplicate indexes and the dead objects

pg_cron's run log is 564 MB of the 731 MB database and nothing prunes it: a daily pg_cron job deletes rows older than seven days, and the backlog is emptied once. Thirteen indexes duplicate another (orders carries 34, five of them starting with store_id, placed_at): drop them, concurrently on the hot tables as D569 says, and add src/db/index-duplicates.test.ts, which compares the two places indexes are declared. Drop the unused idempotency_keys table and its enum. The leftover commerce_legacy schema (34 tables named by no code) goes after a last dump, on the owner's word. All of it is cheapest while the tables are small.

- **Closes:** [CR-5](../findings/scheduled-work/CR-5.md), [DS-8](../findings/database-shape/DS-8.md), [DS-9](../findings/database-shape/DS-9.md), [DS-15](../findings/database-shape/DS-15.md), [DS-14](../findings/database-shape/DS-14.md)
- **Effort:** M. **Areas it moves:** The database; Scheduled work.
- **Done when:** In production select min(end_time) from cron.job_run_details is never older than 8 days and the size by schema in the daily reading of step 0.1 shows the cron schema under 80 MB (564 MB today), and src/db/index-duplicates.test.ts returns 0 rows (11 today) with 32 indexes on orders.
- **Platform:** One database: the platform's tables are in the duplicate test, and the prune covers the platform's jobs.
- **The owner's question first:** May the commerce_legacy schema, kept since 24 September as a renamed copy of the single-store tables, be dropped after a last dump?

## 0.21 Make AI upkeep cost one statement when nothing changed: knowledge, pictures, alt texts, product vectors

Four jobs walk every store every five minutes to find nothing. The knowledge job reads about 40 whole pages a call and re-cuts wordless pages for ever (91,200 empty transactions in 78 days): a small commerce.knowledge_sources table records what was cut, and changed pages are chosen in SQL before any document is fetched. The picture job re-checks where each picture is used every day by text-searching every page (13,414 date-only updates on 468 rows): use one change stamp per site. The alt-text job lists a site only while a picture is due, and gives up after five tries. The product index embeds on save and scans hourly.

- **Closes:** [CR-4](../findings/scheduled-work/CR-4.md), [DQ-6](../findings/queries/DQ-6.md), [DS-5](../findings/database-shape/DS-5.md), [PM-3](../findings/page-builder-model/PM-3.md), [DQ-3](../findings/queries/DQ-3.md), [DS-10](../findings/database-shape/DS-10.md), [AI-13](../findings/ai-calls/AI-13.md), [AI-5](../findings/ai-calls/AI-5.md)
- **Effort:** M. **Areas it moves:** Scheduled work; The database; AI calls; The page builder's model and a built page.
- **Done when:** A new case in src/server/chat.int.test.ts runs syncPageKnowledge twice over a store with a wordless published page and counts zero transactions and zero rows read from published on the second run, sitesDueForAltText() in src/server/alt-texts.int.test.ts returns no row for a finished site, and in production a day after the deploy n_tup_upd on commerce.media_embeddings rises by fewer than 100 with no content change.
- **Platform:** Kaizena Flow's own site has chat and pictures on null-store rows: the same jobs serve it and go idle the same way.

## 0.22 Stop three jobs re-asking on every run: invoices, the listings' check and the prunes

The invoice job re-asks the same waiting stores every five minutes for 120 days (about 127 calls a day): list a store only when commerce.invoice_eligibility and commerce.invoice_readiness say something can be issued now, the longest-waiting first. The listings' check hashes every product each run and asks the model again for a listing it could not answer: record a try, stop at the first provider error, and read only reworded products. Seven prunes move from the five-minute list to the daily route as tracked('daily.<name>', 86400), two run-log prunes go hourly, and the delivery prune leaves the every-minute route.

- **Closes:** [CR-9](../findings/scheduled-work/CR-9.md), [DS-3](../findings/database-shape/DS-3.md), [CR-15](../findings/scheduled-work/CR-15.md), [FT-3](../findings/features/FT-3.md)
- **Effort:** M. **Areas it moves:** Scheduled work; The database; The product's surface.
- **Done when:** The runJobs() block of src/app/api/cron/cart-reminders/route.ts has 69 entries (78 today), the new cases in invoice-issue.int.test.ts and content-moderation.int.test.ts pass, and in production calls of select commerce.issue_waiting_invoices($1, $2) rise by fewer than 10 a day (about 127 today).
- **Platform:** The listings' check is the platform's own duty under the DSA, and the daily prunes cover the platform's tables.

## 0.23 Fix pictures and files before real ones are stored: thumbnails, an 800 px copy, long lifetimes

Search suggestions ask Next's image service for uploaded pictures and get a 400, so real stores would show empty thumbnails: set images: { unoptimized: true } in next.config.ts, which also closes the open /_next/image endpoint. Keep an 800 px copy of every picture, so a 3x phone does not take the 1,600 px file for a tile (about 53 KB less per tile). Give every file with a fixed address a long lifetime: cacheControl on all 9 uploadToSignedUrl calls, the font file route kept at the CDN, public files a day. Fetch no hidden flag, and slim the six flags to under 20 KB. A lifetime and a size are fixed when a file is stored, so this is cheapest before any library exists.

- **Closes:** [AS-4](../findings/files/AS-4.md), [AS-9](../findings/files/AS-9.md), [AS-12](../findings/files/AS-12.md), [AS-5](../findings/files/AS-5.md), [AS-11](../findings/files/AS-11.md)
- **Effort:** M. **Areas it moves:** The code itself; What a shopper's browser gets.
- **Done when:** On the built app /_next/image answers 404 (200 today), the new assertion in e2e/search.spec.ts shows a suggested product's uploaded thumbnail, the new test in e2e/performance.spec.ts shows the first tile's currentSrc is the 800 px file at 390 px and 3x, and rg -n 'uploadToSignedUrl' src/components shows cacheControl on all 9 calls (0 today).
- **Platform:** Kaizena Flow's own media library and the theme photographs are stored through the same uploads and get the same sizes and lifetimes.

## 0.24 Give the admin's colour names a value on public pages

Thirteen colour roles exist only inside the admin, yet 20 uses in seven shop and site files and 125 in eleven admin parts drawn on public pages read them. The visible fault: the main button on Kaizena Flow's status and report pages has no fill. Replace the role names with the site's own in the seven files (border-line becomes border-border, and so on), and give each role a value under html:not([data-admin]) in the site's CSS, in light and in dark. This also clears the two blockers of the stylesheet split in step 2.6.

- **Closes:** [CS-7](../findings/styles/CS-7.md), [CS-9](../findings/styles/CS-9.md)
- **Effort:** S. **Areas it moves:** Styles.
- **Done when:** rg with the role pattern counts 0 uses in src/components and src/app outside the admin folders (20 today), and on the built app the submit buttons of /report and /status have a computed background-color other than rgba(0, 0, 0, 0), held by an e2e check.
- **Platform:** The status and report pages are Kaizena Flow's own: this is where the fault shows today.

## 0.25 Delete what nothing uses and what is kept from before

331 exports are used by nothing and three files are reached only by tests (about 950 lines), 34 interface texts are read by no code, and a rule still describes one of the dead files. Delete them from the review's lists, after checking each against the scan's blind spots. Remove the eight old admin redirects (LEGACY_WORK_REDIRECTS, LEGACY_THEME_REDIRECTS), the bookings and deliveries twin switch, and the daily job's second schedule in vercel.json, which can run 40 functions twice in the same minute. Replace the 26 MB simple-icons package with the 27 paths it is used for.

- **Closes:** [DD-3](../findings/unused-code/DD-3.md), [DD-8](../findings/unused-code/DD-8.md), [TX-11](../findings/interface-text/TX-11.md), [DD-11](../findings/unused-code/DD-11.md), [CR-12](../findings/scheduled-work/CR-12.md), [DP-8](../findings/dependencies/DP-8.md)
- **Effort:** M. **Areas it moves:** The code itself; Interface text; Scheduled work.
- **Done when:** node docs/audits/bloat-review-2026-11/scripts/unused-code.mjs reports 0 unused exports (262 today), rg -n 'LEGACY_(WORK|THEME)_REDIRECTS|legacyModule|setBookingsModule|setDeliveriesModule|simple-icons' src next.config.ts package.json prints nothing, and vercel.json no longer schedules the daily job.
- **Platform:** The platform's exports and texts are in the same lists; the redirects removed are store admin paths, and the platform has none of them.

## 0.26 Run each check once, and let a test load only what it uses

One push type-checks the same commit five times (three hide inside CI's builds), checks the schema in three shards and lints 6,213 files with no cache. Turn the type check off in the e2e, hosts and signed-in builds, run the schema check in one shard, and give lint a cache in package.json and in the static and pending jobs. Split the unit tests into three Vitest projects, so the admin's English loads only where parts are drawn, the test database only where it is opened, and plain files share a worker (0.48 s to 0.14 s a file). Pre-bundle Drizzle for the tests. Stop replaying and quoting the 789 archived migrations: src/db/migration-files.ts goes, and the rule in CLAUDE.md that names it is corrected.

- **Closes:** [TC-1](../findings/tests-ci-build/TC-1.md), [TC-12](../findings/tests-ci-build/TC-12.md), [TC-3](../findings/tests-ci-build/TC-3.md), [TC-13](../findings/tests-ci-build/TC-13.md), [DD-13](../findings/unused-code/DD-13.md), [DD-10](../findings/unused-code/DD-10.md)
- **Effort:** M. **Areas it moves:** Tests, CI and the build; The code itself.
- **Done when:** On the next push without a migration tsc runs in two jobs only and 'Migrations match the schema' in one, a second pnpm lint on an unchanged tree finishes in under 15 s, pnpm test passes with the same 1,215 files and setup under 10% of Vitest's duration line (40% today), and rg -l 'readMigration|findMigration|migrationHistory' src --glob '*.test.ts' | wc -l prints 0 (17 today).
- **Platform:** CI and the test suites are one for stores and platform: nothing is separate.

## 0.27 Leave a map in CLAUDE.md, wrap the rules' long lines and keep history out of searches

Every session and subagent loads CLAUDE.md's 295-line feature index (43,361 bytes in all), of which a change needs two to four lines. Replace it with a map of the seven rule files and a three-line look-up, and change src/lib/rules-index.test.ts so it no longer asks for a line per rule. 156 lines of docs/rules hold 52% of the rules' bytes in lines over 500 characters, which the search tool cannot show: wrap them with a script that proves no word changed. Three ignore files keep 22 dated docs and 791 archived migration files out of default searches.

- **Closes:** [DC-1](../findings/written-rules/DC-1.md), [DC-4](../findings/written-rules/DC-4.md), [DC-7](../findings/written-rules/DC-7.md), [DC-13](../findings/written-rules/DC-13.md)
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** wc -c -l CLAUDE.md prints under 15,000 bytes and 200 lines (43,361 and 448 today), awk 'length($0)>500' docs/rules/storefront.md docs/rules/admin/*.md | wc -l prints 0 (156 today), and rg --files supabase | wc -l prints 5 (796 today).
- **Platform:** The rules cover stores and platform alike, and the map names the file that holds the platform's rules.
- **The owner's question first:** CLAUDE.md is your instruction file: may its 295-line feature index go, leaving a map of the seven rule files and a three-line look-up (44 KB to under 15 KB per session)? Without a yes the rules area cannot reach an A.

## 0.28 Make the rules say what is so, and claim a decision's number on main before citing it

CLAUDE.md sends architectural work to docs/plan.md, a 73 KB plan from before multi-tenancy: point it at docs/platform.md, fix the five stale code names and the one drifted list, and add a name check to the docs scan. Keep every tracker to a line a step (15 Progress rows are over 500 characters), with the open PSI items in one section. Retire the Migration versions list, frozen since 4 October, and the order to add to it. Sessions working at once take the same decision number (5 of 24 merges renumbered one): scripts/claim-decision.mjs claims the number on main first, and the 197 stray rows go back in the table.

- **Closes:** [DC-5](../findings/written-rules/DC-5.md), [DC-8](../findings/written-rules/DC-8.md), [DC-6](../findings/written-rules/DC-6.md), [DC-10](../findings/written-rules/DC-10.md), [DC-12](../findings/written-rules/DC-12.md)
- **Effort:** M. **Areas it moves:** The written rules.
- **Done when:** rg finds neither the docs/plan.md instruction in CLAUDE.md nor the order to record a migration's version in CLAUDE.md, README.md, docs/capacity.md and docs/ci-migrations.md (1 and 3 today), no Progress row of docs/audits/code-review-2026-11.md is over 300 characters, and over the next 100 commits on main git log --merges --format=%s | rg -ci 'renumber|taken on main|decision is D' prints nothing.
- **Platform:** docs/platform.md becomes the first pointer, so a session starts from the multi-tenant picture that includes the platform.
- **The owner's question first:** After a migration, should 'advisors checked, nothing new' still be written down, and where? The check itself stays either way; today 205 of 564 decision rows carry the note.
