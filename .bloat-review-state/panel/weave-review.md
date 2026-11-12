# Review of the woven plan: what changed

Reviewed 12 November 2026 as someone who must carry the plan out. The plan is `panel/plan.json`; the weaver's version is kept as
`review-work/plan.before.json`. The checker prints `OK` on the result. Step numbers below are the new ones; "old 0.14" is the
weaver's numbering. The plan is rebuilt by `review-work/build.mjs` from four spec files, so every change here can be re-run.

## In numbers

| | Weaver | After review |
|---|---|---|
| Steps | 82 | 134 |
| By phase 0 to 4 | 28, 13, 26, 11, 4 | 42, 24, 44, 19, 5 |
| Effort S, M, L | 12, 55, 15 | 40, 85, 9 |
| Steps in phase 0 that ask the owner something | 4 | 0 |
| Findings and gaps closed by a step | 370 | 370 (none closed twice) |
| Work items behind the steps | 248 | 248 |
| Gaps dropped | | 0 (`dropped_gaps` is empty) |

- **Splits:** 43 of the 82 steps were split, or (old 2.25) taken apart.
- **Joins:** 7.
- **Moves between phases:** 20, carrying 19 findings and gaps and 7 parts that have no id.
- **Steps added:** 4 (0.2, 1.5, 2.24, 4.5).
- **Done-whens rewritten:** 44 (listed below). Others changed only because their step was split.

## 1. Merges

The rule used. A step stays whole where several stewards saw one fault, or where its parts are each a few lines to a day, in one
area, of one risk class, and proved by one script or spec. It is split where the parts differ in phase, in whether the owner must
answer first, or in risk class (money, sign-in, hot tables, what a shopper or an owner sees), or where together they are an L.

### Split

| Old step | Now | Why |
|---|---|---|
| 0.1 | 0.1, 0.2, 1.13 | Three changes: files copied into the repo, a table and a daily statement, a screen with flags. The flags are a check, so they are in phase 1. |
| 0.9 | 0.10, 0.11 | The editor off screens that do not edit (M, 34 screens) is not the two data tables in client scripts (S). |
| 0.10 | 0.12, 0.13 | Storefront links take one attribute. The admin needs a new link part and its own spec, and a press feels different. |
| 0.14 | 0.17, 0.18, 2.34 | 39 saves are edited file by file with each screen's spec (M, and a screen may stop updating if wrong). The poll's pace is the owner's choice, so it left phase 0. |
| 0.16 | 0.20, 0.21 | Three constant look-ups (S) against the AI connection, its tag, the month's cost and a new ceiling on search (M, changes what a search does past the ceiling). |
| 0.20 | 0.25, 0.26, 3.8 | A prune of the scheduler's log, index drops on hot tables, and a schema drop that waits for the owner. |
| 0.21 | 0.27, 0.28 | CR-4 itself says to ship its parts apart. The knowledge job has a new table and its own test. |
| 0.22 | 0.29, 0.30, 0.31 | Invoices are money and need a live drill. The listings' check is an AI job and needs the marker of 0.28. The prunes are schedule moves. |
| 0.23 | 0.32, 0.33 | Lifetimes and one config flag (S) against a new stored copy with a migration, the upload path and every reader (M). |
| 0.25 | 0.36, 0.37; CR-12 to 1.22 | Deleting unused code changes nothing a person can meet. Removing redirects and a switch does. The second scheduler is joined with its watcher. |
| 0.26 | 0.38, 0.39 | ci.yml against the Vitest config and 17 test files. |
| 0.27 | 0.40, 2.1 | The feature index is the owner's file and waits for a yes. Wrapping and ignore files do not. |
| 0.28 | 0.41, 2.41 | The Migration versions instruction waits for the owner's answer. |
| 1.2 | 1.2, 1.3, 0.35 | A script over the build's figures, a Playwright spec on real pages, and a fix to Tailwind's sources (not a budget, so it is in phase 0). |
| 1.3 | 1.4, 1.5 | Static scans against signed-in browser budgets. |
| 1.4 | 1.6, 1.7 | Two fixtures: a themed store, and a paying store with a payment stand-in. |
| 1.6 | 1.9, 1.10 | One counter, then two test files with different readers. CR-14 went to 3.3. |
| 1.7 | 1.11, 1.12 | Scripts on CI's build against int tests on the counter. |
| 1.8 | 1.14, 1.15, 1.16 | Three unrelated production figures in three places. |
| 1.13 | 1.21, 4.5 | Its done-when waited for the cuts of phase 2. See phases. |
| 2.1 | 2.2, 2.3 | Moving the drawer's slot restructures routes. The breakpoint sheet is a render change that follows it. |
| 2.2 | 2.4, 2.5 | The crawler setting depends on static pages and has its own proof. |
| 2.3 | 2.6, 2.7 | A wrapper with a ratchet against in-app moves on built pages, which touch pay paths. Together an L. |
| 2.5 | 2.9, 2.10 | Two bundles with two specs. |
| 2.6 | 2.11, 1.23 | The two reports are checks and can run today, so they are in phase 1. |
| 2.9 | 2.14, 2.15 | Tags first, then lifetimes: 55 refresh sites against 71 cached reads. Together an L. |
| 2.10 | 2.18, 2.19 | The frame's findings against a gap that brings three code review steps in. Together an L. |
| 2.11 | 2.20, 2.21 | The proxy's readers against the page reader and writer. |
| 2.12 | 2.22, 2.23 | Import cuts against what is traced beside a function, with a new column on products. |
| 2.13 | 2.25, 2.26 | A server codemod over 561 to 688 files against 38 client import sites. |
| 2.14 | 2.27, 2.28 | What a document hands down against what a save answers with. Together an L. |
| 2.18 | 2.32, 2.33 | The Auth call is security-sensitive and gets its own tests and its own review. |
| 2.19 | 2.16, 2.17 | A migration must land before the code that reads its columns. |
| 2.23 | 2.38, 2.39 | Two unrelated changes to AI calls. |
| 2.25 | 2.1, 0.40, 1.24, 1.1 | Four things in one step. Each joined the step that does the same job. |
| 2.26 | 2.42, 2.43, 2.44 | Only the related test run waits for the owner. |
| 3.1 | 3.1, 3.2 | Six true queues first; the three feature routes need a due function each. Together an L and a half. |
| 3.3 | 3.4, 3.5, 1.22 | Only retention waits for the owner's periods. The watcher is a check. |
| 3.4 | 3.6, 3.7 | Only the PDF route waits for the owner. |
| 3.7 | 3.11, 3.12, 0.42 | Two separate yes-or-no questions, and a read-only comparison that should come first. |
| 3.8 | 3.13, 3.14 | Two families of code. Together an L. |
| 3.9 | 3.15, 3.16 | Order totals are the sums a shopper pays by. |
| 3.11 | 3.18, 3.19 | Only the shared deploy waits for the owner. |

### Joined

| Now | From | Why it is one change |
|---|---|---|
| 1.22 | CR-12 (old 0.25) and the scheduler's gap 2 (old 3.3) | One edit of vercel.json: its one cron stops calling the daily job a second time and calls a watcher. Removing it first and adding it later would leave a gap. |
| 2.1 | DC-1 (old 0.27) and the how-to move (old 2.25) | Both edit CLAUDE.md and both need the owner's yes. |
| 0.40 | The rules' long lines (old 0.27) and every other doc's (old 2.25) | One script, run once. |
| 3.3 | CR-14 (old 1.6) | The finding says it is the same change as the registry: its test reads the registry, and its ledger column is what "last work" needs. |
| 1.8 | The manifest (old 1.5), repeated chunks (old 1.13), the count of routing rules (old 2.20) | One script, scripts/route-budget.mjs. Three steps each added a line to it. |
| 1.5 | Norwegian figures (old 1.3), the words baseline and a save's answer (old 2.14), script by idle (old 2.17) | One spec, e2e/signed-in/admin-scripts.spec.ts. |
| 1.1 | The docs budget (old 1.1), no decision id twice (old 2.24), rule sizes (old 2.25) | One test file and one baseline for the written rules. |

Pairs looked at and left apart, with a note in each: the modal flag is a column in 2.16 and is read in
2.18; PolicyLink is made in 0.13 and widened in 2.6; the product page's cart forms leave in
0.16 and the listing routes' in 2.9; theme cards are touched in 0.20 (one line) and
4.4 (a new column).

### Kept whole, with three or more work items

- One fault seen by several stewards: 0.6, 0.7, 0.9, 0.12, 0.14, 0.19, 0.23,
  0.24, 2.2, 2.11, 2.25, 2.27, 2.34, 3.1.
- One subject, small parts, one proof: 0.4 (two import edits), 0.5 (two lazy loads), 0.8 (one module),
  0.15 (three gates read by one script), 0.16, 0.20, 0.36, 0.39, 0.41,
  1.17, 1.20, 3.15.
- Phase 4 sweeps, done when their files are next opened: 4.3, 4.4.
- Made by a split and still with three or more work items behind them, each one change: 0.10, 0.13,
  0.21, 0.28, 0.40, 1.1, 1.3, 1.8. 0.11 is two small tables with one proof.

### The largest group in clusters.md

Group 1 holds 78 work items and 106 findings. It is a chain of items that share a finding with a budget item, not one change.
The weaver spread it over 32 steps; that was right. After the review it lies over 43. Two of its work items sit behind two steps
on purpose: W-owner-browser-1 (1.2 and 1.4) and W-scheduled-8 (1.10 and 3.3).

## 2. Phases

**Out of phase 0, because the owner must answer first:** the notice badge's pace (2.34), the leftover schema
(3.8), CLAUDE.md's feature index (2.1) and the Migration versions list (2.41). Phase 0 now
asks the owner nothing. The cost: the largest saving per agent session waits for a yes. Step 2.1 says so and is first
in phase 2; the rules area's ladder now needs it for a B.

**Out of phase 0, because they are checks:** the production flags (1.13) and the second scheduler with its watcher
(1.22).

**Into phase 0, small and safe:** Tailwind's sources (0.35, from old 1.2), the wrap of every living doc (0.40, from
old 2.25), and the comparison of two pairs of engines (0.42, from old 3.7: its steward said "now", and a fold it finds
must be known before phase 3).

**Into phase 1, so every check is there:** the styles' two reports (1.23), what a session loads (1.24), the
scheduler's watcher (1.22), the signed-in budgets (1.5), the count of routing rules (1.8), the AI
round on every working area's largest page (1.19), the 500-product store (1.11) and the test that no
decision id appears twice (1.1). Each phase 1 step now ends with the measures it holds.

**Out of phase 1, because they are fixes or wait for later cuts:** CR-14 (3.3); the re-measure of repeated chunks,
SG-11 and SF-11 (4.5); the manifest fix (2.24); pruneVisits (3.4).

**Phase 0 or 1 waiting for a later phase, found and removed:**

- Old 0.5 was proved by two keys of src/server/ratchet.baseline.json that only phase 1 creates (the file has four other keys
  today). 0.6 is now proved by the import walker that 0.1 puts in the repo.
- Old 1.13 was done only when repeated chunks fell under 40 MiB, which needs the cuts of phase 2. That check moved to
  4.5.
- 1.12 would fail on day one for reads that phase 2 removes. It now starts with a named list of exceptions that
  2.13 and 2.18 empty.
- The link ratchet stays with 2.6 in phase 2, and the step says why: a new file needs the wrapper to import.

Checks left outside phase 1 are each a step's own proof (a scan that the step's fix needs to stay fixed), not a budget.

## 3. Each step

**Spot-checks against the code (28, with rg, ls and wc; three corrections).**

| Step | Checked | Result |
|---|---|---|
| 0.1 | docs/audits/bloat-review-2026-11/scripts/ | 7 scripts there today. Wording corrected. |
| 0.3 | scripts/await-deploy.mjs, src/lib/await-deploy.test.ts, prerenderedShops() | Exist. |
| 0.4 | src/db/client.ts lines 11 and 78; importers of chat-route | The schema is imported whole and passed to drizzle(). 12 routes import through chat-route, the four visit beacons among them. |
| 0.5 | Static imports of sharp and opentype.js; MCP_TOOLS | 13, as written. MCP_TOOLS is in src/lib/mcp-catalogue.ts. |
| 0.6 | Keys of src/server/ratchet.baseline.json | No largestCycle or catalogReach. Done-when corrected. |
| 0.7 | Importers of lib/admin-text outside the admin | 33 by alias (35 with relative imports). |
| 0.8 | startUi(), uiTextsFor() | In src/server/ui-text.ts. |
| 0.9 | typingIn, AdminServiceWorker, session.tsx | In responsive-edit.tsx, push-settings.tsx and session.tsx. |
| 0.12, 0.13 | view-menu.tsx; the two prefetch specs | The menu exists. Neither spec exists: both are marked new. |
| 0.14 | next.config.ts | Neither setting is written today. |
| 0.15 | wishlist/saved route, KNOWN_COOKIES, /api/shop/tiles | Exist. |
| 0.17, 0.18 | router.refresh() in the admin; store-nav.ts, permissions.ts | 90 calls, as written. Files exist. |
| 0.19 | listAdminProducts(), getEditorContext(), listCustomers() | Exist. |
| 0.20 | Hand-written slug look-ups; src/lib/store-hosts.test.ts | 27. The test file exists. |
| 0.21 | AI_TAG; limits-enforce.int.test.ts | "ai-providers" at src/server/ai.ts:242. The test exists. |
| 0.23 | `store_id is not distinct from` in src/server | 122 in 40 files. owned() exists as a private helper in two files. |
| 0.24 | listPublishedPages( | 37 lines in 22 files. |
| 0.31, 1.22 | runJobs() callers; vercel.json | One caller. One cron, on the daily route. |
| 0.32 | uploadToSignedUrl in src/components | 9 calls. |
| 0.39 | src/db/migration-files.ts and its readers | 17 test files. |
| 0.40, 2.1 | CLAUDE.md; long lines in docs/rules; files under supabase | 43,361 bytes and 448 lines; 156; 796. |
| 0.42 | docs/audits/bloat-review-2026-11/findings/features | A folder of FT-*.md files, not features.md. Done-when corrected. |
| 2.2 | The @drawer slot | At src/app/s/[store]/[market]/@drawer. |
| 2.6 | Files that import next/link | 400. |
| 3.7 | NOT_SCHEDULED | In src/server/cron-routes.scan.test.ts. |
| 3.10, 4.2 | `for update skip locked` | One each in workflows.ts and platform-workflows.ts, two each in the two sync files. |
| 3.11, 3.12 | order-rule files; store_themes | 5 files; 17 lines. |
| 3.13 | Writers of data_jobs; import-flow files | 5 and 4. |

**Done-whens rewritten (44).**

- Proved by something a later phase makes, or by nothing that can be run: 0.6, 0.22, 0.42.
- Could not be checked on the day the step is done (the weaver's "over the next 100 commits"): 0.41 is now proved by
  the claim script's test; the 100 commits are read in 4.5.
- Stopped short of the area's bar, so ticking the step would not have reached an A: 0.16 (product page 735,000 to
  690,000 bytes, and its entry chunks), 0.25 (80 to 60 MB), 2.9 (715,000 to 650,000 and 700,000, by the
  bar's own measure), 2.37 (52,000 to 50,000 characters with no page, no tool over 2,500, median tokens per call),
  2.40 (index rows 500 to 200 characters), 2.38 (0.8 on later rounds), 3.3 (125 statements for an
  idle tick), 3.1 and 3.2 (1,200 calls a day; rows the log gains).
- A bar no step carried, added to the step that makes the last cut: 2.2 (om-oss at most 85,000 bytes), 2.4
  (Add to cart is one request under 5,000 bytes), 2.6 (6 requests on four pages), 2.11 (Brotli, and the
  admin's two sheets), 2.18 (5 statements for a cold frame), 2.20 (1.2 MB of chunks), 2.22 (a
  storefront page at 1,500 modules and 4.0 MB), 2.25 (every admin entry, median 15 areas),
  2.26 (five plain screens at 680,000 bytes, median 650,000), 2.27 (90% read on the budgeted
  screens, shared words, the home's and the builder's documents), 2.28 (30 KB of shell JSON), 2.42 (4 GB
  heap, the gate at 120 s), 2.43 (the pre-push rule at 5 minutes), 0.39 (0.15 s a plain file, 0.10 s for
  the client's import), 0.21 (2 reads of the connection for each AI call, in production), 4.4 (the orders
  list, the six lists' limits, two sandbox purges).
- Made one check, or given planted cases that must fail: 0.15, 0.3, 1.1, 1.4, 1.8,
  1.16, 1.21, 2.39.
- Aligned with the planner's own check: 0.20, 0.32, 0.40, 2.23, 3.19,
  0.17, 2.13.

**Effort.** 15 steps were L and 9 are; the six that went were each two or three smaller changes. Raised on steps kept whole: 0.15
from S to M (three gates, a new cookie, three specs) and 1.1 from S to M (it now holds six kinds of count). The split
of old 0.14 made its S an S and an M: 0.18 is 39 files by hand.

**Platform.** Every sentence was read. Rewritten where a split left it describing the other half. Where a step cannot apply to
Kaizena Flow it says "store-only by the house rule's exception" and why (0.15, 0.22, 1.7, 1.12,
2.10, 2.13, 3.16).

**Owner's questions.** 20 steps ask one, as before, but not the same 20. Each question went with the part that needs it:
2.34, 2.41, 3.8, 3.5, 3.7, 2.43, 3.19, and one each
for 3.11 and 3.12 (was one question with two answers). 2.1 asks
its two questions in order and says which grade each decides. 3.10 now names the owner's choice FT-10: if
Kaizena Flow's events go through its own store's engines, that step is dropped. Removed from steps that no longer need an
answer: 0.17, 0.25, 0.26, 0.40, 0.41, 2.42, 2.44,
3.4, 3.6, 3.18.

## 4. Nothing lost

- All 39 gaps are closed by a step. `dropped_gaps` is an empty list. Parts of gaps that the weaver's text had not carried were
  added: the field figure of the demo stores (1.14), reading the admin's speed a month on (1.15), a second
  measure of Kaizena Flow's front page (0.3), the monthly cap for search (0.21), the daily route in the query
  budget (1.10), the triggers' times (1.12), a scan for runners with no part in the due function (3.2), and a
  product's own tag (2.19).
- Two gaps have two halves in two phases. The database's gap 1: the reading is 0.2, and 1.13 closes it. The
  server's gap 3: 1.16 closes it, and 2.24 is its second half. So 0.2 and 2.24 close no id.
- All 331 findings in steps are closed once; 15 are tolerated and 7 are the owner's choices, as before. Their texts now name
  the new step numbers. build.mjs fails if a finding or a work item of the weaver's plan is missing, if a text names a step
  that does not exist, or if a phase 0 step asks the owner something.

## 5. Ladders

Each area's measures were read against the done-whens of its steps. Shortfalls were closed in the done-whens (section 3), by
one new step (2.24) and by parts added to steps: the unused index flag after eight weeks (1.13, the database's
measure 7), when a job last did work (3.3, the scheduler's measure 6), and a named list of handlers over 1,500
modules (1.8, the server's measure 1). 4.5 is on every ladder: it reads each measure against its bar when
the cuts are in, and a measure still short gets a step.

Changes to the lists: every step is on the ladder of each area it serves, and a ladder names no step that does not serve its
area (build.mjs checks both). The rules area needs 2.1 for a B. The server's ladder lost 1.21, whose server
findings moved to 4.5, and gained 2.24.

**Does every area reach an A?** Yes, on the steps as written. Seven areas need the owner's yes on the way: the server
(2.35), the rules (2.1), the build (1.21), the surface (3.9, 3.11,
3.12), the shopper's browser (2.8), the database (3.8, 3.9) and the code
(3.9, and FT-10 for 3.10). The other questions need an answer, and either answer reaches the bar.
