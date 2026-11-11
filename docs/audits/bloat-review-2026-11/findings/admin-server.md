# What the server does for an admin navigation (AD)

Part of `docs/audits/bloat-review-2026-11.md`. One reviewer's reading of this area, 11 November 2026, commit 0bd814c. A tick (✓) marks a
finding checked a second time against the code, the build or production; the others were not (the second reviewers did not run: see
the review's section 6). "Step" is the step of the plan that closes the finding.

**In short.** The admin's server side is moderately bloated, and the bloat is in the shell and the two home screens, not in the lists. At today's size (60 stores, 102 orders) no single query is slow; what is wasteful is how much is redone: the store shell costs 67 to 129 ms of pure CPU to rebuild its menu (measured), reads the same membership three times, and is redrawn in full after every save (599 refresh() calls) and every poll tick. The store Home fires at least 30 statements before its first content shows, six of them against tables that have never held a row in production and one whose result is thrown away. Lists, Suspense use and cache tags are mostly well made; the costs found grow with features built, not with use.

## Measured

| Measure | Value | How |
|---|---|---|
| CPU to build the store menu on one shell render | 129 ms with every feature on, 115 ms with the shop only, 67 ms for a website; 0.1 to 0.2 ms when the permission lookup is memoised | Node 22 micro-benchmark of storeTabs()+storeAreas() exactly as layout.tsx:91-92 calls them, 50 to 100 runs after warm-up, repeated 3 times (127, 129, 135 ms), on this 2.3 GHz Xeon. Script: scripts/nav-bench3.mjs |
| Permission lookups per store shell render | 220 (110 menu items, looked up once for the tabs and once for the sidebars); each matchPath() call 0.56 ms | Counter around canOpen in the same benchmark; admin-map.ts:1472 filters and sorts the 416-page table on every call |
| Statements before the store Home shows its first content | at least 30 (up to about 46 with Work on, Norwegian books and a plan with a hard limit), plus 2 for the guard | Counted by reading [store]/page.tsx:55-60, control-center.ts:61-303 (1 + 20 in one batch + per-store reads), setup.ts:56-79 (6), demo-content.ts:121 (1) |
| Statements on a hard load of the store shell itself | 6 before the frame paints (account, member, stores, support count, trial pause, Kaizen Life link), 5 of them one after another; 2 more after the response | Read [store]/layout.tsx:60-88, admin-shell-parts.tsx:52, auth.ts:137 and 329, connect.ts:265 and 540 |
| Platform home statements, all awaited before the page paints | 18 on the page plus 6 in the layout; pending requests are counted 4 times with 2 different definitions | Counted from platform/page.tsx:38-44, platform-overview.ts, billing.ts:104-122, platform-briefing.ts:86-115, plan-analytics.ts:46-82, platform/layout.tsx:67, admin-shell-parts.tsx:25 |
| Places that redraw the whole route (every layout and the page) | 599 server refresh() calls in 176 files under src/app/admin; 106 router.refresh() calls in 57 files; 6 polling components (5 to 20 s) | rg counts of refresh() not preceded by a dot, and of .refresh(); Next's guide server-actions.md lines 36-50 says refresh, updateTag and revalidatePath re-render the current route in the action's response |
| Unchanged shell data re-sent on each redraw (store owner) | 51 KB of JSON in English, 63 KB in Norwegian (menu 17.4 KB, common+setup+shell words 20.3 KB, assistant words 13.7 or 24.5 KB); about 14.5 to 18 KB gzipped | JSON.stringify of the same values the layouts pass to client components (adminTexts(), storeTabs(), storeAreas()), gzipSync per part; not measured on the wire |
| Products list statements for a member who may edit | 15, of which 9 are read and not used on that page | Counted from products/page.tsx:90-96 and products.ts:126-157; the page uses only editor.terms and three fields of editor.markets (lines 105-106) |
| Membership reads per request | 3 on a store hard load, 4 at the owner level | auth.ts:329 (memberRow), auth.ts:272 (listStores), control-center.ts:61, support-desk.ts:131, books-clients.ts:35 |
| Notice poll per open owner tab | 60 requests an hour, 4 statements each (one of them discarded), plus one Supabase Auth call each for an account without two-step | ai-notices.ts:13 NOTICE_POLL_MS = 60 000; notices/feed/route.ts:27-35; assistant-notices.ts:146-158 |
| Loading and streaming coverage | 84 loading.tsx files under the signed-in admin; the store Home streams 6 secondary sections; the platform Home streams none | find for loading.tsx; Suspense boundaries read in [store]/page.tsx:116-169 and platform/page.tsx |

## Well made, and should stay

- Orders list: keyset paging at 50 rows, a count capped at 10,000, named columns, the list behind Suspense, and a server-drawn view so its words are not sent whole (order-list.ts:181-233, orders/page.tsx:58-60).
- The store itself is read through 'use cache' with a per-store tag and an hours life (stores.ts:216-221); the admin does not re-read it per request.
- Guard reads are shared inside one request with React cache(): readSession, getAccount, loadMembership (auth.ts:121, 215, 354). A page and its Suspense children calling requirePermission twice cost one read.
- The member's row is read on every request on purpose (auth.ts:323-327, a security decision is never stale). Nothing here proposes caching it.
- The store Home streams its six secondary cards behind Suspense (drafts, today, move watch, failed alerts, analytics alerts, briefing offer).
- The AI manager's panel loads its chat and starts its conversation only when opened (ai-manager-launcher.tsx:105-127); the account menu's notice row mounts only while the menu is open (admin-menus.tsx:217).
- Saving a preference (colours, scheme, Basic or Advanced, language) writes one row and does not redraw the page (account/actions.ts:82-106).
- No save revalidates a whole layout by path: revalidatePath is called 4 times in 2 files, each for one page.
- Basic and Advanced (D454) is a client switch over the menu and hub cards; it does not make pages compute hidden cards.
- The cached Store object is not handed whole to client components by admin pages (17 components that receive it were checked; all are server components).
- A generic loading.tsx exists at the store and the platform level, with 82 fitted ones under them.
- Cron health on the platform home is one statement over commerce.cron_jobs (cron-runs.ts:122-124).

## Findings

### AD-1 The store menu is rebuilt with 220 slow permission lookups on every shell render

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/lib/admin-map.ts:1461-1479`, `src/lib/admin-map.ts:1375-1377`, `src/lib/permissions.ts:116-124`, `src/lib/permissions.ts:139-142`, `src/lib/store-nav.ts:388-401`, `src/lib/store-nav.ts:432-462`, `src/app/admin/(gated)/[store]/layout.tsx:82`, `src/app/admin/(gated)/[store]/layout.tsx:91-92`, `src/app/admin/(gated)/[store]/settings/page.tsx:21`, `src/app/admin/(gated)/[store]/website/page.tsx:21`, `src/server/owner-assistant.ts:362`
- **Evidence:** matchPath() filters the 416-page table and sorts 264 store pages on every call, and the sort runs a regex twice per comparison (pageParams). The layout calls storeTabs() and storeAreas(), each of which walks all 110 menu items through canOpenPath() -> permissionOfPath() -> matchPath(). Benchmarked in Node 22 after warm-up, three runs: 127 to 135 ms with every feature on, 115 ms with the shop only, 67 ms for a website; one matchPath() call is 0.56 ms. With the lookup memoised by path the same build takes 0.1 to 0.2 ms. The answer depends only on the code and the member's keys.
- **Cost today:** 67 to 129 ms of CPU per store shell render (measured on this machine), 61 to 67 ms more on the Settings and Website hub pages, and about 150 ms per pass when the AI manager filters the 264 store pages. A store that is not open does two lookups per item. Paid by: The server per request (function CPU), and the owner, who waits for it on every hard load, every save and every poll tick.
- **Fix:** In admin-map.ts sort the pages per area once at module load and reuse them. In permissions.ts keep permissionOfPath() results in a Map keyed by path and access (the page table is static). In the layout call storeSections() once and derive tabs and areas from it.
- **Saving:** About 65 to 130 ms of CPU per shell render, measured here (0.1 to 0.2 ms after). On Vercel the figure will differ with its CPU; estimate the same order.
- **Risk:** Low. Pure functions over a static table, already covered by admin-map.test.ts, store-nav.test.ts and the permissions baseline. The memo must be keyed on path and access only, never on the member.

### AD-2 The store Home runs 30 or more statements before it shows anything, some for nothing

- **Kind:** eager. **Effort:** M. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/app/admin/(gated)/[store]/page.tsx:55-60`, `src/server/control-center.ts:61-75`, `src/server/control-center.ts:100-259`, `src/server/control-center.ts:161`, `src/server/control-center.ts:290-303`, `src/server/setup.ts:56-79`, `src/server/usage.ts:56-66`, `src/server/usage.ts:161-166`, `src/server/turnover-watch.ts:42-50`, `src/app/admin/(gated)/(owner)/page.tsx:47`, `src/app/admin/(gated)/(owner)/page.tsx:76`, `src/db/client.ts:68`
- **Evidence:** controlCenter() runs 1 statement, then 20 in one Promise.all, then per-store reads for the threshold watch (1 to 4) and plan limits (1 to 11). The setup checklist adds 6 and demo content 1. The AI usage read (line 161) is used only by the owner's control center (owner page line 76); the store Home never reads center.ai. Six of the 20 read tables that production has never written a row to (order_edits twice, order_payment_terms, product_reviews, privacy_requests, returns with withdrawal_requests), per prod-db-stats.md. The file's own comment (lines 52-53) says 'never per store', yet lines 290-303 read per store. The pool holds 5 connections per instance, so the batch runs in at least 5 waves. The checklist's 6 reads run even when every step is done (the card is drawn only when remaining > 0).
- **Cost today:** At least 30 statements, up to about 46, held before the page's first content; on the owner's control center the per-store part grows by 2 to 15 statements per store. store_billing is read 4 times on one hard load (layout, checklist, control center, limits). Paid by: The database and the server per request; the owner waits for all of it before Home's header and figures appear.
- **Fix:** 1) Do not read AI usage when onlyStore is set. 2) Draw the header, the week's figures and latest orders from 6 statements, and move 'Needs your attention' and the checklist into their own Suspense sections, as the page already does for six others. 3) Fold the count-only attention reads into one statement that returns one row per store (as the books read at lines 246-258 already does with sub-selects). 4) Read the threshold watch and limits set-based for all stores, as the file's rule says. 5) Skip a feature's read when store.features has it off (reviews, books, payment terms).
- **Saving:** Estimate: first content after about 8 statements instead of 30 or more; about 20 fewer statements per Home view once the counts are one statement; the owner's control center stops growing per store.
- **Risk:** Medium-low. The attention list appears a moment after the header. The merged statement must keep each figure's permission rule (a figure only for a store where the member holds the key, lines 80-97).

### AD-3 Every admin request from an account without two-step calls Supabase Auth, and may write

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/server/auth.ts:132`, `src/server/auth.ts:144-153`, `src/server/auth.ts:158-175`
- **Evidence:** readSession() verifies the token, reads the account row, then for an aal1 session calls supabase.auth.getUser() over HTTP to list factors, on every request (React's cache only spans one request). Up to two small writes follow inside the same read. Every page navigation, every server action, every poll and every route handler in the admin goes through it.
- **Cost today:** One extra HTTP round trip per admin request for most store owners (those without a second factor), plus up to 2 writes. Not timed here; the code review rates it severity 2. Paid by: The server per request and the owner on every navigation.
- **Fix:** As the review says: use accounts.two_step_since as the fast path or keep the factors answer five minutes per user and clear it on enrol and remove; move the two writes into after().
- **Saving:** One HTTP call per admin request for accounts without two-step (estimate: tens of milliseconds each; not measured).
- **Risk:** Security-sensitive: the cached answer must be cleared when a factor is added or removed, and platform staff must still be held at the second step.
- **Already tracked:** code review step 3.8 (finding FV8): Open

### AD-4 The store shell reads one thing after another, and checks Stripe set-up on every render

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/app/admin/(gated)/[store]/layout.tsx:60-88`, `src/app/admin/(gated)/[store]/layout.tsx:68-73`, `src/app/admin/(gated)/[store]/layout.tsx:151`, `src/components/admin/admin-shell-parts.tsx:52`, `src/server/connect.ts:257-279`, `src/server/connect.ts:539-546`, `src/server/store-trial.ts:63-70`, `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md:156`
- **Evidence:** The layout awaits the member, then the account's stores (used for one footer link, line 151), then the support count, then the trial pause, each after the last; the account menu then awaits the Kaizen Life link with no Suspense. Next's guide says a top-level await in a layout holds the whole segment, children included. Nothing of the frame paints until all are done; the page's own loading.tsx sits inside the frame. On every render the layout also schedules ensureTestAccount() and ensureStorePaymentMethods() with after(): one statement each, and a Stripe API call per render while a Kaizen-made test account is not yet active (connect.ts:270-275). The second checks for payment methods added to Kaizen, which changes only at a deploy.
- **Cost today:** 5 round trips in a row before the frame can paint on a hard load, and 2 statements (sometimes a Stripe call) after every shell render, which includes every save and every poll tick. Paid by: The owner on each hard load and save; the server and database per shell render; Stripe's API quota in the unready case.
- **Fix:** Run the stores, support count, starter and trial reads in one Promise.all (they depend only on the member). Stream the Support badge, the banners and the Kaizen Life link behind Suspense. Add 'test account ready' to the cached store read and skip the after() when true. Move the payment-methods check to the Payments settings page and the existing payments job as one set-based statement, which keeps D23's aim.
- **Saving:** Estimate: 3 fewer sequential waits before the frame paints, and 2 fewer statements per shell render for every active selling store.
- **Risk:** Low. D20's promise (test purchases work without set-up) holds as long as a store whose test account is missing or not ready still runs the check.

### AD-5 Every save and poll re-sends 51 to 63 KB of unchanged shell words and menu

- **Kind:** oversize. **Effort:** M. **Confidence:** medium. **Step:** 2.6.
- **Where:** `src/app/admin/(gated)/layout.tsx:45`, `src/app/admin/(gated)/[store]/layout.tsx:114`, `src/app/admin/(gated)/platform/layout.tsx:83`, `src/app/admin/(gated)/[store]/page.tsx:117`, `src/app/admin/(gated)/[store]/products/page.tsx:114`, `src/components/admin/admin-text.tsx:33-36`, `src/lib/admin-text.ts:307-309`, `src/lib/store-nav.ts:432-462`
- **Evidence:** Layouts hand whole catalogue areas to client components as props. Measured as JSON: common+setup+shell 20.3 KB (7.0 KB gzip); the assistant area 13.7 KB in English and 24.5 KB in Norwegian, sent for every owner though the panel is closed until pressed; the menu's tabs and areas 17.4 KB, with each page address present three times. No client component reads the setup area through useAdminText (0 matches; pages pass those words as props), so its 6.9 KB is dead in every payload. The Home hands the whole home area (23.7 KB) to serve one streamed card, and the products list the whole products area (26.8 KB). A redraw after refresh() re-serialises all layouts.
- **Cost today:** 51 KB (English) to 63 KB (Norwegian) of JSON per shell redraw for a store owner, about 14.5 to 18 KB gzipped; 24 to 27 KB more per view on Home and Products. Server time to serialise and browser time to parse and reconcile it, on every save. Paid by: The owner's browser and the server per shell render.
- **Fix:** Drop 'setup' from the gate's provider. Hand the launcher only the words its closed button uses and fetch the assistant area with the chat it already loads on open. Hand a card its own slice (for example home.drafts), not the area. Send each menu address once and derive the tab's 'also' list in the client.
- **Saving:** Estimate from the measured parts: about 6.9 KB (setup) plus 12 to 23 KB (assistant) plus about 8 KB (menu) less per shell redraw, roughly half; and about 20 KB less on each Home and Products view.
- **Risk:** Low to medium. A part that reads a word no longer handed down falls back to English (admin-text.tsx:44-47); e2e/signed-in/admin-text-fallbacks.spec.ts exists to catch that.
- **Already tracked:** Partly: PSI PERF-01 (open) cuts the admin's shared scripts; the words re-sent as props on each redraw are not in it

### AD-6 The platform Home holds its first paint for 18 statements and reads whole lists to show a number

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/app/admin/(gated)/platform/page.tsx:38-44`, `src/server/platform-overview.ts:23-47`, `src/server/platform-overview.ts:58`, `src/server/billing.ts:104-122`, `src/server/ai-usage.ts:134-153`, `src/server/platform-briefing.ts:86-115`, `src/server/plan-analytics.ts:46-82`, `src/app/admin/(gated)/platform/layout.tsx:67`, `src/components/admin/admin-shell-parts.tsx:25-31`, `src/server/platform.ts:206-210`
- **Evidence:** The page awaits five loaders in one Promise.all with no Suspense. platformOverview() calls listPlans() (3 statements with per-plan and per-price sub-counts and the Stripe sync table) to show plans.length, and usageRows() (a grouped join over ai_usage, 19,104 rows in production, with prices, accounts and stores) to show two totals. planAnalytics(30) loads every billing line and plan move to sum them in code. Pending access requests are counted four times on a hard load: layout line 67, the level switcher's own cached copy, the overview and the snapshot. Two definitions are in use: platform.ts:208 leaves out unconfirmed self-serve requests, the overview does not, so the tab's badge and the Home's figure can disagree.
- **Cost today:** 18 statements before the page paints and 6 in the layout; 4 of the 24 count the same thing. Paid by: The platform's team on each visit; the database.
- **Fix:** Count plans with one count(*). Sum AI requests and failures in one aggregate without the joins. Use one pendingRequests() behind React cache() everywhere, with one definition. Put the month's figures and the 'last 7 days' section behind Suspense so the attention list paints first.
- **Saving:** Estimate: 18 statements to about 11, and the attention list after about 5.
- **Risk:** Low. Choosing one definition of 'waiting' changes one of the two numbers shown today.

### AD-7 The products list reads the whole editor context and a per-product check it does not need

- **Kind:** oversize. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/app/admin/(gated)/[store]/products/page.tsx:90-96`, `src/app/admin/(gated)/[store]/products/page.tsx:105-106`, `src/app/admin/(gated)/[store]/products/page.tsx:115`, `src/server/products.ts:126-157`, `src/server/vat-categories.ts:44-52`, `src/server/unit-price-gaps.ts:61-91`
- **Evidence:** For a member who may edit, the list calls getEditorContext(): 10 statements (economic operators, two location reads, terms, the VAT matrix, booking staff, places, hosts, layouts, VAT categories). The page uses terms and three fields of markets that are already in the cached store. ratesNow() calls commerce.vat_rate() for every country and category and the result is dropped. productsNeedingMeasure() returns titles, categories (a recursive query) and SKUs for every active product that passes commerce.unit_price_required(), a function call per product, while the default view uses only the count (line 115).
- **Cost today:** 9 unused statements per products-list view for editors, one of them a function call per country and category; one function call per active product per view for a notice's number. Paid by: The database and the server per view; the owner waits for the slowest of them before the list streams in.
- **Fix:** Call listTerms() alone and take markets from the store. For the notice use a count (or exists) and read the rows only when ?needs=unit-price is asked; skip it when no category of the store requires a unit price.
- **Saving:** Estimate: 15 statements to 6 per view for an editor.
- **Risk:** Low. The bulk panel needs only terms and markets (lines 105-106).
- **Already tracked:** no (the list's missing paging is code review step 1.13, see AD-10)

### AD-8 An account's memberships are read three or four times per request, in four shapes

- **Kind:** duplicate. **Effort:** M. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/server/auth.ts:271-281`, `src/server/auth.ts:328-340`, `src/server/support-desk.ts:130-139`, `src/server/books-clients.ts:32-41`, `src/server/control-center.ts:61-75`, `src/app/admin/(gated)/(owner)/layout.tsx:30-38`, `src/app/admin/(gated)/(owner)/stores/page.tsx:32`
- **Evidence:** listStores(), ownerDesks(), booksMemberships() and controlCenter()'s first statement each join store_members to stores (three also to store_roles) for the same account with slightly different columns and filters. The owner layout awaits them one after another (stores, desks, domains, books clients, support count: 5 sequential awaits), and the owner's Stores page calls listStores() directly instead of the cached storesOf(), so the layout's read is repeated. In a store, memberRow, listStores and the control center read the member's own row three times.
- **Cost today:** 3 to 4 near-identical statements per hard load and 5 sequential waits before the owner level's frame paints. Paid by: The database and the server per request; the owner on each hard load of /admin.
- **Fix:** One membershipsOf(account) behind React cache() that returns slug, name, status, role, kind, role permissions, time zone and the Work flag; derive the stores list, the desks, the books clients and the control center's store list from it. Keep memberRow() separate, as its rule requires. Run the remaining layout reads together.
- **Saving:** Estimate: 2 to 3 statements and 3 to 4 sequential waits per owner-level hard load.
- **Risk:** Medium-low. Each caller filters differently (closed, starter and sandbox stores); the shared read must carry the fields so each keeps its own filter.

### AD-9 Progress polls redraw the whole admin, and a notice poll runs in every owner tab

- **Kind:** eager. **Effort:** S. **Confidence:** high. **Step:** 2.6.
- **Where:** `src/components/admin/refresh-while.tsx:7-13`, `src/components/admin/cookie-scan.tsx:137`, `src/app/admin/(gated)/[store]/dream-factory/page.tsx:25`, `src/app/admin/(gated)/[store]/dream-factory/page.tsx:116`, `src/components/admin/pack-pictures.tsx:127-131`, `src/components/admin/ai-notices.tsx:29-53`, `src/components/admin/ai-manager-launcher.tsx:101-102`, `src/app/admin/(gated)/(owner)/account/notices/feed/route.ts:27-35`, `src/server/assistant-notices.ts:146-158`
- **Evidence:** RefreshWhile calls router.refresh() every 5 s (cookie scan), 6 s (Dream Factory), 10 s (page jobs, legal writing), 15 s (pack pictures) or 20 s (domains), and does not stop when the tab is hidden (LiveRefresh does). Next's use-router doc says refresh re-renders the route's Server Components, so each tick pays the whole shell of AD-1, AD-4 and AD-5 plus the page. Separately, the AI manager's button asks the notices feed every 60 s in every owner's tab: the route reads the account, looks up the store by slug, runs the list query with limit 1 and discards it, then counts.
- **Cost today:** During a Dream Factory run: 10 full shell-and-page renders a minute per watching tab. Always: 60 requests an hour per open owner tab, 4 statements each, one discarded. Paid by: The server per request and the database; the owner's browser re-parsing the shell each tick.
- **Fix:** Give RefreshWhile the visibility check LiveRefresh has. For job progress, ask a small action or route for the job's state (the pattern store-drafts.tsx:39-45 already uses) and refresh once when it finishes. In the feed, answer count=1 with the count statement alone and pass the store's id from the layout.
- **Saving:** Estimate: a progress tick drops from the whole route to 2 or 3 statements; the notice poll from 4 statements to 2.
- **Risk:** Low. A progress view must still redraw once when the job ends.

### AD-10 Three lists load everything; the customers list also groups every order before it cuts to 100

- **Kind:** oversize. **Effort:** M. **Confidence:** high. **Step:** 4.1.
- **Where:** `src/server/products.ts:305-348`, `src/app/admin/(gated)/[store]/products/page.tsx:168`, `src/server/customer-admin.ts:131-159`, `src/app/admin/(gated)/platform/stores/page.tsx:25`
- **Evidence:** listAdminProducts() has no limit and runs six correlated sub-selects per product (picture, two variant counts, stock, title fallback, price range); every row is serialised to a client component. The platform's Stores list reads every store with billing. listCustomers() builds its rows from a CTE over every order of the store, grouped by email, and only then keeps 100, so paging the result will not bound the work.
- **Cost today:** Nothing noticeable at 60 stores and 102 orders. It grows with the catalogue and order history: per view, 6 sub-selects per product and one pass over all orders. Paid by: The database, and the owner's browser for the products table.
- **Fix:** The review's step: one ListSearch and Pager, a page size on products, customers and stores. In addition, page the customers query by email before the aggregates, or keep per-customer totals, so the cut happens first.
- **Saving:** None today (estimate). Bounds the three views at a fixed page as stores grow.
- **Risk:** Low. Bulk 'select all matching' on products needs the server-side pattern the orders list has.
- **Already tracked:** code review step 1.13 (FS2): Open; step 2.10 (FS9): Open. The customers aggregate over all orders is not written there

### AD-11 The orders list re-reads store facts it already holds and waits in a row for the count

- **Kind:** duplicate. **Effort:** S. **Confidence:** medium. **Step:** 2.6.
- **Where:** `src/server/order-list.ts:44-57`, `src/server/order-list.ts:195-224`, `src/app/admin/(gated)/[store]/orders/page.tsx:68-73`
- **Evidence:** loadOrderListContext() runs two statements, one after the other, for the store's time zone, market codes and currency rates; all three are in the cached Store the page already holds (store.timeZone, store.allMarkets, store.localization), and 'today' can be worked out in code. listOrdersPage() then reads rows, tags and the count one after another, though the count does not depend on the rows.
- **Cost today:** 2 statements and 3 to 4 sequential waits per orders-list view, out of 9 to 10 statements. Paid by: The server per request; the owner waits a little longer for the list to stream in.
- **Fix:** Build the context from the Store. Start the count together with the rows.
- **Saving:** Estimate: 2 statements and 2 sequential waits per view.
- **Risk:** Low. Rates read from a store cached for hours could lag a rate change by up to an hour for the sort-by-total key; refresh the store's tag when rates are saved (writers of stores already must).

### AD-12 Nothing counts what a screen costs the server, so the Home grew to 30 statements unseen

- **Kind:** no check. **Effort:** M. **Confidence:** high. **Step:** 1.4.
- **Where:** `src/server/control-center.ts:49-59`, `docs/performance.md:139`, `e2e/signed-in/admin-scripts.spec.ts`, `src/server/ratchet.scan.test.ts`
- **Evidence:** The admin has budgets for scripts (seven screens in admin-scripts.spec.ts) and ratchets for unchecked reads, but no count of statements or server time per screen. A search of src and docs for a query count, a statement budget or Server-Timing found none. control-center.ts states its own rule ('a handful of queries, never per store') in a comment and has since grown to 21 statements plus per-store reads, with nothing to notice it. The admin's speed beacon reports TTFB, which with a static shell says nothing about the data behind it.
- **Cost today:** No running cost of its own. It is why AD-1, AD-2, AD-6 and AD-7 were not seen: each feature added one more read to a shared screen. Paid by: Everyone later: the owner in wait, the database in load, the team in audits like this one.
- **Fix:** Count statements per request in db() (an AsyncLocalStorage counter) and log one line per admin render with the count and the time. Add an integration test that holds the shell, the store Home, the orders list, the products list and the platform Home to a number, lowered like the existing ratchet. Add the menu build to a unit test with a time ceiling.
- **Saving:** Keeps the savings of the findings above; no direct saving.
- **Risk:** Low. The counter must not log statement text or values (the logging rule D400).
- **Already tracked:** no (code review step 4.6 'Measure, then tune' is Open and concerns the admin audit's phase 4, not a statement budget)
