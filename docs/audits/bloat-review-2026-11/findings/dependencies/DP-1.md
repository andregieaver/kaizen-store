# DP-1 ✓ 481 table definitions are loaded and indexed in every function for a query API nobody calls

Dependencies (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** confirmed.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `src/db/schema.ts:1-19614`, `drizzle.config.ts:7`, `node_modules/.pnpm/drizzle-orm@0.45.4_@electric-sql+pglite@0.5.13_@types+pg@8.23.1_pg@8.23.1_postgres@3.4.9/node_modules/drizzle-orm/node-postgres/driver.js:36-47`, `docs/audits/code-review-2026-11.md:116`, `docs/audits/code-review-2026-11.md:268`, `docs/audits/code-review-2026-11.md:484`
- **Evidence:** client.ts line 11 imports all of schema.ts and line 78 passes it to drizzle(); drizzle's driver uses it only to build the relational query config. Re-checked: outside tests there are 0 query-builder or db.query calls and 0 relations(); client.ts is the only run-time importer of schema.ts (the one other importer is store-export.scan.test.ts); 637 files import just the sql tag. Built, the schema module is 614,815 bytes and sits in six chunks: two of 797,650 bytes named by 253 route handlers, two of 847,449 named by 560 pages, one of 2.4 MB and the proxy's 4.7 MB chunk. Timed by the skeptic: evaluating schema.ts 105-138 ms and 10-16 MB heap, drizzle({schema}) 36-37 ms against 0.04 ms without. Timed by the planner as whole routes: /api/health's own code, bundled, loads in 145-148 ms, +21 MB heap, +64 MB RSS with the schema and in 67-87 ms, +7.5 MB, +29 MB without; the beacon after DP-10 falls from 209-215 ms and +80 MB RSS to 130-143 ms and +51 MB.
- **Cost today:** About 60-170 ms, 13 MB of heap and 30-35 MB of resident memory per cold start (this sandbox; an estimate for Vercel), in 816 of 830 routes and in the proxy. It is half of what a lean route loads. The build also compiles the 1 MB file into six chunks. Paid by: The server once per new function instance: after each deploy, on scale-up and after idle. The first shopper, webhook or cron call to reach that instance waits. More traffic means more instances, so this grows with shoppers and deploys, not with features used. The build pays a little too.
- **Saving:** Measured here on whole routes: 60-80 ms, 13 MB heap and 29-35 MB RSS less per cold start (health route 145-148 to 67-87 ms; beacon after DP-10 209-215 to 130-143 ms). The skeptic's unbundled timing gives 100-170 ms. 615 KB less server JS in 816 routes and six fewer copies to build. Estimate for Vercel.
- **Risk:** Low. No run-time code uses db.query or the typed tables; the type check shows any stray use, and the integration tests run every reader against a real database. If the Db type were to lose a method someone uses, pnpm typecheck fails before the push.
- **Already tracked:** docs/audits/code-review-2026-11.md step 3.14 (FD5), Open. It names the fix but ties it to splitting the file (effort M, phase 3) and measures nothing. Do the three lines now; leave the split where it is.

## The fix

1. src/db/client.ts: delete line 11 (import * as schema from './schema'). Line 31 becomes: type Database = NodePgDatabase; Line 78 becomes: return { pool, database: withRows(drizzle({ client: pool })) }; Nothing else in the file changes; Db keeps its shape.
2. Run pnpm typecheck. Any stray use of a typed table or of db().query fails here; none is expected (rg finds 0).
3. Run pnpm db:check with DATABASE_URL set: it must write no migration and leave supabase/ unchanged, because drizzle.config.ts still reads src/db/schema.ts. schema.ts itself is not touched.
4. Run pnpm test and pnpm test:int, then pnpm build, and run the done_when command.
5. docs/audits/code-review-2026-11.md, in the same change (its own rule): Progress row 3.14 gets 'client.ts half done, <date>, <commit>; the file split stays Open'; FD5's row is corrected to today's 19,614 lines and 481 tables and says the import is gone; add a change-log line. DP-9's corrections to FH12 and step 4.4 go in the same edit.

**Done when:** After pnpm build, rg -l -F '.table("theme_schedules"' .next/server -g '*.js' | wc -l prints 0 (today 6), and pnpm db:check exits 0.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/client.test.ts (isTransientDbError, retryTransient): unaffected, must pass
- src/server/store-export.scan.test.ts imports @/db/schema directly: stays as it is
- pnpm db:check in CI's integration job (.github/workflows/ci.yml:110): must still pass with no diff under supabase/
- scripts/lib/ratchet-count.mjs reads schema.ts as text: unaffected
- docs/audits/code-review-2026-11.md step 3.14 and finding FD5: updated in the same change
- CLAUDE.md 'Database' (tables live in src/db/schema.ts, server code reaches the schema through db()): still true, no edit

**Notes:** The storefront review's SD-1 lists the same three lines as its third cut: do it once, here. The memory figure is new and is the stronger reason: about a third of a lean instance's resident memory.
