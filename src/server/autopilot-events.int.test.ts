import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { runEvents } = await import("./autopilot-events");
const { saveAutonomy } = await import("./autopilot-settings");
const { makePlanTool } = await import("./autopilot-tools");
const ownerTools = await import("./owner-tools");
const { getStore } = await import("./stores");
const admin = await import("./experiment-admin");
type Membership = import("./auth").Membership;
type TurnInput = import("./owner-assistant").TurnInput;
type Alert = import("@/lib/analytics-alerts").Alert;

type Row = Record<string, unknown>;

/**
 * Reacting to events (D331, `docs/ai-autopilot.md` 15.5), with a stand-in turn that acts through the real tools: nothing while the switch
 * is off; a customer waiting longer than the minutes is one event, answered once with a staff note, and one a person answered first is
 * skipped; a test that ended by itself is an event with only the test's tools; an alert's plan waits for a yes as a review's does; another
 * store is never touched.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
const turns: TurnInput[] = [];

const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });

const fakeTurn = async (input: TurnInput) => {
  turns.push(input);
  const kind = input.autopilot?.event;
  if (kind === "support_waiting") {
    const conversation = /conversation ([0-9a-f-]{36})/.exec(input.message)?.[1] ?? "";
    await ownerTools.runOwnerTool({ account: owner.account, store: (await getStore(store.slug))!, invalidate: () => {} }, "add_support_note", {
      conversation,
      note: "The customer asks where the parcel is; it was sent yesterday. Reply: it is on its way.",
    });
  }
  if (kind === "alert") {
    await makePlanTool(
      { ...actor(owner), scheduled: true, turn: { conversationId: input.conversationId ?? "" }, autopilot: input.autopilot },
      { title: "Look at conversion", summary: "", steps: [{ key: "s1", title: "Look at the funnel", kind: "tool", tool: "sales_funnel", args: {}, after: [] }] },
    );
  }
  input.emit({ type: "done", message: { id: "m", role: "assistant", content: `Handled the ${kind}.`, tools: [], feedback: null, createdAt: "" } });
};

const alert: Alert = { id: "conversion", severity: "urgent", text: "Conversion fell by half.", href: "/analytics", action: "Look", evidence: [{ label: "Conversion", value: "1.1%", baseline: "2.3%" }], size: 1 };
let alerts: Alert[] = [];
const react = () => runEvents({ turn: fakeTurn, connection: null, alerts: async () => alerts });
const eventsOf = async (storeId = store.id) => db().execute<Row>(sql`select * from commerce.autopilot_events where store_id = ${storeId}::uuid order by created_at`);
const settings = (planning: Record<string, unknown>) => saveAutonomy(actor(owner), { planning });

async function waitingConversation(minutes: number): Promise<string> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, queued_at)
    values (${store.id}::uuid, 'site', 'queue', ${`e-${Math.random()}`}, 'en', now() - make_interval(mins => ${minutes})) returning id
  `);
  return String(c.id);
}

beforeAll(async () => {
  store = await makeStore("autopilot-events");
  other = await makeStore("autopilot-events-other");
  for (const s of [store, other]) await db().execute(sql`update commerce.stores set status = 'active' where id = ${s.id}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on) values (${store.id}::uuid, 'people', false, false)`);
  owner = await membershipOf(store.slug, store.account, "owner");
});

beforeEach(() => {
  turns.length = 0;
  alerts = [];
});

afterAll(async () => {
  for (const s of [store, other]) {
    await db().execute(sql`delete from commerce.autopilot_events where store_id = ${s.id}::uuid`);
    await db().execute(sql`delete from commerce.autopilot_event_checks where store_id = ${s.id}::uuid`);
    await db().execute(sql`delete from commerce.assistant_plans where store_id = ${s.id}::uuid`);
    await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${s.id}::uuid`);
  }
  await closeDb();
});

describe("reacting to events", () => {
  it("finds nothing while the switch is off", async () => {
    await waitingConversation(60);
    await settings({ reacts: false });
    await react();
    expect(await eventsOf()).toHaveLength(0);
    expect(turns).toHaveLength(0);
  });

  it("answers a customer waiting past the minutes once, with a staff note and nothing to the customer", async () => {
    await db().execute(sql`update commerce.support_conversations set handler = 'human', status = 'ended' where store_id = ${store.id}::uuid`).catch(() => undefined);
    await db().execute(sql`delete from commerce.support_conversations where store_id = ${store.id}::uuid`).catch(() => undefined);
    await settings({ reacts: true, waitMinutes: 15 });
    const fresh = await waitingConversation(5);
    const waiting = await waitingConversation(20);
    await react();
    const rows = await eventsOf();
    expect(rows.map((r) => [r.kind, r.ref])).toEqual([["support_waiting", waiting]]);
    expect(rows[0]).toMatchObject({ status: "done", outcome: "Handled the support_waiting.", account_id: store.account.id });
    expect(turns[0].autopilot).toMatchObject({ event: "support_waiting" });
    expect(turns[0].autopilot?.tools).toContain("add_support_note");
    expect(turns[0].autopilot?.tools).not.toContain("reply_to_support");
    const notes = await db().execute<Row>(sql`select author from commerce.support_messages where conversation_id = ${waiting}::uuid and author <> 'system'`);
    expect(notes.map((n) => n.author)).toEqual(["note"]);
    expect(fresh).not.toBe(waiting);

    await react();
    expect(await eventsOf()).toHaveLength(1);
    expect(turns).toHaveLength(1);
  });

  it("skips a conversation a person took before the autopilot looked", async () => {
    const waiting = await waitingConversation(30);
    await db().execute(sql`
      insert into commerce.autopilot_events (store_id, kind, ref, facts)
      values (${store.id}::uuid, 'support_waiting', ${waiting}, ${JSON.stringify({ kind: "support_waiting", conversation: waiting, waitedMinutes: 30, handoffReason: null })}::jsonb)
    `);
    await db().execute(sql`delete from commerce.support_conversations where id = ${waiting}::uuid`).catch(() => undefined);
    await react();
    const row = (await eventsOf()).find((r) => r.ref === waiting);
    expect(row).toMatchObject({ status: "skipped" });
    expect(String(row?.outcome)).toContain("before the autopilot looked");
    expect(turns).toHaveLength(0);
  });

  it("makes an alert's plan wait for the owner's yes, as a review's does", async () => {
    // An earlier run today looked at the alerts (none then): the check is a day old again.
    await db().execute(sql`update commerce.autopilot_event_checks set alerts_at = now() - interval '25 hours' where store_id = ${store.id}::uuid`);
    alerts = [alert, { ...alert, id: "quiet", severity: "info" }];
    await react();
    const row = (await eventsOf()).find((r) => r.kind === "alert");
    expect(row).toMatchObject({ status: "done", started: false });
    expect(String(row?.ref)).toMatch(/^conversion:\d{4}-W\d{2}$/);
    expect(String(row?.outcome)).toContain("waits for your yes");
    expect((await eventsOf()).filter((r) => r.kind === "alert")).toHaveLength(1);
    expect(turns[0].message).toContain("Conversion: 1.1% (against 2.3%)");
    const [kept] = await db().execute<Row>(sql`select * from commerce.assistant_approvals where tool = 'start_autopilot_plan' and args ->> 'plan' = ${String(row?.plan_id)}`);
    expect(kept).toMatchObject({ status: "pending", category: "plan" });

    // Checked once a day: the same alerts are not read again within it.
    await react();
    expect((await eventsOf()).filter((r) => r.kind === "alert")).toHaveLength(1);
  });

  it("gives a test that ended by itself only the test's tools, and never touches another store", async () => {
    const [page] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and published is not null limit 1`);
    const made = await admin.createExperiment(store.account, store.id, { name: "Bigger photos", pageId: String(page.id), goal: "orders" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const variant = (await admin.getExperiment(store.id, made.id))!.variants.find((v) => v.key === "b")!.pageId!;
    const [content] = await db().execute<Row>(sql`select published from commerce.pages where id = ${variant}::uuid`);
    const changed = JSON.stringify({ ...(content.published as object), title: "Bigger photos (b)" });
    await db().execute(sql`update commerce.pages set draft = ${changed}::jsonb, published = ${changed}::jsonb where id = ${variant}::uuid`);
    const started = await admin.startExperiment(store.account, store.id, made.id);
    if (!started.ok) throw new Error(started.problems.join(" "));
    expect(await admin.stopExperiment(null, store.id, made.id, "planned_end")).toMatchObject({ ok: true });
    const test = { id: made.id };
    await react();
    const row = (await eventsOf()).find((r) => r.kind === "test_ended");
    expect(row).toMatchObject({ ref: String(test.id), status: "done" });
    expect(turns[0].autopilot?.tools).toEqual(["list_experiments", "explain_results", "apply_winner", "get_brand"]);
    expect(turns[0].message).toContain(`"Bigger photos" (id ${String(test.id)})`);
    expect(await eventsOf(other.id)).toHaveLength(0);
  });
});
