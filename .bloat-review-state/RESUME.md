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
5. **The grade panel** (not started): one workflow, per scorecard area a reviewer who sets the bar for an A in numbers (today's
   value, the target, how it is measured, the grade after each phase, and what an A needs that no step covers) and a challenger
   (is that truly an A, can the steps reach it, what is missing), then one critic across areas for consistency. Areas and the
   files that feed them: the code itself (unused-code, copied-code, deps, assets, families); a shopper's browser (storefront-client,
   client-bundles, page-payload, prefetch, css); an owner's browser (admin-client, client-bundles, page-payload, page-model); the
   server (storefront-data, admin-data, server-graph, functions, caching); scheduled work (cron); the database (db-queries,
   db-schema); AI calls (ai-context); the product's surface (features, families); the written rules (docs-context); the page
   builder's model (page-model); styles (css); interface text (i18n); tests, CI and the build (tests-ci). Where a step falls
   short of an A, the plan gets a step; the goal does not move.
6. **Finish:** rebuild the docs, commit, push docs to `main`; update the page (publish `page/bloat-review.html` to the same
   artifact); tell the owner what changed: refuted findings, new areas' grades, steps added to reach an A.
