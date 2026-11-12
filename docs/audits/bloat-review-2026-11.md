# Bloat review: Kaizena Flow (November 2026)

Written 11 and 12 November 2026, on commit `0bd814c`. The owner asked whether the platform is becoming bloated, and for a plan to
remove all bloat and to make sure the rest is fetched and loaded so that nothing is loaded, used or shown without need. The owner
then set the plan's goal: **grade A in every area**.

**How it was done.** Measured first, then read, then challenged.

1. *Measured.* A production build was made and served with the demo catalogue; 32 real pages were opened in a browser with an empty
   cache and each asked what it transferred and which bytes of its scripts ran; Next's bundle analyzer listed the source modules
   behind 19 routes; production's own statistics were read (Postgres's counters since 25 August, the scheduler's table, the job
   ledger), with no personal data; two scans written for the review looked for unused and copied code.
2. *Read, challenged, planned.* 25 areas of the system each had three reviewers: an auditor who read the code with the numbers in
   hand; a skeptic who re-opened every citation, re-measured every number and tried to refute each finding; and a planner who turned
   what survived into fix steps with a check, and looked for what was missed.
3. *Graded.* For each of 13 areas of the scorecard a steward set the bar for an A in numbers and grouped its findings into work,
   and one weaver merged all areas' work into one plan. **Not finished as this is written:** the plan's reviewer (steps may still be split, joined or moved between phases); a challenger per area (is the bar truly an A; can the plan's steps reach it); the critic who compares grades across areas. Until then the grades and bars below are the stewards' own.

**What came out.** 353 findings stand: 128 confirmed as first written, 174 corrected by the skeptic (real, but
the numbers, the place or the scope were wrong) and 51 added by the planners. 22 claims of the first reading were
refuted and dropped, among them several of the lead's own first figures. A tick (✓) marks a finding that passed its second check;
a planner's addition has none.

**Its limits.** Times and megabytes measured on the review's machine say what is large and what is small; they do not say what
Vercel will show. Real cold starts, function invocations and visitors' speed in production were not measured (the hosting metrics
need a plan the team does not have). The planners' 51 additions were read by one reviewer. Savings marked as estimates are
estimates.

**Read this first: the platform is not open yet (the owner, 11 November).** It opens to real store owners and shoppers soon. The 60
stores and 102 orders in production are the team's own demo, test and template stores. So an unused feature or an empty table is
expected and is not a finding: the first draft of this review read too much into that, and every reviewer since was told so. What
counts is what something costs per request, per cold start, per scheduled run, per AI call, per push or per agent session; what
grows with stores, pages, products, orders and visits once the doors open; and what is truly built twice. Production's counts are
scheduled work, builds, crawlers and the team's own testing, not shoppers. And before opening is the cheapest time for structural
change: there is no real data to move and nobody to disturb.

**What it builds on.** `docs/audits/code-review-2026-11.md` (its steps are named where a finding is already one of them),
`docs/performance.md` (the storefront's bundle rules, D211 and D212), `docs/build-memory.md`, `docs/capacity.md` and
`docs/platform-parity-plan.md`. Nothing here replaces them.

**Where things are.** Beside this file, the folder `bloat-review-2026-11/`: `findings/` has a folder per area and a small file per
finding (where, evidence, cost today, the fix in steps, the tests and rules that hold today's behaviour, done-when, risk);
`grade-a-bars.md` has each area's bar in full; `evidence/` the measurements; `scripts/` what made them. A step of the plan names
the findings it closes: open those files, not the folder.

**Words.** Six kinds of bloat: *dead* (nothing uses it), *duplicate* (built more than once), *eager* (loaded, fetched or run before
it is needed, or for someone who will never need it), *oversize* (bigger than its job), *ahead of use* (paying a running cost before
any use) and *no check* (nothing stops it growing). Priority, from the planners: P0 small and safe, do first; P1 a large saving
with more work or risk; P2 when the area is next touched; P3 true but not worth doing now. Effort: S under a day, M a few days, L a
week or more. Sizes are before compression unless a line says otherwise.

## Progress

This is a working document, kept as `code-review-2026-11.md` is: the table says where each step stands. Keep it true in the same
commit as the fix.

- **The goal is grade A in every area** (the owner, 11 November). The plan is done when every area is an A, not when its steps are
  ticked. Section 1 gives each area's bar; `bloat-review-2026-11/grade-a-bars.md` gives it in full with how each number is measured.
- **Status** is one of: Open, In progress, Done, Dropped (with the reason in Notes).
- When a step is done, set Done with the date and the commit, in a line. Check its "done when" first, with the script, query or
  test it names.
- When verified fixes raise an area's grade, change it in the scorecard with the old grade and the date beside it, and show the
  owner the new table. Raise a grade only for fixes seen working in production, measured as the bar says.
- If a finding proves wrong, say so in Notes and correct it in its area's file; do not delete it.
- Steps marked *owner* wait for the owner's answer to a question in section 6.

**Phase 0: Before the doors open**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 0.1 | Keep the 'before': put the review's scripts in the repo and store a daily reading of production | GAP-code-1, GAP-database-1 | M | Open | |
| 0.2 | Let the deploy job, not a visitor, meet the first cold page | SD-3, GAP-server-2 | S | Open | |
| 0.3 | Cut the two import hubs: the unused schema and the chat module's helpers | DD-1, DP-1, DP-9, SG-6, SF-6, DS-1, TC-5, DP-10, FM-2, FM-14, SG-3, SF-4 | S | Open | |
| 0.4 | Load sharp, the font parser and the AI manager's engine when they are used | AS-1, DP-2, SG-7, SF-9, DP-11, SG-15, SG-10 | S | Open | |
| 0.5 | Cut the import cycle of 229 server files | SG-1, SF-1, TC-2, SG-18, SG-17 | M | Open | |
| 0.6 | Give code outside the admin its own small word modules, so the admin's words leave shoppers' routes | FM-1, SF-5, TX-1 | M | Open | |
| 0.7 | Make a language translated by AI cost what it uses: at start, per document and per minute | SG-5, SF-3, SD-7, TX-3, TX-12, TX-6, SC-13, PL-9, DQ-12, DS-2, CA-12 | M | Open | |
| 0.8 | Take Supabase's client, zod and the builder's English off every signed-in screen | AC-1, BN-1, BN-3, BN-4, DP-4, TX-4 | S | Open | |
| 0.9 | Load an editor, a catalogue or the AI's tool tables only on the screens that draw them | AC-2, BN-14, AC-3, BN-5, DP-5, AC-7, BN-7, AC-8, BN-15, AI-4 | M | Open | |
| 0.10 | Stop prefetching what a press cannot use: other views, links that leave their layout, the admin's rail | PF-2, PL-3, SC-1, PF-11, PL-4, BN-2, CA-4, CS-8, CA-5, PF-5, PF-6, AC-12 | S | Open | |
| 0.11 | End the prefetch loop on /s/ addresses, and write both router settings down | PF-1, SC-9, CA-6, CA-7 | S | Open | |
| 0.12 | Make no server call after load for a visitor with nothing to fetch | SC-10, PL-7, SD-15, SC-12, PL-8, SD-14, PL-14 | S | Open | |
| 0.13 | Send shoppers' first scripts only what the page draws | SC-3, PL-10, BN-10, TX-5, TX-8, SC-11, SC-4, PM-11 | M | Open | |
| 0.14 | Cut what an idle tab, a save and a menu cost in the admin *(owner)* | AD-1, AD-13, AD-9, AC-13, PL-11, AI-12 | S | Open | |
| 0.15 | Read the products, customers and stores lists a page at a time | AD-7, AC-14, AD-10 | M | Open | |
| 0.16 | Stop asking for what does not change: the store's slug, the AI connection, the theme cards, the hosts list | CP-2, SD-10, CA-9, DQ-9, AI-2, DQ-4, GAP-ai-1, SD-16, CA-11, CA-13, SF-12 | M | Open | |
| 0.17 | Work the cart and a shopper's facts out once per request, with no read for a feature that is off | SD-11, FT-15 | S | Open | |
| 0.18 | Filter a store's rows the way its index can serve | DQ-8, DS-7, PM-4, CR-6 | M | Open | |
| 0.19 | Read one page, not all of them | CA-3, SD-4, DQ-2, PM-2 | M | Open | |
| 0.20 | Shed the database's dead weight: the scheduler's log, 13 duplicate indexes and the dead objects *(owner)* | CR-5, DS-8, DS-9, DS-15, DS-14 | M | Open | |
| 0.21 | Make AI upkeep cost one statement when nothing changed: knowledge, pictures, alt texts, product vectors | CR-4, DQ-6, DS-5, PM-3, DQ-3, DS-10, AI-13, AI-5 | M | Open | |
| 0.22 | Stop three jobs re-asking on every run: invoices, the listings' check and the prunes | CR-9, DS-3, CR-15, FT-3 | M | Open | |
| 0.23 | Fix pictures and files before real ones are stored: thumbnails, an 800 px copy, long lifetimes | AS-4, AS-9, AS-12, AS-5, AS-11 | M | Open | |
| 0.24 | Give the admin's colour names a value on public pages | CS-7, CS-9 | S | Open | |
| 0.25 | Delete what nothing uses and what is kept from before | DD-3, DD-8, TX-11, DD-11, CR-12, DP-8 | M | Open | |
| 0.26 | Run each check once, and let a test load only what it uses | TC-1, TC-12, TC-3, TC-13, DD-13, DD-10 | M | Open | |
| 0.27 | Leave a map in CLAUDE.md, wrap the rules' long lines and keep history out of searches *(owner)* | DC-1, DC-4, DC-7, DC-13 | M | Open | |
| 0.28 | Make the rules say what is so, and claim a decision's number on main before citing it *(owner)* | DC-5, DC-8, DC-6, DC-10, DC-12 | M | Open | |

**Phase 1: Budgets, so it stays removed**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 1.1 | Give every budget one home, and hold the written rules first *(owner)* | DC-3, GAP-rules-1 | S | Open | |
| 1.2 | Hold every route's first scripts, and documents, stylesheets and after-load requests on real pages | AC-10, BN-11, SC-6, PL-13, PM-14, CS-3, CS-6, AS-7 | M | Open | |
| 1.3 | Put the admin under the import walk, and hold where the words go | AC-11, TX-9, GAP-text-2 | M | Open | |
| 1.4 | Put the pages real shoppers get into the measured set: a launch-theme store and a paying cart | GAP-shopper-browser-1, GAP-page-model-3, GAP-styles-1, GAP-shopper-browser-2 | L | Open | |
| 1.5 | Hold what a server entry loads and carries | SG-14, SF-7, DP-6, AS-3, SG-16 | M | Open | |
| 1.6 | Count statements and rows: admin screens, the idle tick, the minute routes and the cold frame | DQ-11, AD-12, CR-14, GAP-database-2 | M | Open | |
| 1.7 | Hold the storefront's server side: statements per page, cached reads, render modes, a shop-only journey and a placed order's writes | SD-13, CA-16, GAP-surface-1, GAP-database-3 | M | Open | |
| 1.8 | Hold with production figures what a test cannot: a slow phone, the admin's speed, a cold start | GAP-shopper-browser-3, GAP-owner-browser-3, GAP-server-3 | L | Open | |
| 1.9 | Hold unused code, copies and the admin's repeats with ratchets of exact lists | DD-4, GAP-code-2, CP-14, FM-13, FM-7, FM-8, GAP-code-3 | M | Open | |
| 1.10 | Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows *(owner)* | FT-2, DS-12, GAP-surface-3 | S | Open | |
| 1.11 | Hold every agent's round, show real tokens per call, and let the eval see whether the model finds a tool | AI-10, AI-14, GAP-ai-3 | M | Open | |
| 1.12 | Record every check's seconds and the build's peak memory, with ceilings | TC-8, AS-10, GAP-build-1 | M | Open | |
| 1.13 | Give the production build room, and fail a run before it runs out *(owner)* | GAP-build-2, SG-11, SF-11 | M | Open | |

**Phase 2: Load on demand**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 2.1 | Send the store's layout and its fixed style sheets once | SC-8, PL-2, PM-1, CS-5, SC-7, PF-7, CS-4, PM-7 | M | Open | |
| 2.2 | Serve store pages with nothing per visitor as static files, and let Add to cart answer a number | CA-1, CA-17, CA-15 | M | Open | |
| 2.3 | Route every link through one wrapper with a stated policy, and keep built pages' presses inside the app | PF-3, PF-8, PF-12, PF-10, PF-4 | L | Open | |
| 2.4 | Bound what a real listing fetches ahead, and decide partial prefetching by trial *(owner)* | PF-13, PL-5, PF-9 | M | Open | |
| 2.5 | Let each working route and each recommending grid load its own parts | SC-2, BN-9, BN-16 | M | Open | |
| 2.6 | Give the storefront a stylesheet of its own, and count what is in it *(owner)* | SC-5, CS-1, BN-12, GAP-styles-2, GAP-styles-3 | M | Open | |
| 2.7 | Draw a listing's grid once and read its list once | PL-6, PM-8 | M | Open | |
| 2.8 | Ask the database for stock only on a product view | SD-2 | M | Open | |
| 2.9 | Let cached reads follow their tags, and let a publish make only its own page stale | SD-8, CA-10, PM-15, PM-16, GAP-page-model-2 | L | Open | |
| 2.10 | Read a cold store page, the cart and the checkout in one wave, with nothing that grows with the catalogue | SD-5, SD-9, DQ-7, GAP-server-1 | L | Open | |
| 2.11 | Turn the proxy's and the page's readers into leaf modules | SD-1, SD-6, SG-2, SF-2, SG-8, PM-12 | L | Open | |
| 2.12 | Let nothing ride with a function that cannot use it: Stripe, the page model, the taxonomy | SG-9, DP-12, SF-8, SG-13, AS-2 | M | Open | |
| 2.13 | Load the admin's words by area on admin routes too, and take English defaults out of the code *(owner)* | SG-4, AC-9, BN-8 | L | Open | |
| 2.14 | Hand each admin page only the words its parts read, and do not send them again with a save | AC-4, PL-1, TX-2, AD-5, PM-10, GAP-text-1, GAP-text-3 | L | Open | |
| 2.15 | Let the builder paint first: the rich text editor and a store language load after | AC-5, AC-6, BN-6, TX-7 | M | Open | |
| 2.16 | Load the builder's dialogs and each block's field form when they are opened | GAP-owner-browser-1 | L | Open | |
| 2.17 | Keep the session without the whole Supabase client, and hold what a screen has loaded by idle | GAP-owner-browser-2 | M | Open | |
| 2.18 | Lighten the admin's shell and the store Home | AD-2, AD-4, AD-8, AD-3 | M | Open | |
| 2.19 | Keep a page's facts in columns, so lists, menus and grids open no document | DS-4, PM-6, AD-14, PM-5, GAP-page-model-1 | M | Open | |
| 2.20 | Answer a store's own domain without a deployment *(owner)* | SF-13 | L | Open | |
| 2.21 | Send the AI manager a lean default round *(owner)* | AI-1, AI-9, AI-11, FT-4, AI-6 | M | Open | |
| 2.22 | Slim the tool schemas and send one page group, so no round is over 70,000 characters | AI-8, GAP-ai-2 | M | Open | |
| 2.23 | Pay less per token: count and use cached input, and give small jobs a quick model | AI-3, AI-7 | M | Open | |
| 2.24 | Keep one file per decision, with a generated index | DC-2, AS-8 | M | Open | |
| 2.25 | Bring the always-loaded core under 10.5 KB, make every living doc searchable, and measure what a session loads *(owner)* | GAP-rules-2, GAP-rules-3 | M | Open | |
| 2.26 | Shorten the gate: a type check without tests, a related test run, and a fresh worker only where a trial needs it *(owner)* | TC-4, TC-9, TC-6, GAP-build-3 | M | Open | |

**Phase 3: One of each**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 3.1 | Run one tick a minute, and call a route only when work waits or is due | CR-1, CR-7, DQ-1, DP-7, SF-10, CR-3, GAP-scheduled-1 | L | Open | |
| 3.2 | Run the dispatcher from a registry: a cadence and a time budget per job, four at a time | CR-2, CR-8, DQ-5, GAP-scheduled-3 | L | Open | |
| 3.3 | Give every scheduled function a ledger row and a watcher from outside, and every growing table a delete rule *(owner)* | CR-17, GAP-scheduled-2, DS-13, CR-10 | M | Open | |
| 3.4 | Let per-store jobs find due work by a mark, and call the PDF route when a document waits *(owner)* | DQ-15, CR-16, CR-11, DD-12 | M | Open | |
| 3.5 | Keep one kaizenaflow.com *(owner)* | FM-3, FT-5, DS-6 | L | Open | |
| 3.6 | Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope *(owner)* | CP-4, FM-4, FM-5 | M | Open | |
| 3.7 | Keep one engine for one job: order rules fold into Workflows, and an own look is saved in the theme library *(owner)* | FT-8, FT-12, GAP-surface-2 | M | Open | |
| 3.8 | Give each family one core: the five file imports, Work's two sets of screens, the Domains move page | CP-1, FM-6, CP-5, FM-10 | L | Open | |
| 3.9 | Keep one of each small thing: helpers, SQL fragments, order totals, English word lists | CP-8, CP-16, FM-12, CP-9, CP-12, DD-7, CP-13 | M | Open | |
| 3.10 | Keep one stored page shape | PM-9, DD-9 | M | Open | |
| 3.11 | Build twice per push, and deploy only what changes the app *(owner)* | TC-7, TC-14, CA-2 | M | Open | |

**Phase 4: Tidy**

| Step | What | Closes | Effort | Status | Notes |
|---|---|---|---|---|---|
| 4.1 | Build the admin kit and move action files onto the shared wrapper, area by area | CP-3, CP-7 | L | Open | |
| 4.2 | Fold the remaining twins as each is opened | CP-6, FM-9, CP-11, FM-11 | M | Open | |
| 4.3 | Tidy the tests' side: exports only a test keeps alive, shared mocks and one tree walker | DD-2, CP-15, TC-11, TC-10 | M | Open | |
| 4.4 | Make the last reads fetch what they show | AD-6, AD-11, AD-15, DQ-10, DQ-14, DQ-16, DS-11 | M | Open | |

Change log:

- 11 Nov 2026: first draft, on unverified findings from 14 of 25 areas. Nothing started.
- 12 Nov 2026: rewritten on the verified findings of all 25 areas, with the plan woven and each area's bar for an A set by the
  panel. Nothing started.

## 1. The headline

**The platform is carefully built, and it is not open yet. Its waste is in how it loads, asks and checks, not in what it is; almost
all of it is cheap to remove before the doors open.** The usual suspects came back clean: 0.35% of the code is dead, 1% is an exact
copy, every package is used, the tests do not repeat each other, the page model stores 340 bytes a block, and a feature a store
does not use costs it close to nothing. What the reviewers found instead comes down to five causes.

1. **One import cycle ties the server together.** 229 server modules import each other in one cycle, so 559 of 562 pages, 181 of
   268 route handlers and the proxy each load the same 10 to 11 MB of server code whatever their job. On the review's machine such
   an entry takes 0.84 to 1.09 s and 71 to 83 MB to start cold, against 0.16 s and 14 MB for a route outside the cycle, and every
   instance first spends 0.33 s in a start hook. It grows with stores and traffic, because quiet stores meet cold instances. A few
   dozen small import changes cure it and remove no feature: on the build's own module graph the visit beacon falls from 10.4 to
   1.9 MB with one import path, a storefront page from 11.3 to about 3.5 MB, the proxy from 9.2 to 2.4 MB.
2. **Pages are drawn and sent more often than anyone needs.** Every store page view runs a function whose only job, on home, built
   and blog pages, is two cart badges and a country hint (98 of the demo home's 138 KB). The store's layout is rendered and sent
   twice in every page for a 404 nobody sees. A visitor who does nothing causes 11 to 50 prefetches and one or two server calls
   that answer "nothing". One Add to cart redraws the whole page and fetches 15 links again (193 KB).
3. **Every admin screen loads about twice the script it needs.** The median of the 432 signed-in routes is 1.16 MB; seven small
   import changes take it to about 0.6 MB in a simulation on the built chunks. Three stray imports put Supabase's client, zod and
   the page builder's English on every screen; 13 preview screens load the whole builder to draw a page; and Kaizena Flow's public
   front page fetches 437 KB of admin scripts it cannot use.
4. **Work is found by asking, and data is fetched whole.** The scheduler calls the app 13,250 times a day and those calls send about
   170,000 statements, nearly all finding nothing; its own log, never pruned, is 564 MB of the 731 MB database. Finding one page
   reads every published page of the store with its whole content. 122 store filters are written so the store's index cannot serve
   them. The same store slug was looked up 560,090 times with no shoppers. A product view asks the database 18 times where one
   answer changes; the admin's store Home runs 29 to 46 statements before its first content.
5. **Nothing holds the numbers.** 43 of the 353 findings are the same finding: no check, budget or test would notice
   this growing. The storefront's first scripts have a budget and the storefront is the leanest part; even there the budgets watch
   2 of 56 routes. One push type-checks the same commit five times and builds it four, yet none of it checks weight.

Nothing is slow or broken today: the database is idle and pages answer quickly. What is paid now is cold starts, function time,
tokens, pushes and the build. What is at stake at opening is that causes 1, 2 and 4 grow with every store, page, product, order and
visit.

One thing the reviewers met that is not bloat but matters before opening: every store's own domain is compiled into each
deployment as 4 to 8 routing rules, against the host's limit of 2,048 a deployment. That is a wall near 270 stores with a domain
(SF-13, and a question for the owner in section 6).

### The goal: grade A in every area

The grades mean the same in every area:

- **A:** nothing in the area is loaded, fetched, run or shown without need, beyond a small tolerance stated in numbers, and a test
  or a production figure holds each measure so it cannot slip back unseen. An A is what a strict senior engineer who knows this
  stack would call excellent, not merely "the findings are closed".
- **B:** the large causes are gone and budgets exist; small findings remain.
- **C:** a sound base with real waste; some of it is held, most is not.
- **D:** every page, function or run carries far more than its job needs, and nothing holds it.
- **E:** waste that hurts people or costs money today. No area is an E.

No area is an A today, the tidy ones included, because an A needs each number held by a check and almost none is. For several
areas closing every finding reached only a B: their stewards named what an A still needs (a launch-theme store measured and held, a
checkout with a payment form, a speed figure with an alarm, production's statistics kept daily), and those are steps of the plan.

| Area | Today | Why | Grade A when | Steps that get it there |
|---|---|---|---|---|
| What a shopper's browser gets | C | The base is sound: a default store's first load has no zod, no third-party script and no font file, the extras are lazy and gated on the server, and two script budgets exist. But every page sends the store's layout twice, makes one or two server calls that answer nothing and 11 to 47 router requests for pages nobody asked for; eleven working routes share one bundle 98 KB larger than a built page's, and a press on a built page's product tile reloads the whole document. | First scripts and stylesheet of a first visit, by route: Built page at most 615,000 bytes raw (own share 168 KB, about 55 KB gzip). Listing and…. The store document: its size and what is in it twice: Nothing twice: under 2,000 bytes of duplicate rows and one html element in the payload.…. Requests the router makes unasked, for a phone visitor who…: At most 6 on the home, a product page, a content page and the cart, at the top and read…. Server calls a view makes for nothing: 0 fetches of the page's own after load on all 12 measured pages for such a visitor. The…. What a press costs: Tile press: 0 documents and at most 8 requests. Cart press on a wide screen: 1 document,… | 0.7, 0.10, 0.11, 0.12, 0.13, 0.14, 0.23, 1.2, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.14, 1.4, 1.8, 2.2 |
| What an owner's browser gets | D | D, on the build's own figures, recomputed here from route-bundle-stats.json. Every signed-in screen loads about twice the script it needs (median 1,152,953 bytes where about 650,000 will do; 481 KB of it is three stray imports), 27 screens load an editor or a catalogue they never draw (up to 4.27 MB), a product editor's document is two thirds words that no part reads, and each screen makes 23 to 46 background requests. | First scripts of a plain signed-in screen: Median at or under 650,000 bytes raw. The store home, orders, products, settings and the…. Script a plain screen has loaded by the time it is idle: At or under 800,000 bytes raw five seconds after load, with Supabase's realtime, storage…. The page builder's first scripts, and the ceiling for every…: The builder at or under 1,800,000 bytes raw (about 555 KB gzip), with the rich text…. Code a screen downloads for something it does not draw: Supabase on 0 routes. The rich text editor on 0. A whole storefront language on 0. Any…. Words in a document that no part of the page reads: Unread words at or under 10% of the words handed, on each budgeted screen. Documents:… | 0.8, 0.9, 0.10, 0.13, 0.14, 0.15, 1.2, 1.3, 2.5, 2.14, 2.15, 1.8, 2.6, 2.13, 2.16, 2.17 |
| What the server loads and asks | D | 559 of 562 pages, 181 of 268 route handlers and the proxy each load the same 10 to 12 MB of server code whatever their job: 0.84 to 1.3 s and 71 to 97 MB to start cold on the review machine, against 0.16 to 0.24 s and 14 to 26 MB for the health check. A product view asks the database about 18 times where one answer changes per view, every store page load makes one or two more function calls for nothing, and each admin shell render spends 125 ms building its menu. | Server code a cold function loads, by kind of entry: A beacon (the four /api/visit routes, /api/recommendations/events): 1.0 MB and 500…. What every instance pays before its first request: Start hook: 60 source files or fewer by static imports and under 0.7 MB of chunks, with…. Database statements per storefront view, warm: Product page: 3 or fewer beyond the proxy's, all on the inventory tables (4 for a store…. Function runs a store page view causes beyond its document: For a visitor with no cart, wishlist or account, on a store with tile stock off: 0…. Statements before an admin screen shows its first content: Store Home: first content after 14 statements or fewer in at most 2 waves. Shell: 2 for… | 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.10, 0.11, 0.12, 0.14, 0.15, 0.16, 0.17, 0.19, 1.5, 1.6, 1.7, 2.2, 2.8, 2.9, 2.10, 2.11, 2.13, 2.14, 2.18, 2.19, 1.8, 1.13, 2.12, 2.20, 3.1, 3.11, 4.4 |
| Scheduled work | D | D, at the top of the band. Nearly all of the scheduler's 13,250 function calls a day find nothing, all 83 dispatcher jobs share one five-minute cadence with 78 started at once on five connections, at least 13 jobs and 3 minute routes do work per store on every run, and the scheduler's own log is 564 MB, 77% of the database. | Function calls a day by the scheduler when nothing waits: At most 1,200 on a quiet day: 288 dispatcher runs, 2 daily runs and a 15-minute safety…. Statements a day sent by scheduled work that finds nothing: Under 40,000 a day. An ordinary idle dispatcher run, with no hourly or daily job due,…. Jobs whose idle run does work per store, site or product: 0. An idle run sends the same number of statements with 1 store and with 20. A job that…. Jobs that run more often than their work changes: 0. Every job names its cadence (300, 3,600 or 86,400 s) and a one-line reason in one…. pg_cron's own run log: The oldest row is at most 8 days old and the cron schema is under 60 MB. About 1,750 new… | 0.1, 0.18, 0.20, 0.21, 0.22, 0.25, 1.6, 3.1, 3.2, 3.3, 3.4 |
| The database | C | The base is sound: one small pool, statement and lock limits, queues claimed with skip locked, triggers gated by column, retention for nearly every log, and the app's listed statements cost about 30 s of database time a day. The waste is real and measured all the same: pg_cron's run log is 564 MB of the 731 MB database, 162,622 of 216,877 transactions changed nothing, three whole-page reads are 41% of the app's listed statement time, and 122 store filters are written so the store index cannot serve them. | Rows read by scan where an index exists: No commerce table with more than 1,000 rows is read whole more than 10 times a day in…. Whole documents fetched where a field would do: Among production's 40 costliest and 40 most-called statements, none that selects a…. What scheduled work asks per added store: The idle tick's statements and rows read are the same for 1 and for 20 seeded stores. At…. Statements that can change or learn nothing: Under 100 empty transactions a day. Among the 25 most-called statements none fetches a…. Round trips before a cold page's own content: At most 5 statements for a store's cold frame (siteCookies at most 4), none waiting on… | 0.1, 0.3, 0.7, 0.16, 0.18, 0.19, 0.20, 0.21, 0.22, 1.6, 1.10, 1.7, 2.10, 2.19, 3.1, 3.2, 3.3, 3.4, 3.5, 4.4 |
| The page builder's model and a built page | C | The stored model and a block's markup are lean and partly held: a stored page is 340 bytes a block, blocks and rows are capped, interactive parts load where drawn, and first scripts have a budget. But every storefront document carries the layout twice, one publish makes all 261 built pages of a store stale, finding one page reads every page, the owner filter cannot use its index, and no budget sees any of this. | 1. Copies of the store's layout in one storefront document: 1 html tree. 0 bytes reachable only through a not-found copy. The om-oss document at most…. 2. Whole page documents read for something other than…: A cold render reads only the documents it draws: 3 on a store's home, built page and…. 3. Built pages one publish makes stale: A publish that changes only a page's body makes that page's own entries stale: 3 of 261…. 4. Rows read to find one owner's pages: Every read of an owner's pages touches only that owner's rows: an index scan, 27 of 27.…. 5. Parts of a built page sent twice, on a realistic page: Each grid item once in the markup and once in the payload. Each stylesheet text once per… | 0.13, 0.18, 0.19, 0.21, 1.2, 2.1, 2.7, 2.9, 2.14, 2.19, 1.4, 2.11, 2.16, 3.10 |
| Styles | C | The base is sound: hand-written CSS has almost no dead weight, a built page carries under 5 KB of inline style, fonts and style generation are cached, and the admin's own CSS is already a file apart. But the one render-blocking sheet every shopper loads is 28% the admin's (183 KB raw / 25.8 KB Brotli, against 130 KB / 19.8 KB when compiled without it), fixed sheets are copied once per row and a third time per document, and no test or number holds the sheet's size, its sources or the style text. | The stylesheet every store, site and docs page loads before…: At most 135,000 bytes raw and 20,600 Brotli, with no class that only admin, test,…. Files that can rename the shoppers' stylesheet though no…: 0. The site's entry reads the site's code (2,451 files) and the admin parts a public page…. Copies of one style sheet in a store document: Each sheet 2 times, whatever the number of rows: once in the HTML and once in the payload…. Classes on public pages that read a colour with no value…: 0. Every colour name a public page can meet has a value in light and in dark, and shop…. Admin styles and answers a visitor of kaizenaflow.com…: 0 requests and 0 bytes. | 0.10, 0.24, 1.2, 2.1, 2.6, 1.4 |
| Interface text | C | The words themselves are in excellent order: every language is complete and held by the compiler, 34 of 31,359 keys are dead, and a shopper's document carries 7 to 32 texts. How they are loaded is not: 802 of 830 server entries and the proxy evaluate every admin area in both languages at each cold start, admin documents hand two to three times the words their parts read, and 423 of 449 admin routes and 97 of 111 visitor routes carry text for someone else in their first scripts. | Admin words that code outside the admin loads: No value import of src/lib/admin-text.ts outside src/app/admin and src/components/admin…. Admin words an admin function loads: An admin entry reaches only the areas its code names: a median of at most 15 areas and…. Words handed to the browser against words read, admin…: On every signed-in screen the words handed are at most 1.25 times the words its parts…. Routes whose first scripts carry text the page cannot show: 0 routes for each of the five texts, and 0 client import sites of an area's catalogue…. What a language translated by AI costs: per document, per…: A document carries exactly the browser's keys (114 today) in under 9,000 bytes. An… | 0.6, 0.7, 0.8, 0.9, 0.13, 0.25, 1.3, 2.15, 2.13, 2.14 |
| AI calls | C | C, in its lower half. The base is sound: the shopper chat sends about 5,100 characters a call, the writers and the docs guide are small, search answers are kept, a turn has a ceiling of time and tokens, and tools of switched-off features are dropped. | What a default AI manager round sends: prompt and tool…: At most 50,000 characters with no page open and at most 70,000 on any admin page, for a…. Real input tokens per AI manager call and per turn, and…: Median call at most 15,000 input tokens, 90th percentile at most 25,000, median turn at…. Share of AI manager input served from the provider's cache: At least 50% of the input tokens of feature ai_manager over a week, and at least 80% on…. Small jobs on a quick model: All 8 named small jobs run on the quick model: memory pass, tone, support summary,…. Reads of the AI connection per recorded AI call: At most 2 reads per recorded AI call over a week, and under 300 reads on a day with no AI… | 0.9, 0.14, 0.16, 0.21, 1.11, 2.21, 2.22, 2.23 |
| The product's surface | C | The base is sound and part of it is held: one switch registry kept in step with the navigation, the admin map and the AI tools by tests; a new store starts with the shop alone, 29 Basic links and 8 rows of its own; almost every scheduled job is one statement for the whole platform. But 'an unused feature costs close to nothing' fails in five named places per view (the cart, which also works the basket out twice; product tiles; the product page; the page frame; the owner's Home) and in the AI manager's round; three jobs have two engines (4,150 to 6,450 lines); and 1 of 14 surface counts has a budget. | Summaries per cart view, and statements a cart or checkout…: 1 summary per render. 0 statements for a feature that is switched off. A guest's cart in…. Places where a shop-only store pays per view for features…: 0. On the journey home, listing, product, cart, checkout of a store with features…. Scheduled work that does not follow use: No job whose work can wait an hour or a day runs every five minutes: runJobs() has 69…. Surface counts held by a budget: 14 of 14. Each count has a baseline. A test fails when a count rises without a decision…. Jobs that have two engines: 0. find src -iname '*order-rule*' \| wc -l prints 0. rg -l platform_theme_installs src… | 0.12, 0.17, 0.22, 1.10, 1.7, 2.8, 2.10, 2.18, 2.21, 3.2, 3.5, 3.6, 3.7 |
| The code itself | C | The base is the tidiest in the review: about 2,700 of 772,000 lines are dead (0.35%), 0.87% are exact copies across files, no package is unused and all 150 public files are referenced. But not one of those numbers is held by a test (lint sees unused locals only), so by the scale it cannot be an A, and without budgets it is not a B either: the draft's A rested on the counts alone. | Dead code: exports nothing uses, and production code only a…: 0 exports used by nothing. 0 files only tests reach outside named test support and a list…. Copied lines: Exact copies across files at most 0.6% (2,850 lines), failing the test above that.…. Things built twice: twin file pairs: At most 8 pairs, none over 50 shared lines, each with its reason in the baseline. One…. Hand-made repeats too small for a copy detector: helpers…: Each helper declared once (isUuid and isUniqueViolation 2 declarations in all; the day…. Packages: 0 packages without an importer, held by a test. No package over 5 MB installed for under… | 0.1, 0.3, 0.4, 0.6, 0.8, 0.9, 0.16, 0.23, 0.25, 0.26, 1.5, 1.9, 1.12, 1.2, 2.12, 2.24, 3.1, 3.4, 3.5, 3.6, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3 |
| Tests, CI and the build | C | The base is sound: 325,579 lines of tests with no snapshots, a browser suite that does not repeat the unit tests, a test database built once, a docs-only push that runs nothing, and a gate before each deploy. The waste is in how the checks run: one push type-checks the same commit five times (about 9 runner-minutes of repeats) and builds it three times, a plain unit test file spends 0.34 of its 0.48 s on the admin's English and a fresh worker it cannot use, and lint re-reads 6,213 files for an answer a cache gives in a second. | How often one commit is checked and built on a push: 1 lint, 1 schema check and 1 full type check per push; at most 2 builds in CI; no deploy…. The deploy gate: lint, type check and tests before a deploy…: 120 s or less: lint 15 s with its cache restored, type check 60 s, the six money test…. The unit run (pnpm test): 3 min 30 s or less on the machine where it took 5 min 34 s. Setup under 10% of Vitest's…. The integration and browser jobs a migration release waits…: Every required job's seconds recorded on every run and held by a ceiling. The slowest at…. The production build: peak memory against its machine: 75% of the build machine's memory or less on every production build (6.0 GB of 8, or 12… | 0.3, 0.5, 0.11, 0.26, 1.12, 1.13, 2.26, 3.11, 4.3 |
| The written rules | C | The base is sound: the rules in full already sit in files read on demand and a test keeps them out of the always-loaded file, 99.84% of the 3,145 code names they cite exist, and no doc reaches a deployment or a CI run. The waste is real: every session and subagent loads 44 KB where about 10 KB is needed (71% is an index of which a change needs 2 to 4 lines), the search tool cannot show 52% of the rules or 98% of the decisions, and 5 of 24 merges in 35 hours renumbered a decision. | Loaded into every session and every subagent: CLAUDE.md at most 10,500 bytes and 160 lines (about 2,600 tokens). AGENTS.md as Next.js…. Text a search cannot show (lines over 500 characters): 0 in CLAUDE.md, docs/rules and docs/decisions. 0 prose lines in every other living doc.…. Growth, and what checks it: Every number on this card is in one baseline file and checked on every push, docs-only…. History and generated files in a default search: rg --files supabase lists 5 files. A default search of docs skips the 22 files. A…. Rules that are no longer true: 0 cited names missing, held by a scan test over every backticked name followed by a… | 0.27, 0.28, 1.1, 2.24, 2.25 |

How each area climbs, by the phases of the plan. An area cannot be an A before the step that holds its numbers:

| Area | Today | After phase 0 | After phase 1 | After phase 2 | After all |
|---|---|---|---|---|---|
| What a shopper's browser gets | C | C | | B | B |
| What an owner's browser gets | D | C | | B | B |
| What the server loads and asks | D | C | | B | B |
| Scheduled work | D | C | | B | B |
| The database | C | B | | B | B |
| The page builder's model and a built page | C | C | | B | B |
| Styles | C | C | | B | B |
| Interface text | C | C | | B | B |
| AI calls | C | C | | B | B |
| The product's surface | C | B | | A | A |
| The code itself | C | B | | B | A |
| Tests, CI and the build | C | B | | A | A |
| The written rules | C | B | | A | A |

Each area's measures, today's values, the targets and how each is measured are in `bloat-review-2026-11/grade-a-bars.md`.

## 2. What is good and should stay

- **There is almost no dead or copied code.** About 2,700 of 772,000 source lines have no caller (0.35%); 1.0% of code is an exact
  copy and 4.75% a near-copy with every name normalised; carriers, payment providers, emails, CSV, PDF and the AI tools each have
  one core.
- **The dependency list is lean.** 51 runtime packages, none without an importer; every heavy browser library (the 3D viewer, the
  video and AVIF encoders, the code editor, Stripe's elements) loads on the press that needs it.
- **The storefront's bundle discipline works.** A cold home page sends 680 KB of scripts of which 447 KB is React and Next; no zod,
  no whole language, no third-party script, no font file on a default store. It is the one place with a budget and the leanest
  place in the product: the argument for phase 1.
- **A warm storefront page asks the database nothing of its own**, and the caching code is sound: 82 of 85 cached reads are tagged
  per store, and Kaizena Flow's own site and docs are truly static.
- **The surface is built with care.** One switch registry held by tests; a new shop's Basic view has 29 links; none of the 288
  fixed-address admin screens is orphaned; a feature a store does not use costs it close to nothing in navigation, an AI round or
  scheduled work.
- **The database is careful table by table.** Dead objects are rare (one table, five columns, a leftover schema), triggers fire
  only when their columns change, and nearly every log has a retention rule.
- **The page model is lean** (340 bytes a block; a two-block page's own markup is 1.6 KB), **the words are complete** (2,003
  storefront keys in four languages and 29,040 admin texts in two, none missing, 34 unread) and **styles are among the leaner
  areas**.
- **The tests are not bloat.** 325,579 lines of tests against 768,202 of source, no snapshots, and the browser suite does not
  repeat the unit tests.
- **The shopper chat is a model of a small AI call:** about 5,100 characters of prompt and tools.
- **The house knows how to hold a number.** `ratchet.scan.test.ts`, the scan tests and the byte budgets are the tools phase 1 needs.

## 3. Measured

Verified figures; each area's file has the rest, with how each was measured.

| Measure | Figure | Findings |
|---|---|---|
| Size | 768,202 lines of source and 325,579 of tests in `src`; 560 pages, 268 route handlers, 481 tables, 83 five-minute jobs, 254 store AI tools | |
| Production today | not open: 60 demo, test and template stores of the team's own; 102 test orders | |
| Server code per route | one cycle of 229 modules; 559 of 562 pages, 181 of 268 handlers and the proxy load 10 to 11 MB; cold start 0.84 to 1.09 s and 71 to 83 MB against 0.16 s and 14 MB outside the cycle; a start hook of 0.33 s | SG-1, SG-3, SG-5 |
| The proxy | runs before every page; 1,311 modules, 0.8 to 0.95 s and 168 MB to load cold here | SD-1, SG-2 |
| A storefront page | 680 KB of first scripts (213 KB gzip), 447 KB of it the framework; document 104 to 166 KB, about 70% the page again as data; the layout twice (25 to 30 KB) | SC-8, PL-2, PM-1 |
| A store page view | one function run for two cart badges and a country hint (98 of 138 KB on the demo home); 11 to 50 prefetches; one or two empty server calls | CA-1, PF-2, SC-10, SC-12 |
| An admin screen | median 1,155,530 bytes of first scripts over 432 signed-in routes; 481 KB from three imports; previews 3.2 MB; one Work screen 4.27 MB; the builder 3.3 MB | BN-1, BN-3, BN-4, BN-7, BN-14 |
| An admin document | the product editor hands 238.5 KB of words to the browser and reads 78.9 KB; the builder 311.6 KB against 195.4 KB | PL-1 |
| The admin's server side | menu rebuilt with 220 permission lookups, 125 ms of CPU per shell render (0.1 ms kept in a map); store Home 29 to 46 statements before first content; 39 saves draw the whole route twice | AD-1, AD-2, AD-13 |
| A product view | 18 statements for an anonymous view of a prerendered product; stock is the one answer that changes | SD-2 |
| Scheduled work | 13,250 calls a day sending about 170,000 statements, nearly all finding nothing; 83 jobs on one five-minute cadence (a whole round takes about 1.3 s); the scheduler's log 564 MB of the 731 MB database | CR-1, CR-2, CR-5 |
| How data is asked for | every published page read whole to find one: 79,778 calls, 781 s; 122 store filters no index can serve; one slug lookup 560,090 times; 91,200 of 216,877 transactions changed nothing | DQ-2, DQ-8, DQ-9, DQ-6 |
| A publish | one cache tag covers a store's pages: publishing one page makes all 261 of the demo store's built entries stale | PM-15 |
| An AI manager round | 161,661 characters (124 tool definitions) where a lean round is about 48,600; up to 11 rounds a turn; 237,563 reads of the AI connection for 19,104 AI calls | AI-1, AI-2 |
| Styles | one stylesheet of 183 KB (25.8 KB Brotli) for stores, site and admin; split, shoppers get 130 KB | CS-1 |
| Interface text | 802 of 830 server entries load every admin area in both languages at each cold start (80 to 105 ms, 13 MB) | TX-1, FM-1 |
| A push | the same commit type-checked five times (183 s each here) and built four times; lint re-reads about 6,200 files (about 3 minutes; 1 s with a cache); the production build runs at 90% of its 8 GB machine | TC-1, TC-3, TC-5 |
| The standing rules | 44 KB in every session and subagent (about 11,000 tokens), 71% a 295-line index of which a change needs 2 to 4 lines; the search tool shows nothing of a line over 500 characters: 98% of the decisions, 52% of the rules | DC-1, DC-2 |
| The code | about 2,700 dead lines of 772,000; 1.0% exact copies; 51 runtime packages, all used | |
| A prefetch loop | local builds and CI only: 624 router requests in 4 s on the search page, 55 with route guessing off | PF-1 |
| Store domains | 4 to 8 routing rules per store in each deployment, against a limit of 2,048 | SF-13 |

## 4. Findings

353 findings in 25 areas: 163 eager, 66 oversize, 63 duplicate, 43 no check, 0 ahead
of use, 18 dead. By priority: 103 P0, 119 P1, 97 P2, 34 P3. By effort: 227 small, 116 medium, 10
large. They are not listed here: `bloat-review-2026-11/findings/README.md` lists every one by area with the step that closes it,
and each has a small file of its own (`findings/<area>/<ID>.md`) with the evidence, the fix in steps, the tests and rules that
change with it and its check. Open the files of the step you are doing, not the folder.

| Area | Findings | P0 | P1 | P2 | P3 | Refuted | In full |
|---|---|---|---|---|---|---|---|
| What a shopper's browser loads | 13 | 6 | 4 | 3 | 0 | 0 | `findings/storefront-browser/` |
| The built client bundles, by page | 16 | 8 | 5 | 2 | 1 | 0 | `findings/client-bundles/` |
| What a page sends: document, payload and requests | 14 | 7 | 5 | 1 | 1 | 0 | `findings/page-payload/` |
| Prefetching: what the router asks for unasked | 13 | 3 | 5 | 5 | 0 | 0 | `findings/prefetching/` |
| Styles | 9 | 4 | 2 | 1 | 2 | 3 | `findings/styles/` |
| What an owner's browser loads in the admin | 14 | 6 | 6 | 2 | 0 | 0 | `findings/admin-browser/` |
| What the server does for a storefront request | 16 | 5 | 4 | 5 | 2 | 0 | `findings/storefront-server/` |
| What the server does for an admin navigation | 15 | 5 | 6 | 4 | 0 | 0 | `findings/admin-server/` |
| The server code every route loads | 18 | 6 | 5 | 4 | 3 | 0 | `findings/server-module-graph/` |
| Server functions: size, cold start, per-request overhead | 13 | 6 | 4 | 1 | 2 | 0 | `findings/server-functions/` |
| Caching and rendering | 16 | 5 | 5 | 4 | 2 | 1 | `findings/caching/` |
| The page builder's model and a built page's render | 16 | 5 | 6 | 3 | 2 | 0 | `findings/page-builder-model/` |
| Scheduled and background work | 17 | 2 | 7 | 7 | 1 | 6 | `findings/scheduled-work/` |
| How data is asked for | 16 | 6 | 5 | 5 | 0 | 0 | `findings/queries/` |
| The database's shape | 15 | 3 | 9 | 2 | 1 | 5 | `findings/database-shape/` |
| What every AI call carries | 14 | 1 | 8 | 5 | 0 | 0 | `findings/ai-calls/` |
| Interface text | 12 | 2 | 6 | 2 | 2 | 4 | `findings/interface-text/` |
| The product's surface | 12 | 1 | 4 | 3 | 4 | 3 | `findings/features/` |
| Families and twins | 14 | 4 | 2 | 6 | 2 | 0 | `findings/families/` |
| Dependencies | 12 | 4 | 3 | 4 | 1 | 0 | `findings/dependencies/` |
| Files that ship or are stored | 12 | 4 | 2 | 3 | 3 | 0 | `findings/files/` |
| Code nothing uses | 13 | 1 | 3 | 7 | 2 | 0 | `findings/unused-code/` |
| Copied code | 16 | 2 | 5 | 8 | 1 | 0 | `findings/copied-code/` |
| Tests, CI and the build | 14 | 4 | 5 | 5 | 0 | 0 | `findings/tests-ci-build/` |
| The written rules and the agents' context | 13 | 3 | 3 | 5 | 2 | 0 | `findings/written-rules/` |

### What an A lives with

15 findings are true and not worth fixing. This is the tolerance the bars allow, stated:

- **CP-10.** Eleven hand-written claim-with-a-lease statements, about 130 lines in all. Each has another table, join and retry column: an idiom, not a copy. Tolerance: the 11 are held as a count by the copy baseline of step 1.9 and may not rise.
- **DP-3.** The Stripe and Supabase SDKs load with 97% of routes: 18 to 28 ms and about 1 MB of heap on a lean route, nothing a person sees. Step 2.12 takes Stripe off the read of a store, the graph test of step 1.5 shows the edges that are left, and they are cut when stores.ts or stripe.ts is next changed.
- **AS-6.** All of react-dom (8.1 MB) rides in four PDF traces of 107 to 140 MB: 5 to 7% of them and nothing a person feels, and a wrong glob would break invoices. The trace report of step 1.5 shows the number; act only if a function nears Vercel's size limit.
- **PL-12.** The default icon is 26 KB raw, about 9 KB on the wire, fetched at low priority after load, once per site, and only by a store with no icon of its own. It delays nothing a shopper sees, and it gets a day's cache lifetime with the public files in step 0.23.
- **BN-13.** 40% of the built client files are second copies of modules, but a browser meets about 14% of that while moving around the admin, and it is the chunker working as designed. The only lever is an experimental flag on a build with no memory to spare. The plan's other steps remove about 1.5 MB of the 6.89 MB of copies. Measure again after them, and adopt the flag only if a 59-screen tour falls by 10% or more with no budget raised.
- **SD-12.** Every one of these reads is cached and tagged, and together they cost about 1.5 s of database time a day. The uncached part, the AI provider row, is closed by step 0.16, and the modal scan by steps 2.9 and 2.19. Tolerance: a cached, tagged read may fetch a row wider than it shows while the row is under about 10 KB.
- **SG-12.** About 290 KB and 10 ms per cold instance, and the only cut in the set that could show a shopper the wrong language. Tolerance: all four hand-written storefront languages load with a page, 0.4 MB of its 4 MB budget. Look again when a fifth hand-written language is added.
- **CA-8.** A crawler asks for each store's robots.txt, sitemap, llms.txt and feed about once a day, so a one-hour CDN window would save almost nothing. What a cold sitemap costs is what it reads, and step 0.19 removes most of that. Add the header when the handlers are next opened.
- **CR-13.** Raw status checks kept for 91 days are bounded: about 131,000 rows and 20 MB at steady state, in the platform's own table, pruned, and not growing with stores. Its one-line fix (bound the newest-check read to one day) is made when status.ts is opened for step 3.3.
- **DQ-13.** It names a pattern, not a cost of its own: 341 loops hold a database call. All but the per-site job loops run over a parent's few rows, and their cost follows use. The per-site loops are closed by steps 0.21, 3.2 and 3.4, and the budget of step 1.6 holds the tolerance as a number: at most 2 more statements a tick for each added store with chat and pictures on.
- **FT-1.** 53 of 110 store links and 133 of 254 AI tools stand behind no switch. That is fine: a switch changes what an owner sees, not what a store costs. Links hide in Basic, a round is capped whatever is switched, and jobs are set-based. Where a feature does cost an idle store the fix is at the read (step 0.17), and the surface budget of step 1.10 asks each new feature for its idle cost. No second tier of switches.
- **FT-9.** Campaigns (7 kinds) and discount codes (3 kinds) are two mechanisms with a shared edge, not one job built twice: about 100 to 200 lines of parallel helpers, in code that decides money. Fold the helpers into one small module when pricing code is next opened. The one Discounts page is already code review step 2.4.
- **DC-9.** The parity-wave workflow has not run since feature waves were paused on 29 October, so no session pays for it. Its fix is three edits (cap the spec at 30,000 characters, tell agents to read sections 1 to 5 and their own part, drop the draft of a CLAUDE.md bullet), to make on the day a wave is next run.
- **CS-2.** motion.css stays in the sheet: 18.7 KB raw, 3.8 KB Brotli on a first visit, also for a store with no builder motion. Taking it out needs a build step and a second render-blocking request on every page that does use motion, and nobody can know the share before opening. The stylesheet budget holds it. Look again when the reading of step 2.6 shows under half of published pages need it.
- **TX-10.** A deliberate, written design (D312 A6 and A8): the server answers in English because the AI manager and the tests read it, and about 300 refusals are matched back to their Norwegian. It costs 16.7 KB of source kept twice and no measurable time. The one real mismatch, the product.media pair, is settled in step 0.25. Add the coverage test when a validator is next changed.

## 5. The plan

82 steps in 5 phases, in the order to do them. The Progress table at the top lists every step; each phase has a file
with its steps in full (`bloat-review-2026-11/plan/phase-N.md`): what to change, the findings it closes, the check that says it is
done, and what it means for `/admin/platform` and Kaizena Flow's own site, by the house rule that the platform gets what stores get.
Every finding is closed by exactly one step, tolerated above, or a choice for the owner. A step's "done when" names a script of
`bloat-review-2026-11/scripts/`, a production figure (`evidence/production-database.md` has the queries), a test or a file.

**How this sits beside the code review's plan.** That plan stays. Where a step here is one of its steps, the step says so (among
them 1.4 server actions, 1.8 the build's room, 1.10 the written rules, 3.9 and 3.10 the catalogue's reads and tags, 3.14 the schema
file, 3.15 lean tables, 3.18 and 3.20 the AI manager's rounds): do it once, there or here, and tick both.

### Phase 0: Before the doors open

**Goal:** Remove what costs something on every request, cold start, scheduled run or agent session, with small and safe changes, and make the changes that are cheapest while no real store, order or picture exists. Steps 0.1 and 0.2 go first, and 0.18 comes before 0.19; otherwise no step waits for another. **A person will notice:** Almost nothing on a screen changes, apart from two faults a shopper would have met on day one (empty search thumbnails, and a button with no fill on the status and report pages). Cold pages answer sooner, an admin screen loads about half the script, a store page stops asking the server for a wishlist and stock nobody has, the database falls from 731 MB to about 230 MB, and an agent session starts with a third of today's standing rules. 28 steps (10 S, 18 M, 0 L), in full in `bloat-review-2026-11/plan/phase-0.md`.

### Phase 1: Budgets, so it stays removed

**Goal:** Turn every measure of this plan into a number that a test or a production figure holds and only lets fall. Each budget starts at the figure phase 0 leaves, with its tolerance stated, and each later step lowers its own. An A needs every measure held, so no area's budget is left for later. **A person will notice:** A change that makes a page, a function, a scheduled run, an AI call, a build or the standing rules heavier fails a check that names the number and says what to do. Platform, Usage and limits shows cold starts, the day's costliest statements and the admin's speed. 13 steps (2 S, 9 M, 2 L), in full in `bloat-review-2026-11/plan/phase-1.md`.

### Phase 2: Load on demand

**Goal:** The structural half: each page, function, document and AI call loads what it uses, when it uses it. Before opening is the cheapest time for it, and phase 1's budgets show each step as a number that falls. **A person will notice:** A store page arrives as a static file with nothing in it twice. A product view asks the database for stock and nothing else. A publish redraws one page, not the whole store. Admin screens hand the browser only the words they show, and the builder paints before its editors load. The AI manager answers on a third of the tokens. A session reads a 10 KB core. 26 steps (0 S, 18 M, 8 L), in full in `bloat-review-2026-11/plan/phase-2.md`.

### Phase 3: One of each

**Goal:** Keep one of each thing that was built twice, and add the gates that make cost follow use: scheduled work runs when something waits, at the pace its work changes. Nothing is retired because it is unused. Each fold is of a true duplicate, and before opening no data needs moving. **A person will notice:** On a quiet day the scheduler makes about 1,200 function calls, not 13,250, and the platform home shows every scheduled function with a row of its own. There is one place to edit Kaizena Flow's site, one engine for what happens when an order is paid, one import flow, and one deploy for a burst of pushes. 11 steps (0 S, 7 M, 4 L), in full in `bloat-review-2026-11/plan/phase-3.md`.

### Phase 4: Tidy

**Goal:** Smaller things, each done when its area is next touched. The ratchets of phase 1 hold every count until then, so nothing here can grow while it waits, and the last small findings close. **A person will notice:** Little. Admin forms and tables come from one kit, the last small twins are folded, tests share their scaffolding, and three more screens read less. 4 steps (0 S, 3 M, 1 L), in full in `bloat-review-2026-11/plan/phase-4.md`.


## 6. The owner's questions, and what was not measured

**Questions.** Each stops the step it names until answered. The ones without a step are product choices the reviewers met: none
is waste, and no step of the plan depends on them.

1. **Step 0.14, Cut what an idle tab, a save and a menu cost in the admin.** May the notice badge in a tab nobody touches be up to ten minutes late (60 requests an hour become 6)? The statement cuts need no answer.
2. **Step 0.20, Shed the database's dead weight: the scheduler's log, 13 duplicate indexes and the dead objects.** May the commerce_legacy schema, kept since 24 September as a renamed copy of the single-store tables, be dropped after a last dump?
3. **Step 0.27, Leave a map in CLAUDE.md, wrap the rules' long lines and keep history out of searches.** CLAUDE.md is your instruction file: may its 295-line feature index go, leaving a map of the seven rule files and a three-line look-up (44 KB to under 15 KB per session)? Without a yes the rules area cannot reach an A.
4. **Step 0.28, Make the rules say what is so, and claim a decision's number on main before citing it.** After a migration, should 'advisors checked, nothing new' still be written down, and where? The check itself stays either way; today 205 of 564 decision rows carry the note.
5. **Step 1.1, Give every budget one home, and hold the written rules first.** Should this plan get lines of its own in CLAUDE.md, as the code review has? Proposed: no. One shared line names the trackers, and each tracker keeps its rules at its own top.
6. **Step 1.10, Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows.** May a test refuse a new table, trigger, scheduled job, navigation link or AI tool until its decision row states what it costs a store that does not use it?
7. **Step 1.13, Give the production build room, and fail a run before it runs out.** Pay for Vercel's 16 GB build machine, or build in CI and deploy the prebuilt output? Without one of the two the build area stops at a B.
8. **Step 2.4, Bound what a real listing fetches ahead, and decide partial prefetching by trial.** On a full listing, may only the first screen of product tiles be fetched ahead on sight, and the rest when touched (or all through one shared product shell)? A yes lets the shopper's browser reach an A.
9. **Step 2.6, Give the storefront a stylesheet of its own, and count what is in it.** After the split, a Tailwind class typed in a part's Advanced tab can show on the builder's canvas and not on the live site. Is it enough to say in the docs that only classes styled by the owner's own CSS are promised, or should the site's sheet keep a short fixed list of utility names owners may type?
10. **Step 2.13, Load the admin's words by area on admin routes too, and take English defaults out of the code.** Is a third language for the admin (Swedish or Danish) wanted in the first half year? If yes, this step moves before opening: until it is done each language adds about 1.5 MB to every function.
11. **Step 2.20, Answer a store's own domain without a deployment.** May a store's own domain be resolved at request time, replacing decision P8's compiled routing rules? If P8 stays, the ceiling still needs an answer before about 250 stores have a domain, and the server area stops at a B.
12. **Step 2.21, Send the AI manager a lean default round.** What should the AI manager offer unprompted (question 8 of the code review)? In particular: always carry its 17 plan, reminder and saved-skill tools at about 3,800 tokens a round, or load them when the talk turns to them or the store has a plan, goal or reminder alive (a round with no page then falls to about 33,000 characters)?
13. **Step 2.25, Bring the always-loaded core under 10.5 KB, make every living doc searchable, and measure what a session loads.** May the database, e2e, typed-row and AI-eval how-to load only when those folders are opened (CLAUDE.md to under 10.5 KB)? It can be declined on its own; the core then stays at the 15 KB ceiling.
14. **Step 2.26, Shorten the gate: a type check without tests, a related test run, and a fresh worker only where a trial needs it.** What must run before a push? A: everything, as today (about 5 minutes after these fixes; 11 to 12 now). B: lint, the type check and the tests the change touches, with the whole unit suite in the deploy gate, so each deploy waits about 3.5 minutes more (the planner's advice). C: as B before the push with the gate unchanged, so a failing unit test outside the six money files can be live until someone reads the red run.
15. **Step 3.3, Give every scheduled function a ledger row and a watcher from outside, and every growing table a delete rule.** How long are guest carts, processed webhook events and old page versions kept (the code review's question 6)? The privacy text states the same periods.
16. **Step 3.4, Let per-store jobs find due work by a mark, and call the PDF route when a document waits.** Should invoice PDFs be made ahead by the scheduled job, so that 'Try again' is true (recommended), or made on the first download, with the route nothing calls and its 102 MB function removed?
17. **Step 3.5, Keep one kaizenaflow.com.** Is the switch of 7 November final, so that the old no-store site and its twin tables can be removed before opening (or kept as a fallback for some weeks, as the parity plan first said)? And one desk for support and chat (parity plan step 6), or two?
18. **Step 3.6, Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope.** May the parity rule in CLAUDE.md say: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy? Separate tables stay.
19. **Step 3.7, Keep one engine for one job: order rules fold into Workflows, and an own look is saved in the theme library.** May order rules fold into Workflows, and may an own look be saved only in the theme library? Yes or no for each.
20. **Step 3.11, Build twice per push, and deploy only what changes the app.** Once stores are open, may a CI run skip its deploy when a newer commit is already on main, so a burst of pushes shares one deploy? It changes D5's 'at once' by a few minutes.
21. Should a logged time entry's hours be editable in Work (the server side is built and tested; an afternoon's work), or is delete and log again the intended way (then about 130 lines go)? Either way two invoice actions no screen uses are deleted. (DD-5)
22. Should live drills get a Run drills button on the platform's store page, or stay a console tool asked for by SQL, with the rule saying so? (DD-6)
23. A new shop shows 29 links in Basic and 94 in Advanced, 35 of them under Settings. Is that what Lisa should meet, or should the moves already planned (code review step 2.4: about 85 links, 20 under Settings) be made before opening? It changes reading time, not running cost; the surface budget of step 1.10 holds whichever number you choose. (FT-7)
24. The platform has its own copy of four store engines (workflows, integrations, own endpoints, the read-only API: about 2,100 lines and 8 tables), built on the parity rule. Keep them as twins on shared code (step 3.6), or serve Kaizena Flow's events through its own store's engines once the site is one (step 3.5)? The idle cost is a few polls a minute either way. (FT-10)
25. Creators earn money commission (1,411 lines, 5 tables); referrals pay in bonus credits. Keep creators as a programme of their own, as built, or make a creator a kind of referrer who is paid in money? No running cost either way. (FT-13)
26. Do you read the parity report's detail tables on GitHub? If not, docs/shopify-parity.md can keep its five summary blocks (under 30 KB; 289 KB today) and pnpm parity prints the rest. If you do, it stays as it is and only leaves default searches (step 0.27). (DC-11)
27. Should the builder's palette show each of these near-twins as one entry, with the second as a switch: FAQ and accordion, button and dual button, email form and newsletter? Yes or no per pair. Nothing stored changes either way, and no visitor, request or build pays for the second entry. (PM-13)

**Not measured.** Real cold-start times, function invocations and cost on Vercel; real visitors' speed; the admin on a slow
connection; a store on a launch theme with fonts; a checkout with a payment form open. The plan has steps that measure the last
three and hold them.
