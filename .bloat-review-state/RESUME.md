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
