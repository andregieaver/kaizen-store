import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";

import { statementsOf } from "../../scripts/lib/migrations.mjs";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const cacheDir = path.join(process.cwd(), "node_modules", ".cache", "kaizen-test-db");

// Extensions the migrations create (Phase 2: keyword search's trigrams, search by meaning's vectors).
const extensions = { pg_trgm, vector };

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
}

/** Applies every migration, in order, to an empty database. */
async function migrated(): Promise<PGlite> {
  const db = new PGlite({ extensions });
  for (const file of await migrationFiles()) {
    // A file marked to run outside a transaction (code review FD4) goes statement by statement, as `scripts/db-migrate.mjs` sends it.
    for (const statement of statementsOf(await readFile(path.join(migrationsDir, file), "utf8"))) await db.exec(statement);
  }
  return db;
}

/** Where the migrated database is kept for this set of migration files: their names and sizes name it, so any change makes a new one. */
async function templatePath(): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await migrationFiles()) {
    hash.update(`${file}:${(await stat(path.join(migrationsDir, file))).size}\n`);
  }
  return path.join(cacheDir, `${hash.digest("hex").slice(0, 24)}.tar.gz`);
}

/**
 * Applies the migrations once and keeps the database they make (code review FD2), for `createTestDatabase()` to start from.
 * Run by Vitest before the test files (`src/test/test-db-template.ts`). Until November 2026 each of some 65 test files applied
 * every one of some 780 migrations to a database of its own.
 */
export async function buildTestDatabaseTemplate(): Promise<string> {
  const file = await templatePath();
  if (existsSync(file)) return file;
  const db = await migrated();
  const dump = await db.dumpDataDir("gzip");
  await db.close();
  await mkdir(cacheDir, { recursive: true });
  // Written beside and renamed, so a test file never reads half a template.
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, Buffer.from(await dump.arrayBuffer()));
  await rename(partial, file);
  return file;
}

/** A fresh in-memory Postgres with every migration applied: a copy of the kept one when there is one, else made here. */
export async function createTestDatabase(): Promise<PGlite> {
  const file = await templatePath();
  if (!existsSync(file)) return migrated();
  const db = new PGlite({ extensions, loadDataDir: new Blob([await readFile(file)]) });
  await db.waitReady;
  return db;
}
