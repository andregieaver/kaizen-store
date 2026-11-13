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
   and one weaver merged all areas' work into one plan. A reviewer went over the plan as someone who must carry it out; a challenger per area tested whether the bar is truly an A and whether the plan's steps reach it; one critic compared the grades across areas.

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

**Phase 0: Before the doors open**

| Step | What | Closes | Effort | Who | After | Status | Notes |
|---|---|---|---|---|---|---|---|
| 0.1 | Put the review's scripts and lists in the repo | GAP-code-1 | S | review |  | Done | 12 Nov, f781ac6: 32 scripts and 4 lists under the review's folder; cycle 229 files, 41 twin pairs, 84 helpers, 4,803 copied lines; 156 rows and sections. |
| 0.2 | Store a daily reading of production, so every later step has a 'before' |  | S | review |  | In progress | 12 Nov: pushed (D574); Done once two days of readings exist in production. 13 Nov: the first reading, at 07:00 UTC with no error: 487 table rows, 9 schema rows, 67 statement rows. |
| 0.3 | Let the deploy job, not a visitor, meet the first cold page | SD-3, GAP-server-2 | S | review |  | Done | 12 Nov, 9643872, 95d0866, b357302 and the docs commit (D575): the deploy log reads GET / 200 PRERENDER then HIT, GET /s/demo/no 200 PRERENDER then HIT; the hosts job is green with house-site.spec.ts; Vercel's 8 GB build lists 5 market pages per shop route (demo's 4, kaizenaflow's 1) in 5 min with no out-of-memory line. Commit 3's case 2 asks /<market> on the platform host (see D575). |
| 0.4 | Cut the two import hubs: the unused schema and the chat module's helpers | DD-1, DP-1, DP-9, SG-6, SF-6, DS-1, TC-5, DP-10, FM-2, FM-14, SG-3, SF-4, GAP-server-s2 | S | cheap | 0.1, 0.3 | Done | 12 Nov 2026, afff453 (9a79968, 7b3b1c0), D576; schema chunk files 0 (was 6); /api/visit 639 modules and 1,188 KB (was 1,890 and 10,475), /api/health 259 and 418 KB; the five beacons reach 100 to 107 files (was 1,308); db:check clean. Production: page checks passed, a visit counted, no new runtime error. |
| 0.5 | Load sharp, the font parser and the AI manager's engine when they are used | AS-1, DP-2, SG-7, SF-9, DP-11, SG-15, SG-10 | S | cheap | 0.1, 0.3 | Done | 12 Nov 2026, f5745c3, 993a364, 1350a6f (D578): static imports of sharp or opentype.js 0 (was 13), `MCP_TOOLS` 0; `/api/shop/tiles` cold-loads without sharp. After step 0.6, `/admin/[store]/orders` loads 1,333 server modules (2,349 before; at most 2,050 asked). `owner-tools.ts` is in one of the chunk files the route requires (608 KB, which Turbopack built with the AI manager's tools beside modules the page uses), but no import reaches it (the walker and esbuild agree), and a cold load evaluates 1,258 modules, not that one. Production: home, sitemap and the MCP catalogue answer 200, no sharp error. |
| 0.6 | Cut the import cycle of 229 server files | SG-1, SF-1, TC-2, SG-18, SG-17 | M | strong | 0.1, 0.3, 0.4 | Done | 12 Nov 2026, e4d0bfb, 298bc45, bb1fa83, ce51e87, 6b52973, ab02a69, 6e0559b, 4a8f058 (commit 7 in four), fd3206f; D580. Largest cycle in src/server 15 files (229 at the review), the store page 616 files (1,419), `/s/[store]/[market]` 1,594 server modules and 7,619 KB (2,419 and 11,944 KB) without the stripe package or theme-store.ts. A load-order fault from commits 1 and 2 gave Mollie's webhook a 500 for about 20 minutes, fixed by bb1fa83; CI now loads every built route on its own (830 of 830). Production after each deploy: home, store page, sitemap and Mollie's webhook 200; no new runtime error. |
| 0.7 | Give code outside the admin its own small word modules, so the admin's words leave shoppers' routes | FM-1, SF-5, TX-1, GAP-text-s2 | M | review | 0.1, 0.3 | Done | 13 Nov 2026, 2e66c77, 8653db1, 9fc9314 (D581): 18 modules in src/lib/admin-words/, 0 importers of admin-text outside the admin (35 before); catalogue files per entry: proxy 10, the four visit beacons 3 each, /api/recommendations/events 2, storefront layout 14 (135 before); 0 of 282 entries outside the admin carry the admin's words (255 before); 830 of 830 routes load on their own. Production: home, store page, sitemap, admin 200, the visit beacon 204, no new runtime error. A Norwegian staff email and the two-step sentences are held by their int tests (staff-alerts-lang, two-step); the production clicks are the owner's. |
| 0.8 | Make a language translated by AI cost what it uses: at start, per document and per minute | SG-5, SF-3, SD-7, TX-3, TX-12, TX-6, SC-13, PL-9, DQ-12, DS-2, CA-12, GAP-text-s7 | M | review | 0.1, 0.3, 0.4 | Done | 13 Nov: Done (f265add, b585eb9, ea006da, 434a2f3; D586; CI run 1254 applied `20261113180918_lowly_ultimatum`). 12 files behind the start hook (383 before; no AI SDK, no schema, no admin words); 2 statements at start whatever the number of languages (1 with none); 146 statements in a served day (test (d)), 2 in an unserved one (a minute's poll of the whole table before: 1,440 a day per instance); uiTextsFor() 114 browser keys under 9,000 bytes; 835 of 835 routes cold-load. Production after the deploy: /, /s/demo/no, /s/demo/no/withdraw and /sitemap.xml 200, the Mollie probe 200, no new runtime error, advisors INFO only. Still to read: the statement count two days after the deploy (with step 0.2's second reading). |
| 0.9 | Take Supabase's client, zod and the builder's English off every signed-in screen | AC-1, BN-1, BN-3, BN-4, DP-4, TX-4, GAP-owner-browser-s4, GAP-text-s6 | S | review |  | Done | 13 Nov: Done (e89c610, b67f06d, 9ed6005, 62aabd1, 14722a8; D587). On a local build: GoTrueClient on 0 routes (432 before), ZodError on 159 (432), 'Set for {size}' on 39, all the builder's own (423), sign-in's sentence on 2, /admin/account and the two-step set-up (456); /admin/[store] 682,999 bytes (1,194,862), the median admin route 641,331 (1,152,953); the signed-in store home's HTML holds no setup sentence; admin-scripts.spec.ts's budgets lowered (home 0.81 MB). The signed-in suite passed but for 7 specs that fail on main locally too; 835 of 835 routes cold-load. Production on 14722a8: /, /s/demo/no, /sitemap.xml, /admin/sign-in 200, the Mollie probe 200, no new runtime error. Still to do by hand: sign in to production, uploads (a product picture, a custom field file, a CSV) and the service worker (no e2e covers Storage). |
| 0.10 | Keep the page builder and the rich text editor off screens that do not edit a page | AC-2, BN-14, AC-3, BN-5, DP-5 | M | review | 0.9 | Open | |
| 0.11 | Take two whole tables out of client scripts: the Work invoice's words and the AI manager's tool definitions | AC-7, BN-7, AC-8, BN-15, AI-4 | S | review | 0.9, 0.10 | Open | |
| 0.12 | Stop prefetching what a press cannot use on stores and on Kaizena Flow's site | PF-2, PL-3, SC-1, PF-11, PL-4, BN-2, CA-4, CS-8 | S | cheap |  | Open | |
| 0.13 | Fetch the admin's rail and list rows when a link is pointed at | CA-5, PF-5, PF-6, AC-12, GAP-owner-browser-s3 | M | cheap | 0.12 | Open | |
| 0.14 | End the prefetch loop on /s/ addresses, and write both router settings down | PF-1, SC-9, CA-6, CA-7 | S | cheap |  | Open | |
| 0.15 | Make no server call after load for a visitor with nothing to fetch | SC-10, PL-7, SD-15, SC-12, PL-8, SD-14, PL-14 | M | review |  | Open | |
| 0.16 | Send shoppers' first scripts only what the page draws | SC-3, PL-10, BN-10, TX-5, TX-8, SC-11, SC-4, PM-11, GAP-shopper-browser-s4 | M | strong | 0.1 | Open | |
| 0.17 | Cut what a menu and a progress poll cost in the admin | AD-1, AD-9 | S | review |  | Open | |
| 0.18 | Draw the route once per save | AD-13 | M | review |  | Open | |
| 0.19 | Read the products, customers and stores lists a page at a time | AD-7, AC-14, AD-10 | M | review |  | Open | |
| 0.20 | Stop asking for what does not change: a store's slug, the theme cards, the hosts list | CP-2, SD-10, CA-9, DQ-9, CA-13, SF-12 | S | review |  | Open | |
| 0.21 | Read the AI connection only to call a model, and give search a ceiling | AI-2, DQ-4, GAP-ai-1, SD-16, CA-11, GAP-ai-s5 | M | strong | 0.2 | Open | |
| 0.22 | Work the cart and a shopper's facts out once per request, with no read for a feature that is off | SD-11, FT-15, GAP-surface-s1 | S | review |  | Open | |
| 0.23 | Filter a store's rows the way its index can serve | DQ-8, DS-7, PM-4, CR-6, GAP-database-s4 | M | review | 0.2 | Open | |
| 0.24 | Read one page, not all of them | CA-3, SD-4, DQ-2, PM-2 | M | review | 0.23, 0.1 | Open | |
| 0.25 | Prune the scheduler's own log | CR-5, DS-8 | S | review |  | Open | |
| 0.26 | Drop the 13 duplicate indexes, and add the test that stops the next one | DS-9, DS-15 | S | review |  | Open | |
| 0.27 | Let the knowledge job read no document when nothing was published | DQ-6, DS-5, PM-3 | M | review |  | Open | |
| 0.28 | Make picture, alt-text and product upkeep cost one statement when nothing changed | CR-4, DQ-3, DS-10, AI-13, AI-5, GAP-ai-s6 | M | review | 0.27 | Open | |
| 0.29 | Let the listings' check record a try and read only reworded products | CR-15 | S | review | 0.28 | Open | |
| 0.30 | Let the invoice job ask only stores it can issue for | CR-9, DS-3 | S | review |  | Open | |
| 0.31 | Run prunes daily, not every five minutes or every minute | FT-3 | S | cheap |  | Open | |
| 0.32 | Serve pictures as stored, and give every file with a fixed address a long lifetime | AS-4, AS-9, AS-12, AS-5, GAP-code-s3 | S | review |  | Open | |
| 0.33 | Keep an 800 px copy of every picture | AS-11 | M | strong | 0.32 | Open | |
| 0.34 | Give the admin's colour names a value on public pages | CS-7, CS-9, GAP-styles-s1 | S | review |  | Open | |
| 0.35 | Point Tailwind at code only | AS-7, CS-6 | S | cheap | 0.34 | Open | |
| 0.36 | Delete what nothing uses | DD-3, DD-8, TX-11, DP-8, GAP-code-s1 | M | strong |  | Open | |
| 0.37 | Remove the old admin redirects and the bookings and deliveries twin switch | DD-11 | M | review | 0.36 | Open | |
| 0.38 | Run each check once in CI | TC-1, TC-12, GAP-build-s5, TC-14 | S | review |  | Open | |
| 0.39 | Let a test load only what it uses | TC-3, TC-13, DD-13, DD-10 | M | review | 0.38 | Open | |
| 0.40 | Wrap the long lines of the rules and every living doc, and keep history out of searches | DC-4, DC-7, DC-13, GAP-rules-2 | S | cheap | 0.1, 0.43 | Open | |
| 0.41 | Make the rules say what is so, and claim a decision's number on main before citing it | DC-5, DC-8, DC-6, DC-12, GAP-rules-s3, DC-9 | M | review | 0.43, 0.40, 0.1 | Open | |
| 0.42 | Compare by job the two pairs of engines nobody compared | GAP-surface-2 | S | strong | 0.1 | Open | |
| 0.43 | Hold CLAUDE.md's core from the first day, and open a home for this plan's own sentences | GAP-rules-s1 | S | cheap |  | Open | |
| 0.44 | Give pictures in page content the 800 px copy | GAP-code-s4 | M | review | 0.33 | Open | |
| 0.45 | Cap the dispatcher at four jobs at a time | GAP-database-s3 | S | cheap |  | Open | |
| 0.46 | Make the themes, the content packs and the seed write today's page shape | GAP-page-model-s5 | S | cheap |  | Open | |

**Phase 1: Budgets, so it stays removed**

| Step | What | Closes | Effort | Who | After | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1.1 | Give every budget one home, and hold the written rules first | DC-3, GAP-rules-1, GAP-rules-s4 | M | cheap | 0.43, 0.40, 0.41 | Open | |
| 1.2 | Hold every route's first scripts | AC-10, BN-11 | S | cheap | 0.9, 0.16, 1.1 | Open | |
| 1.3 | Hold documents, stylesheets and requests on real store pages | SC-6, PL-13, PM-14, CS-3, GAP-shopper-browser-s2 | M | review | 0.12, 0.16, 1.1, 0.43 | Open | |
| 1.4 | Put the admin under the import walk, and hold where the words go | AC-11, TX-9, GAP-text-s5 | M | review | 0.7, 0.9, 0.36, 1.1 | Open | |
| 1.5 | Hold what a signed-in screen is handed, in English and in Norwegian | GAP-text-2 | M | cheap | 0.9, 0.13, 0.1, 1.1 | Open | |
| 1.6 | Put a launch-theme store into the measured set | GAP-shopper-browser-1, GAP-page-model-3, GAP-styles-1, GAP-shopper-browser-s5 | M | strong | 1.3, 0.33, 0.44, 0.46, 0.1, 0.43 | Open | |
| 1.7 | Put a cart with products and the checkout's payment step into the measured set | GAP-shopper-browser-2 | M | strong | 1.3, 0.1 | Open | |
| 1.8 | Hold what a server entry loads and carries | SG-14, SF-7, DP-6, AS-3, SG-16, GAP-server-s3 | M | review | 0.1, 0.4, 0.36, 1.1 | Open | |
| 1.9 | Count statements: one counter, and the admin's five screens | AD-12 | M | review | 1.1 | Open | |
| 1.10 | Count the statements and rows of scheduled work and of a cold frame | DQ-11, GAP-database-2, GAP-scheduled-s5, GAP-database-s2 | M | strong | 1.9, 1.1, 0.31 | Open | |
| 1.11 | Hold the storefront's server side: statements per page, cached reads and render modes | SD-13, CA-16, GAP-page-model-s2 | M | review | 1.9, 0.1, 0.3, 1.1 | Open | |
| 1.12 | Count a shop-only store's journey, and what one placed order writes | GAP-surface-1, GAP-database-3, GAP-database-s1, GAP-surface-s2 | M | strong | 1.9, 1.10, 1.1 | Open | |
| 1.13 | Flag in production what a test cannot see in the database | GAP-database-1, GAP-database-s5 | M | review | 0.2, 0.25, 1.9 | Open | |
| 1.14 | Hold time on a slow phone with a nightly production figure | GAP-shopper-browser-3 | M | cheap | 1.6, 1.3 | Open | |
| 1.15 | Hold the admin's speed with a line in the morning briefing | GAP-owner-browser-3 | S | cheap |  | Open | |
| 1.16 | Show cold starts as a production figure | GAP-server-3 | M | review | 0.8, 1.8, 1.11 | Open | |
| 1.17 | Hold unused code, copies and the admin's repeats with ratchets of exact lists | DD-4, GAP-code-2, CP-14, FM-13, FM-7, FM-8, GAP-code-3, GAP-code-s2 | M | cheap | 0.1, 0.36, 1.1, 1.10 | Open | |
| 1.18 | Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows | FT-2, DS-12, GAP-surface-3, GAP-surface-s3 | S | cheap | 1.1, 0.26, 0.31, 0.42, 1.10 | Open | |
| 1.19 | Hold every agent's round, show real tokens per call, and let the eval see whether the model finds a tool | AI-10, AI-14, GAP-ai-3, GAP-ai-s2, GAP-ai-s3 | M | strong | 0.1, 1.1, 0.21 | Open | |
| 1.20 | Record every check's seconds and the build's peak memory, with ceilings | TC-8, AS-10, GAP-build-1, GAP-build-s1 | M | review | 0.38, 1.8, 1.11, 1.1 | Open | |
| 1.21 | Give the production build room with the free switches, and fail a run before it runs out | GAP-build-2, GAP-build-s3 | S | review | 1.20 | Open | |
| 1.22 | Watch the scheduler from outside, and run the daily job once | CR-12, GAP-scheduled-2 | S | review | 0.25 | Open | |
| 1.23 | Count what is in the stylesheet, and read the style text owners write | GAP-styles-2, GAP-styles-3, GAP-styles-s2, GAP-styles-s3 | S | review | 1.8, 0.1, 1.1 | Open | |
| 1.24 | Measure what a session really loads, and hold source file size | GAP-rules-3, GAP-rules-s2 | M | cheap | 0.1, 0.40 | Open | |
| 1.25 | Count tag refreshes and store page draws in production | GAP-server-s6 | S | review | 1.9 | Open | |
| 1.26 | Let no job swallow its own failure | GAP-scheduled-s2 | M | review | 1.22, 1.10, 0.31 | Open | |
| 1.27 | Hold by name what a store page's first scripts may hold | GAP-page-model-s4, GAP-text-s3 | S | cheap | 0.16 | Open | |
| 1.28 | Count handed against named words at every hand-down site, without a browser | GAP-text-s4 | M | cheap |  | Open | |
| 1.29 | Only if the free switches are not enough: build in CI and deploy the prebuilt output |  | M | strong | 1.21, 0.38, 1.20 | Open | |

**Phase 2: Load on demand**

| Step | What | Closes | Effort | Who | After | Status | Notes |
|---|---|---|---|---|---|---|---|
| 2.1 | Leave a map in CLAUDE.md, and bring the always-loaded core under 10.5 KB | DC-1 | M | review | 1.1, 0.43, 0.41, 0.40 | Open | |
| 2.2 | Send the store's layout once | SC-8, PL-2, PM-1, CS-5, SC-7, PF-7, GAP-page-model-s6 | M | review | 0.1, 1.3 | Open | |
| 2.3 | Draw each fixed style sheet once per document | CS-4, PM-7 | S | review | 2.2, 1.3, 1.6, 0.34 | Open | |
| 2.4 | Serve store pages with nothing per visitor as static files, and let Add to cart answer a number | CA-1, CA-17 | M | strong | 0.15, 1.11, 2.2, 1.3, 0.4 | Open | |
| 2.5 | Give crawlers on Next's bot list the cached page | CA-15 | S | cheap | 2.4, 1.11 | Open | |
| 2.6 | Route every link through one wrapper with a stated policy | PF-3, PF-8, PF-12, PF-10 | M | review | 0.13, 1.3, 2.2 | Open | |
| 2.7 | Keep a press on a built page's tile inside the app | PF-4 | M | review | 2.6, 1.3, 0.12 | Open | |
| 2.8 | Bound what a real listing fetches ahead, and decide partial prefetching by trial | PF-13, PL-5, PF-9 | M | review | 2.6, 0.14, 1.3 | Open | |
| 2.9 | Let each working route load its own parts | SC-2, BN-9, GAP-shopper-browser-s3 | M | review | 0.16, 2.2, 1.2, 1.3 | Open | |
| 2.10 | Let a recommending grid bring its own words | BN-16 | M | strong | 1.27, 2.7 | Open | |
| 2.11 | Give the storefront a stylesheet of its own | SC-5, CS-1, BN-12, GAP-styles-s5 | M | review | 1.21, 1.23, 1.3, 0.35, 0.34, 0.12 | Open | |
| 2.12 | Draw a listing's grid once and read its list once | PL-6, PM-8 | M | review | 2.10, 2.2 | Open | |
| 2.13 | Ask the database for stock only on a product view | SD-2, GAP-server-s5 | M | review | 1.11, 1.12, 0.22 | Open | |
| 2.14 | Let a publish make only its own page stale | PM-15, PM-16, GAP-page-model-2, GAP-page-model-s3 | M | strong | 0.24, 1.11, 0.28, 1.9 | Open | |
| 2.15 | Let tagged reads live until their tag is refreshed | SD-8, CA-10 | M | strong | 2.14, 1.11, 1.25 | Open | |
| 2.16 | Keep a page's title and flags in columns | DS-4, PM-6 | M | review | 0.24, 0.23 | Open | |
| 2.17 | Let page lists, pickers and grids open no document | AD-14, PM-5, GAP-page-model-1, GAP-page-model-s1 | M | strong | 2.16, 0.24, 1.9, 0.19 | Open | |
| 2.18 | Read a cold store page's frame in one wave | SD-5, SD-9, DQ-7 | M | strong | 2.16, 0.24, 1.10, 1.11, 1.12, 2.2 | Open | |
| 2.19 | Read nothing that grows with the catalogue, and read the cart and checkout in one wave | GAP-server-1, GAP-server-s7, DQ-14, DQ-16 | M | strong | 1.11, 1.9, 0.22, 2.13, 2.17, 2.15 | Open | |
| 2.20 | Turn the proxy's readers into leaf modules | SD-1, SD-6, SG-2, SF-2, SG-8 | L | review | 1.8, 0.4, 0.6, 0.7 | Open | |
| 2.21 | Read a page without importing the code that saves pages | PM-12 | M | strong | 2.20, 0.24, 2.17, 1.8, 0.6 | Open | |
| 2.22 | Read a store without the Stripe SDK and without the whole page model | SG-9, DP-12 | M | strong | 1.8, 0.4, 0.5, 0.6, 2.21 | Open | |
| 2.23 | Trace the product taxonomy only beside routes that can read it | SF-8, SG-13, AS-2 | M | review | 1.8, 0.6, 0.5, 2.20, 1.10 | Open | |
| 2.24 | Shrink the server-reference manifest | GAP-server-s4 | L | strong | 1.8, 0.6, 2.20, 2.21, 0.4, 1.11 | Open | |
| 2.25 | Load the admin's words by area on admin routes too | SG-4 | L | review | 0.7, 1.4, 1.8, 0.6 | Open | |
| 2.26 | Take English catalogues out of the admin's client code | AC-9, BN-8 | M | strong | 0.9, 1.4, 1.2 | Open | |
| 2.27 | Hand each admin page only the words its parts read | AC-4, PL-1, TX-2, PM-10, GAP-text-1 | L | strong | 0.9, 1.5, 1.28, 2.26, 0.10 | Open | |
| 2.28 | Do not send the words again with a save | AD-5, GAP-text-3 | M | strong | 1.5, 2.27, 0.17 | Open | |
| 2.29 | Let the builder paint first: the rich text editor and a store language load after | AC-5, AC-6, BN-6, TX-7 | M | cheap | 0.10, 1.4, 1.2, 2.26 | Open | |
| 2.30 | Load the builder's dialogs and each block's field form when they are opened | GAP-owner-browser-1, GAP-owner-browser-s2 | L | strong | 0.1, 2.29, 2.27, 2.28, 1.5, 1.4 | Open | |
| 2.31 | Keep the session without the whole Supabase client | GAP-owner-browser-2 | M | review | 0.9, 1.5, 1.4 | Open | |
| 2.32 | Lighten the admin's shell and the store Home | AD-2, AD-4, AD-8 | M | review | 1.9, 0.17 | Open | |
| 2.33 | Make no Supabase Auth call per request for an account without a second factor | AD-3 | S | review |  | Open | |
| 2.34 | Let an untouched tab ask for notices less often | AC-13, PL-11, AI-12 | S | cheap | 0.17 | Open | |
| 2.35 | Answer a store's own domain without a deployment | SF-13 | L | strong | 2.20, 1.8, 1.29 | Open | |
| 2.36 | Send the AI manager a lean default round | AI-1, AI-9, AI-11, FT-4, AI-6, GAP-ai-s1, GAP-ai-2 | M | strong | 1.19, 0.5, 0.11 | Open | |
| 2.37 | Slim the tool schemas, so no first round is over 56,000 characters | AI-8 | M | strong | 1.19, 2.36 | Open | |
| 2.38 | Use cached input | AI-3 | M | strong | 1.19, 2.36, 2.37 | Open | |
| 2.39 | Give small jobs a quick model | AI-7, GAP-ai-s4 | M | strong | 1.19, 2.38 | Open | |
| 2.40 | Keep one file per decision, with a generated index | DC-2, AS-8 | M | cheap | 0.41, 1.1 | Open | |
| 2.41 | Retire the frozen Migration versions list and the order to add to it | DC-10 | S | cheap | 2.40, 2.1, 1.1, 0.43 | Open | |
| 2.42 | Shorten the gate's type check | TC-4, TC-9 | M | review | 0.38, 1.20 | Open | |
| 2.43 | Add a related test run for the push | TC-6, GAP-build-s4 | S | review | 0.38, 0.39, 1.20, 2.42 | Open | |
| 2.44 | Show by trial whether component and database tests need a fresh worker | GAP-build-3 | S | cheap | 0.38, 0.39, 1.20 | Open | |
| 2.45 | Cut what the largest paint waits for on a themed page | GAP-shopper-browser-s1 | M | strong | 1.14, 1.6, 1.3, 0.12 | Open | |
| 2.46 | Keep schemas apart from the helpers beside them, so zod loads only where a screen runs one | GAP-owner-browser-s1 | L | strong | 0.9, 1.4, 1.2 | Open | |
| 2.47 | Take the order writer off pages that only show products | GAP-server-s1 | L | strong | 1.8, 2.9, 2.22 | Open | |
| 2.48 | Give a placed order a ceiling, and stage placeOrder where the first figures are over it | GAP-database-s7, GAP-surface-s5 | M | strong | 1.12, 1.9 | Open | |
| 2.49 | Load motion.css where a page uses it | GAP-styles-s4, CS-2 | M | strong | 1.23, 2.11, 1.3 | Open | |
| 2.50 | Let a catalogue file be imported by its area module only, and import no code | GAP-text-s1 | M | strong | 2.25, 2.26, 1.4, 1.8, 0.7 | Open | |

**Phase 3: One of each**

| Step | What | Closes | Effort | Who | After | Status | Notes |
|---|---|---|---|---|---|---|---|
| 3.1 | Run one tick a minute, and call a route only when work waits | CR-1, CR-7, DQ-1, DP-7, SF-10, GAP-scheduled-s1 | L | review | 0.23, 1.10, 1.26, 1.22 | Open | |
| 3.2 | Let the three feature routes follow what is due | CR-3, GAP-scheduled-1 | M | strong | 3.1, 1.10, 1.9 | Open | |
| 3.3 | Run the dispatcher from a registry: a cadence and a time budget per job | CR-2, CR-8, DQ-5, GAP-scheduled-3, CR-14, GAP-scheduled-s3 | L | strong | 0.45, 1.26, 1.10, 0.28, 0.31, 0.2, 1.13, 1.18 | Open | |
| 3.4 | Give every daily function a ledger row of its own | CR-17, GAP-scheduled-s6 | M | review | 3.3, 3.1, 1.22, 1.26, 0.31 | Open | |
| 3.5 | Give every table that grows by time a delete rule | DS-13, CR-10, GAP-database-s6 | M | strong | 0.2, 3.4 | Open | |
| 3.6 | Indexes that fit the document jobs' windows |  | S | review |  | Open | |
| 3.7 | Call the PDF route when a document waits | CR-11, DD-12 | S | review | 3.1 | Open | |
| 3.8 | Drop the duplicate idempotency table and the leftover schema, after a verified dump | DS-14 | S | review | 0.2 | Open | |
| 3.9 | Keep one kaizenaflow.com | FM-3, FT-5, DS-6 | L | strong |  | Open | |
| 3.10 | Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope | CP-4, FM-4, FM-5 | M | strong | 1.17 | Open | |
| 3.11 | Fold order rules into Workflows | FT-8 | M | strong | 3.10 | Open | |
| 3.12 | Save an own look in one place: the theme library | FT-12 | S | review |  | Open | |
| 3.13 | Give the five file imports one core | CP-1, FM-6 | M | strong | 1.17 | Open | |
| 3.14 | Draw Work once for store and account, and keep one Domains move page | CP-5, FM-10, GAP-code-s5 | M | review | 1.17, 3.13 | Open | |
| 3.15 | Keep one of each small thing: helpers, SQL fragments, English word lists | CP-8, CP-16, FM-12, CP-9, DD-7, CP-13 | M | review | 1.17, 3.13 | Open | |
| 3.16 | Draw an order's totals from one part | CP-12 | S | review | 2.2 | Open | |
| 3.17 | Keep one stored page shape | PM-9, DD-9 | M | strong | 0.46 | Open | |
| 3.18 | Build twice per push, and lint and type-check once | TC-7 | M | strong | 0.38, 1.20 | Open | |
| 3.19 | Let a burst of pushes share one deploy | CA-2 | S | review | 0.38, 1.29, 0.43 | Open | |
| 3.20 | Show how long due work waits, and say so when it is too long | GAP-scheduled-s4 | S | review | 3.1, 1.22 | Open | |
| 3.21 | The invoice job reads what is marked as waiting, and keeps today's full check as an hourly net | DQ-15 | S | review | 3.6, 3.3, 1.10, 0.31, 1.18 | Open | |
| 3.22 | Every book gets its turn, and an idle book is looked at hourly |  | S | review | 1.10 | Open | |
| 3.23 | Tripletex and Fiken skip a store with nothing new, and the registry labels the six per-store jobs | CR-16 | S | review | 3.3, 3.22, 1.10 | Open | |
| 3.24 | The product-words sweep reads no product when no text changed |  | S | review | 0.28, 3.3, 1.10 | Open | |

**Phase 4: Tidy**

| Step | What | Closes | Effort | Who | After | Status | Notes |
|---|---|---|---|---|---|---|---|
| 4.1 | Build the admin kit and move action files onto the shared wrapper, area by area | CP-3, CP-7 | L | review | 1.17, 3.14 | Open | |
| 4.2 | Fold the remaining twins | CP-6, FM-9, CP-11, FM-11, GAP-code-s6 | M | strong | 1.17, 3.16, 3.10, 4.1 | Open | |
| 4.3 | Tidy the tests' side: exports only a test keeps alive, shared mocks and one tree walker | DD-2, CP-15, TC-11, TC-10 | M | strong | 1.17, 3.15 | Open | |
| 4.4 | Make the last reads fetch what they show | AD-6, AD-11, AD-15, DQ-10, DS-11 | M | strong | 1.9, 2.32 | Open | |
| 4.5 | Measure everything again, and read each area against its bar | SG-11, SF-11, GAP-surface-s4 | M | strong | 4.1, 4.2, 4.3, 4.4, 1.20, 1.8, 1.21, 1.29 | Open | |
| 4.6 | Let a logged time entry be corrected in Work, and delete two invoice actions no screen uses |  | S | cheap |  | Open | |
| 4.7 | Say that live drills are a console tool |  | S | cheap |  | Open | |

Change log:

- 11 Nov 2026: first draft, on unverified findings from 14 of 25 areas. Nothing started.
- 12 Nov 2026: rewritten on the verified findings of all 25 areas, with the plan woven and each area's bar for an A set by the
  panel. Nothing started.
- 12 Nov 2026: the panel's challengers and critic closed every gap to an A (156 steps); the owner's answers written into
  the steps; a brief per step written for a smaller model to carry out. Nothing started.
- 12 Nov 2026: every brief's rating checked by a blind second reviewer (agreed on 129 of 151; a judge settled 22), and each
  brief checked against the code and the briefs before it: 539 errors fixed in the briefs, 79 reported ones found not to be
  errors. Nothing started.
- 12 Nov 2026: at the owner's request, step 3.6 split into five steps (3.6, 3.21 to 3.24) and step 1.21's second stage, the
  build in CI, made its own step (1.29). The three design changes the split brought (3.22's `behind` column, 3.23's skip
  rule, 3.24's sweep check) reviewed by a stronger model against the code: all kept, with 37 exact fixes. Ratings now
  29 cheap, 77 review, 50 strong. Nothing started.
- 12 Nov 2026: step 0.1 Done (f781ac6): the review's scripts and lists are in the repo; every check names a path in it.
- 12 Nov 2026: step 0.2 pushed (325b547, D574); it stays In progress until production has two days of readings. Step 0.3 Done (b357302, D575): the deploy job requests two pages, and Kaizena Flow's own store is prerendered; commit 3 was finished by the reviewer after the executor stopped on a redirect loop that only `pnpm start` on `*.localhost` shows.
- 12 Nov 2026: step 0.4 Done (afff453, D576): the database client no longer loads the schema, and the beacons no longer load the chat module; `/api/visit` loads 639 server modules (was 1,890), the beacons reach 100 to 107 files (was 1,308).
- 12 Nov 2026: D577 (aa488c1): between steps, a sandbox's purge failed every five minutes on the site layout trigger; the trigger now checks only a column the statement changes.
- 12 Nov 2026: step 0.5 pushed (1350a6f, D578): sharp and the font parser load when a picture is drawn or a font is parsed, the AI manager's engine when its panel is used, the MCP tool list when tools are listed. It stays In progress until step 0.6's first commit lets the orders route's analyze figure be read.
- 12 Nov 2026: step 0.6 Done (fd3206f, D580): the import cycle of src/server from 229 files to 15, the store page from 1,419 source files to 616, and the Stripe SDK and the theme store off it. Step 0.5 Done with it: the orders route loads 1,333 server modules. A load-order fault on Mollie's webhook in between led to `scripts/cold-load-routes.mjs` in CI.
- 13 Nov 2026: step 0.7 Done (9fc9314, D581): the admin's words leave shoppers' routes; the proxy, the beacons and the storefront layout reach 2 to 14 catalogue files (135 before).
- 13 Nov 2026: step 0.8 Done (434a2f3, D586): a language translated by AI is read with two statements at start, built on first read, and its one-row stamp polled every ten minutes only where it is served; the start hook reaches 12 files (383 before).
- 13 Nov 2026: step 0.9 Done (14722a8, D587): Supabase's client, zod, the builder's English and sign-in's English leave the signed-in frame; /admin/[store] 1,194,862 to 682,999 bytes, the median admin route 1,152,953 to 641,331.

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

| Area | Today | Why | Grade A when | Steps that get it there |
|---|---|---|---|---|
| What a shopper's browser gets | C | C stands. The base is sound and partly held: 447 KB of a store page's 680 to 778 KB of first scripts is React and Next, a default store loads no third-party script and no font file, the extras are lazy, and two script budgets and an import scan exist. | A shopper's first page loads React and Next plus at most 168 KB of the store's own script on a built page (203 to 223 KB where it sells or pays), one document with nothing in it twice, and no more than 350 KB on the wire in all; left alone it fetches at most 6 answers ahead and calls the server for nothing. A themed store in production scores 90 on a slow phone every night, and a check fails on the day any of this slips. | 30 steps: `grade-a/shopper-browser.md` |
| What an owner's browser gets | D | D, at the top of the band; I recomputed the figures from the build's own stats and they hold. Every one of the 432 signed-in screens loads about 1.15 MB of script where about 0.65 MB will do, 27 screens load an editor or a catalogue they never draw (up to 4.27 MB), every screen makes 23 to 46 requests nobody asked for, and a product editor's document is two thirds unread words; budgets watch 9 of 449 routes, about… | A plain admin screen starts with at most 650 KB of script (447 KB of it is React and Next), a product's editor with at most 1.1 MB and the page builder with at most 1.8 MB; nothing is downloaded for a part the screen does not draw, a screen is handed at most 1.1 times the words its parts name, and a screen nobody touches asks the server for nothing but a notice count every ten minutes. Every route sits under a budget that only falls, and owners' real page loads paint within 2.5 seconds. | 29 steps: `grade-a/owner-browser.md` |
| What the server loads and asks | D | D stands, on the verified numbers. 559 of 562 pages, 181 of 268 route handlers and the proxy each load the same 10 to 12 MB of server code whatever their job (0.84 to 1.3 s to start cold on the review machine, against 0.16 to 0.24 s for the health check), every instance spends about 0.3 s in a start hook and 0.09 s reading a 10.4 MB list before its first request, and a product view sends about 18 statements where… | A function loads what its own job needs and little more: about 1 MB for a beacon and for the proxy, 4 to 5 MB for a store page, and a small, counted start for every instance. A page view asks the database only for what changes per view (stock on a product page, nothing on a home page), an admin screen shows its first content after one or two waves of reads, a cached page is drawn again only when something it shows has changed, and a test or a production figure holds each of these numbers. | 56 steps: `grade-a/server.md` |
| Scheduled work | D | D, at the top of the band; the steward's reasons hold against the code and the verified findings: nearly every one of the scheduler's 13,250 calls a day finds nothing (the posts alone cost about 150 s of database time a day at the measured 11.3 ms each), all 83 dispatcher jobs share one cadence with 78 started at once on five connections, and the scheduler's log is 564 MB of a 731 MB database. | On a quiet day the scheduler makes at most 1,350 calls and 45,000 statements, none of them per store, and every job runs at the pace of its work, four at a time, inside a time budget. Every scheduled function has a ledger row that shows its work and its failures, due work starts within minutes, and a test or a daily production figure holds each of these. | 24 steps: `grade-a/scheduled.md` |
| The database | C | C stands, made of two halves. The shape is close to a B: one small pool, statement and lock limits, queues claimed with skip locked, triggers gated by column, migration safety and the typed-read ratchet held by tests. | A read or a scheduled run costs what the asking store holds and what has changed, never what the whole platform holds. No statement fetches a document it does not draw, asks twice, writes nothing or runs slow, and a test or a daily production reading holds each of these numbers. | 34 steps: `grade-a/database.md` |
| The page builder's model and a built page | C | The base is sound and partly held: a stored page is 340 bytes a block, blocks and rows are capped, interactive parts load where drawn, and one script budget exists. But every storefront document carries the layout twice (27,070 bytes, 27 to 39% of its payload: I re-ran the script on four captures), one publish makes all 261 built pages of a store stale, 45 built entries keep every page of the store, the owner filter… | A built page is sent once and read once: one layout, each part once in the HTML and once in React's payload, only the documents it draws and only the scripts of the parts on it. A publish redraws that page alone, every owner's read stays inside that owner's rows, and tests on pages shaped like real stores' hold each figure. | 27 steps: `grade-a/page-model.md` |
| Styles | C | The steward's C stands. The base is sound: hand-written CSS has almost no dead weight, a built page carries under 5 KB of inline style, the admin's own CSS is a file apart, and style generation and fonts are cached. | A shopper's browser loads one stylesheet of at most 135 KB (20.6 KB compressed) with nothing in it that only the admin uses, a store's document carries each style sheet twice and no more, and every colour a public page reads has a value. A test fails, or a figure on the platform's own screen shows it, when any of this slips. | 12 steps: `grade-a/styles.md` |
| Interface text | C | The words are in excellent order: every language is complete and held by the compiler, 34 of 31,359 keys are dead, and a shopper's document carries 7 to 32 texts. How they load is not: 135 of the 136 admin catalogue files (3.52 MB) sit behind the proxy, the visit beacon and every store page, admin documents hand two to three times the words their parts name, and 423 of 449 admin routes and 97 of 111 visitor routes… | A shopper's function and scripts carry no admin words, an admin screen is handed the words its parts name and its function loads only the areas it names, a save sends no words again, and a translated language costs what it uses. Each of these is a number that a test fails on, for an English and a Norwegian owner. | 24 steps: `grade-a/text.md` |
| AI calls | C | C, in its lower half; the steward's grade holds against the verified findings. The base is sound and partly held: the shopper chat sends about 5,100 characters a call, the other agents are small, search answers are kept, tools of switched-off features are dropped, and a turn has ceilings of time and tokens. | The AI manager's first round is a third of today's size or less (at most 56,000 characters, and a median of 15,000 real tokens a call), at least half of its input comes from the provider's cache, and an eval shows it still finds its tools. Small jobs run on a small model, nothing reads the AI connection or walks the stores when no model is called, and a test or a daily figure holds every agent's size, output and ceiling. | 16 steps: `grade-a/ai.md` |
| The product's surface | C | The base is sound and part of it is held: one switch registry kept in step with the navigation and the AI tools by tests, a new store starts with the shop alone and 8 rows of its own, and almost every scheduled job is one statement for the whole platform. | A store that uses only the shop sends no statement, makes no call, gets no scheduled work and carries no AI tool for a feature it has off, from the front page to a paid order, and a test walks that road and fails on the next one. Every count of the product's size is held, and nothing is built twice unless the owner chose it in writing. | 25 steps: `grade-a/surface.md` |
| The code itself | C | The steward's C stands. The base is the tidiest in the review and its edges are held (0.35% of the code is dead, 0.87% is an exact copy, no package is unimported, all 150 public files are used; lint, the storefront's import scan and seven admin script budgets guard part of it), but the waste is real and none of its own numbers is held: 41 twin pairs (14 over 50 lines), kaizenaflow.com built twice, 354 KB of… | Nothing in the code is kept without a caller or written twice beyond a short list with reasons: no unused export, at most five small twin pairs, exact copies under half a percent, one site, one of each helper, no package or stored file that is not used, and no library or picture sent that the screen does not need. Eight checks, each proven by a planted mistake, fail the build when one of these numbers rises. | 37 steps: `grade-a/code.md` |
| Tests, CI and the build | D | D, moved from C by the panel's critic so that the thirteen grades compare. Every push runs 5 type checks for 1, a gate 3.5 times its floor and a pre-push rule 2.3 times its floor; about 27 runner-minutes of every push are repeats; 0 of 12 numbers are held; and it is the one area where the waste has already failed something (a deploy killed for memory on 11 November, with 10% of the machine left). | One push lints, checks and type-checks a commit once and builds it twice in CI; the gate before a deploy takes 90 seconds, a job a release waits for repeats no work and never runs over 10 minutes, the unit run 3 and a half, and a session's checks before a push 5. The production build keeps a quarter of its machine free, and a failing check holds every one of these numbers. | 13 steps: `grade-a/build.md` |
| The written rules | D | D, moved from C by the panel's critic so that the thirteen grades compare. Every session and every subagent loads four times what it needs (44 KB against 11 KB), a search cannot show 52% of the rules or 98% of the decisions, no size is held, and the one test in the area makes the file grow (35% in 12 days). | A session starts with at most 11 KB of standing rules, finds any rule, decision or tracker row with one search that shows its text, and is never told to read more than 20 KB before it starts. A check on every push, docs-only ones too, holds each size, and a sample of real sessions shows a code change takes in at most 25 KB of rules and docs. | 10 steps: `grade-a/rules.md` |

How each area climbs, by the phases of the plan. An area cannot be an A before the step that holds its numbers:

| Area | Today | After phase 0 | After phase 1 | After phase 2 | After all |
|---|---|---|---|---|---|
| What a shopper's browser gets | C | C | C | B | A |
| What an owner's browser gets | D | C | C | B | A |
| What the server loads and asks | D | C | C | B | A |
| Scheduled work | D | C | C | C | A |
| The database | C | C | B | B | A |
| The page builder's model and a built page | C | C | C | B | A |
| Styles | C | C | C | A | A |
| Interface text | C | C | C | B | A |
| AI calls | C | C | C | B | A |
| The product's surface | C | C | C | B | A |
| The code itself | C | C | B | B | A |
| Tests, CI and the build | D | C | B | B | A |
| The written rules | D | C | C | B | A |

Every area ends at an A. Where a challenger found the plan short of the bar, the missing step or the tighter check was added (each area's file in `bloat-review-2026-11/grade-a/` says which).

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

13 findings are true and not worth fixing. This is the tolerance the bars allow, stated:

- **CP-10.** Eleven hand-written claim-with-a-lease statements, about 130 lines in all. Each has another table, join and retry column: an idiom, not a copy. Tolerance: the 11 are held as a count by the copy baseline of step 1.17 and may not rise.
- **DP-3.** The Stripe and Supabase SDKs load with 97% of routes: 18 to 28 ms and about 1 MB of heap on a lean route, nothing a person sees. Step 2.22 takes Stripe off the read of a store, the graph test of step 1.8 shows the edges that are left, and they are cut when stores.ts or stripe.ts is next changed.
- **AS-6.** All of react-dom (8.1 MB) rides in four PDF traces of 107 to 140 MB: 5 to 7% of them and nothing a person feels, and a wrong glob would break invoices. The trace report of step 1.8 shows the number; act only if a function nears Vercel's size limit.
- **PL-12.** The default icon is 26 KB raw, about 9 KB on the wire, fetched at low priority after load, once per site, and only by a store with no icon of its own. It delays nothing a shopper sees, and it gets a day's cache lifetime with the public files in step 0.32.
- **BN-13.** 40% of the built client files are second copies of modules, but a browser meets about 14% of that while moving around the admin, and it is the chunker working as designed. The only lever is an experimental flag on a build with no memory to spare. The plan's other steps remove about 1.5 MB of the 6.89 MB of copies. Measure again after them, and adopt the flag only if a 59-screen tour falls by 10% or more with no budget raised.
- **SD-12.** Every one of these reads is cached and tagged, and together they cost about 1.5 s of database time a day. The uncached part, the AI provider row, is closed by step 0.21, and the modal scan by step 2.16. Tolerance: a cached, tagged read may fetch a row wider than it shows while the row is under about 10 KB.
- **SG-12.** About 290 KB and 10 ms per cold instance, and the only cut in the set that could show a shopper the wrong language. Tolerance: all four hand-written storefront languages load with a page, 0.4 MB of its 4 MB budget. Look again when a fifth hand-written language is added.
- **CA-8.** A crawler asks for each store's robots.txt, sitemap, llms.txt and feed about once a day, so a one-hour CDN window would save almost nothing. What a cold sitemap costs is what it reads, and step 0.24 removes most of that. Add the header when the handlers are next opened.
- **CR-13.** Raw status checks kept for 91 days are bounded: about 131,000 rows and 20 MB at steady state, in the platform's own table, pruned, and not growing with stores. Its one-line fix (bound the newest-check read to one day) is made when status.ts is opened for step 3.5.
- **DQ-13.** It names a pattern, not a cost of its own: 341 loops hold a database call. All but the per-site job loops run over a parent's few rows, and their cost follows use. The per-site loops are closed by steps 0.27, 0.28, 3.3 and 3.6, and the budget of step 1.10 holds the tolerance as a number: at most 2 more statements a tick for each added store with chat and pictures on.
- **FT-1.** 53 of 110 store links and 133 of 254 AI tools stand behind no switch. That is fine: a switch changes what an owner sees, not what a store costs. Links hide in Basic, a round is capped whatever is switched, and jobs are set-based. Where a feature does cost an idle store the fix is at the read (step 0.22), and the surface budget of step 1.18 asks each new feature for its idle cost. No second tier of switches.
- **FT-9.** Campaigns (7 kinds) and discount codes (3 kinds) are two mechanisms with a shared edge, not one job built twice: about 100 to 200 lines of parallel helpers, in code that decides money. Fold the helpers into one small module when pricing code is next opened. The one Discounts page is already code review step 2.4.
- **TX-10.** A deliberate, written design (D312 A6 and A8): the server answers in English because the AI manager and the tests read it, and about 300 refusals are matched back to their Norwegian. It costs 16.7 KB of source kept twice and no measurable time. The one real mismatch, the product.media pair, is settled in step 0.36. Add the coverage test when a validator is next changed.

## 5. The plan

156 steps in 5 phases, in the order to do them. The Progress table at the top lists every step; each phase has a file
with its steps in full (`bloat-review-2026-11/plan/phase-N.md`): what to change, the findings it closes, the check that says it is
done, and what it means for `/admin/platform` and Kaizena Flow's own site, by the house rule that the platform gets what stores get.
Every finding is closed by exactly one step, tolerated above, or a choice for the owner. A step's "done when" names a script of
`bloat-review-2026-11/scripts/`, a production figure (`evidence/production-database.md` has the queries), a test or a file.

**How this sits beside the code review's plan.** That plan stays. Where a step here is one of its steps, the step says so (among
them 1.4 server actions, 1.8 the build's room, 1.10 the written rules, 3.9 and 3.10 the catalogue's reads and tags, 3.14 the schema
file, 3.15 lean tables, 3.18 and 3.20 the AI manager's rounds): do it once, there or here, and tick both.

### Phase 0: Before the doors open

**Goal:** Remove what costs something on every request, cold start, scheduled run or agent session, with small and safe changes, and make the changes that are cheapest while no real store, order or picture exists. No step here waits for the owner's answer or for a later phase. Steps 0.1, 0.2, 0.3 and 0.43 go first; 0.43 comes before 0.6, 0.9 and 0.38, 0.23 before 0.24, 0.9 before 0.11, 0.28 before 0.29, and 0.33 before 0.44. Otherwise no step waits for another. **A person will notice:** Almost nothing on a screen changes, apart from two faults a shopper would have met on day one (empty search thumbnails, and a button with no fill on the status and report pages) and admin lists that show 100 rows at a time. Cold pages answer sooner, an admin screen loads about half the script, a store page stops asking the server for a wishlist and stock nobody has, and the database falls from 731 MB to about 230 MB. 46 steps (26 S, 20 M, 0 L), in full in `bloat-review-2026-11/plan/phase-0.md`.

### Phase 1: Budgets, so it stays removed

**Goal:** Turn every measure of this plan into a number that a test or a production figure holds and only lets fall. Every step here says which measures it holds. Each budget starts at the figure phase 0 leaves, with its tolerance stated, and each later step lowers its own. No step here waits for a later phase. Step 1.1 goes first, and 1.9 before the steps that count statements (1.10, 1.11, 1.12 and 1.25). Steps 1.6, 1.7 and 1.14 start here and are judged against their bars after phase 2. **A person will notice:** A change that makes a page, a function, a scheduled run, an AI call, a build or the standing rules heavier fails a check that names the number and says what to do. Platform, Usage and limits shows cold starts, the day's costliest statements and the admin's speed, and a stopped scheduler sends an email. 29 steps (8 S, 21 M, 0 L), in full in `bloat-review-2026-11/plan/phase-1.md`.

### Phase 2: Load on demand

**Goal:** The structural half: each page, function, document and AI call loads what it uses, when it uses it. Before opening is the cheapest time for it, and phase 1's budgets show each step as a number that falls. Order where it matters: 2.2 before 2.3, 2.4 before 2.5, 2.14 before 2.15, 2.16 before 2.17 and 2.18, 2.20 before 2.35, 2.36 before 2.37, 2.27 and 2.29 before 2.30, 1.21 before 2.11, 2.11 before 2.49, 2.25 and 2.26 before 2.50, and 2.9 and 2.22 before 2.47. Step 2.1 is first because it only waits for the owner's yes. **A person will notice:** A store page arrives as a static file with nothing in it twice. A product view asks the database for stock and nothing else. A publish redraws one page, not the whole store. Admin screens hand the browser only the words they show, and the builder paints before its editors load. The AI manager answers on a third of the tokens. With the owner's yes, an agent session starts with a quarter of today's standing rules. 50 steps (7 S, 35 M, 8 L), in full in `bloat-review-2026-11/plan/phase-2.md`.

### Phase 3: One of each

**Goal:** Keep one of each thing that was built twice, and add the gates that make cost follow use: scheduled work runs when something waits, at the pace its work changes. Nothing is retired because it is unused. Each fold is of a true duplicate, and before opening no data needs moving. Nine of these steps wait for the owner's answer. The scheduler's steps 3.1 to 3.4 and 3.6 do not, and go in that order. **A person will notice:** On a quiet day the scheduler makes at most 1,350 function calls, not 13,250, and the platform home shows every scheduled function with a row of its own. With the owner's yes there is one place to edit Kaizena Flow's site, one engine for what happens when an order is paid, and one deploy for a burst of pushes. There is one import flow. 24 steps (11 S, 10 M, 3 L), in full in `bloat-review-2026-11/plan/phase-3.md`.

### Phase 4: Tidy

**Goal:** Smaller things. The twins, the exports only a test keeps alive, the 23 guard wrappers and the last heavy reads are work of their own and end before step 4.5; class constants, hand-made tables, mocks and tree walkers go when their area is next touched, under a per-file ratchet. The ratchets of phase 1 hold every count until then, so nothing here can grow while it waits, and the last small findings close. The last step reads every measure against its bar: the plan is done when every area is an A, not when its steps are ticked. **A person will notice:** Little. Admin forms and tables come from one kit, the last small twins are folded, tests share their scaffolding, and three more screens read less. A table shows each area's measures against its bar. 7 steps (2 S, 4 M, 1 L), in full in `bloat-review-2026-11/plan/phase-4.md`.


## 6. The owner's decisions, and what was not measured

**Decisions.** The owner answered on 12 November: the recommended way for every question, and never a paid machine or service (so step 1.29 builds in CI if step 1.21's free switches are not enough; Vercel's larger build machine is ruled out). Each answer is written into its step; `bloat-review-2026-11/plan/decisions.md` has them in one table, with how to undo each. The ones without a step are product choices the reviewers met: none is waste.

1. **Step 1.1, Give every budget one home, and hold the written rules first.** Should this plan get lines of its own in CLAUDE.md, as the code review has? Proposed: no. One shared line names the trackers, and each tracker keeps its rules at its own top. **Decided:** No. This plan gets no lines of its own in CLAUDE.md: one shared line names the trackers and each tracker keeps its rules at its own top, as the step proposed.
2. **Step 1.18, Hold the surface: fourteen counts, the hot tables' indexes and triggers, and a new store's rows.** May a test refuse a new table, trigger, scheduled job, navigation link or AI tool until its decision row states what it costs a store that does not use it? **Decided:** Yes. The test refuses a new table, trigger, scheduled job, navigation link or AI tool until its decision row has an 'Idle cost:' line; the critic says the database and the surface need at least this hold for an A. A refusal is lifted by writing the line, so nothing is blocked for long.
3. **Step 1.21, Give the production build room with the free switches, and fail a run before it runs out.** Only if the two free source-map switches, measured first in step 1.20, do not bring the build's peak to 6.0 GB or less: pay for Vercel's 16 GB build machine, or build in CI and deploy the prebuilt output? Without room by one of the three ways the build area stops at a B. **Decided:** The paid build machine is ruled out for good: no paid machine, plan or add-on is ever used for the build. The two free source-map switches are measured first (step 1.20); if the peak is still above 6.0 GB, the production build is made in CI and deployed prebuilt (vercel build, then vercel deploy --prebuilt), which costs nothing and makes the deployed build the one CI made. Effort stays M if the switches are enough and is about a day more if the build moves to CI.
4. **Step 1.23, Count what is in the stylesheet, and read the style text owners write.** An owner's own CSS is limited to 50,000 characters for each of three sheets (the store's, the header's, the footer's), and all three go into every document. Should the limit be per sheet, as today, or on the sum? Either answer reaches the bar once it is written down. **Decided:** Per sheet, as today: 50,000 characters for each of the store's, the header's and the footer's sheet. It needs no code, and the step's 20 KB line per store already watches the sum.
5. **Step 1.29, Only if the free switches are not enough: build in CI and deploy the prebuilt output.** Only if the two free source-map switches, measured first in step 1.20, do not bring the build's peak to 6.0 GB or less: pay for Vercel's 16 GB build machine, or build in CI and deploy the prebuilt output? Without room by one of the three ways the build area stops at a B. **Decided:** The paid build machine is ruled out for good: no paid machine, plan or add-on is ever used for the build. The two free source-map switches are measured first (step 1.20); if the peak is still above 6.0 GB, the production build is made in CI and deployed prebuilt (vercel build, then vercel deploy --prebuilt), which costs nothing and makes the deployed build the one CI made. Effort stays M if the switches are enough and is about a day more if the build moves to CI.
6. **Step 2.1, Leave a map in CLAUDE.md, and bring the always-loaded core under 10.5 KB.** CLAUDE.md is your instruction file. First: may its 295-line feature index go, leaving a map of the seven rule files and a three-line look-up (44 KB to under 15 KB per session)? Second, and it can be declined on its own: may the database, e2e, typed-row and AI-eval how-to load only when those folders are opened (to under 10.5 KB)? Without the first yes the rules area cannot reach a B; without the second it stops short of an A, at the 15 KB ceiling. **Decided:** Yes to both halves. The 295-line feature index leaves CLAUDE.md for a map of the seven rule files and a three-line look-up, and the database, e2e, typed-row and AI-eval how-to load only when their folders are opened; the critic says the rules area needs both for an A. Every never-sentence stays in the file.
7. **Step 2.8, Bound what a real listing fetches ahead, and decide partial prefetching by trial.** On a full listing, may only the first screen of product tiles be fetched ahead on sight, and the rest when touched (or all through one shared product shell)? A yes lets the shopper's browser reach an A. **Decided:** Yes. On a full listing only the first screen of product tiles is fetched ahead on sight and the rest when touched, and on a computer the main menu's links wait for the pointer (step 2.6 sets that policy); the critic says the shopper's browser needs this for an A. The trial decides whether one shared product shell replaces the rule; without a clear gain the first-screen rule stands, since it needs no router setting.
8. **Step 2.11, Give the storefront a stylesheet of its own.** After the split, a Tailwind class typed in a part's Advanced tab can show on the builder's canvas and not on the live site. Is it enough to say in the docs that only classes styled by the owner's own CSS are promised, or should the site's sheet keep a short fixed list of utility names owners may type? **Decided:** The docs say it, and the site's sheet keeps no list of utility names. Only classes styled by the owner's own CSS are promised on the live site; a fixed list would add bytes to every store page for a few owners who type classes.
9. **Step 2.25, Load the admin's words by area on admin routes too.** Is a third language for the admin (Swedish or Danish) wanted in the first half year? If yes, this step and step 2.50 move before opening: until they are done each language adds about 1.5 MB to every function. **Decided:** No third admin language is planned for the first half year, so this step and step 2.50 stay in phase 2. If one is wanted sooner, both steps land before the language is added.
10. **Step 2.34, Let an untouched tab ask for notices less often.** May the notice badge in a tab nobody touches be up to ten minutes late (60 requests an hour become 6)? It shows at once on the next click, and stays at one minute while an approval waits. With a no the owner's browser's measure stays short of its bar: 60 requests an hour from each untouched tab grows with owners and is not a small tolerance. **Decided:** Yes. The badge in a tab nobody touches may be up to ten minutes late; it shows at once on the next click and stays at one minute while an approval waits. The critic says the owner's browser needs this for an A.
11. **Step 2.35, Answer a store's own domain without a deployment.** May a store's own domain be resolved at request time, replacing decision P8's compiled routing rules? If P8 stays, the ceiling still needs an answer before about 250 stores have a domain, and the server area stops at a B. **Decided:** Yes. A store's own domain is looked up when the request arrives, in place of decision P8's compiled routing rules; the critic says the server area needs it for an A, and it lifts the ceiling of about 270 domains. It lands in two pushes so the compiled rules stay until the lookup is seen to answer.
12. **Step 2.36, Send the AI manager a lean default round.** What should the AI manager offer unprompted (question 8 of the code review)? In particular: always carry its 17 plan, reminder and saved-skill tools at about 3,800 tokens a round, or load them when the talk turns to them or the store has a plan, goal or reminder alive (a round with no page then falls to about 33,000 characters)? Only loading them on demand is an A: kept on every round, the AI area and the surface stop at a B on this measure, with the 15,400 characters named. **Decided:** The AI manager offers its core tools, the page's group and the group the router picks from the question; the rest is one load_tools call away. Its 17 plan, reminder and saved-skill tools load when the talk turns to them or the store has a plan, goal or reminder alive; the critic says only this is an A for the AI area and the surface.
13. **Step 2.41, Retire the frozen Migration versions list and the order to add to it.** After a migration, should 'advisors checked, nothing new' still be written down, and where? The check itself stays either way; today 205 of 564 decision rows carry the note. **Decided:** A clean advisor check is not written down any more. Only a new advisor finding is written, as a line in docs/audits/psi-followups.md with the migration's file name; the check itself stays after every migration.
14. **Step 2.43, Add a related test run for the push.** What must run before a push? A: everything, as today (about 5 minutes after these fixes; 11 to 12 now). B: lint, the type check and the tests the change touches, with the whole unit suite in the deploy gate, so each deploy waits about 3.5 minutes more (the planner's advice). C: as B before the push with the gate unchanged, so a failing unit test outside the six money files can be live until someone reads the red run. **Decided:** The way the panel suggests in the build's card. Before a push a session runs lint, the type check and the tests the change can reach (about 2 minutes); the deploy gate runs the same related tests after its three steps (about 2.5 to 3 minutes in all), and the whole unit suite keeps running beside the deploy and reports, as today. It is the cheapest to run, the gate checks more than today's six money files, and going back is one sentence in CLAUDE.md and one line in ci.yml.
15. **Step 3.5, Give every table that grows by time a delete rule.** How long are guest carts, processed webhook events and old page versions kept (the code review's question 6)? The privacy text states the same periods. **Decided:** The periods the repo already states are used. A guest cart is deleted 90 days after it ended (an open cart: after its expiry), unless an order points at it, and a processed webhook event 90 days after it was processed: src/lib/retention.ts:180 and :184 and docs/wave-1g-gdpr.md:287 and :291 state those periods, and today the rows are only emptied at that age. A page keeps all 50 versions for 90 days and then its newest 10, the finding's rule, because an unbounded history would in time need a larger database.
16. **Step 3.7, Call the PDF route when a document waits.** Should invoice PDFs be made ahead by the scheduled job, so that 'Try again' is true (recommended), or made on the first download, with the route nothing calls and its 102 MB function removed? **Decided:** Made ahead by the scheduled job, as recommended: the tick calls the PDF route when a document waits, so 'Try again' is true. The route and its function stay.
17. **Step 3.8, Drop the duplicate idempotency table and the leftover schema, after a verified dump.** May the commerce_legacy schema, kept since 24 September as a renamed copy of the single-store tables, be dropped after a last dump? And may commerce.idempotency_keys go, now that the api_idempotency_keys tables of D441 do its job? Neither moves a grade. **Decided:** Yes to both. The commerce_legacy schema is dropped after a last dump that is verified and shown to the owner, and commerce.idempotency_keys goes because the api_idempotency_keys tables of D441 do its job. Neither moves a grade; the dump is the way back.
18. **Step 3.9, Keep one kaizenaflow.com.** Is the switch of 7 November final, so that the old no-store site and its twin tables can be removed before opening (or kept as a fallback for some weeks, as the parity plan first said)? And one desk for support and chat (parity plan step 6), or two? **Decided:** Yes, the switch of 7 November is final: the old no-store site and its twin tables are removed before opening, which the critic says the code area needs for an A and which is cheapest while nobody outside is disturbed. Support stays two desks, as it runs today: the site's visitors on the store's desk and owners on the platform's; joining them is the parity plan's step 6 and no part of this plan.
19. **Step 3.10, Run the platform's workflows, own endpoints and integration deliveries on the stores' engine with a scope.** First the choice listed with the owner's choices (FT-10): keep the platform's four engines as twins on shared code, which is this step, or serve Kaizena Flow's events through its own store's engines once the site is one (then the twins are removed with step 3.9 and this step is dropped)? If twins: may the parity rule in CLAUDE.md say that where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy? Separate tables stay. **Decided:** Twins on shared code: the platform keeps its four engines and their tables, and this step is built (the finding says to keep them unless one engine is wanted, and it is the smaller change). Yes, CLAUDE.md's parity rule gets the sentence: where the platform's version does the same job on its own rows, it uses the store's module with a scope, not a copy.
20. **Step 3.11, Fold order rules into Workflows.** May order rules fold into Workflows, so one engine decides what happens when an order is paid? **Decided:** Yes. Order rules fold into Workflows, so one engine decides what happens when an order is paid, as the surface's card proposes. It is cheapest now, while no owner has a rule to convert.
21. **Step 3.12, Save an own look in one place: the theme library.** May an owner's own look be saved only in the theme library, not also as a saved theme in the editor? **Decided:** Yes. An owner's own look is saved only in the theme library; the saved list leaves the theme editor. One place to look, and the old table stays one release as the way back.
22. **Step 3.19, Let a burst of pushes share one deploy.** Once stores are open, may a CI run skip its deploy when a newer commit is already on main, so a burst of pushes shares one deploy? It changes D5's 'at once' by a few minutes. **Decided:** Yes. A CI run on the no-migration path skips its deploy when a newer commit is already on main, so a burst of pushes shares one deploy; a run that applied a migration always deploys. It keeps stores' cached pages through a burst, and a repository variable turns it off.
23. **Step 3.20, Show how long due work waits, and say so when it is too long.** How long may work that a person watches wait before the admins are told (an AI page build, a look at a page, the Dream Factory)? The step assumes 3 minutes, and 20 for the other queues; any stated figure reaches the bar. **Decided:** 3 minutes for work a person watches (an AI page build, a look at a page, the Dream Factory) and 20 minutes for the other queues, as the step and the scheduled card assume. Both are constants in one file, so another figure is a one-line change.
24. Should a logged time entry's hours be editable in Work (the server side is built and tested; an afternoon's work), or is delete and log again the intended way (then about 130 lines go)? Either way two invoice actions no screen uses are deleted. (DD-5) **Decided:** Editable. A logged time entry's hours can be corrected in Work: the server side is built and tested and the finding recommends it. The two invoice actions no screen uses are deleted. New step 4.6 carries it.
25. Should live drills get a Run drills button on the platform's store page, or stay a console tool asked for by SQL, with the rule saying so? (DD-6) **Decided:** Leave as built: live drills stay a console tool asked for by SQL, and the rule says so. No button and no new AI tool. New step 4.7 corrects the three texts.
26. A new shop shows 29 links in Basic and 94 in Advanced, 35 of them under Settings. Is that what Lisa should meet, or should the moves already planned (code review step 2.4: about 85 links, 20 under Settings) be made before opening? It changes reading time, not running cost; the surface budget of step 1.18 holds whichever number you choose. (FT-7) **Decided:** Leave as built in this plan: a new shop keeps 29 links in Basic and 94 in Advanced. The moves to about 85 links stay code review step 2.4, on that plan's own schedule; the surface budget of step 1.18 holds today's numbers and is lowered when step 2.4 lands. No step here.
27. The platform has its own copy of four store engines (workflows, integrations, own endpoints, the read-only API: about 2,100 lines and 8 tables), built on the parity rule. Keep them as twins on shared code (step 3.10), or serve Kaizena Flow's events through its own store's engines once the site is one (step 3.9)? The idle cost is a few polls a minute either way. (FT-10) **Decided:** Keep the four engines as twins on shared code, which is step 3.10. Nothing is served through the store's engines; the idle cost is a few polls a minute either way and the twins are the smaller change.
28. Creators earn money commission (1,411 lines, 5 tables); referrals pay in bonus credits. Keep creators as a programme of their own, as built, or make a creator a kind of referrer who is paid in money? No running cost either way. (FT-13) **Decided:** Leave as built: creators stay a programme of their own, paid in money, beside referrals paid in credits. No running cost, and a merge would mix two kinds of bookkeeping. No step.
29. Do you read the parity report's detail tables on GitHub? If not, docs/shopify-parity.md can keep its five summary blocks (under 30 KB; 289 KB today) and pnpm parity prints the rest. If you do, it stays as it is and only leaves default searches (step 0.40). (DC-11) **Decided:** Leave as built: docs/shopify-parity.md keeps its detail tables, so they can still be read on GitHub, and it only leaves default searches (step 0.40). No other work.
30. Should the builder's palette show each of these near-twins as one entry, with the second as a switch: FAQ and accordion, button and dual button, email form and newsletter? Yes or no per pair. Nothing stored changes either way, and no visitor, request or build pays for the second entry. (PM-13) **Decided:** No for all three pairs: FAQ and accordion, button and dual button, email form and newsletter stay separate entries in the palette, as built. Nobody pays for the second entry, and other builders show them apart too. No step.

**Not measured.** Real cold-start times, function invocations and cost on Vercel; real visitors' speed; the admin on a slow
connection; a store on a launch theme with fonts; a checkout with a payment form open. The plan has steps that measure the last
three and hold them.
