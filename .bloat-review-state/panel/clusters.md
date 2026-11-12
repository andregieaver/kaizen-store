# Work items that name the same findings (grouped by a script: a hint for merging, not a decision)

30 groups of two or more, out of 248 work items. A large group may be several steps that only touch; split it by what one engineer changes in one go.

## Group 1 (78 items; findings CP-14, FM-13, AS-10, DP-4, FM-1, DP-6, AS-3, AS-7, SC-6, PL-13, SC-12, PL-8, SC-13, PL-9, PF-5, PF-6, PF-10, PL-5, PF-9, SC-5, PL-1, AC-10, AC-11, BN-11, AC-1, BN-1, BN-3, BN-4, AC-7, BN-7, AC-4, AC-12, AC-9, BN-8, BN-12, SG-14, SF-7, AD-12, SD-13, CA-16, SG-1, SF-1, SG-5, SF-3, SD-7, SF-5, SD-14, CA-5, CA-7, SD-1, SD-6, SG-2, SF-2, SG-8, SD-2, SD-5, SD-9, SG-4, AD-2, AD-5, CA-12, SG-11, SF-11, CR-4, CR-9, CR-15, CR-2, CR-14, CR-8, CR-17, CR-16, CR-10, DQ-11, DS-12, DQ-6, DS-5, DQ-3, DS-10, DS-3, DQ-5, DQ-7, DQ-15, DS-13, DQ-12, DS-2, AI-13, AI-5, FT-2, FT-3, PM-14, PM-3, PM-10, PM-12, CS-3, CS-6, CS-1, TX-4, TX-3, TX-12, TX-6, TX-1, TX-9, TX-2, TC-8, TC-2, TC-10)
- W-code-3 [now] One copy counter and one twin counter, held in a baseline that takes a reason (CP-14's detector, FM-13's baseline file: build it once, not twice)
- W-code-10 [now] Turn source maps off in the Vercel build's page worker, and write the measured peak into docs/build-memory.md
- W-code-11 [now] Take Supabase's client and zod off the first scripts of every admin page
- W-code-16 [now] Give each admin area its own words module, so nothing outside the admin loads the whole registry
- W-code-18 [now] One import walker, one graph test and one trace report for what a function loads and carries, and a scan of the package list (three planners named th…
- W-code-39 [later] Point Tailwind at code only, not at tests and SQL (done inside the styles area's change, not apart)
- W-shopper-browser-1 [now] Budgets first, at today's figures: scripts counted right on 8 store routes, documents, after-load requests, the Add to cart answer
- W-shopper-browser-5 [now] Product tiles: no island, no script and no stock call while both tile switches are off
- W-shopper-browser-9 [now] A store in an AI-translated language sends the browser's 114 texts, not all 1,673
- W-shopper-browser-17 [next] Admin: the rail and the rows of every list fetch on intent, not on sight
- W-shopper-browser-18 [next] Write the prefetch policy down and hold it: a ratchet on direct next/link imports and one table of request budgets
- W-shopper-browser-19 [next] Partial prefetching: run the trial and decide, before the next major Next release forces it
- W-shopper-browser-20 [next] A stylesheet of the storefront's own, without the admin's classes
- W-shopper-browser-22 [next] The admin's words by cut, not by whole area, in every admin document
- W-owner-browser-1 [now] One check over every route's first scripts, an import walk for the admin, and a document budget
- W-owner-browser-2 [now] Take Supabase, zod and the builder's English off every signed-in screen
- W-owner-browser-5 [now] The Work invoice screen takes its words as props, not the whole catalogue
- W-owner-browser-11 [next] Hand each admin page only the words its parts read
- W-owner-browser-13 [next] Admin links are fetched when pointed at, and the router's prefetch setting is decided
- W-owner-browser-16 [later] No English catalogue in client code but common and sign-in
- W-owner-browser-17 [later] Shoppers get a stylesheet without the admin's classes
- W-server-2 [now] One guard for what a server entry loads: an import-graph test with a baseline, and a byte budget on the build
- W-server-3 [now] Count statements: one counter in the database client, a baseline for five admin screens and a log line per admin render
- W-server-4 [now] Storefront server budgets: statements per page in CI, and a scan of every cached read's life and tag
- W-server-5 [now] Hold what is static: a render-mode baseline read from the build
- W-server-8 [now] Cut the import cycle where shoppers' pages enter it: six lazy imports
- W-server-9 [now] Start hook: split the interface-text reader from the translating tools
- W-server-10 [now] The admin's words leave shoppers' routes: an area module for each importer outside the admin
- W-server-16 [now] Product tiles ask for stock only where a store or a grid shows it
- W-server-21 [now] Admin links are fetched on intent, and View store never
- W-server-23 [now] Write partialPrefetching down as a recorded choice
- W-server-30 [next] The proxy's readers become leaf modules, with one file of tag names and one short-memory helper
- W-server-31 [next] A product view asks for stock only: what an owner sets is read once per store and carried in the prerendered page
- W-server-34 [next] A cold store page: one wave before the first byte, and one read for the optional features
- W-server-36 [next] The admin's words by area on admin routes too: the one registry goes
- W-server-38 [next] Store Home: first content after 14 statements
- W-server-41 [next] A redraw sends the shell's words once, and only the ones a part reads
- W-server-46 [next] Ask for translated texts when they can have changed, and prune the search cache daily
- W-server-51 [later] Report repeated server chunks and re-measure the build after the cuts
- W-scheduled-3 [now] AI upkeep costs one statement when nothing changed: knowledge, picture vectors, alt texts, product vectors
- W-scheduled-4 [now] The invoice job asks only stores it can issue for now, the longest-waiting first
- W-scheduled-5 [now] The listings' check records a try, stops on a provider error and reads only reworded products
- W-scheduled-8 [next] The dispatcher runs from a registry: a cadence per job, four at a time, one ledger write for idle jobs, and a scan test and an idle budget that hold …
- W-scheduled-10 [next] Each daily job has its own ledger row, and no prune fails unseen
- W-scheduled-11 [later] Books, Tripletex and Fiken: every book gets its turn, and an idle one costs nothing between hourly looks
- W-scheduled-13 [later] The docs index rewrites only the rows that changed
- W-database-2 [now] Count statements: one counter and a query budget for the tick, the minute routes and the cold frame
- W-database-6 [now] A budget for what costs per write: index and trigger counts on the eight hot tables
- W-database-9 [now] Knowledge job: remember what was cut, and fetch documents only for pages that changed
- W-database-11 [now] Pictures: re-check where a picture is used only when something that can show it was saved
- W-database-12 [now] Invoice job asks only stores it can issue for, oldest first; delivery prunes leave the minute
- W-database-14 [next] Dispatcher: four jobs at a time, each at its own cadence, and no full re-hash on every tick
- W-database-15 [next] The cold frame: read together, one site-facts read, the page index for menus
- W-database-17 [next] Document jobs find due work by a mark or a window an index serves
- W-database-18 [next] Retention: a delete rule for every table that grows by time (the owner names the periods), and prunes off the five-minute tick
- W-database-19 [next] Interface texts: a version stamp for the poll, read every ten minutes
- W-ai-5 [now] The alt-text job lists a site only while a picture is due, and gives up after five tries
- W-ai-6 [now] Knowledge, product and picture index jobs: one question to find work, embed on save, scan hourly
- W-surface-2 [now] A surface budget: fourteen counts held, and every rise states its idle cost
- W-surface-3 [now] Prunes leave the five-minute and the every-minute cadence
- W-surface-4 [next] A shop-only store's journey, counted: no read for an off feature from home to checkout (gap 1)
- W-page-model-1 [now] Budgets that see a real built page, a list that reads whole pages and what a publish makes stale
- W-page-model-4 [now] The knowledge job reads no document and opens no transaction when nothing was published
- W-page-model-11 [next] Hand the page editor only the text branches its parts read
- W-page-model-14 [later] A page reader that does not import the page writer: tags in a leaf module, reads in page-reads.ts
- W-styles-1 [now] Put numbers under the styles first: budgets for the stylesheets and the style text, and Tailwind reads code only (land it with SC-6 and PL-13, so the…
- W-styles-5 [next] Two Tailwind entries: the site's stylesheet without the admin's classes (first of the next phase; cheapest before real shoppers arrive)
- W-text-1 [now] Take the builder's English off every signed-in screen and the unread setup words out of every admin document (TX-4 is step 1 of AC-1; the setup line …
- W-text-3 [now] A language translated by AI costs what it uses: 114 texts in a document, two statements at start, built on first read, polled each minute only where …
- W-text-4 [now] Code outside the admin reads its own areas of words through one small module per area, and a scan keeps the registry out (TX-1 steps 1 to 4; the same…
- W-text-6 [now] The words' guards: an import walk for the admin, a dead-key scan, a rule that catalogue files are text, and a document budget at today's figures (the…
- W-text-7 [next] Admin pages hand down the groups their parts read: typed cuts of the big areas, the assistant's button apart from its chat, a record of the words eac…
- W-text-9 [next] Where a function took English words as a default, the words become a required argument, so the proxy and the storefront reach only the areas they nam…
- W-text-10 [next] The admin's own functions load only the areas they name: a module per area for all 67 and a codemod of the admin's adminText() calls (561 to 688 file…
- W-text-11 [later] Empty the list of English catalogues compiled into admin client scripts (AC-9's 38 import sites, as each area is next touched)
- W-build-6 [now] A recorder and ceilings: seconds for every check, the build's peak memory printed by every build, source maps off in the page worker if a capped buil…
- W-build-8 [next] Cut the 12 imports that close the 229-module cycle, one file's edges per commit
- W-build-15 [later] One shared walker for the tests that read the source tree, moved to as each scan is next touched (with code review step 4.1)

## Group 2 (8 items; findings SC-3, PL-10, SC-4, SC-2, SC-11, BN-10, BN-9, PM-11, TX-5, TX-8)
- W-shopper-browser-7 [now] Admin words, the features table, the cookie catalogue and an unused library out of every shopper's first scripts; the filter dialog only where a list…
- W-shopper-browser-8 [now] Product page: the cart's forms out of its scripts, then a picker only for the product's own kind
- W-shopper-browser-12 [next] Each working route loads its own parts: listing, search, cart, checkout, account, order, wishlist and cookies stop sharing one bundle
- W-shopper-browser-23 [later] Parts a plain store's page never draws load where they are drawn: the theme preview stage and the platform's language switch
- W-owner-browser-10 [now] Three tables leave a shopper's first scripts: cookie purposes, the feature list, the theme stage
- W-owner-browser-14 [next] Storefront pages load only their own forms: the cart's parts leave the product page and the listing pages
- W-page-model-5 [now] Take the cart's parts off the product page and three undrawn parts off every built page
- W-text-2 [now] Shoppers' scripts carry no cookie purposes and no admin words, and the four browser languages get a ceiling (TX-5's split, not SC-3's later download:…

## Group 3 (8 items; findings AC-14, CA-13, AD-10, AD-14, DS-4, DQ-10, DQ-14, PM-6, PM-5)
- W-owner-browser-9 [now] The Products list shows 100 at a time and says so
- W-server-24 [now] A theme's neighbours read the cached list of cards
- W-server-42 [next] Products, customers and the platform's stores are read a page at a time
- W-server-43 [next] The pages and articles lists read columns, not documents, and page
- W-database-16 [next] A page's title, its titles by language and its modal flag as columns the database derives
- W-database-21 [later] Slim reads when their files are next opened: theme cards, the Pages list, fonts, the speed report, and limits on six lists
- W-page-model-8 [next] A page's title, its titles by language and its remembered-modal flag as columns the database derives
- W-page-model-10 [next] The admin's page lists, pickers and AI tools read list fields, not two documents a page

## Group 4 (7 items; findings DP-7, SF-10, CR-6, CR-1, CR-7, DQ-8, DS-7, DQ-1, PM-4)
- W-code-32 [next] Wake the three Chromium routes only when work waits (done inside the scheduler change, not apart)
- W-server-45 [next] Wake the every-minute routes only when work waits
- W-scheduled-6 [now] The cookie scan's due check uses its index, and a failing site backs off
- W-scheduled-7 [next] One tick a minute: the database says which queue holds a row, and only those routes are called
- W-database-1 [now] Filter a store's rows one way the index can serve: owned() in place of `store_id is not distinct from`
- W-database-13 [next] Minute routes: one indexed question before any work
- W-page-model-2 [now] One owned() helper, so the store index serves every owner filter

## Group 5 (4 items; findings DD-1, DP-1, DP-9, SG-6, SF-6, DS-1, TC-5)
- W-code-14 [now] Drop the 19,614-line schema from the run-time database client (three lines), and correct the plan's note on the Postgres driver in the same change
- W-server-7 [now] Take the unused Drizzle schema out of the database client
- W-database-4 [now] Stop loading the schema file at server start
- W-build-4 [now] The database client stops loading the 19,614-line schema: three lines in src/db/client.ts

## Group 6 (4 items; findings AS-8, DC-3, DC-1, DC-2)
- W-code-33 [next] CLAUDE.md under 15 KB and no decisions file over 200 KB (done inside the rules area's change, not apart)
- W-rules-1 [now] A budget for the written rules, checked on docs-only pushes too
- W-rules-3 [now] Take the 295-line feature index out of CLAUDE.md; leave a map of the seven rule files and a three-line look-up
- W-rules-10 [next] One file per decision, with a generated index

## Group 7 (4 items; findings PF-2, PL-3, SC-1, PF-11, PL-4, BN-2, CA-4, CS-8)
- W-shopper-browser-3 [now] No prefetch where the press cannot use it: other language, currency and country views, links that leave their root layout, the footer's legal links, …
- W-owner-browser-8 [now] Kaizena Flow's own site stops prefetching the admin
- W-server-20 [now] Language and currency links stop prefetching a page their press never opens
- W-styles-3 [now] No prefetch of /admin from Kaizena Flow's own pages (the six links)

## Group 8 (4 items; findings PL-11, AC-13, AD-9, AI-12)
- W-shopper-browser-10 [now] The notice count: one statement, and a slower poll while nothing is unread
- W-owner-browser-7 [now] The notice badge asks with fewer statements, and less often from a tab nobody touches
- W-server-27 [now] Polls stop in hidden tabs, a progress tick asks its job, and the notice poll asks two statements
- W-ai-7 [now] Notice badge: one count, no lookup by slug, and ask less often after an answer of zero

## Group 9 (4 items; findings AI-10, AI-14, AI-1, AI-9, AI-11, FT-4)
- W-ai-2 [now] A size baseline for the AI manager's round, a log line per round, and real tokens per call on Platform, AI
- W-ai-3 [now] Eval cases that make the model find a tool, and a first run kept as the 'before'
- W-ai-8 [next] The lean default round: core tools, the page's area and one routed area, the rest one load_tools call away (code review step 3.18)
- W-surface-8 [next] A smaller default round for the AI manager (code review step 3.18)

## Group 10 (3 items; findings CP-2, SD-10, CA-9, DQ-9)
- W-code-5 [now] One cached store-address helper for the 27 hand-written lookups behind production's most-called statement
- W-server-14 [now] Look a store's slug up once, and stop asking three tiny facts 11,000 times a day
- W-database-7 [now] Look a store's slug up once, and the AI provider row once per job run

## Group 11 (3 items; findings DD-11, CR-12, DS-14)
- W-code-6 [now] Remove the eight old admin redirects before opening; then the bookings and deliveries twin switch
- W-scheduled-2 [now] One scheduler: take the daily job out of Vercel's cron
- W-database-23 [later] Dead objects: drop the unused table and its enum; drop the leftover schema on the owner's word

## Group 12 (3 items; findings DP-5, AC-2, BN-14, AC-3, BN-5)
- W-code-12 [now] Load the rich text editor when an editor is drawn, not on 21 lists and detail pages
- W-owner-browser-3 [now] Previews and page lists stop loading the page builder
- W-owner-browser-4 [now] Custom fields and the rich text editor load when a screen draws them (orders, customers, deals, lists, the product editor)

## Group 13 (3 items; findings SC-8, PL-2, PM-1, CS-5)
- W-shopper-browser-11 [next] Send the store's layout once: the cart drawer's slot leaves the root layout, and the cart count is read once per render
- W-page-model-6 [next] Move the cart drawer's slot off the root layout, so the layout is drawn and sent once
- W-styles-6 [next] Send the layout's style sheets twice, not three times: the cart drawer's slot leaves the root layout (this is SC-8's change; nothing is built for sty…

## Group 14 (3 items; findings AC-5, AC-6, BN-6, TX-7)
- W-owner-browser-12 [next] The builder paints first: the rich text editor comes after, and one store language loads on demand
- W-page-model-15 [later] A block's dialog brings its own words (PM-10's last step, with code review steps 3.2 and 3.4)
- W-text-8 [next] The page builder loads one storefront language when a preview needs it, and the draft-order editor none (TX-7 and AC-6 are one change)

## Group 15 (3 items; findings CA-3, SD-4, DQ-2, PM-2)
- W-server-19 [now] Read one page, not all of them: a page by id and a page index
- W-database-10 [now] Read one page, not all: a page index and a page by id
- W-page-model-3 [now] Read one page by its id and titles from an index, not every published page whole

## Group 16 (2 items; findings DP-10, FM-2, FM-14, SG-3, SF-4)
- W-code-13 [now] Point the visit beacons, the recommendations beacon and the docs' feedback at the helpers' own files
- W-server-6 [now] Beacons and small public routes import their helpers from where they are defined, not through the chat module

## Group 17 (2 items; findings AS-1, DP-2, SG-7, SF-9)
- W-code-15 [now] Load sharp and opentype.js where a picture or a font is drawn
- W-server-11 [now] sharp and the font parser load when a picture or a font is made

## Group 18 (2 items; findings DP-11, SG-15)
- W-code-17 [now] Load the AI manager's server side when it is opened, not with every admin screen
- W-server-12 [now] The AI manager's engine loads when the assistant is first used, not with every admin page

## Group 19 (2 items; findings FM-3, FT-5)
- W-code-24 [next] One kaizenaflow.com: remove the old no-store site (step 7 of the parity plan), once the owner says the switch is final
- W-surface-6 [next] One Kaizena Flow site: finish step 7 of the parity plan

## Group 20 (2 items; findings CP-15, TC-11)
- W-code-31 [next] Shared test scaffolding: delete the 579 mocks of server-only and share one stub of next/cache
- W-build-16 [later] Shared mocks and store-makers for the integration tests: one setup file, and 448 lines that stub a module the config already stubs deleted

## Group 21 (2 items; findings AS-2, SF-8, SG-13)
- W-code-37 [later] Narrow what is traced beside a function: the taxonomy and sharp's native library only where a route can read them (after the import cycle is cut)
- W-server-50 [later] The taxonomy rides only with routes that can read it, and a product stores what the shop shows

## Group 22 (2 items; findings DP-12, SG-9)
- W-code-38 [later] Cut the page model so that reading a store builds no block schema (a constraint on code review step 3.2)
- W-server-48 [later] A store is read without the Stripe SDK and without the whole page model

## Group 23 (2 items; findings PF-1, SC-9, CA-6)
- W-shopper-browser-2 [now] End the prefetch loop on /s/ addresses, and write both router settings down
- W-server-22 [now] End the prefetch loop on /s/ addresses and hold it with a test

## Group 24 (2 items; findings SC-10, PL-7, SD-15)
- W-shopper-browser-4 [now] Wishlist: no call for a visitor who has none, by a marker cookie (PL-7's way; SC-10's seed in the page's stream would add the per-request hole that C…
- W-server-17 [now] No wishlist call for a visitor who has none: a marker cookie, not a part in the page's stream

## Group 25 (2 items; findings PF-3, PF-8, PF-12, CA-1, CA-17)
- W-shopper-browser-14 [next] One link wrapper with a stated policy: header tools, bottom bar, footers, menus and closed sub-menus fetch on intent
- W-server-32 [next] Store pages with nothing per visitor become static files, and Add to cart answers a number

## Group 26 (2 items; findings PL-6, PM-8)
- W-shopper-browser-21 [next] Draw a listing's grid once and read its list once
- W-page-model-9 [next] Send a filterable product grid once: the built grid stays, only the controls stream

## Group 27 (2 items; findings AC-8, BN-15, AI-4)
- W-owner-browser-6 [now] The AI manager's chat loads its own code, not every tool definition and the admin map
- W-ai-1 [now] Slim the AI manager's chat script: tool labels and page names only

## Group 28 (2 items; findings CR-5, DS-8)
- W-scheduled-1 [now] Keep pg_cron's run log for a week and clear the backlog once
- W-database-3 [now] Prune pg_cron's run log daily, and empty it once

## Group 29 (2 items; findings DQ-4, AI-2)
- W-database-8 [now] AI spend this month: the daily rows plus today, not the whole month on each call
- W-ai-4 [now] Screens and polls ask what the AI can do, not for its key

## Group 30 (2 items; findings PM-7, CS-4)
- W-page-model-13 [next] Draw the breakpoint sheet once per document, not once per row
- W-styles-4 [now] Draw the breakpoint sheet once per document, not once per row
