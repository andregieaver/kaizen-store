import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { runManagerTool } = await import("./manager-tools");
const assistant = await import("./owner-assistant");
const { actingAs } = await import("./actor");
const { audit } = await import("./auth");
const pageActions = await import("./autopilot-actions");
const { autonomyFor } = await import("./autopilot-settings");
type Membership = import("./auth").Membership;

type Row = Record<string, unknown>;

/**
 * The autopilot's goals and plans (D309, `docs/ai-autopilot.md` 7.1, 7.2) through the AI manager's own tools: a goal measured from the
 * store's own figures, a plan checked and kept as a draft with its own conversation, started only on the person's yes for the version
 * they saw, revised, paused, answered and stopped; another store's plan never reached; the audit log saying who acted.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
let staff: Membership;
let conversation: string;

const ctx = (m: Membership, extra: Record<string, unknown> = {}) => ({
  account: m.account,
  store: m.store,
  holder: { role: m.role, kind: m.kind, permissions: m.permissions },
  flags: {},
  connection: null,
  navigate: () => {},
  invalidate: () => {},
  turn: { conversationId: conversation, said: "Blue", startedAt: new Date(), decide: async () => null },
  ...extra,
});
const tool = (m: Membership, name: string, args: unknown, extra: Record<string, unknown> = {}) => runManagerTool(ctx(m, extra) as never, name, args) as Promise<Record<string, unknown>>;

const PLAN = {
  title: "Get the store ready",
  summary: "Pages and a first product.",
  steps: [
    { key: "s1", title: "Ask about the colours", kind: "question", question: "Which colour should the shop use?", options: ["Blue", "Green"] },
    { key: "s2", title: "Look at the products", kind: "tool", tool: "list_products", args: {}, after: ["s1"] },
  ],
};

const planRow = async (id: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plans where id = ${id}::uuid`))[0];
const stepRow = async (plan: string, key: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plan_steps where plan_id = ${plan}::uuid and key = ${key}`))[0];

beforeAll(async () => {
  store = await makeStore("autopilot");
  other = await makeStore("autopilot-other");
  owner = await membershipOf(store.slug, store.account, "owner");
  const helper = await makeAccount("autopilot-staff");
  await addMember(store.id, helper.id, "admin");
  staff = await membershipOf(store.slug, helper, "admin");
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.id}::uuid, ${store.account.id}::uuid, 'Plans') returning id
  `);
  conversation = String(row.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_plans where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.assistant_goals where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await closeDb();
});

describe("goals", () => {
  it("are the owner's, measured from the store's own figures", async () => {
    const set = (await tool(owner, "set_goal", {
      title: "First sales",
      vision: "A calm shop people come back to.",
      targets: [{ kind: "orders_30d", count: 10 }, { kind: "pages", count: 1 }, { kind: "conversion_30d", percent: 2 }],
    })) as { goal: { id: string; progress: { target: string; now: string; met: boolean | null }[] } };
    expect(set.goal.progress).toHaveLength(3);
    expect(set.goal.progress[0]).toMatchObject({ target: "10 orders in 30 days", now: "0", met: false });
    expect(set.goal.progress[2]).toMatchObject({ now: "not measured", met: null });
    await expect(tool(staff, "set_goal", { title: "Mine", targets: [] })).rejects.toThrow(/Goals are the owner's/);
    await expect(tool(owner, "set_goal", { title: "Bad", targets: [{ kind: "stores", count: 3 }] })).rejects.toThrow(/cannot measure stores/);
    const listed = (await tool(staff, "list_goals", {})) as { goals: { id: string }[] };
    expect(listed.goals.map((g) => g.id)).toContain(set.goal.id);
    expect(await tool(owner, "drop_goal", { goal: set.goal.id })).toEqual({ done: "The goal is dropped." });
    expect(((await tool(owner, "list_goals", {})) as { goals: unknown[] }).goals).toHaveLength(0);
  });
});

describe("plans", () => {
  let planId: string;

  it("are checked step by step and kept as a draft with a conversation of their own", async () => {
    await expect(tool(owner, "make_autopilot_plan", { ...PLAN, steps: [{ key: "s1", title: "Refund", kind: "tool", tool: "no_such_tool", args: {} }] })).rejects.toThrow(
      /no tool no_such_tool/,
    );
    const made = (await tool(owner, "make_autopilot_plan", PLAN)) as { plan: { id: string; status: string; steps: unknown[] }; note: string };
    planId = made.plan.id;
    expect(made.plan).toMatchObject({ status: "draft", steps: [{ key: "s1", status: "pending" }, { key: "s2", after: ["s1"] }] });
    expect(made.note).toMatch(/start_autopilot_plan/);
    const row = await planRow(planId);
    expect(row).toMatchObject({ account_id: owner.account.id, store_id: store.id, version: 1 });
    expect(row.conversation_id).not.toBe(conversation);
    const [chat] = await db().execute<Row>(sql`select title from commerce.assistant_conversations where id = ${String(row.conversation_id)}::uuid`);
    expect(chat.title).toBe("Autopilot: Get the store ready");
  });

  it("start only on the person's yes, for the version they saw", async () => {
    // Kept for a yes, described from the plan; the model's own version is never kept.
    const kept = await assistant.keepForApproval({ account: owner.account, store: owner.store, invalidate: () => {} }, conversation, "start_autopilot_plan", "plan", {
      plan: planId,
      approved_version: 99,
    });
    expect(kept.summary).toContain('Start the plan "Get the store ready" with 2 steps to go');
    const [approval] = await db().execute<Row>(sql`select args from commerce.assistant_approvals where id = ${kept.id}::uuid`);
    expect(approval.args).toMatchObject({ plan: planId, approved_version: 1 });
    // Someone else's yes is not theirs to give.
    expect(await assistant.decideApproval(staff, kept.id, true, () => {})).toBeNull();
    expect(await assistant.decideApproval(owner, kept.id, true, () => {})).toMatchObject({ status: "done", outcome: expect.stringContaining("is running") });
    expect((await planRow(planId)).status).toBe("running");
  });

  it("refuse a yes given to a version that changed since", async () => {
    await tool(owner, "pause_autopilot_plan", { plan: planId });
    const kept = await assistant.keepForApproval({ account: owner.account, store: owner.store, invalidate: () => {} }, conversation, "resume_autopilot_plan", "plan", { plan: planId });
    await tool(owner, "revise_autopilot_plan", { plan: planId, steps: PLAN.steps });
    expect(await planRow(planId)).toMatchObject({ status: "draft", version: 2 });
    expect(await assistant.decideApproval(owner, kept.id, true, () => {})).toMatchObject({ status: "failed", outcome: expect.stringContaining("changed after you saw it") });
  });

  it("are answered only by a person in the conversation, with one of the question's options", async () => {
    await db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${planId}::uuid`);
    await db().execute(sql`
      update commerce.assistant_plan_steps set status = 'asking', question = ${JSON.stringify({ text: "Which colour should the shop use?", options: ["Blue", "Green"] })}::jsonb
      where plan_id = ${planId}::uuid and key = 's1'
    `);
    await expect(tool(owner, "answer_autopilot_question", { plan: planId, step: "s1", answer: "Blue" }, { scheduled: true })).rejects.toThrow(/not here/);
    await expect(tool(owner, "answer_autopilot_question", { plan: planId, step: "s1", answer: "Red" })).rejects.toThrow(/one of: Blue, Green/);
    expect(await tool(owner, "answer_autopilot_question", { plan: planId, step: "s1", answer: "blue" })).toEqual({ done: 'Noted: "Blue". The plan carries on with it.' });
    expect(await stepRow(planId, "s1")).toMatchObject({ status: "done", answer: "Blue", answered_by: owner.account.id });
  });

  it("are never reached from another store, and stop for good", async () => {
    const otherOwner = await membershipOf(other.slug, other.account, "owner");
    await expect(tool(otherOwner, "get_autopilot_plan", { plan: planId })).rejects.toThrow(/no such plan/);
    await expect(tool(otherOwner, "stop_autopilot_plan", { plan: planId })).rejects.toThrow(/no such plan/);
    expect(await tool(owner, "stop_autopilot_plan", { plan: planId })).toMatchObject({ done: expect.stringContaining("is stopped") });
    expect(await stepRow(planId, "s2")).toMatchObject({ status: "cancelled" });
    await expect(tool(owner, "stop_autopilot_plan", { plan: planId })).rejects.toThrow(/already stopped/);
  });
});

describe("the activity log", () => {
  it("says the AI manager or the autopilot acted when they did, and a person otherwise", async () => {
    await audit(owner.account.id, store.id, "ai.goal_set", { probe: "person" });
    await actingAs("ai_manager", () => audit(owner.account.id, store.id, "ai.goal_set", { probe: "manager" }));
    await actingAs("autopilot", () => audit(owner.account.id, store.id, "ai.goal_set", { probe: "autopilot" }));
    const rows = await db().execute<Row>(sql`
      select details ->> 'probe' as probe, acted_by from commerce.audit_log where store_id = ${store.id}::uuid and details ? 'probe' order by id
    `);
    expect(rows.map((r) => [r.probe, r.acted_by])).toEqual([
      ["person", "person"],
      ["manager", "ai_manager"],
      ["autopilot", "autopilot"],
    ]);
    // The plan tools ran inside the turn's tool calls only in a real turn; here they were called directly, so a person made them.
    const [made] = await db().execute<Row>(sql`select acted_by from commerce.audit_log where store_id = ${store.id}::uuid and action = 'ai.plan_made' order by id desc limit 1`);
    expect(made.acted_by).toBe("person");
  });
});

describe("the Autopilot page's buttons", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("start a plan only for the version the page showed, and save the settings as the form says", async () => {
    const made = (await tool(owner, "make_autopilot_plan", { ...PLAN, title: "From the page" })) as { plan: { id: string } };
    expect(await pageActions.changePlan(owner, form({ plan: made.plan.id, do: "start", version: "7" }))).toMatchObject({ status: "error", messages: [expect.stringContaining("changed after you saw it")] });
    expect(await pageActions.changePlan(owner, form({ plan: made.plan.id, do: "start", version: "1" }))).toEqual({ status: "ok", messages: [] });
    expect((await planRow(made.plan.id)).status).toBe("running");
    expect(await pageActions.changePlan(owner, form({ plan: made.plan.id, do: "stop" }))).toEqual({ status: "ok", messages: [] });

    const saved = await pageActions.saveSettings(owner, form({ running: "on", level_website: "tell", level_money: "fly", ai_monthly: "", discount_percent: "15", price_change_percent: "5", customer_emails: "3" }));
    expect(saved).toEqual({ status: "ok", messages: [] });
    expect(await autonomyFor(store.id)).toEqual({
      paused: false,
      levels: { website: "tell" },
      budgets: { aiMonthlyUsd: null, discountPercent: 15, priceChangePercent: 5, customerEmailsPerWeek: 3 },
      planning: { continues: false, starts: "ask", reviewDays: 7, plansPerWeek: 3, reacts: false, waitMinutes: 15 },
    });
    // Keeping going (D328): the switch and its choices; an unknown start choice is read as asking first.
    await pageActions.saveSettings(owner, form({ running: "on", keep_going: "on", plan_starts: "auto", review_days: "3", plans_per_week: "2", discount_percent: "15", price_change_percent: "5" }));
    expect((await autonomyFor(store.id)).planning).toEqual({ continues: true, starts: "auto", reviewDays: 3, plansPerWeek: 2, reacts: false, waitMinutes: 15 });
    await pageActions.saveSettings(owner, form({ running: "on", keep_going: "on", plan_starts: "always", discount_percent: "15", price_change_percent: "5" }));
    expect((await autonomyFor(store.id)).planning).toEqual({ continues: true, starts: "ask", reviewDays: 7, plansPerWeek: 3, reacts: false, waitMinutes: 15 });
    // Reacting to events (D331): the switch and the minutes a customer waits.
    await pageActions.saveSettings(owner, form({ running: "on", reacts: "on", wait_minutes: "30", discount_percent: "15", price_change_percent: "5" }));
    expect((await autonomyFor(store.id)).planning).toMatchObject({ reacts: true, waitMinutes: 30 });
    expect(await pageActions.saveSettings(staff, form({ running: "on" }))).toMatchObject({ status: "error", messages: ["Only an owner sets how far the autopilot may go."] });
  });
});
