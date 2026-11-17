import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { latestEvents, runEvents } = await import("./autopilot-events");
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
 * store is never touched. Since E4.2 a waiting customer and a test's answer come from the event log (the desk's `support.waiting`, the
 * test's `experiment.answered`), read with the autopilot's own cursor.
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
    await ownerTools.runOwnerTool({ account: owner.account, store: (await getStore(store.slug))!, holder: { role: "owner" as const }, invalidate: () => {} }, "add_support_note", {
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

async function waitingConversation(minutes: number, storeId = store.id): Promise<string> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, queued_at)
    values (${storeId}::uuid, 'site', 'queue', ${`e-${Math.random()}`}, 'en', now() - make_interval(mins => ${minutes})) returning id
  `);
  return String(c.id);
}

/** What the desk's waiting alert queues once a conversation has waited its minutes (`sendWaitingAlerts()`): `support.waiting`, into the event log. */
const deskAlert = (conversation: string, storeId = store.id) =>
  db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'support.waiting', ${conversation}::uuid)`);

beforeAll(async () => {
  store = await makeStore("autopilot-events");
  other = await makeStore("autopilot-events-other");
  for (const s of [store, other]) await db().execute(sql`update commerce.stores set status = 'active' where id = ${s.id}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on) values (${store.id}::uuid, 'people', false, false)`);
  owner = await membershipOf(store.slug, store.account, "owner");
  // The autopilot's reader starts at now the first time it reads the log (E4.2): one read before any test queues an event.
  await runEvents({ turn: fakeTurn, connection: null, alerts: async () => [] });
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
    await deskAlert(await waitingConversation(60));
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
    // The desk told its people about both (its own minutes, 5 by default); the autopilot waits for the owner's 15.
    await deskAlert(fresh);
    await deskAlert(waiting);
    await react();
    const rows = await eventsOf();
    expect(rows.map((r) => [r.kind, r.ref, r.status]).sort()).toEqual([["support_waiting", fresh, "pending"], ["support_waiting", waiting, "done"]].sort());
    expect(rows.find((r) => r.ref === waiting)).toMatchObject({ status: "done", outcome: "Handled the support_waiting.", account_id: store.account.id });
    expect(turns).toHaveLength(1);
    expect(turns[0].message).toMatch(/has waited (20|21) minutes/);
    expect(turns[0].autopilot).toMatchObject({ event: "support_waiting" });
    expect(turns[0].autopilot?.tools).toContain("add_support_note");
    expect(turns[0].autopilot?.tools).not.toContain("reply_to_support");
    const notes = await db().execute<Row>(sql`select author from commerce.support_messages where conversation_id = ${waiting}::uuid and author <> 'system'`);
    expect(notes.map((n) => n.author)).toEqual(["note"]);
    expect(fresh).not.toBe(waiting);

    // Logged again (a second time in the queue): still one event per conversation, and the fresh one still waits for its minutes.
    await deskAlert(waiting);
    await react();
    expect(await eventsOf()).toHaveLength(2);
    expect(turns).toHaveLength(1);
  });

  it("reads the desk's alert only for a store that reacts: another store's is passed by", async () => {
    await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on) values (${other.id}::uuid, 'people', false, false) on conflict do nothing`);
    const elsewhere = await waitingConversation(30, other.id);
    await deskAlert(elsewhere, other.id);
    await react();
    expect(await eventsOf(other.id)).toHaveLength(0);
    expect(turns.filter((t) => t.message.includes(elsewhere))).toHaveLength(0);
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
    // A change a visitor sees (D660): a version counts as changed by what it draws, not by its title.
    const changed = JSON.stringify({ ...(content.published as object), title: "Bigger photos (b)" }).replace('"text":"', '"text":"Bigger photos: ');
    await db().execute(sql`update commerce.pages set draft = ${changed}::jsonb, published = ${changed}::jsonb where id = ${variant}::uuid`);
    const started = await admin.startExperiment(store.account, store.id, made.id);
    if (!started.ok) throw new Error(started.problems.join(" "));
    expect(await admin.stopExperiment(null, store.id, made.id, "planned_end")).toMatchObject({ ok: true });
    const test = { id: made.id };
    await react();
    const row = (await eventsOf()).find((r) => r.kind === "test_ended");
    expect(row).toMatchObject({ ref: String(test.id), status: "done" });
    expect(turns[0].autopilot?.tools).toEqual(["list_experiments", "explain_results", "version_behaviour", "apply_winner", "get_brand"]);
    expect(turns[0].message).toContain(`"Bigger photos" (id ${String(test.id)})`);
    expect(await eventsOf(other.id)).toHaveLength(0);
  });

  it("gives a running test that has an answer the test's tools once, and lets it go once the test is decided (D670)", async () => {
    const [page] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and published is not null limit 1`);
    const made = await admin.createExperiment(store.account, store.id, { name: "Shorter hero", pageId: String(page.id), goal: "cart" });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const variant = (await admin.getExperiment(store.id, made.id))!.variants.find((v) => v.key === "b")!.pageId!;
    const [content] = await db().execute<Row>(sql`select published from commerce.pages where id = ${variant}::uuid`);
    const changed = JSON.stringify(content.published).replace('"text":"', '"text":"Shorter: ');
    await db().execute(sql`update commerce.pages set draft = ${changed}::jsonb, published = ${changed}::jsonb where id = ${variant}::uuid`);
    const started = await admin.startExperiment(store.account, store.id, made.id);
    if (!started.ok) throw new Error(started.problems.join(" "));
    expect(await admin.markAnswered(store.id, made.id)).toBe(true);
    turns.length = 0;
    await react();
    const row = (await eventsOf()).find((r) => r.kind === "test_answered");
    expect(row).toMatchObject({ ref: made.id, status: "done" });
    const turn = turns.find((t) => t.message.includes('"Shorter hero"'))!;
    expect(turn.autopilot?.tools).toEqual(["list_experiments", "explain_results", "version_behaviour", "apply_winner", "get_brand"]);
    expect(turn.message).toContain("it is still running");
    // Found again later: kept once.
    await react();
    expect((await eventsOf()).filter((r) => r.kind === "test_answered" && r.ref === made.id)).toHaveLength(1);
    await admin.stopExperiment(store.account, store.id, made.id);
    await admin.discardExperiment(store.account, store.id, made.id);
  });

  it("keeps what it changed at Do it and tell me with the event, for the page and the digest (D309 7.4)", async () => {
    await db().execute(sql`delete from commerce.support_conversations where store_id = ${store.id}::uuid`).catch(() => undefined);
    // The earlier tests' customer who had not waited long enough is gone with the rest: its event is let go, so this run takes the new one.
    await db().execute(sql`delete from commerce.autopilot_events where store_id = ${store.id}::uuid and status = 'pending'`);
    await settings({ reacts: true, waitMinutes: 15 });
    const waiting = await waitingConversation(25);
    await deskAlert(waiting);
    const tellingTurn = async (input: TurnInput) => {
      input.autopilot?.told.push("Add a note to the conversation, for the store's staff only.");
      input.emit({ type: "done", message: { id: "m", role: "assistant", content: "Noted it.", tools: [], feedback: null, createdAt: "" } });
    };
    await runEvents({ turn: tellingTurn, connection: null, alerts: async () => [] });
    const row = (await eventsOf()).find((r) => r.ref === waiting);
    expect(row).toMatchObject({ status: "done", facts: { kind: "support_waiting", told: ["Add a note to the conversation, for the store's staff only."] } });
    const shown = (await latestEvents(store.id)).find((e) => e.id === row?.id);
    expect(shown?.told).toEqual(["Add a note to the conversation, for the store's staff only."]);
    // An event that told of nothing keeps no list, and reads as none.
    expect((await latestEvents(store.id)).filter((e) => e.id !== row?.id).every((e) => e.told.length === 0)).toBe(true);
  });
});
