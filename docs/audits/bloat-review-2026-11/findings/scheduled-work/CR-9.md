# CR-9 ✓ The invoice job re-asks the same waiting stores every five minutes, with no back-off and no order

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 0.30.
- **Second check:** corrected.
- **Where:** `src/server/invoice-issue.ts:25-29`, `src/server/invoice-issue.ts:32-51`, `src/server/invoice-issue.ts:71-101`, `src/server/invoice-issue.ts:116-132`, `supabase/migrations/20261111172839_baseline_1_schema.sql:10533-10556`, `supabase/migrations/20261111172839_baseline_1_schema.sql:20855-20873`
- **Evidence:** storesWithDocumentWork() returns up to 50 stores that have a paid order of the last 120 days with no invoice, with no 'order by' and no note of why the order waits. The job then calls commerce.issue_waiting_invoices and commerce.issue_missing_credit_notes for each. Stats: 9,909 calls each, 132 s and 35 s (13.3 ms and 3.5 ms a call), and no invoice came of them: the same stores come back on every run. The SQL function already calls issue_missing_credit_notes itself (line 10553), so the job's second call repeats it. The function issues only orders whose reason is 'invoice_failed', which commerce.waiting_invoices() (line 20862-20870) gives only when invoice_eligibility() is 'ok' and invoice_readiness() is 'ready'; a store waiting for its seller's details is asked again all the same.
- **Cost today:** About 17 ms of database time per waiting store per run, for up to 120 days per order; 167 s so far. At opening (read from the code): new owners who take orders before filling in their business details will be common; once more than 50 stores wait for a reason that does not clear, a store whose invoice could be issued may never be among the 50 picked. Paid by: The database every five minutes; later, an owner whose invoice is not issued because the job never reaches the store.
- **Saving:** About 9,900 function calls per 78 days at today's size to a few a day, and the 50-store cap stops being a way to starve a store.
- **Risk:** If invoice_readiness() and the job's predicate ever disagree, a real invoice waits until the owner presses 'Check again'; using the same two functions the SQL uses keeps them together. The two functions are called once per waiting order per run, which costs about what the dropped per-store calls cost. It would be noticed as orders on the Waiting tab with the reason 'invoice_failed' that stay.

## The fix

1. src/server/invoice-issue.ts:71-101, the first branch of storesWithDocumentWork(): add the two conditions the SQL function itself applies, commerce.invoice_eligibility(o.id) = 'ok' and commerce.invoice_readiness(o.id) = 'ready', so a store appears only when the job can issue something now. Replace the bare 'limit' with group by store_id order by min(the waiting moment) limit, so the store that waited longest is first.
2. src/server/invoice-issue.ts:124: remove the job's call to issueMissingCreditNotes(storeId); commerce.issue_waiting_invoices() already performs it (baseline_1:10553). Keep the exported function for the owner's 'Check again'.
3. Where the owner saves the seller's details or the invoice settings (find the writers of commerce.invoice_settings and of the tax profile's seller fields with rg in src/server), call after(() => issueWaitingInvoices(storeId)), so 'as soon as the cause is gone' (docs/wave-1b-invoices.md 2.7) is the save itself and not the next poll.
4. Before opening, issue one invoice end to end in production with a live drill (D406): no invoice has been issued there yet.

**Done when:** The calls of 'select commerce.issue_waiting_invoices($1, $2)' in pg_stat_statements rise by fewer than 10 a day on today's data (about 127 a day now), and the two new cases in invoice-issue.int.test.ts pass.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/invoice-issue.int.test.ts (storesWithDocumentWork, invoiceJobs): add 'a store whose orders wait for the seller's details is not picked' and '51 such stores do not keep an issuable store out'.
- src/db/invoices.test.ts and src/db/invoices-concurrency.int.test.ts (issue_waiting_invoices, waiting_invoices) stay; no SQL function changes.
- Rules: docs/wave-1b-invoices.md 2.1, 2.7 and 5.2; docs/rules/admin/commerce.md:89.

**Notes:** Small, and it removes a way for an owner's invoice never to be issued; that is why it is P1 though today's cost is seconds.
