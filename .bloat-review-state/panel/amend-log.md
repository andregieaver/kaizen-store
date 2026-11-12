# Amender's log: the panel's decisions applied

Written by the amender on 12 November 2026. Inputs: `plan.json` (134 steps), the thirteen `card-<area>.json` and `critic.json`; none was edited.
Outputs: `plan.final.json`, thirteen `card-<area>.final.json` and this file. All fourteen pass `state-tools/check-panel.mjs`.

## In short

- Steps: 134 before, 149 now. 15 added, none removed, no id changed.
- Shortfalls: 73 in all. 53 tightened a step the plan had, 15 became new steps, 4 were merged into another area's, 1 was answered by moving the bar, 0 dropped.
- Done-whens rewritten or extended: 90 of the 134 old steps (0.1, 0.4, 0.7, 0.8, 0.9, 0.10, 0.12, 0.13, 0.16, 0.17, 0.18, 0.19, 0.21, 0.22, 0.23, 0.24, 0.25, 0.28, 0.32, 0.33, 0.34, 0.35, 0.36, 0.38, 0.39, 0.41, 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22, 1.23, 1.24, 2.1, 2.2, 2.3, 2.6, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.17, 2.19, 2.20, 2.21, 2.22, 2.24, 2.25, 2.27, 2.30, 2.32, 2.36, 2.37, 2.38, 2.39, 2.42, 2.43, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.14, 3.15, 3.18, 4.1, 4.2, 4.3, 4.4, 4.5).
- Steps whose text or title changed without their done-when: 0.14, 0.27, 3.8, 3.17.
- Grades today changed: rules from C to D; build from C to D. Five areas are a D today and eight a C.
- Bars changed: 24 entries of the critic, in 12 areas (list below).
- Every area ends at an A in its ladder. None is stopped by anything but the owner's answers, with two figures not yet shown (see the end).

## Steps added, by phase

| Phase | Before | Added | Now | New steps |
|---|---|---|---|---|
| 0 Before the doors open | 42 | 4 | 46 | 0.43, 0.44, 0.45, 0.46 |
| 1 Budgets, so it stays removed | 24 | 4 | 28 | 1.25, 1.26, 1.27, 1.28 |
| 2 Load on demand | 44 | 6 | 50 | 2.45, 2.46, 2.47, 2.48, 2.49, 2.50 |
| 3 One of each | 19 | 1 | 20 | 3.20 |
| 4 Tidy | 5 | 0 | 5 | none |

- **0.43** (S) Hold CLAUDE.md's core from the first day, and open a home for this plan's own sentences. Closes GAP-rules-s1.
- **0.44** (M) Give pictures in page content the 800 px copy. Closes GAP-code-s4.
- **0.45** (S) Cap the dispatcher at four jobs at a time. Closes GAP-database-s3.
- **0.46** (S) Make the themes, the content packs and the seed write today's page shape. Closes GAP-page-model-s5.
- **1.25** (S) Count tag refreshes and store page draws in production. Closes GAP-server-s6.
- **1.26** (M) Let no job swallow its own failure. Closes GAP-scheduled-s2.
- **1.27** (S) Hold by name what a store page's first scripts may hold. Closes GAP-page-model-s4, GAP-text-s3.
- **1.28** (M) Count handed against named words at every hand-down site, without a browser. Closes GAP-text-s4.
- **2.45** (M) Cut what the largest paint waits for on a themed page. Closes GAP-shopper-browser-s1.
- **2.46** (L) Keep schemas apart from the helpers beside them, so zod loads only where a screen runs one. Closes GAP-owner-browser-s1.
- **2.47** (L) Take the order writer off pages that only show products. Closes GAP-server-s1.
- **2.48** (M) Give a placed order a ceiling, and stage placeOrder where the first figures are over it. Closes GAP-database-s7, GAP-surface-s5.
- **2.49** (M) Load motion.css where a page uses it. Closes GAP-styles-s4, CS-2.
- **2.50** (M) Let a catalogue file be imported by its area module only, and import no code. Closes GAP-text-s1.
- **3.20** (S) Show how long due work waits, and say so when it is too long. Closes GAP-scheduled-s4. Asks the owner one question.

The four new steps of phase 0 ask the owner nothing. Step 0.44 is effort M, as the critic set it; the other three are S.

## Merged, moved and dropped

Merged shortfalls (each closed by the same step as the one it joined):
- database 2 (rows an idle tick may read per added store) into scheduled 5: step 1.10. One part is carried into step 3.6 (a change mark for the product-words sweep, and a line of at most 10 more rows per added store).
- surface 5 (a paid order's optional triggers) into database 7: new step 2.48.
- text 3 (the visitor's import scan) into page-model 4: new step 1.27.
- text 6 (sign-in's English on 456 routes) into owner-browser 4: step 0.9.

Bar moved in place of a step: build 2. The 8-minute median for a job a release waits for is gone; the bar is no repeated work, each median held within 25%, no run over 10 minutes, and step 3.18 may not make the slowest job longer. `GAP-build-s2` is in no step's closes for that reason.

Findings and gap ids moved between places (each is still in exactly one):
- TC-14 from step 3.18 to step 0.38 (the skip of a deploy for a tests-only push).
- DC-9 from tolerated to step 0.41 (its three edits are made now).
- DQ-14 and DQ-16 from step 4.4 to step 2.19 (reads that grow with the catalogue).
- GAP-ai-2 (page groups) from step 2.37 to step 2.36, with the groups themselves.
- CS-2 from tolerated to the new step 2.49 (motion.css loaded where a page uses it, decided by step 1.23's reading).

Parts of steps moved (step_changes):
- 3.3 lost the cap of four jobs to the new step 0.45; 3.17 lost 'every writer writes today's shape' to the new step 0.46.
- 2.37's page groups moved into 2.36, so the router returns a group from its first version; 2.37 keeps the schema slimming.
- 2.38's counting of cached tokens moved to 1.19; 2.38 keeps the use of the cache.
- 2.25 keeps what its codemod reaches (a median of 30 areas); the 218 direct importers are the new step 2.50.
- 4.4's per-product VAT and alt-text calls and its lists with no limit moved to 2.19 and 2.17.
- 3.18's skip of a deploy for a tests-only push moved to 0.38.
- 1.14's seven green nights moved to the new step 2.45; 1.14 is done when the nightly job has run a week.
- 2.24 lost its condition (production cannot time a step inside Next) and is effort L, the upper end of the critic's 'M to L'. The new step 2.46 is L for the same reason.
- 0.36 deletes only what is superseded or orphaned; the server side of a feature with no screen yet stays on a list. 3.8 names what replaced the idempotency table and asks before it goes.
- 0.19 states its default for 'select all', so phase 0 still asks nothing. 0.23 lands owned() first. 2.11 goes after 1.21. 0.12 and 0.14 stay two steps with one spec.
- 4.1, 4.2 and 4.3: twins, test-only exports and the 23 guard wrappers end before step 4.5; class constants, tables, mocks and tree walkers stay 'when touched' under a per-file ratchet.
- 4.5's table carries the figures that need time, each with the day it can first be read.

Dropped: nothing. `dropped_gaps` in the plan is still empty.

One thing the amender decided alone: step 0.33 has no owner question in phase 0, so it names three stored picture sizes (480, 800, 1,600 px) as the default and leaves a fourth size as the owner's later choice. The critic asked for that answer before step 0.33; a phase 0 step may not wait for one.

## Grades and bars changed

- **rules**: C to D. Every session and every subagent loads four times what it needs (44 KB against 11 KB), a search cannot show 52% of the rules or 98% of the decisions, no size is held, and the one test in the area makes the file grow (35% in 12 days). That is the D sentence: every run carries far more than its job needs and nothing holds it. The card kept a C because rules load on demand and a test holds that. The three D areas have sound parts too (the server's tagged caches, the scheduler's ledger), and by ratio this area carries more than the owner's browser, which is a D at 1.8 times.
- **build**: C to D. Every push runs 5 type checks for 1, a gate 3.5 times its floor and a pre-push rule 2.3 times its floor; about 27 runner-minutes of every push are repeats; 0 of 12 numbers are held; and it is the one area where the waste has already failed something (a deploy killed for memory on 11 November, with 10% of the machine left). The owner's browser is a D on the same shape: about 43% of each screen's script is not needed and 9 of 449 routes are held. The card's reason for a C, that most runner time is needed work, is true of the owner's browser as well, where 447 KB of each screen is the framework.

| Area | Measure | New bar |
|---|---|---|
| ai | 1 and 2: the first round, and tokens per call | The A is 34,000 characters with no page, 56,000 for any first round and a median call of 15,000 tokens. With the 17 tools kept on every round the measure is a B, with their 15,400 characters named. |
| surface | 6: what an AI manager round carries | The AI card's numbers: 34,000 with no page and no question, 56,000 for any first round with the question drawn; 12 store tools when no area is asked; the cached share read over ai_manager and analytics_question |
| surface | 2: places where a store pays per view | a product at most 2 (3 with producer schemes, 4 with price breaks), a search at most 10 |
| surface | tolerance on scheduled work | 0: the same statements for 1 store and for 20 with every feature on |
| shopper-browser | 2: the store document | at most 80,000 (82,000 until step 2.3) |
| shopper-browser | 7: time, the field figure | with 100 loads or more of a kind of page in 28 days; until then the nightly lab figure stands in |
| shopper-browser | 6: pictures on real pages | no picture from a file more than 1.5 times as wide as its box needs (2.25 times the pixels), at 390 px 2x and 3x and at 360 px 3x |
| code | 6: pictures | no more than 1.5 times as wide as its box needs (2.25 times the pixels), at 390 px 2x and 3x and at 360 px 3x |
| code | 7: what the lightest routes load | each of the five beacons under 130 |
| code | 2: copied lines in tests | printed in the copy report, not held |
| code | 4: admin class constants and hand-made tables | The kit's parts exist, no new file may declare a class constant or a hand-made table, and the per-file counts only fall as areas are touched (296 constants and 154 tables today, under 0.15% of the code). The 23 local guard wrappers still go to 0. |
| server | 1: admin words a shopper's function loads | the proxy and every beacon reach 0 catalogue files; the storefront layout at most 8 files and 0.21 MB of source |
| server | 1: pages that keep a function per view | 4.8 MB and 1,800 modules, and none of checkout.ts, stripe.ts, ledger.ts, staff-alerts.ts or billing.ts |
| owner-browser | 5: words a screen is handed | handed against named, counted from source in both languages: at most 1.1 times the groups a screen's parts name on the five budgeted screens and at most 1.25 times at every site that hands over 50 KB; the browser's record stays as a cross-check that may only rise; shared words at most 15.5 KB and 16 KB |
| page-model | 8: interface text in the editor's document | at most 1.1 times the groups the editor's parts name at first paint, by the same scan; 130,000 bytes inline stays |
| text | 3: the builder's document | at most 445,000 with at most 130,000 of words, after step 2.30 |
| owner-browser | 4: sign-in English (shortfall 4) | only the routes that draw a part that reads it: 2 today, each named |
| database | 2: whole documents | 14 after step 0.24 and at most 3 after step 2.17 |
| scheduled | 4: pg_cron's run log | under 20 MB |
| database | 5: the slow list | at most 1,350 a day |
| styles | 2: motion.css in every store's stylesheet | judged now, by step 1.23's reading of the six launch themes and the team's 60 stores: under half, and it loads only where a page uses it before the plan ends, with the first measure at 116,500 raw and 17,400 Brotli |
| owner-browser | 6: the notice poll | 6 an hour; with a no the measure is short |
| build | 4: the jobs a migration release waits for | no repeated work inside a job, each job's median held within 25%, no single run over 10 minutes, and step 3.18 may not make the slowest job longer |
| build | 6: a session's first push | 5 min 30 s if the native compiler passes its trial; otherwise the cold type check's own time is the stated tolerance (about 3 minutes, so about 7 min 30 s), and nothing else in the rule runs cold |

## Each area: grade today and ladder

| Area | Today | After phase 0 | After phase 1 | After phase 2 | After all | Steps to an A | Shortfalls settled |
|---|---|---|---|---|---|---|---|
| code (The code itself: unused, copied, packages, files) | C | C | B | B | A | 37 | 6 |
| shopper-browser (What a shopper's browser gets) | C | C | C | B | A | 30 | 5 |
| owner-browser (What an owner's browser gets in the admin) | D | C | C | B | A | 29 | 4 |
| server (The server: what it loads and asks per request) | D | C | C | B | A | 56 | 7 |
| scheduled (Scheduled and background work) | D | C | C | C | A | 24 | 6 |
| database (The database: its shape and how it is asked) | C | C | B | B | A | 34 | 7 |
| ai (AI calls) | C | C | C | B | A | 16 | 6 |
| surface (The product's surface: one of each, and what a feature costs a store that does not use it) | C | C | C | B | A | 25 | 5 |
| rules (The written rules and the agents' context) | D (was C) | C | C | B | A | 10 | 4 |
| page-model (The page builder's model and a built page's render) | C | C | C | B | A | 27 | 6 |
| styles (Styles) | C | C | C | A | A | 12 | 5 |
| text (Interface text) | C | C | C | B | A | 24 | 7 |
| build (Tests, CI and the build) | D (was C) | C | B | B | A | 13 | 5 |

How the ladders were set. Each card's own ladder was kept up to phase 2, since the cards were written against the same scale, and the last column became an A where the critic found no step missing. Two areas start a grade lower (rules and build, now D): rules reaches a C in phase 0 because CLAUDE.md is held from step 0.43 and searches can show the rules after step 0.40; build reaches a C in phase 0 because five type checks become two and the unit run stops loading what it does not use.
In the plan's `ladders`, `to_b` and `to_a` together are the card's `steps_to_a`. A step the plan already had keeps its side; every new step is in `to_a`.

## Does every area end at an A?

Yes in the ladders, and no step is missing. What still stands in the way is not in the plan's hands:

1. Six answers must be a yes, or the named area stops at a B: the feature index out of CLAUDE.md and the how-to loaded by folder (rules, step 2.1, both halves); a store's domain looked up on request (server, step 2.35); a bound on what a listing fetches ahead (shopper's browser, step 2.8); one kaizenaflow.com (code, step 3.9); the AI manager's 17 extra tools on demand (AI and surface, step 2.36); the notice badge up to ten minutes late (owner's browser, step 2.34).
2. The build may need a larger machine or a build made in CI (step 1.21), but only if the two free source-map switches of step 1.20 do not bring the peak to 6.0 GB.
3. Steps 1.18 and 3.5 need an answer of a set kind (hold at least the hot tables and the fourteen counts; any period for guest carts, webhook events and page versions). For steps 1.23, 2.41, 2.43, 3.7, 3.10, 3.11, 3.12, 3.19 and 3.20 either answer reaches the bar once written down.
4. Two figures nobody has yet shown. No themed store page has been measured at 90 on a slow phone (kaizenaflow.com scored 83 to 88): the shopper's A rests on the new step 2.45 finding its cuts. The builder's 1.8 MB rests on a table of cuts that step 2.30 must draw up before it starts. If either falls short, step 4.5's rule applies: the plan gets a step, the bar does not move.
5. Five figures need time after the last cut: 20 sessions, 100 commits, seven nightly runs, a week of AI use and 28 days of admin loads. Step 4.5 can call an area an A only when its figure has been read.

The critic's own `all_areas_reach_a` is false for these reasons, not for a missing step.
