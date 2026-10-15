import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CARRIERS } from "@/lib/shipping-carriers";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's rows for exchanges and return labels (D239, `docs/wave-3-exchanges.md` 3.8 item 3 and 5.5; migration `*_exchanges_plan_features.sql`):
 * two rows in Operations right after the order rows (Pick lists), within the table's length check, in no plan until the platform's admin ticks one, saying only
 * what is built (the one carrier that books return labels, and in its countries), and added by nobody a second time.
 */

let db: PGlite;

const NAMES = ["Exchanges", "Return labels from your carrier"] as const;
const MIGRATION = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261015065442_exchanges_plan_features.sql"), "utf8");

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

describe("the plan comparison's rows for exchanges and return labels", () => {
  it("are each listed once, in Operations, after Pick lists and before the next row, in the order given, within the table's check", async () => {
    const { rows: head } = await db.query<{ position: number }>("select position from commerce.plan_features where name = 'Pick lists'");
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

  it("state only what the product does: the customer confirms, the label's cost is capped, and only the carriers that book return labels are named", async () => {
    const [exchanges, labels] = await Promise.all(NAMES.map(async (n) => (await rowOf(n))[0].description));
    expect(exchanges).toContain("the customer confirms the exchange");
    expect(exchanges).toContain("new order paid by the return's credit");
    expect(labels).toContain("never more than it cost");
    const booking = CARRIERS.filter((c) => c.available.includes("return_labels"));
    for (const c of booking) expect(labels).toContain(c.name);
    for (const c of CARRIERS.filter((x) => !x.available.includes("return_labels"))) expect(labels).not.toContain(c.name);
    // Bring books return labels in Norway only (`returnCountries`), so the row says Norway.
    expect(booking.flatMap((c) => c.returnCountries ?? [])).toEqual(["NO"]);
    expect(labels).toContain("in Norway");
    // Section 7 of the spec: none of these is built.
    expect(`${exchanges} ${labels}`).not.toMatch(/unlimited|guarantee|instant|store credit|gift card|qr code|any carrier|every carrier|ai[- ]powered/i);
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
