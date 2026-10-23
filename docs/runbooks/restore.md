# Restoring the database (runbook)

D314, `docs/capacity.md` step 4.5. How to restore Kaizena Flow's database to a moment in time, how to check it, and the quarterly drill.
Supabase project `ybsozesfuxuitoacntfo` (eu-west-1).

## Before anything goes wrong

- **Point-in-time recovery.** Check in the Supabase dashboard (Database → Backups) that it is on. Write its retention here:
  _not yet confirmed by the owner_.
- Daily backups are kept by Supabase as well; PITR is what lets us choose the minute.

## The drill (every quarter)

1. In the Supabase dashboard, restore to a **new branch or project**, never over production, at a time of your choosing from the last
   day.
2. Point a local checkout at it (`DATABASE_URL`, read-only use) and check:
   - `select count(*) from commerce.orders` and `commerce.invoices` are close to production's at that moment;
   - `select * from commerce.order_number_audit(<store id>)` reports no gap for the three largest stores (D141);
   - the newest invoice and credit note numbers per store are the ones production had at that moment (D159);
   - `select count(*) from commerce.store_usage_daily where day = current_date - 1` has rows (the usage job ran).
3. Delete the branch or project.
4. Write the date, the time restored to, how long the restore took, and anything that surprised you in the log below.

## A real restore

Restoring production loses everything written after the chosen moment. That includes orders paid at Stripe after it, which Stripe will
still tell us about. Do it only on the owner's decision, after an incident review.

1. Announce maintenance on the status page (`docs/capacity.md` step 4.4) and pause the deploy hook (Vercel) and the scheduled jobs
   (`select cron.unschedule(jobname) from cron.job`; write down which ones, so they can be scheduled again).
2. Restore in the Supabase dashboard to the chosen moment.
3. Re-run what came after. Stripe's events can be replayed from the Stripe Dashboard for the time since the moment; the webhook handlers
   are idempotent (`applySession()`, `applyStripeRefund()`, `applyStripeDispute()`, `applyPayout()`).
4. Run the drill's checks. Then schedule the jobs again (the migrations that made them show the SQL) and lift maintenance.
5. Write the incident's postmortem.

## Drill log

| Date | Restored to | Took | Notes |
|---|---|---|---|
| | | | |
