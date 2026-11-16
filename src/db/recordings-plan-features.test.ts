import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RECORDING_KEEP_DAYS } from "@/lib/recording";

import { createTestDatabase } from "./testing";

/**
 * The plan comparison's row for recordings and heatmaps (D656, `docs/heatmaps-and-recordings.md` 10; migration `*_recordings_rules.sql`):
 * described once in Operations after its last row, within the table's length check, in no plan until the platform's admin ticks one,
 * saying only what is built, and added by nobody a second time. The same migration holds the table to row-level security and the rule.
 */

let db: PGlite;
const NAME = "Recordings and heatmaps";

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the plan comparison's row for recordings and heatmaps", () => {
  it("lists it once, after the category's other rows, with a description that fits the table's check", async () => {
    const { rows } = await db.query<{ category: string; description: string; position: number }>("select category, description, position from commerce.plan_features where name = $1", [NAME]);
    expect(rows).toHaveLength(1);
    const { rows: others } = await db.query<{ top: number }>("select max(position)::int as top from commerce.plan_features where category = 'Operations' and name <> $1", [NAME]);
    expect(rows[0].category).toBe("Operations");
    expect(rows[0].description.length).toBeGreaterThan(40);
    expect(rows[0].description.length).toBeLessThanOrEqual(300);
    expect(rows[0].position).toBeGreaterThan(others[0].top);
  });

  it("is in no plan yet, and says only what is built", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from commerce.plan_feature_grants g join commerce.plan_features f on f.id = g.feature_id where f.name = $1",
      [NAME],
    );
    expect(rows[0].n).toBe(0);
    const { rows: text } = await db.query<{ description: string }>("select description from commerce.plan_features where name = $1", [NAME]);
    expect(text[0].description).toContain(`${RECORDING_KEEP_DAYS} days`);
    expect(text[0].description).not.toMatch(/unlimited|guarantee|instant/i);
  });

  it("keeps the recordings table under row-level security and its retention rule at 30 days", async () => {
    const { rows } = await db.query<{ rls: boolean }>("select relrowsecurity as rls from pg_class where relname = 'recordings'");
    expect(rows[0].rls).toBe(true);
    const { rows: rule } = await db.query<{ period_value: number; period_unit: string }>("select period_value, period_unit from commerce.retention_rules where kind = 'recordings' and country is null");
    expect(rule).toEqual([{ period_value: RECORDING_KEEP_DAYS, period_unit: "days" }]);
  });

  it("holds a recording's row to its checks", async () => {
    const { rows } = await db.query<{ id: string }>("insert into commerce.stores (slug, name) values ('rec-store', 'Rec') returning id");
    const insert = (o: { device?: string; mask?: string; bytes?: number; duration?: number } = {}) =>
      db.query(
        `insert into commerce.recordings (id, store_id, day, started_at, last_at, device, entry_page, mask, bytes, duration_ms)
         values (gen_random_uuid(), $1, '2026-11-16', now(), now(), $2, '/no', $3, $4, $5)`,
        [rows[0].id, o.device ?? "mobile", o.mask ?? "balanced", o.bytes ?? 0, o.duration ?? 0],
      );
    await insert();
    await expect(insert({ device: "watch" })).rejects.toThrow(/recordings_device/);
    await expect(insert({ mask: "none" })).rejects.toThrow(/recordings_mask/);
    await expect(insert({ bytes: 4194305 })).rejects.toThrow(/recordings_bytes/);
    await expect(insert({ duration: 3600001 })).rejects.toThrow(/recordings_duration/);
  });
});
