import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's four rows for data in and out (D165, `docs/wave-2-data.md` 5.5; migration `*_data_plan_features.sql`): described once, in the
 * category Data, within the table's length checks, in no plan until the platform's admin ticks one, and added again by nobody if the migration is run twice.
 */

let db: PGlite;

const NAMES = ["Product CSV import and export", "Order and customer CSV export", "Bulk product editing", "CSV for every analytics table"];
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261005132729_data_plan_features.sql"), "utf8");

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the plan comparison's rows for data in and out", () => {
  it("lists each feature once, in the category Data, with a description that fits the table's check", async () => {
    const { rows } = await db.query<{ name: string; category: string; description: string; position: number }>(
      "select name, category, description, position from commerce.plan_features where name = any($1) order by position",
      [NAMES],
    );
    expect(rows.map((r) => r.name)).toEqual(NAMES);
    for (const r of rows) {
      expect(r.category).toBe("Data");
      expect(r.description.length).toBeGreaterThan(40);
      expect(r.description.length).toBeLessThanOrEqual(300);
    }
  });

  it("is in no plan yet: a row describes and enables nothing", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = any($1)",
      [NAMES],
    );
    expect(rows[0].n).toBe(0);
  });

  it("states only what the product does: the limits are the data limits, and nothing is promised that is not built", async () => {
    const { rows } = await db.query<{ description: string }>("select description from commerce.plan_features where name = any($1)", [NAMES]);
    const text = rows.map((r) => r.description).join("\n");
    expect(text).toContain("5,000 products");
    expect(text).toContain("7 days");
    expect(text).not.toMatch(/unlimited|guarantee|instant/i);
  });

  it("adds nothing a second time when the migration is run again", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_features where name = any($1)", [NAMES]);
    expect(rows[0].n).toBe(4);
  });

  it("holds no DELETE or DROP: the migration tool cancels a function body that has one", () => {
    expect(MIGRATION).not.toMatch(/\b(delete|drop)\b/i);
  });
});
