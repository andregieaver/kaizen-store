// Applies the migrations in supabase/migrations that a database has not had yet, and records
// each one in a ledger (supabase_migrations.kaizen_files: file name and checksum). This is what
// CI runs against production after the tests pass (docs/ci-migrations.md); it can also run
// against any other database.
//
//   DATABASE_URL=postgres://... node scripts/db-migrate.mjs            apply what is pending
//   DATABASE_URL=postgres://... node scripts/db-migrate.mjs --status   list pending, edited and missing files
//   DATABASE_URL=postgres://... node scripts/db-migrate.mjs --baseline-through=<file>
//       once, on a database that already has migrations applied some other way: record every file up to and
//       including <file> as applied without running it (refused when the ledger already has rows)
//
// Rules: files are applied in name order, each in its own transaction together with its ledger
// row (a failure leaves the database as it was before that file); a file already applied and
// edited since is refused (a new migration, never an edit of an applied one); one run at a time
// (an advisory lock); MIGRATE_EXPECT, when set, must appear in the connection string, so a wrong
// secret never reaches the wrong database.
import { appendFileSync } from "node:fs";

import postgres from "postgres";

import { migrationsDir, readMigrations } from "./lib/migrations.mjs";

const args = new Set(process.argv.slice(2));
const baselineThrough = process.argv.find((arg) => arg.startsWith("--baseline-through="))?.split("=")[1];
const LEDGER = "supabase_migrations.kaizen_files";
const LOCK = 727001;

const CREATE_LEDGER = `
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS ${LEDGER} (
  file text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT 'ci'
);
ALTER TABLE ${LEDGER} ENABLE ROW LEVEL SECURITY;
`;

function summary(lines) {
  const text = lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (process.env.MIGRATE_EXPECT && !url.includes(process.env.MIGRATE_EXPECT)) {
  console.error(`DATABASE_URL does not contain MIGRATE_EXPECT (${process.env.MIGRATE_EXPECT}); refusing to run.`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 30 });
let failed = false;

try {
  await sql`select pg_advisory_lock(${LOCK})`;
  await sql.unsafe(CREATE_LEDGER);

  const files = await readMigrations();
  let recorded = new Map((await sql.unsafe(`SELECT file, checksum FROM ${LEDGER}`)).map((row) => [row.file, row.checksum]));
  if (baselineThrough) {
    if (recorded.size > 0) {
      console.error("The ledger already has rows; --baseline-through is only for an empty one.");
      process.exit(1);
    }
    const known = files.find((entry) => entry.file === baselineThrough);
    if (!known) {
      console.error(`${baselineThrough} is not a migration file.`);
      process.exit(1);
    }
    const upTo = files.filter((entry) => entry.file <= baselineThrough);
    await sql.begin(async (tx) => {
      for (const entry of upTo) {
        await tx.unsafe(`INSERT INTO ${LEDGER} (file, checksum, applied_by) VALUES ($1, $2, 'baseline')`, [entry.file, entry.checksum]);
      }
    });
    console.log(`Recorded ${upTo.length} files up to ${baselineThrough} as applied (not run).`);
    recorded = new Map(upTo.map((entry) => [entry.file, entry.checksum]));
  }
  if (recorded.size === 0) {
    console.error(
      "The ledger is empty. Record the files that are already applied first " +
        "(node scripts/db-migrate.mjs --baseline-through=<last applied file>); applying everything would repeat them.",
    );
    process.exit(1);
  }

  const onDisk = new Set(files.map((entry) => entry.file));
  const edited = files.filter((entry) => recorded.has(entry.file) && recorded.get(entry.file) !== entry.checksum);
  const missing = [...recorded.keys()].filter((file) => !onDisk.has(file));
  const pending = files.filter((entry) => !recorded.has(entry.file));
  const newest = [...recorded.keys()].sort().at(-1);
  const older = pending.filter((entry) => newest && entry.file < newest);

  const report = [
    `Migrations in ${migrationsDir.split("/").slice(-3).join("/")}: ${files.length}, recorded ${recorded.size}, pending ${pending.length}.`,
    ...pending.map((entry) => `  pending: ${entry.file}`),
    ...older.map((entry) => `  note: ${entry.file} is older than the newest applied file (a lane merged late); it is applied now, in order.`),
    ...edited.map((entry) => `  EDITED after it was applied: ${entry.file}`),
    ...missing.map((file) => `  missing on disk: ${file}`),
  ];

  if (args.has("--status")) {
    summary(report);
    process.exit(edited.length ? 1 : 0);
  }
  if (edited.length) {
    summary([...report, "", "Refusing to run: an applied migration was edited. Put the change in a new migration."]);
    process.exit(1);
  }
  if (pending.length === 0) {
    summary(report);
    process.exit(0);
  }

  for (const entry of pending) {
    const started = Date.now();
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL lock_timeout = '30s'");
        await tx.unsafe("SET LOCAL statement_timeout = '10min'");
        await tx.unsafe(entry.sql);
        await tx.unsafe(`INSERT INTO ${LEDGER} (file, checksum, applied_by) VALUES ($1, $2, $3)`, [
          entry.file,
          entry.checksum,
          process.env.GITHUB_ACTIONS ? "ci" : "manual",
        ]);
      });
    } catch (error) {
      failed = true;
      summary([...report, "", `FAILED ${entry.file} (rolled back, nothing from it is applied): ${error instanceof Error ? error.message : error}`]);
      break;
    }
    // Keep Supabase's own history in step where it can be (its versions are timestamps).
    try {
      const [version, ...rest] = entry.file.replace(/\.sql$/, "").split("_");
      await sql.unsafe(
        "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [version, rest.join("_")],
      );
    } catch {
      /* the history table is Supabase's own; the ledger is the record that matters */
    }
    console.log(`applied ${entry.file} in ${Date.now() - started} ms`);
  }
  if (!failed) summary([...report, "", `Applied ${pending.length} migration(s).`]);
} finally {
  try {
    await sql`select pg_advisory_unlock(${LOCK})`;
  } catch {
    /* the connection is closing anyway */
  }
  await sql.end();
}
process.exit(failed ? 1 : 0);
