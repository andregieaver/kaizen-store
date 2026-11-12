# SF-6 ✓ The Drizzle schema is built at every start though no code reads it

Server functions: size, cold start, per-request overhead (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.3.
- **Second check:** confirmed.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `src/db/schema.ts (19,614 lines, 481 tables)`, `drizzle.config.ts:7`, `docs/audits/code-review-2026-11.md:116`, `docs/audits/code-review-2026-11.md:268`, `docs/audits/code-review-2026-11.md:484`
- **Evidence:** src/db/client.ts is the only non-test importer of schema.ts (searched) and passes it to drizzle(); drizzle-kit reads the file by path for migrations. No code calls the query builder or a relational query (searched for db().select, insert, update, delete and .query.*.find*: none). Built, six files under .next/server hold the table definitions (rg -l -F '.table("theme_schedules"' .next/server -g '*.js' counts 6). The verified report timed the module: 600 KB of JS, 75 to 114 ms to evaluate and 7.32 MB of heap, evaluated twice per instance (once in the start hook's chunk, once in the route's); not re-run. On my graph the schema also brings 47 src/lib files into every importer of the client (client.ts reaches 49 files; 2 without it).
- **Cost today:** 75 to 114 ms and 7.3 MB per copy per cold start, and 0.6 MB of JS in every function that touches the database. Paid by: Every cold start; the server's memory.
- **Saving:** Measured by the verified report: about 75 to 114 ms and 7.3 MB per copy per cold start; /api/health's own start (159 to 163 ms) falls by about half. It also removes 47 src/lib files from the reach of every database route.
- **Risk:** Low: nothing reads db().query and no module but client.ts can name a table object. It would be noticed by the type check at once.
- **Already tracked:** yes: code review FD5, step 3.14 'Split schema.ts', Open (docs/audits/code-review-2026-11.md:116, 268, 484). This separates the one-line half from the file split and adds the measurement.

## The fix

1. The same edit as DP-1 and DS-1 of this review: make it once.
2. src/db/client.ts: delete line 11 (import * as schema from "./schema"). Line 31 becomes type Database = NodePgDatabase; line 78 becomes return { pool, database: withRows(drizzle({ client: pool })) }; Nothing else in the file changes; Db keeps its shape. schema.ts is not touched.
3. pnpm typecheck: any stray use of a typed table or of db().query fails here; none is expected.
4. pnpm db:check with DATABASE_URL set must write no migration (drizzle.config.ts still reads src/db/schema.ts).
5. pnpm test, pnpm test:int, pnpm build, then the done_when command.
6. docs/audits/code-review-2026-11.md in the same change (its own rule): the Progress row 3.14 says the client half is done with the date and commit and that the file split stays Open; FD5's row is corrected to 19,614 lines and 481 tables and says the import is gone; add a change-log line.

**Done when:** After pnpm build, rg -l -F '.table("theme_schedules"' .next/server -g '*.js' | wc -l prints 0 (6 today), and pnpm db:check exits 0.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/commerce.test.ts and the integration suites use db() through execute(); none passes a table object (searched).
- pnpm db:check in CI's integration job ('Migrations match the schema', .github/workflows/ci.yml:109).
- docs/audits/code-review-2026-11.md: Progress row 3.14, finding FD5 (line 268) and step text (line 484) change with it.

**Notes:** Do it first: three lines, measured, and every other finding's numbers get cleaner once the schema is out of every chunk.
