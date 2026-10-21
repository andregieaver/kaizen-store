import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Campaigns in depth (wave 5 unit E3, D299, `docs/wave-5-marketing.md` 7.3): the new kinds' checks and the order's free shipping. */

let db: PGlite;
let store: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const insert = (columns: string, values: string) => `insert into commerce.campaigns (store_id, name, ${columns}) values ($1, 'C', ${values})`;

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "cd-a");
});

afterAll(async () => {
  await db.close();
});

describe("campaigns in depth", () => {
  it("keep amounts to an amount campaign", async () => {
    await db.query(insert("kind, amounts, thresholds", "'amount', '{\"NO\": 10000}', '{\"NO\": 50000}'"), [store]);
    await rejects(insert("kind, percent, amounts", "'percent', 10, '{\"NO\": 10000}'"), [store], /campaigns_amounts/);
    await rejects(insert("kind, amounts", "'amount', '[]'"), [store], /campaigns_amounts/);
    await rejects(insert("kind, amounts, stacks", "'amount', '{\"NO\": 1}', true"), [store], /campaigns_stacks/);
  });

  it("keep steps to a tiered campaign, two to five, with a basis", async () => {
    const two = JSON.stringify([{ quantity: 2, percent: 10 }, { quantity: 4, percent: 20 }]);
    await db.query(insert("kind, tier_basis, tiers, stacks", `'tiered', 'quantity', '${two}', true`), [store]);
    await rejects(insert("kind, tier_basis, tiers", `'tiered', 'quantity', '[{"quantity": 2, "percent": 10}]'`), [store], /campaigns_tiers/);
    const six = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ quantity: i + 1, percent: i + 1 })));
    await rejects(insert("kind, tier_basis, tiers", `'tiered', 'quantity', '${six}'`), [store], /campaigns_tiers/);
    await rejects(insert("kind, tier_basis, tiers", `'tiered', 'weight', '${two}'`), [store], /campaigns_tiers/);
    await rejects(insert("kind, percent, tier_basis", "'percent', 10, 'quantity'"), [store], /campaigns_tiers/);
    await rejects(insert("kind, percent, tiers", `'percent', 10, '${two}'`), [store], /campaigns_tiers/);
  });

  it("make free shipping a kind that does not stack", async () => {
    await db.query(insert("kind", "'free_shipping'"), [store]);
    await rejects(insert("kind, stacks", "'free_shipping', true"), [store], /campaigns_stacks/);
    await rejects(insert("kind", "'bogus'"), [store], /campaigns_kind/);
  });

  it("keep an order's free shipping within what campaigns took off", async () => {
    const order = await placeOrder(db, store, { lines: [{ sku: "CD-1", unit: 10000 }], shipping: 4900, shippingDiscount: 4900, pay: false });
    await rejects(
      "update commerce.orders set campaign_shipping = '{\"id\": \"x\", \"name\": \"Frakt\", \"minor\": 4900}' where id = $1",
      [order.id],
      /orders_campaign_shipping/,
    );
    expect(await scalar("select campaign_shipping from commerce.orders where id = $1", [order.id])).toBeNull();
  });
});
