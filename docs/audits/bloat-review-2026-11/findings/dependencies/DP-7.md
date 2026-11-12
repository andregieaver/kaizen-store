# DP-7 ✓ Three Chromium routes are woken every minute whether or not there is work

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 3.1.
- **Second check:** corrected.
- **Where:** `next.config.ts:54`, `next.config.ts:56`, `next.config.ts:58`, `src/app/api/cron/theme-shots/route.ts:35`, `src/app/api/cron/page-looks/route.ts:37`, `src/app/api/cron/cookie-scan/route.ts:21`, `src/app/api/cron/cookie-scan/route.ts:33`, `src/server/cookie-scans.ts:72-86`, `src/lib/cron-health.ts:26-28`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:96`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:101`, `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:103`
- **Evidence:** pg_cron calls /api/cron/cookie-scan, /api/cron/page-looks and /api/cron/theme-shots every minute (migration lines 96, 101, 103). Each route's trace is 125.4 MB (Chromium 66.8, playwright-core 11.1, sharp 18.8, taxonomy 12.7, chunks 14.0). Chromium itself is started only when there is work (browser.ts uses import()), which is well done. Because the routes are called every minute they stay warm, so the 125 MB is paid at each deploy's cold start, not per call. The cookie-scan call runs two updates and a read of cookie_scans every time (cookie-scans.ts:72-86). Before opening the queues are empty by nature; that shows what an idle wake costs, not that the features are unwanted.
- **Cost today:** 4,320 function calls a day, each with a net.http_post, a cron_jobs upsert and, for the cookie scan, three statements. Fixed: it does not grow with stores. Small in money. Paid by: The server (invocations) and the database (writes and scans each minute). Once stores exist more wakes will find work: a weekly scan per store fills about 10% of the cookie scan's minutes at 1,000 stores (estimate).
- **Saving:** Estimate: most of 4,320 calls a day while queues are mostly empty, falling as stores arrive. No cold-start saving.
- **Risk:** Low to medium: a queued job starts up to one tick later; a wrong condition leaves a scan waiting, which the cookie page would show as an old scan date; the platform home shows the routes as late unless cron health changes with it.
- **Already tracked:** no in the existing plans; it is a part of this review's scheduling finding CR-1, which should own it.

## The fix

1. Do not change this alone: it is one of the nine every-minute routes of the scheduling review's CR-1. Make the scheduler change once, there.
2. For the cookie scan, a SQL function (a custom migration: pnpm exec drizzle-kit generate --custom --name cookie_scan_due, then node scripts/prune-snapshots.mjs) that returns true when claimScan() would find work: a queued row, a row running for more than ten minutes, or an open site whose last finished scan is a week old (a failed one an hour old). It must mirror claimScan() (src/server/cookie-scans.ts:72 onward) exactly, or claimScan()'s three reads move into it. The pg_cron job posts to the route only when it returns true. A new migration reschedules the job; the baseline is never edited.
3. For page-looks and theme-shots the same, from the due rule of runPageLooks() (src/server/page-looks.ts) and runThemeShots() (src/server/theme-shots.ts).
4. Cron health: a one-minute job counts as late after eleven minutes without a finished run (src/lib/cron-health.ts:26-28). Either the SQL check writes a heartbeat to commerce.cron_jobs when it finds nothing, or the three routes are registered with a longer interval in trackedRoute(). Update src/lib/cron-health.test.ts and src/server/cron-runs.int.test.ts with it.
5. Add a test to src/db/commerce.test.ts for each due function (the rule for any new SQL rule).

**Done when:** With empty queues, commerce.cron_jobs shows no new run of route.cookie-scan, route.page-looks or route.theme-shots over an hour (today 60 each), and the platform home shows none of them late.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/cron-routes.scan.test.ts (every cron route has a maxDuration and runs inside trackedRoute): the routes keep both
- src/lib/cron-health.test.ts, src/server/cron-runs.int.test.ts: the late rule changes with the heartbeat
- src/db/commerce.test.ts: a test per new SQL function; src/db/migration-safety.scan.test.ts must pass
- docs/ci-migrations.md and CLAUDE.md 'Database': a new migration through CI, recorded in docs/decisions.md (Migration versions); advisors checked after the deploy
- The platform home and Usage and limits read commerce.cron_jobs: they must not show the three routes as late

**Comes after:** CR-1 of the scheduling review (the nine every-minute routes): this is done there

**Notes:** Kept in this dimension only because Chromium's 125 MB trace is a dependency fact. Read under the owner's clarification: a fixed idle cost of scheduling, not an argument against the three features. The saving shrinks as stores arrive, so it is P2.
