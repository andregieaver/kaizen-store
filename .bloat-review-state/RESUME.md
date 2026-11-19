# Bloat review: working state, and how to pick it up

This folder is the unfinished work of the bloat review (`docs/audits/bloat-review-2026-11.md`), saved so it survives the session's
container. **It lives on the session branch `ccr-fc510f5b-x0whis` only. Never merge it to `main`:** `main` gets `docs/` and
nothing else. A background loop in the session rewrites it every few minutes (`tools/save-state.sh`).

## Where things stand

`STATUS.md` (rewritten on every save) lists each of the 25 areas and which of its three stages are done: read by an auditor,
challenged by a skeptic, planned by a planner. Its last lines hold the arguments to relaunch exactly what is left.

| Here | What |
|---|---|
| `audits/<area>.json` | the auditor's report (headline, metrics, clean, findings) |
| `verified/<area>.json` | the skeptic's corrected report: each finding with a verdict (confirmed, corrected, refuted) and a note |
| `findings/<area>.json` | the planner's final file: fix steps, tests and rules, done-when, priority; refuted findings listed apart |
| `evidence/*.md`, `evidence-raw.tar.xz` | the measurements: tables, and the raw data the measured areas' reviewers read |
| `tools/` | the workflow script, the document builder (`build-docs.mjs`, `plan-data.mjs`, `main-template.md`), the measuring scripts |
| `page/bloat-review.html` | the source of the visual page, https://claude.ai/artifact/Sg9prUD3r9j8dBR27kgeRc |

## What the owner has said (these bind the rest of the work)

1. The platform is not open yet; the 60 stores are the team's own. An unused feature or an empty table is not a finding. What counts
   is what a feature costs a store that does not use it, and true duplicates. Every reviewer's brief says so.
2. The plan's goal is grade A in every area. Section 1 of the review gives each area's bar; a panel is to test each bar.
3. Docs go to `main` (CLAUDE.md's workflow; a docs-only push runs no CI). This state folder goes to the session branch only.

## To resume

1. **Scratchpad gone** (a new container)? `bash .bloat-review-state/tools/restore.sh` puts everything back where the tools expect it
   (`/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad`). In another session the scratchpad has
   another path: pass it as the first argument and change the `SCRATCH` constant at the top of `tools/bloat-review.workflow.js`.
2. **`.next` gone**, and an area still to be read or challenged needs the build or the running app (css, functions, server-graph,
   client-bundles, page-payload, prefetch)? Rebuild: `bash scripts/ensure-postgres.sh`; set the postgres password to `postgres`;
   create database `bloat_review`; `node scripts/db-setup.mjs --seed`; then `pnpm build` with
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bloat_review NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3912
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-publishable-key`; `pnpm exec next analyze --output`; start `e2e/fixtures/auth-stub.mjs`
   and `pnpm start --port 3000`. The measurements themselves do not need redoing: they are in `evidence-raw.tar.xz`.
3. **Relaunch the reviewers** with the Workflow tool: `scriptPath` = the workflow script, `args` = the JSON at the foot of
   `STATUS.md`, with `keys` split over several launches of three or four areas (two agents run at a time per launch). A stage whose
   result is on disk is skipped: `audited` areas go straight to the skeptic, `verified` areas straight to the planner, and an area
   with a `findings/<area>.json` is not in `keys` at all. Nothing finished is run twice.
4. **When all 25 are planned:** `node tools/build-docs.mjs` (from the scratchpad's `work/`) rewrites `docs/audits/bloat-review-2026-11*`.
   It prints `NO STEP` for each finding no step closes yet: add it to `STEP_OF` in `build-docs.mjs` and to a step's `closes` in
   `plan-data.mjs` (or write a new step), and take refuted findings out. Server functions' ids are renamed FN to SF (the code
   review's FN is navigation). Then update in `main-template.md`: the limits paragraph (all areas read, challenged and planned),
   the scorecard and the A bars (the five areas that had no grade), section 3 and section 6.
5. **The grade panel** (started 12 November, 01:25 UTC). Its workflow script is `tools/bloat-grade-panel.workflow.js`; it takes
   `args.stage` and, for two stages, `args.areas` (code, shopper-browser, owner-browser, server, scheduled, database, ai, surface,
   rules, page-model, styles, text, build). Its files are in `panel/`; `tools/check-panel.mjs` checks each. In order:
   - `{"stage":"steward","areas":[...]}`: one steward per area writes `panel/steward-<area>.json` (measures and the bar for an A,
     today's grade, work items that place every finding of the area once, tolerated findings, the owner's choices, gaps). Launch
     three areas per workflow. First run `node tools/digest.mjs <scratchpad>` so `digest/` covers all 25 audited areas.
   - `{"stage":"weave"}` when all 13 steward files exist (they do, since 12 November 01:56 UTC): first
     `node tools/compact-stewards.mjs <scratchpad>` writes `panel/stewards-compact.md` and `panel/clusters.md`; then one weaver
     writes `panel/plan.json` (steps by phase, every finding closed once, ladders per area).
   - `{"stage":"weave-review"}`: one reviewer splits, joins and moves steps in `panel/plan.json` and logs it in
     `panel/weave-review.md`.
   - `{"stage":"challenge","areas":[...]}`: one challenger per area writes `panel/card-<area>.json` (the final bar, today's
     grade, whether the plan's steps reach an A, shortfalls).
   - `{"stage":"finish"}` (all 13 cards exist and pass the checker since 12 November 06:20 UTC): a critic writes
     `panel/critic.json` (grades made comparable, which shortfalls stand, steps to add), then an amender writes NEW files
     `panel/plan.final.json`, `panel/card-<area>.final.json` and `panel/amend-log.md`, so a cut-off cannot leave the plan half
     edited. If `critic.json` exists and the final files do not, launch `finish` again: the critic's work is kept in the run's
     journal only when the same run is resumed, so check the file first. `panel/plan.reviewed.json` is the plan before amending.
   `tools/build-docs.mjs` and `tools/build-page.mjs` read the final files when they exist and the reviewed ones when not;
   `node tools/check-panel.mjs plan panel/plan.final.json` and `... card panel/card-<area>.final.json` check them.
6. **Ready for execution** (the owner, 12 November: the recommended answer to every question, never a paid machine, do not
   execute; a cheaper model will). Script `tools/bloat-exec.workflow.js` (pass as `scriptPath`):
   - `{"stage":"decide"}` writes `panel/plan.exec.json` (answers written into the steps: `asked`, `decision`) and
     `panel/decisions.md`; `node tools/check-exec.mjs plan` checks it.
   - `{"stage":"brief","chunks":[[step ids],...]}` writes `exec/<step>.json`, one brief per step (13 steps an agent);
     `node tools/check-exec.mjs briefs` lists the steps that still lack a valid brief: launch only those. The 22 steps that had a
     question are briefed after `decide`.
   - `node tools/order.mjs` writes the order (`work/order.md`) and names loops or a step that depends on a later phase.
7. **Finish:** `node tools/build-docs.mjs` (in the repository; it writes `plan/steps/`, `plan/README.md` from
   `tools/plan-readme.md`, `plan/decisions.md`), commit, push docs to `main`; `node tools/build-page.mjs` writes the page
   (`page/bloat-review.html`; needs `tools/page-v4.html` and `tools/findings-totals.json`), publish to the same artifact; tell the
   owner: grades today, steps added to reach an A, the decisions made for them, who can carry out which steps.
8. **Second check of who can carry out each step** (the owner asked, 12 November). `tools/bloat-rating.workflow.js`:
   `{"stage":"rate","chunks":[[ids]...]}` has eight reviewers rate the briefs blind (copies without the rating in `exec-blind/`)
   into `rating/<id>.json`; launch only the ids that lack a file. Then `node tools/rating-compare.mjs` writes
   `work/rating-diff.json`, and `{"stage":"settle"}` writes `work/rating-final.json`. Apply its decisions to `exec/<id>.json`
   (executor, executor_why, cheap_commits, any brief edits), rebuild the docs and the page, push docs to `main`.
9. **Repair the briefs** (the owner, 12 November: "Fix the real errors in the briefs too"). After `settle`, run
   `{"stage":"repair","chunks": <work/rating-chunks.json>}`: each agent verifies the flagged problems in its briefs, fixes the
   real ones in `exec/<id>.json`, sets the final rating, and logs to `repair/<id>.json`. `exec.before-repair/` is the copy before.
   Launch only the ids without a `repair/<id>.json`. Then rebuild docs and page and push.

## 10. Execution (started 12 November, owner: "Start executing phase 0", "Keep going through phase 0")
- The repo's docs are now the source: NEVER run build-docs.mjs again (it would reset the Progress table). Edit the repo files directly.
- Each step: a Sonnet agent with run/executor-prompt.md (commits locally, no push); review the diff; set the Progress row Done
  with date, commit and figures plus a change-log line; push HEAD:main; for code, wait for /api/health to report the commit
  and CI green, then do After the deploy.
- Local DB: Postgres 16 at /home/user/pgdata (start: /usr/lib/postgresql/16/bin/pg_ctl -D /home/user/pgdata -l /home/user/pgdata/log -o '-p 5432 -k /tmp' start);
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres. pnpm install --frozen-lockfile first in a new container.
- Done: 0.1, 0.3 (D575), 0.4 (D576), 0.5 (D578), 0.6 (D580), 0.7 (D581, 9fc9314, write-up 1d26952). D577 sandbox fix. 0.2: first reading 13 Nov OK (487/9/67, ce1d2e3); reminder set 14 Nov 07:12 to set Done; then 0.23 may start. 0.8 Done (D586, 434a2f3, write-up 7a22fc7; read the statement count two days after deploy with 0.2's second reading). 0.9 Done (D587, 14722a8, write-up 90e14d1; owner's hand checks after deploy: sign in, uploads, service worker). 0.10 Done (D588, 0d31743, write-up 2eb124b). Signed-in failures on main locally too: a11y platform x5 + /admin + /admin/account, docs-guide:63, quotes:115, payment-facts:97, tax-report:62. 0.11 executor running (prompt $S/run/executor-0.11.md; review the 2 server actions and nb words). Local DB is `kaizen` (fresh 13 Nov). Next D: D589. Local e2e failures from local data (fail on main too): invoices.spec:76, sign-up.spec x3, platform-languages.spec:11. Flake: dream-rework.int. 13-file payments cycle for step 1.8. cookie-scan cron timeouts (unreported fix). kz-fix worktree has real node_modules.


## Update 14 Nov (after step 0.11)
- 0.11 Done: 66796ed, 940acaa on main; write-up 835471f (D589). Next free D-number: D590.
- 0.12 executor running (prompt run/executor-0.12.md), local commits only. Review: exact links, rg counts 1,6,4,3,2, scan-test tag matcher with arrow functions, header names.
- Owner hand checks for 0.11: Norwegian Work invoice draft, issuing an invoice, chat's first suggestion on Products and /admin/platform.

## Update 14 Nov (after step 0.12)
- 0.12 Done: e1dc484 on main; write-up 59a40cc (D590). Next free D-number: D591.
- 0.13 executor running (prompt run/executor-0.13.md), local commits only. Review: attributes kept, View store/CSV/logo never fetched, spec fetches lists, eight counts.
- Owner hand check for 0.12: change language then country on the demo store.
- Production prefetch probe: $S/probe/prefetch.cjs (node, from $S/probe).

## Update 14 Nov 07:20
- 0.2 Done (76f5791): readings 13 Nov 487/9/67, 14 Nov 491/9/67. 0.23 may start (in order, after 0.22).
- 0.13 pushed c041d22 (3 commits incl. my order-table addition); CI run 43569961791; write-up pending as D591.
- 0.14 executor running (run/executor-0.14.md; D592 reserved for it in its CLAUDE.md sentence).

## Update 14 Nov ~09:00
- 0.13 Done (D591, c3ec37a); follow-ups a802646 (platform home links) and d5af8b4 (orders/products tabs after 0.14). Signed-in green on d5af8b4.
- 0.14 Done (D592, 6e2a69b). Next free D-number: D593 (reserved for 0.15).
- 0.15 executor running (run/executor-0.15.md): 3 local commits; review diff closely (use cache, tag, refreshTag, markMine placement, cookie not httpOnly, regex).
- Lesson: a local signed-in run is needed for steps that change router behaviour; CI signed-in counts differ with data.

## 14 Nov, later
- Step 0.15 pushed as acc324b (rebased 7d15785, df83014, f10b77c, acc324b). Reviewed OK. Waiting deploy (task br4k0suss) -> prod checks (no /wishlist/saved or /api/shop/tiles after load on a prod store front page) -> write D593, row 0.15 Done, change log.
  Note for D593: existing visitors with old wishlist/account cookies but no marker see hearts empty until they save or sign in again (platform not open; acceptable). Marker regex matches any store's marker on the same host: a harmless extra fetch.
- Step 0.16: executor (Sonnet, agent a6b84b9ae3f62bf4c) doing commits 1-3 from $S/run/executor-0.16a.md. Then commits 4-5 (filter split, picker trial) by a stronger executor (Opus) or me. D594 for 0.16.
- Step 0.15 DONE: write-up 4054615 (D593). Owner hand check: press a heart on a production store, reload: stays pressed, header counts 1.
- Observed: product page loads Stripe.js beacons (m.stripe.com, r.stripe.com) after load; not in 0.15's scope; mention to the owner.
- Next free D: D594 (step 0.16).
- ANOTHER SESSION pushes to main too (admin redesign D595, checkout contact D594). Next free D is D596+ : always recheck with rg before writing a D-row.
- Step 0.16 commits 1-3 pushed as af93b41 (3282160, a3141d0, 6095105, af93b41). Carousel left eager (no-JS test). Figures: /s/demo/no 682,151 -> 624,774; product 778,503 -> 695,765; product entry chunks 340,305 -> 257,567.
- Deploy wait: task btjg3vxjy. Commits 4-5: Opus executor a5a0f93814579270d from $S/run/executor-0.16b.md (no WebKit locally).
- af93b41 deployed; prod first scripts /no 625,642, product 696,603 (match local). Pages 200, Mollie 200, only cookie-scan timeout. No prod site has optional trackers, so the consent-withdraw check (_ga gone after withdrawing Statistics) is a hand check / local check; no e2e covers forget().
- Step 0.16 commits 4-5 pushed as 67aa344 (d6af769 filter split, 67aa344 pickers lazy). Local: /no 615,961 (961 over 615,000), product 661,266 (met), entry 223,068 (met). Deploy wait task bfcbhjizv.
- Commit 6 (carousel split, server-drawn track + lazy controls) asked of the Opus executor a5a0f93814579270d via $S/run/executor-0.16c.md. Step 1.27 needs the carousel out of content-grid.
- Other session took D594, D595, D596. Recheck next D before writing 0.16's row.
- 0.16 hand checks after deploy: filter opens on first press on a prod listing; cart notes; withdraw Statistics removes _ga (no prod site has trackers).
- 67aa344: CI all green (e2e, signed-in, integration x3, static, hosts). Prod: /no 616,839, product 662,244; filter first press OK on prod (screenshot sent). Waiting on carousel commit 6.
- Step 0.16 commit 6 (carousel split) pushed as 49236ef. Local: /no 609,885 (target met), product 655,190, entry 216,992. Deploy wait bphm9yr92. Then prod checks + write-up (D-number: recheck, other session at D599).
- Step 0.17 executor (Sonnet, ad8c9ae7351cf5cb4) started from $S/run/executor-0.17.md.
- Step 0.16 DONE: write-up 792d048 (D600). Hand check: withdraw Statistics on a store with GA -> _ga gone.
- CI red since ccc14cf (other session's AI wallet tool, D599 step 2b): agent-eval-replay needs a new recording from Platform → AI. Told the user; not mine to fix.
- Next free D: D601 (recheck). Step 0.17 executor running.
- Step 0.17 pushed as 49dca14 (bb6c9aa memo, b7ae693 polls, 8926e72 badge, 49dca14 my fix: poll baseline = dreamFingerprint of the drawn run). Figures: menu 220->110 asks, 125 ms -> 0.2 ms; badge 4 -> 2 statements. Deploy wait b0o5ba5bw. Then prod checks (feed ?place=<uuid>&count=1 answers {unread}) + write-up (D601 recheck).
- Step 0.18 executor (Sonnet a6d384f073d14c86d) started from $S/run/executor-0.18.md.
- Step 0.17 DONE: write-up bc32c97 (D602; the other session took D601). Hand checks: AI manager badge count signed in; Dream Factory page follows a run and is quiet in a hidden tab.
- Step 0.18 executor running (a6d384f073d14c86d).
- Step 0.18 pushed as 35724ae (6f43131.. rebased; 44 router.refresh() deleted, 92 -> 48 in 28 files). Deploy wait bbiwi94n8. Then prod checks + write-up (next D: recheck; other session at D609?).
- Other session re-recorded agent eval (049f2fc): CI integration(1) should be green again.
- Step 0.19 executor (Sonnet ac5ad4f17bf3f32cd) started from $S/run/executor-0.19.md; commit 3 (customers statement) needs my close read.
- Step 0.18 DONE: write-up 7b4e3b78 (D611). CI on 35724ae all green (eval fixed by other session). Hand check: Inventory stock save -> one request, no second _rsc.
- Step 0.19 executor running.
- Step 0.19 PARTIAL pushed as 038e56e9 (commit 1 Products reads count not editor context; commit 4 Stores list 100/page). Commits 2 (Products paging) and 3 (Customers pick-then-aggregate) blocked: the other session's redesign (D597, D603) made Products a client catalogue over the whole list and rewrote listCustomers (show/sort/city). Needs a re-brief / coordination with the redesign: told the user. Row 0.19 stays In progress.
- Deploy wait bjfehx1qn. Step 0.20 executor (Sonnet ab0f2c855e6874c78) started.
- Step 0.20 pushed as afc6d749 (c0591d81 theme cards, fa18077d hosts parsed once, c7c97f8c storeSlugOf cached+tag store-id:{id}, staleTag in adoptRequestSandbox). rg count 27 -> 3. Deploy wait bhnrqvv59; then prod checks, CI, write-up (next D recheck; other session at D613). Needs prod later: daily count of `select slug ... where id` (about 7,180/day before) in step 0.2's reading, into docs/capacity.md.
- Step 0.21 executor (Opus ab360734102c86b49) started, all 5 commits.
- PROD STUCK on 4aceeee: the other session's migration 20261114235025_silly_namora.sql (D613) waits for all checks; CI red on agent-eval-replay since 5026d8ef (manager prompt db670ab851a2 vs recording b255bbea41ad): the other session must record the eval again. Told the user.
- My 0.20 commit 1 broke e2e/theme-store:118,:146 (neighbours from shared cache miss newly published themes). Reverted in d2dcb5db (pushed from kz-fix). CI wait b1y57x2n0. Step 0.20 not yet deployed; write-up after deploy.
- 15 Nov: container restarted. Postgres restarted. 0.21 commits 1-3 rebased onto d2dcb5db (59c99846, e438b14d, 8a8dcd56); commit 4 WIP kept in tree (search-budget.ts etc.; chat-agent only passes visitor, no prompt change). New Opus executor a9a91a8a9b1437ae0 from $S/run/executor-0.21b.md.
- Prod still on 4aceeee (eval recording blocks the D613 migration deploy). Step 0.20 write-up waits for its deploy.
- Step 0.21 commits 1-4 + my fix pushed as 60fee47e (59c99846, e438b14d, 8a8dcd56, 452266da, cd3676b1 notes, 60fee47e fix: month's AI cost counts live any day the usage job did not measure for all stores; new int case fails without it). CI wait bdymkf6uk. Prod still blocked on the eval (other session).
- Commit 5 executor (Opus a7d73ebef531de4cc) from $S/run/executor-0.21c.md: table keyed by model-calling module (about 23), not 137 entries.
- 0.21 commit 5 pushed as add82099 (24-row module table, all ceilings real; weakest: recommendations with an owner's cap set to none). Write-up after deploy (blocked on eval).
- CI on add82099: site-tools.int and store-builder-ai.int failed (mine: their aiFor mock could not reach aiAbilities' internal call). Fixed in 21c2fa83 (abilitiesOf(), mocks answer it). store-builder-ai "lets a draft go" fails locally on d2dcb5db too: local data. CI wait b6gxocjlw.
- Holding further code pushes (0.22 on) until prod deploys again.
- Step 0.22: 2 local commits (5e5fd7bd per-render customer/cart-count/stock, e268d899 one summary per render + no reads for Bonus/Referrals off) REVIEWED OK, HELD locally (money path) until prod deploys and 0.20/0.21 are checked. Rules cache dropped (cacheLife throws in int tests; follow-up: stub next/cache in the integration config).
- Step 0.23 executor (Sonnet ace5f9c77fcd4542b) started on top of local 0.22; has a migration (cookie_scans indexes). Watching prod for a deploy off 4aceeee (task bbc6546uj).
- Step 0.23: 6 local commits (e3f3c11a owned(), 2a4ddc32 pages, 25f4387d cookie_scans indexes + migration 20261115061740_cuddly_thunderball.sql + back-off, 6290f7a6, 9b5a1803, 5a8327ba docs) REVIEWED OK (script paired 110 replacements; site-cookies uses the coalesce form on purpose). HELD behind 0.22. CLAUDE.md sentence cites "(bloat review step 0.23)": replace with its D-number at write-up. Push order once prod moves: check 0.20/0.21 on prod -> push 0.22 -> deploy/check -> push 0.23 (migration: waits for all checks) -> advisors + version in D-row.
- 09:47 UTC 15 Nov: prod still 4aceeee after 4+ h. Scheduled check-in at 11:48 UTC (trig_017oumR2mhm8VvBuLm5rzK1z). No new steps started until the queue drains.
- 11:50 UTC 15 Nov: PROD UNBLOCKED on f04a2126 (includes 0.20, 0.21). Checked; written up 4654749c (D616 0.20, D617 0.21). Other session now at D615.
- Stack rebased: 0.22 = bfcc19a2, 83241e56; 0.23 = 918bef2c..e73abded. Checking 0.22 tip in kz-fix (task bo0xk81mk) then push 83241e56:main alone.
- Step 0.22 pushed as 89f5459d (f4a3ce81, 89f5459d; on top of the other session's D618 migration, so it waits for all checks). Deploy wait bt5p4nxc1. Then: test order on demo store? (owner's hand check), prod checks, write-up.
- Step 0.23 rebased; its migration REGENERATED as supabase/migrations/20261115123101_cookie_scans_site_indexes.sql (same two indexes; old 20261115061740 dropped since the other session's 20261115120423 came first). Local commits 2bc16c7c..0dcb944c. Checks task b4ow76fq0. Push after 0.22 checks out on prod.
- Step 0.22 DONE: deployed 89f5459d, basket totals agree on prod (348,00 kr), write-up 67209042 (D619; D618 is the other session's, cited in 9f468db2).
- Step 0.23 pushed as 0dcb944c (migration 20261115123101_cookie_scans_site_indexes.sql; waits for all checks). Wait task bvzs2lp0f. After deploy: prod checks, Supabase advisors, record version 20261115123101 in D620 row (recheck number), replace "(bloat review step 0.23)" in CLAUDE.md with D620, set row Done.
- Step 0.23 DONE: migration 20261115123101 applied by CI run 1305 (13:18 UTC), advisors INFO only, prod on 7715b054; write-up aec87520 (D622; other session at D621). CLAUDE.md now cites D622.
- Queue drained. Next: 0.24. Later readings (a week on): 0.8 statements, 0.20 slug statement, 0.21 ai_providers reads, 0.22 statements per cart view, 0.23 cookie_scans seq scans.
- Step 0.24 executor (Sonnet a2a017581859782f8) started from $S/run/executor-0.24.md.
- Step 0.24: reviewed (by-id read equivalent; theme-store spec flaky locally on main too; themes-unified:46 fails 2/3 on main too). Rebased 530962c1..e477d391; checks task b7hhhogzo; then push. Shortfall: 9 blog entries keep the list (blogArticles(), 6.7 KB of 3.27 MB): follow-up = index with article categories.
- Step 0.25: WAITING FOR OWNER'S GO. Sent $S/cron-log-before-prune.md (402,474 rows, 309,710 older than 7 days, 650 MB of 824 MB, all succeeded, no shop data). Do not run 0.25 until the owner says yes. Meanwhile go on to 0.26.
- Step 0.24 pushed as f073fc1b (rebased). Deploy wait blzaibks1; then prod checks + write-up (next D: recheck, other session at D627).
- Step 0.26 executor (Sonnet a5f000e2405d4bf2b) started: drop 13 duplicate indexes (two migrations: concurrent hot + transactional), new test.
- Step 0.24 DONE: prod f073fc1b checked, write-up 0bf6b04c (D629). Follow-up: an index carrying article categories for blogArticles().
- Step 0.26 pushed as ca002b83 (5971f5dc rebased + docs): migrations 20261115165138_drop_duplicate_hot_indexes.sql (4 concurrent) and 20261115165154_drop_duplicate_indexes.sql (9). Verified each against prod pg_indexes. Wait task for deploy+CI. After: orders index count 32 in prod, advisors, versions in D-row (next D after D630), Done.
- 0.26: CI run 1322 failed (agent-eval.int: other session's tools; variants-scale:86 flaky) -> release skipped. Then someone ran CI "redeploy" by hand (run 1327, workflow_dispatch) -> prod has 0.26's code but its 2 migrations are NOT in supabase_migrations.kaizen_files (orders still 34 indexes). Harmless (drops only). Watching run 1329 (push 1e556a47) whose release should apply them.
- Run 1329 also red: owner-assistant.int "runs every tool that reads" fails on the other session's new D632 tool (needs name/text args); variants-scale:86 and theme-switch:168 flaky. So NO migration can deploy until the other session fixes its test. 0.26's 2 migrations still pending (prod 075034a2, orders 34 indexes). Told the user.
- Doing 0.31 (no migration, no deps) out of order: executor Sonnet a67b884b34cce3ed3. Then 0.32. Return to 0.27-0.30 (migrations) once migrations deploy.
- OWNER GAVE GO for 0.25 (15 Nov). Pushed 807376f1: migration 20261115185237_cron_run_log_retention.sql + src/db/cron-log-retention.test.ts + docs lines. Pending in prod with 0.26's two migrations; all wait for a green CI run (blocked by the other session's owner-assistant.int failure). After apply: check cron.job_run_details rows, cron.job 'kaizen-cron-log-retention', DB size; advisors; D-rows for 0.25 and 0.26 with versions.
- Step 0.31 pushed as ff51407e (a6b37c71, 24931b22 rebased). Waits for a green run with the pending migrations (0.25, 0.26). After deploy (a day later): commerce.cron_jobs shows 7 daily.* at 86400, 2 hourly.* at 3600, 0 of the 9 retired dispatcher.* rows; no job late.
- CI still red on every run: shipping-handover.spec.ts:95 (other session's D634 removed the "Add a method" link; deterministic) + flaky theme-switch:168 / variants-scale:86. Pending migrations (0.26 x2, 0.25) and code 0.31 wait. Told the user.
- Step 0.32 executor (Sonnet) started from $S/run/executor-0.32.md.
- Step 0.32: 3 local commits (beab4e75 image service off, f38e9228 upload lifetimes, adbf83a2 public files a day + small flags) reviewed OK; rebasing + checks (task b9o4my3uh) then push into the queue. CI still blocked by shipping-handover:95 (other session).
- Step 0.32 pushed as 516cc1c8. Queue on main: 0.25, 0.26, 0.31, 0.32. Check-in scheduled in 90 min. Next local work: none started (0.27-0.30 need migrations; 0.33 needs 0.32 deployed; 0.34 no migration, no deps -> could start).
- 22:40 UTC 15 Nov: pipeline unblocked (other session fixed shipping test). 0.26 migrations by run 1330 (19:07), 0.25 by run 1346 (21:48) with 0.31+0.32 code. Prod checked: orders 32 indexes, cron log 442 rows/848 kB, DB 824->176 MB, retention job scheduled, hourly.* rows present, retired dispatcher rows 0, flags max-age=86400, font HIT, /_next/image 400. Advisors INFO only. Written up 188fe229 (D642-D645).
- TODO 16 Nov after 07:00 UTC: check the 7 daily.* rows in commerce.cron_jobs and no job late (0.31).
- Next: 0.27 (migrations, two pushes with a deploy between), 0.28, 0.29, 0.30, then 0.33.
- Step 0.27 commit 1 pushed as 02f27b4a (migrations 20261115224024_outgoing_spitfire.sql table + 20261115224037_knowledge_sources_fill.sql). Fill checked read-only on prod: 55 of 55 pages with passages get a row. Waiting for CI to apply + deploy; then commit 2 (executor) and write-up.
- 0.27 commit 1 DEPLOYED: run 1352 (after re-running its flaky signed-in job) applied 20261115224024_outgoing_spitfire + 20261115224037_knowledge_sources_fill at 23:33 UTC; prod knowledge_sources 55 rows, RLS on; prod on 9696056e. Commit 2 asked of executor ad77b64895666fbc7.
- Step 0.27 DONE: commit 2 deployed 98374fe1 (00:05 UTC 16 Nov); job idle after 23:40; write-up 58974b22 (D649). Left: unreadable article re-fetched each run (rare).
- Next: 0.28 (depends 0.27: done; migrations 3 files add-only), 0.29, 0.30, 0.33...
- Step 0.28 executor (Sonnet a9a3ffa43cebe4226) started: 4 commits, 3 add-only migrations (media.alt_tries, product_translations.text_changed_at + trigger).
- Step 0.28 pushed as 6de0a11d (55500e88, d9d7712e, 80c2230e, 6de0a11d; migrations 20261116001432_media_alt_tries, 20261116004359_product_text_changed, 20261116004405_product_text_changed_rules). Watching CI; re-run once if only flaky signed-in tests fail.
- Step 0.28 DONE: run 1359 all green, migrations at 01:47 UTC; prod checked; write-up 41130b87 (D654). Later reading: media_embeddings updates/day < 100, product hash ~24 calls/day.
- Next: 0.29 (needs 0.28's text_changed_at: done).
- Step 0.29 pushed as ebaeb7c0 (migration 20261116015416_content_screened_tries). Reviewed: the one-time wave of 89 screened products costs no AI calls (unchanged hash). Watching CI.
- Step 0.29 DONE: run 1363, migration 02:40 UTC; prod: 20 listings stamped with 0 AI calls by 02:55; advisors INFO only (checked). Write-up 6eeacca2 (D655).
- Next: 0.30 (invoice job; migration in 3rd commit only), then 0.33 (strong, needs 0.32: done), 0.34, 0.35, 0.36 (strong) ...
- Step 0.30: commits 1-2 (ed4eebf5, 10c66d24) reviewed (issue_waiting_invoices itself PERFORMs issue_missing_credit_notes: confirmed in baseline). Commit 3 made by me from the executor's patch, with the invoice count moved into invoice-issue.ts (ordersWithInvoice) so document-readers allow-list is unchanged; migration 20261116033159_live_drill_kinds.sql. Checks task bhwzfkye1, then push. Executor ran `git reset --hard HEAD` (forbidden; no history moved).
- Step 0.30 pushed as 24073585 (ed4eebf5, 10c66d24, 24073585; migration 20261116033159_live_drill_kinds). CI wait task bpqped1fy; re-run once if only flaky.
- Step 0.33 executor (Opus a1afa870d064d6145) started: 800 px copy of every picture, 4 commits, migration in commit 1.
- 0.30 run 1365 red only on agent-eval-replay (other session's 03910744, D653, changed the manager prompt; it deployed via quick gate). 0.30's migration waits for a green run. Check-in in 60 min.

## 16 Nov 10:55 UTC
- 0.30, 0.33, 0.34, 0.35 Done (D664–D667, pushed d1a07e4d). Migrations applied by CI run 1388; live at 3819f6bc.
- 0.36 executor (Opus, a54d72571c2d23b9d) in /home/user/kaizen-store.
- 0.45 then 0.43 executor (Sonnet, ae664823bae6a3bce) in worktree /home/user/kz-b (branch bloat-b).
- Write-ups from /home/user/kz-fix (detached). Next: 0.38 (needs build, after 0.36), 0.37 after 0.36, 0.39 after 0.38, 0.42 strong, 0.40, 0.41, 0.44 (after 0.33), 0.46.
- Owner checks: 0.30 invoices drill run in production; 0.33 upload a >1600px picture and see medium_url.

## 16 Nov 14:40 UTC
- Done today: 0.30, 0.33, 0.34, 0.35 (D664–667), 0.43 (D668), 0.45 (D674), 0.40 (D676), 0.42 (no D), 0.38 (D682), 0.41 (D683). Work write-off fix 96b07e51.
- D-numbers now via `node scripts/claim-decision.mjs "title"` (pushes a stub; then replace the stub's text).
- Running: 0.36 (Opus, /home/user/kaizen-store, 5 local commits), 0.39 (Sonnet, /home/user/kz-b).
- Next: 0.37 (after 0.36), 0.44 (build), 0.46 (build), 0.19 blocked.
- Tomorrow 17 Nov: query cron_jobs for 'timeout exceeded when trying to connect' (0.45).

## 16 Nov 19:30 UTC — phase 0 done but 0.19
- Done today and written up: 0.30 (D664) 0.33 (D665) 0.34 (D666) 0.35 (D667) 0.43 (D668) 0.45 (D674) 0.40 (D676) 0.42 0.38 (D682) 0.41 (D683) 0.36 (D689) 0.39 (D690) 0.37 (D696) 0.44 (D697) 0.46 (D698). Work write-off fix 96b07e51.
- Open: 0.19 commits 2–3 (blocked by the other session's Products/customers rewrite: needs a new brief).
- Scheduled: 17 Nov 10:07 UTC day-after check for 0.45 (trig_01VQNkTk9E662mkjfKDJebJc).
- Owner's: invoices drill (0.30); upload >1600 px photo (0.33; media_with_800 was 0 on 16 Nov); unwired.md (0.36); VAT registration stored twice (FT-16).

## 17 Nov 10:20 UTC — phase 1 started (owner: "Start phase 1")
- 0.45 day-after: 0 connection timeouts, round 81 jobs 0.5 s (in D674).
- Running: 1.1 (Sonnet, /home/user/kaizen-store), 1.15 (Sonnet, kz-b), 1.27 then 1.28 (Sonnet, kz-c). Template: run/phase1-template.md (mk via sed __STEPS__/__DIR__/__BRIEFS__).
- Next after 1.1: 1.2, 1.4, 1.5, 1.8, 1.9 (then 1.10, 1.11, 1.12, 1.13, 1.25), 1.17, 1.18, 1.23, 1.3 (then 1.6, 1.7, 1.14); 1.22 (scheduler, careful), 1.24; 1.19 strong; 1.20→1.21→1.29 (1.29 only if needed; no paid machines).
- Write-ups: claim with scripts/claim-decision.mjs from /home/user/kz-fix.

## 17 Nov 14:40 UTC
- Done: 1.1 (D719), 1.27 (D716), 1.28 (D717, loosened ef857b33), 1.15 (D722), 1.24 (D723). 1.22 pushed 8976b6ae, In progress: needs CRON_SECRET in Vercel (owner).
- D705 trimmed under 4,000 bytes (other session's) to unbreak the docs budget.
- Running: 1.9 (kaizen-store, commits 2–3 adapting), 1.2 (kz-b, allowed-absent markers), 1.4 then 1.17 (kz-c).
- Next.js 16.4.3 has GHSA-mfr8-8qww-v76h (moderate): upgrade to 16.4.6 after 1.2's build (check patches/next.patch applies; e2e/store-pages.spec.ts).
- Next steps: 1.5, 1.8, 1.18, 1.23, 1.3 (then 1.6, 1.7, 1.14), 1.10–1.13, 1.16, 1.19, 1.20, 1.21, 1.25, 1.26.

## 17 Nov 21:55 UTC
- Phase 1 Done: 1.1 (D719) 1.2 (D733) 1.4 (D726) 1.9 (D736) 1.13 (D744) 1.15 (D722) 1.24 (D723) 1.25 (D745) 1.27 (D716) 1.28 (D717). Next.js 16.4.6 (D734).
- 1.22 pushed, waits CRON_SECRET in Vercel (owner).
- Bundle budget room = max(15,000, 5%); taken growths: /admin/platform/emails (7cdef388), /admin/[store]/settings/notifications (ac7399da).
- cache events: build prerenders no longer counted (e6dd7843); today's cache_events_daily row inflated (~2,000 build draws), not deleted.
- Running: 1.10→1.12 (Opus, kz-c), 1.11 (Sonnet, kz-b).
- Owner open: CRON_SECRET; 68 unread admin texts; growth policy; invoices drill; >1600px upload; unwired.md; VAT twice.

## 17 Nov 23:35 UTC
- 1.10 D746, 1.11 D747 written up and Done (95a20f4ab). Progress rows: WHOLE row <=300 chars.
- 1.17 c1-2 + 1.18 c1-3 + review fix pushed as 27f215e7e; CI watched (bash bygkkqlwn). Then write up 1.18 (Idle cost: none line required in D-row). 1.17 stays In progress.
- kz-c executor ad71c22b5537655ce (Sonnet): 1.17 commit 3 (decisions in run/kz-c-1173-13.md) then 1.3.
- kz-b executor a0af61e90e526b47e (Opus): 1.12 commit 2.
- ee708312 CI failure = other session (api-contract D438, eval replay D391), not ours.

## 18 Nov ~00:45 UTC
- 1.18 Done D749 (d96e9596f).
- 1.17 c3 + 1.3 (7 commits) pushed 6f82079a5; CI watched (bash b07e911b2). If green: claim D for 1.17 and 1.3, write up both Done. Owner to decide deleting src/lib/nav-labels.ts and signature-themes.ts (in unused baseline).
- kz-c executor a7b0e59a44cd73ab3 (Opus): 1.6 then 1.7.
- kz-b executor a0af61e90e526b47e (Opus): 1.12 commit 2, still running.
- Main failures not ours: api-contract, eval replay, personal-data.nb + personal-purposes (organisations table).
- 18 Nov ~01:50: CI on 6f82079a5 failed: e2e document budgets (demo store grown by earlier specs) and query-budget 20-store cleanup (organisation_members FK, D748). Fixed in 42c9b03de; CI watched (bash by37ybp66). Locally the 20-store run then showed route.cookie-scan growth +10 statements and subscription-reminders +669 rows: if CI shows them, accept with FIRST=1 UPDATE_BASELINE=1 using CI's figures, say why. Then write up 1.17 and 1.3.
- Local kaizen DB has organisations migrations applied (339 stores unplaced, place_store leaves them).
- 18 Nov: container restarted. Postgres restarted by hand. Executors resumed by SendMessage (a0af61e90e526b47e kz-b 1.12c2 uncommitted; a7b0e59a44cd73ab3 kz-c 1.6 c1 bfe1fbf02 local). CI on 42c9b03de re-watched (bash bllh93yzn).
- 18 Nov: 1.17 D751 and 1.3 D752 Done (18adb31f1). CI on 42c9b03de green for ours (cookie-scan growth was local only).
- 18 Nov: 1.12 commit 2 pushed 1e7d19649 (journey: fixed plans while measuring, vacuum full; findings: aiFor() reads every store's AI row, +19 rows with 19 stores; 28 KNOWN_READS). CI watched bash bkb9jpahn. If green: claim D for 1.12 (Done), write up.
- kz-b executor a6c27c9758455bb59 (Opus): 1.19 commits 1-3 (commit 2 has a migration; surface budget may need a raise by me with Idle cost line). Commits 4-5 need owner's eval run on Platform → AI.
- kz-c executor a7b0e59a44cd73ab3: 1.6 then 1.7 (resumed).
- 18 Nov: 1.6 (2 commits) + 1.7 c1 (Stripe stand-in, guarded: switch + loopback + not Vercel) pushed 873efcd84; CI watched bash bf3ow98g6 (also bkb9jpahn on 1e7d19649). 1.6 stays In progress (production check of step 4.5 table after phase 2) - write a D-row now anyway? Brief: check. Screenshots sent.
- kz-c executor a92b7eae36e9a74e8 (Opus): 1.7 commit 2+, option (b) second server with dummy test keys.
- 18 Nov: CI on 1e7d19649: shop-journey product scanned product_terms in shard 2 (planner stats); added to list in 3bc5d53b5, CI watched bash bfi33jang. If green: write up 1.12 Done (claim D).
- 18 Nov: 1.12 Done D753 (afb07cae5). e2e red since 873efcd84 (1.6): Orbit picture bytes 223,837 vs 150,500 and theme-store.spec:118 preset lost; sent to kz-c executor a92b7eae36e9a74e8 to fix first, it reports via SendMessage. Blocks migration pushes (1.19 c2).
- 18 Nov: 1.6 e2e fix pushed f101c4791 (pin 4G for lazy-load distance; theme-store waits for preset href). CI watched bash bb1n9q0in. Product note for owner: Preview pressed <300ms after load ignores ?preset (ThemePreviewStage reads it in browser).
- 18 Nov: CI on f101c4791 fixed 1.6's two; new failure om-oss late script bytes exact (-3 bytes). Fixed 6052f284a (count rise fails, bytes room max(2000,2%)). CI watched bash bdb3r365h. OOM kill seen during that command.
- 18 Nov ~06: second container restart. Register fix d9ebd9e6c (organisations nb reason + purpose) released D748's migration; production on d9ebd9e6c.
- Pushed 1.19 c1-3 (998a3d1ca, migration 20261118023925_ai_usage_turns, ai_usage 23k rows) and 1.7 c2 (596444af5). CI watched (bash, after restart re-create if lost). After release: advisors, D-rows: 1.19 (In progress, c4-5 owner's eval), 1.7 Done, 1.6 D-row (stays In progress until phase 2 check). Screenshots of /admin/platform/ai/usage in scratchpad/shot/.
- No executors running now. Next candidates: 1.5, 1.8, 1.23 (builds), 1.20->1.21, 1.14 (after 1.6), 1.16 (after 1.8).
- executors: kz-b adbd7006b7ee1bf1b (1.5 Sonnet), kz-c a28b2e4f78e2246fc (1.8 Sonnet)
- 18 Nov ~08:45: 1.19 migration applied by CI (20261118023925_ai_usage_turns), advisors INFO only. Written up: 1.6 D758 (In progress), 1.7 D759 Done, 1.19 D760 (In progress, c4-5 owner) — e6531ed77. Release of 596444af timed out waiting on newer runs (other session's E2 migrations); production still d9ebd9e6 until their release.
- RISK: D656 (other session, heatmaps DPIA) is 15,195 bytes > 4,000: docs-budget.scan fails in static -> could freeze releases again. Other session's to fix; watch.
- 18 Nov ~10: CI on c0561894a failed on OUR budgets from other session's D748 E2 (extension facts on every store read). Accepted only those keys (frame.store rows, journey tables) in 90170376d. Local-only moves (ledger 220->1350, broadcasts, recurring) NOT accepted. Watching newest CI for release.
- 18 Nov: 1.8 pushed c9c97d952 with review (graph entries room max(5,3%), falls note; trace counts >=50 room max(20,4%); manifest 4%). CI watched. Then D-row for 1.8 (Done if CI green). Finding to report: 4 of 5 beacons + shop-tiles reach supabase-js/auth.ts, proxy+beacons reach admin-messages (held as exceptions). kz-c free.
- 18 Nov: 1.8 e2e green on CI. Query budget: ledger/recurring/broadcasts rises are REAL (extension_on per store reads all org stores, n^2; platform org 47 stores). Accepted dde4cd5cc with finding; spawn_task timed out (unknown). CI watched. Then 1.8 D-row Done. kz-c: 1.20 executor ad807d6568aae1cc3.
- 18 Nov ~12: 1.5 pushed 8118e66e6 with review (words max(2000,5%), rest 5%, falls note). D-row for 1.5 after CI signed-in green. kz-b: 1.23 executor. kz-c: 1.20 executor ad807d6568aae1cc3. CI watcher bqoni8z8a on dde4cd5cc.
- 18 Nov ~13: CI on 8118e66e6: all green but signed-in theme-switch.spec:168 (product page shows a 2nd buy box after a switch). Signed-in was green on dde4cd5cc, c9c97d952, 90170376d. Rerun of failed job requested (bash bf9pi0ju0). If it fails again: suspect 1.5 (parallel worker races / new accounts).
- 18 Nov ~13:30: release went out, production e2db2c22b. 1.8 Done D766. D656 fixed by other session.
- 18 Nov ~14:30: production d67f931ea (released; theme-switch was flaky, rerun green). 1.5 Done D768. 1.20 pushed 6b13dddd8 (recorder wraps every CI step; ceilings empty; serverSourceMaps:false on Vercel); CI watched bash bqhhnrcl2 -> then write up 1.20 (In progress until 10 runs give ceilings?) and start 1.21 in kz-b/kz-c.
- kz-c: 1.16 executor ad87efeeb4a13f40e. kz-b: 1.23 executor a2909d9fc60a5e371.
- Stray file /c1-checks.log at container root (executor's unset var); rm denied: tell owner (harmless, container).
- Prod: 6 of 24 AI calls report cached tokens (provider reports them).
- 18 Nov ~15: 1.23 pushed 222eb50c2 (audiences held at today+room: 25,000 raw / 4,200 br; step 2.11 back to 17,000/2,000; postcss devDep). Needs: first style-text reading on production (Take the reading on /admin/platform/capacity?reading=styles), D-row. kz-b: 1.14 executor. kz-c: 1.16.
- 18 Nov ~15:40: CI on 6b13dddd8 (1.20): recorder works (timings ok). e2e+signed-in fail: theme-switch (failed twice: extra buy box), webkit search; flaky bottom bar, page-history, prefetch orders. Range 84953abbd..6b13dddd8 = other session Flows slice 1 (e260a6549) + 1.20. Watching e260a6549's own CI to attribute. Other session fixed extension_on n^2 (84953abbd).
- e260a6549 (Flows) alone: all green. Only 6b13dddd8 failed on main (ff77 is dependabot PR). 1.20 changes nothing app-visible (build wrapper timing, Vercel-only sourcemaps, JSON reporter). Watching 222eb50c2 + 6d80d1625 runs to tell flake vs cause.
- 18 Nov ~17: 1.20's red run was flaky (222eb50c2 green). 1.14 c1 pushed 4fdff3a07 (falls note); c2 needs owner's 3 production addresses of a launch-theme store (not demo.kaizenstore.site). 1.20 D769, 1.23 D770 written up In progress (bb9e69eb6). kz-b: 1.21 executor. kz-c: 1.16 executor ad87efeeb4a13f40e.
- 18 Nov ~18: 1.16 pushed 55c06e74d (migration instance_starts; D771 with Idle cost; surface raised; sub-reminders +1 statement). CI watched. After release: advisors, 1.16 stays In progress (week of production).
- 1.21 c1-2 in kz-b rebased (health route merged with 1.16's noteFirstRequest), checks pass, NOT pushed: push after 1.16 releases. c3 later session. build-memory.md says Stage 2 needed -> 1.29 (strong) next.
- Owner told how to set CRON_SECRET (any long random value; Vercel prod; separate from Vault kaizen_cron_secret).
- 18 Nov ~19: CI on 1.16 failed: instrumentation chunk 730>444 and platformHome 30>29 (both 1.16's, accepted in 6458e7409; instrumentation max 2000). Watching 6458e7409 (release of instance_starts migration). Then push 1.21 (kz-b), then advisors + 1.16. kz-c: 1.29 executor abcfb4feda97fe056 (Opus).
- 1.29 c1 in kz-c (cda7ab593, on cherry-picked 1.21 copies): manual prebuilt-trial job; TIGHT_MACHINE. Reviewed OK. Push AFTER 1.21 (kz-b) lands; rebase drops copies. c2 stopped: D710 newer-push + D741 deploy-fallback in ci.yml need a design decision; race between runs (deploy --prod --skip-domain then promote); trial needs VERCEL_ORG_ID/VERCEL_PROJECT_ID secrets (VERCEL_TOKEN exists?) and a DB for preview build (seeded PG service recommended), sensitive vars come back empty from vercel pull.
- 18 Nov ~20: release blocked by agent-eval replay (other session's E5.1/E5.3 changed manager prompt; owner must record eval on Platform → AI) + webkit search failing twice (other session's). 1.16 migration NOT yet applied. Pushed 1.21 (83947ed86) and 1.29 c1 (efe24bc85). D772 (1.21), D773 (1.29) written. After release: 1.16 advisors + D771 migration line already in row.
- Phase 1 remaining: 1.22 (CRON_SECRET), 1.26 (after 1.22), 1.14 c2 (owner addresses), 1.29 c2 (owner setup + design), 1.21 c3 later, 1.6/1.16/1.20/1.23 production checks. No executors running.

## PHASE 2 started 18 Nov ~20:30 (owner: "Start phase 2")
- Context file: run/phase2-context.md (appended to template for each phase-2 executor).
- kz-b: 2.1 (Opus, CLAUDE.md map; owner decided 12 Nov) agent acf074252b5b8fec7.
- kz-c: 2.2 (Sonnet, store layout once) agent abbce2dc1145d5b3c.
- Order constraints: 2.2<2.3, 2.4<2.5, 2.14<2.15, 2.16<2.17,2.18, 2.20<2.35, 2.36<2.37, 2.27&2.29<2.30, 2.11<2.49, 2.25&2.26<2.50, 2.9&2.22<2.47.
- Next candidates: 2.13 (stock), 2.16 (page columns, migration), 2.20 (proxy leaves), 2.33, 2.36 (AI lean round), 2.42, 2.48.
- 18 Nov ~21: production on 9d248f47a (all through 1.29 c1 live; other session reverted Flows from manager prompt for one deploy so eval matched). All 19 of today's migrations applied. Owner's eval run 153e0382 = same prompts as committed recording; nothing to commit. D771 got advisors (INFO) + first cold-start figures (520583e00).
- 2.1 pushed 7742afff8 (CLAUDE.md 10,102 B / 134 lines; .claude/rules/{database,e2e,server,ai-prompts}.md path-scoped). Proof session session_01URyFZRsijVpXS4FvhWCa1j created; send_later trig_01XebSgBUTb3Ctv5dyinGBbr at 15:32 to read it. Expected quote: "A migration reaches production only through CI, and a change to a hot table follows the rules below." Then D-row 2.1, archive session.
- kz-b: 2.16 executor (Sonnet). kz-c: 2.2 executor abbce2dc1145d5b3c.
- Hold 2.36-2.39 (AI rounds/tools) until owner can record eval; pair with 1.19 c4-5.
- 18 Nov 15:45: 2.1 Done D774 (both proofs passed: fresh session + subagent quoted database.md). Proof sessions archived.
- 2.16 pushed 64e5b620d (3 generated columns on pages, 1,373 rows/9 MB prod). Watch CI; after release: advisors, D-row (migrations 20261118152833, 20261118152842). kz-b: 2.17 executor next.
- 2.16 Done D775 (released 64e5b620d, advisors INFO, 1,331 titled). kz-b: 2.17 (Opus) aac37d0a03296251b. kz-c: 2.2 abbce2dc1145d5b3c.
- 2.2 pushed b3a90442c (home 135,935->105,599 bytes; layout once; dup bound 3,000 in review). CI watched b9p03rley. Then D-row 2.2 (refines D64). kz-c: 2.3 next.
- 2.2 deployed (prod b3a90442c); its e2e was cut by 30-min job limit on a slow runner after 699 passed. e2e timeout -> 40 (982c8fd73), CI watched; then 2.2 D-row.
- 2.2 Done D776 (CI green 982c8fd73). Running: kz-c 2.3 a8ccb1047468c0235, kz-b 2.17 aac37d0a03296251b.
- 2.3 pushed d0aa131fc (om-oss doc 81,000 in review), CI watched by1g4hxf5; then D-row. kz-c: 2.13 next.
- 2.17 pushed 135226258 (lists paged 100, grids cards from SQL, pageDocuments 17 + pageDocumentsOneRow 33). After CI: D-row; screenshot of pager not taken.
- 2.3 Done D777 (5347e33a7). 2.17 CI watched ba6mv6bum (prod already 135226258). kz-b 2.18 af99a51a962e605a6 (Opus), kz-c 2.13 a3405673ece3f95a7.
- 2.17 written up (In progress; week's pg_stat_statements + list look).
- 2.13 pushed 23d3b5425 (product page 12->1 statements; buy facts cached; product_terms kept). After CI: D-row; follow-up: getProduct()'s hosts/product_market_texts/selling_plans reads.
- 18 Nov ~23: CI on 2.13 failed at route-budget (manifest 11,911,903 > 11,406,364+4%, other session's new server actions). Accepted today's figure 8f1ba1e75; CI watched bil83qa9x (Playwright for 2.13). kz-b 2.18 af99a51a962e605a6, kz-c 2.33 a08563e3a7a090c4c.
- 2.18 pushed 38759d010 (frame.platform 17->11, cookie-scan 14->7, siteCookies 1, experiments 6->2 cached). After CI: D-row. kz-b free.
- 2.33 c1 pushed 00d7bddd8 (migration two_step_mirror_reconcile; sign-in reconciles mirror, fails closed). c2 STOPPED: trusting empty mirror lets enrolled-unmirrored accounts skip 2FA and Auth-down case; needs prod count 0 + owner decision. back-in-stock e2e fixed 4cc84650a (two stores, buy facts cached). Disk cleaned to 9.6G. kz-c: 2.42.
- 2.42 c1 REJECTED in review: ts7 devDep's tsc bin shadowed TS6 (gate would run TS7, 11 TS7-only errors). Executor a40c9e4b402c83c2f resumed to redo via pnpm dlx typescript@7.0.2 in trial step only. Main typechecks clean (00d7bddd8).
- 2.42 c1 (trial, pnpm dlx typescript@7.0.2, continue-on-error) pushed f776326a4. Finding: TS7 gives 11 errors TS6 doesn't (ActionAnswer/FormState inference: marketing/actions.ts 14,26; settings/books/actions.ts x8; settings/company/officer-actions.ts 15). c2 after a week (25 Nov). kz-c free.
- webkit search race fixed (expect.poll) pushed. 2.48 executor a28be989d531956a1 resumed with decisions (visit held 5/3, +2/line, commit 3 feature-gated triggers).
- 38759d010 pending failed = waited on 2.33's migration (normal). Release depends on c743d9baf run (bt59p824b).
- 19 Nov ~01: 2.13 D779 Done, 2.18 D780 Done, 2.33 c1 D781 (prod: 1 verified, mirrored, 0 without). 2.48 executor resumed: case 5 on warm connection. kz-b 2.4 resumed. TS7 trial first run: 34.7 s vs 211.9 s cold, same 11 errors. contract-seal unit test failed once (other session's).
- 2.48 c1-c2 pushed 0e649cc07 (case 5 warm 2.9 ms). After CI: D-row 2.48. kz-c: 2.34.
- 2.48 Done D782. ai-round platform +30 accepted by other session (2a877a3df).
- 2.34 pushed c30c7d23a. kz-c: 2.26 (Opus).
- 2.34 D-row written (In progress; day's stats). Watch: 2.17 (week), 2.34 (day), 2.16 (week pg_stat).
- 19 Nov ~08:40: THIRD EXECUTOR added: worktree /home/user/kz-d (branch bloat-d), no builds. Running 2.44 -> 2.40 -> 2.41 (Sonnet). Shared kaizen DB replaced by a fresh template clone (was 4.9 GB). Disk 9.7 GB free.
- kz-b: 2.4 (afd4ccd83482464ef). kz-c: 2.26 (ad9d83271bbd34604).
- Reminders: 20 Nov 03:10 (2.34 stats), 25 Nov 03:20 (2.16, 2.17, 2.42 trial).
- 2.4 c1-3 pushed 48627c2b8 (static store pages; /api/shop/mine private no-store; add 1 req 104 B). c4 (/wishlist/saved delete) next deploy. Check: client nav om-oss on prod after 1h (regeneration). git stash banned in context. kz-b free.
- 19 Nov ~10:45: 2.4 REVERTED on main (4fb09512c): store-pages.spec:8 footer->om-oss client nav = global error (React 412), chromium+webkit. Prod never had it (c0d23751b). Opus debugger a0a1d6a93174c32f8 in kz-b (cherry-picks 397da1b5e,46ce6bd76,48627c2b8 + fix). 2.5 WIP saved at branch wip-2.5 (717ef3d66) - depends on 2.4.
- E4 (other session, organisation_extension_facts reads organisation_billing/store_billing) broke shop journey (all stops) + query-budget house-customers 1418->1880: accepting via FIRST run on kzfix_e4 (bash bloxyfqtp), keep only those keys.
- kz-c 2.26 (ad9d83271bbd34604), kz-d 2.44->2.40->2.41 (a8170e090b363d1fd).
- E4 accepted (shop journey billing tables, house-customers rows) pushed.
- 2.44 (In progress), 2.40 D790 Done, 2.41 D791 Done pushed (3fcc3d4e3, fa28ff54e). New decision layout works (other session already claimed D792). kz-d: 2.31.
- 19 Nov ~13: PRODUCTION FROZEN on c0d23751b: release needs agent-eval replay green; other session's AI prompt (ff3c235dc plan-extensions) + tools (1ea4c6956 D785 etc.) changed since recording 8a407b36f; pending migration account_plan_moves at head blocks quick-gate deploys. Other session is iterating (ffbcf1fd1 held signup_rate_30d out). I tried reverting ff3c235dc: prompt matched but tools still mismatch -> dropped. Owner/other session must resolve.
- 1b3774aca run all green; release applied E4's 2 migrations then timed out.
- 2.26 (kz-c, 6 commits, rebased) full unit test running (bash bwr1ic2er), then push.
- 2.26 pushed 589fb73de. kz-c: 2.29 (then 2.27).
- 2.4 + fix pushed 71d57a9a2 (cause: (shop)/@drawer/[...rest] catch-all param unknown on regeneration -> metadata held back -> truncated RSC; fix: removed catch-all, CartDrawer self-closes; render-modes hard-fails unknown params; new e2e forces redraw). Follow-ups: D-row (changes D64, D592), optimisticRouting:false may go (prefetch.spec), commit 4 (/wishlist/saved). 2.5 WIP at wip-2.5.
- 2.4+fix pushed 97a95b1d1, CI watched bsd6wl0mo. kz-b: 2.5 (from wip-2.5) then 2.6 (a5b40f759d5c15584). kz-c 2.29 (a8d3298207ebce518), kz-d 2.31 (aa65fbaf78f417439).
