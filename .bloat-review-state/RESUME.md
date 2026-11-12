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
6. **Finish:** `node tools/build-docs.mjs` (in the repository), commit, push docs to `main`; `node tools/build-page.mjs` writes
   the page (`page/bloat-review.html`; it needs `tools/page-v4.html` for the styles and chart code and
   `tools/findings-totals.json`, which build-docs writes) and publish it to the same artifact; tell the owner what changed:
   refuted findings, each area's grade today, steps added to reach an A, and the questions that wait for an answer.
