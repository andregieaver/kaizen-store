# TC-5 ✓ The 19,614-line Drizzle schema is loaded at run time for a query builder nobody calls

Tests, CI and the build (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** dead. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** corrected.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `drizzle.config.ts:7`, `src/server/store-export.scan.test.ts:4`, `docs/audits/code-review-2026-11.md:116`, `docs/audits/code-review-2026-11.md:268`, `docs/audits/code-review-2026-11.md:484`
- **Evidence:** client.ts imports * from ./schema and passes it to drizzle() (line 78) and to the type NodePgDatabase<typeof schema> (line 31). Outside tests nothing calls the query builder: my rg for .select(, .insert(, .update(, .delete( and .query on db(), replicaDb(), tx or database finds only PGlite fixtures in src/db that call their own tx.query; drizzle-orm is imported 638 times for the sql tag. The only run-time importers of schema.ts are client.ts and one scan test (import graph). client.ts reaches 49 modules, 1.49 MB, with the schema and 2 modules, 18 KB, without. Under Vitest a test file that imports the client takes 0.58 s against 0.42 s for the same packages without the schema (20 probe files each: 11.3-11.9 s and 8.2-8.6 s). The verified report measured 135-147 ms and +55 MB to evaluate drizzle with the schema in plain Node against 12-20 ms and +6 MB without.
- **Cost today:** About 125 ms and 50 MB in every process that opens the database (plain Node). In tests, 0.16 s per file under Vitest: 525 integration files and 25 unit files load it, so about 84 s of the serial integration run, about 28 s in each shard. The same cost falls on each server cold start, paid more often once stores have shoppers. Paid by: The server per cold start; CI's integration shards and agents running integration tests
- **Saving:** Server: about 125 ms and 50 MB per cold start (plain Node, not measured on Vercel). Tests: 0.16 s per file that opens the database, measured under Vitest: about 84 s of the integration run across its three shards and about 4 CPU-seconds of the unit run.
- **Risk:** Low. What could break: code that reads db().query or relies on the schema-typed database; the type check fails on it before anything ships. drizzle-kit's migrations do not go through client.ts.
- **Already tracked:** Yes. Code review FD5, step 3.14 'Split schema.ts' (Open). New here: the measured cost, and that the first half can ship alone as an S ahead of the M split.

## The fix

1. src/db/client.ts: delete line 11 (`import * as schema from "./schema"`); line 31 becomes `type Database = NodePgDatabase;`; line 78 becomes `drizzle({ client: pool })`. Nothing else in the file changes.
2. Run `pnpm typecheck`: it names any hidden reader of `db().query` or of the schema's types (none by rg).
3. Run `pnpm db:check`: drizzle-kit still reads src/db/schema.ts through drizzle.config.ts:7 and must write no migration.
4. Run one integration shard and the unit tests of src/db.
5. In docs/audits/code-review-2026-11.md set step 3.14 to In progress with the date and commit (first half done: client.ts no longer imports the schema; the split into files stays open) and add a change-log line.

**Done when:** `rg -c schema src/db/client.ts` prints nothing, `pnpm db:check` passes, and the import graph of TC-2 (or scratch graph.mjs) shows src/db/client.ts reaching 2 modules instead of 49.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/client.test.ts (34 lines) does not mention the schema.
- src/server/store-export.scan.test.ts:4 imports the schema itself and scripts/lib/ratchet-count.mjs reads schema.ts as text: both unaffected.
- src/server/replica-readers.scan.test.ts and src/lib/sql-raw.scan.test.ts read who uses client.ts; the exports do not change.
- Code review FD5, step 3.14 (Open): its fix begins with exactly this and its done-when is that client.ts no longer imports the schema.
- CLAUDE.md, Database: 'Commerce tables live in the private commerce schema (src/db/schema.ts)' stays true; the file remains drizzle-kit's source.

**Notes:** Three lines. Do it before TC-13, which removes most of what is left of the client's import time in tests.
