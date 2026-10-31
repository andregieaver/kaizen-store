import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { STORE_EXPORT_LEFT_OUT, STORE_EXPORT_UNDECIDED } from "@/lib/store-export-scope";

vi.mock("server-only", () => ({}));
const { STORE_EXPORT_TABLES } = await import("./store-export");

/** Every `commerce` table with a `store_id`: what the store owns. */
const storeTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table))
  .filter((config) => config.schema === "commerce" && config.columns.some((column) => column.name === "store_id"))
  .map((config) => config.name);

const personal = new Set(PERSONAL_DATA.filter((entry) => entry.subject !== "none").map((entry) => entry.table));
const exported = new Set<string>(STORE_EXPORT_TABLES);

describe("what the whole-store file holds, table by table (PSI DATA-05)", () => {
  it("has every store table decided: in the file, people's data, left out for a reason, or on the shrinking undecided list", () => {
    const decided = (table: string) =>
      exported.has(table) || personal.has(table) || table in STORE_EXPORT_LEFT_OUT || STORE_EXPORT_UNDECIDED.includes(table);
    expect(storeTables.filter((table) => !decided(table))).toEqual([]);
  });

  it("keeps the undecided list true: no table on it that is decided or gone", () => {
    const owned = new Set(storeTables);
    const stale = STORE_EXPORT_UNDECIDED.filter((table) => !owned.has(table) || exported.has(table) || table in STORE_EXPORT_LEFT_OUT || personal.has(table));
    expect(stale).toEqual([]);
    const leftStale = Object.keys(STORE_EXPORT_LEFT_OUT).filter((table) => !owned.has(table) || exported.has(table));
    expect(leftStale).toEqual([]);
  });

  it("never exports a table that holds a secret", () => {
    expect([...exported].filter((table) => STORE_EXPORT_LEFT_OUT[table] === "secret")).toEqual([]);
  });
});
