import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EDIT_PAY_DAYS, PICK_LIST_MAX } from "@/lib/fulfilment-limits";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's rows for wave 3, run 3 (D174, `docs/wave-3-fulfilment.md` 5.5; migration `*_fulfilment_plan_features.sql`): three rows described once in the
 * category Operations right after D173's order rows, within the table's length checks, in no plan until the platform's admin ticks one, saying only what is built (every
 * limit named is the code's own), and added by nobody a second time.
 */

let db: PGlite;

const NAMES = ["Order editing after purchase", "Partial fulfilment", "Pick lists"] as const;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261007022211_fulfilment_plan_features.sql"), "utf8");

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

const rowOf = async (name: string) => {
  const { rows } = await db.query<{ category: string; description: string; position: number }>("select category, description, position from commerce.plan_features where name = $1", [name]);
  return rows;
};

describe("the plan comparison's rows for order editing, partial fulfilment and pick lists", () => {
  it("are each listed once, in Operations, after D173's gift messages and before the next row, in the order given, within the table's check", async () => {
    const { rows: head } = await db.query<{ position: number }>("select position from commerce.plan_features where name = 'Gift messages'");
    const { rows: next } = await db.query<{ position: number }>(
      "select min(position)::int as position from commerce.plan_features where category = 'Operations' and position > $1 and name <> all($2)",
      [head[0].position, [...NAMES]],
    );
    const positions: number[] = [];
    for (const name of NAMES) {
      const rows = await rowOf(name);
      expect(rows, name).toHaveLength(1);
      expect(rows[0].category).toBe("Operations");
      expect(rows[0].description.length).toBeGreaterThan(40);
      expect(rows[0].description.length).toBeLessThanOrEqual(300);
      expect(rows[0].position).toBeGreaterThan(head[0].position);
      expect(rows[0].position).toBeLessThan(next[0].position);
      positions.push(rows[0].position);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(NAMES.length);
  });

  it("are in no plan yet: a row describes and enables nothing", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = any($1)",
      [[...NAMES]],
    );
    expect(rows[0].n).toBe(0);
  });

  it("state only what the product does: the limits are the code's own, and nothing is promised that is not built", async () => {
    const text = (await Promise.all(NAMES.map(async (n) => (await rowOf(n))[0].description))).join(" ");
    expect(text).toContain(`valid ${EDIT_PAY_DAYS} days`);
    expect(text).toContain(`up to ${PICK_LIST_MAX} orders`);
    // An edit is for an order with nothing sent (4.4), a higher total applies only when paid (4.5), and a pick list carries no prices or people (2.3).
    expect(text).toContain("before anything is sent");
    expect(text).toContain("applies when the customer pays");
    expect(text).toContain("No prices, names or addresses");
    // Section 7 of the spec: none of these is built.
    expect(text).not.toMatch(/unlimited|guarantee|real.?time|ai[- ]powered|saved card|automatic(ally)? charge|template|bin|location|cancel (a )?shipment|self-service|partly sent orders? can be edited/i);
  });

  it("adds nothing a second time when the migration is run again", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_features where name = any($1)", [[...NAMES]]);
    expect(rows[0].n).toBe(NAMES.length);
  });

  it("holds no DELETE or DROP: the migration tool cancels a function body that has one", () => {
    expect(MIGRATION).not.toMatch(/\b(delete|drop)\b/i);
  });
});
