### What a shopper's browser loads (SC)

The storefront is leaner than the rest of the platform, but not lean. A cold home page sends 680 KB of scripts (213 KB gzipped); 63 % of that is React and Next themselves, and the store's own code is about 80 KB gzipped, with no zod, no whole-language texts, no third-party script and no large object passed into client components. In full: `bloat-review-2026-11/findings/storefront-browser.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| SC-1 ✓ | Every page prefetches the pages behind its links, including language and currency views nobody opens | eager | S | 0.9 |
| SC-2 | Listing, search, cart, checkout, account, wishlist and cookies pages all load one bundle of every working part | eager | M | 2.4 |
| SC-3 ✓ | Admin words and whole catalogues ride in every shopper's first scripts | oversize | S | 2.1 |
| SC-4 | The product page loads the cart's forms and every product kind's picker | eager | S | 2.4 |
| SC-5 | One stylesheet for stores, site and admin: shoppers download the admin's utility classes | oversize | M | 2.4 |
| SC-6 | The byte budgets are loose, count a file no modern browser loads, and cover one storefront route besides home | no check | S | 1.3 |
| SC-7 | On a wide screen the cart is rendered twice: once as a drawer that is thrown away, then as a full page | duplicate | S | 2.2 |
| SC-8 | The whole store layout is rendered and sent twice in every page, because the cart drawer's slot sits on the root layout | duplicate | M | 2.2 |
| SC-9 ✓ | Listing and search pages ask for one prefetch about 160 times a second on /s/ addresses | eager | M | 0.11 |
| SC-10 | Every page view asks the server for the wishlist, also for visitors who have none | eager | S | 0.9 |
| SC-11 | Parts no shopper sees, for staff or for features no store uses, are in every page's first scripts | ahead of use | S | 2.4 |

### What the server does for a storefront request (SD)

A warm, cached storefront page is lean: a prerendered home page, store page or empty cart makes no database read of its own. The bloat sits around that page. In full: `bloat-review-2026-11/findings/storefront-server.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| SD-1 | Three imports pull most of the server into the proxy and into every storefront page | eager | M | 2.8 |
| SD-2 | A product page asks the database about 18 times per view; one answer changes per view | eager | M | 2.3 |
| SD-3 | Every deploy empties the caches and nothing warms them, so most real visits are cold | no check | S | 2.7 |
| SD-4 ✓ | Every published page is read whole to pick one page or a few titles | oversize | M | 0.6 |
| SD-5 | A cold page waits on reads one after another before its first byte | eager | S | 2.3 |
| SD-6 | The proxy asks the database before most page views, static pages included | eager | S | 2.8 |
| SD-7 ✓ | Every instance starts by reading an empty table, then polls it each minute | ahead of use | S | 0.8 |
| SD-8 | Tagged reads still expire by the clock: 1 hour for 71 of them, 15 minutes for the home page | eager | M | 2.7 |
| SD-9 | Pages ask about features no store uses | ahead of use | M | 2.3 |
| SD-10 | The store is looked up by its id again and again | duplicate | M | 0.8 |
| SD-11 | The same shopper facts are read several times in one request | duplicate | S | 2.3 |
| SD-12 | Whole rows and documents are read for one fact | oversize | S | 2.3 |
| SD-13 | The browser's side has budgets; the server's side has none | no check | M | 1.2 |

### What an owner's browser loads in the admin (AC)

The admin's browser load is moderately bloated, not runaway, and most of the worst of it is cheap to fix. A plain admin screen loads 1.15 MB of script (0.35 MB gzip), down from 3.0 MB two weeks ago, but 43% of what every screen still loads (481 KB) is Supabase's whole client, zod and the builder's English text, pulled in by three stray imports. In full: `bloat-review-2026-11/findings/admin-browser.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| AC-1 ✓ | Three stray imports put Supabase, zod and the builder's English on every admin screen | eager | S | 0.10 |
| AC-2 | 26 screens load an editor they never draw, because lists, previews and editors share one views file | eager | S | 2.5 |
| AC-3 | Order, customer and deal screens load the rich text editor and the builder's schema for custom fields no store has filled in | eager | S | 2.5 |
| AC-4 | Pages hand whole text areas to the browser where their parts read a few branches; one area on every screen is read by nothing | oversize | M | 2.1 |
| AC-5 | The page builder loads everything at once: 3.3 MB of script before the first paint | eager | M | 2.5 |
| AC-6 | The builder and the draft order editor load the storefront's text in all four languages to read two branches | oversize | S | 2.1 |
| AC-7 | The Work invoice screen ships the whole admin catalogue, both languages, in one 1.7 MB chunk | oversize | S | 2.1 |
| AC-8 | The AI manager's chat downloads every tool definition, the admin map and the Norwegian page names to label a tool call | oversize | S | 2.5 |
| AC-9 | English text for 23 areas is still compiled into client scripts and then handed down again in the HTML | duplicate | M | 2.1 |
| AC-10 | The script budget covers 7 of 449 admin routes and none of the HTML | no check | S | 1.3 |
| AC-11 | The import guard that keeps zod and whole catalogues out of shoppers' scripts leaves the admin out | no check | S | 1.3 |
| AC-12 | Every navigation link in view is prefetched with Next's defaults, and what that costs is unmeasured | eager | S | 0.9 |

### What the server does for an admin navigation (AD)

The admin's server side is moderately bloated, and the bloat is in the shell and the two home screens, not in the lists. At today's size (60 stores, 102 orders) no single query is slow; what is wasteful is how much is redone: the store shell costs 67 to 129 ms of pure CPU to rebuild its menu (measured), reads the same membership three times, and is redrawn in full after every save (599 refresh() calls) and every poll tick. In full: `bloat-review-2026-11/findings/admin-server.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| AD-1 | The store menu is rebuilt with 220 slow permission lookups on every shell render | eager | S | 2.6 |
| AD-2 | The store Home runs 30 or more statements before it shows anything, some for nothing | eager | M | 2.6 |
| AD-3 | Every admin request from an account without two-step calls Supabase Auth, and may write | eager | S | 2.6 |
| AD-4 | The store shell reads one thing after another, and checks Stripe set-up on every render | eager | S | 2.6 |
| AD-5 | Every save and poll re-sends 51 to 63 KB of unchanged shell words and menu | oversize | M | 2.6 |
| AD-6 | The platform Home holds its first paint for 18 statements and reads whole lists to show a number | oversize | S | 2.6 |
| AD-7 | The products list reads the whole editor context and a per-product check it does not need | oversize | S | 2.6 |
| AD-8 | An account's memberships are read three or four times per request, in four shapes | duplicate | M | 2.6 |
| AD-9 | Progress polls redraw the whole admin, and a notice poll runs in every owner tab | eager | S | 2.6 |
| AD-10 | Three lists load everything; the customers list also groups every order before it cuts to 100 | oversize | M | 4.1 |
| AD-11 | The orders list re-reads store facts it already holds and waits in a row for the count | duplicate | S | 2.6 |
| AD-12 | Nothing counts what a screen costs the server, so the Home grew to 30 statements unseen | no check | M | 1.4 |

### Caching and rendering (CA)

The caching code itself is not bloated: 85 cached reads, 82 of them tagged, tags per store, and Kaizena Flow's own site and the docs are truly static. The waste is in how it meets the platform it runs on. In full: `bloat-review-2026-11/findings/caching.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| CA-1 ✓ | Every store page view runs a function that sends the whole page again, for two cart badges | eager | M | 2.2 |
| CA-2 | Cached reads live in one instance and one deploy, and the site deploys many times a day *(owner)* | no check | M | 2.7 |
| CA-3 ✓ | To read one page, the code loads every published page with its whole content | oversize | M | 0.6 |
| CA-4 ✓ | Language and currency links prefetch whole front pages that their click never opens | eager | S | 0.9 |
| CA-5 ✓ | Each admin screen prefetches 15 to 22 other screens, and the storefront, on sight | eager | S | 0.9 |
| CA-6 ✓ | A prefetch loop on listing and search pages at /s/{store} addresses | eager | M | 0.11 |
| CA-7 | partialPrefetching is unset: Next treats it as off, warns on every build and start, and will remove the choice | no check | S | 2.7 |
| CA-8 | A store's robots.txt, sitemap, llms.txt, blog feed and favicon are computed on every request with no HTTP cache | eager | S | 0.12 |
| CA-9 ✓ | Three tiny facts that almost never change are asked of the database 11,000 times a day | duplicate | S | 0.8 |
| CA-10 | Pages are rebuilt every hour and dropped after a quiet day, though every write already refreshes a tag | eager | S | 2.7 |
| CA-11 | One store owner saving their AI key refreshes every page of every store | oversize | S | 2.7 |
| CA-12 ✓ | Timers that poll and prune for nobody | ahead of use | S | 0.8 |
| CA-13 | The theme store's list is drawn twice and per request; a theme's neighbours reload every theme's snapshot | eager | S | 2.7 |
| CA-14 | Cache entries keyed by lists of ids are almost never asked for twice | oversize | S | 2.7 |

### Scheduled and background work (CR)

Scheduled work is the platform's steadiest load, and almost all of it finds nothing to do. Supabase wakes a 47 to 125 MB Vercel function 13,250 times a day, and those runs send roughly 170,000 statements a day to the database; the call that wakes the cron routes is the most expensive statement the app's role runs (3,974 s in total). In full: `bloat-review-2026-11/findings/scheduled-work.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| CR-1 ✓ | Nine routes are woken every minute whether or not anything waits | eager | M | 0.3 |
| CR-2 ✓ | The dispatcher runs all 83 jobs every five minutes: one cadence for everything, one ledger write per job | eager | M | 0.4 |
| CR-3 | Two every-minute routes and 36 dispatcher jobs poll features no store has ever used | ahead of use | S | 0.4 |
| CR-4 | AI upkeep re-reads whole catalogues every five minutes to learn nothing changed | eager | M | 2.10 |
| CR-5 ✓ | pg_cron's own run log is never pruned | dead | S | 0.5 |
| CR-6 | The cookie scan's due check runs per site every minute and is the database's largest source of sequential scans | eager | S | 0.3 |
| CR-7 | The theme-shots route rebuilds its whole wanted list every minute | eager | S | 0.3 |
| CR-8 | Kaizena Flow's own payouts are read from Stripe every five minutes | eager | S | 0.4 |
| CR-9 | The invoice job asks to issue the same waiting invoices every five minutes, and none has ever been issued *(owner)* | eager | S | 0.4 |
| CR-10 | The docs search index is rewritten row by row on every docs change | oversize | S | 2.10 |
| CR-11 | Finished or orphaned scheduled pieces are still deployed and polled | dead | S | 0.4 |
| CR-12 | The daily job is scheduled twice, at the same minute | duplicate | S | 0.3 |
| CR-13 | Status checks are kept raw for 91 days though the page shows one bar a day | oversize | S | 2.10 |
| CR-14 | Nothing limits or measures scheduled work, so each feature adds a poll | no check | S | 1.4 |

### How data is asked for (DQ)

The database is not under load: the app statements that cost production the most add up to about 39 minutes of database time in 78 days, and the slowest averages 145 ms. The bloat is in how often data is asked for and how much comes back: most of the work is done for nobody. In full: `bloat-review-2026-11/findings/queries.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| DQ-1 ✓ | Nine routes are called every minute to ask the database whether there is work, and there almost never is | eager | M | 0.3 |
| DQ-2 ✓ | Every published page is read whole to find one page or a few titles | oversize | M | 0.6 |
| DQ-3 | "Where is this picture used" scans every page's text for each picture, and the job re-checks every picture daily | eager | M | 2.10 |
| DQ-4 | Each request for an AI connection sums the store's whole month of AI usage | eager | S | 0.8 |
| DQ-5 | The five-minute dispatcher runs 84 jobs at once on 5 connections, and several redo real work every tick | eager | M | 0.4 |
| DQ-6 | The knowledge job reads every page whole every five minutes and re-cuts pages that have no text, forever | eager | S | 2.10 |
| DQ-7 | A page's frame asks about 20 questions each time its cache is cold, and the cache is cold far more often than the code assumes | eager | M | 2.10 |
| DQ-8 ✓ | "is not distinct from" on store_id keeps the index from serving the hottest reads | oversize | S | 0.7 |
| DQ-9 ✓ | The store's slug is looked up by id again and again: the most-called statement in production | duplicate | S | 0.8 |
| DQ-10 | Whole JSON documents are fetched where a field or a count is needed (61 page reads, 14 theme reads) | oversize | M | 2.10 |
| DQ-11 | Nothing counts queries: no budget per page or per tick, and production's statement statistics are not part of any routine | no check | S | 1.4 |
| DQ-12 ✓ | Every server instance polls an empty translations table at start and each minute | ahead of use | S | 0.8 |
| DQ-13 | 341 loops hold a database call in their body; the costly ones are jobs that loop over sites | eager | M | 4.1 |
| DQ-14 | 387 list reads have no limit by a heuristic count; a handful read a whole store's documents or samples | oversize | M | 4.1 |

### The database's shape (DS)

The database is wide, not rotten. About half of it has never been used: 245 listed tables of 486 never held a row, and they carry 47% of all columns, 49% of all indexes, 50% of all foreign keys and 45% of the lines of schema.ts. In full: `bloat-review-2026-11/findings/database-shape.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| DS-1 ✓ | Every server start loads the whole schema file, which no query uses | eager | S | 0.1 |
| DS-2 ✓ | Each server start waits for a database read of an empty table, then asks again every minute | eager | S | 0.8 |
| DS-3 | Unused features still run in the database on every write and every tick | ahead of use | M | 0.4 |
| DS-4 | A page's title, parts and flags live only inside its content JSON, so lists read and parse whole pages | oversize | M | 2.10 |
| DS-5 | The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date | eager | S | 2.10 |
| DS-6 | The platform is modelled three ways: null-store rows, platform_* twin tables and its own store *(owner)* | duplicate | L | 3.2 |
| DS-7 ✓ | `store_id is not distinct from` keeps Postgres from using the store indexes | oversize | S | 0.7 |
| DS-8 ✓ | 607 MB of the 731 MB database is outside the app's schema, and the scheduler's own run log has no pruning job | oversize | S | 0.5 |
| DS-9 | orders has 34 indexes, four of them starting (store_id, placed_at); 15 indexes in all are redundant | oversize | S | 4.1 |
| DS-10 | Where each picture is used is found by text-searching every page's JSON, again every day for every picture | eager | S | 2.10 |
| DS-11 | Ending one sandbox runs at least 800 deletes, one per store table per round | oversize | M | 4.1 |
| DS-12 | Nothing limits or reviews the schema's growth *(owner)* | no check | S | 1.5 |
| DS-13 | Three small retention gaps remain *(owner)* | oversize | S | 2.10 |
| DS-14 | A short list of dead database objects | dead | S | 4.1 |

### Dependencies (DP)

The dependency list itself is lean: 51 runtime packages for 473,000 lines, none without an importer, and every heavy browser library (3D viewer, video and AVIF encoders, code editor, Stripe elements) is loaded only on the press that needs it, so a shopper's first scripts carry no third-party library beyond React and Next. The bloat is in when server packages load: the built output shows 89 to 98% of the 830 routes evaluate the same 11 MB of server code on their first request, and with it 481 table definitions nobody queries through, the Stripe and Supabase SDKs, a font parser and sharp's 18 MB native library; the page-view beacon evaluates 1,415 of its 1,456 modules. In full: `bloat-review-2026-11/findings/dependencies.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| DP-1 ✓ | 481 table definitions are loaded and indexed in every function for a query API nobody calls | eager | S | 0.1 |
| DP-2 | sharp's native library, a font parser and a bzip reader load on nearly every cold start | eager | S | 0.2 |
| DP-3 | The Stripe and Supabase SDKs are evaluated by 97% of routes; reading a store builds a Stripe client to see if keys exist | eager | M | 2.8 |
| DP-4 ✓ | supabase-js and zod are 29% of the first scripts of every admin page | eager | S | 0.10 |
| DP-5 | The rich text editor loads on 21 admin lists and detail pages that may never show it | eager | S | 2.5 |
| DP-6 | Nothing limits what a route's server function loads, so every route came to load everything | no check | S | 1.2 |
| DP-7 | Three 125 MB Chromium functions are woken every minute and almost always find nothing | eager | S | 0.3 |
| DP-8 | A 26 MB icon package is installed and parsed each build for 26 paths | oversize | S | 4.3 |
| DP-9 | The existing plan's dependency item (FH12) names the wrong package twice | no check | S | 4.3 |

### Files that ship or are stored (AS)

The files this repo stores are mostly lean: all 150 files in public/ are referenced, every script and small folder is in use, supabase/ was cleaned this week (one snapshot, 789 migrations squashed), and pictures and fonts are stored once and cached for a year with no resizing per request. The bloat is in what gets packed into server functions. In full: `bloat-review-2026-11/findings/files.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| AS-1 ✓ | The image library (sharp, 19.8 MB) rides in 742 of 832 functions and in the proxy, and is loaded at every cold start | eager | S | 0.2 |
| AS-2 ✓ | The product taxonomy (13.3 MB of JSON) is packed into every function, the proxy and the health check included | oversize | M | 2.8 |
| AS-3 | Nothing checks what a server function carries | no check | S | 1.2 |
| AS-4 | Search suggestions ask Next's image service for pictures it refuses | dead | S | 0.12 |
| AS-5 | Public files are checked again on every page view, and six flags and two textures are far bigger than their job | oversize | S | 0.12 |
| AS-6 | The PDF routes carry all of react-dom (8.1 MB) to use one server renderer | oversize | S | 4.3 |
| AS-7 | Tailwind reads 22.5 MB that cannot hold a class: the migrations' SQL and the test files | dead | S | 2.4 |
| AS-8 | The decisions log is one 1.33 MB file and grew 7% in two days | oversize | M | 4.4 |

### What every AI call carries (AI)

The shopper chat is lean and well made: about 5,000 characters of prompt and tools a call. The AI manager is the bloated part: every model call carries about 160,000 characters (roughly 40,000 tokens, an estimate at 4 characters a token), 91% of it 124 tool definitions that do not depend on the question, and a turn makes up to 11 such calls; this is already step 3.18 of the code review, still Open, and nothing caches it. In full: `bloat-review-2026-11/findings/ai-calls.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| AI-1 ✓ | Every AI manager call sends 124 tool definitions, whatever the question or screen *(owner)* | eager | M | 2.9 |
| AI-2 | The AI connection is fetched on pages, polls and jobs that call no model | eager | M | 0.8 |
| AI-3 | Prompts are not cacheable and cached tokens are never counted | eager | M | 2.9 |
| AI-4 | The owner's browser downloads the model's whole tool catalogue and admin map | oversize | S | 2.5 |
| AI-5 | The five-minute knowledge and embedding jobs rescan everything to find nothing | eager | M | 2.10 |
| AI-6 | Autopilot, follow-up and saved-skill tools ride on every round, though nobody has used them | ahead of use | S | 2.9 |
| AI-7 | One text model does every job, small ones included | oversize | M | 2.9 |
| AI-8 | Tool schemas say more than the model needs | oversize | M | 2.9 |
| AI-9 | A turn does needless work before the first model call | eager | S | 2.9 |
| AI-10 | Nothing limits how large an AI call may grow | no check | S | 1.6 |
| AI-11 | The prompt lists every playbook, whatever the store has switched on | eager | S | 2.9 |
| AI-12 | Every open admin tab asks for AI manager notices once a minute | eager | S | 2.6 |

### The product's surface (FT)

The surface is far larger than its use: 560 pages, 110 store navigation links, 254 AI manager tools, 83 five-minute jobs and 481 tables serve 60 stores and 102 orders. About 100,000 lines of code (13% of src, a lower bound by file name), 42,000 lines of tests and 146 tables belong to 31 feature groups in which no store has ever written a row; most were built in the last weeks, so they are unused so far, not proven unneeded. In full: `bloat-review-2026-11/findings/features.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| FT-1 | 31 feature groups that no store has ever used are always on, with no switch *(owner)* | ahead of use | L | 3.1 |
| FT-2 | Nothing limits how fast the surface grows, and the pause of 29 October did not hold *(owner)* | no check | S | 1.5 |
| FT-3 | A feature's scheduled work runs whether or not any store uses it; the switch does not reach it | eager | M | 0.4 |
| FT-4 | The AI manager is offered 234 tools in a shop with nothing else on; about 80 are for features no store has used | eager | S | 3.1 |
| FT-5 | Kaizena Flow's site is kept twice since the switch of 7 November | duplicate | M | 3.2 |
| FT-6 | A whole developer platform is open with no user: API, OAuth server, MCP, apps, endpoints *(owner)* | ahead of use | M | 3.5 |
| FT-7 | A new shop's Advanced admin has 94 links and 35 settings; Basic lists two pages no store has ever used *(owner)* | oversize | M | 3.1 |
| FT-8 | Order rules ('Automation') and Workflows are two engines for the same job *(owner)* | duplicate | M | 3.4 |
| FT-9 | Campaigns and discount codes are two discount engines with two editors *(owner)* | duplicate | L | 3.4 |
| FT-10 | The parity rule builds platform twins nobody uses: 12 of 19 platform tables are empty *(owner)* | no check | S | 3.3 |
| FT-11 | Fiken is connected to no store while the stated aim is to make Fiken unnecessary *(owner)* | ahead of use | S | 3.5 |
| FT-12 | The unified theme concept still carries its older layers, five of them never used *(owner)* | duplicate | M | 3.4 |
| FT-13 | Four reward programmes with separate ledgers, all empty *(owner)* | duplicate | L | 3.4 |
| FT-14 | Ten carriers are built and none is connected; checkout's delivery code imports all ten | ahead of use | S | 3.1 |

### Families and twins (FM)

Copy-paste is not this codebase's problem: 1.5% of code lines sit in 8-line clones, and a scan of 3,974 files finds only 41 twin pairs. Carriers, payment providers, emails and the AI tools each have one core. In full: `bloat-review-2026-11/findings/families.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| FM-1 | Both languages of the admin's words (2.8 MB) load with 802 of 830 server entries, the storefront's included | eager | M | 2.1 |
| FM-2 ✓ | One import of sameSite through the chat module makes the four visit beacons load the whole server core | eager | S | 0.1 |
| FM-3 | kaizenaflow.com exists twice: the old no-store site is still built, edited and read beside the store that now serves it *(owner)* | duplicate | M | 3.2 |
| FM-4 | The platform's events have a second pipeline: 5 modules, 7 tables and 2 per-minute runners that copy the stores', and neither side has been used *(owner)* | duplicate | M | 3.3 |
| FM-5 | The parity rule makes a twin by default and nothing counts them: 9 platform tables on 6 November, 19 today *(owner)* | no check | S | 3.3 |
| FM-6 | Five CSV imports are five copies of one engine, screen and tick route | duplicate | M | 4.2 |
| FM-7 | 1,266 server actions, 50 on the shared wrapper; the rest repeat guard, language and failure handling | duplicate | L | 4.2 |
| FM-8 | Lists, tables, dates and selects are still hand-made per screen, and the counts are not held while the kit waits | duplicate | L | 4.2 |
| FM-9 | Fiken's sync engine is a copy of Tripletex's; a third accounting system would be a third copy | duplicate | M | 3.5 |
| FM-10 | Work and Domains have a second set of screens at account level, 29 to 77% the same as the store's | duplicate | M | 4.2 |
| FM-11 | Ten small pairs of near-copies, about 840 identical lines | duplicate | M | 4.2 |
| FM-12 | Small helpers are rewritten per file: 437 names appear in three or more files | duplicate | M | 4.2 |
| FM-13 | No check holds duplication or import reach, so twins and heavy imports arrive unseen | no check | S | 1.2 |

### The written rules and the agents' context (DC)

The part every session pays for is bloated: CLAUDE.md plus AGENTS.md is 44 KB (about 11,000 tokens, estimate at 4 characters a token), 71% of it a 295-line feature index, and the median change of the last 65 code commits touched files named by 2 of those 295 rules. The docs read on demand are very large (7.9 MB of Markdown, about 2 million tokens; decisions.md alone 1.33 MB) but cost nothing until opened; their real fault is format: one decision ID costs 2 to 45 KB to look up, 885 lines over 1,000 characters hold 24% of all docs bytes, and 41% of the folder is finished history that a search returns beside the living rules. In full: `bloat-review-2026-11/findings/written-rules.md`.

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| DC-1 ✓ | Every session loads a 295-line feature index; a typical change needs 2 of its lines *(owner)* | eager | M | 4.4 |
| DC-2 | One decision costs 2 to 45 KB to look up, and the newest 196 decisions sit under the wrong heading | oversize | M | 4.4 |
| DC-3 | Nothing caps the written rules, and one test makes the always-loaded file grow with every feature | no check | S | 1.6 |
| DC-4 | The six rule files are too big to open and are written as walls of text | oversize | M | 4.4 |
| DC-5 | CLAUDE.md sends agents to a 73 KB plan written before the platform was multi-tenant | eager | S | 4.4 |
| DC-6 | The code review's Progress table must be read before every fix and grows by about 0.9 KB a step | oversize | S | 4.4 |
| DC-7 | 41% of the docs is finished history that a search returns beside the living rules | dead | S | 4.4 |
| DC-8 | A feature's facts are restated in four to six places, in different words, and the copies drift | duplicate | L | 4.4 |
| DC-9 | The saved parity-wave workflow writes 120 KB specs and tells twelve agents to read them whole | no check | S | 4.4 |
| DC-10 | The Migration versions list has been frozen since 4 October, but CLAUDE.md still tells agents to record versions there | dead | S | 4.4 |
| DC-11 | The parity report commits 270 KB of generated tables beside the rows they are made from *(owner)* | duplicate | S | 4.4 |

