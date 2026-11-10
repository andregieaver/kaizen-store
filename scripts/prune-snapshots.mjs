// Keeps only the newest Drizzle snapshot (D532).
//
// `drizzle-kit generate` writes the whole schema as JSON beside every migration (2.7 MB each), and reads only the newest
// to work out the next one. By November 2026 there were 775 of them, 1.1 GB in every clone, CI job and agent's checkout.
// `pnpm db:generate` runs this after generating; after `drizzle-kit generate --custom`, run it by hand:
//
//   node scripts/prune-snapshots.mjs
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const meta = join(fileURLToPath(new URL("..", import.meta.url)), "supabase/migrations/meta");
const snapshots = readdirSync(meta).filter((name) => /^\d{14}_snapshot\.json$/.test(name)).sort();
const old = snapshots.slice(0, -1);
for (const name of old) rmSync(join(meta, name));
console.log(old.length === 0 ? "Snapshots: only the newest is kept already." : `Snapshots: removed ${old.length}, kept ${snapshots.at(-1)}.`);
