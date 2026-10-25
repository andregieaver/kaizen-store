import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/** Kaizen's platform Stripe client, faked: refunds and hosted sessions, recorded. */
const fake = vi.hoisted(() => {
  const refunds: Record<string, unknown>[] = [];
  let next = 0;
  const client = {
    refunds: { create: async (params: Record<string, unknown>) => (refunds.push(params), { id: `re_tool_${refunds.length}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: "co_x" }) },
    checkout: {
      sessions: {
        create: async () => ({ id: `cs_tool_${++next}`, url: `https://checkout.stripe.test/${next}`, payment_method_types: ["card"] }),
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null, status: "complete", payment_status: "paid" }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");
const { orderChangeApprovalDetails } = await import("./order-change-tools");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * The AI manager's order changes and exchanges (PSI AGT-01): a change previewed and made only through the order editor's functions; a lower total
 * refunded at once, a higher one sent as a pay link and the order left as it is; the approval keeps the order's state it was previewed on and the
 * change refuses once the order moved; an exchange needs a return the customer confirmed.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
const ctx = async () => ({ account: { id: store.accountId, email: `${store.slug}@example.com`, name: "T", platformAdmin: false }, store: (await getStore(store.slug))!, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);
const lines = async (orderId: string) =>
  (await db().execute<Row>(sql`select sku, quantity from commerce.order_lines where order_id = ${orderId}::uuid order by sku`)).map((l) => [String(l.sku), Number(l.quantity)]);

beforeAll(async () => {
  store = await fxStore("change-tools", { live: true });
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
});
afterAll(async () => closeDb());

describe("the order change tools", () => {
  it("previews and makes a lower total, refunded through the editor", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3], ["DEMO-MUG-WHITE", 1]]);
    const change = { order: order.number, change: [{ item: "DEMO-TOTE", quantity: 1 }], reason: "customer_request" };
    const preview = (await run("preview_order_change", change)) as { can_be_made: boolean; money: string };
    expect(preview).toMatchObject({ can_be_made: true, money: expect.stringContaining("goes back to the customer") });
    expect(await lines(order.orderId)).toEqual([["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 3]]);

    const c = await ctx();
    await ownerTools.preflightOwnerTool(c, "change_order", change);
    const details = await orderChangeApprovalDetails(c, { ...change, add: [], notify: true, restock: true, reason: "customer_request" });
    expect(details?.summary).toMatch(new RegExp(`^Change order ${order.number}: DEMO-TOTE down to 1; refund `));
    const done = await run("change_order", { ...change, approved_base: details!.base });
    expect(done).toMatchObject({ done: expect.stringContaining("goes back to the customer") });
    expect(await lines(order.orderId)).toEqual([["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]);
    expect(fake.refunds.length).toBe(1);

    // The yes was for the order as it was: kept again, it is refused as changed.
    await expect(run("change_order", { ...change, change: [{ item: "DEMO-MUG-WHITE", quantity: 0 }], approved_base: details!.base })).rejects.toThrow(ownerTools.OwnerToolError);
  });

  it("sends a higher total as a pay link and leaves the order as it is", async () => {
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const change = { order: order.number, add: [{ sku: "DEMO-TOTE", quantity: 2 }], reason: "customer_request" };
    expect(await run("preview_order_change", change)).toMatchObject({ money: expect.stringContaining("pays") });
    const done = await run("change_order", change);
    expect(done).toMatchObject({ done: expect.stringContaining("waits for the customer to pay") });
    expect(await lines(order.orderId)).toEqual([["DEMO-MUG-WHITE", 1]]);
    const [edit] = await db().execute<Row>(sql`select status from commerce.order_edits where order_id = ${order.orderId}::uuid`);
    expect(edit.status).toBe("awaiting_payment");
  });

  it("names a line it cannot find, and refuses an empty change", async () => {
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    await expect(run("preview_order_change", { order: order.number, change: [{ item: "Nothing", quantity: 0 }], reason: "other" })).rejects.toThrow(/has no line "Nothing"/);
    await expect(run("preview_order_change", { order: order.number, reason: "other" })).rejects.toThrow(/Say what changes/);
  });

  it("asks for a return the customer confirmed before an exchange is processed", async () => {
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "process_exchange", { return: "9999-R1" })).rejects.toThrow(/No return 9999-R1/);
    await expect(run("preview_exchange", { return: "9999-R1", replacements: [{ sku: "DEMO-TOTE", quantity: 1 }] })).rejects.toThrow(/No return/);
  });
});
