import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ADJUST_ROWS_MAX } from "@/lib/inventory";
import { storeToday } from "./test-days";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { adjustStock, inventoryPage, inventoryCounts, ledgerProblems, locationImpact, setVariantPolicies, stockHistory } = await import("./inventory");
const support = await import("./inventory-test-support");
const { addLocation, clearLevels, ledgerIsWhole, levelsOf, mainLocation, movementsOf, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;
let bergen: string;
const OSLO = "Lager Oslo";

beforeAll(async () => {
  store = await newStore("inventory");
  other = await newStore("inventory-other");
  oslo = await mainLocation(store.storeId);
  bergen = await addLocation(store.storeId, "Bergen", 5);
});

afterAll(async () => {
  await closeDb();
});

const find = async (filter: Parameters<typeof inventoryPage>[1], sku: string) => (await inventoryPage(store.member.store, { limit: 200, ...filter })).rows.find((r) => r.sku === sku);

describe("the Inventory page", () => {
  it("shows on hand, committed to checkouts in progress and available, per location and summed over the active ones", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 10);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 4);
    await place(store.storeId, [["DEMO-TOTE", 3]]);
    const row = (await find({}, "DEMO-TOTE"))!;
    expect(row).toMatchObject({ onHand: 14, committed: 3, available: 11, owed: 0, stockPolicy: "deny" });
    expect(row.locations.map((l) => [l.name, l.onHand, l.committed, l.available])).toEqual([[OSLO, 10, 3, 7], ["Bergen", 4, 0, 4]]);
    // One location: its own figures, active or not.
    expect(await find({ locationId: bergen }, "DEMO-TOTE")).toMatchObject({ onHand: 4, committed: 0, available: 4 });
    expect(await find({ locationId: oslo }, "DEMO-TOTE")).toMatchObject({ onHand: 10, committed: 3, available: 7 });
    // A location of another store is no filter at all.
    const foreign = await addLocation(other.storeId, "Elsewhere", 1);
    expect(await find({ locationId: foreign }, "DEMO-TOTE")).toMatchObject({ onHand: 14 });
  });

  it("sums only the active locations, and says what an inactive one holds in the row's disclosure", async () => {
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${bergen}::uuid`);
    const row = (await find({}, "DEMO-TOTE"))!;
    expect(row.onHand).toBe(10);
    expect(row.locations.find((l) => l.name === "Bergen")).toMatchObject({ active: false, onHand: 4 });
    await db().execute(sql`update commerce.inventory_locations set active = true where id = ${bergen}::uuid`);
  });

  it("counts what is owed on backorder from paid orders that are not sent, and a negative level", async () => {
    await clearLevels(store.storeId, "DEMO-THERMOS");
    await setLevel(store.storeId, "DEMO-THERMOS", oslo, 1);
    const order = await place(store.storeId, [["DEMO-THERMOS", 4]]);
    await pay(store.storeId, order, store.account);
    const row = (await find({}, "DEMO-THERMOS"))!;
    expect(row).toMatchObject({ onHand: -3, owed: 3, stockPolicy: "continue", backorderDays: 7 });
    // Sent: no longer owed (the stock is still short).
    await db().execute(sql`update commerce.orders set status = 'fulfilled' where id = ${order.orderId}::uuid`);
    expect((await find({}, "DEMO-THERMOS"))!.owed).toBe(0);
    expect((await inventoryCounts(store.storeId)).negative).toBeGreaterThan(0);
  });

  it("filters low, out, on backorder and negative, and searches title, handle and SKU", async () => {
    await clearLevels(store.storeId, "DEMO-MUG-WHITE");
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 2);
    await db().execute(sql`update commerce.product_variants set low_stock_threshold = 5 where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    const skus = async (status: "low" | "out" | "backorder" | "negative") => (await inventoryPage(store.member.store, { status, limit: 200 })).rows.map((r) => r.sku);
    expect(await skus("low")).toContain("DEMO-MUG-WHITE");
    expect(await skus("backorder")).toContain("DEMO-THERMOS");
    expect(await skus("backorder")).not.toContain("DEMO-MUG-WHITE");
    expect(await skus("negative")).toContain("DEMO-THERMOS");
    await clearLevels(store.storeId, "DEMO-MUG-BLACK");
    expect(await skus("out")).toContain("DEMO-MUG-BLACK");
    expect(await skus("out")).not.toContain("DEMO-TOTE");
    const found = (await inventoryPage(store.member.store, { search: "demo-tote", limit: 200 })).rows.map((r) => r.sku);
    expect(found).toEqual(["DEMO-TOTE"]);
    // The searched word is a word, never a pattern.
    expect((await inventoryPage(store.member.store, { search: "%", limit: 200 })).rows).toHaveLength(0);
  });

  it("lists only goods that are shipped, never another store's variants, and pages by handle and SKU without repeating", async () => {
    const all = await inventoryPage(store.member.store, { limit: 200 });
    // The demo's download, appointment, stay and rental have no stock to list.
    expect(all.rows.every((r) => !["DEMO-LAMP", "DEMO-MASSAGE-60", "DEMO-HYTTE"].includes(r.sku) || r.sku === "DEMO-LAMP")).toBe(true);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await inventoryPage(store.member.store, { limit: 3, after: cursor });
      seen.push(...page.rows.map((r) => r.sku));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all.rows.map((r) => r.sku));
    expect(new Set(seen).size).toBe(seen.length);
    const theirs = await inventoryPage(other.member.store, { limit: 200 });
    expect(theirs.rows.some((r) => r.variantId === all.rows[0].variantId)).toBe(false);
  });
});

describe("adjusting stock with a reason", () => {
  it("sets a counted figure with its reason, note and who, as one movement", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 10);
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const result = await adjustStock(store.member, { reason: "count", note: "Counted after the sale", rows: [{ variantId: tote, locationId: oslo, mode: "set", value: 7, was: 10 }] });
    expect(result).toMatchObject({ ok: true, written: 1, conflicts: 0 });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 7 });
    const last = (await movementsOf(store.storeId, "DEMO-TOTE")).at(-1)!;
    expect(last).toMatchObject({ delta: -3, after: 7, reason: "count", source: "inventory_page", actor: store.accountId, note: "Counted after the sale", orderId: null });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
    const [entry] = await db().execute<Row>(sql`select details, area from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'products.inventory_adjusted' order by id desc limit 1`);
    // One entry for the save: the number of rows and the reason, never a SKU.
    expect(entry.details).toMatchObject({ rows: 1, reason: "count" });
    expect(JSON.stringify(entry.details)).not.toContain("DEMO-TOTE");
  });

  it("adjusts by a signed number, and writes nothing for a row that does not change", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const result = await adjustStock(store.member, {
      reason: "received",
      rows: [
        { variantId: tote, locationId: oslo, mode: "adjust", value: 5, was: 7 },
        { variantId: tote, locationId: bergen, mode: "set", value: 0, was: 0 },
      ],
    });
    expect(result).toMatchObject({ ok: true, written: 1, unchanged: 1 });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 12 });
    expect((await movementsOf(store.storeId, "DEMO-TOTE")).at(-1)).toMatchObject({ delta: 5, reason: "received", note: null });
  });

  it("writes the rows that agree and lists the one whose stored figure moved since the page was loaded", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 12);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 2);
    // A sale between the page and Save: the tote's stored figure is now 11, not 12.
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 11);
    const result = await adjustStock(store.member, {
      reason: "correction",
      rows: [
        { variantId: tote, locationId: oslo, mode: "set", value: 20, was: 12 },
        { variantId: mug, locationId: oslo, mode: "set", value: 8, was: 2 },
      ],
    });
    if (!result.ok) throw new Error(result.problems.join());
    expect(result).toMatchObject({ written: 1, conflicts: 1 });
    expect(result.rows.find((r) => r.variantId === tote)).toMatchObject({ outcome: "conflict", before: 11, after: null });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 11 });
    expect(await levelsOf(store.storeId, "DEMO-MUG-WHITE")).toMatchObject({ [OSLO]: 8 });
  });

  it("refuses a figure out of range with a sentence, and takes nothing below zero", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const row = (mode: "set" | "adjust", value: number, was = 11) => ({ variantId: tote, locationId: oslo, mode, value, was });
    expect(await adjustStock(store.member, { reason: "correction", rows: [row("set", -1)] })).toMatchObject({ ok: false });
    expect(await adjustStock(store.member, { reason: "correction", rows: [row("set", 1_000_001)] })).toMatchObject({ ok: false });
    expect(await adjustStock(store.member, { reason: "correction", rows: [row("set", 1.5)] })).toMatchObject({ ok: false });
    const tooLow = await adjustStock(store.member, { reason: "correction", rows: [row("adjust", -12)] });
    if (!tooLow.ok) throw new Error("rejected whole");
    expect(tooLow.rows[0]).toMatchObject({ outcome: "refused", problem: expect.stringContaining("below 0") });
    expect(await adjustStock(store.member, { reason: "stolen", rows: [row("set", 3)] })).toMatchObject({ ok: false });
    expect(await adjustStock(store.member, { reason: "correction", note: "x".repeat(201), rows: [row("set", 3)] })).toMatchObject({ ok: false });
    expect(await adjustStock(store.member, { reason: "correction", rows: [row("set", 3), row("set", 4)] })).toMatchObject({ ok: false });
    expect(await adjustStock(store.member, { reason: "correction", rows: Array.from({ length: ADJUST_ROWS_MAX + 1 }, (_, i) => ({ ...row("set", 3), locationId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })) })).toMatchObject({ ok: false });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 11 });
  });

  it("counts a negative level back to a real figure: a rise from below zero is allowed", async () => {
    const thermos = await variantId(store.storeId, "DEMO-THERMOS");
    const now = (await levelsOf(store.storeId, "DEMO-THERMOS"))[OSLO];
    expect(now).toBeLessThan(0);
    const result = await adjustStock(store.member, { reason: "received", rows: [{ variantId: thermos, locationId: oslo, mode: "set", value: 6, was: now }] });
    expect(result).toMatchObject({ ok: true, written: 1 });
    expect((await levelsOf(store.storeId, "DEMO-THERMOS"))[OSLO]).toBe(6);
  });

  it("refuses a variant or location that is not the store's, and a download", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const theirs = await variantId(other.storeId, "DEMO-TOTE");
    const foreign = await addLocation(other.storeId, "Theirs", 9);
    // The demo lamp as a download: it has no stock.
    await db().execute(sql`update commerce.product_variants set delivery = 'digital' where store_id = ${store.storeId}::uuid and sku = 'DEMO-LAMP'`);
    const result = await adjustStock(store.member, {
      reason: "correction",
      rows: [
        { variantId: theirs, locationId: oslo, mode: "set", value: 1, was: 0 },
        { variantId: tote, locationId: foreign, mode: "set", value: 1, was: 0 },
        { variantId: await variantId(store.storeId, "DEMO-LAMP"), locationId: oslo, mode: "set", value: 1, was: 0 },
      ],
    });
    if (!result.ok) throw new Error(result.problems.join());
    expect(result.rows.map((r) => `${r.variantId === theirs ? "theirs" : r.variantId === tote ? "tote+foreign" : "lamp"}: ${r.outcome} ${r.problem ?? ""}`)).toEqual(Array(3).fill(expect.stringMatching(/: refused /)));
    expect(await levelsOf(other.storeId, "DEMO-TOTE")).not.toHaveProperty("Theirs");
  });

  it("is for members who may write products, and a custom role that only reads cannot", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    const reader = { ...store.member, role: "admin" as const, permissions: ["products:read"] };
    expect(await adjustStock(reader, { reason: "correction", rows: [{ variantId: tote, locationId: oslo, mode: "set", value: 1, was: 11 }] })).toEqual({ ok: false, problems: ["You do not have access to this."] });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toMatchObject({ [OSLO]: 11 });
  });
});

describe("policy and the warning level, in bulk", () => {
  it("turns a variant to keep selling with its days, and back, and sets a warning level", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    expect(await setVariantPolicies(store.member, { variantIds: [tote], change: { kind: "continue", backorderDays: 10 } })).toMatchObject({ ok: true, changed: 1 });
    const [v] = await db().execute<Row>(sql`select stock_policy, backorder_days from commerce.product_variants where id = ${tote}::uuid`);
    expect(v).toMatchObject({ stock_policy: "continue", backorder_days: 10 });
    expect(await setVariantPolicies(store.member, { variantIds: [tote], change: { kind: "continue", backorderDays: 10 } })).toMatchObject({ changed: 0, unchanged: 1 });
    expect(await setVariantPolicies(store.member, { variantIds: [tote], change: { kind: "deny" } })).toMatchObject({ changed: 1 });
    expect(await setVariantPolicies(store.member, { variantIds: [tote], change: { kind: "threshold", lowStockThreshold: 3 } })).toMatchObject({ changed: 1 });
    expect(await setVariantPolicies(store.member, { variantIds: [tote], change: { kind: "threshold", lowStockThreshold: null } })).toMatchObject({ changed: 1 });
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'products.stock_policy_changed' order by id desc limit 1`);
    expect(entry.details).toMatchObject({ variants: 1, change: "threshold" });
  });

  it("states the days and refuses a download, naming the SKU", async () => {
    const lamp = await variantId(store.storeId, "DEMO-LAMP");
    await db().execute(sql`update commerce.product_variants set delivery = 'digital' where id = ${lamp}::uuid`);
    const done = await setVariantPolicies(store.member, { variantIds: [lamp], change: { kind: "continue", backorderDays: 5 } });
    expect(done).toMatchObject({ ok: true, changed: 0 });
    if (done.ok) expect(done.problems[0]).toContain("DEMO-LAMP");
    expect(await setVariantPolicies(store.member, { variantIds: [await variantId(store.storeId, "DEMO-TOTE")], change: { kind: "continue", backorderDays: 0 } })).toMatchObject({ ok: false });
    expect(await setVariantPolicies(store.member, { variantIds: [await variantId(other.storeId, "DEMO-TOTE")], change: { kind: "deny" } })).toMatchObject({ ok: true, changed: 0 });
  });
});

describe("the history", () => {
  it("lists movements newest first with who, why and where, filtered and paged", async () => {
    const page = await stockHistory(store.member.store, { sku: "demo-tote", limit: 100 });
    expect(page.rows.length).toBeGreaterThan(3);
    expect(page.rows.map((r) => Number(r.id))).toEqual([...page.rows.map((r) => Number(r.id))].sort((a, b) => b - a));
    expect(page.rows[0]).toMatchObject({ sku: "DEMO-TOTE", location: expect.any(String), reason: expect.any(String) });
    // A manual change names the staff member, a sale names its order.
    const counted = page.rows.find((r) => r.reason === "count")!;
    expect(counted).toMatchObject({ delta: -3, onHandAfter: 7, note: "Counted after the sale" });
    expect(counted.by.length).toBeGreaterThan(0);
    const sale = (await stockHistory(store.member.store, { sku: "DEMO-THERMOS", reason: "sale", limit: 10 })).rows[0];
    expect(sale.by).toMatch(/^Order \d+$/);
    expect(sale.orderId).not.toBeNull();
    // Reason, location and date range filters; the range ends at the store's next local midnight.
    expect((await stockHistory(store.member.store, { reason: "received", limit: 100 })).rows.every((r) => r.reason === "received")).toBe(true);
    expect((await stockHistory(store.member.store, { locationId: bergen, limit: 100 })).rows.every((r) => r.location === "Bergen")).toBe(true);
    const today = storeToday();
    expect((await stockHistory(store.member.store, { from: today, to: today, limit: 100 })).rows.length).toBeGreaterThan(0);
    expect((await stockHistory(store.member.store, { from: "2001-01-01", to: "2001-01-02", limit: 100 })).rows).toHaveLength(0);
    const first = await stockHistory(store.member.store, { sku: "DEMO-TOTE", limit: 2 });
    const second = await stockHistory(store.member.store, { sku: "DEMO-TOTE", limit: 2, after: first.nextCursor });
    expect(first.rows.map((r) => r.id)).not.toEqual(second.rows.map((r) => r.id));
    expect(Number(second.rows[0].id)).toBeLessThan(Number(first.rows.at(-1)!.id));
  });

  it("never shows another store's movements", async () => {
    const theirs = await stockHistory(other.member.store, { limit: 200 });
    const mine = await stockHistory(store.member.store, { limit: 200 });
    const own = new Set(mine.rows.map((r) => r.id));
    expect(theirs.rows.some((r) => own.has(r.id))).toBe(false);
  });
});

describe("what a location holds, and the ledger", () => {
  it("reports units, variants, live holds and what is owed", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await clearLevels(store.storeId, "DEMO-MUG-WHITE");
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${store.storeId}::uuid and released_at is null`);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 4);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", bergen, 2);
    await setLevel(store.storeId, "DEMO-THERMOS", bergen, -1);
    expect(await locationImpact(db(), store.storeId, bergen)).toEqual({ units: 6, variants: 2, committedUnits: 0, owedUnits: 1 });
    expect(await locationImpact(db(), store.storeId, await addLocation(other.storeId, "Else", 2))).toBeNull();
  });

  it("finds every pair whose movements add up, so a gap would show", async () => {
    expect(await ledgerProblems(store.storeId)).toEqual([]);
    expect(await ledgerProblems(other.storeId)).toEqual([]);
  });
});
