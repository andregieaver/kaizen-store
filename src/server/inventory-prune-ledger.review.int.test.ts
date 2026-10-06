import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { pruneInventoryMovements } = await import("./stock-alerts");
const { ledgerProblems } = await import("./inventory");
const { adjustStock } = await import("./inventory");
const { mainLocation, newStore, setLevel, variantId, ledgerIsWhole } = await import("./inventory-test-support");

let store: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("prune-ledger");
});
afterAll(async () => {
  await closeDb();
});

describe("review (security lens): the 24-month clean-up must not break the ledger check", () => {
  it("leaves inventory_ledger_check() empty after the oldest movements of a level are pruned", async () => {
    const oslo = await mainLocation(store.storeId);
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 10);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
    // 25 months pass: the store's movements so far are old. (The guard is switched off only to age the rows.)
    await db().execute(sql`alter table commerce.inventory_movements disable trigger inventory_movements_guard`);
    await db().execute(sql`update commerce.inventory_movements set created_at = now() - interval '25 months' where store_id = ${store.storeId}::uuid`);
    await db().execute(sql`alter table commerce.inventory_movements enable trigger inventory_movements_guard`);
    // A recent count the next month keeps its movement.
    const v = await variantId(store.storeId, "DEMO-TOTE");
    const saved = await adjustStock(store.member, { reason: "count", rows: [{ variantId: v, locationId: oslo, mode: "set", value: 7, was: 10 }] });
    expect(saved.ok && saved.written).toBe(1);
    expect(await pruneInventoryMovements(new Date(), 1000)).toBeGreaterThan(0);
    // The history that is left still explains every level: the newest movement's on_hand_after is the level.
    expect(await ledgerProblems(store.storeId)).toEqual([]);
  });
});
