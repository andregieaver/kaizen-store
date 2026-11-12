# DS-1 ✓ Every server start loads the whole schema file, which no query uses

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.4.
- **Second check:** confirmed.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `src/instrumentation.ts:8`, `src/server/ui-text.ts:5`, `src/db/schema.ts:1`, `drizzle.config.ts:7`, `src/server/store-export.scan.test.ts:4`, `docs/audits/code-review-2026-11.md:116`, `docs/audits/code-review-2026-11.md:268`, `docs/audits/code-review-2026-11.md:484`
- **Evidence:** client.ts imports the whole schema (line 11) and hands it to drizzle() (line 78). No file uses the query builder: my rg for select, insert, update, delete, query or findMany on db() or tx finds only tests' own tx.query on PGlite. The only other importers of schema.ts are one scan test and drizzle.config.ts. The instance-start hook loads client.ts through ui-text.ts (instrumentation.ts:8). In the finished build 6 server chunk files hold the schema-only name orders_store_placed_idx. The verified timing, 11 runs: 85 to 100 ms to evaluate the module, 30 to 37 ms for drizzle to index it, 9 to 12 MB of heap.
- **Cost today:** About 115 to 135 ms of CPU and 9 to 12 MB of memory at every cold instance start (measured on this machine, not on Vercel); the schema's 652 KB of minified code in 6 server chunk files. Per cold instance, so it grows with traffic spread and deploys, not with stores. Paid by: The first shopper or owner on every cold instance; the build
- **Saving:** Measured here: about 115 to 135 ms and 9 to 12 MB per cold start, and the schema's code out of 6 server chunk files.
- **Risk:** Low. Nothing reads db().query or a table object. What could break: a type that used NodePgDatabase<typeof schema>; pnpm typecheck shows it at once.
- **Already tracked:** Code review FD5, step 3.14 'Split schema.ts': Open (docs/audits/code-review-2026-11.md:116, :268, :484). The measurements and the fact that the instance-start hook loads it are new.

## The fix

1. src/db/client.ts: delete line 11 (import * as schema from "./schema"). Line 31 becomes type Database = NodePgDatabase; (drizzle's default, an empty schema). Line 78 becomes drizzle({ client: pool }). Db, withRows(), readDb() and replicaDb() keep their shapes.
2. Add src/db/schema-import.scan.test.ts: walk src (tests left out) and fail when a file imports @/db/schema or ./schema, so the module cannot return to the running code. schema.ts stays where it is as the source for drizzle-kit (drizzle.config.ts:7) and for src/server/store-export.scan.test.ts.
3. Run pnpm typecheck, pnpm test and pnpm test:int: every server module compiles against Db, so a type that leaned on the schema generic would fail here (none was found).
4. pnpm build, then count the chunk files that still hold the schema: rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l.
5. In docs/audits/code-review-2026-11.md set step 3.14 to Done with the date and commit (its done-when is exactly this: client.ts no longer imports the schema and pnpm db:check writes no migration), correct FD5's line counts and add a change-log line. Say there that splitting the file by area was left: it saves reading only.

**Done when:** After pnpm build, rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l prints 0 (6 today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/client.test.ts imports ./client: must pass unchanged.
- src/server/store-export.scan.test.ts:4 imports @/db/schema and must keep working: it is a test, and step 2's scan leaves tests out.
- pnpm db:check and src/db/snapshots.scan.test.ts: untouched, schema.ts is not edited.
- Tests that read schema.ts as text or skip it by path (src/app/admin/admin-schemes.test.ts:149, src/lib/sql-raw.scan.test.ts:16, src/lib/payment-readers.scan.test.ts:71, src/server/store-starters.scan.test.ts:22, src/server/price-audit-scan.test.ts:23, scripts/lib/ratchet-count.mjs:27): untouched by step 1; they are what a later split by area would have to move.
- Rule: code review FD5 and step 3.14 (Open). CLAUDE.md Database ('Server code reaches it through db()') stays true.

**Notes:** Splitting schema.ts into src/db/schema/*.ts is P3: it saves no running cost once step 1 is in, and eight tests and one script name the file by path.
