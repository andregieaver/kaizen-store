// Applies every migration in supabase/migrations to an empty database, then
// optionally the demo catalogue. Used by CI and local development; production
// migrations are applied through Supabase.
//
//   DATABASE_URL=postgres://... node scripts/db-setup.mjs [--seed]
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const root = path.join(import.meta.dirname, "..", "supabase");

try {
  const migrations = (await readdir(path.join(root, "migrations")))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await sql.unsafe(await readFile(path.join(root, "migrations", file), "utf8"));
    console.log(`applied ${file}`);
  }
  if (process.argv.includes("--seed")) {
    await sql.unsafe(await readFile(path.join(root, "seed.sql"), "utf8"));
    console.log("seeded the demo catalogue");
  }
} finally {
  await sql.end();
}
