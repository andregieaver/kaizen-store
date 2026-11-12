# CR-6 ✓ The cookie scan's due check reads every site every minute without a usable index, and failing sites are retried hourly ahead of healthy ones

Scheduled and background work (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** S. **Confidence:** medium. **Step:** 0.23.
- **Second check:** corrected.
- **Where:** `src/server/cookie-scans.ts:33-35`, `src/server/cookie-scans.ts:72-112`, `src/app/api/cron/cookie-scan/route.ts:18-33`, `src/server/site-cookies.ts:45`, `supabase/migrations/20261111172841_baseline_3_rules.sql:7577-7591`, `next.config.ts:54`
- **Evidence:** Each minute claimScan() runs two updates and then a statement that lists every open site and, per site, runs two subselects on cookie_scans to find its last scan. Stats: 49,338 calls, 192 s, the fifth most expensive statement; cookie_scans has 1,101,927 sequential scans reading 962 M rows, the most of any table. An index on (store_id, created_at) exists (cookie_scans_store_created_idx), but the subselects compare with 'is not distinct from', which Postgres does not serve from a btree index (confirm with EXPLAIN), so each one reads the table. The schedule started 1,796 scans in 34 to 45 days, 40 to 50 a day, where about ten sites scanned weekly would give under two: a failed scan is retried every hour (RETRY_AFTER) with no back-off, and the pick orders by 'done_at nulls first', so a site that has never scanned well is always taken before a healthy site that is due. The route claims one scan per call.
- **Cost today:** Today: 3 statements a minute and about 4 s of database time a day; 40 to 50 Chromium runs a day, each up to twelve page renders of our own sites. At opening (estimate from the code): the check is sites times scans-per-site every minute, so a few thousand sites means millions of rows read a minute and then the 15 s statement limit; one scan a minute caps the schedule at 1,440 scans a day, and 60 always-failing sites would take every slot and starve the rest. Paid by: The database every minute; the server and the storefront functions for each scan.
- **Saving:** Estimate: the due check from about 21 table scans a minute to one index read every 15 minutes; Chromium runs from 40 to 50 a day to about two at today's size if retries are the cause.
- **Risk:** The cause of the extra scans is inferred from the counts; step 1 checks it before the retry rule changes. A longer retry delays a site's first good scan after an outage by up to a day. Templates are scanned on purpose (cookie-scans.ts:90); leave that. A wrong pick would show as sites whose cookie page says 'last scanned' more than eight days ago.

## The fix

1. Check the cause first, read-only: select status, requested_by is null as scheduled, count(*) from commerce.cookie_scans where created_at > now() - interval '7 days' group by 1, 2, and read the failed rows' error. If most scheduled scans are 'failed', the hourly retry is confirmed.
2. Migration and src/db/schema.ts: two indexes on the expression the unique index already uses, coalesce(store_id, the zero uuid): (that, created_at desc), and (that, finished_at desc) where status = 'done'. cookie_scans is not a hot table, so plain create index is allowed.
3. src/server/cookie-scans.ts:86-108: write the two subselects with coalesce(c.store_id, NO_STORE) = coalesce(sites.store_id, NO_STORE) so the indexes serve them. Add 'failures': the site's failed scans since its last done one. Retry after an hour while failures is under 3, then after a day. Order the pick by tried_at nulls first (the site tried longest ago goes first), so a failing site cannot hold the head.
4. Do the weekly pick only in the sweep: claimScan({ pick }) with pick true when the minute is a multiple of 15. In a sweep insert up to 15 due sites as 'queued' in one statement (1,440 a day at most, as today) instead of one as 'running'; the tick's gate (CR-1: a scan is queued) then calls the route each minute until they are done. Move the 'stopped after ten minutes' update into the sweep too. An ordinary minute then costs one statement.
5. src/server/site-cookies.ts:45 (the banner's read of the last done scan, the storefront's query): use the same coalesce form so the new partial index serves it.
6. Reword D58's rule in docs/rules/storefront.md (Cookie consent): weekly, a failed scan tried again after an hour, after a day from the third failure.

**Done when:** seq_tup_read on commerce.cookie_scans in pg_stat_user_tables grows by under 1 M a day (about 21 M a day now: 962 M over 45 days), and scheduled scans in a day are at most a seventh of the sites plus 5.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/cookie-scans.int.test.ts (the order of the pick, the hour's retry, one scan per site at a time): add the back-off and 'a failing site does not go before a due healthy one'.
- e2e/cookie-scan.spec.ts:81-82 posts to the route and expects it to claim a scan an owner asked for: a queued scan must still be claimed on any minute.
- src/db/commerce.test.ts and src/db/trust.test.ts if they name cookie_scans' indexes; pnpm db:check after schema.ts.
- The baseline's own retention job for cookie_scans (baseline_4:105-112) uses the same null-safe comparison once a day; leave it.

**Comes after:** CR-1 (the tick and the sweep minute); steps 1 to 3 need nothing

**Notes:** The index exists; the null-safe comparison is what stops its use. That is why 'add an index' alone would not help.
