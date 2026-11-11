# Bloat review, November 2026: findings, evidence and scripts

The review and its plan are in `docs/audits/bloat-review-2026-11.md`. This folder holds what it rests on. Open a file here only
when you work on the step that names it.

## findings/

One file per area a reviewer read: every finding in full (where, evidence, cost today, fix, saving, risk), the area's measures,
and what is well made and should stay. A tick (✓) marks a finding checked a second time; the others are one reviewer's reading.

| File | Area | IDs |
|---|---|---|
| `storefront-browser.md` | What a shopper's browser loads | SC |
| `storefront-server.md` | What the server does for a storefront request | SD |
| `admin-browser.md` | What an owner's browser loads in the admin | AC |
| `admin-server.md` | What the server does for an admin navigation | AD |
| `caching.md` | Caching and rendering | CA |
| `scheduled-work.md` | Scheduled and background work | CR |
| `queries.md` | How data is asked for | DQ |
| `database-shape.md` | The database's shape | DS |
| `dependencies.md` | Dependencies | DP |
| `files.md` | Files that ship or are stored | AS |
| `ai-calls.md` | What every AI call carries | AI |
| `features.md` | The product's surface | FT |
| `families.md` | Families and twins | FM |
| `written-rules.md` | The written rules and the agents' context | DC |

## evidence/

| File | What it is |
|---|---|
| `routes.md` | 32 pages of the production build in a browser: bytes by kind, what each document is made of, requests after load, script bytes that ran |
| `scripts-by-page.md` | For 14 of those pages, the scripts really loaded, matched to source modules (the first of each list; the script gives all) |
| `server-and-client-by-route.md` | For 19 routes, the modules the server loads and the client code reachable, from Next's analyzer |
| `spike.md` | Step 0.1's two edits, measured in a copy |
| `production-database.md` | Production's statistics on 11 November: sizes, never-used tables, the costliest and most-called statements, the schedule and each job's last run |
| `production-pages.md` | Three production documents, to check the local shares |
| `prefetch-storm.md` | The prefetch loop on `/s/` listing and search pages |
| `unused-code.md` | The scan's suspects: files and exports nothing uses |
| `copied-code.md` | The copy scan: exact copies of ten lines or more |

## scripts/

Run from the repository root. They were written for this review on one machine; step 1.1 of the plan makes them commands.

```bash
pnpm build                                    # as CI's signed-in job builds it (docs: CLAUDE.md, Commands)
pnpm start --port 3000 &                      # with the Auth stand-in beside it, for the admin pages
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
Production's figures came from read-only queries on Postgres's statistics views (`pg_stat_user_tables`, `pg_stat_user_indexes`,
`pg_stat_statements`, `cron.job`) and `commerce.cron_jobs`; `evidence/production-database.md` says which.
