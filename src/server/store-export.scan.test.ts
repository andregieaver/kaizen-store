import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

vi.mock("server-only", () => ({}));
const { STORE_EXPORT_TABLES, exportable } = await import("./store-export");

/** Every `commerce` table with a `store_id`: what the store owns. */
const storeTableConfigs = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table))
  .filter((config) => config.schema === "commerce" && config.columns.some((column) => column.name === "store_id"));
const storeTables = storeTableConfigs.map((config) => config.name);

const personal = new Set(PERSONAL_DATA.filter((entry) => entry.subject !== "none").map((entry) => entry.table));
const exported = new Set<string>(STORE_EXPORT_TABLES);

describe("what the whole-store file holds, table by table (PSI DATA-05)", () => {
  it("has every store table decided: in the file, people's data, or left out for a reason", () => {
    const decided = (table: string) => exported.has(table) || personal.has(table) || table in STORE_EXPORT_LEFT_OUT;
    expect(storeTables.filter((table) => !decided(table))).toEqual([]);
  });

  it("keeps the left-out list true: no table on it that is gone or in the file", () => {
    const owned = new Set(storeTables);
    expect(Object.keys(STORE_EXPORT_LEFT_OUT).filter((table) => !owned.has(table) || exported.has(table))).toEqual([]);
    expect(STORE_EXPORT_TABLES.filter((table) => !owned.has(table))).toEqual([]);
  });

  it("never exports a table that holds a secret", () => {
    expect([...exported].filter((table) => STORE_EXPORT_LEFT_OUT[table] === "secret")).toEqual([]);
  });

  it("keeps no column of an exported table that names an account, a customer or an email address, or opens a door", () => {
    const kept = storeTableConfigs
      .filter((config) => exported.has(config.name))
      .flatMap((config) => config.columns.map((column) => `${config.name}.${column.name}`))
      .filter((name) => Object.keys(exportable({ [name.split(".")[1]]: 1 })).length > 0);
    const risky = /\.((\w+_)?(account|customer|member)_id|(\w+_)?email(_address)?|\w*_key|\w*_ip|ip_address|user_agent)$/;
    expect(kept.filter((name) => risky.test(name))).toEqual([]);
  });
});
