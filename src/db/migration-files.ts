import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { baselineThroughOf } from "../../scripts/lib/migrations.mjs";

/**
 * The migrations as production lived them (code review FD3, D570): the squashed files in `supabase/archive/<cut>/`, oldest first, then
 * the live ones in `supabase/migrations`, a baseline left out (it stands for the squashed files). For tests that read what one migration
 * said, or replay history up to a point; a database is built from the live folder alone (`src/db/testing.ts`).
 */

const root = path.join(process.cwd(), "supabase");
const live = path.join(root, "migrations");
const archive = path.join(root, "archive");

export type MigrationFile = { name: string; path: string };

const sqlIn = (dir: string): MigrationFile[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, path: path.join(dir, name) }));

/** Every migration ever written, oldest first, without the baselines. */
export function migrationHistory(): MigrationFile[] {
  const archived = existsSync(archive) ? readdirSync(archive).sort().flatMap((cut) => sqlIn(path.join(archive, cut))) : [];
  return [...archived, ...sqlIn(live)]
    .filter((file) => baselineThroughOf(readFileSync(file.path, "utf8")) === null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The one migration whose name is `match`, or ends as the pattern says (`/_returns_rules\.sql$/`); throws when there is not exactly one. */
export function findMigration(match: string | RegExp): MigrationFile {
  const found = migrationHistory().filter((file) => (typeof match === "string" ? file.name === match : match.test(file.name)));
  if (found.length !== 1) throw new Error(`${found.length} migrations match ${match}`);
  return found[0];
}

/** What that migration says. */
export const readMigration = (match: string | RegExp): string => readFileSync(findMigration(match).path, "utf8");
