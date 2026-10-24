# Restoring the database (runbook)

D314, `docs/capacity.md` step 4.5, PSI REL-04. How to restore Kaizena Flow's database to a moment in time, how to check it, and the
quarterly drill. Supabase project `ybsozesfuxuitoacntfo` (eu-west-1). Supabase's own guide: <https://supabase.com/docs/guides/platform/backups>.

## What we have

- **Physical backups are on** (Postgres 17, WAL archived with WAL-G; read from the database's settings on 24 October 2026). That is
  true of daily backups and of point-in-time recovery alike, so it does not say which one we have.
- **Point-in-time recovery (PITR):** _not yet confirmed by the owner_. Check in the dashboard (Database → Backups → Point in Time) and
  write here whether it is on and its recovery period (7, 14 or 28 days). It is a paid add-on and needs at least the Small compute.
- Without PITR, Supabase keeps **daily backups** (Pro: the last 7 days), and a restore can only go back to one of them.
- **Storage is not in any backup.** The database keeps only the files' rows; the files themselves (`product-media`, `documents`,
  `page-videos`, `digital-files`, `imports`, `exports`, `avatars`, `field-files`) are not restored, and a file deleted after the moment
  stays deleted. See *Files* below.

## Targets

|  | With PITR | Daily backups only |
|---|---|---|
| **RPO** (data we can lose) | 2 minutes (Supabase's worst case: WAL is shipped every two minutes, or sooner when busy) | up to 24 hours |
| **RTO** (time to be back) | 1 hour for today's size (251 MB on 24 October 2026); the drill measures it | the same, plus re-entering a day's work |

The RTO is a proposal until the first drill measures it: write the real figure in the log, and move the target if it is wrong.

## The drill (every quarter, and before launch)

1. In the dashboard: Database → Backups → **Restore to a New Project**. Choose a moment in the last day (PITR) or the newest daily
   backup. Never restore over production for a drill. The new project costs as much as production while it lives.
2. **Before anything else, stop the copy's scheduled jobs.** The copy carries `pg_cron`, `pg_net` and the Vault secret, so its jobs
   still post to production's own cron routes with production's secret. In the copy's SQL editor:

   ```sql
   select cron.unschedule(jobid) from cron.job;
   ```

3. Run the checks from a local checkout with `scripts/restore-check.mjs`, read-only on both databases:

   ```bash
   RESTORED_URL='postgres://…the copy…' REFERENCE_URL='postgres://…production…' \
     node scripts/restore-check.mjs --at=2026-10-24T20:00:00Z
   ```

   It says `fail` while the copy's jobs still call out, for a migration ledger with a gap or an unknown file, and for a broken order
   sequence (D141) in the three busiest stores; `differs` when a count or the newest invoice and credit note (D159) are not what
   production had at that moment (worth a look: rows pruned since move production's count). Without `REFERENCE_URL` it checks the
   copy alone.
4. Delete the new project.
5. Write the date, the moment restored to, how long the restore took (the RTO), the script's last line, and anything that surprised you
   in the log below.

## A real restore

Restoring production loses everything written after the chosen moment, and **the project is offline while it restores**. Do it only on
the owner's decision, after an incident review. When only some rows are wrong, restore to a new project instead and copy those rows
back by hand: production stays up and keeps what came after.

1. Announce maintenance on the status page (`docs/capacity.md` step 4.4). Pause the deploy hook (Vercel) and the scheduled jobs, writing
   down which ones (`select jobname, schedule, command from cron.job;`), then `select cron.unschedule(jobid) from cron.job;`.
2. Restore in the dashboard (Database → Backups) to the chosen moment.
3. Re-run what came after:
   - **Stripe:** replay the events since the moment from the Stripe Dashboard (Developers → Events, each connected account's too). The
     handlers are idempotent (`applySession()`, `applyStripeRefund()`, `applyStripeDispute()`, `applyPayout()`), and an order page asks
     Stripe itself when the webhook is late.
   - **Mollie:** its webhook names only a payment id and the payment is always fetched from Mollie (`handleMollieWebhook()`); list the
     payments since the moment in Mollie's dashboard and open each order's page, which reads the payment again (`providerOf().refresh()`).
   - **Carriers:** tracking is polled again by the five-minute job for parcels under 30 days old (`pollTracking()`); bookings made at a
     carrier after the moment are at the carrier but not here: compare the carrier's list with the orders.
   - **Emails:** the log of sent emails is back at the moment too, so jobs may send again what they sent after it (reminders, digests).
     Their idempotency keys stop a second send only for what the restored log still has.
4. Run the drill's check against production (`RESTORED_URL` set to production, no reference: read-only). Then schedule the jobs again
   (the migrations that made them show the SQL: grep `cron.schedule` in `supabase/migrations`) and lift maintenance.
5. Write the incident's postmortem.

## Files

Storage has no backup today (PSI REL-04, `docs/audits/psi-followups.md`). What losing a bucket would cost:

| Bucket | What is in it | If lost |
|---|---|---|
| `product-media` | product, page and library pictures (1,501 files on 24 October 2026) | owners upload again; pages show broken pictures until then |
| `documents` | invoice and credit note PDFs (empty on 24 October 2026) | the documents themselves are in the database (the snapshot, D159) and their print pages still work; the stored PDFs are not made again by themselves (`pdf_path` is set once) |
| `digital-files` | files sold as downloads | buyers cannot download until the owner uploads again |
| `page-videos`, `avatars`, `field-files` | owners' uploads | uploaded again |
| `imports`, `exports` | data jobs' files, deleted after 7 days | nothing to keep |

The follow-up is a daily copy of `product-media`, `documents` and `digital-files` to a second bucket in the EU.

## Drill log

| Date | Restored to | Took | Script | Notes |
|---|---|---|---|---|
| | | | | |
