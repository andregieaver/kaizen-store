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
- Done: 0.1, 0.3 (D575), 0.4 (D576), 0.5 (D578), 0.6 (D580), 0.7 (D581, 9fc9314, write-up 1d26952). D577 sandbox fix. 0.2: first reading 13 Nov OK (487/9/67, ce1d2e3); reminder set 14 Nov 07:12 to set Done; then 0.23 may start. 0.8 executor running (has a migration in commit 3: CI applies it; after deploy read advisors, record version in decisions). Next D: D582. Local e2e failures from local data (fail on main too): invoices.spec:76, sign-up.spec x3, platform-languages.spec:11. Flake: dream-rework.int. 13-file payments cycle for step 1.8. cookie-scan cron timeouts (unreported fix). kz-fix worktree has real node_modules.
