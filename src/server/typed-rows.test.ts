import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ db: () => ({ execute: async () => [] }) }));

const { col, RowShapeError, typedRow, typedRows } = await import("./typed-rows");

const fake = (rows: Record<string, unknown>[]) => ({ execute: async () => rows }) as never;

describe("typed reads", () => {
  const money = z.object({ currency: col.currency, amount: col.minor, cards: col.int });

  it("reads what node-postgres hands over: a bigint as a string, a char(3) with spaces, a Date", async () => {
    const rows = await typedRows(money, sql`select 1`, fake([{ currency: "NOK", amount: "1250000", cards: 3 }]));
    expect(rows).toEqual([{ currency: "NOK", amount: 1_250_000, cards: 3 }]);
    expect(col.currency.parse("EUR ")).toBe("EUR");
    expect(col.timestamp.parse(new Date("2026-10-24T12:00:00Z"))).toBe("2026-10-24T12:00:00.000Z");
    expect(col.minorOrNull.parse(null)).toBeNull();
    expect(col.decimal.parse("0.25")).toBe(0.25);
  });

  it("refuses a float or an unsafe integer as money", () => {
    expect(() => col.minor.parse("12.5")).toThrow();
    expect(() => col.minor.parse("9007199254740993")).toThrow();
  });

  it("throws a RowShapeError naming the column, never the value", async () => {
    const read = typedRows(money, sql`select 1`, fake([{ currency: "kr", amount: null, cards: 1 }]));
    await expect(read).rejects.toBeInstanceOf(RowShapeError);
    await expect(read).rejects.toThrow(/currency/);
    await expect(read).rejects.not.toThrow(/kr\b/);
  });

  it("gives the first row, or null", async () => {
    expect(await typedRow(money, sql`select 1`, fake([]))).toBeNull();
    expect(await typedRow(money, sql`select 1`, fake([{ currency: "SEK", amount: 5, cards: 0 }]))).toEqual({ currency: "SEK", amount: 5, cards: 0 });
  });
});
