import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const rules = await import("./order-rules");
const alerts = await import("./staff-alerts");
const { holdOrder, releaseHold } = await import("./order-hold");
const { markSent } = await import("./order-admin");
const { getOrderTags } = await import("./order-tags");
const { fxStore, paidOrder, eventsOf, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * Automation rules (wave 3, D238, `docs/wave-3-notifications.md` 2.5, 2.6, 4.9 and 6.3 C3), against a real database: a rule stored per store, run once per
 * store event and logged; its tag, notify and hold actions; a held order's parcel refused until it is released; amounts compared in the store's main
 * currency (a euro order converted, an order without a rate never matching); another store's rules never run; the editor's input checked and kept to the
 * store's own products and countries.
 */

let store: Fx;
let other: Fx;

/** Works through the due store events of the stores this file made (the queue is shared with every other test file). */
const mine = new Set<string>();
const newStore = async (label: string) => {
  const fx = await fxStore(label);
  mine.add(fx.storeId);
  return fx;
};
const drain = async () => {
  for (let i = 0; i < 20; i++) {
    const run = await alerts.processStoreEvents({ limit: 200, storeIds: [...mine] });
    if (run.claimed < 200) return;
  }
};
const runsOf = async (orderId: string) =>
  db().execute<Row>(sql`select rule_id, rule_name, rule_version, matched, outcome from commerce.order_rule_runs where order_id = ${orderId}::uuid order by created_at, id`);
const heldOf = async (orderId: string) => (await db().execute<Row>(sql`select held_at, held_reason, held_by_rule, held_by from commerce.orders where id = ${orderId}::uuid`))[0];
const allRules = async (fx: Fx) => {
  for (const r of await rules.listRules(fx.storeId)) await rules.deleteRule(fx.storeId, r.id, fx.accountId);
};

beforeAll(async () => {
  store = await newStore("rules");
  other = await newStore("rules-other");
  await alerts.saveStaffAlerts(store.storeId, { recipients: [{ accountId: store.accountId, events: ["new_order", "automation"] }], contactEvents: [], summary: "off", summaryWeekday: 1, summaryHour: 8 }, store.accountId);
});
afterAll(async () => {
  await closeDb();
});

describe("a rule tags, notifies and holds a paid order, once (C3)", () => {
  it("runs once per event, logs it, and a second processing changes nothing", async () => {
    await allRules(store);
    const saved = await rules.saveRule(
      store.storeId,
      null,
      {
        name: "Big order",
        match: "all",
        conditions: [{ kind: "total_at_least", amountMinor: 1 }],
        actions: [
          { kind: "tag", label: "Big order" },
          { kind: "notify", note: "Check the stock before sending" },
          { kind: "hold", reason: "Check the stock" },
        ],
      },
      store.accountId,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await drain();
    const runs = await runsOf(order.orderId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ rule_id: saved.rule.id, rule_name: "Big order", rule_version: 1, matched: true });
    expect((runs[0].outcome as { actions: { ok: boolean }[] }).actions.map((a) => a.ok)).toEqual([true, true, true]);
    expect((await getOrderTags(store.storeId, order.orderId)).map((t) => t.label)).toEqual(["Big order"]);
    const held = await heldOf(order.orderId);
    expect(held).toMatchObject({ held_reason: "Check the stock", held_by_rule: saved.rule.id, held_by: null });
    expect(await eventsOf(order.orderId, "order.held")).toHaveLength(1);
    const notes = await db().execute<Row>(sql`select idempotency_key, subject, text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'automation.notify' and order_id = ${order.orderId}::uuid`);
    expect(notes).toHaveLength(1);
    expect(String(notes[0].text)).toContain("Check the stock before sending");
    // The new-order email says the order was held by a rule (rules run first).
    const [alert] = await db().execute<Row>(sql`select text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'staff.new_order' and order_id = ${order.orderId}::uuid`);
    expect(String(alert.text)).toContain("On hold by a rule");

    // Processing the same event again: no second run, tag, hold or email.
    await db().execute(sql`update commerce.store_events set rules_done_at = null, alerts_done_at = null where subject_id = ${order.orderId}::uuid`);
    await drain();
    expect(await runsOf(order.orderId)).toHaveLength(1);
    expect(await eventsOf(order.orderId, "order.held")).toHaveLength(1);
    expect(await db().execute(sql`select 1 from commerce.email_messages where kind = 'automation.notify' and order_id = ${order.orderId}::uuid`)).toHaveLength(1);
  });

  it("a held order's parcel is refused until it is released (by the app and the database)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await drain();
    expect((await heldOf(order.orderId)).held_at).not.toBeNull();
    const refused = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: "370HELD", trackingUrl: null }, store.accountId);
    expect(refused).toMatchObject({ ok: false, reason: "held" });
    await expect(
      db().execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'X', '1')`),
    ).rejects.toThrow();
    expect(await releaseHold(store.storeId, order.orderId, store.accountId)).toEqual({ ok: true });
    expect(await releaseHold(store.storeId, order.orderId, store.accountId)).toMatchObject({ ok: false, problem: "not_held" });
    const sent = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: "370REL", trackingUrl: null }, store.accountId);
    expect(sent.ok).toBe(true);
    expect(await holdOrder(store.storeId, order.orderId, { reason: "late", by: { account: store.accountId } })).toMatchObject({ ok: false, problem: "sent" });
    const audited = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.hold_released'`);
    expect(audited.length).toBeGreaterThan(0);
  });

  it("logs a rule that does not match, with why, and does nothing", async () => {
    await allRules(store);
    await rules.saveRule(store.storeId, null, { name: "Sweden only", conditions: [{ kind: "country_in", countries: ["SE"] }], actions: [{ kind: "tag", label: "Sweden" }] }, store.accountId);
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await drain();
    const [run] = await runsOf(order.orderId);
    expect(run.matched).toBe(false);
    expect((run.outcome as { conditions: { kind: string; met: boolean }[]; actions: unknown[] }).conditions).toEqual([{ kind: "country_in", met: false }]);
    expect((run.outcome as { actions: unknown[] }).actions).toEqual([]);
    expect(await getOrderTags(store.storeId, order.orderId)).toEqual([]);
    const log = await rules.ruleLog(store.storeId, { matched: false });
    expect(log.some((r) => r.orderId === order.orderId && r.orderNumber === order.number)).toBe(true);
  });

  it("a rule switched off is skipped, and another store's rule never runs on this store's orders", async () => {
    await allRules(store);
    const off = await rules.saveRule(store.storeId, null, { name: "Off", enabled: false, conditions: [], actions: [{ kind: "tag", label: "Off" }] }, store.accountId);
    await rules.saveRule(other.storeId, null, { name: "Theirs", conditions: [], actions: [{ kind: "tag", label: "Theirs" }] }, other.accountId);
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await drain();
    expect(await runsOf(order.orderId)).toHaveLength(0);
    expect(off.ok && (await rules.setRuleEnabled(other.storeId, off.rule.id, true, other.accountId))).toEqual({ ok: false });
  });
});

describe("amounts in the main currency (4.9, 6.5)", () => {
  it("compares a euro order's total converted to the store's main currency", async () => {
    await allRules(store);
    // 10 000 kr: a euro order of a couple of hundred euros is at least that only after conversion at 11.5.
    await rules.saveRule(store.storeId, null, { name: "Over 100 kr", conditions: [{ kind: "total_at_least", amountMinor: 10_000 }], actions: [{ kind: "tag", label: "Over 100" }] }, store.accountId);
    const order = await paidOrder(store, [["DEMO-TOTE", 1]], { market: NO_EUR });
    const facts = await rules.ruleFacts(store.storeId, order.orderId);
    expect(facts?.currency).toBe("EUR");
    expect(facts?.mainMinor).toBe(Math.round(order.totalMinor * 11.5));
    await drain();
    const [run] = await runsOf(order.orderId);
    expect(run.matched).toBe(facts!.mainMinor! >= 10_000);

    // Without a rate for the main currency the euro order cannot be compared: no amount, and `conditionMet()` says `no_rate` (order-rules.test.ts).
    await db().execute(sql`update commerce.store_currencies set rate = null where store_id = ${store.storeId}::uuid and currency = 'NOK'`);
    expect((await rules.ruleFacts(store.storeId, order.orderId))?.mainMinor).toBeNull();
    await db().execute(sql`update commerce.store_currencies set rate = 11.5 where store_id = ${store.storeId}::uuid and currency = 'NOK'`);
  });

  it("a guest's first order is not known (never matched by email)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const facts = await rules.ruleFacts(store.storeId, order.orderId);
    expect(facts?.firstOrder).toBeNull();
    expect(facts?.source).toBe("checkout");
    expect(facts?.delivery).toBe("shipping");
  });
});

describe("the editor's input (2.5)", () => {
  it("refuses another store's product, a country the store does not sell to, no action, and a 51st rule", async () => {
    await allRules(store);
    const [theirs] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${other.storeId}::uuid limit 1`);
    expect(await rules.saveRule(store.storeId, null, { name: "X", conditions: [{ kind: "has_product", productIds: [String(theirs.id)] }], actions: [{ kind: "tag", label: "x" }] }, store.accountId)).toMatchObject({
      ok: false,
      problem: "invalid",
    });
    expect(await rules.saveRule(store.storeId, null, { name: "X", conditions: [{ kind: "country_in", countries: ["US"] }], actions: [{ kind: "tag", label: "x" }] }, store.accountId)).toMatchObject({
      ok: false,
      problem: "invalid",
    });
    expect(await rules.saveRule(store.storeId, null, { name: "X", conditions: [], actions: [] }, store.accountId)).toMatchObject({ ok: false, problem: "invalid" });
    for (let i = 0; i < 50; i++) {
      const r = await rules.saveRule(store.storeId, null, { name: `R${i}`, enabled: false, conditions: [], actions: [{ kind: "tag", label: "x" }] }, store.accountId);
      expect(r.ok).toBe(true);
    }
    expect(await rules.saveRule(store.storeId, null, { name: "R50", conditions: [], actions: [{ kind: "tag", label: "x" }] }, store.accountId)).toMatchObject({ ok: false, problem: "limit" });
    const list = await rules.listRules(store.storeId);
    const reversed = [...list].reverse().map((r) => r.id);
    expect(await rules.orderRules(store.storeId, reversed, store.accountId)).toEqual({ ok: true });
    expect((await rules.listRules(store.storeId))[0].id).toBe(reversed[0]);
    expect(await rules.orderRules(store.storeId, reversed.slice(1), store.accountId)).toMatchObject({ ok: false });
    // A change raises the version.
    const changed = await rules.saveRule(store.storeId, reversed[0], { name: "Renamed", conditions: [], actions: [{ kind: "tag", label: "y" }] }, store.accountId);
    expect(changed.ok && changed.rule.version).toBe(2);
    await allRules(store);
  });
});

describe("a rule asks the AI manager (PSI AGT-04)", () => {
  it("is an owner's to make, queues a follow-up for the paid order in their name, and stops at the day's limit", async () => {
    await allRules(store);
    const body = { name: "Look at big orders", match: "all", conditions: [], actions: [{ kind: "ask", question: "Is anything unusual about this order?" }] };
    expect(await rules.saveRule(store.storeId, null, body, store.accountId)).toMatchObject({ ok: false, message: rules.ASK_OWNER_ONLY });
    const saved = await rules.saveRule(store.storeId, null, body, store.accountId, { owner: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await drain();
    const [run] = await runsOf(order.orderId);
    expect((run.outcome as { actions: { kind: string; ok: boolean }[] }).actions).toEqual([{ kind: "ask", ok: true }]);
    const followUps = await db().execute<Row>(sql`
      select f.account_id, f.origin, f.status, f.task, f.due_at <= now() as due, c.title from commerce.assistant_follow_ups f
      join commerce.assistant_conversations c on c.id = f.conversation_id
      where f.store_id = ${store.storeId}::uuid and f.order_id = ${order.orderId}::uuid
    `);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ account_id: store.accountId, origin: "rule", status: "waiting", due: true });
    expect(String(followUps[0].task)).toContain("Is anything unusual about this order?");
    expect(String(followUps[0].title)).toContain("Look at big orders");

    // At the day's limit the rule says so in its log and queues nothing.
    const conversation = await db().execute<Row>(sql`select conversation_id from commerce.assistant_follow_ups where order_id = ${order.orderId}::uuid`);
    await db().execute(sql`
      insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, time_zone, origin, status)
      select ${store.storeId}::uuid, ${store.accountId}::uuid, ${String(conversation[0].conversation_id)}::uuid, 'x', now(), 'Europe/Oslo', 'rule', 'done'
      from generate_series(1, 19)
    `);
    const late = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await drain();
    const [limited] = await runsOf(late.orderId);
    expect((limited.outcome as { actions: { kind: string; ok: boolean; problem?: string }[] }).actions).toEqual([{ kind: "ask", ok: false, problem: "ask_limit" }]);
    expect(await db().execute(sql`select 1 from commerce.assistant_follow_ups where order_id = ${late.orderId}::uuid`)).toHaveLength(0);

    await db().execute(sql`delete from commerce.assistant_follow_ups where store_id = ${store.storeId}::uuid`);
    await allRules(store);
  });
});
