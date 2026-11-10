import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Drizzle's snapshots do not pile up again (D532): each is the whole schema as JSON, 2.7 MB, and only the newest is read.
 * `pnpm db:generate` prunes them; after `drizzle-kit generate --custom`, run `node scripts/prune-snapshots.mjs`.
 * A few are allowed, so two migrations made side by side and merged do not fail this before anyone has pruned.
 */
describe("the migrations' snapshots", () => {
  it("are the newest few, not one for every migration", () => {
    const snapshots = readdirSync(join(process.cwd(), "supabase/migrations/meta")).filter((name) => name.endsWith("_snapshot.json"));
    expect(snapshots.length, "run `node scripts/prune-snapshots.mjs`").toBeGreaterThan(0);
    expect(snapshots.length, "run `node scripts/prune-snapshots.mjs`").toBeLessThanOrEqual(5);
  });
});
