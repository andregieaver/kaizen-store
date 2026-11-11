import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withDatabase } from "../../scripts/lib/migrations.mjs";

/**
 * The migration runner's no-transaction marker (code review step 1.6, finding FD4), on a scratch database of its own: a marked file
 * builds its index concurrently (Postgres refuses that inside a transaction, so the plain path would fail), is recorded in the ledger,
 * and a marked file that fails leaves neither a ledger row nor a half-built index behind, so the next run can apply it again.
 */

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const run = promisify(execFile);
const NAME = `kaizen_migrate_${process.pid}`;

suite("db-migrate.mjs: -- kaizen:no-transaction and baselines", () => {
  let admin: postgres.Sql;
  let scratch: postgres.Sql;
  let dir: string;

  const write = (file: string, text: string) => writeFileSync(path.join(dir, file), text);
  const migrate = (...args: string[]) =>
    run(process.execPath, ["scripts/db-migrate.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: withDatabase(url!, NAME), MIGRATIONS_DIR: dir, MIGRATE_EXPECT: "", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", GITHUB_OUTPUT: "" },
    }).then(
      (out) => ({ ok: true, out: out.stdout + out.stderr }),
      (error: { stdout?: string; stderr?: string }) => ({ ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` }),
    );

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.unsafe(`CREATE DATABASE ${NAME}`);
    scratch = postgres(withDatabase(url!, NAME), { max: 1, onnotice: () => {} });
    dir = mkdtempSync(path.join(tmpdir(), "kaizen-migrations-"));
    write("20990101000000_start.sql", "CREATE TABLE public.busy (id int PRIMARY KEY, code text);\nINSERT INTO public.busy SELECT g, 'c' || (g % 3) FROM generate_series(1, 300) g;\n");
    expect((await migrate("--baseline-through=20990101000000_start.sql")).ok).toBe(true);
    // The baseline records without running: the table is made here, as it was "already applied".
    await scratch.unsafe("CREATE TABLE public.busy (id int PRIMARY KEY, code text); INSERT INTO public.busy SELECT g, 'c' || (g % 3) FROM generate_series(1, 300) g;");
  });

  afterAll(async () => {
    await scratch?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const ledger = async () => (await scratch.unsafe("SELECT file FROM supabase_migrations.kaizen_files ORDER BY file")).map((row) => row.file as string);
  const index = async (name: string) => {
    const [row] = await scratch.unsafe("SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1", [name]);
    return row ? { valid: Boolean(row.valid) } : undefined;
  };

  it("builds a marked file's index concurrently, outside a transaction, and records the file", async () => {
    write(
      "20990102000000_busy_code.sql",
      "-- kaizen:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS busy_code_idx ON public.busy (code);\n--> statement-breakpoint\nANALYZE public.busy;\n",
    );
    const result = await migrate();
    expect(result.out).toContain("applied 20990102000000_busy_code.sql");
    expect(result.ok).toBe(true);
    expect(await index("busy_code_idx")).toEqual({ valid: true });
    expect(await ledger()).toContain("20990102000000_busy_code.sql");
  });

  it("refuses the same statement in an unmarked file: Postgres will not build concurrently inside a transaction", async () => {
    write("20990103000000_unmarked.sql", "CREATE INDEX CONCURRENTLY IF NOT EXISTS busy_id_code_idx ON public.busy (id, code);\n");
    const result = await migrate();
    expect(result.ok).toBe(false);
    expect(result.out).toMatch(/cannot run inside a transaction block/);
    expect(await ledger()).not.toContain("20990103000000_unmarked.sql");
    rmSync(path.join(dir, "20990103000000_unmarked.sql"));
  });

  it("leaves no ledger row and no half-built index when a marked file fails, so it runs again once fixed", async () => {
    // The codes repeat, so a unique index fails part-way and Postgres keeps it, invalid.
    write("20990104000000_unique_code.sql", "-- kaizen:no-transaction\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS busy_code_key ON public.busy (code);\n");
    const failed = await migrate();
    expect(failed.ok).toBe(false);
    expect(failed.out).toContain("dropped the half-built busy_code_key");
    expect(await index("busy_code_key")).toBeUndefined();
    expect(await ledger()).not.toContain("20990104000000_unique_code.sql");

    // Once the data allows it, the same file goes through.
    await scratch.unsafe("UPDATE public.busy SET code = 'c' || id");
    expect((await migrate()).ok).toBe(true);
    expect(await index("busy_code_key")).toEqual({ valid: true });
    expect(await ledger()).toContain("20990104000000_unique_code.sql");
  });

  it("records a baseline of files it has applied without running it (code review FD3), and runs a baseline of files it has not", async () => {
    // Run, this would fail: it stands for the files up to the cut, which this database has had.
    write("20990105000000_baseline_1_schema.sql", "-- kaizen:baseline-through=20990104000000_unique_code.sql\nSELECT 1 / 0;\n");
    write("20990105000001_baseline_of_elsewhere.sql", "-- kaizen:baseline-through=20990109000000_not_here.sql\nCREATE TABLE public.ran (id int);\n");
    const result = await migrate();
    expect(result.ok).toBe(true);
    expect(result.out).toContain("recorded 20990105000000_baseline_1_schema.sql");
    expect(await ledger()).toEqual(expect.arrayContaining(["20990105000000_baseline_1_schema.sql", "20990105000001_baseline_of_elsewhere.sql"]));
    expect((await scratch.unsafe("SELECT to_regclass('public.ran') AS t"))[0].t).toBe("ran");
  });
});
