# DS-3 ✓ Two scheduled jobs do work that does not follow use: a prune every minute and an invoice retry every five minutes for 120 days

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.22.
- **Second check:** corrected.
- **Where:** `src/server/integrations.ts:47`, `src/server/integrations.ts:1031-1064`, `src/server/platform-integrations.ts:483-485`, `src/app/api/cron/integrations/route.ts:36`, `src/server/invoice-issue.ts:27-29`, `src/server/invoice-issue.ts:71-101`, `src/server/invoice-issue.ts:121-126`, `supabase/migrations/20261111172839_baseline_1_schema.sql:10533-10556`, `supabase/migrations/20261111172839_baseline_1_schema.sql:20855-20873`, `supabase/migrations/20261111172841_baseline_3_rules.sql:9072-9096`, `src/app/api/cron/subscription-reminders/route.ts:79`
- **Evidence:** (a) deliverDue() ends every call with its 30-day prune (integrations.ts:1062) and deliverPlatformDue() with its own (platform-integrations.ts:483-485); the route runs both every minute: 66,533 runs of the claim and of the delete. The table's four indexes lead on next_attempt_at, endpoint_id and store_id (I read them from the catalog); none leads on created_at, so once deliveries exist the prune scans the table every minute. (b) storesWithDocumentWork() picks stores with a paid order of the last 120 days and no invoice (invoice-issue.ts:74-80) but does not ask whether an invoice can be issued. issue_waiting_invoices() only issues orders whose readiness is 'ready' (baseline_1:10541, :20863), and the first test of invoice_readiness() is the store's own details (legal name, postal address, organisation number, country) and a tax profile. So a store with paid orders and incomplete details is called every tick for 120 days: 9,909 calls (132 s) plus 9,909 of issue_missing_credit_notes (35 s), which issue_waiting_invoices already ends with (baseline_1:10553). The list is capped at 50 with no order by (:98).
- **Cost today:** Measured: 167 s of database time in 78 days for the invoice retry with no invoice produced; 133,066 statements for the per-minute claim and prune. Estimate after opening: about 4.8 s of database time a day for each store that takes paid orders before its seller details are complete. Paid by: The database and the server on every cron tick
- **Saving:** Measured today: 167 s per 78 days and 133,066 statements. Estimate at scale: about 4.8 s of database time a day per store that sells before its details are complete.
- **Risk:** Low. What could break: the finder's store tests drifting from invoice_readiness(), so a ready store is not picked; the two new assertions in invoice-issue.int.test.ts hold them together, and the owner's Check again button (invoices/actions.ts:39) has no such filter.

## The fix

1. src/server/integrations.ts: move the delete at :1062 out of deliverDue() into an exported pruneDeliveries(). Keep the constant KEEP_DAYS at :47 in this file: src/lib/retention.test.ts:82 reads it from here. src/server/platform-integrations.ts:483-485: the same, as prunePlatformDeliveries().
2. src/app/api/cron/subscription-reminders/route.ts (the daily run): call both in the list at line 79, beside the other daily prunes, and return their counts.
3. src/server/invoice-issue.ts storesWithDocumentWork(), orders branch (:74-80): join commerce.stores s on s.id = o.store_id and add the store-level tests of invoice_readiness(): commerce.nz(s.legal_name) is not null and commerce.nz(s.postal_address) is not null and commerce.nz(s.organisation_number) is not null and commerce.nz(s.country::text) is not null and exists (select 1 from commerce.store_tax_profile p where p.store_id = o.store_id). A comment names the function so the two stay together. A store that completes its details is picked up on the next tick, so the promise that the invoice is issued as soon as the cause is gone holds.
4. Same function: give each branch its date (o.placed_at, rf.created_at and so on) and end with group by store_id order by min(at) limit ${limit}, so the 50 are the stores with the oldest work.
5. invoiceJobs() (:123-126): drop the second call. issue_waiting_invoices() already ends with issue_missing_credit_notes(); call issueMissingCreditNotes(storeId) only when issueWaitingInvoices() failed, which means making it say so instead of answering 0.
6. Leave queue_integration_event, the order triggers and the other jobs' first reads as they are.

**Done when:** On production a week after the deploy, calls of `select commerce.issue_waiting_invoices($1, $2)` in pg_stat_statements grow by fewer than 20 a day while no store has an issuable invoice waiting (about 127 a day today), and the delete on commerce.integration_deliveries grows by 1 a day (about 853 a day today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/integrations.int.test.ts, platform-integrations.int.test.ts, webhook-endpoints.int.test.ts, platform-endpoints.int.test.ts and apps.int.test.ts call deliverDue or deliverPlatformDue: a case that expected old deliveries to go after a delivery run must call the new prune.
- src/lib/retention.test.ts:82 (the 30-day rule equals integrations.ts' KEEP_DAYS) and src/lib/retention.ts:192 (enforcedBy names integrations' KEEP_DAYS): keep true.
- src/app/api/cron/subscription-reminders/route.test.ts and src/server/cron-routes.scan.test.ts for the daily route.
- src/server/invoice-issue.int.test.ts:178-186: add before the store's details are saved that storesWithDocumentWork() does not contain the store; line 181 (it does after) must still pass. Lines 189-199 (a missing tax profile) get the same pair.
- src/server/invoice-refunds.int.test.ts:199 and :362, invoice-documents.int.test.ts:134-142, invoice-returns.int.test.ts: credit notes that waited are still issued by one call.
- Rule: docs/wave-1b-invoices.md 2.1, 2.7 and 5.2 (named at invoice-issue.ts:16): an invoice that waited is issued by the same function as soon as the cause is gone. Unchanged.

**Notes:** DQ-15 in the queries dimension plans the document jobs more widely (indexes for the short windows, an hourly net); this is the smallest change for the two measured cases and fits beside it. The job list's overstated times need no fix of their own: DQ-5 runs the dispatcher's jobs four at a time, after which a job's recorded time is close to its own.
