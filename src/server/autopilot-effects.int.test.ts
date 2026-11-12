import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { measureAutopilotEffects, recentEffects, effectsOfMonth } = await import("./autopilot-effects");
const { getStore } = await import("./stores");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * What the autopilot's changes moved (D418) against a real database: a change to a product measured on that product's sales over the fourteen store
 * days before and after it with the store's beside them, a change to anything else on the store's, each once and only once it is two weeks old;
 * a person's change is never measured; and the month's summary.
 */

let fx: Fx;
let mug: string;
const DAY = 86_400_000;

beforeAll(async () => {
  fx = await fxStore("effects");
  const [p] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
  mug = String(p.product_id);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

/** A paid order sold `daysAgo` days ago (noon UTC, inside the store's day). */
async function soldDaysAgo(items: [string, number][], daysAgo: number) {
  const order = await paidOrder(fx, items);
  const at = new Date(Date.now() - daysAgo * DAY);
  at.setUTCHours(12, 0, 0, 0);
  await db().execute(sql`update commerce.orders set placed_at = ${at.toISOString()}::timestamptz, sold_at = ${at.toISOString()}::timestamptz where id = ${order.orderId}::uuid`);
  const [net] = await db().execute<Row>(sql`select coalesce(sum(total_minor - tax_minor), 0)::bigint as n from commerce.order_lines where order_id = ${order.orderId}::uuid and sku = ${items[0][0]}`);
  return Number(net.n);
}

async function changed(tool: string, args: Record<string, unknown>, daysAgo: number, actedBy = "autopilot"): Promise<number> {
  const at = new Date(Date.now() - daysAgo * DAY);
  at.setUTCHours(12, 0, 0, 0);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.audit_log (account_id, store_id, action, details, area, acted_by, created_at)
    values (${fx.accountId}::uuid, ${fx.storeId}::uuid, ${`store.assistant.${tool}`}, ${JSON.stringify({ args })}::jsonb, 'products', ${actedBy}, ${at.toISOString()}::timestamptz)
    returning id
  `);
  return Number(row.id);
}

describe("measuring the autopilot's changes (D418)", () => {
  it("measures a product change on the product's sales before and after, with the store's beside them, once", async () => {
    const before = await soldDaysAgo([["DEMO-MUG-WHITE", 1]], 25);
    const afterA = await soldDaysAgo([["DEMO-MUG-WHITE", 2]], 15);
    const afterB = await soldDaysAgo([["DEMO-MUG-WHITE", 1]], 12);
    const tote = await soldDaysAgo([["DEMO-TOTE", 1]], 14);
    const prices = await changed("set_prices", { product: mug }, 20);
    const page = await changed("build_page", { title: "About us" }, 20);
    const person = await changed("set_prices", { product: mug }, 20, "person");
    const young = await changed("set_prices", { product: mug }, 3);

    const run = await measureAutopilotEffects({ everyRun: true });
    expect(run.measured).toBeGreaterThanOrEqual(2);

    const rows = await db().execute<Row>(sql`select * from commerce.autopilot_effects where store_id = ${fx.storeId}::uuid order by audit_id`);
    const ofPrices = rows.find((r) => Number(r.audit_id) === prices)!;
    expect(ofPrices.target_kind).toBe("product");
    expect(String(ofPrices.product_id)).toBe(mug);
    expect(String(ofPrices.target_label)).not.toBe("");
    expect(Number(ofPrices.before_minor)).toBe(before);
    expect(Number(ofPrices.after_minor)).toBe(afterA + afterB);
    expect(Number(ofPrices.before_units)).toBe(1);
    expect(Number(ofPrices.after_units)).toBe(3);
    // The store's own: the mug before; the mug and the tote after.
    expect(Number(ofPrices.store_before_minor)).toBe(before);
    expect(Number(ofPrices.store_after_minor)).toBe(afterA + afterB + tote);
    expect(String(ofPrices.currency).trim()).toBe("NOK");

    const ofPage = rows.find((r) => Number(r.audit_id) === page)!;
    expect(ofPage.target_kind).toBe("store");
    expect(ofPage.product_id).toBeNull();
    expect(Number(ofPage.after_minor)).toBe(afterA + afterB + tote);
    expect(ofPage.before_units).toBeNull();

    // A person's change is not the autopilot's; one two weeks younger waits.
    expect(rows.some((r) => Number(r.audit_id) === person)).toBe(false);
    expect(rows.some((r) => Number(r.audit_id) === young)).toBe(false);

    // Measured once.
    await measureAutopilotEffects({ everyRun: true });
    const again = await db().execute<Row>(sql`select count(*)::int as n from commerce.autopilot_effects where audit_id in (${prices}, ${page})`);
    expect(Number(again[0].n)).toBe(2);
  }, 120_000);

  it("runs only in the first minutes of an hour unless told otherwise", async () => {
    const at = new Date();
    at.setUTCMinutes(30);
    expect(await measureAutopilotEffects({ now: at })).toEqual({ measured: 0, waiting: 0, skipped: 0 });
  });

  it("reads the measured changes back, newest first, and sums the month they were measured in", async () => {
    const recent = await recentEffects(fx.storeId);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    expect(recent.map((e) => e.targetKind).sort()).toEqual(["product", "store"]);
    const store = (await getStore(fx.slug))!;
    const month = new Date().toLocaleDateString("en-CA", { timeZone: store.timeZone }).slice(0, 7);
    const { summary } = await effectsOfMonth(store, month);
    expect(summary.measured).toBe(2);
    expect(summary.products).toBe(1);
    expect(summary.currency).toBe("NOK");
    expect(summary.liftMinor).not.toBeNull();
  }, 60_000);
});
