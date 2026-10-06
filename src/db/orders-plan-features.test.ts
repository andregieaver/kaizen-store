import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BULK_MAX, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, GIFT_MESSAGE_MAX, TAGS_PER_ORDER, TAG_MAX_LENGTH, VIEWS_MAX } from "@/lib/order-limits";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's rows for the order work of wave 3, run 2 (D173, `docs/wave-3-orders.md` 5.5; migration `*_orders_ops_plan_features.sql`): four rows described once in the
 * category Operations right after "Orders, returns and refunds", within the table's length checks, in no plan until the platform's admin ticks one, saying only what is built
 * (every limit named is the code's own), and added by nobody a second time.
 */

let db: PGlite;

const NAMES = [
  "Order search, filters, saved views and bulk actions",
  "Order tags and archive",
  "Draft orders and payment links",
  "Gift messages",
] as const;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261006172421_orders_ops_plan_features.sql"), "utf8");

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

describe("the plan comparison's rows for the order work", () => {
  it("are each listed once, in Operations, after Orders, returns and refunds and before the next row, with a description that fits the table's check", async () => {
    const { rows: head } = await db.query<{ position: number }>("select position from commerce.plan_features where name = 'Orders, returns and refunds'");
    const { rows: next } = await db.query<{ position: number }>("select min(position)::int as position from commerce.plan_features where category = 'Operations' and position > $1 and name <> all($2)", [head[0].position, [...NAMES]]);
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
    expect(new Set(positions).size).toBe(NAMES.length);
  });

  it("are in no plan yet: a row describes and enables nothing", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = any($1)", [[...NAMES]]);
    expect(rows[0].n).toBe(0);
  });

  it("state only what the product does: the limits are the code's own, and nothing is promised that is not built", async () => {
    const text = (await Promise.all(NAMES.map(async (n) => (await rowOf(n))[0].description))).join(" ");
    expect(text).toContain(`${TAGS_PER_ORDER} of ${TAG_MAX_LENGTH} characters`);
    expect(text).toContain(`${BULK_MAX} orders`);
    expect(text).toContain(`${VIEWS_MAX} saved views`);
    expect(text).toContain(`${DRAFT_VALID_DAYS_MIN} to ${DRAFT_VALID_DAYS_MAX} days`);
    expect(text).toContain(`${GIFT_MESSAGE_MAX} characters`);
    expect(text).not.toMatch(/unlimited|guarantee|real.?time|ai[- ]powered|automatic(ally)? refund|gift wrap|gift card/i);
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
