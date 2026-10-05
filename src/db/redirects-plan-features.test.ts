import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REDIRECTS_MAX } from "@/lib/data-limits";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's two rows for redirects and categories' SEO texts (D168, `docs/wave-2-redirects.md` 5.5; migration `*_redirects_plan_features.sql`):
 * described once, in the category Storefront and catalogue after its last row, within the table's length checks, in no plan until the platform's admin ticks
 * one, saying only what is built (the limit is the code's own), and added by nobody a second time.
 */

let db: PGlite;

const NAMES = ["Redirects and 404 report", "SEO title and description for categories and tags"];
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261005171916_redirects_plan_features.sql"), "utf8");

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the plan comparison's rows for redirects and categories' SEO texts", () => {
  it("lists each feature once, after the category's other rows, with a description that fits the table's check", async () => {
    const { rows } = await db.query<{ name: string; category: string; description: string; position: number }>(
      "select name, category, description, position from commerce.plan_features where name = any($1) order by position",
      [NAMES],
    );
    expect(rows.map((r) => r.name)).toEqual(NAMES);
    const { rows: others } = await db.query<{ top: number }>("select max(position)::int as top from commerce.plan_features where category = 'Storefront and catalogue' and name <> all($1)", [NAMES]);
    for (const r of rows) {
      expect(r.category).toBe("Storefront and catalogue");
      expect(r.description.length).toBeGreaterThan(40);
      expect(r.description.length).toBeLessThanOrEqual(300);
      expect(r.position).toBeGreaterThan(others[0].top);
    }
  });

  it("is in no plan yet: a row describes and enables nothing", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = any($1)",
      [NAMES],
    );
    expect(rows[0].n).toBe(0);
  });

  it("states only what the product does: the limit is the code's own, and nothing is promised that is not built", async () => {
    const { rows } = await db.query<{ description: string }>("select description from commerce.plan_features where name = any($1)", [NAMES]);
    const text = rows.map((r) => r.description).join("\n");
    expect(text).toContain(`${REDIRECTS_MAX.toLocaleString("en-US")} manual redirects`);
    expect(text).not.toMatch(/unlimited|guarantee|instant|rank|traffic/i);
  });

  it("adds nothing a second time when the migration is run again", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_features where name = any($1)", [NAMES]);
    expect(rows[0].n).toBe(2);
  });

  it("holds no DELETE or DROP: the migration tool cancels a function body that has one", () => {
    expect(MIGRATION).not.toMatch(/\b(delete|drop)\b/i);
  });
});
