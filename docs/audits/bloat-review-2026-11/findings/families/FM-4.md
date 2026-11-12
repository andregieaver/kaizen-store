# FM-4 ✓ The platform's events pipeline is written a second time beside the stores': 26 to 55% of its lines are the stores' own

Families and twins (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** duplicate. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 3.10.
- **Second check:** corrected.
- **Where:** `src/server/platform-endpoints.ts:110`, `src/server/webhook-endpoints.ts:117`, `src/server/platform-workflows.ts:26`, `src/server/workflows.ts:1`, `src/server/platform-integrations.ts:394`, `src/server/platform-integrations.ts:449`, `src/server/integrations.ts:899`, `src/server/integrations.ts:1031`, `src/app/api/cron/integrations/route.ts:36`, `src/app/admin/(gated)/platform/integrations/[provider]/page.tsx:1`, `docs/decisions.md:805`, `docs/decisions.md:855`, `docs/platform-parity-plan.md:176`
- **Evidence:** Share of a platform file's significant lines found unchanged in its store file, imports left out: endpoints 55% (92 of 167), workflows 54% (132 of 243), API tokens 30% (14 of 46), integrations 28% (105 of 371), ad conversions 26% (25 of 97). The five server modules share 368 lines by that measure, 209 of them in runs of three or more. Read side by side, addPlatformEndpoint() and addEndpoint() differ in the table name, the store filter ('where store_id = ... and app_grant_id is null' against none), the lock key and the audit name; update, switch, renew, remove and resend the same. Their screens repeat too: five files of platform/integrations hold 201 lines of 514 that are in the store's file of the same path ([provider]/page.tsx 68%). The two runners are called together by the same route, every minute (cron/integrations/route.ts:18 and 36). They already share the sender, the pure rules and the workflow editor's kit (D516). The separate tables are a written decision: D465 and D515 say the stores' tables are keyed by the store and every reader filters by it, and the parity plan built the platform's as step C4 on 9 November.
- **Cost today:** About 370 identical server lines and about 200 screen lines kept in step by hand: a fix to retry, signing or endpoint health on one side must be remembered on the other. At run time the every-minute job makes one more claim and one more prune statement for the platform's queue; that is fixed and does not grow with stores. Paid by: CI and an agent's session, and whoever changes one runner and forgets its twin. The database pays two small statements a minute.
- **Saving:** About 300 to 550 lines (estimate from the 209 to 368 identical server lines and about 200 identical screen lines measured). Tests stay.
- **Risk:** Low to medium. What could break: a store filter lost in the shared code, which would let one store touch another's endpoint; the stores' integration tests cover it and the ratchet's pattern must stay satisfied. Two sets of integration tests hold the behaviour on each side.
- **Already tracked:** no. D465, D515 and D516 give the reason for separate tables; the fix keeps them.

## The fix

1. Keep the separate tables and screens' addresses (D465, D515 and D516 stand). Start with endpoints, the most alike. In src/server/webhook-endpoints.ts add an EndpointScope: the Drizzle table object (webhookEndpoints or platformWebhookEndpoints from src/db/schema.ts), owned() (the SQL that names the owner: 'store_id = ... and app_grant_id is null' for a store, 'true' for the platform), the advisory lock's key, the owner columns for an insert, and audit(action, meta, target). Write add, update, switch, renew, remove, resend and listDeliveries once against the scope; use the table object inside the sql template (no sql.raw).
2. Make addEndpoint() and its siblings three-line calls with the store's scope, and src/server/platform-endpoints.ts the same with the platform's scope, keeping every exported name so no caller changes.
3. The same for workflows: src/server/workflows.ts gets a scope (table, owned(), what an event's facts are, the run log's table); src/server/platform-workflows.ts keeps only its events and facts.
4. Then the runners in src/server/integrations.ts:899-1031 and platform-integrations.ts:394-449: one claim, attempt, retry, health and prune over a scope; each file keeps its payload builder. Leave API tokens and ad conversions alone: 14 and 25 shared lines do not pay for a scope.
5. Screens: lift the bodies of the five platform/integrations files that repeat the store's into shared parts under src/components/admin/integrations that take their owner as a prop; both addresses stay.
6. Run node scripts/ratchet.mjs if a number fell; add a line to docs/decisions.md.

**Done when:** node docs/audits/bloat-review-2026-11/scripts/sources/fmv/sim2.mjs.txt on the five pairs reports under 60 lines in runs of three or more (209 today), and the six integration test files named pass without an edit.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/webhook-endpoints.int.test.ts and platform-endpoints.int.test.ts, workflows.int.test.ts and platform-workflows.int.test.ts, integrations.int.test.ts and platform-integrations.int.test.ts, with the unit tests integrations.test.ts, platform-integrations.test.ts, workflows.test.ts and platform-workflows.test.ts: all must pass unchanged. They are what holds the behaviour.
- src/server/ratchet.scan.test.ts (writes by id name the store): the shared code must write 'where ${owned(...)} and id = ...', the form the ratchet accepts (ratchet.scan.test.ts:66).
- src/lib/sql-raw.scan.test.ts lists every sql.raw: pass tables as Drizzle objects so the list does not grow.
- src/server/cron-routes.scan.test.ts: the cron route keeps its shape.
- Rules: D465, D515, D516 (docs/decisions.md:805, 855, 856) and docs/platform-parity-plan.md section 3 keep the platform's own tables; this fix does not touch them. Moving the platform's events into Kaizena Flow's own store would contradict them and is not proposed.

**Notes:** Worth doing when either runner is next opened for a real change, not as a project of its own: the saving is a few hundred lines and the run-time cost is two statements a minute. The same pair is reported by the copied-code area (CP-4) and the features area (FT-10).
