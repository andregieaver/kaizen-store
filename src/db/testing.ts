import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

/** A fresh in-memory Postgres with every migration applied, in order. */
export async function createTestDatabase(): Promise<PGlite> {
  // Extensions the migrations create (keyword search's trigrams, Phase 2).
  const db = new PGlite({ extensions: { pg_trgm } });
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}
