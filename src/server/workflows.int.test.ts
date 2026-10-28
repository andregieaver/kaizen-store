import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { WorkflowInput } from "@/lib/workflows";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// The endpoint is only queued to here, never reached: the address guard is let through so the test needs no name lookup.
process.env.REPLICATE_ALLOW_PRIVATE = "1";

const flows = await import("./workflows");
const endpoints = await import("./webhook-endpoints");
const { newStore, place, pay } = await import("./inventory-test-support");

/**
 * Workflows (wave 9 unit C, D356): saved off, switched on only after a test of the version saved; an event starts each one once, its
 * conditions read from the event's data, and its actions run through the screens' functions (an order's tag, staff's email, a signed request
 * to the owner's endpoint, the AI manager's follow-up); capped at 100 runs an hour; a schedule runs once a day.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let endpointId: string;
const SKU = "DEMO-MUG-WHITE";

const bigOrders = (endpoint: string): WorkflowInput => ({
  name: "Big orders",
  trigger: "order.paid",
  schedule: null,
  conditions: [
    { field: "order.total", op: "more_than", value: "0" },
    { field: "order.lines.sku", op: "is", value: SKU },
  ],
  actions: [
    { kind: "tag_order", tag: "Workflow VIP" },
    { kind: "note_order", text: "Gift wrap it." },
    { kind: "email_staff", subject: "A big order", text: "Pack it with care." },
    { kind: "send_request", endpointId: endpoint },
    { kind: "ask_ai_manager", question: "Is anything unusual about it?" },
  ],
});

const runsOf = (id: string) => db().execute<Row>(sql`select status, matched, outcome, subject_id from commerce.workflow_runs where workflow_id = ${id}::uuid order by created_at`);

beforeAll(async () => {
  store = await newStore("flows");
  const added = await endpoints.addEndpoint(store.member, { name: "Hook", url: "https://hooks.example.com/flows", topics: ["discount.created"] });
  if (!added.ok) throw new Error(added.problem);
  endpointId = added.id;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("saving, testing and switching on", () => {
  it("saves off, refuses switching on until the version saved is tested, and a change needs a test again", async () => {
    const saved = await flows.saveWorkflow(store.member, null, bigOrders(endpointId));
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    expect((await flows.getWorkflow(store.storeId, saved.id))?.enabled).toBe(false);
    expect(await flows.switchWorkflow(store.member, saved.id, true)).toBe("untested");
    await place(store.storeId, [[SKU, 1]]).then((o) => pay(store.storeId, o, store.account));
    const tested = await flows.testWorkflow(store.member, saved.id);
    expect(tested).toMatchObject({ ok: true, found: true, matched: true });
    expect(tested.ok && tested.actions.map((a) => a.kind)).toEqual(["tag_order", "note_order", "email_staff", "send_request", "ask_ai_manager"]);
    expect(await flows.switchWorkflow(store.member, saved.id, true)).toBe("ok");
    await flows.saveWorkflow(store.member, saved.id, { ...bigOrders(endpointId), name: "Big orders, changed" });
    expect((await flows.getWorkflow(store.storeId, saved.id))?.enabled).toBe(false);
    expect(await flows.switchWorkflow(store.member, saved.id, true)).toBe("untested");
    await flows.testWorkflow(store.member, saved.id);
    expect(await flows.switchWorkflow(store.member, saved.id, true)).toBe("ok");
  });

  it("refuses a field the trigger lacks, another store's endpoint and an ask from someone not an owner", async () => {
    expect(await flows.saveWorkflow(store.member, null, { ...bigOrders(endpointId), conditions: [{ field: "stock.sku", op: "is", value: "x" }] })).toMatchObject({ ok: false });
    expect(await flows.saveWorkflow(store.member, null, { ...bigOrders("5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d") })).toMatchObject({ ok: false });
    const staff = { ...store.member, role: "staff" as const, permissions: ["settings:read", "settings:write"] };
    const refused = await flows.saveWorkflow(staff as never, null, bigOrders(endpointId));
    expect(refused.ok).toBe(false);
  });
});

describe("running", () => {
  it("runs once per paid order, acting through the screens' functions, and records an order whose conditions do not hold", async () => {
    const [flow] = (await flows.listWorkflows(store.storeId)).filter((f) => f.enabled);
    const order = await place(store.storeId, [[SKU, 1]]);
    await pay(store.storeId, order, store.account);
    const other = await place(store.storeId, [["DEMO-TOTE", 1]]);
    await pay(store.storeId, other, store.account);
    await flows.runWorkflows(500);
    const runs = await runsOf(flow.id);
    const mine = runs.find((r) => r.subject_id === order.orderId)!;
    expect(mine).toMatchObject({ status: "done", matched: true });
    expect(runs.find((r) => r.subject_id === other.orderId)).toMatchObject({ matched: false });
    const [tag] = await db().execute<Row>(sql`select label from commerce.order_tags where order_id = ${order.orderId}::uuid`);
    expect(tag?.label).toBe("Workflow VIP");
    const [note] = await db().execute<Row>(sql`select data ->> 'note' as note from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'note.added'`);
    expect(note?.note).toBe("Gift wrap it.");
    const [delivery] = await db().execute<Row>(sql`select event, subject_id from commerce.integration_deliveries where endpoint_id = ${endpointId}::uuid and event = 'order.paid'`);
    expect(delivery).toMatchObject({ event: "order.paid", subject_id: order.orderId });
    const [asked] = await db().execute<Row>(sql`select count(*)::int as n from commerce.assistant_follow_ups where store_id = ${store.storeId}::uuid and order_id = ${order.orderId}::uuid`);
    expect(asked.n).toBe(1);
    const [emailed] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${store.storeId}::uuid and idempotency_key like ${`workflow:%`}`);
    expect(Number(emailed.n)).toBeGreaterThan(0);
    // Running again does nothing more: each run was taken once.
    await flows.runWorkflows(500);
    expect((await runsOf(flow.id)).filter((r) => r.subject_id === order.orderId)).toHaveLength(1);
  });

  it("records a run over the hourly cap as capped and does nothing", async () => {
    const [flow] = (await flows.listWorkflows(store.storeId)).filter((f) => f.enabled);
    await db().execute(sql`
      insert into commerce.workflow_runs (store_id, workflow_id, event, event_key, status)
      select ${store.storeId}::uuid, ${flow.id}::uuid, 'order.paid', 'filler:' || g, 'done' from generate_series(1, 100) g
    `);
    const order = await place(store.storeId, [[SKU, 1]]);
    await pay(store.storeId, order, store.account);
    expect((await runsOf(flow.id)).find((r) => r.subject_id === order.orderId)).toMatchObject({ status: "capped" });
    await db().execute(sql`delete from commerce.workflow_runs where workflow_id = ${flow.id}::uuid and event_key like 'filler:%'`);
  });

  it("runs a schedule once a day, once its time has come", async () => {
    const saved = await flows.saveWorkflow(store.member, null, {
      name: "Morning note",
      trigger: "schedule",
      schedule: { every: "day", at: "00:00", weekday: null },
      conditions: [],
      actions: [{ kind: "email_staff", subject: "Good morning", text: "Check the orders to send." }],
    });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    await flows.testWorkflow(store.member, saved.id);
    await flows.switchWorkflow(store.member, saved.id, true);
    expect(await flows.queueScheduledRuns()).toBeGreaterThanOrEqual(1);
    expect(await flows.queueScheduledRuns()).toBe(0);
    await flows.runWorkflows(500);
    expect(await runsOf(saved.id)).toEqual([expect.objectContaining({ status: "done", matched: true })]);
  });
});
