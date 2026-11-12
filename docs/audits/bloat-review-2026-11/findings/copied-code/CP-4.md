# CP-4 ✓ The platform console has a second engine for workflows, own endpoints and integration deliveries beside the stores' engines

Copied code (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 3.10. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/server/platform-workflows.ts:290-378`, `src/server/workflows.ts:363-459`, `src/server/platform-endpoints.ts:154`, `src/server/webhook-endpoints.ts:1`, `src/server/platform-integrations.ts:1`, `src/server/integrations.ts:1`, `src/app/api/cron/integrations/route.ts:25-38`, `src/app/admin/(gated)/platform/integrations/[provider]/page.tsx:1`, `src/app/admin/(gated)/[store]/integrations/[provider]/page.tsx:1`, `src/lib/sql-raw.scan.test.ts:12`, `docs/decisions.md:805`, `docs/decisions.md:855`, `docs/decisions.md:856`
- **Evidence:** Read side by side: runPlatformWorkflows() (platform-workflows.ts:315-378) and runWorkflows() (workflows.ts:390-459) are the same claim statement, loop, outcome update and 90-day delete with other table names, a join to stores on the store side and another payload reader. Measured with lcs.mjs (lines in runs of five or more): workflows 119, endpoints 84, integrations 65, the two provider pages 108. API tokens and the platform API are not copies (15 and 14). Platform side today: 1,535 server lines and 296 lib lines. The every-minute route runs deliverDue() and deliverPlatformDue(), runWorkflows() and runPlatformWorkflows() (route.ts:28-37). D465, D515 and D516 give the reason for separate platform_* tables (the stores' tables hold store_id not null and every reader filters by it); D516 already shares the editor, checks and words.
- **Cost today:** About 1,830 lines that follow the stores' engines by hand, of which about 400 are near-copies; two extra claim passes each minute, a fixed cost that does not grow with the number of stores; every later change to signing, retries or the workflow runner is made twice. Paid by: An agent's session and the build; the server and the database for two small extra passes a minute.
- **Saving:** About 300 to 450 lines with shared engines (estimate from 376 measured lines in runs, less the scope objects).
- **Risk:** Signed deliveries and workflow runs must behave the same. A difference shows in the six integration tests; the one deliberate difference to keep is the platform's strict tested-version check (D516). A mistake in the store scope's join would run workflows of a closed store: workflows.int.test.ts covers 'a store that is not open runs nothing'.
- **Already tracked:** no; docs/decisions.md D465, D515 and D516 record the choice of separate tables and its reason

## The fix

1. Workflows first (largest overlap). Add src/server/workflow-engine.ts with queueScheduled(scope, now), runQueued(scope, limit, now) and runsOf(scope, workflowId, limit). The scope names its tables as sql fragments written in code (never sql.raw: src/lib/sql-raw.scan.test.ts), its once-a-day constraint, the extra columns and join of the store side, zoneOf, payloadOf, allowedActions, act, whether the owner is open, and a log prefix. Move the claim statement, the loop, the outcome update and the 90-day delete from workflows.ts:390-459 into it.
2. src/server/workflows.ts: runWorkflows() and queueScheduledRuns() become calls with the store scope (commerce.workflows, commerce.workflow_runs, the join to commerce.stores, store_is_active as open, subjectData as payloadOf). src/server/platform-workflows.ts: the same with the platform scope (platform_workflows, platform_workflow_runs, platform_workflow_runs_once_key, PLATFORM_ZONE, platformPayload). Exported names and results stay, so src/app/api/cron/integrations/route.ts is unchanged.
3. The editor side of the two files (list, get, checked, save, switch, delete, test): share what lcs.mjs shows as runs and keep D516's strict tested-version check on the platform side as a scope flag.
4. Endpoints: one store of endpoints in src/server/endpoint-store.ts taking the table fragment and the owner clause; webhook-endpoints.ts and platform-endpoints.ts keep their exported functions as thin calls.
5. Deliveries: share the claim-due, sign, send and reschedule loop of deliverDue() (integrations.ts) and deliverPlatformDue() (platform-integrations.ts) the same way; share the two provider pages' body as one component taking words, actions and the provider.
6. Leave the platform's API tokens and API as they are: they are not copies.
7. Record next to D465 and D516 in docs/decisions.md that the tables stay apart and the engines are one; tick nothing in docs/platform-parity.md (no feature changes).

**Done when:** `rg -c 'for update skip locked' src/server/workflows.ts src/server/platform-workflows.ts` prints nothing (the claim lives in workflow-engine.ts only; today one in each), and the six integration tests pass unchanged.

**Tests and rules that hold today's behaviour, and change with it:**

- Keep unchanged as the check: src/server/workflows.int.test.ts, platform-workflows.int.test.ts, webhook-endpoints.int.test.ts, platform-endpoints.int.test.ts, integrations.int.test.ts, platform-integrations.int.test.ts; src/lib/platform-workflows.test.ts, src/lib/platform-integrations.test.ts, src/db/platform-integrations.test.ts.
- src/lib/sql-raw.scan.test.ts: a new sql.raw fails; pass table names as sql fragments.
- src/server/ratchet.scan.test.ts: the engine reads through typedRows(); the store-less-write count reads table names from SQL text, so keep `and store_id =` in the store scope's clauses and run node scripts/ratchet.mjs after the move.
- src/server/cron-routes.scan.test.ts holds the route to trackedRoute() and maxDuration: the route does not change.
- docs/rules/admin/integrations.md (Workflows; Events to an owner's own endpoints; Kaizena Flow's own integrations) and decisions D465, D515, D516: the reason for separate tables stands and is kept.
- CLAUDE.md Conventions: whatever is built for stores is built for the platform too. A scope is how one engine obeys it.

**Notes:** The shared engine with a scope needs no decision from the owner and is what this plan proposes. owner_decision is true only for the larger alternative, which reverses D465: making the platform's events the Kaizena Flow store's own integration topics so the twin tables go. That is a product choice, not waste. Corrections kept: tokens and the API are out, near-copies are about 400 lines, the saving 300 to 450, and the extra cron passes are a fixed cost per minute. Before opening is the cheap time for either: the twin tables hold only test rows.
