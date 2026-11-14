import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { makePlan } = await import("./autopilot-plans");
const { runAutopilot, resumeAfterBudget } = await import("./autopilot-runner");
const { autonomyFor, endChallenge, saveAutonomy, saveChallenge } = await import("./autopilot-settings");
const { autopilotDecision } = await import("./autopilot-gate");
type Membership = import("./auth").Membership;
type TurnInput = import("./owner-assistant").TurnInput;

type Row = Record<string, unknown>;

/**
 * Challenge mode (`docs/100-day-challenge.md` 4A1, 4A2, F2): set by a platform admin only; while it is on, the preset is in force and the
 * owner's settings are locked but for the pause, which is audited as an intervention; a step that fails three times and a question are
 * skipped rather than asked; broadcasts run within the week's budget; plans paused by the AI budget start again once it allows; the
 * autopilot's conversations are its own.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
let admin: Awaited<ReturnType<typeof makeAccount>>;

const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const challenge = () => ({ startsOn: day(-1), dayOne: day(0), endsOn: day(99), broadcastsPerWeek: 1 });
const stepOf = async (plan: string, key: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plan_steps where plan_id = ${plan}::uuid and key = ${key}`))[0];
const planOf = async (plan: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plans where id = ${plan}::uuid`))[0];
const start = (plan: string) => db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${plan}::uuid`);
const due = (plan: string) => db().execute(sql`update commerce.assistant_plan_steps set not_before = null where plan_id = ${plan}::uuid and status = 'pending'`);
const failingTurn = async (input: TurnInput) => input.emit({ type: "error", message: "The AI did not answer: busy" });

beforeAll(async () => {
  store = await makeStore("autopilot-challenge");
  owner = await membershipOf(store.slug, store.account, "owner");
  admin = await makeAccount("challenge-admin", { platformAdmin: true });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("challenge mode", () => {
  it("is set by a platform admin only, and puts the preset in force", async () => {
    await expect(saveChallenge({ account: owner.account }, store.id, challenge())).rejects.toThrow("platform admin");
    await expect(saveChallenge({ account: admin }, store.id, { ...challenge(), endsOn: day(-5) })).rejects.toThrow("ends after Day 1");
    await saveAutonomy(actor(owner), { levels: { catalogue: "ask" } });
    await saveChallenge({ account: admin }, store.id, challenge());
    const on = await autonomyFor(store.id);
    expect(on.levels).toMatchObject({ catalogue: "auto", website: "auto", money: "auto", design: "tell" });
    expect(on.planning).toMatchObject({ continues: true, starts: "auto", reacts: true });
    expect(on.challenge).toMatchObject({ active: true, day: 1, broadcastsPerWeek: 1 });
  });

  it("locks the owner's settings but for the pause, which is an intervention", async () => {
    await expect(saveAutonomy(actor(owner), { levels: { catalogue: "ask" } })).rejects.toThrow("locked for the challenge");
    const paused = await saveAutonomy(actor(owner), { paused: true });
    expect(paused).toMatchObject({ paused: true, levels: { catalogue: "auto" } });
    const [entry] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'ai.challenge_paused' order by created_at desc limit 1
    `);
    expect(entry.details).toMatchObject({ paused: true, intervention: true });
    await saveAutonomy(actor(owner), { paused: false });
    expect((await autonomyFor(store.id)).paused).toBe(false);
  });

  it("skips a step that fails three times and a question, so nobody is asked", async () => {
    const { plan } = await makePlan(actor(owner), {
      title: "Alone",
      summary: "",
      steps: [
        { key: "s1", title: "Busy model", kind: "task", brief: "Look.", tools: ["list_products"], after: [] },
        { key: "s2", title: "Ask the tone", kind: "question", question: "Calm or playful?", options: ["Calm", "Playful"], after: [] },
      ],
    });
    await start(plan.id);
    for (let i = 0; i < 6; i++) {
      await due(plan.id);
      await runAutopilot({ turn: failingTurn, connection: null });
    }
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "skipped", result: { problem: expect.stringContaining("skipped for the challenge") } });
    expect(await stepOf(plan.id, "s2")).toMatchObject({ status: "skipped", question: null });
    expect(await planOf(plan.id)).toMatchObject({ status: "done" });
  });

  it("sends a broadcast itself within the week's budget, and keeps the next for a yes", async () => {
    const p = { account: owner.account, store: owner.store };
    expect(await autopilotDecision(p, await autonomyFor(store.id), "send_broadcast", "send", {})).toMatchObject({ run: true, area: "marketing" });
    await db().execute(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, acted_by)
      values (${store.id}::uuid, ${owner.account.id}::uuid, 'store.assistant.send_broadcast', '{}'::jsonb, 'autopilot')
    `);
    expect(await autopilotDecision(p, await autonomyFor(store.id), "send_broadcast", "send", {})).toMatchObject({ run: false });
  });

  it("gives the autopilot's plans conversations of their own", async () => {
    const { plan } = await makePlan(actor(owner), { title: "Own room", summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] });
    const [conversation] = await db().execute<Row>(sql`select source from commerce.assistant_conversations where id = ${plan.conversationId}::uuid`);
    expect(conversation.source).toBe("autopilot");
  });

  it("gives the owner's own settings back when the challenge ends", async () => {
    await endChallenge({ account: admin }, store.id);
    const own = await autonomyFor(store.id);
    expect(own.challenge).toBeNull();
    expect(own.levels).toMatchObject({ catalogue: "ask" });
    await saveAutonomy(actor(owner), { levels: { catalogue: "tell" } });
    expect((await autonomyFor(store.id)).levels).toMatchObject({ catalogue: "tell" });
  });
});

describe("a plan the AI budget paused", () => {
  it("starts again by itself once the budget allows, and never one a person paused", async () => {
    // A budget of nothing is spent from the start.
    await saveAutonomy(actor(owner), { budgets: { aiMonthlyUsd: 0 } });
    const { plan } = await makePlan(actor(owner), { title: "Thrifty", summary: "", steps: [{ key: "s1", title: "Look", kind: "task", brief: "Look.", tools: ["list_products"], after: [] }] });
    const { plan: held } = await makePlan(actor(owner), { title: "Held by a person", summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] });
    await start(plan.id);
    await start(held.id);
    await db().execute(sql`update commerce.assistant_plans set status = 'paused', pause_reason = 'Paused by Kari.' where id = ${held.id}::uuid`);
    await runAutopilot({ turn: failingTurn, connection: null });
    expect(await planOf(plan.id)).toMatchObject({ status: "paused", paused_for: "budget" });

    // Still spent: nothing starts.
    expect(await resumeAfterBudget()).toBe(0);
    await saveAutonomy(actor(owner), { budgets: { aiMonthlyUsd: null } });
    expect(await resumeAfterBudget()).toBeGreaterThanOrEqual(1);
    expect(await planOf(plan.id)).toMatchObject({ status: "running", paused_for: null, pause_reason: null });
    expect(await planOf(held.id)).toMatchObject({ status: "paused", pause_reason: "Paused by Kari." });
  });
});
