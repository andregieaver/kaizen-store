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
- **The goal is grade A in every area** (the owner, 11 November). Section 1 says what an A is for each area, in numbers. When
  verified fixes raise an area's grade, change it in the scorecard with the old grade and the date beside it, and show the owner the
  new table. Raise a grade only for fixes seen working in production, measured with the script or the query the bar names.

{{PROGRESS}}

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

### The goal: grade A in every area

The plan is done when every area is an A, not when its steps are ticked. The grades mean the same in every area:

- **A:** nothing in the area is loaded, fetched, run or shown without need, beyond a small stated tolerance, and a test or a
  production figure holds each measure so it cannot slip back unseen.
- **B:** the large causes are gone and budgets exist; small findings remain.
- **C:** a sound base with real waste; some of it is held, most is not.
- **D:** every page, function or run carries far more than its job needs, and nothing holds it.
- **E:** waste that hurts people or costs money today. No area is an E.

| Area | Today | Grade A when | Steps that get it there |
|---|---|---|---|
| The code itself | A | It stays so: no unreachable file, unused exports under 1%, exact copies under 1.5%, every package imported, and the two scans run as commands. | 1.1, 4.3 |
| What a shopper's browser gets | C | A prerendered store page costs a visitor without a cart no function run. The home document is under 60 KB and nothing in it is sent twice. A page loads its own parts only: script not yet run when the page is idle under 45% (54 to 70% today). An idle visitor causes under 12 requests after load. The storefront has a stylesheet of its own under 130 KB. Every route has a script and a document budget. | 0.9, 0.11, 0.12, 2.2, 2.4, 1.3 |
| What an owner's browser gets | D | A plain admin screen's first scripts are under 0.7 MB (1.4 to 1.5 MB loaded today) and its document under 100 KB. An editor's code loads when the editor is opened: the page builder under 2 MB at first paint (3.8 MB). A screen prefetches on intent: under 8 requests. Every one of the 449 routes has a budget. | 0.9, 0.10, 2.1, 2.5, 2.6, 1.3 |
| What the server loads and asks | D | A function loads what its job needs: a beacon under 300 modules, a storefront page under 4 MB of server code, under 1 MB of files traced beside a function that draws no picture. The proxy loads under 300 modules and blocks on no read once warm. An anonymous product view asks 3 questions or fewer; the admin's home 10 before its first content. Budgets hold each. | 0.1, 0.2, 0.6, 0.8, 2.1, 2.3, 2.6, 2.8, 1.2, 1.4 |
| Scheduled work | D | No function is woken to find nothing: under 1,000 route calls a day while nothing waits (12,960). A job runs at its own period and only where its feature is in use: under 3,000 job runs a day at today's use (24,192). An idle round sends under 20 statements. The run log is a week long. Every job has a gate and a budget. | 0.3, 0.4, 0.5, 2.10, 3.1, 1.4 |
| The database | C | No hot read scans a table that has an index for it. No listed statement fetches whole documents to pick a field. No redundant index, and no dead schema, table or function. Every log has a retention rule that runs. A ratchet holds its growth. | 0.6, 0.7, 0.8, 2.10, 4.1, 1.5 |
| AI calls | C | An AI manager round is under 60,000 characters (about 160,000) and its unchanging part is served from the provider's cache. Small jobs use a quick model. No page, poll or job that calls no model reads the AI connection. A test holds the round's size. | 0.8, 2.9, 1.6 |
| The product's surface | Not graded | A feature a store has not switched on costs that store nothing: no job, no code in its requests, no AI tool, no query. There is one of each engine and one Kaizena Flow site. A new table, job or tool names its gate. | 0.4, 3.1 to 3.5, 1.5 |
| The written rules | C | A session loads under 10 KB of standing rules (44 KB), and a file's rule when it opens the file. One decision costs under 2 KB to look up. Finished history stays out of default searches. A ceiling holds each. | 4.4, 1.6 |
| The page builder's model, styles, interface text, tests with CI and the build, server functions | Being audited | Their grades and bars are set when their reviewers finish (step 4.5). | |

These bars come from the measurements and the steps' own checks. A panel of reviewers is to test each one: is it truly an A, can
the listed steps reach it, and what is missing. Where a bar proves too low or a step falls short, the bar or the plan changes, not
the goal.

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

{{FINDINGS}}
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

{{PLAN}}
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
