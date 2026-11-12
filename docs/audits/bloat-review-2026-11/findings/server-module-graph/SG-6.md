# SG-6 ✓ schema.ts (19,614 lines) is evaluated in every function and used by none at run time

The server code every route loads (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** confirmed.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `drizzle.config.ts:7`, `src/server/store-export.scan.test.ts`
- **Evidence:** client.ts imports * as schema (line 11) and passes it to drizzle() (line 78). Nothing reads through it: I searched src for db().query, db().select, .from(schema. and found none outside tests that call pg's own tx.query(); the server writes SQL through execute(). client.ts is the only non-test importer of the schema (one scan test imports it too); drizzle-kit reads the file from drizzle.config.ts:7, not from the client. In the server chunks the file is 598 KB and builds 481 table objects on import; it also pulls src/lib modules only it needs (/api/health: 321 -> 272 module paths without it). It sits in the proxy and instrumentation layers too, so one process can evaluate it more than once.
- **Cost today:** 56 ms of /api/health's 101 ms of module evaluation and 68 ms on /api/visit (per-factory profile, re-run by the skeptic); 598 KB parsed per layer per instance. Paid by: The server per cold instance of every function that touches the database (256 of 268 handlers, 560 of 562 pages, the proxy, instrumentation); the build's workers.
- **Saving:** About 0.7 MB and 55 to 70 ms per layer per cold start on every database route (simulated: /api/health 1,125 -> 395 KB; /api/visit after SG-3 1,898 -> 1,173 KB; the proxy and a storefront page lose 0.6 to 0.7 MB each).
- **Risk:** Low: three lines. The type check catches any use of the typed query API; db:check catches a change to what drizzle-kit reads.
- **Already tracked:** Yes: code review FD5, step 3.14 'Split schema.ts', Open; its fix text already says to drop the schema argument first. New here: the measured cost per cold start. The same edit is planned in this review as deps DP-1, db-schema DS-1 and unused-code DD-1.

## The fix

1. src/db/client.ts: delete line 11. Line 31 becomes type Database = NodePgDatabase; (no schema type, so db().query.<table> stops type-checking, which is right: nothing fills it any more). Line 78 becomes withRows(drizzle({ client: pool })).
2. Run pnpm typecheck: a stray use of a typed table or of db().query fails here; none is expected.
3. Run pnpm db:check with DATABASE_URL set: it must write no migration, because drizzle.config.ts still reads src/db/schema.ts. schema.ts itself is not touched.
4. Run pnpm test and pnpm test:int, then build and read the numbers of the done-when.
5. docs/audits/code-review-2026-11.md in the same change (its own rule): Progress row 3.14 says the client.ts half is done with date and commit and the file split stays Open; FD5's row is corrected to 19,614 lines and 481 tables; add a change-log line.

**Done when:** A new next analyze export shows /api/health under about 280 modules and 0.45 MB of server code (today 308 and 1,155 KB) and no route lists src/db/schema.ts; pnpm db:check exits 0.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/client.test.ts: unaffected, must pass.
- src/server/store-export.scan.test.ts imports @/db/schema directly: stays as it is.
- pnpm db:check in CI's integration job must still pass with no diff under supabase/.
- CLAUDE.md, Database: tables live in src/db/schema.ts and server code reaches the database through db(): still true, no edit.
- Code review FD5 and step 3.14: updated in the same change.

**Notes:** Do it now and leave the split of the file for step 3.14.
