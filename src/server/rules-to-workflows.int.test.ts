import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// The endpoint is only queued to here, never reached.
process.env.REPLICATE_ALLOW_PRIVATE = "1";

const rules = await import("./order-rules");
const alerts = await import("./staff-alerts");
const flows = await import("./workflows");
const moves = await import("./rules-to-workflows");
const { orderHold } = await import("./order-hold");
const { getOrderTags } = await import("./order-tags");
const { automaticOverview } = await import("./automatic");
const { addEndpoint } = await import("./webhook-endpoints");
const { whenPaidSteps, activeLines } = await import("@/lib/automatic");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * Order rules folded into workflows (ecosystem plan E3.3, D718), against a real database: a store's rules moved by code, once, to workflows with
 * the rules' ids; the workflow tags, holds and tells staff about a paid order as its rule did, for orders paid before the move as after it,
 * never twice and never chained; a rule that cannot move stays a rule and keeps running; and Settings → Automatic lists what runs by itself.
 */

let store: Fx;
const drain = async () => {
  for (let i = 0; i < 20; i++) {
    const run = await alerts.processStoreEvents({ limit: 200, storeIds: [store.storeId] });
    if (run.claimed < 200) return;
  }
};
const tagsOf = async (orderId: string) => (await getOrderTags(store.storeId, orderId)).map((t) => t.label).sort();
const flowRunsOf = (workflowId: string, orderId: string) =>
  db().execute<Row>(sql`select status, matched, event_key, outcome from commerce.workflow_runs where workflow_id = ${workflowId}::uuid and subject_id = ${orderId}::uuid`);
const ruleRunsOf = (orderId: string) => db().execute<Row>(sql`select rule_id, rule_name, matched from commerce.order_rule_runs where order_id = ${orderId}::uuid`);
const saved = async (input: unknown) => {
  const result = await rules.saveRule(store.storeId, null, input, store.accountId, { owner: true });
  if (!result.ok) throw new Error(result.message);
  return result.rule;
};

let big: Awaited<ReturnType<typeof saved>>;
let chained: Awaited<ReturnType<typeof saved>>;
let either: Awaited<ReturnType<typeof saved>>;
let before: Awaited<ReturnType<typeof paidOrder>>;

beforeAll(async () => {
  store = await fxStore("rules-move");
  await alerts.saveStaffAlerts(
    store.storeId,
    { recipients: [{ accountId: store.accountId, events: ["new_order", "automation"] }], contactEvents: [], summary: "off", summaryWeekday: 1, summaryHour: 8 },
    store.accountId,
  );
  big = await saved({
    name: "Big order",
    match: "all",
    conditions: [{ kind: "total_at_least", amountMinor: 1 }],
    actions: [
      { kind: "tag", label: "Big order" },
      { kind: "notify", note: "Check the stock before sending" },
      { kind: "hold", reason: "Check the stock" },
    ],
  });
  // Rules never chain: the tag Big order adds for a payment never satisfies this one for the same payment.
  chained = await saved({ name: "Tagged big", conditions: [{ kind: "has_tag", tag: "Big order" }], actions: [{ kind: "tag", label: "Chained" }] });
  // Any one of two conditions: no workflow can be it, so it stays a rule.
  either = await saved({ name: "Either", match: "any", conditions: [{ kind: "is_gift" }, { kind: "country_in", countries: ["NO"] }], actions: [{ kind: "tag", label: "Either" }] });
  // Paid before the move, its rules not handled yet.
  before = await paidOrder(store, [["DEMO-TOTE", 1]]);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("moving a store's rules (E3.3)", () => {
  it("moves every rule that can be a workflow, with its id, on when it was, and keeps one needing any of several conditions", async () => {
    expect(await moves.rulesMovePlan(store.storeId)).toEqual({
      moved: [
        { id: big.id, name: "Big order" },
        { id: chained.id, name: "Tagged big" },
      ],
      kept: [{ id: either.id, name: "Either", why: "any" }],
    });
    const outcome = await moves.moveRulesToWorkflows(store.storeId, store.accountId);
    expect(outcome.moved.map((m) => m.id)).toEqual([big.id, chained.id]);
    expect(outcome.kept.map((k) => k.id)).toEqual([either.id]);
    const flow = await flows.getWorkflow(store.storeId, big.id);
    expect(flow).toMatchObject({ name: "Big order", trigger: "order.paid", enabled: true, version: 1, testedVersion: 1 });
    expect(flow?.actions.map((a) => a.kind)).toEqual(["tag_order", "email_staff", "hold_order"]);
    expect(flow?.conditions).toEqual([{ field: "order.total_main", op: "at_least", value: "0.01" }]);
    // The rules' list and editor know only the rule that stayed.
    expect((await rules.listRules(store.storeId)).map((r) => r.id)).toEqual([either.id]);
    expect(await rules.getRule(store.storeId, big.id)).toBeNull();
    // Once: a second move finds nothing more to move.
    expect((await moves.moveRulesToWorkflows(store.storeId, store.accountId)).moved).toEqual([]);
    expect((await flows.listWorkflows(store.storeId)).filter((f) => f.id === big.id)).toHaveLength(1);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'automation.rules_moved'`);
    expect(audited.n).toBe(1);
  });

  it("does for an order paid before the move what the rule did: tagged, held by the workflow and staff told, once; the kept rule runs as before", async () => {
    await drain();
    // The engine queued the moved rules' workflows for the event instead of running them, and ran the rule that stayed.
    expect((await ruleRunsOf(before.orderId)).map((r) => r.rule_name)).toEqual(["Either"]);
    expect(await flowRunsOf(big.id, before.orderId)).toHaveLength(1);
    await flows.runWorkflows(500);
    const [run] = await flowRunsOf(big.id, before.orderId);
    expect(run).toMatchObject({ status: "done", matched: true });
    expect(await tagsOf(before.orderId)).toEqual(["Big order", "Either"]);
    const [held] = await db().execute<Row>(sql`select held_reason, held_by_rule, held_by from commerce.orders where id = ${before.orderId}::uuid`);
    expect(held).toMatchObject({ held_reason: "Check the stock", held_by_rule: big.id, held_by: null });
    expect(await orderHold(store.storeId, before.orderId)).toMatchObject({ reason: "Check the stock", workflow: { id: big.id, name: "Big order" }, rule: null });
    const [event] = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${before.orderId}::uuid and type = 'order.held'`);
    expect(event.data).toMatchObject({ reason: "Check the stock", workflow: big.id });
    const told = await db().execute<Row>(sql`select subject, text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'automation.notify' and idempotency_key like ${`workflow:%`}`);
    expect(told.some((e) => String(e.text).includes("Check the stock before sending") && String(e.subject).includes(before.number))).toBe(true);
    // Never chained: Tagged big ran, but saw the tags of the moment the order was paid.
    expect(await flowRunsOf(chained.id, before.orderId)).toMatchObject([{ status: "done", matched: false }]);
    // Processing the event again queues nothing more.
    await db().execute(sql`update commerce.store_events set rules_done_at = null where subject_id = ${before.orderId}::uuid`);
    await drain();
    expect(await flowRunsOf(big.id, before.orderId)).toHaveLength(1);
  });

  it("does the same for an order paid after the move, from the payment's own run, never a second one", async () => {
    const after = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await flows.runWorkflows(500);
    await drain();
    await flows.runWorkflows(500);
    expect(await flowRunsOf(big.id, after.orderId)).toHaveLength(1);
    expect((await flowRunsOf(big.id, after.orderId))[0]).toMatchObject({ status: "done", matched: true });
    expect(await tagsOf(after.orderId)).toEqual(["Big order", "Either"]);
    expect((await orderHold(store.storeId, after.orderId))?.workflow?.id).toBe(big.id);
    expect((await ruleRunsOf(after.orderId)).map((r) => r.rule_id)).toEqual([either.id]);
  });

  it("forgets a moved rule's row once no paid order's event can still need it, and a workflow's deletion takes its rule with it", async () => {
    await db().execute(sql`update commerce.order_rules set updated_at = now() - interval '1 hour' where store_id = ${store.storeId}::uuid and id = ${big.id}::uuid`);
    await rules.forgetMovedRules();
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_rules where store_id = ${store.storeId}::uuid and id = ${big.id}::uuid`);
    expect(left.n).toBe(0);
    expect(await flows.getWorkflow(store.storeId, big.id)).not.toBeNull();
    const member = { account: { id: store.accountId }, store: { id: store.storeId } } as never;
    expect(await flows.deleteWorkflow(member, chained.id)).toBe(true);
    const [gone] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_rules where store_id = ${store.storeId}::uuid and id = ${chained.id}::uuid`);
    expect(gone.n).toBe(0);
    expect((await rules.listRules(store.storeId)).map((r) => r.id)).toEqual([either.id]);
  });
});

describe("Settings → Automatic (E3.3)", () => {
  it("lists what runs by itself and what happens when an order is paid, in order", async () => {
    const member = { account: { id: store.accountId }, store: { id: store.storeId } } as never;
    const endpoint = await addEndpoint(member, { name: "ERP", url: "https://hooks.example.com/rules-move", topics: ["order.paid"] });
    if (!endpoint.ok) throw new Error(endpoint.problem);
    // The payment's own confirmation goes from the checkout's reply, which the fixture does not run: one as it writes it.
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, order_id)
      values (${store.storeId}::uuid, 'order.confirmation', 'buyer@example.com', 'Thanks', '<p>x</p>', 'x', ${before.orderId}::uuid)
    `);
    const [row] = await db().execute<Row>(sql`select features from commerce.stores where id = ${store.storeId}::uuid`);
    const overview = await automaticOverview({ id: store.storeId, features: (row.features as string[]) ?? [] });
    expect(overview.shop).toBe(true);
    expect(overview.workflows.map((w) => w.name)).toEqual(["Big order"]);
    expect(overview.rules.map((r) => r.name)).toEqual(["Either"]);
    expect(overview.staffAlerts.find((a) => a.event === "automation")).toMatchObject({ recipients: 1 });
    expect(overview.staffAlerts.find((a) => a.event === "new_order")?.lastSentAt).not.toBeNull();
    expect(overview.confirmationLastAt).not.toBeNull();
    expect(whenPaidSteps(overview).map((s) => s.kind)).toEqual(["confirmation", "workflow", "rule", "staff_email", "endpoint"]);
    expect(whenPaidSteps(overview).find((s) => s.kind === "workflow")).toMatchObject({ name: "Big order" });
    expect(activeLines(overview).map((l) => l.kind)).toEqual(expect.arrayContaining(["workflow", "rule", "staff_alert", "endpoint"]));
  });
});
