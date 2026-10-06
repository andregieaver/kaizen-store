import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { LOW_STOCK_EMAIL_LINES } from "@/lib/inventory";
import { nextAlertState, type AlertState } from "@/lib/stock-alerts";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { sendLowStockNotices, pruneInventoryMovements } = await import("./stock-alerts");
const { adjustStock } = await import("./inventory");
const { sendEmail } = await import("./email");
const support = await import("./inventory-test-support");
const { clearLevels, ledgerIsWhole, mainLocation, newStore, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let oslo: string;

beforeAll(async () => {
  store = await newStore("alerts");
  oslo = await mainLocation(store.storeId);
});

afterAll(async () => {
  await closeDb();
});

const mails = async (): Promise<Row[]> =>
  db().execute<Row>(sql`select to_address, subject, text, idempotency_key, status from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'stock.low' order by created_at, id`);
const alertOf = async (sku: string): Promise<Row | undefined> =>
  (await db().execute<Row>(sql`select * from commerce.stock_alerts where store_id = ${store.storeId}::uuid and variant_id = ${await variantId(store.storeId, sku)}::uuid`))[0];
const threshold = (sku: string, level: number | null) =>
  db().execute(sql`update commerce.product_variants set low_stock_threshold = ${level} where store_id = ${store.storeId}::uuid and sku = ${sku}`);
const sellOne = async (sku: string) => pay(store.storeId, await place(store.storeId, [[sku, 1]]), store.account);

describe("telling the owners when stock crosses the level they set", () => {
  it("sends one email for the crossing, however many sales follow, and none for a job that runs twice", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 10);
    await threshold("DEMO-TOTE", 5);
    expect((await alertOf("DEMO-TOTE"))?.state).toBe("ok");
    for (let left = 9; left >= 6; left--) await sellOne("DEMO-TOTE");
    expect(await sendLowStockNotices()).toMatchObject({ failed: 0 });
    expect(await mails()).toHaveLength(0);
    // 6 -> 5: at the level, so it crosses.
    await sellOne("DEMO-TOTE");
    expect((await alertOf("DEMO-TOTE"))).toMatchObject({ state: "low", notified_at: null, stock_at_crossing: 5 });
    await sellOne("DEMO-TOTE");
    await sellOne("DEMO-TOTE");
    const first = await sendLowStockNotices();
    expect(first.crossings).toBeGreaterThanOrEqual(1);
    const sent = await mails();
    expect(sent).toHaveLength(1);
    expect(String(sent[0].to_address)).toBe(store.accountEmail);
    expect(String(sent[0].subject)).toMatch(/^Low stock: /);
    // It says the stock and the level and the SKU, and nothing about sales, customers or prices.
    expect(String(sent[0].text)).toContain("DEMO-TOTE");
    expect(String(sent[0].text)).toContain("3 left, level 5");
    expect(String(sent[0].text)).not.toMatch(/order|customer|price|kr\b/i);
    expect(String(sent[0].text)).toContain(`/admin/${store.slug}/inventory?status=low`);
    expect((await alertOf("DEMO-TOTE"))?.notified_at).not.toBeNull();
    // Run again, and again after more sales: still one.
    await sendLowStockNotices();
    await sellOne("DEMO-TOTE");
    await sendLowStockNotices();
    expect(await mails()).toHaveLength(1);
  });

  it("crosses again only after the stock has risen above the level", async () => {
    await adjustStock(store.member, { reason: "received", rows: [{ variantId: await variantId(store.storeId, "DEMO-TOTE"), locationId: oslo, mode: "set", value: 20, was: 2 }] });
    expect((await alertOf("DEMO-TOTE"))).toMatchObject({ state: "ok", crossed_at: null });
    await sendLowStockNotices();
    expect(await mails()).toHaveLength(1);
    for (let i = 0; i < 15; i++) await sellOne("DEMO-TOTE");
    expect((await alertOf("DEMO-TOTE"))?.state).toBe("low");
    await sendLowStockNotices();
    expect(await mails()).toHaveLength(2);
    // The two emails have two keys: the store, the time of the newest crossing and the owner.
    const keys = (await mails()).map((m) => String(m.idempotency_key));
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith(`stock.low:${store.storeId}:`))).toBe(true);
  }, 60_000);

  it("sends none for a level set on a variant that is already at or below it, and one when the level is raised above the stock", async () => {
    await clearLevels(store.storeId, "DEMO-MUG-WHITE");
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 2);
    const before = (await mails()).length;
    await threshold("DEMO-MUG-WHITE", 4);
    expect((await alertOf("DEMO-MUG-WHITE"))).toMatchObject({ state: "low" });
    expect((await alertOf("DEMO-MUG-WHITE"))?.notified_at).not.toBeNull();
    await sendLowStockNotices();
    expect((await mails()).length).toBe(before);
    // Lowered below the stock it is armed; raised above the stock it is a crossing at that moment.
    await threshold("DEMO-MUG-WHITE", 1);
    expect((await alertOf("DEMO-MUG-WHITE"))?.state).toBe("ok");
    await threshold("DEMO-MUG-WHITE", 3);
    expect((await alertOf("DEMO-MUG-WHITE"))).toMatchObject({ state: "low", notified_at: null });
    await sendLowStockNotices();
    expect((await mails()).length).toBe(before + 1);
    // Cleared: off, nothing more.
    await threshold("DEMO-MUG-WHITE", null);
    expect((await alertOf("DEMO-MUG-WHITE"))?.state).toBe("off");
  });

  it("lists several variants that crossed in one email, each once", async () => {
    await clearLevels(store.storeId, "DEMO-MUG-BLACK");
    await clearLevels(store.storeId, "DEMO-NOTEBOOK-LINED");
    await setLevel(store.storeId, "DEMO-MUG-BLACK", oslo, 6);
    await setLevel(store.storeId, "DEMO-NOTEBOOK-LINED", oslo, 6);
    await threshold("DEMO-MUG-BLACK", 5);
    await threshold("DEMO-NOTEBOOK-LINED", 5);
    const before = (await mails()).length;
    await sellOne("DEMO-MUG-BLACK");
    await sellOne("DEMO-NOTEBOOK-LINED");
    await sendLowStockNotices();
    const mail = (await mails())[before];
    expect((await mails()).length).toBe(before + 1);
    expect(String(mail.subject)).toBe("Low stock: 2 products at or below their level");
    expect(String(mail.text)).toContain("DEMO-MUG-BLACK");
    expect(String(mail.text)).toContain("DEMO-NOTEBOOK-LINED");
    expect(LOW_STOCK_EMAIL_LINES).toBe(50);
  });

  it("keeps a crossing for the next run when the email could not be sent, and sends it then", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 6);
    await adjustStock(store.member, { reason: "correction", rows: [{ variantId: await variantId(store.storeId, "DEMO-TOTE"), locationId: oslo, mode: "set", value: 9, was: 6 }] });
    await sendLowStockNotices();
    const before = (await mails()).length;
    await sellOne("DEMO-TOTE");
    await sellOne("DEMO-TOTE");
    await sellOne("DEMO-TOTE");
    await sellOne("DEMO-TOTE");
    await sellOne("DEMO-TOTE");
    expect((await alertOf("DEMO-TOTE"))?.state).toBe("low");
    const failing = await sendLowStockNotices({ send: async () => "failed" });
    expect(failing.failed).toBeGreaterThanOrEqual(1);
    expect((await alertOf("DEMO-TOTE"))?.notified_at).toBeNull();
    expect((await mails()).length).toBe(before);
    await sendLowStockNotices({ send: sendEmail });
    expect((await mails()).length).toBe(before + 1);
    expect((await alertOf("DEMO-TOTE"))?.notified_at).not.toBeNull();
  });

  it("tells nobody about a store that is not open", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 9);
    await sellOne("DEMO-TOTE");
    await sendLowStockNotices();
    const before = (await mails()).length;
    // Rise above, then cross again while the store is suspended.
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 30);
    await sendLowStockNotices();
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 2);
    expect((await alertOf("DEMO-TOTE"))).toMatchObject({ state: "low", notified_at: null });
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    await sendLowStockNotices();
    expect((await mails()).length).toBe(before);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    await sendLowStockNotices();
    expect((await mails()).length).toBe(before + 1);
  });
});

describe("the database's state machine is the pure one", () => {
  const SKU = "DEMO-THERMOS";
  const states: (AlertState | "none")[] = ["none", "off", "ok", "low"];
  /** The variant in the state `prev`, with level 5 (or none) and stock 100 or 1, as a row of the table would be. */
  async function startAt(prev: AlertState | "none"): Promise<{ level: number | null; stock: number }> {
    await db().execute(sql`delete from commerce.stock_alerts where store_id = ${store.storeId}::uuid and variant_id = ${await variantId(store.storeId, SKU)}::uuid`);
    await threshold(SKU, null);
    await db().execute(sql`delete from commerce.stock_alerts where store_id = ${store.storeId}::uuid and variant_id = ${await variantId(store.storeId, SKU)}::uuid`);
    const stock = prev === "low" ? 1 : 100;
    await setLevel(store.storeId, SKU, oslo, stock);
    if (prev === "ok" || prev === "low") await threshold(SKU, 5);
    if (prev === "off") {
      await threshold(SKU, 5);
      await threshold(SKU, null);
    }
    return { level: prev === "ok" || prev === "low" ? 5 : null, stock };
  }
  const stateNow = async (): Promise<AlertState> => ((await alertOf(SKU))?.state as AlertState | undefined) ?? "off";

  it("moves every state by a change of the stock as nextAlertState() says, with the level kept", async () => {
    let n = 0;
    for (const prev of states) {
      for (const stock of [-1, 0, 3, 5, 6, 20]) {
        const start = await startAt(prev);
        expect(await stateNow(), `start ${prev}`).toBe(prev === "none" ? "off" : prev);
        await setLevel(store.storeId, SKU, oslo, stock);
        expect(await stateNow(), `${prev}: stock ${start.stock} -> ${stock}`).toBe(nextAlertState(prev === "none" ? null : prev, start.level, stock).state);
        n += 1;
      }
    }
    expect(n).toBe(24);
  }, 120_000);

  it("moves every state by a change of the level as nextAlertState() says, with the stock kept", async () => {
    let n = 0;
    for (const prev of states) {
      for (const level of [null, 0, 3, 5, 100, 101]) {
        const start = await startAt(prev);
        await threshold(SKU, level);
        expect(await stateNow(), `${prev}: level ${start.level} -> ${level}`).toBe(nextAlertState(prev === "none" ? null : prev, level, start.stock).state);
        n += 1;
      }
    }
    expect(n).toBe(24);
  }, 120_000);

  it("marks a new crossing as not told, and a level set on a low variant as told already, as the pure table does", async () => {
    await startAt("ok");
    await setLevel(store.storeId, SKU, oslo, 2);
    expect(nextAlertState("ok", 5, 2)).toMatchObject({ crossing: true, notifiedAt: "clear" });
    expect(await alertOf(SKU)).toMatchObject({ state: "low", notified_at: null });
    await startAt("off");
    await setLevel(store.storeId, SKU, oslo, 2);
    await threshold(SKU, 5);
    expect(nextAlertState("off", 5, 2)).toMatchObject({ crossing: false, notifiedAt: "now" });
    expect((await alertOf(SKU))?.notified_at).not.toBeNull();
  });
});

describe("the history's clean-up", () => {
  it("removes only movements past 24 months and never throws", async () => {
    await clearLevels(store.storeId, "DEMO-TOTE");
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 4);
    const [young] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_movements where store_id = ${store.storeId}::uuid`);
    expect(await pruneInventoryMovements(new Date(), 100)).toBeGreaterThanOrEqual(0);
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_movements where store_id = ${store.storeId}::uuid`);
    expect(after.n).toBe(young.n);
    // One that is old enough goes (the guard allows exactly this), in a batch, when a newer movement of its level exists; a young one is
    // refused by the database whoever asks.
    await db().execute(sql`alter table commerce.inventory_movements disable trigger inventory_movements_guard`);
    const [old] = await db().execute<Row>(sql`
      insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, created_at)
      select ${store.storeId}::uuid, variant_id, location_id, 1, 1, 'correction', 'system', now() - interval '25 months' from commerce.inventory_levels where store_id = ${store.storeId}::uuid and variant_id = (select variant_id from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where l.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-TOTE' limit 1) limit 1
      returning id
    `);
    await db().execute(sql`alter table commerce.inventory_movements enable trigger inventory_movements_guard`);
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 5);
    expect(await pruneInventoryMovements(new Date(), 100)).toBeGreaterThanOrEqual(1);
    expect(await db().execute(sql`select 1 from commerce.inventory_movements where id = ${String(old.id)}::bigint`)).toHaveLength(0);
    await expect(db().execute(sql`delete from commerce.inventory_movements where store_id = ${store.storeId}::uuid`)).rejects.toThrow();
  });

  it("keeps the newest movement of every level, however old, so the ledger check still adds up (review)", async () => {
    const made = await newStore("prune-keeps");
    const home = await mainLocation(made.storeId);
    await setLevel(made.storeId, "DEMO-TOTE", home, 12);
    await setLevel(made.storeId, "DEMO-MUG-WHITE", home, 8);
    await setLevel(made.storeId, "DEMO-TOTE", home, 9);
    // Two years pass without a single change: every movement of the store is old.
    await db().execute(sql`alter table commerce.inventory_movements disable trigger inventory_movements_guard`);
    await db().execute(sql`update commerce.inventory_movements set created_at = now() - interval '30 months' where store_id = ${made.storeId}::uuid`);
    await db().execute(sql`alter table commerce.inventory_movements enable trigger inventory_movements_guard`);
    const [before] = await db().execute<Row>(sql`select count(*)::int as n, count(distinct (variant_id, location_id))::int as levels from commerce.inventory_movements where store_id = ${made.storeId}::uuid`);
    expect(Number(before.n)).toBeGreaterThan(Number(before.levels));
    expect(await pruneInventoryMovements(new Date(), 10_000)).toBeGreaterThan(0);
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_movements where store_id = ${made.storeId}::uuid`);
    expect(after.n).toBe(before.levels);
    expect(await ledgerIsWhole(made.storeId)).toBe(true);
    // The kept movement is the newest of its level.
    const [tote] = await db().execute<Row>(sql`select on_hand_after from commerce.inventory_movements m join commerce.product_variants v on v.id = m.variant_id where m.store_id = ${made.storeId}::uuid and v.sku = 'DEMO-TOTE'`);
    expect(tote.on_hand_after).toBe(9);
  });
});
