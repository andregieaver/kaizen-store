// Shared by scripts/db-migrate.mjs and scripts/db-template.mjs: the migration files, their
// checksums and the demo seed. Plain Node, no app imports.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const root = path.join(import.meta.dirname, "..", "..", "supabase");
// MIGRATIONS_DIR points the scripts at another folder (their own tests do).
export const migrationsDir = process.env.MIGRATIONS_DIR || path.join(root, "migrations");

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Every migration file name, oldest first (the names start with a timestamp). */
export async function listMigrationFiles() {
  return (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
}

/** [{ file, sql, checksum }] for every migration file, oldest first. */
export async function readMigrations() {
  const files = await listMigrationFiles();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      return { file, sql, checksum: sha256(sql) };
    }),
  );
}

export async function readSeed() {
  const sql = await readFile(path.join(root, "seed.sql"), "utf8");
  return { sql, checksum: sha256(sql) };
}

/** `postgres://user:pw@host:port/db` with another database name (the password is kept). */
export function withDatabase(url, name) {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

/**
 * A migration whose first line is this marker runs outside a transaction, one statement at a time (code review FD4): what Postgres
 * refuses inside one, above all `create index concurrently`, which builds an index on a busy table without blocking its writes.
 * Its statements are separated as Drizzle separates them (`--> statement-breakpoint`). `docs/ci-migrations.md` has the rule.
 */
export const NO_TRANSACTION = "-- kaizen:no-transaction";

/** Whether a migration's text asks to run outside a transaction: the marker is its first line. */
export const runsOutsideTransaction = (text) => text.replace(/^﻿/, "").split("\n", 1)[0].trim() === NO_TRANSACTION;

/** The statements to send one by one: a marked file's, split at its breakpoints (parts that are only comments left out), else the whole text. */
export function statementsOf(text) {
  if (!runsOutsideTransaction(text)) return [text];
  return text
    .split(/^-->\s*statement-breakpoint\s*$/m)
    .map((part) => part.trim())
    .filter((part) => part.split("\n").some((line) => line.trim() !== "" && !line.trim().startsWith("--")));
}

/** Applies one migration's text: a marked file statement by statement on `sql` itself, any other in one call (`sql` may be a transaction). */
export async function applyMigration(sql, text) {
  for (const statement of statementsOf(text)) await sql.unsafe(statement);
}

/** The indexes a marked file names (`create [unique] index concurrently [if not exists] name`). */
export const indexNamesIn = (text) =>
  [...text.matchAll(/create\s+(?:unique\s+)?index\s+concurrently\s+(?:if\s+not\s+exists\s+)?("?)([a-z0-9_]+)\1/gi)].map((match) => match[2]);

/**
 * A baseline file's cut (code review FD3, D572): its first line is `-- kaizen:baseline-through=<file>`. It stands for every migration up
 * to that file: run on an empty database, recorded without running where the ledger has that file (`scripts/db-migrate.mjs`).
 */
export const baselineThroughOf = (text) => text.replace(/^\uFEFF/, "").split("\n", 1)[0].match(/^-- kaizen:baseline-through=(\S+\.sql)\s*$/)?.[1] ?? null;

/** Where squashed migrations are kept (`supabase/archive/<cut's version>/`): out of every path that applies migrations. */
export const archiveDir = path.join(root, "archive");
