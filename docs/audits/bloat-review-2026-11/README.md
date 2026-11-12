# Bloat review, November 2026: the plan in full, the findings, the bars, the evidence

The review is `docs/audits/bloat-review-2026-11.md`: read it first. Its Progress table lists every step. This folder holds
what stands behind it. Open the file of the step or the finding you are working on, not the folder.

| Here | What |
|---|---|
| `plan/phase-N.md` | each phase's steps in full: what to change, the findings it closes, the check that says it is done, what it means for the platform |
| `findings/README.md` | every finding by area, with its priority and the step that closes it |
| `findings/<area>/README.md` | one area in short: its findings, what was refuted, its measures, what is well made |
| `findings/<area>/<ID>.md` | one finding: where, the evidence, the cost today, the fix in steps, the tests and rules that change with it, done-when, risk |
| `grade-a/<area>.md` | what grade A means for one area: the measures, today's values, the targets, how each is measured, and the steps that reach it |
| `evidence/` | the measurements (below) |
| `scripts/` | what made them |

## evidence/

| File | What it is |
|---|---|
| `routes.md` | 32 pages of the production build in a browser: bytes by kind, what each document is made of, requests after load, script bytes that ran |
| `scripts-by-page.md` | for 14 of those pages, the scripts really loaded, matched to source modules |
| `server-and-client-by-route.md` | for 19 routes, the modules the server loads and the client code reachable, from Next's analyzer |
| `spike.md` | two import edits measured in a copy (the plan's import-hub step) |
| `production-database.md` | production's statistics on 11 November, read before the reviewers checked them: sizes, tables with no row yet, the costliest and most-called statements, the schedule; and the queries, to run them again. Two of its first readings were corrected by the reviewers: a round of jobs takes about 1.3 s, not the sum of its jobs' times, and status checks are pruned at 91 days |
| `production-pages.md` | three production documents, to check the local shares |
| `prefetch-storm.md` | the prefetch loop on `/s/` listing and search pages, as first seen (its cause is in `findings/prefetching/PF-1.md`) |
| `unused-code.md`, `copied-code.md` | the two scans' first lists of suspects (checked in `findings/unused-code/` and `findings/copied-code/`) |

## scripts/

Run from the repository root. They were written for this review on one machine; a step of the plan makes them commands.

```bash
pnpm build                                    # as CI's signed-in job builds it
pnpm start --port 3000 &                      # with e2e/fixtures/auth-stub.mjs beside it, for the admin pages
E2E_SIGNED_IN=1 pnpm exec playwright test --project=signed-in-setup   # saves e2e/.auth/owner.json and admin.json
node docs/audits/bloat-review-2026-11/scripts/measure-routes.mjs out '{"product":"<a product id of e2e-shop>","pageId":"<a page id of e2e-shop>"}'
node docs/audits/bloat-review-2026-11/scripts/routes-table.mjs out      # routes.json to routes.md
node docs/audits/bloat-review-2026-11/scripts/storm.mjs "http://localhost:3000/s/demo/no/search?q=lampe" 8 phone

pnpm exec next analyze --output               # about 8 minutes; writes .next/diagnostics/analyze
node docs/audits/bloat-review-2026-11/scripts/server-graph.mjs out      # modules and KB per route, server and client
node docs/audits/bloat-review-2026-11/scripts/scripts-by-page.mjs out   # needs out/routes.json and the analyzer's data

node docs/audits/bloat-review-2026-11/scripts/unused-code.mjs out       # files and exports nothing uses (suspects)
node docs/audits/bloat-review-2026-11/scripts/copied-code.mjs out       # exact copies
```

`PLAYWRIGHT_CHROMIUM_PATH` names the browser where one is preinstalled; `BASE_URL` another address than `http://localhost:3000`.
