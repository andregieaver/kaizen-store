# DD-6 ✓ Live drills can only be asked for by hand-written SQL, and their job polls every five minutes

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P3. **Effort:** S. **Confidence:** high. **Step:** your choice. **The owner's choice.**
- **Second check:** corrected.
- **Where:** `src/server/live-drills.ts:31`, `src/server/live-drills.ts:40`, `src/server/live-drills.ts:45`, `src/server/live-drills.ts:388`, `src/app/api/cron/cart-reminders/route.ts:220`, `docs/decisions.md:746`, `docs/rules/admin/platform.md:233`, `docs/consolidation.md:50`
- **Evidence:** The only insert into commerce.live_drills is inside requestDrills() (live-drills.ts:45), and only its integration test calls requestDrills (rg over src: the definition and live-drills.int.test.ts). No page, action or assistant tool asks for a drill, and every read of the table is inside live-drills.ts, so no screen shows a result. This is close to what D406 intended: its reason is that the AI doing the development should be able to run live checks itself, which staff actions and the Admin API do not allow; that AI works through the database. The decision and the rule also name a platform admin, who has no door. The dispatcher runs the job on every pass (route.ts:220). An idle run is two small queries (settleDreamDrills and the claim at lines 390-401); production's cron_jobs gives 158 ms for its last run, inside a dispatcher run that happens anyway.
- **Cost today:** Two queries and about 160 ms inside each five-minute dispatcher run: about 45 seconds of function time a day, the same whatever the store count. No extra function run. A request made by SQL skips requestDrills' own checks, though the runner checks test mode again (line 404). Paid by: The server and database every five minutes, a little; the platform team, who must write SQL to ask and to read the result.
- **Saving:** A usable feature for the platform team, or nothing but a true description. Taking the job out of each pass would save two queries a pass, which CR-2 counts.
- **Risk:** Low. Under A the form must keep requestDrills' refusal for a store not in test mode; the runner refuses again, so a mistake cannot touch real money.

## The fix

1. Owner's choice, A or B. Neither is urgent.
2. A (give it a door). On the platform's store page (src/app/admin/(gated)/platform/stores/[store]/) add a Run drills form, shown only when the store's checkout is in Stripe's test mode, whose action runs through platformAction() and calls requestDrills(storeId, kinds, account.id); below it the last five rows of commerce.live_drills (status, finished, each result's line) read through typedRows(). Add a tool to the platform's assistant that calls the same function, with the prompt-safety rule and a case in the agents' eval. Words in the platform catalogue in both languages.
3. B (keep it a console tool on purpose). Say so where it is described: docs/rules/admin/platform.md:233, D406 in docs/decisions.md and the comment at src/server/live-drills.ts:31 say 'asked for by an insert into commerce.live_drills, read from the row', and drop 'a platform admin'. No code changes.
4. The polling is not this finding's to fix: CR-2 in the scheduled-work plan gives each dispatcher job a cadence, and a job with a queue runs only when a row waits. Under that plan runLiveDrills() runs when commerce.live_drills has a row with status 'requested' or a waiting dream-factory result.

**Done when:** Either rg -n "requestDrills\(" src --glob '!*.test.*' shows a caller outside live-drills.ts (A), or docs/rules/admin/platform.md:233 says drills are asked for by SQL (B).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/live-drills.int.test.ts (unchanged under both).
- Under A: the agents' eval (src/lib/agent-eval.ts: a case for the new tool; agent-eval.test.ts checks every tool a case names exists), prompt-safety.scan.test.ts, and the platform admin's signed-in e2e if a page changes.
- Rules: docs/rules/admin/platform.md:233 and D406 (docs/decisions.md:746); CLAUDE.md, Conventions (server actions run through platformAction()).

**Comes after:** CR-2 (for the polling only)

**Notes:** P3: the engine works and has been used; what is left is a small idle cost that another finding handles and a product choice. Not a case for retiring anything.
