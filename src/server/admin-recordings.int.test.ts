import { gunzipSync, gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { memoryFiles } from "./recording-files-test-support";

vi.mock("server-only", () => ({}));

const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const signals = await import("./admin-signals");
const { recordAdminSegment, pruneAdminRecordings } = await import("./admin-recordings");

type Row = Record<string, unknown>;

/**
 * Recordings of owners' own use of the admin (D895 phase 3b): kept only while the switch is open, from an owner who allowed recordings,
 * for screens on the allow-list; what is stored has no word, address, person or store in it; pruned with its files after 30 days.
 */
let before: Row | undefined;
const NOW = new Date("2026-11-20T10:17:00Z");
const segment = (pages: string[], events: unknown[] = []) => ({
  v: 1,
  meta: { device: "desktop", w: 1280, h: 800, pages, clicks: 2, dead: 1, rage: 0, ab: [] },
  events: [
    { type: 4, timestamp: 0, data: { href: "https://kaizenaflow.com/admin/my-shop/products", width: 1280, height: 800 } },
    {
      type: 2,
      timestamp: 5,
      data: { node: { type: 2, tagName: "div", attributes: { "aria-label": "Kari Nordmann", class: "row" }, childNodes: [{ type: 3, textContent: "Kari Nordmann" }] } },
    },
    ...events,
  ],
});
const send = (accountId: string, id: string, seq: number, body: unknown, files: ReturnType<typeof memoryFiles> | null) =>
  recordAdminSegment({ accountId, query: { id, seq: String(seq), z: "1" }, bytes: new Uint8Array(gzipSync(JSON.stringify(body))), now: NOW }, { files });

beforeAll(async () => {
  [before] = await db().execute<Row>(sql`select admin_signals_open from commerce.platform_settings`);
  await db().execute(sql`update commerce.platform_settings set admin_signals_open = true`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set admin_signals_open = ${Boolean(before?.admin_signals_open)}`);
  await closeDb();
});

describe("admin recordings", () => {
  it("keeps nothing from staff, from an owner who allowed heatmaps only, or for a screen never measured", async () => {
    const files = memoryFiles();
    const shop = await makeStore("admin-rec");
    const staff = await makeAccount("admin-rec-staff");
    await addMember(shop.id, staff.id, "admin");
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: false });
    expect(await send(shop.account.id, crypto.randomUUID(), 0, segment(["s/products"]), files)).toBe(410);
    expect(await send(staff.id, crypto.randomUUID(), 0, segment(["s/products"]), files)).toBe(410);
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: true });
    expect(await send(shop.account.id, crypto.randomUUID(), 0, segment(["s/products", "s/orders"]), files)).toBe(410);
    expect(
      await send(shop.account.id, crypto.randomUUID(), 0, segment(["s/products"], [{ type: 5, timestamp: 9, data: { tag: "kz-page", payload: { path: "s/customers" } } }]), files),
    ).toBe(410);
    expect(files.files.size).toBe(0);
  });

  it("keeps an allowed owner's segments scrubbed of every word, with a row that names no person, store or address", async () => {
    const files = memoryFiles();
    const shop = await makeStore("admin-rec-yes");
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: true });
    const id = crypto.randomUUID();
    expect(await send(shop.account.id, id, 0, segment(["s/products"]), files)).toBe(204);
    expect(await send(shop.account.id, id, 1, segment(["s/products/detail"]), files)).toBe(204);
    expect(await send(shop.account.id, id, 1, segment(["s/products/detail"]), files)).toBe(204);
    const [row] = await db().execute<Row>(
      sql`select entry_screen, screens, age_band, segments, clicks, dead_clicks, width from commerce.platform_admin_recordings where id = ${id}::uuid`,
    );
    expect(row).toEqual({ entry_screen: "s/products", screens: ["s/products", "s/products/detail"], age_band: "week", segments: 2, clicks: 4, dead_clicks: 2, width: 1280 });
    expect([...files.files.keys()].sort()).toEqual([`admin/${id}/000.gz`, `admin/${id}/001.gz`]);
    const kept = gunzipSync(files.files.get(`admin/${id}/000.gz`)!).toString("utf8");
    for (const word of ["Kari", "Nordmann", "my-shop", "kaizenaflow.com", shop.slug]) expect(kept, word).not.toContain(word);
    expect(kept).toContain('"href":"s/products"');
    expect(kept).toContain('"class":"row"');
  });

  it("goes with its files after 30 days", async () => {
    const files = memoryFiles();
    const shop = await makeStore("admin-rec-old");
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: true });
    const id = crypto.randomUUID();
    expect(await send(shop.account.id, id, 0, segment(["s"]), files)).toBe(204);
    expect(await pruneAdminRecordings(new Date("2026-12-01T10:00:00Z"), Date.now() + 10_000, { files })).toBe(0);
    expect(await pruneAdminRecordings(new Date("2026-12-21T10:00:00Z"), Date.now() + 10_000, { files })).toBeGreaterThanOrEqual(1);
    expect(files.files.size).toBe(0);
    expect((await db().execute<Row>(sql`select 1 from commerce.platform_admin_recordings where id = ${id}::uuid`)).length).toBe(0);
  });
});
