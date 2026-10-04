import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

/** The tax profiles the control center and a store's Home ask an owner to look at (D157): one query, every store by its id. */

vi.mock("server-only", () => ({}));

const { taxAttention } = await import("./tax-attention");

const run = Date.now().toString(36);
const ids: string[] = [];

async function store(suffix: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, country) values (${`tax-att-${suffix}-${run}`}, ${`Tax ${suffix}`}, 'SE') returning id`);
  ids.push(String(row.id));
  return String(row.id);
}

afterAll(async () => {
  await closeDb();
});

describe("tax attention", () => {
  let none: string;
  let unchecked: string;
  let iossHalf: string;

  beforeAll(async () => {
    none = await store("none");
    unchecked = await store("unchecked");
    iossHalf = await store("ioss");
    await db().execute(sql`insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${unchecked}::uuid, true, 'SE556677889901')`);
    await db().execute(sql`insert into commerce.store_tax_profile (store_id, ioss_markets) values (${iossHalf}::uuid, array['DE'])`);
  });

  it("says nothing about a store with no profile, and what is wrong with the others", async () => {
    const found = await taxAttention([none, unchecked, iossHalf]);
    expect(found.has(none)).toBe(false);
    expect(found.get(unchecked)).toEqual(["The VAT number has not been checked valid."]);
    expect(found.get(iossHalf)).toEqual(["IOSS markets are chosen but there is no IOSS number."]);
  });

  it("asks only about the stores it is given, and nothing for none", async () => {
    expect((await taxAttention([iossHalf])).has(unchecked)).toBe(false);
    expect((await taxAttention([])).size).toBe(0);
  });
});
