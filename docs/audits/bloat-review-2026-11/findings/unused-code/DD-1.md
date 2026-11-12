# DD-1 ✓ Every cold start evaluates the 19,614-line schema that no query reads

Code nothing uses (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P0. **Effort:** S. **Confidence:** high. **Step:** 0.3.
- **Second check:** confirmed.
- **Where:** `src/db/client.ts:11`, `src/db/client.ts:31`, `src/db/client.ts:78`, `src/db/schema.ts:19`, `drizzle.config.ts:7`, `docs/audits/code-review-2026-11.md:116`, `docs/audits/code-review-2026-11.md:268`
- **Evidence:** src/db/client.ts imports the whole schema as a value (line 11), uses it as a type (line 31) and hands it to drizzle (line 78). Nothing else imports it at run time: rg over src, scripts and e2e finds client.ts, one scan test (src/server/store-export.scan.test.ts:4) and drizzle.config.ts. No code uses the query builder: rg for db().select, .insert, .query and for $inferSelect or InferSelectModel finds nothing outside src/db; every query is raw SQL through execute. The skeptic timed the module three times on an esbuild bundle: 117 to 149 ms to evaluate and 16 MB of heap; drizzle's init with the schema 32 to 36 ms and 2.3 MB, against 0.03 to 0.04 ms without. In the finished build 6 server chunk files hold the schema (the planner re-ran rg -l -F orders_store_placed_idx over .next/server: 6).
- **Cost today:** 150 to 190 ms and about 18 MB on each cold start of a function that touches the database (measured on this machine on the schema alone; DS-1 and DP-1 measured 60 to 135 ms on whole routes; an estimate for Vercel either way), and about 0.8 MB of JavaScript in each of 6 server chunks (measured). Paid by: The server on every cold start, so the first shopper or owner to reach a fresh instance. Today that is mostly scheduled jobs and the team. It grows with stores, traffic spikes and deploys: more instances, more cold starts.
- **Saving:** 150 to 190 ms and about 18 MB per cold start by the skeptic's measure of the schema alone (60 to 135 ms by DS-1's and DP-1's whole-route measures; an estimate for Vercel), and about 0.8 MB off each of 6 server chunks (measured).
- **Risk:** Low. What could break: a type somewhere that leaned on the schema generic; pnpm typecheck shows it before the push (Vercel's build skips the type check, so the local run and CI's quick gate are the proof). A change to schema.ts that no longer matches the migrations would still be caught by pnpm db:check.
- **Already tracked:** Code review step 3.14 Split schema.ts (finding FD5): Open. The same three lines are planned as DS-1 (db-schema) and DP-1 (deps) and found again as SG-6 and TC-5: one change, done once.

## The fix

1. src/db/client.ts: delete line 11 (import * as schema from "./schema"). Line 31 becomes: type Database = NodePgDatabase; Line 78 becomes: return { pool, database: withRows(drizzle({ client: pool })) }; Nothing else in the file changes: Db, withRows(), db() and replicaDb() keep their shapes. src/db/schema.ts is not touched; it stays the source drizzle-kit reads (drizzle.config.ts:7).
2. Keep it out: add src/db/schema-import.scan.test.ts that walks src (tests and test support left out) and fails when a file imports @/db/schema or ./schema, naming the file. If DD-4's scan lands in the same change, make this a case of it instead.
3. Run pnpm typecheck (it fails if any code read a table object or db().query: none is expected), pnpm db:check with DATABASE_URL set (it must write no migration), pnpm lint, pnpm test and pnpm test:int.
4. pnpm build, then run the done_when command.
5. docs/audits/code-review-2026-11.md in the same change, as its own rule asks: Progress row 3.14 says the client.ts half is done with the date and commit and the file split stays open; FD5's row gets today's numbers (19,614 lines, 481 tables) and says the import is gone; add a change-log line.

**Done when:** After pnpm build, rg -l --no-ignore -F orders_store_placed_idx .next/server -g '*.js' | wc -l prints 0 (6 today), and pnpm db:check exits 0.

**Tests and rules that hold today's behaviour, and change with it:**

- src/db/client.test.ts (isTransientDbError, retryTransient): must pass unchanged.
- src/server/store-export.scan.test.ts:4 imports @/db/schema on purpose: it is a test and stays; step 2's scan leaves tests out.
- pnpm db:check in CI's integration job and src/db/snapshots.scan.test.ts: unaffected, schema.ts is not edited.
- Files that read schema.ts as text (scripts/lib/ratchet-count.mjs:27 and the scan tests DS-1 lists): unaffected.
- Rules: code review finding FD5 and step 3.14 (Open); CLAUDE.md Database ('Server code reaches it through db()') stays true and needs no edit.

**Notes:** This is the only item of this dimension with a run-time price. Splitting schema.ts into files by area is P3: once the import is gone it saves reading only. Not argued from use: the cost is paid whatever a store sells.
