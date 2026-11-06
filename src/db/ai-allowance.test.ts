import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The AI a plan includes, in euros (D481): `commerce.usd_per_euro(day)` is the ECB's dollar rate the AI used each day is counted at,
 * the working day before for a weekend, the first stored for a day before any, and 1 in a database with no rates at all.
 */
let db: PGlite;

const rate = async (day: string): Promise<number> =>
  Number((await db.query<{ rate: string }>("select commerce.usd_per_euro($1::date)::text as rate", [day])).rows[0].rate);

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe("the dollar rate the AI is counted at (D481)", () => {
  it("is 1 while no rate is stored, so a new database counts at all", async () => {
    expect(await rate("2026-11-06")).toBe(1);
  });

  it("is the day's rate, else the last one before it, else the first one stored", async () => {
    await db.query(
      "insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-10-30', 'USD', 1.08), ('2026-11-02', 'USD', 1.1), ('2026-11-02', 'NOK', 11.7)",
    );
    expect(await rate("2026-11-02")).toBe(1.1);
    // A weekend takes the Friday before.
    expect(await rate("2026-11-01")).toBe(1.08);
    expect(await rate("2026-11-06")).toBe(1.1);
    // Before the first stored day: the first one.
    expect(await rate("2026-01-01")).toBe(1.08);
  });

  it("turns a day's millionths of a dollar into millionths of a euro", async () => {
    const { rows } = await db.query<{ value: string }>("select round(5500000 / commerce.usd_per_euro('2026-11-02'::date))::bigint::text as value");
    expect(rows[0].value).toBe("5000000");
  });
});
