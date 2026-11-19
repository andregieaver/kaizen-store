# admin-data: What the server does for an admin navigation

All 12 findings of the audit stand (8 confirmed, 4 corrected) and this pass added three; none argues for removing, hiding or merging a feature, and none rests on a table being empty. The admin's lists, streaming and cache tags are well made: the waste is in the shell and the home screens, and it is paid per owner tab and per save, so it grows with stores and owners, not with data. Three numbers tell it: building the store menu costs 125 ms of blocking CPU on every shell render (220 permission lookups; 0.1 ms once memoised), the shell is rendered again after every save and at least 39 save sites render the whole route twice because the browser asks again, and a store Home view runs 29 to 46 statements before its first content. Before opening is the cheap time: do the menu memo (AD-1), the double redraws (AD-13), the hidden-tab polls (AD-9), the products list's unused reads (AD-7) and a statement counter so this cannot grow unseen again (AD-12) first.

## Measures
- CPU to build the store menu on one shell render: 125 ms with every feature on in my own run (the skeptic's three runs: 121 to 125 ms; 101 to 112 ms with the shop only; 60 ms for a website; 243 ms for a store that is not open). 0.1 ms once the permission lookup is memoised.
- Permission lookups per store shell render: 220 calls for 110 distinct menu paths (each path asked twice: once for the tabs, once for the sidebars). ADMIN_PAGES holds 416 pages, 264 of them store pages, and matchPath() filters and sorts them on every call (0.46 to 0.53 ms a call).
- When the shell is rendered: On a hard load, after every server action that calls refresh(), updateTag() or revalidatePath(), and on every router.refresh(). Not on a soft navigation inside one store.
- Saves that draw the whole route twice (added by this pass): At least 39 of the 90 client router.refresh() calls in the admin's own folders follow a server action that has already called refresh(). 6 more are mixed, 11 are needed (the action does not refresh), 34 are not an action or were not resolved by the script.
- Places that redraw the whole route: 599 server refresh() calls in 176 files under src/app/admin; 90 client router.refresh() calls in 50 files of src/components/admin and src/app/admin (my count; the skeptic's wider count is 106 in 57); 4 revalidatePath calls in 2 files.
- Statements before the store Home shows its first content: 29 or 30 at least for an owner of a shop (29 when the instance holds the limits memo), up to about 46 with Work on, Norwegian books and a plan with a hard limit; plus 2 for the guard. One of them (AI usage, control-center.ts:161) is thrown away on every store…
- Statements on a hard load of the store shell itself: 6 before the frame paints (account, member, stores, support count, trial pause, Kaizen Life link), 5 of them one after another, plus one HTTP call to Supabase Auth for a session without two-step; 2 more statements after the response (Stripe set-up checks).
- Unchanged shell data re-sent on each redraw (store owner): 51 to 54 KB of JSON in English, 63 to 66 KB in Norwegian: common+setup+shell 20.4 KB (7.0 KB gzip), assistant 13.7 or 24.9 KB, menu 16.9 to 19.5 KB (2.5 to 2.9 KB gzip). The setup area (6.9 KB) has no client reader at all.
- Products list statements for a member who may edit: 16 or more, of which 12 or more are read and not used on that page; 3 of the unused run one after another after the batch.
- What the pages and articles lists do per row (added by this pass): Two whole JSON documents read per page (draft and published), each parsed with the full page schema, then compared by JSON.stringify: 0.64 ms of blocking CPU per row on real theme pages averaging 8.3 KB. 19 ms for 30 pages, 128 ms and about 3.3 MB from the da…
- Platform home statements, all awaited before the page paints: 18 on the page plus 6 or 7 in the layout; pending requests are counted 4 times with 2 definitions.
- Notice poll per visible owner tab: 60 requests an hour while the tab is shown, 4 statements each (one of them a list read with limit 1 that is thrown away), plus one Supabase Auth call each for a session without two-step.
- Progress polls that redraw the whole route: 8 RefreshWhile sites and one copy (PackPicturesWatch): every 5 s (cookie scan), 6 s (Dream Factory, 4 places: REFRESH_SECONDS = 6 in three files), 10 s (page jobs, legal pages), 15 s (pack pictures), 20 s (domains). None stops when the tab is hidden; LiveRefr…
- Loading and streaming coverage: 84 loading.tsx files under the signed-in admin; the store Home streams 6 secondary sections; the platform Home, the Payments settings page and the pages list stream none.

## Well made
- Orders list: keyset paging at 50 rows, a count capped at 10,000, named columns, the list behind Suspense, and a server-drawn view so its words are not sent whole (order-list.ts:176-224, orders/page.tsx:58-60).
- The store itself is read through 'use cache' with a per-store tag and an hours life (stores.ts:217-222); the admin does not re-read it per request. Both writers of currency rates refresh that tag (localization.ts:191 and 217), so rates in the cached store are…
- Guard reads are shared inside one render with React cache(): readSession, getAccount, loadMembership (auth.ts:120, 214, 354). A page and its Suspense children asking requirePermission twice cost one read.
- The member's row is read on every request on purpose (auth.ts:319-327: a security decision is never stale). Nothing here proposes caching it.
- A soft navigation between pages of one store does not render the shell again. The shell's cost is paid on hard loads, saves and refreshes only.
- The store Home streams its six secondary cards behind Suspense (drafts, today, move watch, failed alerts, analytics alerts, briefing offer). The Analytics overview gives each section its own Suspense (analytics/page.tsx:60-92).
- The AI manager's panel loads its chat and starts its conversation only when opened (ai-manager-launcher.tsx:107-127); the account menu's rows mount only while the menu is open.
- Basic and Advanced (D454) is a client switch over the menu and the hub cards only (useAdminView is read in 3 files: admin-view.tsx, section-hub-cards.tsx, store-admin-nav.tsx). No page computes a data card that Basic hides.
- No save revalidates a whole layout by path: revalidatePath is called 4 times in 2 files, each for one page. The one global tag refresh (CATALOG_TAG) is in vat-admin.ts only, for a platform-wide VAT change.
- Each admin hard load asks 24 to 46 link prefetches for the menu, but each answer measured 380 to 600 bytes of the prerendered shell (m/routes.json), so no page data rides on them. Admin routes are partial prerenders (m/build.log) and the proxy's matcher leave…
- Nothing in the admin's guard writes per request in the steady state: the two-step mirror is written only on a mismatch and the break-glass note at most once in 12 hours (auth.ts:158-175). Only the store layout schedules work after a render (after() at layout.…
- Only one generateMetadata runs in the admin (the root layout's favicon, from cached platform settings); pages use static metadata.
- Plan limits are memoised per instance for a minute (limits.ts:24-47). Cron health on the platform home is one statement.
- No feature in this dimension is unused code paying a running cost for nobody: every read found serves a screen. The findings are about how often and how much, never about whether a feature should exist.

## Findings (15)

### AD-1 [P0 S eager confirmed] The store menu is rebuilt with 220 slow permission lookups on every shell render
- evidence: matchPath() filters the 416-page table and sorts the 264 store pages on every call, and the sort runs a regex twice per comparison (pageParams). The layout calls storeTabs() and storeAreas(); each runs storeSections(), which asks canOpenPath() -> permissionOfPath() -> matchPath() for all 110 menu items. My own run in Node 22: 220 lookups for 110 distinct paths and 125 ms per build with every feature on. The skeptic …
- cost: 100 to 125 ms of blocking CPU per store shell render for a shop, 60 ms for a website, 243 ms for a suspended or closed store (measured on this machine). 64 ms more on the Settings and Website hub pages (one storeSection… (The server per shell render (function CPU), and the owner, who waits for it on …)
- fix: 6 steps; first: src/lib/admin-map.ts: at module load, build the pages of each area once, sorted by number of [param]s (the same stable sort matchPath() runs per call at line 1472), each with its path already split into segments. Make matchPath() loop over that list. What it …
- done when: node --import /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/hooks.mjs /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/planner-ad/nav.mjs prints 110 lookups per build (220 today) and under 2 ms per build (125 ms today), and the new …
- saving: Measured here: 100 to 125 ms down to about 0.1 ms per shell render, 64 ms per hub page, and about 130 ms per AI manager pass (the last an estimate). Vercel's CPU differs; the same order there is an estimate.
- after: nothing
- tracked: no (docs searched for matchPath, permissionOfPath, storeTabs, storeAreas: no step or rule names this cost)
- notes: Do this first: it is the largest measured cost in the dimension, a few dozen lines, and every other shell finding (AD-4, AD-5, AD-9, AD-13) is multiplied by it. Unit is per shell render, not per navigation.

### AD-2 [P1 M eager corrected] The store Home runs 29 or more statements before it shows anything, one of them for nothing
- evidence: controlCenter() runs 1 statement, then 20 in one Promise.all (more with Work on), then per-store reads for the threshold watch (1 to 4) and plan limits (0 to 11; the limits themselves are memoised for a minute per instance, the usage against them is not). The setup checklist adds 6 (setup.ts:56-79, with 2 in getPaymentSettings) and demo content 1. The AI usage read (line 161) is used only by the owner's control cent…
- cost: 29 to 46 statements held before the page's first content; on the owner's control center the per-store part grows by 1 to 15 statements per store. Not timed. Today's rows are the team's test data, so each statement is fa… (The database and the server per Home view; the owner waits for all of it before…)
- fix: 7 steps; first: src/server/control-center.ts:161: do not read AI usage when onlyStore is set (pass an empty list to totalOf). One statement less per store Home view, no visible change.
- done when: The statement budget test of AD-12 holds controlCenter() for one store to 14 statements or fewer for an owner of a shop (22 or more today), the checklist and the demo card are behind Suspense in [store]/page.tsx, and no usageRows() call runs when onlyStore is set.
- saving: Estimate: first content after about 14 statements instead of 29 or more, with nothing a person sees changed (1 for AI usage and 7 for the two streamed cards for certain; 7 from folding eight counts into one; 1 to 12 from the watch and the limits memo). About …
- after: AD-12 step 1 (the statement counter, to measure before and after)
- notes: The skeptic removed the argument from empty tables; what stands is that every store pays every feature's count on every Home view. Steps 1 to 3 are small and could ship with the P0 work. Before opening is the cheap time to fold the counts, while no owner's at…

### AD-3 [P1 S eager confirmed] Every admin request from a session without two-step calls Supabase Auth
- evidence: readSession() verifies the token, reads the account row, then for an aal1 session calls supabase.auth.getUser() over HTTP to list factors, on every request (React's cache spans one render only). Every page render, server action, notice poll and admin route handler goes through it. A save pays it twice: once in the action's guard and once in the redraw that follows, which is a new render with a new cache. The writes …
- cost: One extra HTTP round trip per admin request for every account without a second factor, two per save, one per 60-second notice poll. Not timed here; the code review rates it severity 2. If production still signs with the… (The server per request and the owner on every navigation and save.)
- fix: 6 steps; first: First look, by a person with access: in the Supabase dashboard of project ybsozesfuxuitoacntfo, Authentication, JWT signing keys. If tokens are still signed with the legacy shared secret (HS256), move to an asymmetric signing key (Supabase's own migration; no…
- done when: With trust-fixtures, an aal1 account with no factor makes 0 getUser calls across two readSession() runs (1 each today), an aal1 account with a factor is still held, and step 3.8 in the code review's Progress table reads Done.
- saving: One HTTP call per admin request for sessions without two-step, two per save (estimate: tens of milliseconds each; not measured). If production signs with HS256, one more per request for every session.
- after: nothing
- tracked: code review step 3.8 (finding FV8): Open. The signing-key check is not written there.
- notes: Listed so the plan does not count it twice; do it as the review's step. The column fast path is preferred over a five-minute in-memory answer because the column is the same for every instance, while a memory kept per serverless instance is rarely hit and cann…

### AD-4 [P1 S eager confirmed] The store shell reads one thing after another, and checks Stripe set-up on every render
- evidence: The layout awaits the member, then the account's stores (used at top level for one footer link, line 151), then the support count, then the starter (starter stores only), then the trial pause, each after the last; the account menu then awaits the Kaizen Life link with no Suspense. A top-level await in a layout holds the whole segment, children included, and the only boundary above is the gate's, so the person sees t…
- cost: 5 database round trips in a row before the frame can paint on a hard load, and 2 statements (sometimes a Stripe call) after every shell render, which includes every save and every poll tick. New stores start in test mod… (The owner on each hard load and save; the server and database per shell render;…)
- fix: 5 steps; first: src/app/admin/(gated)/[store]/layout.tsx:74-88: after the member is known, run the reads that depend only on it in one Promise.all: storesOf(account), waitingCount (when the member may read support), starterOfStore (starter stores), pausedAfter (open stores) …
- done when: The layout has one await after the member besides the Promise.all (read the file), and AD-12's counter shows the store shell at 2 statements for the guard plus one wave, and 0 statements after the response for a store whose test account is active, on the second render in one instance (2 after the response today).
- saving: Estimate: 3 fewer sequential waits before the frame paints on a hard load, and 2 fewer statements per shell render for every active selling store after its first render in an instance.
- after: AD-12 step 1 (the statement counter, for the check only)
- notes: The planner chose a per-instance memo over the skeptic's move to the Payments page and a job: it removes the same statements without changing D23's letter or adding a job. If the owner later wants the check out of the admin altogether, that is a decision row,…

### AD-5 [P1 M oversize confirmed] Every save and poll re-sends 51 to 66 KB of unchanged shell words and menu
- evidence: Layouts hand whole catalogue areas to client components as props. Measured as JSON by the skeptic: common+setup+shell 20.4 KB (7.0 KB gzip); the assistant area 13.7 KB in English and 24.9 KB in Norwegian, sent for every owner though the panel is closed until pressed; the menu's tabs and areas 16.9 to 19.5 KB, each page address present three times. No client component reads the setup area (my rg: 0 matches for useAdm…
- cost: 51 to 54 KB (English) or 63 to 66 KB (Norwegian) of JSON per shell redraw for a store owner, about 14.5 to 18 KB gzipped; 24 to 27 KB more per view on Home and Products. Server time to serialise and browser time to pars… (The owner's browser and the server per shell render.)
- fix: 6 steps; first: src/app/admin/(gated)/layout.tsx:45: hand down ["common", "shell"] only. Nothing on the client reads setup.
- done when: /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/skeptic-ad/words.mjs, run again with the layouts' new arguments, prints under 30 KB of JSON for the store shell in English (51 to 54 KB today), and e2e/signed-in/admin-text-fallbacks.spec.ts and ai-manager-panel.spec.ts pass.
- saving: Estimate from the measured parts: 6.9 KB (setup) plus 12 to 23 KB (assistant) plus about 7.5 KB (menu addresses) less JSON per shell redraw, roughly half; about 8 to 11 KB gzipped. About 20 KB less JSON on each Home view.
- after: AD-1 (storeNav() gives one place to change the menu's shape)
- tracked: Partly: PSI PERF-01 (open) cut the admin's shared scripts (D540, 10-11 November); the words re-sent as props on each redraw are not in it.
- notes: Step 1 is a one-line change and can ship with the P0 work. The 208 call sites of adminTexts() are not each a fault: a page that hands an area to parts that read most of it is right. The two named pages hand a whole area to one card.

### AD-6 [P2 S oversize confirmed] The platform Home holds its first paint for 18 statements and reads whole lists to show a number
- evidence: The page awaits five loaders in one Promise.all with no Suspense. platformOverview() calls listPlans() (3 statements with sub-counts and the Stripe sync table) to show plans.length, and usageRows() (a grouped join over ai_usage with prices, accounts and stores) to show two totals. planAnalytics(30) returns one row per store's plan and every plan move of the period and sums them in code. Pending access requests are c…
- cost: 18 statements before the page paints and 6 or 7 in the layout; 4 of them count the same thing. Only the platform's own team opens this page, so the total is small; the plan lines grow by one row per store per view once … (The platform's team on each visit; the database.)
- fix: 5 steps; first: src/server/platform-overview.ts:44: count plans with one select count(*) from commerce.plans instead of listPlans().
- done when: AD-12's budget test holds the platform Home's loaders to 11 statements or fewer (18 today), and rg finds one definition of pending requests (the filter of platform.ts:208) in src/server.
- saving: Estimate: 18 statements to about 11, and the attention list after about 5.
- after: AD-12 step 1 (the statement counter)
- notes: Few people ever load this page, so it comes after the store shell and Home. It is listed because the platform must not lag the stores (the parity rule), and the two definitions of one number are a small correctness matter worth fixing on their own.

### AD-7 [P0 S oversize corrected] The products list reads the whole editor context and a per-product check it does not need
- evidence: For a member who may edit, the list calls getEditorContext(): 10 statements in one batch (economic operators, two location reads, terms, the VAT matrix, booking staff, places, hosts, layouts, VAT categories), then 3 more one after another while the object is built (the store's AI provider, shipping profiles, market price rules; lines 198-200). The page uses terms and three fields of markets that are already in the c…
- cost: 12 or more unused statements per products-list view for editors, 3 of them sequential after the batch, one a function call per country and category; one function call per active product per view for a notice's number. T… (The database and the server per view; the owner waits for the context's four ro…)
- fix: 4 steps; first: src/app/admin/(gated)/[store]/products/page.tsx:94: replace getEditorContext(store) with listTerms({ storeId: store.id, contentType: "product" }) (the same call products.ts:141 makes) and build the bulk panel's markets from store.markets (code, name, currency…
- done when: rg -c getEditorContext 'src/app/admin/(gated)/[store]/products/page.tsx' prints nothing (1 today), and AD-12's counter shows the products list at 5 statements or fewer for an editor on the default view (16 or more today).
- saving: Estimate: 16 or more statements down to 4 per view for an editor (products, the notice's count, terms, import jobs), and three sequential waits gone.
- after: AD-12 step 1 (the statement counter, for the check only)
- tracked: no (the list's missing paging is code review step 1.13, see AD-10)
- notes: The skeptic raised the counts (the auditor missed the three awaits inside the returned object). Small, safe, and on one of the most opened pages of a selling store.

### AD-8 [P2 M duplicate corrected] An account's memberships are read two to four times per request, in four shapes
- evidence: listStores(), ownerDesks(), booksMemberships() and controlCenter()'s first statement each join store_members to stores (three also to store_roles) for the same account with slightly different columns and filters. The owner layout awaits them one after another (stores, desks, domains for a non-owner, books clients, support count: 4 or 5 sequential awaits), and the owner's Stores page calls listStores() directly inste…
- cost: 2 near-identical statements per store hard load, 3 on the store Home, 4 on the owner's home, and 4 or 5 sequential waits before the owner level's frame paints. (The database and the server per request; the owner on each hard load of /admin.)
- fix: 5 steps; first: src/app/admin/(gated)/(owner)/stores/page.tsx:32: call storesOf(account) (the request-cached reader the layout already used) instead of listStores(account). One statement less, no other change.
- done when: AD-12's counter shows the owner level's shell at 4 statements or fewer after the guard (5 or 6 today), and rg -n 'listStores\(' src/app shows no call outside storesOf().
- saving: Estimate: 2 to 3 statements and 2 to 3 sequential waits per owner-level hard load; 1 statement on the Stores page for certain.
- after: AD-12 step 1 (the statement counter)
- notes: A true duplicate, but small next to AD-1 and AD-2. The first two steps are an afternoon; the shared reader is worth doing when AD-2 touches the control center, not before.

### AD-9 [P0 S eager corrected] Progress polls redraw the whole admin, and a notice poll runs in every visible owner tab
- evidence: RefreshWhile calls router.refresh() every 5 s (cookie scan), 6 s (Dream Factory, four places), 10 s (page jobs, legal writing), 15 s (pack pictures, its own copy) or 20 s (domains), and does not stop when the tab is hidden; LiveRefresh, 20 lines away, does. A refresh re-fetches dynamic data in shared layouts too, so each tick pays the whole shell of AD-1, AD-4 and AD-5 plus the page. The Dream Factory run is where a…
- cost: During a Dream Factory run: 10 full shell-and-page renders a minute per watching tab, hidden or not, each with the 100 to 125 ms menu build until AD-1. Always: 60 requests an hour per visible owner tab, 4 statements eac… (The server per request and the database; the owner's browser re-parsing the she…)
- fix: 5 steps; first: src/components/admin/refresh-while.tsx: draw LiveRefresh with every = seconds * 1000 (or copy its check): refresh only while document.visibilityState is 'visible', and once when the tab comes back. src/components/admin/pack-pictures.tsx:126-133: the same in P…
- done when: rg -n 'setInterval' src/components/admin/refresh-while.tsx src/components/admin/pack-pictures.tsx shows each tick guarded by visibilityState, and AD-12's counter (or a count in assistant-notices.int.test.ts) shows the count=1 feed at 2 statements (4 today).
- saving: Estimate: a hidden tab stops costing anything; a progress tick drops from the whole route to 2 or 3 statements once it asks the job; the notice poll from 4 statements to 2.
- after: nothing
- notes: Steps 1 and 2 are a few lines and are the P0 part; steps 3 to 5 are P1. The skeptic fixed two details: the poll's constant lives in src/lib/assistant-notices.ts:13, and the notice poll already stops in a hidden tab.

### AD-10 [P1 M oversize confirmed] Three lists load everything; the customers list also groups every order before it cuts to 100
- evidence: listAdminProducts() has no limit and runs correlated sub-selects per product (picture, two variant counts, stock, title fallback, price range, and a vat_rate() call); every row is serialised to a client component. The platform's Stores list reads every store with billing. listCustomers() builds its rows from a CTE over every order of the store, grouped by email, and only then keeps 100 (line 177), so paging the resu…
- cost: Per view: 6 sub-selects and a function call per product, and one pass over all of a store's orders. Today's catalogues and orders are the team's demo data, so nothing shows; the cost grows with each real store's catalog… (The database, and the owner's browser for the products table.)
- fix: 5 steps; first: Do code review step 1.13 as written (docs/audits/code-review-2026-11.md:435): move Customers, Products, Invoices and Returns onto ListSearch and Pager, each list read saying when it was cut. Products: a page of 50 by the present order, keyset as the orders li…
- done when: The review's done-when for 1.13 and 2.10 holds, and an integration test shows listCustomers() for a store with 150 customers reading the orders of 100 emails only (the plan's aggregate no longer scans every order).
- saving: Bounds the three views at a fixed page as stores grow (estimate; nothing to measure on demo data).
- after: code review step 1.12 (the review orders 1.13 after it)
- tracked: code review step 1.13 (FS2): Open; step 2.10 (FS9): Open. The customers aggregate over all orders is not written there.
- notes: Cheapest before opening, while no owner's bulk habits depend on the whole list being on one page. Not a new finding: it is here so the plan carries the customers aggregate, which the review does not name. The pages and articles lists (AD-14) are a fourth unbo…

### AD-11 [P2 S duplicate confirmed] The orders list re-reads store facts it already holds and waits in a row for the count
- evidence: loadOrderListContext() runs two statements, one after the other, for the store's time zone, market codes and currency rates; all three are in the cached Store the page already holds (store.timeZone, store.allMarkets, and the currencies with their rates read at stores.ts:239-242), and 'today' can be worked out in code. listOrdersPage() then reads rows, tags, the page before and the count one after another, though the…
- cost: 2 statements and 3 to 4 sequential waits per orders-list view, out of 9 to 11 statements. The orders list will be the most opened admin page of a selling store. (The server per request; the owner waits a little longer for the list to stream …)
- fix: 4 steps; first: src/server/order-list.ts: add orderListContextOf(store) that builds the same OrderListContext from the Store: timeZone, today through todayIn(new Date(), store.timeZone) (src/lib/analytics-period.ts, as control-center.ts:296 does), marketCodes from store.allM…
- done when: The new equality case passes, and AD-12's counter shows the orders list body at 2 statements fewer than today on its first page (count them before the change with the same counter).
- saving: Estimate: 2 statements and 2 sequential waits per view.
- after: AD-12 step 1 (the statement counter, for the check only)
- notes: Confidence raised from the skeptic's medium: the one open risk (do rate changes refresh the cached store) was checked in this pass and they do.

### AD-12 [P0 M process confirmed] Nothing counts what a screen costs the server, so the Home grew to 30 statements unseen
- evidence: The admin has budgets for scripts (seven screens in admin-scripts.spec.ts) and ratchets for unchecked reads, but no count of statements or server time per screen. The skeptic's search of src and docs for a statement or query budget, a per-request counter or Server-Timing found none. control-center.ts states its own rule ('a handful of queries, never per store') in a comment and has since grown to 21 statements plus …
- cost: No running cost of its own. It is why AD-1, AD-2, AD-6, AD-7 and AD-14 were not seen: each feature added one more read to a shared screen. (Everyone later: the owner in wait, the database in load, the team in audits lik…)
- fix: 6 steps; first: Step 1, the counter. src/db/client.ts create(): wrap the pool's query so each statement adds one to the store of an AsyncLocalStorage when one is running, and nothing otherwise. Export countStatements(run) that runs a function inside a fresh store and returns…
- done when: pnpm test:int runs src/server/admin-statements.int.test.ts with five screens in its baseline, and one admin page load in a local production build writes one admin.render log line with a statements count.
- saving: No direct saving. It keeps the savings of AD-2, AD-4, AD-6, AD-7, AD-8 and AD-11, and before opening it gives the first real numbers per screen.
- after: nothing
- tracked: no (code review step 4.6 'Measure, then tune' is Open and is about how people use Basic and Advanced, not a statement budget)
- notes: P0 for step 1 only: it is small, safe, and the measuring tool the other findings' checks read. Steps 3 and 5 land with the fixes. Before opening, the baseline is also the first honest picture of what each screen asks of the database.

### AD-13 [P0 S duplicate added] At least 39 saves draw the whole route twice: the action redraws it, then the browser asks again
- evidence: A server action that calls refresh() answers with the route already drawn again: refresh() sets pathWasRevalidated (revalidate.js:67-77), so the action handler does not skip page rendering (action-handler.js:926-935). In many client parts the code then calls router.refresh() as well, which sends a second request that renders every layout and the page once more. Counted in this pass: 90 router.refresh() calls in 50 f…
- cost: One whole-route render more than needed on each of these saves, two more where an editor pushes and refreshes: the guard's 2 statements (and an Auth call for a session without two-step, AD-3), the shell (100 to 125 ms o… (The server and the database per save; the owner's browser, which parses the rou…)
- fix: 6 steps; first: Run node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/planner-ad/double.mjs and take its 'double' lines as the work list (36 today). At each, delete the client's router.refresh() and, where nothing else uses it, t…
- done when: node /tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/work/planner-ad/double.mjs prints 'double (every candidate action calls refresh) 0, mixed 0' (36 and 6 today), the new scan test's baseline is about 50 (90 today), and the signed-in e2e job passes.
- saving: One whole-route render fewer per save at 39 or more save sites, two fewer on four editors. Per render saved, from the measured parts: 100 to 125 ms of CPU (until AD-1), 8 or more statements plus the page's own, and 51 to 66 KB of JSON (until AD-5). After the …
- after: nothing
- tracked: no (rg router.refresh over docs/rules, docs/performance.md and the scan tests: no rule, no check)
- notes: Added by the planner as completeness critic: the brief asked how much is refreshed after a save, and the report counted the refresh() sites but not the saves that pay twice. High confidence for the nine read by hand and for the mechanism; medium for the scrip…

### AD-14 [P1 M oversize added] The pages and articles lists read and check every page's whole content, twice, to show a title and a state
- evidence: listPages() selects draft and published, the two whole JSON documents of a page, for every page of a type, with no limit (pages.ts:136-140). In code each row is parsed twice with the full page schema (parsePageContent, a zod parse of a 4,300-line schema file) and the two results are compared with JSON.stringify to tell 'published' from 'changed' (pages.ts:112-115, page-content.ts:4317-4319). The list then shows a ti…
- cost: Per list view: two documents per page from the database and 0.64 ms of CPU per page, growing without bound with a store's pages and above all its articles. A blog moved in from Shopify or WordPress has hundreds of posts… (The database (rows and bytes), the server (a synchronous parse that holds the i…)
- fix: 7 steps; first: src/server/pages.ts:135-156: read the list's columns in SQL instead of the documents: id, slug, draft->>'title', draft->'thumbnail'->>'url', the two flags from coalesce(published, draft) with the schema's defaults (page-content.ts:4296-4297: true), published …
- done when: rg -n 'select id, slug, draft, published' src/server/pages.ts shows the statement only in getPageForEdit(), the new case in src/server/pages.int.test.ts passes, and AD-12's counter shows the pages list view in at most 3 waves of statements (6 or more sequential waits today).
- saving: Measured per-row cost times rows: for 30 pages about 19 ms of CPU and about 500 KB of JSON less per view; for 200 articles about 128 ms and 3.3 MB. Five or more sequential waits become one, and the builder's context is no longer built for a list.
- after: AD-12 step 1 (the statement counter, for the view's round trips)
- tracked: no (code review FS2 and step 1.13 name customers, products, invoices and returns; pages and articles are not there)
- notes: Added by the planner as completeness critic: the brief asked for whole rows read to show three columns, and the report did not open the pages list. Steps 1 to 6 change nothing a person sees. Paging articles is the part that is cheapest before opening.

### AD-15 [P2 S eager added] The Payments settings page reads one table three or four times and waits on Stripe and Mollie before it paints
- evidence: The one settings page traced in full. It runs 5 statements together (the provider, the Stripe accounts, the audit log's last 20 rows, the invoice setting, the method choices), then one at a time: the checkout provider, the test account (one statement and, while a Kaizen-made test account is not yet active, a call to Stripe's API awaited in the render, connect.ts:270-275), the method states, the wallet domains, and w…
- cost: 4 or more sequential waits and 2 to 3 repeated reads per view of Payments, and for a new store (which starts in test mode, D20) a wait on Stripe on the first visits. Every owner opens this page to go live, but rarely af… (The owner on each visit of Payments; the database; Stripe's and Mollie's API qu…)
- fix: 3 steps; first: src/server/connect.ts: one reader for the page, paymentAccountsFor(storeId), returning per mode the account's id, card_payments, requirements_due, method_states, wallet_domains and wallet_domains_at in one statement; build getStripeAccounts()'s shape, methodS…
- done when: AD-12's counter shows the Payments page's database reads in 2 waves and at most 7 statements for a Stripe store with an active test account (9 in 5 waves today), and the page file has a Suspense around each outside call.
- saving: Estimate: 2 to 3 statements and 3 sequential waits per view; a new store's first paint of Payments no longer waits for Stripe.
- after: AD-12 step 1 (the statement counter)
- notes: Added because the brief asked for one settings page and the report traced only the Settings hub. Small and rarely opened, so it waits until the page is next touched; it is the pattern (one table read per helper, outside calls awaited in the render) that is wo…
