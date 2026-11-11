# Bloat review: Kaizena Flow (November 2026)

Written 11 November 2026, on commit `0bd814c`. The owner asked whether the platform is becoming bloated, and for a plan to remove all
bloat and to make sure the rest is fetched and loaded so that nothing is loaded, used or shown without need.

**How it was done.** Measured first, then read. A production build was made and served with the demo catalogue; 32 real pages were
opened in a browser with an empty cache and each asked what it transferred and which bytes of its scripts ran; Next's bundle analyzer
listed the source modules behind 19 routes; production's own statistics (Postgres's counters since 25 August, the scheduler's table,
the job ledger) were read, with no personal data; and two scans written for this review looked for unused and copied code. Then 14
reviewers each took one area, with those numbers in hand. Their reports are in `bloat-review-2026-11/findings/`, the measurements in
`bloat-review-2026-11/evidence/`, the scripts in `bloat-review-2026-11/scripts/`.

**Its limits.** The review was planned as 25 areas, each read by one reviewer, challenged by a second and planned by a third. The
account ran out of usage credits part-way: 14 areas were read, none was challenged by a second reviewer, and 11 areas were not read
(section 6). The lead then checked 32 of the 171 findings against the code, the build or production, among them every finding behind
phase 0; those carry a tick (✓). **The other 139 are one reviewer's reading.** Check one before starting its step (step 4.5). Savings
marked as estimates are estimates; times measured on the review's machine say nothing certain about Vercel.

**Read this first: the platform is not open yet (the owner, 11 November).** It opens to real store owners and shoppers soon. The 60
stores and 102 orders in production are the team's own demo, test and template stores. So an empty table says only that nobody has
tried the feature yet, and this review's first draft read too much into it. Three things follow. An unused feature is no reason to
retire, park or hide it: where a finding or a step argued so, it has been rewritten (cause 3, phase 3 and the questions below), and
the second reviewers re-weigh each such finding. What does count is what a feature costs a store that does not use it, because soon
there will be many stores each using a few features: that is most of phases 0 and 2, and it matters more at opening, not less. And
production's counts are scheduled work, builds, crawlers and the team's own testing, not shoppers: they show idle cost and what each
deploy redoes; what shoppers will add is in the browser and build measurements. Before opening is also the cheapest time for
structural change: there is no real data to move and nobody to disturb.

**What it builds on.** `docs/audits/code-review-2026-11.md` (its steps are named where a finding is already one of them),
`docs/performance.md` (the storefront's bundle rules, D211 and D212), `docs/build-memory.md`, `docs/capacity.md` and
`docs/platform-parity-plan.md`. Nothing here replaces them.

**Words.** Six kinds of bloat: *dead* (nothing uses it), *duplicate* (built more than once), *eager* (loaded, fetched or run before
it is needed, or for someone who will never need it), *oversize* (bigger than its job), *ahead of use* (built before any use and
paying a running cost today) and *no check* (nothing stops it growing). Effort: S under a day, M a few days, L a week or more.
Sizes are before compression unless a line says otherwise.

## Progress

This is a working document, kept as `code-review-2026-11.md` is: the table says where each step stands. Keep it true in the same
commit as the fix.

- **Status** is one of: Open, In progress, Done, Dropped (with the reason in Notes).
- When a step is done, set Done with the date and the commit, in a line. Check its "done when" first, with the script it names.
- If a finding proves wrong, say so in Notes and correct its row in the area's file; do not delete it. A finding without a tick is
  checked before its step starts, and gets its tick or its correction then.
- Steps marked *owner* wait for the owner's answer to a question in section 6.

**Phase 0: Stop the work done for nobody**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 0.1 | Cut the two import hubs | FM-2, DS-1, DP-1 | S | Open | |
| 0.2 | Load the image library when a picture is drawn | AS-1, DP-2 | S | Open | |
| 0.3 | Wake the per-minute routes only when work waits | CR-1, DQ-1, DP-7, CR-6, CR-7, CR-12 | M | Open | |
| 0.4 | Give each dispatcher job its own period, and skip what no store uses | CR-2, CR-3, DQ-5, FT-3, DS-3, CR-8, CR-9, CR-11 | M | Open | |
| 0.5 | Prune the scheduler's own log | CR-5, DS-8 | S | Open | |
| 0.6 | Read one page, not all of them | DQ-2, CA-3, SD-4 | M | Open | |
| 0.7 | Let the store's index serve the hottest reads | DQ-8, DS-7 | S | Open | |
| 0.8 | Stop asking for what does not change | DQ-9, CA-9, SD-10, DQ-12, DS-2, SD-7, CA-12, DQ-4, AI-2 | M | Open | |
| 0.9 | Stop prefetching what nobody opens | CA-4, SC-1, CA-5, AC-12, SC-10 | S | Open | |
| 0.10 | Take Supabase's client, zod and the builder's words off every admin screen | AC-1, DP-4 | S | Open | |
| 0.11 | End the prefetch loop on `/s/` addresses | SC-9, CA-6 | M | Open | |
| 0.12 | Let the CDN keep what is the same for everyone | CA-8, AS-5, AS-4 | S | Open | |

**Phase 1: Budgets, so it stays removed**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 1.1 | Make the measurements commands | (the base for 1.2 to 1.6) | S | Open | |
| 1.2 | A budget for what a function loads | AS-3, DP-6, SD-13, FM-13 | M | Open | |
| 1.3 | Browser budgets for every route, and for the document | AC-10, AC-11, SC-6 | S | Open | |
| 1.4 | Count statements per page and per round | DQ-11, AD-12, CR-14 | M | Open | |
| 1.5 | A budget for the surface, and a list of what is in use *(owner)* | FT-2, DS-12 | S | Open | |
| 1.6 | Budgets for an AI call and for the always-loaded rules | AI-10, DC-3 | S | Open | |

**Phase 2: Load on demand**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 2.1 | Give each area its own words | FM-1, SC-3, AC-4, AC-6, AC-7, AC-9 | L | Open | |
| 2.2 | Serve store pages from their static shell | CA-1, SC-8, SC-7 | M | Open | |
| 2.3 | A product view asks the database for what changes per view | SD-2, SD-5, SD-9, SD-11, SD-12 | M | Open | |
| 2.4 | Each storefront route loads its own parts and its own styles | SC-2, SC-4, SC-11, SC-5, AS-7 | M | Open | |
| 2.5 | Editors load when they are drawn | AC-2, AC-3, DP-5, AC-5, AC-8, AI-4 | M | Open | |
| 2.6 | A lighter admin shell and home | AD-1, AD-2, AD-3, AD-4, AD-5, AD-6, AD-7, AD-8, AD-9, AD-11, AI-12 | M | Open | |
| 2.7 | Caches that outlive a deploy and follow tags, not the clock | CA-2, CA-10, SD-8, SD-3, CA-11, CA-13, CA-14, CA-7 | M | Open | |
| 2.8 | Untangle the remaining import hubs, then narrow what is traced | SD-1, SD-6, DP-3, AS-2 | L | Open | |
| 2.9 | A smaller AI manager round *(owner)* | AI-1, AI-3, AI-6, AI-8, AI-9, AI-11, AI-7 | M | Open | |
| 2.10 | Jobs and lists find work without loading it | CR-4, DQ-6, DS-5, AI-5, DQ-3, DS-10, CR-10, CR-13, DS-13, DS-4, DQ-10, DQ-7 | L | Open | |

**Phase 3: Cost follows use, and one of each**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 3.1 | A feature costs nothing until a store uses it *(owner)* | FT-1, FT-4, FT-7, FT-14 | L | Open | |
| 3.2 | One Kaizena Flow site *(owner)* | FT-5, FM-3, DS-6 | L | Open | |
| 3.3 | One way to model the platform *(owner)* | FT-10, FM-5, FM-4 | M | Open | |
| 3.4 | One engine for one job *(owner)* | FT-8, FT-9, FT-13, FT-12 | L | Open | |
| 3.5 | Decide what opens on day one *(owner)* | FT-6, FT-11, FM-9 | M | Open | |

**Phase 4: Tidy, and finish the review**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 4.1 | The database's loose ends | DS-9, DS-14, DS-11, DQ-13, DQ-14, AD-10, L-1 | M | Open | |
| 4.2 | Families: one core each | FM-6, FM-7, FM-8, FM-10, FM-11, FM-12 | L | Open | |
| 4.3 | Unused code, packages and files | DP-8, DP-9, AS-6, L-2 | S | Open | |
| 4.4 | Written rules a session can afford *(owner)* | DC-1, DC-2, DC-4, DC-5, DC-6, DC-7, DC-8, DC-9, DC-10, DC-11, AS-8 | M | Open | |
| 4.5 | Finish the review | (section 6) | M | Open | |

Change log:

- 11 Nov 2026: written. Nothing started.

## 1. The headline

**The code is tidy; the weight is in what is loaded and run without need.** The usual suspects came back clean: no source file is
unreachable, 1% of exports are unused, 1.1% of code lines are exact copies, and all 51 runtime packages are imported. The bloat is of
another kind, and it has four causes that explain most of the 171 findings.

1. **A few imports tie everything to everything.** Almost every route's server code loads the same 10 to 12 MB in 1,900 to 2,500
   modules, whatever its job; the visit beacon, called on every page view, loads the admin's whole interface text, the AI manager's
   tools and the database schema. Two one-line edits, tried in a copy, took it from 1,890 modules to 639 (step 0.1). The browser has
   the same disease in a milder form: every admin screen loads Supabase's client, zod and the page builder's words.
2. **Work is found by asking, not by being told.** About 37,000 scheduled runs a day look for work that is almost never there, and
   the log of those runs is 564 MB of the 731 MB database. Pages are read whole to find a title; a picture's uses are found by
   searching every page's text; the same store slug is asked for 560,000 times.
3. **An idle feature is not free.** The platform is built ahead of its opening, so half the tables are empty, and that is as it
   should be. What is not: a feature costs the same whether or not a store uses it. Its job runs every five minutes, its tools go to
   the AI on every call, its code loads into every function. For one store that is little; it multiplies with every store that signs
   up. A few things are also built twice (Kaizena Flow's site, two rule engines, two discount engines). What a new owner sees first
   is the owner's choice, not waste.
4. **Nothing weighs a change.** The storefront's first scripts have a budget and it shows: the storefront is the leanest part.
   Server code, the document, statements per page, scheduled work, an AI call, the tables and the standing rules have none, and
   each grew unseen. 21 findings are this one finding.

Nothing is slow or broken today: the platform is not open, the database is idle and pages answer quickly. What is paid now is cold
starts, function time, tokens and the build. What is at stake at opening is that each cause grows with every store, every visit and
every feature, and before opening is the cheapest time to remove them.

| Area | Grade (A to E) | Why, in a line | The most useful change |
|---|---|---|---|
| The code itself: unused, copied, packages, files | A | No unreachable file, 1% unused exports, 1.1% copies, every package used, public files all referenced. | Keep it so: step 1.1's scans as commands. |
| What a shopper's browser gets | C | No zod, no third-party script, budgets held. But 54 to 70% of the script has not run when the page is idle, every view runs a function that sends the page twice, and links prefetch pages nobody opens. | Serve store pages from their static shell (step 2.2). |
| What an owner's browser gets | D | Every admin screen loads 1.4 MB, the page builder 3.8 MB with a 572 KB document; three stray imports put 481 KB on every screen. | Take them off (step 0.10), then load editors when drawn (2.5). |
| What the server loads and asks | D | 10 to 12 MB and 34 MB of traced files per function whatever its job; 18 statements for a product view, 30 before the admin's home shows. | Cut the import hubs (0.1, 2.8) and count statements (1.4). |
| Scheduled work | D | 37,000 runs a day that find nothing; nine functions woken every minute; a 564 MB run log. | Wake routes only when work waits (0.3) and give jobs their own periods (0.4). |
| The database | C | Careful table by table (1% dead columns, 15 redundant indexes, triggers gated, retention in place), but half of it is unused and the hottest reads cannot use their index. | Read one page, not all (0.6); let the index serve (0.7). |
| AI calls | C | The shopper chat is lean (5,000 characters a call). The AI manager sends about 160,000 characters on every call, up to 11 times a turn. | A smaller default round (2.9, the code review's 3.18). |
| The product's surface | Not graded | Before opening every feature is unused, so use cannot be judged. What can: an idle feature is not free (the rows above), and a few things are built twice. | Make cost follow use (0.4, 3.1) and decide the duplicates (3.2 to 3.4). The owner's call. |
| The written rules | C | Every session loads 11,000 tokens of which a typical change needs a few hundred; one decision costs up to 45 KB to look up. | A 7 KB core and rules loaded by path (4.4, the code review's 1.10). |
| Not graded | | The page builder's model, styles, interface text, tests with CI and the build, functions as such: not audited (section 6). | Step 4.5. |

## 2. What is good and should stay

- **There is almost no dead or copied code.** Of 4,133 source files none is unreachable and 42 are reached only by tests; 263 of
  25,753 exports are imported by nothing; 5,423 of 472,550 code lines sit in an exact copy. Carriers, payment providers, emails and
  the AI tools each have one core.
- **The dependency list is lean.** 51 runtime packages, none without an importer; every heavy browser library (the 3D viewer, the
  video and AVIF encoders, the code editor, Stripe's elements) loads on the press that needs it.
- **The storefront's bundle discipline works.** No zod, no whole language, no third-party script and no large object in a shopper's
  first scripts; `lazyView()` stand-ins; budgets in `e2e/performance.spec.ts`. It is the one place with a budget and the leanest
  place in the product. That is the argument for phase 1.
- **A warm storefront page asks the database nothing of its own.** Tags are per store on 82 of 85 cached reads, and Kaizena Flow's
  own site and the docs are truly static.
- **The database is careful table by table.** 59 of 5,806 columns are named by no code; 7 of 617 functions are called by nothing;
  triggers fire only when their columns change; nearly every log has a retention rule; `platform_settings` is never read whole.
- **The shopper chat is a model of a small AI call:** six tools, a 2,500-character prompt, history and results capped.
- **Store features already switch things off.** Tools of features that are off are not offered, their navigation is hidden, and
  Basic hides links without hiding pages. Phase 3 extends a mechanism that exists.
- **Files are stored once.** All 150 files in `public/` are referenced; pictures and fonts are stored once and cached for a year;
  the migrations were squashed this week.
- **The house knows how to hold a number.** `ratchet.scan.test.ts`, the scan tests and the byte budgets are the tools phase 1 needs.

## 3. Measured

| Measure | Figure | Findings |
|---|---|---|
| Size | 1,093,628 lines of TypeScript in `src`, 325,551 of them tests; 4,133 source files, 1,771 test files; about 28% of source lines are comments, blank or imports | |
| Routes | 560 pages and 268 route handlers; 772 prerendered addresses: 508 static, 262 need a function on every view (all 148 of the demo store's) | CA-1 |
| Production today | not open yet: 60 demo, test and template stores of the team's own, 102 test orders | |
| A storefront page's scripts | 808 to 1,098 KB loaded by the time the page is idle (268 to 329 KB compressed); 54 to 70% had not run. Empty cart: 938 KB, a third run | SC-2, SC-11 |
| Kaizena Flow's front page | 1,173 KB of script, 77% not run; it loads the admin's words, zod and Supabase's client | step 0.10 |
| An admin screen's scripts | 1.4 to 1.5 MB on every screen (about 490 KB compressed), 60 to 65% not run; product editor 2.6 MB; page builder 3.8 MB | AC-1, AC-2, AC-5 |
| First-load scripts by route (the build's own figure) | storefront: median 0.66 MB, most 0.75; store admin: median 1.10, most 3.15; the heaviest route 4.08 MB (a Work invoice) | AC-7, AC-10 |
| A document | storefront 104 to 166 KB, about 70% of it the page again as data; production's are 162 to 338 KB with the same share; product editor 416 KB, page builder 572 KB | CA-1, SC-8, AC-4 |
| Requests after load, visitor idle | storefront: 11 to 50 prefetches (cart 42, checkout 50); admin: 24 to 46 | CA-4, CA-5 |
| A prefetch loop | category and search pages on `/s/` addresses: about 160 requests a second without end, on a local build | SC-9, CA-6 |
| Server code per route | 10.5 to 14.9 MB in 1,890 to 2,852 modules for every route measured but the health check (1.2 MB, 308); plus 34 MB of traced files each | FM-2, DS-1, AS-1, AS-2, SD-1 |
| The two hub edits, in a copy | visit beacon 10,475 KB / 1,890 modules to 1,188 KB / 639; health check 1,155 to 417 KB; each other route about 600 KB less | step 0.1 |
| The build | 263 s here (type check 3.0 min; 1,426 pages in 29 s); peak memory 10.2 GB cold, 7.6 GB warm; `.next/server` 1.3 GB; one stylesheet of 183 KB for stores, site and admin | SC-5, FH10 |
| The database | 731 MB: the scheduler's log 564 MB, the app's schema 124 MB. 486 tables, 245 never held a row; 1,989 indexes, 1,006 never scanned (966 of them on the unused tables); 617 functions; 391 triggers | CR-5, DS-3, DS-9 |
| Scheduled work | nine routes woken every minute (12,960 calls a day; seven last ran 0 to 1 ms); 84 jobs every five minutes (24,192 runs a day, about 12.5 s of database work a round) | CR-1, CR-2 |
| The costliest statements, 78 days | the scheduler's calls 3,974 s; every published page with its content 781 s (79,778 calls, 2.3 million rows); a picture's uses 145 ms a call; `select slug from stores where id` 560,090 calls; an empty table polled 278,393 times; `cookie_scans` scanned 1.1 million times | DQ-2, DQ-3, DQ-9, DQ-12, DQ-8 |
| A product view | 18 statements for an anonymous view of a prerendered product | SD-2 |
| An AI manager call | 124 tool definitions, about 160,000 characters (about 40,000 tokens, an estimate), up to 11 calls a turn | AI-1 |
| The surface | 449 admin pages; a new shop's Advanced menu 94 links; 254 store AI tools; 31 feature groups not yet tried in production | FT-1, FT-7 |
| The standing rules | `CLAUDE.md` and `AGENTS.md` 44 KB in every session (about 11,000 tokens); `docs/decisions.md` 1.33 MB | DC-1, DC-2 |
| Pace | 112 commits in two days; a deploy empties every cached read | CA-2, FT-2 |

## 4. Findings

171 findings in 14 areas: 65 eager, 39 oversize, 27 duplicate, 21 no check, 12 ahead of use, 7 dead. 101 are small, 63 medium, 7 large.
Each area's file under `bloat-review-2026-11/findings/` gives every finding in full: where, the evidence, the cost today, the fix, the
saving and the risk. A tick (✓) means the lead checked it a second time. *(owner)* means it needs the owner's decision. Two more
findings are the lead's own, from production and the scans:

| ID | Finding | Kind | Effort | Step |
|---|---|---|---|---|
| L-1 ✓ | `commerce_legacy`, the single-store schema renamed on 24 September, is still in production: 34 tables, 96 rows, named by no code | dead | S | 4.1 |
| L-2 | The scan's suspects: 42 files and 655 exports that only tests reach (12,751 lines), 263 exports nothing imports, 2,205 exported though only their own file uses them | dead | S | 4.3 |

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


## 5. The plan

Five phases, in the order to do them. Phase 0 is small, safe and measured the day after from production; phase 1 keeps what phase 0
wins; phase 2 is the structural work; phase 3 makes cost follow use and holds the owner's decisions; phase 4 is tidying. Every finding is closed by exactly one
step. "Platform:" says what the step means for `/admin/platform` and Kaizena Flow's own site, by the house rule. A "done when" names
a script of `bloat-review-2026-11/scripts/` (step 1.1 makes them commands) or a production figure from
`evidence/production-database.md`.

**How this sits beside the code review's plan.** That plan stays. Where the two meet:

| Code review's step | Here |
|---|---|
| 1.4 one wrapper for server actions; 1.12 to 1.15 the admin kit | Step 4.2 counts what is left (50 of 1,266 actions) |
| 1.8 give the build room (FH10) | Not re-audited: the build's area did not run (step 4.5). Step 2.7's shared deploys touch it |
| 1.10 make the written rules cheap to read (FH4, FH5) | Step 4.4 gives it numbers and step 1.6 a standing check |
| 3.9 and 3.10 the catalogue's reads and tags (FF2, FF3, FF5) | Untouched. Step 0.6 is the same fault for pages, which no step there covers |
| 3.14 split `schema.ts` (FD5) | Step 0.1 does the half that costs at run time, in two lines |
| 3.15 keep the big tables lean (FD7, FD8) | Step 4.1 |
| 3.18 cheaper AI rounds and 3.20 a quick model (FA1, FA8, FA9) | Step 2.9: do it there, with these numbers |

### Phase 0: Stop the work done for nobody

**Goal:** remove what costs something every minute, every request or every cold start, with small changes that move no behaviour. **A person will notice:** nothing, which is the point: the same screens, a database a quarter of its size, colder pages that answer sooner, and a scheduler that sleeps when there is nothing to do. Twelve steps, nine of them small; none depends on another, so they can run side by side.

1. **Cut the two import hubs.** In the four visit beacons (`src/app/api/visit/**/route.ts`) import `sameSite` from `@/lib/same-site`, not through `src/server/chat-route.ts`, which brings the chat, the AI layer and the support desk with it. In `src/db/client.ts` make the schema import type-only and call `drizzle({ client: pool })`: nothing uses the query builder (0 `findMany`, 1,182 files import only `sql`), yet 481 table definitions are loaded and indexed at every cold start. Closes FM-2 ✓, DS-1 ✓, DP-1 ✓. S. Done when: `server-graph.mjs` reports `/api/visit` under 700 modules and 1.3 MB (1,890 and 10.5 MB today), and `src/db/schema.ts` at 0 KB for every route. Measured in a throwaway copy with exactly these two edits: the beacon fell to 639 modules and 1,188 KB, the health check from 1,155 to 417 KB, and every other route lost about 600 KB (`evidence/spike.md`). Platform: the same code serves it.
2. **Load the image library when a picture is drawn.** One helper, `src/server/sharp.ts`, returns `(await import("sharp")).default`, as `browser.ts` does for Chromium. The twelve server modules that import `sharp` at the top keep its types and call the helper where they draw. A scan test fails on a static import of `sharp` anywhere else. Closes AS-1 ✓, DP-2. S. Done when: in the analyzer's export `sharp` is no longer among the modules loaded with `/api/visit`, a storefront page or the proxy. Its 19 MB native file stays traced beside each function until step 2.8 untangles the imports. Platform: the same code.
3. **Wake the per-minute routes only when work waits.** Replace the nine every-minute pg_cron schedules with one job that runs a small SQL function each minute: one `exists()` per queue, `net.http_post` only when it is true, and every route once in 15 minutes as a net for work that comes due by the clock. CR-1 names each route's gate. Take the `crons` block out of `vercel.json` (the daily job is scheduled twice). Give the cookie scan's due check an index it can use, and let the theme-shots route keep its wanted list between runs. Closes CR-1 ✓, DQ-1 ✓, DP-7, CR-6, CR-7, CR-12. M. Done when: `commerce.cron_jobs` shows under 1,500 route runs a day while nothing waits (12,960 today); an integration test proves each kind of due work makes its gate true; a queued page job still starts within a minute. A new migration: it unschedules the nine and schedules the one. Platform: the same routes carry Kaizena Flow's own work.
4. **Give each dispatcher job its own period, and skip what no store uses.** `runJobs()` takes a period per job (300, 3,600 or 86,400 seconds), decided from one read of `cron_jobs` at the start. The nine prunes move to the daily route; jobs tied to a day or an hour run hourly. One statement of `exists()` per queue table marks the jobs of features nobody uses as skipped (the first row makes the job run; nothing is switched off for owners). One ledger write per round, not per job. Read Stripe's payouts daily, ask to issue invoices only where one waits, retire the finished `aiPictureMarks` backfill and decide `document-pdfs`. Closes CR-2 ✓, CR-3, DQ-5, FT-3, DS-3, CR-8, CR-9, CR-11. M. Done when: job runs a day fall from 24,192 to under 9,000 (`cron_jobs.runs`), the dispatcher writes the ledger 288 times a day, and a test proves a feature's first row makes its job run on the next round. Platform: its jobs (briefing, books, payouts) get periods too.
5. **Prune the scheduler's own log.** pg_cron writes a row with the whole command for every run and nothing deletes them. Add a daily pg_cron job that deletes `cron.job_run_details` older than seven days, in a new migration. Closes CR-5 ✓, DS-8 ✓. S. Done when: the `cron` schema is under 20 MB (564 MB of the 731 MB database today) and the database under 200 MB. Platform: one database.
6. **Read one page, not all of them.** `listPublishedPages()` (`src/server/pages.ts:664`) selects the whole content of every published page and has 37 call sites; nine want one page and most of the rest want slugs or titles. Add `publishedPageById(owner, id)`, cached per page, and `publishedPageHeads(owner, type)` (id, slug, titles, dates, flags), and move the find-by-id callers, the legal links, the platform's frame, robots, the sitemaps and llms.txt to them. Closes DQ-2 ✓, CA-3 ✓, SD-4 ✓. M. Done when: in production's statement statistics the read of `published` for every page of a type falls from about 1,000 calls a day to the few that draw every page (it is the costliest app statement today: 781 s, 2.3 million rows returned in 78 days). Platform: Kaizena Flow's own pages are read through the same function with a null owner.
7. **Let the store's index serve the hottest reads.** Postgres cannot answer `store_id is not distinct from $1` from an index, so each such read scans the table (145 uses in 52 files). One shared helper writes `store_id = $1` for a store and `store_id is null` for the platform; the owner helpers use it; a scan test fails on a new one in a `where`. Closes DQ-8 ✓, DS-7 ✓. S. Done when: a day apart, `pg_stat_user_tables.seq_scan` for `cookie_scans`, `pages`, `terms` and `menus` has risen by under 1,000 each (`cookie_scans` alone: 1.1 million scans of 1,945 rows in 78 days). Platform: the `is null` branch is the platform's.
8. **Stop asking for what does not change.** Three things. One `storeSlugOf(id)` backed by a map for the 20 copies of `select slug from commerce.stores where id` (560,090 calls, production's most-called statement). No read of `commerce.ui_translations` before an instance may take requests, and no per-minute timer while the table is empty (278,393 calls on a table that has never held a row). A light `aiAbilities(storeId)` for the places that only draw a button, and the month's AI cost kept as a running figure, not summed again on each call (237,563 provider reads and 8,514 sums for 19,104 AI calls). Closes DQ-9 ✓, CA-9 ✓, SD-10, DQ-12 ✓, DS-2 ✓, SD-7 ✓, CA-12 ✓, DQ-4, AI-2. M. Done when: each of the three statements' calls a day in `pg_stat_statements` is down by nine tenths. Platform: the provider read has a platform branch; keep it.
9. **Stop prefetching what nobody opens.** `prefetch={false}` on the language and currency links (`src/components/view-menu.tsx:56`: their click goes elsewhere, so the page they prefetch is never opened) and on footer and legal links. In the admin, prefetch the rail and the menu when the pointer or focus reaches a link, and never *View store*. Ask for the wishlist only when a marker cookie says the visitor has one. Closes CA-4 ✓, SC-1 ✓, CA-5 ✓, AC-12, SC-10. S. Done when: `measure-routes.mjs` shows the empty cart's requests after load under 15 (42 today; 81% of its prefetch bytes are language and currency views), the admin's orders list under 8 (32), and no `wishlist/saved` request for a new visitor. Platform: the platform admin's rail is the same component.
10. **Take Supabase's client, zod and the builder's words off every admin screen.** Three stray imports put 481 KB on 420 to 432 of 449 admin routes: move `typingIn()` and `AdminServiceWorker` into files of their own, and let `session.tsx` load the Supabase client with `import()` once the page is idle. The same imports reach Kaizena Flow's public front page, which loads 145 KB of the admin's words, 113 KB of zod and Supabase's client (`evidence/scripts-by-page.md`, site-home): check it in the same change. Closes AC-1 ✓, DP-4 ✓. S. Done when: the admin home's first scripts are under 0.8 MB before compression (1.28 MB today), the front page's under 0.7 MB (1.15 MB loaded today), and the budgets in `e2e/signed-in/admin-scripts.spec.ts` and `e2e/performance.spec.ts` are lowered to the new figures. Platform: yes: the platform admin and the public site are named in the check.
11. **End the prefetch loop on `/s/` addresses.** On a local build a category page and the search page ask for one link's `@drawer/[...rest]` segment about 160 times a second without end (`evidence/prefetch-storm.md`). Production on store hosts did not when checked, but CI's end-to-end jobs use exactly these addresses. Reproduce with `storm.mjs`, try the drawer slot without its catch-all page, and hold the fix with a spec that counts requests on a listing. Step 2.2 removes the slot from the root layout altogether. Closes SC-9 ✓, CA-6 ✓. M. Done when: a category page and the search page make under 100 requests in 8 s after load (2,686 today). Platform: no listing of its own; check the theme store's list.
12. **Let the CDN keep what is the same for everyone.** `Cache-Control` with `s-maxage` on a store's sitemap, llms.txt, blog feed and favicon redirects, and 300 s on robots.txt: all are computed on every request today. A long cache on public files that never change. Stop search suggestions asking Next's image service for pictures it refuses. Closes CA-8, AS-5, AS-4. S. Done when: `curl -I` shows the headers and a second request inside the window is a CDN hit. Platform: Kaizena Flow's own sitemap and robots already answer from the cache; check the feed.

### Phase 1: Budgets, so it stays removed

**Goal:** turn each measure of this review into a number a test holds and only lets fall. 21 of the 171 findings are the same finding: nothing checks this. The house already has the tool (`ratchet.scan.test.ts`); this phase points it at weight. **A person will notice:** a change that makes a page, a function, a round of jobs or an AI call heavier fails a check and has to say why.

1. **Make the measurements commands.** Move the scripts in `docs/audits/bloat-review-2026-11/scripts/` to `scripts/bloat/` with `pnpm bloat:routes`, `bloat:server`, `bloat:unused` and `bloat:copies`, each writing a small JSON beside a kept baseline. Run them in a nightly CI job against the build and post what moved. Closes (the base for 1.2 to 1.6). S. Done when: one command each reproduces the tables of section 3 on a fresh checkout. Platform: the page list includes the platform admin and the public site.
2. **A budget for what a function loads.** A ratchet over the analyzer's export: modules and kilobytes loaded with one route of each kind (beacon, API, storefront, admin, cron), and megabytes traced beside it. An import-graph test in the style of `pay-routes.graph.test.ts`: `proxy.ts` and the beacons may not reach `auth.ts`, `pages.ts`, `admin-text.ts` or `schema.ts`. Closes AS-3, DP-6, SD-13, FM-13. M. Done when: raising a route's modules fails a test until the baseline is raised with a reason. Platform: one route of the platform admin is in the set.
3. **Browser budgets for every route, and for the document.** The build already writes first-load bytes for all 560 routes (`.next/diagnostics/route-bundle-stats.json`): hold them per route group with a ratchet, in place of budgets on 7 of 449 admin routes and 2 storefront routes. Add document bytes for ten key pages. Extend the import guard of `storefront-bundle.scan.test.ts` to the admin's shell: no zod, no whole catalogue, no Supabase client. Closes AC-10, AC-11, SC-6. S. Done when: every route has a budget, and step 0.10's three imports cannot come back unseen. Platform: covered: the file lists every route.
4. **Count statements per page and per round.** A test helper that counts the statements one render sends (a counting wrapper round `db()` in the integration tests), with budgets for the storefront home, a product, the admin's store home and orders list, an idle dispatcher round and an idle per-minute route. Once a month, read production's top statements as a routine: the query is in `evidence/production-database.md`. Closes DQ-11, AD-12, CR-14. M. Done when: the product view's 18 statements and the store home's 30 are numbers in a baseline file. Platform: the platform home (18 statements) is in the set.
5. **A budget for the surface, and a list of what is in use.** A scan test over counts: `page.tsx` files, navigation links, AI tools, dispatcher jobs, tables, indexes, triggers and feature ids. A count rises only with a decision line that names the switch the feature sits behind and the gate of its job, so a new feature costs nothing until a store uses it. At each quarterly squash, list the tables with no row and the indexes with no scan since the last one. Closes FT-2, DS-12. S. Done when: the baseline file exists and a new table or job without a named gate fails the test. The owner's question 6. Platform: counted the same way.
6. **Budgets for an AI call and for the always-loaded rules.** The default AI manager round's characters (prompt and tools, drawn as in `prompt-versions.ts`) may not rise above a baseline, with a cap per tool definition. `CLAUDE.md` and each rule file get a ceiling in bytes: today one test makes the always-loaded file grow with every feature. Closes AI-10, DC-3. S. Done when: both baselines exist and a larger round or a longer `CLAUDE.md` fails a test. Platform: the platform's 39 tools are in the count.

### Phase 2: Load on demand

**Goal:** the structural half: each page, function, job and AI call loads what it uses, when it uses it. **A person will notice:** a store page that arrives from the CDN with no function run; admin screens at about half their weight; a product view that asks the database three questions, not eighteen; an AI manager that answers sooner for a third of the tokens.

1. **Give each area its own words.** `src/lib/admin-text.ts` imports all 136 catalogue files into one object that 602 files import, 35 of them outside the admin. So 802 of 830 server entries load 2.8 MB of words, the storefront's and the beacons' included. Give each area a small module that exports its words by language; move the 35 non-admin importers first and hold them with a scan test; then the admin, by codemod. In the browser: hand client parts the branches they read, stop compiling English into scripts and sending it again in the HTML, give the builder and the draft-order editor two branches of the storefront's text (not four languages of it), and break up the Work invoice screen's 1.66 MB chunk. Closes FM-1, SC-3 ✓, AC-4, AC-6, AC-7, AC-9. L. Done when: `src/lib/admin-messages` is 0 KB in the server code of a storefront page and of the beacons (2.9 MB today) and under 300 KB for an admin page; the storefront home loads none of it (35 KB today). Platform: the platform's areas move with the rest.
2. **Serve store pages from their static shell.** Every prerendered store page is marked `resuming`: a function runs on each view and sends the page again as data (98 KB of the demo home's 138 KB) to place two cart badges and a country hint. Give the cart count to the browser the way the wishlist hearts get theirs: one small "mine" answer, asked only when a marker cookie says there is a cart or a wishlist. Take the cart drawer's slot off the root layout, so the layout is not rendered and sent twice in every page and the cart is not drawn twice on a wide screen. Closes CA-1 ✓, SC-8, SC-7. M. Done when: `.next/prerender-manifest.json` marks the demo store's home, built pages and blog `static` (all 148 are `resuming` today); the home document is under 60 KB before compression (135 KB here, 203 KB in production); a visitor without a cart causes no function run on a prerendered page. Platform: Kaizena Flow's front page is already static; its store's pages gain the same.
3. **A product view asks the database for what changes per view.** An anonymous view of a prerendered product sends 18 statements; one answer (stock) changes per view, and stock is read twice. Read stock once per request. Put what only the owner changes (checkout's look, payment state, checkout fields, quote mode, back in stock, price breaks, producer schemes) in one cached read per store and market that its writers refresh. Run the reads before the first byte together, and skip those of features that are off. Closes SD-2, SD-5, SD-9, SD-11, SD-12. M. Done when: step 1.4's counter shows three statements or fewer for an anonymous product view. Platform: no products of its own.
4. **Each storefront route loads its own parts and its own styles.** Listing, search, cart, checkout, account, wishlist and cookies pages share one bundle of every working part: give each route a small server module that imports only its own sections. Take the cart's forms and every product kind's picker off the product page, and staff-only parts out of every page's first scripts. Split the one 183 KB stylesheet that serves stores, site and admin by route group, and point Tailwind's `@source` at code only (it reads 22.5 MB of migrations and tests that cannot hold a class). Closes SC-2, SC-4, SC-11, SC-5, AS-7. M. Done when: a category page's first scripts are the home page's plus its listing; the storefront's stylesheet is under 130 KB before compression. Platform: the public site gets its own stylesheet group.
5. **Editors load when they are drawn.** Lists, previews and editors share one views file, so 26 screens load an editor they never draw. Order, customer and deal screens load the rich text editor for custom fields no store has filled in. The page builder loads 3.3 MB before its first paint: load a block's fields when the block is opened. The AI manager's chat downloads every tool definition and the admin map to label a tool call. Closes AC-2, AC-3, DP-5, AC-5, AC-8, AI-4. M. Done when: first scripts before compression: page lists and previews under 1.4 MB (2.0 to 3.3 MB today), an order screen under 1.4 MB (2.0), the builder under 2.2 MB (3.3), the chat's chunk under 200 KB (496). Platform: the platform's page lists and builder are the same files.
6. **A lighter admin shell and home.** Keep the menu's permission answers in a map (220 lookups and 65 to 130 ms of CPU per shell render today). Read the shell's facts together, and not Stripe's set-up on every render. Answer the two-step question without a call to Supabase Auth per request (security-sensitive: clear the kept answer when a factor is added or removed). Read an account's memberships once per request. Show the store home after about 8 statements, not 30, and the platform home after 11, not 18. Stop re-sending 51 to 63 KB of shell with every save and poll, and send the unread count with the layout, not by a poll in every tab. Closes AD-1, AD-2, AD-3, AD-4, AD-5, AD-6, AD-7, AD-8, AD-9, AD-11, AI-12. M. Done when: step 1.4's counter: the store home shows its first content after 10 statements or fewer, and a shell render spends under 5 ms on the menu. Platform: the platform home is named above; the shell is shared.
7. **Caches that outlive a deploy and follow tags, not the clock.** A cached read lives in one instance's memory and dies with each deploy, and main took 112 commits in two days. Let pushes share a deploy (skip when a newer commit waits, or deploy at most every few minutes): the owner's question 7. Use `use cache: remote` for the one or two reads every request needs. Give reads whose every writer refreshes a tag a long-lived profile (70 of 85 expire by the hour today). Warm the main pages in the deploy job. Let a store's AI key refresh that store, not all 60. Make `/themes` static. Write `partialPrefetching: false` now to record the choice, and adopt it per segment later. Closes CA-2, CA-10, SD-8, SD-3, CA-11, CA-13, CA-14, CA-7. M. Done when: after a deploy the first view of the demo home is warm, and background redraws of an unchanged store page fall from hourly to none. Platform: its settings read is one of the two reads worth a remote cache.
8. **Untangle the remaining import hubs, then narrow what is traced.** The proxy runs before every page view and its imports reach 1,311 modules (0.85 s and 167 MB to load cold, measured here). Move its five reads to leaf modules; stop `customers.ts` importing the erase path at the top; give `two-step.ts` its few words without `admin-text.ts`. Answer the proxy from memory and refresh in the background. Stop `stores.ts` building a Stripe client to learn whether keys exist, and put the Stripe and Supabase SDKs behind `await import()`. Then replace the `"/**"` trace of the 13 MB taxonomy with the routes that read it, held by a scan test. Closes SD-1, SD-6, DP-3, AS-2 ✓. L. Done when: the proxy loads under 300 modules; a storefront page's server code is under 4 MB (11.9 MB today); the files traced beside the visit beacon are under 1 MB (34 MB). Platform: the same proxy.
9. **A smaller AI manager round.** Every model call carries about 160,000 characters (about 40,000 tokens, an estimate), 91% of it 124 tool definitions that do not depend on the question, and a turn makes up to 11 calls. This is the code review's step 3.18 with numbers: do it there. Send the core tools, the page's area and `load_tools`; load the autopilot, follow-up and skill tools as a group when needed; make the prompt cacheable (the minute out of its second line, a fixed tool order, cache markers, cached tokens counted); slim the two product tools' schemas; check ownership with one row; list playbooks by feature; and a quick model for small jobs (step 3.20 there). Closes AI-1 ✓, AI-3, AI-6, AI-8, AI-9, AI-11, AI-7. M. Done when: a default round is under 60,000 characters, the agents' safety eval passes and its recording is renewed. The owner's question 9. Platform: the platform's assistant runs the same loop.
10. **Jobs and lists find work without loading it.** The knowledge job reads every page whole every five minutes to compare a date, and re-cuts pages with no text for ever (91,200 empty transactions): select ids and dates first, and record that a page was cut. "Where is this picture used" text-searches every page for each picture, again each day for every picture (145 ms a call): refresh on change. Give pages plain columns kept at publish (title, the kinds of parts) so lists and "does this site use a form" read facts, not documents. Write the docs index only for rows that changed (33 MB from 49,347 rewrites of 1,845 rows). Keep status checks as one row a day after the first week. Closes CR-4, DQ-6, DS-5, AI-5, DQ-3, DS-10, CR-10, CR-13, DS-13, DS-4, DQ-10, DQ-7. L. Done when: the dispatcher's AI upkeep jobs take tens of milliseconds on an idle round (about 2 s today), and the admin's Pages list reads no page content. Platform: the docs index and the status page are the platform's own.

### Phase 3: Cost follows use, and one of each

**Goal:** make a feature cost nothing for a store that does not use it, and keep one of each thing. Nothing here retires a feature because it is unused: before opening they all are. Where a step is a product choice it says so, and the evidence is in `findings/features.md` and `findings/families.md`. **A person will notice:** a store that sells ten products and nothing else runs no job, loads no code and offers the AI no tool for what it has not switched on; and there is one place to edit Kaizena Flow's site.

1. **A feature costs nothing until a store uses it.** The D178 registry already takes a feature's navigation and AI tools away from a store that has it off. Give every optional feature group an id there (31 groups have none: email marketing, text messages, creators, automation, developer tools, ads and feeds, A/B tests, recommendations, price lists, purchasing, staging, content types, own books, the autopilot and more), and let the id also gate the group's jobs (step 0.4's check), its checkout code (ten carriers' adapters load for a checkout that uses one) and its tools. Whether a group starts on or off for a new store is the owner's product choice (the Homer rule: a new shop's Advanced menu has 94 links and 35 settings pages today), not a saving. Closes FT-1, FT-4, FT-7, FT-14. L. Done when: a store with only the shop on runs no job, loads no adapter and is offered no tool for a group it has not switched on, and the owner has chosen each group's starting state. The owner's question 2. Platform: the registry is the store's; the platform's own groups follow step 3.3.
2. **One Kaizena Flow site.** Since the switch of 7 November kaizenaflow.com exists twice: the old pages without a store are still built, edited and read beside the store that now serves it (about 4,500 to 6,800 lines, 32 pages, 12 navigation links, 3 to 5 tables, and a null-store branch in 56 server modules). Finish step 7 of `docs/platform-parity-plan.md`: remove the null-store site paths. Closes FT-5, FM-3, DS-6. L. Done when: one place edits the site, and `/admin/platform` has no second set of page, header, footer and menu screens. The owner's question 3. Platform: this is the platform's step.
3. **One way to model the platform.** The platform is modelled three ways: rows with a null store, `platform_*` twin tables (19 today, 9 on 6 November) and, since 7 November, a store of its own. Each new twin copies a store feature's tables, jobs and screens. Now that Kaizena Flow has a store, a store feature can serve the platform through it, and a twin is needed only where the platform's need has no store form (sign-ups, plans). The house rule's aim stays: the platform gets what stores get. Fold the platform's second event pipeline (5 modules, 7 tables, 2 per-minute runners that copy the stores') into the stores'. Closes FT-10, FM-5, FM-4. M. Done when: `CLAUDE.md`'s convention says which of the three ways a new feature uses, and step 1.5's count of `platform_*` tables stops rising. The owner's question 1. Platform: this is the platform's rule.
4. **One engine for one job.** Order rules and Workflows are two engines for the same job (about 1,900 lines and 2 tables to fold). Campaigns and discount codes are two discount engines with two editors. Bonus, referrals, affiliates and creators keep four ledgers for four kinds of reward. The unified theme concept still carries older layers beside it. Each pair is two things to learn, test and keep in step. Which stays is the owner's choice, and before opening no data needs moving. Closes FT-8, FT-9, FT-13, FT-12. L. Done when: per pair, the owner has chosen which engine stays, and the other's screens, tables and tools are folded into it. The owner's question 4. Platform: Kaizena Flow's own discounts and referrals follow the engine that stays.
5. **Decide what opens on day one.** The Admin API, the OAuth server, MCP, custom apps and webhook endpoints are 20 or more public handlers that will be open to the internet from the first day. That is a question of scope and of what must be watched at opening, not of waste: decide whether they open with the platform or behind a switch until someone asks. Fiken's sync engine is a copy of Tripletex's: give the two one core before a third accounting system arrives (the code review's step 3.12). Whether Fiken stays beside the own books is the owner's call. Closes FT-6, FT-11, FM-9. M. Done when: the owner has decided the opening scope, and the two accounting connectors share one sync core. The owner's question 5. Platform: Kaizena Flow's own API (D518) is part of the same decision.

### Phase 4: Tidy, and finish the review

**Goal:** smaller things, done when their area is next touched, and the part of this review that did not run. **A person will notice:** little. Sessions start with a quarter of today's standing instructions; a search of the docs returns rules, not history.

1. **The database's loose ends.** Drop the 15 redundant indexes (on orders and visits concurrently, as D569 says); `idempotency_keys` and the seven functions nothing calls; the `commerce_legacy` schema, kept since 24 September as a renamed copy of the single-store schema (34 tables, 96 rows, named by no code). End a sandbox in one pass in foreign-key order, not 800 deletes. Bound the three admin lists that load everything, and the worst of the 341 loops with a database call in their body. With the code review's step 3.15. Closes DS-9, DS-14, DS-11, DQ-13, DQ-14, AD-10, L-1. M. Done when: the advisors show no duplicate index, and `\dn` shows no `commerce_legacy`. Platform: one database.
2. **Families: one core each.** Five CSV imports are five copies of one engine, screen and tick route (about 2,200 lines). 50 of 1,266 server actions are on `storeAction()` (the code review's step 1.4 goes on as files are touched). Lists, tables, dates and selects are hand-made per screen (its steps 1.12 to 1.15). Work and Domains have a second set of screens at account level. 437 helper names are defined in three or more files. Closes FM-6, FM-7, FM-8, FM-10, FM-11, FM-12. L. Done when: per family, the count in `findings/families.md` has fallen and a ratchet holds it. Platform: the platform's screens use the same kit.
3. **Unused code, packages and files.** Delete by tier after checking each list against the scan's blind spots (`evidence/unused-code.md`): 263 exports nothing imports; 655 exports and 42 files only tests reach (12,751 lines with their tests' subjects). Replace the 26 MB icon package installed for 26 paths. Give the PDF routes React's server renderer without all of `react-dom`. Correct FH12 in the code review, which names the wrong package twice. Closes DP-8, DP-9, AS-6, L-2. S. Done when: `unused-code.mjs` reports under 100 unused exports and no file only tests reach, and the type check and the scan tests pass. Platform: nothing separate.
4. **Written rules a session can afford.** With the code review's step 1.10, which this gives numbers. Every session loads 44 KB (about 11,000 tokens), 71% of it a 295-line feature index of which a typical change needs two lines: keep a core of about 7 KB and load a rule when its files are opened. One file per decision (a lookup costs 2 to 45 KB today, and the newest 196 decisions sit under the wrong heading). Rule files of 4 KB, not 49 to 163 KB. Point `CLAUDE.md` at `docs/platform.md`, not the 73 KB plan from before multi-tenancy. Keep Progress notes to a line. Keep finished history (41% of the docs) out of default searches. Stop recording migration versions in a list frozen since 4 October. Closes DC-1 ✓, DC-2, DC-4, DC-5, DC-6, DC-7, DC-8, DC-9, DC-10, DC-11, AS-8. M. Done when: `CLAUDE.md` is under 10 KB and step 1.6's ceiling holds it. The owner's question 8. Platform: the same rules.
5. **Finish the review.** Five areas were not audited: the page builder's model and how a built page is rendered, styles, interface text, tests with CI and the build, and server functions as such. Six more rest on this review's measurements alone. And 139 findings were read by one reviewer only. Run the five audits, and give a finding its second check before its step starts. Closes (section 6). M. Done when: section 6's list is empty and every finding in section 4 carries a tick or a correction. Platform: the same audits cover it.


## 6. Not reviewed, and the owner's questions

**Not reviewed.** These areas had a reviewer who did not finish before the credits ran out. What is known comes from the measurements only.

| Area | What is known | Where |
|---|---|---|
| The page builder's model and a built page's render | The builder loads 3.8 MB and a 572 KB document; whether a page's JSON is checked per request, and what the model stores twice, was not read | `evidence/routes.md` |
| Styles | One 183 KB stylesheet for everything, 21 to 36% of it unused on a page by the browser's count | SC-5, AS-7 |
| Interface text | The admin's words load with 802 of 830 server entries; unused keys and the type check's cost were not read | FM-1, AC-9 |
| Tests, CI and the build | 1,771 test files; the build's time and memory above; FH10 open in the code review | section 3 |
| Server functions as such | Covered in part by the import findings; cold-start time on Vercel is not measured | step 0.1, 2.8 |
| Client bundles, the document, prefetching, unused and copied code, the server's module graph | Measured, and partly covered by other areas' findings; no reviewer read them as areas of their own | `evidence/` |

Not measured at all: real cold-start times and function invocations on Vercel (its metrics need a plan the team does not have),
real visitors' speed, and the admin on a slow connection.

**The owner's questions.** Each stops a step until answered.

1. **One way to model the platform (step 3.3).** Kaizena Flow now has a store of its own. May a store feature serve the platform
   through that store, with a `platform_*` twin built only where the platform's need has no store form?
2. **A new store's starting state (step 3.1).** Which feature groups should a new store start with switched on? This is a product
   choice (what Homer sees first), not a saving: step 3.1 makes a group cost nothing until it is used, either way.
3. **One Kaizena Flow site (step 3.2).** May the old pages without a store be removed, now that the store serves the site?
4. **One engine for one job (step 3.4).** For each pair (order rules and Workflows; campaigns and discount codes; the four reward
   programmes; the theme layers), which stays? Before opening, no data needs moving.
5. **What opens on day one (step 3.5).** Do the developer platform's public handlers open with the platform, or behind a switch
   until someone asks? Does Fiken stay beside the own books?
6. **A budget for the surface (step 1.5).** May a new table, job, page or AI tool have to name the gate that keeps it free for
   stores that do not use it?
7. **Deploys (step 2.7).** May pushes share a deploy, so dozens of deploys a day become a dozen and cached pages live longer? It changes
   D5's "at once" by a few minutes.
8. **The standing rules (step 4.4).** May `CLAUDE.md` shrink to a 7 KB core with rules loaded by path? It changes how every session
   starts.
9. **The AI manager's default tools (step 2.9).** The same question as the code review's question 8: may a round start with the
   core tools and the page's area, and load the rest on need?
10. **This plan in `CLAUDE.md`.** The code review has a three-line pointer there. Should this plan have one, or should sessions be
    sent to it by hand?
