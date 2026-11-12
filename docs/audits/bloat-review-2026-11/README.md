# Bloat review, November 2026: the plan in full, the findings, the bars, the evidence

The review is `docs/audits/bloat-review-2026-11.md`: read it first. Its Progress table lists every step. This folder holds
what stands behind it. Open the file of the step or the finding you are working on, not the folder.

| Here | What |
|---|---|
| `plan/README.md` | how to carry out a step, and the order |
| `plan/phase-N.md` | each phase's steps in full: what to change, the findings it closes, the check that says it is done, what it means for the platform |
| `plan/steps/<step>.md` | one step's brief: who can do it, what must be done first, each commit's files and changes, the checks, when to stop |
| `plan/decisions.md` | the owner's decisions of 12 November in one table |
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

node docs/audits/bloat-review-2026-11/scripts/import-reach.mjs --cycle src/app/api/visit/route.ts   # 12 Nov: 'src/app/api/visit/route.ts: 1308 files', 'largest cycle in src/server: 229 files'; --why <target> prints one import chain
node docs/audits/bloat-review-2026-11/scripts/copy-count.mjs 0 /tmp/copies.json src                  # 12 Nov: 4803 exact copied lines, 4098 across files, 705 inside one file
node docs/audits/bloat-review-2026-11/scripts/twin-count.mjs                                         # 12 Nov: last line '41 twin pairs'
node docs/audits/bloat-review-2026-11/scripts/helper-count.mjs                                       # 12 Nov: last line '84 helpers declared with identical text in 3 or more files'
```

After a build (`pnpm build`), from the repository root:

```bash
node docs/audits/bloat-review-2026-11/scripts/trace-sizes.mjs              # bytes traced beside each function in .next/server, by kind; the ten largest and the total
node docs/audits/bloat-review-2026-11/scripts/trace-packages.mjs [out.json] # megabytes per kind of package across all traces
node docs/audits/bloat-review-2026-11/scripts/cold-load-route.cjs .next/server/app/api/visit/route.js   # one built route in a fresh process: milliseconds and megabytes
node docs/audits/bloat-review-2026-11/scripts/cold-load-proxy.cjs          # the same for the proxy (.next/server/middleware.js)
node docs/audits/bloat-review-2026-11/scripts/cold-load-page.cjs ".next/server/app/s/[store]/[market]/page.js"   # the same for a page
node docs/audits/bloat-review-2026-11/scripts/cold-load-start-hook.cjs     # what an instance does before its first request (reads DATABASE_URL set inside it: edit it for another database)
node docs/audits/bloat-review-2026-11/scripts/manifest-time.cjs            # milliseconds and bytes of the server reference manifest
node docs/audits/bloat-review-2026-11/scripts/flight.mjs saved.html        # bytes of the React flight payload in a saved document, and what is in it twice
node docs/audits/bloat-review-2026-11/scripts/route.mjs "/s/[store]/[market]"   # a route's first-load client chunks and bytes
node docs/audits/bloat-review-2026-11/scripts/meta-reader.mjs [dir]        # prerendered entries whose resume data keeps a page list (default .next/server/app)
node docs/audits/bloat-review-2026-11/scripts/words-in-entries.mjs "<a sentence from a catalogue file>"   # which built chunks and entries hold it
node docs/audits/bloat-review-2026-11/scripts/cut-simulation.mjs <page> [--cut from=>to] [--drop x] [--show N] [--dir <analyzer export>]   # needs `next analyze --output`

node docs/audits/bloat-review-2026-11/scripts/handed.mjs                   # three admin screens: words handed to the browser against words their client parts name (12 Nov: product editor 204116, order 163851, customer 140715 bytes)
node docs/audits/bloat-review-2026-11/scripts/ai-round.mjs                 # every agent's round of tools (12 Nov: shop only page=-, round tools with all manager 39 = 33810); bundles ai-round.ts with esbuild
```

## lists/

Plain lists, one entry a line, kept as they were made on 12 November. A step that deletes reads its list and checks each entry again.

| File | Lines | What it is | Used by |
|---|---|---|---|
| `unused-exports-tier-0.txt` | 330 | exports with no test and no other production mention, one per line as `file:line name (kind, lines; tests; mentions)` | DD-2 |
| `unused-exports-tier-2.txt` | 323 | exports with no other production mention that a test still reads (the test goes with it) | DD-3 |
| `unused-words.txt` | 120 | unused constants that hold interface words, with their line counts | DD-7 |
| `dead-text-keys.txt` | 44 | catalogue keys with no reader (the file's own two comment lines say how it was checked) | the TX findings |

`PLAYWRIGHT_CHROMIUM_PATH` names the browser where one is preinstalled; `BASE_URL` another address than `http://localhost:3000`.
