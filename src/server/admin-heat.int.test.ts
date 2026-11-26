import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const signals = await import("./admin-signals");
const { recordAdminHeat, pruneAdminHeat } = await import("./admin-heat");

type Row = Record<string, unknown>;

/**
 * Admin heatmaps (D895 phase 3b): a screen view's summary is added to its screen's daily totals only while the switch is open, from a store
 * owner whose choice under the current notice allows heatmaps, for a measured screen; the person, the store and the address are never kept.
 */
let before: Row | undefined;
const NOW = new Date("2026-11-20T10:00:00Z");
const zeros = (n: number) => new Array<number>(n).fill(0);
const summary = (path: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  store: "admin",
  path,
  seq: 0,
  device: "desktop",
  reach: 20,
  fold: 500,
  attH: 1200,
  att: zeros(20),
  clicks: [
    ["@main", 3, 4, 0, 0],
    ["@main", 3, 4, 1, 0],
  ],
  dv: 1,
  rv: 0,
  fv: 1,
  ab: [],
  ...extra,
});
const totals = () =>
  db().execute<Row>(sql`select screen, views, clicks, dead_clicks from commerce.platform_admin_heat_days where day = '2026-11-20' order by screen`);

beforeAll(async () => {
  [before] = await db().execute<Row>(sql`select admin_signals_open from commerce.platform_settings`);
  await db().execute(sql`delete from commerce.platform_admin_heat_days where day = '2026-11-20'`);
  await db().execute(sql`delete from commerce.platform_admin_click_cells where day = '2026-11-20'`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set admin_signals_open = ${Boolean(before?.admin_signals_open)}`);
  await closeDb();
});

describe("admin heatmaps' totals", () => {
  it("keeps nothing while the switch is shut, or from a person who did not allow heatmaps, or for a screen never measured", async () => {
    await db().execute(sql`update commerce.platform_settings set admin_signals_open = false`);
    const shop = await makeStore("admin-heat");
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: false, reason: "not_allowed" });

    await db().execute(sql`update commerce.platform_settings set admin_signals_open = true`);
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: false, reason: "not_allowed" });
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: false, recordings: false });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: false, reason: "not_allowed" });

    const staff = await makeAccount("admin-heat-staff");
    await addMember(shop.id, staff.id, "admin");
    expect(await recordAdminHeat({ accountId: staff.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: false, reason: "not_allowed" });

    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: false });
    for (const path of ["s/orders", "s/orders/detail", "s/analytics/recordings", `/admin/${shop.slug}/products`, "s/products/admin-heat"])
      expect(await recordAdminHeat({ accountId: shop.account.id, body: summary(path), now: NOW }), path).toEqual({ recorded: false, reason: "not_measured" });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products", { store: shop.slug }), now: NOW })).toEqual({ recorded: false, reason: "invalid" });
    expect(await totals()).toEqual([]);
  });

  it("adds an allowed owner's view to the screen's day, with its clicks per cell and no person, store or address", async () => {
    const shop = await makeStore("admin-heat-yes");
    await signals.chooseAdminSignals(shop.account.id, { heatmaps: true, recordings: false });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: true });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products", { seq: 1, clicks: [], dv: 0, fv: 0 }), now: NOW })).toEqual({ recorded: true });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/settings/payments"), now: NOW })).toEqual({ recorded: true });
    expect(await totals()).toEqual([
      { screen: "s/products", views: 1, clicks: 2, dead_clicks: 1 },
      { screen: "s/settings/payments", views: 1, clicks: 2, dead_clicks: 1 },
    ]);
    const cells = await db().execute<Row>(sql`select screen, anchor, cx, cy, clicks, dead from commerce.platform_admin_click_cells where day = '2026-11-20' order by screen`);
    expect(cells[0]).toEqual({ screen: "s/products", anchor: "@main", cx: 3, cy: 4, clicks: 2, dead: 1 });
  });

  it("a new notice asks again, and nothing is kept until the owner answers it", async () => {
    const shop = await makeStore("admin-heat-old");
    await db().execute(sql`insert into commerce.platform_admin_signal_choices (account_id, heatmaps, recordings, notice) values (${shop.account.id}::uuid, true, false, '2026-01-01')`);
    expect(await signals.adminSignalsFor(shop.account.id)).toEqual({ eligible: true, choice: null });
    expect(await recordAdminHeat({ accountId: shop.account.id, body: summary("s/products"), now: NOW })).toEqual({ recorded: false, reason: "not_allowed" });
  });

  it("prunes totals past 13 months and cells past 90 days", async () => {
    const later = new Date("2027-03-01T10:00:00Z");
    expect(await pruneAdminHeat(later)).toEqual({ days: 0, cells: 1 + 1 });
    expect((await totals()).length).toBe(2);
    expect((await pruneAdminHeat(new Date("2028-01-01T10:00:00Z"))).days).toBe(2);
  });
});
