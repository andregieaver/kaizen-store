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
