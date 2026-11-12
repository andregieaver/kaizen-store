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
   and one weaver merged all areas' work into one plan. {{PANEL_STATE}}

**What came out.** {{FINDINGS}} findings stand: {{CONFIRMED}} confirmed as first written, {{CORRECTED}} corrected by the skeptic (real, but
the numbers, the place or the scope were wrong) and {{ADDED}} added by the planners. {{REFUTED}} claims of the first reading were
refuted and dropped, among them several of the lead's own first figures. A tick (✓) marks a finding that passed its second check;
a planner's addition has none.

**Its limits.** Times and megabytes measured on the review's machine say what is large and what is small; they do not say what
Vercel will show. Real cold starts, function invocations and visitors' speed in production were not measured (the hosting metrics
need a plan the team does not have). The planners' {{ADDED}} additions were read by one reviewer. Savings marked as estimates are
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
`grade-a/` has each area's bar in full; `evidence/` the measurements; `scripts/` what made them. A step of the plan names
the findings it closes: open those files, not the folder. `plan/` has each phase in full, the brief of every step
(`plan/steps/`), how to carry a step out (`plan/README.md`) and the owner's decisions (`plan/decisions.md`).

**Words.** Six kinds of bloat: *dead* (nothing uses it), *duplicate* (built more than once), *eager* (loaded, fetched or run before
it is needed, or for someone who will never need it), *oversize* (bigger than its job), *ahead of use* (paying a running cost before
any use) and *no check* (nothing stops it growing). Priority, from the planners: P0 small and safe, do first; P1 a large saving
with more work or risk; P2 when the area is next touched; P3 true but not worth doing now. Effort: S under a day, M a few days, L a
week or more. Sizes are before compression unless a line says otherwise.

## Progress

This is a working document, kept as `code-review-2026-11.md` is: the table says where each step stands. Keep it true in the same
commit as the fix.

- **The goal is grade A in every area** (the owner, 11 November). The plan is done when every area is an A, not when its steps are
  ticked. Section 1 gives each area's bar; `bloat-review-2026-11/grade-a/<area>.md` gives it in full with how each number is measured.
- **Status** is one of: Open, In progress, Done, Dropped (with the reason in Notes).
- When a step is done, set Done with the date and the commit, in a line. Check its "done when" first, with the script, query or
  test it names.
- When verified fixes raise an area's grade, change it in the scorecard with the old grade and the date beside it, and show the
  owner the new table. Raise a grade only for fixes seen working in production, measured as the bar says.
- If a finding proves wrong, say so in Notes and correct it in its area's file; do not delete it.
- **No step waits for the owner.** The owner answered every question on 12 November (section 6 and
  `bloat-review-2026-11/plan/decisions.md`): the recommended way each time, and never a paid machine or service.
- **Carrying a step out:** read `bloat-review-2026-11/plan/README.md` once, then the step's own brief,
  `bloat-review-2026-11/plan/steps/<step>.md`: the files, the changes, the checks, and when to stop. **Who** says who can do it:
  *cheap* (a smaller model alone), *review* (a smaller model, and a stronger one reads the diff before the push) or *strong*.
  **After** names the steps that must be done first.

{{PROGRESS}}

Change log:

- 11 Nov 2026: first draft, on unverified findings from 14 of 25 areas. Nothing started.
- 12 Nov 2026: rewritten on the verified findings of all 25 areas, with the plan woven and each area's bar for an A set by the
  panel. Nothing started.
- 12 Nov 2026: the panel's challengers and critic closed every gap to an A ({{STEPS}} steps); the owner's answers written into
  the steps; a brief per step written for a smaller model to carry out. Nothing started.

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
5. **Nothing holds the numbers.** {{NOCHECK}} of the {{FINDINGS}} findings are the same finding: no check, budget or test would notice
   this growing. The storefront's first scripts have a budget and the storefront is the leanest part; even there the budgets watch
   2 of 56 routes. One push type-checks the same commit five times and builds it four, yet none of it checks weight.

Nothing is slow or broken today: the database is idle and pages answer quickly. What is paid now is cold starts, function time,
tokens, pushes and the build. What is at stake at opening is that causes 1, 2 and 4 grow with every store, page, product, order and
visit.

One thing the reviewers met that is not bloat but matters before opening: every store's own domain is compiled into each
deployment as 4 to 8 routing rules, against the host's limit of 2,048 a deployment. That is a wall near 270 stores with a domain
(SF-13; decided in section 6).

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

{{SCORECARD}}

How each area climbs, by the phases of the plan. An area cannot be an A before the step that holds its numbers:

{{LADDER}}

{{LADDER_NOTE}}

Each area's measures, today's values, the targets, how each is measured and the steps that reach it are in
`bloat-review-2026-11/grade-a/<area>.md`.

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

{{FINDINGS}} findings in 25 areas: {{EAGER}} eager, {{OVERSIZE}} oversize, {{DUPLICATE}} duplicate, {{NOCHECK}} no check, {{AHEAD}} ahead
of use, {{DEAD}} dead. By priority: {{P0}} P0, {{P1}} P1, {{P2}} P2, {{P3}} P3. By effort: {{SMALL}} small, {{MEDIUM}} medium, {{LARGE}}
large. They are not listed here: `bloat-review-2026-11/findings/README.md` lists every one by area with the step that closes it,
and each has a small file of its own (`findings/<area>/<ID>.md`) with the evidence, the fix in steps, the tests and rules that
change with it and its check. Open the files of the step you are doing, not the folder.

{{FINDINGS_TABLES}}
### What an A lives with

{{TOLERATED_COUNT}} findings are true and not worth fixing. This is the tolerance the bars allow, stated:

{{TOLERATED}}

## 5. The plan

{{STEPS}} steps in {{PHASES}} phases, in the order to do them. The Progress table at the top lists every step; each phase has a file
with its steps in full (`bloat-review-2026-11/plan/phase-N.md`): what to change, the findings it closes, the check that says it is
done, and what it means for `/admin/platform` and Kaizena Flow's own site, by the house rule that the platform gets what stores get.
Every finding is closed by exactly one step, tolerated above, or a choice for the owner. A step's "done when" names a script of
`bloat-review-2026-11/scripts/`, a production figure (`evidence/production-database.md` has the queries), a test or a file.

**How this sits beside the code review's plan.** That plan stays. Where a step here is one of its steps, the step says so (among
them 1.4 server actions, 1.8 the build's room, 1.10 the written rules, 3.9 and 3.10 the catalogue's reads and tags, 3.14 the schema
file, 3.15 lean tables, 3.18 and 3.20 the AI manager's rounds): do it once, there or here, and tick both.

{{PLAN}}
## 6. The owner's decisions, and what was not measured

{{CHOICES_INTRO}}

{{CHOICES}}

**Not measured.** Real cold-start times, function invocations and cost on Vercel; real visitors' speed; the admin on a slow
connection; a store on a launch theme with fonts; a checkout with a payment form open. The plan has steps that measure the last
three and hold them.
