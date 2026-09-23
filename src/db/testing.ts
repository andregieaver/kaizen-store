import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

/** A fresh in-memory Postgres with every migration applied, in order. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}
