import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INVENTORY_RETENTION_MONTHS } from "@/lib/inventory";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's row for the inventory work of wave 3 (D172, `docs/wave-3-inventory.md` 5.5; migration `*_inventory_plan_features.sql`): described once,
 * in the category Operations right after "Stock in several locations", within the table's length checks, in no plan until the platform's admin ticks one,
 * saying only what is built (the history's length is the code's own), and added by nobody a second time.
 */

let db: PGlite;

const NAME = "Inventory page, stock history, backorders and low-stock warnings";
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261006111639_inventory_plan_features.sql"), "utf8");

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the plan comparison's row for the inventory work", () => {
  it("is listed once, in Operations, right after Stock in several locations, with a description that fits the table's check", async () => {
    const { rows } = await db.query<{ category: string; description: string; position: number }>("select category, description, position from commerce.plan_features where name = $1", [NAME]);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Operations");
    expect(rows[0].description.length).toBeGreaterThan(40);
    expect(rows[0].description.length).toBeLessThanOrEqual(300);
    const { rows: before } = await db.query<{ position: number }>("select position from commerce.plan_features where name = 'Stock in several locations'");
    const { rows: next } = await db.query<{ position: number }>("select min(position)::int as position from commerce.plan_features where category = 'Operations' and position > $1 and name <> $2", [before[0].position, NAME]);
    expect(rows[0].position).toBeGreaterThan(before[0].position);
    expect(rows[0].position).toBeLessThan(next[0].position);
  });

  it("is in no plan yet: a row describes and enables nothing", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = $1", [NAME]);
    expect(rows[0].n).toBe(0);
  });

  it("states only what the product does: the history is kept as long as the code keeps it, and nothing is promised that is not built", async () => {
    const { rows } = await db.query<{ description: string }>("select description from commerce.plan_features where name = $1", [NAME]);
    expect(rows[0].description).toContain(`${INVENTORY_RETENTION_MONTHS} months`);
    expect(rows[0].description).not.toMatch(/unlimited|guarantee|real.?time|never oversell|transfer|purchase order|pre-?order/i);
  });

  it("adds nothing a second time when the migration is run again", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_features where name = $1", [NAME]);
    expect(rows[0].n).toBe(1);
  });

  it("holds no DELETE or DROP: the migration tool cancels a function body that has one", () => {
    expect(MIGRATION).not.toMatch(/\b(delete|drop)\b/i);
  });
});
