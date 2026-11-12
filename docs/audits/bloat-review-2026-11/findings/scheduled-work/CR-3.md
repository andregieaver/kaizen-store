# CR-3 ✓ The marketing and autopilot minute routes: 28 idle statements a minute now, and per-store, per-order work every minute once a feature is on

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** medium. **Step:** 3.2.
- **Second check:** corrected.
- **Where:** `src/app/api/cron/autopilot/route.ts:22-28`, `src/server/autopilot-reviews.ts:70-122`, `src/server/autopilot-events.ts:83-206`, `src/app/api/cron/broadcasts/route.ts:28-41`, `src/server/automations.ts:184-193`, `src/server/automations.ts:257-289`, `src/server/ad-conversions.ts:55-68`, `src/server/platform-ad-conversions.ts:35-58`, `src/server/support-email.ts:92-124`
- **Evidence:** An empty table is not a reason to change anything, and the idle statements here are already counted in CR-1 (28 of its 58). What the code shows is how the work grows once a feature is used. runAutomations() loads every enabled automation and then, per store, reads the store once and, per store and kind, runs one due query, every minute, for emails whose delays count in days (automations.ts:264-271). queueAdConversions() re-offers every eligible order of the last seven days to every connected ad platform each minute and relies on 'on conflict do nothing' to drop what is already queued (ad-conversions.ts:55-68). sendReplyEmails() reads every conversation that is not anonymised, with no status filter, twice each minute (support-email.ts:96-124). The autopilot route runs 13 statements a minute, three of them the same 'paused?' read.
- **Cost today:** Today: 28 idle statements a minute, part of CR-1's floor. At opening (estimate from the SQL, not measured): automations cost about two statements per store per kind per minute, so 2,000 stores with two automations are about 6,000 statements a minute inside a 50 s budget; ad conversions and support emails cost in proportion to a week of orders and to all kept conversations, not to what is due. Paid by: The database and the broadcasts and integrations functions, every minute, in proportion to stores and history once the features are used.
- **Saving:** Estimate: no new saving today beyond CR-1. At opening the routes' cost follows due work instead of stores times kinds and a week of orders.
- **Risk:** A welcome email with no delay is expected within a minute or two; keep the minute cadence for it. A set-based due query must keep the per-store plan limit. An email_due marker that one writer forgets to set means an answer is never emailed: cover each writer with a test and keep today's full read as an hourly sweep for the first weeks. It would be noticed as support emails that arrive on the hour.

## The fix

1. src/server/automations.ts: replace the loop over enabledLifecycles() with one statement per kind that joins commerce.automations (enabled, the kind, store active, not a template) to the due people of every store, takes delay_days and enabled_at from the joined row, and limits a batch ordered by the due moment. Read the store (storeById) only for stores that have a due row. Keep the claim insert into automation_sends and the plan limit on marketing emails (automations.ts:281-289) exactly as they are.
2. src/server/ad-conversions.ts:55-68 and src/server/platform-ad-conversions.ts:35-58: each minute offer only orders created, or with a payment captured, in the last 15 minutes; run today's seven-day statement once an hour as the sweep (pass a 'since' to queueAdConversions(); the route passes 15 minutes, and 7 days when the minute is 0). Start the statement from commerce.ad_connections where "on", so no connection means no order is read.
3. src/server/support-email.ts:92-124: add a marker so the read is of what is due, not of every conversation. Migration: support_conversations.email_due boolean not null default false with a partial index where email_due, set by a trigger after insert on commerce.support_messages when the author is 'agent' or 'ai' (one place, so no writer can forget it), and cleared where email_sent_seq is moved (support-email.ts:157 and 241). Both reads then start from the partial index. The table is not on the hot list, so a plain index is allowed.
4. Autopilot: read ai_autonomy_paused once in src/app/api/cron/autopilot/route.ts and pass it to runAutopilot(), runGoalReviews() and runEvents() (three reads become one). Begin the after() with one statement that says which of the three has anything due, and skip the others.
5. src/app/api/cron/broadcasts/route.ts: the same first statement for its parts (a broadcast scheduled or queued, an automation enabled, a review request due, a gift card due, an ad connection on).
6. Do not build a separate platform-wide 'table has a row' switch: it stops saving the day the first store uses a feature.

**Done when:** A new case in src/server/automations.int.test.ts counts the statements of one runAutomations() with 20 stores, two enabled automations each and nothing due: 4 or fewer (at least 61 today: one list, 20 store reads, 40 due queries).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/automations.int.test.ts and src/db/automations.test.ts (due rules, once per key, the plan limit).
- src/server/ad-conversions.int.test.ts and src/server/platform-ad-conversions.int.test.ts (a row once made is never made again; an order paid later still gets its purchase event: add a case for the hourly sweep).
- src/server/support.int.test.ts, src/db/support.test.ts and e2e/support.spec.ts:68 (it calls /api/cron/integrations and expects the answer email). There is no support-email test file: add src/server/support-email.int.test.ts with the marker's cases.
- src/server/autopilot-runner.int.test.ts, autopilot-reviews.int.test.ts, autopilot-events.int.test.ts, broadcasts.int.test.ts.
- A new table column needs its line in src/db/schema.ts and pnpm db:generate. Rules: docs/wave-5-marketing.md 6.2 and 12 (automations and conversions), docs/support.md (when the answer email goes), D314 (plan limits).

**Notes:** The growth figures are estimates read from the SQL; no plan was run. Before opening there are no conversations or sends to migrate, so the marker is cheapest now.
