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
const creators = await import("./creators");
const { listPrices, listTargets, savePriceList } = await import("./price-lists");
const { storeOf } = await import("./product-data");
const { saveReward, listRewards } = await import("./bonus-rewards");
const { saveResource, listResources } = await import("./bookings");
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

describe("decide_creator, set_creator_rate and record_creator_payout", () => {
  it("approves an application by the creator's name, sets their own rate, and refuses a payout above what they are owed", async () => {
    expect((await creators.saveCreatorSettings(store.member.account, store.storeId, { enabled: true, commissionBps: 1000, categoryBps: {}, cookieDays: 30 })).ok).toBe(true);
    const [person] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at) values (${store.storeId}::uuid, ${`mia-${Date.now().toString(36)}@example.com`}, 'Mia', now())
      returning id`);
    expect(await creators.applyAsCreator(store.storeId, String(person.id), { name: "Mia Makes", channelUrl: "https://video.example/@mia", consent: true }, "I agree")).toEqual({ ok: true });

    expect(await refusal(preflight("decide_creator", { creator: "Nobody", decision: "approve" }))).toContain('no creator "Nobody"');
    expect(await refusal(preflight("decide_creator", { creator: "Mia Makes", decision: "stop" }))).toBe("Only an approved creator is stopped; Mia Makes is applied.");
    expect((await run("decide_creator", { creator: "mia makes", decision: "approve" })).done).toBe("Mia Makes is approved: their link earns commission from now.");
    const [mia] = await creators.listCreators(store.storeId);
    expect(mia).toMatchObject({ status: "approved", code: expect.any(String) });
    expect(await refusal(preflight("decide_creator", { creator: mia.code, decision: "approve" }))).toBe("Mia Makes is approved already.");

    expect((await run("set_creator_rate", { creator: mia.code, percent: 12.5 })).done).toBe("Mia Makes earns 12.5 % from now.");
    expect((await creators.listCreators(store.storeId))[0].commissionBps).toBe(1250);
    expect((await run("set_creator_rate", { creator: "Mia Makes", percent: null })).done).toBe("Mia Makes earns the programme's commission again.");

    // Nothing is owed yet: a payout is refused before the yes, and by the database if it got that far.
    expect(await refusal(preflight("record_creator_payout", { creator: "Mia Makes", amount: "100", currency: "nok", paid_on: "2026-10-31" }))).toContain("is owed");
    expect(await refusal(preflight("record_creator_payout", { creator: "Mia Makes", amount: "lots", currency: "NOK", paid_on: "2026-10-31" }))).toBe('"lots" could not be read as an amount in NOK.');

    expect((await run("decide_creator", { creator: "Mia Makes", decision: "stop" })).done).toBe("Mia Makes is stopped: their code earns nothing new.");
  });

  it("keeps the creator's rate and payouts for the owner, and never lets the autopilot decide one", () => {
    expect(OWNER_TOOLS_BY_NAME.decide_creator.gate).toBe("spend");
    expect(OWNER_TOOLS_BY_NAME.record_creator_payout.gate).toBe("spend");
  });
});

describe("set_price_list_prices", () => {
  it("sets and takes away a list's fixed prices by SKU, checking every row before anything is kept", async () => {
    const made = await savePriceList(store.member, null, { name: "Forhandler", percent: null, active: true });
    if (!made.ok) throw new Error("the list was not made");
    const [{ id: listId }] = await db().execute<{ id: string }>(sql`select id::text from commerce.price_lists where store_id = ${store.storeId}::uuid and name = 'Forhandler'`);

    expect(await refusal(preflight("set_price_list_prices", { list: "Engros", prices: [{ sku: SKU, currency: "NOK", amount: "199" }] }))).toContain('no price list "Engros"');
    expect(await refusal(preflight("set_price_list_prices", { list: "Forhandler", prices: [{ sku: "NO-SUCH", currency: "NOK", amount: "199" }] }))).toBe("The store has no variant with the SKU NO-SUCH.");
    expect(await refusal(preflight("set_price_list_prices", { list: "Forhandler", prices: [{ sku: SKU, currency: "JPY", amount: "199" }] }))).toContain("JPY is not a currency of the store's markets");
    expect(await refusal(preflight("set_price_list_prices", { list: "Forhandler", prices: [{ sku: SKU, currency: "NOK", amount: "cheap" }] }))).toBe('"cheap" could not be read as a price in NOK.');

    const set = await run("set_price_list_prices", { list: "forhandler", prices: [{ sku: SKU.toLowerCase(), currency: "nok", amount: "199,00" }] });
    expect(set.done).toBe('The price list "Forhandler" has 1 fixed price set.');
    const fixed = async () => (await listPrices(store.storeId, listId, "en-GB")).filter((p) => p.sku === SKU && p.currency === "NOK" && p.amount !== "");
    expect((await fixed()).length).toBe(1);

    expect((await run("set_price_list_prices", { list: "Forhandler", prices: [{ sku: SKU, currency: "NOK", amount: null }] })).done).toBe(
      'The price list "Forhandler" has 0 fixed prices set and 1 taken away.',
    );
    expect((await fixed()).length).toBe(0);
  });
});

/** The test store with these features on, read again so the tools see them. */
async function withFeatures(...features: string[]) {
  await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || ${`{${features.join(",")}}`}::text[])) where id = ${store.storeId}::uuid`);
  const fresh = await storeOf(store.storeId);
  if (!fresh) throw new Error("the store is gone");
  return { ...store, member: { ...store.member, store: fresh } };
}

describe("set_price_list_buyers", () => {
  it("gives a list to groups and companies by name, replacing who it was for, and refuses a name that fits nothing", async () => {
    const made = await savePriceList(store.member, null, { name: "Engros", percent: 10, active: true });
    if (!made.ok) throw new Error("the list was not made");
    const [{ id: listId }] = await db().execute<{ id: string }>(sql`select id::text from commerce.price_lists where store_id = ${store.storeId}::uuid and name = 'Engros'`);
    await saveTier(store.member, null, { name: "Grossist", percent: 5 });
    const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name) values (${store.storeId}::uuid, 'Fjord Kafé AS') returning id`);

    expect(await refusal(preflight("set_price_list_buyers", { list: "Engros", groups: ["Ukjent"] }))).toBe('The store has no customer group "Ukjent".');
    expect(await refusal(preflight("set_price_list_buyers", { list: "Engros", companies: ["Nobody AS"] }))).toBe('The store has no company "Nobody AS".');

    expect((await run("set_price_list_buyers", { list: "engros", groups: ["grossist"], companies: ["fjord kafé as"] })).done).toBe('The price list "Engros" is for 1 group and 1 company.');
    expect((await listTargets(store.storeId, listId)).companyIds).toEqual([String(company.id)]);
    expect((await run("set_price_list_buyers", { list: "Engros", groups: ["Grossist"] })).done).toBe('The price list "Engros" is for 1 group and 0 companies.');
    expect((await listTargets(store.storeId, listId)).companyIds).toEqual([]);
  });
});

describe("set_working_hours", () => {
  it("changes only the days given for a member of staff, keeps the rest, and refuses a day that ends before it starts", async () => {
    const booked = await withFeatures("appointments");
    const ctx = { account: booked.member.account, store: booked.member.store, invalidate: () => {} };
    const saved = await saveResource(booked.member, null, { name: "Ingrid", email: "", capacity: 1, active: true, hours: JSON.stringify({ week: { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" }, wed: null, thu: null, fri: null, sat: null, sun: null }, exceptions: [] }) }, "staff");
    if (!saved.ok) throw new Error(saved.problems.join());

    expect(await refusal(ownerTools.preflightOwnerTool(ctx, "set_working_hours", { staff: "Nobody", week: { mon: null } }))).toContain('No member of staff called "Nobody"');
    expect(await refusal(ownerTools.preflightOwnerTool(ctx, "set_working_hours", { staff: "Ingrid", week: { sat: { open: "14:00", close: "10:00" } } }))).toBe("On sat the day must end after it starts (14:00–10:00).");
    expect(await refusal(ownerTools.preflightOwnerTool(ctx, "set_working_hours", { staff: "Ingrid" }))).toContain("Nothing to change");

    const answer = (await ownerTools.runOwnerTool(ctx, "set_working_hours", { staff: "ingrid", week: { tue: null, sat: { open: "10:00", close: "14:00" } } })) as Answer;
    expect(answer.done).toBe("Ingrid takes appointments: Mon 09:00–17:00, Sat 10:00–14:00.");
    const [ingrid] = (await listResources(store.storeId, ["staff"])).filter((r) => r.name === "Ingrid");
    expect(ingrid.hours.week).toMatchObject({ mon: { open: "09:00", close: "17:00" }, tue: null, sat: { open: "10:00", close: "14:00" } });

    expect(((await ownerTools.runOwnerTool(ctx, "set_working_hours", { staff: "Ingrid", takes_bookings: false })) as Answer).done).toContain("takes no new bookings");
  });
});

describe("list_loyalty_rewards and switch_loyalty_reward", () => {
  it("lists the rewards with their cost in credits, and switches one off and on by name", async () => {
    const loyal = await withFeatures("bonus");
    const ctx = { account: loyal.member.account, store: loyal.member.store, invalidate: () => {} };
    const made = await saveReward(loyal.member, null, { name: "Free shipping", costMinor: 5_000, kind: "free_shipping" });
    if (!made.ok) throw new Error(made.problems.join());

    const listed = (await ownerTools.runOwnerTool(ctx, "list_loyalty_rewards", {})) as Answer;
    expect(listed.rewards).toEqual([{ name: "Free shipping", gives: "free shipping", costs: expect.stringContaining("50"), on: true }]);

    expect(await refusal(ownerTools.preflightOwnerTool(ctx, "switch_loyalty_reward", { reward: "Free shipping", on: true }))).toBe('"Free shipping" is on already.');
    expect(await refusal(ownerTools.preflightOwnerTool(ctx, "switch_loyalty_reward", { reward: "A pony", on: false }))).toContain('no loyalty reward "A pony"');
    expect(((await ownerTools.runOwnerTool(ctx, "switch_loyalty_reward", { reward: "free shipping", on: false })) as Answer).done).toBe('"Free shipping" is off: codes handed out for it stop working.');
    expect((await listRewards(store.storeId))[0].active).toBe(false);
    expect(((await ownerTools.runOwnerTool(ctx, "switch_loyalty_reward", { reward: "Free shipping", on: true })) as Answer).done).toBe('"Free shipping" is on.');
  });
});

describe("the reads", () => {
  it("say what there is, or plainly that there is nothing, and what can be booked waits for the store's bookings to be on", async () => {
    const owed = await run("owed_to_customers");
    expect(owed.pages.finance).toBe(`/admin/${store.slug}/analytics/finance`);
    expect(Array.isArray(owed.owed)).toBe(true);
    // The creator the case above stopped, by name and code, never their email.
    const listed = await run("list_creators", { status: "stopped" });
    expect(listed.creators).toEqual([expect.objectContaining({ name: "Mia Makes", status: "stopped", code: expect.any(String) })]);
    expect(JSON.stringify(listed)).not.toContain("@example.com");
    expect((await run("list_creators", { status: "applied" })).note).toBe("No creators match.");
    // What can be booked is for a store with Appointments or Stays and rentals on, as its pages are.
    expect(await refusal(run("booking_resources"))).toContain("Appointments or Stays and rentals is switched off");
  });
});
