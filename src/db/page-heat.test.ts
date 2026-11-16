import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/** Heatmaps' totals (D656, `docs/heatmaps-and-recordings.md` 6.2): what the database itself holds them to. */

let db: PGlite;
let store: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const { rows } = await db.query<{ id: string }>("insert into commerce.stores (slug, name) values ('heat-store', 'Heat') returning id");
  store = rows[0].id;
});

afterAll(async () => {
  await db.close();
});

const zeros = (n: number) => `{${new Array(n).fill(0).join(",")}}`;
const day = (tag = "", reach = zeros(21), attention = zeros(20)) =>
  db.query(
    "insert into commerce.page_heat_days (store_id, day, page, device, tag, reach, attention_ms) values ($1, '2026-11-16', '/no', 'mobile', $2, $3, $4)",
    [store, tag, reach, attention],
  );
const cell = (cx: number, anchor = "@main", tag = "") =>
  db.query("insert into commerce.click_cells (store_id, day, page, device, tag, anchor, cx, cy) values ($1, '2026-11-16', '/no', 'mobile', $2, $3, $4, 0)", [
    store,
    tag,
    anchor,
    cx,
  ]);

describe("heatmaps' totals (D656)", () => {
  it("adds arrays element by element", async () => {
    const { rows } = await db.query<{ i: number[]; b: string[] }>("select commerce.add_int_arrays('{1,2,3}', '{3,4,5}') as i, commerce.add_bigint_arrays('{10000000000}', '{1}') as b");
    expect(rows[0].i).toEqual([4, 6, 8]);
    expect(rows[0].b.map(Number)).toEqual([10000000001]);
  });

  it("keeps one row per page, day, device and tag, with arrays of 21 and 20", async () => {
    await day();
    await expect(day()).rejects.toThrow(/page_heat_days_store_id_day_page_device_tag_pk/);
    await day("3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c:b");
    await expect(day("a version")).rejects.toThrow(/page_heat_days_tag/);
    await expect(day("3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c:e")).rejects.toThrow(/page_heat_days_tag/);
    await expect(day("", zeros(20))).rejects.toThrow(/page_heat_days_arrays/);
    await expect(day("", zeros(21), zeros(21))).rejects.toThrow(/page_heat_days_arrays/);
    await expect(
      db.query("insert into commerce.page_heat_days (store_id, day, page, device, reach, attention_ms) values ($1, '2026-11-16', '/no', 'watch', $2, $3)", [store, zeros(21), zeros(20)]),
    ).rejects.toThrow(/page_heat_days_device/);
  });

  it("holds cells to the 10 × 10 grid and anchors to 60 characters", async () => {
    await cell(9);
    await expect(cell(10)).rejects.toThrow(/click_cells_cell/);
    await expect(cell(1, "x".repeat(61))).rejects.toThrow(/click_cells_anchor/);
  });

  it("keeps row-level security on", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('page_heat_days', 'click_cells') order by relname",
    );
    expect(rows).toEqual([
      { relname: "click_cells", relrowsecurity: true },
      { relname: "page_heat_days", relrowsecurity: true },
    ]);
  });
});
