// Squashes the migrations up to a cut into a baseline (code review step 1.7, finding FD3, D572). Repeat it each quarter.
//
//   DATABASE_URL=postgres://postgres:…@127.0.0.1:5432/postgres node scripts/squash-migrations.mjs --through=<file>          check only
//   DATABASE_URL=postgres://postgres:…@127.0.0.1:5432/postgres node scripts/squash-migrations.mjs --through=<file> --write  write it
//
// DATABASE_URL is a local server where scratch databases may be made (never production). It builds one database from every file up to
// and including <file>, dumps it with pg_dump in its three sections, and writes them as the baseline: `…_baseline_1_schema.sql` (types,
// tables, functions), `…_baseline_2_data.sql` (the reference data the migrations wrote) and `…_baseline_3_rules.sql` (keys, indexes,
// triggers, row security), each starting `-- kaizen:baseline-through=<file>`. What a dump of one database cannot carry is kept by hand in
// `…_baseline_4_roles_and_supabase.sql`: the `postgres` role's limits, and what exists only on Supabase (Storage buckets, the scheduled
// jobs, the scheduler's secret), each step guarded so plain Postgres skips it. It is carried forward to the new cut; fold into it any
// such step of a squashed file that it does not have yet (the check lists the squashed files with one).
//
// The check builds a second database from the baseline and compares the two (pg_dump of the schema, and of the data): they must be the
// same. With --write the squashed files move to supabase/archive/<cut's version>/ (out of every path that applies migrations; tests that
// read an old file find it through `src/db/migration-files.ts`) and Drizzle's journal lists the baseline in their place.
//
// Production has applied the squashed files already: `scripts/db-migrate.mjs` records a baseline file without running it where the
// ledger has the file it names, and runs it on an empty database.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { applyMigration, listMigrationFiles, migrationsDir, root, withDatabase } from "./lib/migrations.mjs";

const through = process.argv.find((arg) => arg.startsWith("--through="))?.split("=")[1];
const write = process.argv.includes("--write");
const url = process.env.DATABASE_URL;
if (!url || !through) {
  console.error("Usage: DATABASE_URL=<a local server> node scripts/squash-migrations.mjs --through=<file> [--write]");
  process.exit(1);
}
if (/supabase\.(co|com)|pooler/.test(url)) {
  console.error("DATABASE_URL looks like Supabase. This makes and drops scratch databases: point it at a local server.");
  process.exit(1);
}

const files = await listMigrationFiles();
if (!files.includes(through)) {
  console.error(`${through} is not a migration file.`);
  process.exit(1);
}
const squashed = files.filter((file) => file <= through);
const keptOrExtras = files.filter((file) => file > through);
const read = (file) => readFileSync(path.join(migrationsDir, file), "utf8");
const previousExtras = squashed.find((file) => /_baseline_4_roles_and_supabase\.sql$/.test(file));

// The baseline's names: the seconds after the cut, so they sort after every squashed file and before every kept one.
const version = through.slice(0, 14);
const nextSecond = (n) => {
  const t = new Date(Date.UTC(+version.slice(0, 4), +version.slice(4, 6) - 1, +version.slice(6, 8), +version.slice(8, 10), +version.slice(10, 12), +version.slice(12, 14) + n));
  return t.toISOString().replace(/\D/g, "").slice(0, 14);
};
const names = ["baseline_1_schema", "baseline_2_data", "baseline_3_rules", "baseline_4_roles_and_supabase"].map((name, i) => `${nextSecond(i + 1)}_${name}.sql`);
const kept = keptOrExtras.filter((file) => !names.includes(file));
if (kept.some((file) => file <= names[3])) {
  console.error(`A kept file sorts before the baseline's last name (${names[3]}): pick a later cut.`);
  process.exit(1);
}

const admin = postgres(url, { max: 1, onnotice: () => {} });
const ALL = "kaizen_squash_all";
const BASE = "kaizen_squash_base";
const fresh = async (name) => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
};
const applyAll = async (name, list) => {
  const db = postgres(withDatabase(url, name), { max: 1, onnotice: () => {} });
  try {
    for (const { file, text } of list) {
      try {
        await applyMigration(db, text);
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    await db.end();
  }
};
const dump = (name, ...args) => execFileSync("pg_dump", ["--no-owner", "--dbname", withDatabase(url, name), ...args], { encoding: "utf8", maxBuffer: 1 << 30 });

/** A section of the dump as a migration: its `SET`s undone at the end, so the files after it run with the session as it was. */
function asMigration(section, purpose) {
  const lines = section
    .split("\n")
    .filter((line) => !/^-- (Dumped (from|by)|PostgreSQL database dump)/.test(line) && !line.startsWith("\\"));
  const settings = [...new Set(lines.map((line) => line.match(/^SET (\w+) =/)?.[1]).filter(Boolean))];
  const resets = [...settings, "search_path"].map((name) => `RESET ${name};`).join("\n");
  return `-- kaizen:baseline-through=${through}\n-- ${purpose}\n-- Made by scripts/squash-migrations.mjs from every migration up to ${through} (code review FD3, D572); the squashed\n-- files are in supabase/archive/${version}/. Never edit this file: production recorded it without running it.\n${lines.join("\n").trim()}\n\n${resets}\n`;
}

let failed = false;
try {
  console.log(`Building every migration up to ${through} (${squashed.length} files)…`);
  await fresh(ALL);
  await applyAll(ALL, squashed.map((file) => ({ file, text: read(file) })));

  const pre = dump(ALL, "--section=pre-data");
  const data = dump(ALL, "--section=data", "--column-inserts", "--rows-per-insert=50");
  const post = dump(ALL, "--section=post-data");
  const extrasText = previousExtras
    ? read(previousExtras).replace(/^-- kaizen:baseline-through=.*$/m, `-- kaizen:baseline-through=${through}`)
    : readFileSync(path.join(migrationsDir, names[3]), "utf8");
  const baseline = [
    asMigration(pre, "The schema: types, tables, functions and views."),
    asMigration(data, "The reference data the migrations wrote: countries, rates, plans, platform pages and the like."),
    asMigration(post, "Keys, indexes, triggers and row security, added after the data as a restore does."),
    extrasText,
  ];

  console.log("Building the baseline and comparing…");
  await fresh(BASE);
  await applyAll(BASE, baseline.map((text, i) => ({ file: names[i], text })));
  const normal = (text) => text.split("\n").filter((line) => !/^-- (Dumped|PostgreSQL)/.test(line) && !/^\\(un)?restrict /.test(line)).join("\n");
  const compared = {
    schemaAll: normal(dump(ALL, "--schema-only")),
    schemaBase: normal(dump(BASE, "--schema-only")),
    dataAll: normal(dump(ALL, "--data-only", "--column-inserts")),
    dataBase: normal(dump(BASE, "--data-only", "--column-inserts")),
  };
  // The schema line by line, where a line may differ only in its parentheses: Postgres keeps a check's `(a AND b) AND c` as read and
  // writes it back as `a AND b AND c`, so a restored check reads with fewer of them and means the same.
  const schemaLines = [compared.schemaAll.split("\n"), compared.schemaBase.split("\n")];
  const bare = (line) => line.replace(/[()]/g, "");
  const regrouped = schemaLines[0].filter((line, i) => line !== schemaLines[1][i]);
  const sameSchema = schemaLines[0].length === schemaLines[1].length && schemaLines[0].every((line, i) => bare(line) === bare(schemaLines[1][i]));
  // The data as rows, in any order: a table's place in the dump follows its internal id, which a restore changes.
  const rows = (text) => text.split("\n").filter((line) => line && !line.startsWith("--")).sort().join("\n");
  const sameData = rows(compared.dataAll) === rows(compared.dataBase);
  if (sameSchema) console.log(`${regrouped.length} lines of the schema differ only in a check's parentheses.`);
  // SQUASH_KEEP=<folder> keeps both dumps there, to compare by eye when they differ.
  if (process.env.SQUASH_KEEP) {
    mkdirSync(process.env.SQUASH_KEEP, { recursive: true });
    for (const [name, text] of Object.entries(compared)) writeFileSync(path.join(process.env.SQUASH_KEEP, `${name}.sql`), text);
  }
  const roles = async (name) => {
    const db = postgres(withDatabase(url, name), { max: 1, onnotice: () => {} });
    try {
      return JSON.stringify(await db`select rolname, rolconfig from pg_roles where rolname = current_user`);
    } finally {
      await db.end();
    }
  };
  console.log(`schema the same: ${sameSchema}; data the same: ${sameData}; the role's settings: ${await roles(BASE)}`);
  const guarded = squashed.filter((file) => file > (previousExtras ?? "") && /storage\.buckets|cron\.(schedule|alter_job|unschedule)|vault\.|ALTER ROLE/i.test(read(file)));
  if (guarded.length) console.log(`Squashed files with a step for ${names[3]} (check it has each):\n  ${guarded.join("\n  ")}`);
  if (!sameSchema || !sameData) {
    failed = true;
    console.error("The baseline does not make the same database. Nothing is written.");
  } else if (write) {
    baseline.forEach((text, i) => writeFileSync(path.join(migrationsDir, names[i]), text));
    const archive = path.join(root, "archive", version);
    mkdirSync(archive, { recursive: true });
    for (const file of squashed) renameSync(path.join(migrationsDir, file), path.join(archive, file));
    const journalPath = path.join(migrationsDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const keep = journal.entries.filter((entry) => `${entry.tag}.sql` > through);
    const when = journal.entries.find((entry) => `${entry.tag}.sql` === through)?.when ?? Date.now();
    journal.entries = [...names.map((name, i) => ({ idx: 0, version: "7", when: when + i + 1, tag: name.replace(/\.sql$/, ""), breakpoints: true })), ...keep].map(
      (entry, idx) => ({ ...entry, idx }),
    );
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    console.log(`Wrote ${names.join(", ")}; moved ${squashed.length} files to supabase/archive/${version}/.`);
  } else {
    console.log("The check passed. Run again with --write to write it.");
  }
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${ALL} WITH (FORCE)`).catch(() => {});
  await admin.unsafe(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`).catch(() => {});
  await admin.end();
}
process.exit(failed ? 1 : 0);

