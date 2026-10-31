import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { OWNER_TOOLS_BY_NAME } from "@/lib/owner-tools";
import { READY_REPORTS } from "@/lib/report-catalogue";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const orders = await import("./purchase-orders");
const { saveTier } = await import("./customer-tiers");
const { saveReport } = await import("./saved-reports");
const { listReportSchedules } = await import("./report-schedules");
const { addLocation, clearLevels, levelsOf, newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's tools for the screens it had none for (PSI AGT-01), run as the assistant runs them against a real store: each change
 * checked before it is kept for a yes, then made by the screen's own service; each read the screen's own figures, never a person's email.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let bergen: string;
const SKU = "DEMO-TOTE";

const ctxOf = (s: typeof store) => ({ account: s.member.account, store: s.member.store, invalidate: () => {} });
const run = (name: string, input: unknown = {}, s = store) => ownerTools.runOwnerTool(ctxOf(s), name, input) as Promise<Answer>;
const preflight = (name: string, input: unknown, s = store) => ownerTools.preflightOwnerTool(ctxOf(s), name, input);
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ownerTools.OwnerToolError ? error.message : `not a tool refusal: ${String(error)}`;
  }
};

beforeAll(async () => {
  store = await newStore("screentools");
  bergen = await addLocation(store.storeId, "Bergen lager", 5);
  await clearLevels(store.storeId, SKU);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("receive_purchase_order", () => {
  it("counts an ordered purchase order in by its reference, in parts and then the rest, and refuses what cannot be counted before the yes", async () => {
    const made = await orders.createPurchaseOrder(store.member, {
      supplier: "Vevstua AS",
      reference: "PO-31",
      currency: "NOK",
      location: bergen,
      lines: [{ sku: SKU, quantity: 10, unitCost: "45,50" }],
    });
    if (!made.ok) throw new Error(made.problems.join());
    // A draft is refused before the yes, in words.
    expect(await refusal(preflight("receive_purchase_order", { order: "PO-31" }))).toContain("still a draft");
    expect(await refusal(preflight("receive_purchase_order", { order: "PO-404" }))).toContain('No purchase order "PO-404"');
    await orders.placePurchaseOrder(store.member, made.id);

    expect(await refusal(preflight("receive_purchase_order", { order: "po-31", lines: [{ sku: SKU, quantity: 11 }] }))).toBe(`Only 10 of ${SKU} are still to come on this order, not 11.`);
    expect(await refusal(preflight("receive_purchase_order", { order: "PO-31", lines: [{ sku: "DEMO-MUG-WHITE", quantity: 1 }] }))).toBe("SKU DEMO-MUG-WHITE is not on purchase order PO-31.");
    await preflight("receive_purchase_order", { order: "PO-31", lines: [{ sku: SKU, quantity: 4 }] });

    const part = await run("receive_purchase_order", { order: "PO-31", lines: [{ sku: SKU, quantity: 4 }] });
    expect(part.done).toBe("Counted in 4 units on purchase order PO-31, at Bergen lager.");
    expect(part.pages.purchase_order).toBe(`/admin/${store.slug}/inventory/purchase-orders/${made.id}`);
    expect((await levelsOf(store.storeId, SKU))["Bergen lager"]).toBe(4);

    // By the supplier's name, the one open order of theirs, the rest.
    const rest = await run("receive_purchase_order", { order: "vevstua as" });
    expect(rest.done).toBe("Counted in 6 units on purchase order PO-31, at Bergen lager.");
    expect((await levelsOf(store.storeId, SKU))["Bergen lager"]).toBe(10);
    expect((await orders.getPurchaseOrder(store.storeId, made.id))?.state).toBe("received");
    expect(await refusal(preflight("receive_purchase_order", { order: "PO-31" }))).toContain("received in full");
  });

  it("is kept for a yes, as a change others can see", () => {
    expect(OWNER_TOOLS_BY_NAME.receive_purchase_order.gate).toBe("public");
  });
});

describe("schedule_report and list_report_schedules", () => {
  it("schedules a saved report by its title to the asker, lists it by name, and refuses what is not there", async () => {
    const saved = await saveReport(store.storeId, store.accountId, { title: "Weekly sales", spec: READY_REPORTS.sales_by_product });
    if (!saved.ok) throw new Error(saved.reason);
    expect((await run("list_report_schedules")).note).toBe("No report is emailed on a schedule.");

    expect(await refusal(preflight("schedule_report", { report: "Monthly refunds", frequency: "daily" }))).toContain('no saved report "Monthly refunds"');
    expect(await refusal(preflight("schedule_report", { report: "Weekly sales", frequency: "weekly" }))).toContain("needs its weekday");
    expect(await refusal(preflight("schedule_report", { report: "Weekly sales", frequency: "daily", recipients: ["nobody@example.com"] }))).toBe(
      "nobody@example.com is not one of the store's people who may get its reports.",
    );

    const answer = await run("schedule_report", { report: "weekly SALES", frequency: "weekly", weekday: 1, hour: 8 });
    expect(answer.done).toBe('"Weekly sales" is emailed weekly at 08:00 to 1 person.');
    const [kept] = await listReportSchedules(store.storeId);
    expect(kept).toMatchObject({ reportId: saved.id, frequency: "weekly", weekday: 1, hour: 8, recipients: [store.accountId], enabled: true });

    const listed = await run("list_report_schedules");
    expect(listed.schedules).toEqual([{ report: "Weekly sales", when: "weekly on Monday", hour: "08:00", to: ["Test"], on: true, last_sent: null }]);
    expect(JSON.stringify(listed)).not.toContain(store.accountEmail);
  });
});

describe("list_customer_groups and set_customer_group", () => {
  it("puts a customer in a group by their email and the group's name, takes them out again, and refuses names that fit nothing", async () => {
    const tier = await saveTier(store.member, null, { name: "Trade", percent: 15 });
    if (!tier.ok) throw new Error("the group was not made");
    const email = `kari-${Date.now().toString(36)}@example.com`;
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${email}, 'Kari') returning id`);
    const tierOf = async () => (await db().execute<Row>(sql`select tier_id from commerce.customers where id = ${String(customer.id)}::uuid`))[0].tier_id;

    expect(await refusal(preflight("set_customer_group", { customer: "nobody@example.com", group: "Trade" }))).toBe("The store has no customer with the email nobody@example.com.");
    expect(await refusal(preflight("set_customer_group", { customer: email, group: "VIP" }))).toContain('no customer group "VIP"');

    expect((await run("set_customer_group", { customer: email.toUpperCase(), group: "trade" })).done).toContain('is in the group "Trade" (15 % off)');
    expect(await tierOf()).toBe(tier.id);
    expect((await run("list_customer_groups")).groups).toEqual([{ name: "Trade", discount_percent: 15, on: true, customers: 1, companies: 0 }]);

    expect((await run("set_customer_group", { customer: email, group: null })).done).toBe(`${email} is in no customer group now.`);
    expect(await tierOf()).toBeNull();
  });

  it("is never automatic for the autopilot: a group decides a customer's prices", () => {
    expect(OWNER_TOOLS_BY_NAME.set_customer_group.gate).toBe("spend");
  });
});

describe("the reads", () => {
  it("say plainly when there is nothing, and what can be booked waits for the store's bookings to be on", async () => {
    const owed = await run("owed_to_customers");
    expect(owed.pages.finance).toBe(`/admin/${store.slug}/analytics/finance`);
    expect(Array.isArray(owed.owed)).toBe(true);
    expect((await run("list_creators")).note).toBe("No creators match.");
    // What can be booked is for a store with Appointments or Stays and rentals on, as its pages are.
    expect(await refusal(run("booking_resources"))).toContain("Appointments or Stays and rentals is switched off");
  });
});
