import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { makePlan, answerQuestion } = await import("./autopilot-plans");
const { runAutopilot } = await import("./autopilot-runner");
const { aiBudgetProblem, autonomyFor, autopilotCostThisMonth, saveAutonomy } = await import("./autopilot-settings");
const { recordUsage } = await import("./ai-usage");
const { actingAs } = await import("./actor");
const assistant = await import("./owner-assistant");
type Membership = import("./auth").Membership;
type TurnInput = import("./owner-assistant").TurnInput;

type Row = Record<string, unknown>;

/**
 * The autopilot's loop (D309, `docs/ai-autopilot.md` 7.3, 7.4): a plan run to the end, one step a run, in its maker's name; a gated call
 * kept for the owner's yes under its step and settling it when answered, or run at once at *Just do it*; a task's turn limited to its tools
 * with the earlier steps and answers given; three failed tries become a question; a plan whose maker left the store pauses.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
const turns: TurnInput[] = [];

const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });
const stepOf = async (plan: string, key: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plan_steps where plan_id = ${plan}::uuid and key = ${key}`))[0];
const planOf = async (plan: string) => (await db().execute<Row>(sql`select * from commerce.assistant_plans where id = ${plan}::uuid`))[0];
const start = (plan: string) => db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${plan}::uuid`);
const due = (plan: string) => db().execute(sql`update commerce.assistant_plan_steps set not_before = null where plan_id = ${plan}::uuid and status = 'pending'`);
/** Runs the loop until the plan's steps stop moving (other stores' plans may be taken too). */
async function runUntilStill(plan: string, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    const before = JSON.stringify((await db().execute<Row>(sql`select key, status from commerce.assistant_plan_steps where plan_id = ${plan}::uuid order by key`)));
    await runAutopilot({ turn: fakeTurn, connection: null });
    const after = JSON.stringify((await db().execute<Row>(sql`select key, status from commerce.assistant_plan_steps where plan_id = ${plan}::uuid order by key`)));
    if (before === after) return;
  }
}

let failTurns = false;
const fakeTurn = async (input: TurnInput) => {
  turns.push(input);
  if (failTurns) {
    input.emit({ type: "error", message: "The AI did not answer: busy" });
    return;
  }
  input.emit({ type: "done", message: { id: "m", role: "assistant", content: "I looked at the products: there are some.", tools: [{ name: "list_products", ok: true }], feedback: null, createdAt: "" } });
};

beforeAll(async () => {
  store = await makeStore("autopilot-loop");
  owner = await membershipOf(store.slug, store.account, "owner");
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.ai_usage where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.ai_model_prices where provider = 'autopilot-test'`);
  await closeDb();
});

describe("the loop", () => {
  it("runs a plan to the end: a tool step, a question answered, a task with its tools, and a gated call on the owner's yes", async () => {
    const { plan } = await makePlan(actor(owner), {
      title: "First week",
      summary: "",
      steps: [
        { key: "s1", title: "Look at the products", kind: "tool", tool: "list_products", args: {}, after: [] },
        { key: "s2", title: "Ask about the tone", kind: "question", question: "Calm or playful?", options: ["Calm", "Playful"], after: ["s1"] },
        { key: "s3", title: "Check the catalogue", kind: "task", brief: "See what the store sells.", tools: ["list_products"], after: ["s2"] },
        { key: "s4", title: "Make a welcome code", kind: "tool", tool: "create_discount", args: { code: "AUTOWELCOME", percent: 10 }, after: ["s3"] },
      ],
    });
    await start(plan.id);
    await runUntilStill(plan.id);
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "done" });
    expect(await stepOf(plan.id, "s2")).toMatchObject({ status: "asking", question: { text: "Calm or playful?", options: ["Calm", "Playful"] } });

    await answerQuestion(actor(owner), { plan: plan.id, step: "s2", answer: "Calm" });
    await runUntilStill(plan.id);
    // The task's turn: the plan's own conversation, its tools only, nobody there, the owner's answer given.
    const turn = turns.at(-1)!;
    expect(turn).toMatchObject({ conversationId: plan.conversationId, scheduled: true, autopilot: { tools: ["list_products"] } });
    expect(turn.message).toContain("Brief: See what the store sells.");
    expect(turn.message).toContain('the owner answered "Calm"');
    expect(await stepOf(plan.id, "s3")).toMatchObject({ status: "done", result: { done: "I looked at the products: there are some." } });

    // Asking first is the default: the code is kept for the owner's yes under its step.
    const s4 = await stepOf(plan.id, "s4");
    expect(s4.status).toBe("waiting");
    const [kept] = await db().execute<Row>(sql`select id, summary from commerce.assistant_approvals where plan_step_id = ${String(s4.id)}::uuid`);
    expect(String(kept.summary)).toContain("AUTOWELCOME");
    expect(await assistant.decideApproval(owner, String(kept.id), true, () => {})).toMatchObject({ status: "done" });
    expect(await stepOf(plan.id, "s4")).toMatchObject({ status: "done" });
    expect(await planOf(plan.id)).toMatchObject({ status: "done" });
    const [code] = await db().execute<Row>(sql`select code from commerce.discount_codes where store_id = ${store.id}::uuid and code = 'AUTOWELCOME'`);
    expect(code).toBeDefined();
  });

  it("makes the change itself at Just do it, within the budget, and the audit log says the autopilot did", async () => {
    await saveAutonomy(actor(owner), { levels: { marketing: "auto" }, budgets: { discountPercent: 20 } });
    const { plan } = await makePlan(actor(owner), {
      title: "Offers",
      summary: "",
      steps: [
        { key: "s1", title: "Small code", kind: "tool", tool: "create_discount", args: { code: "AUTOSMALL", percent: 15 }, after: [] },
        { key: "s2", title: "Deep code", kind: "tool", tool: "create_discount", args: { code: "AUTODEEP", percent: 40 }, after: ["s1"] },
      ],
    });
    await start(plan.id);
    await runUntilStill(plan.id);
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "done" });
    // Deeper than the owner's limit: kept for their yes.
    expect(await stepOf(plan.id, "s2")).toMatchObject({ status: "waiting" });
    const codes = await db().execute<Row>(sql`select code from commerce.discount_codes where store_id = ${store.id}::uuid and code like 'AUTO%' order by code`);
    expect(codes.map((c) => c.code)).toEqual(expect.arrayContaining(["AUTOSMALL"]));
    expect(codes.map((c) => c.code)).not.toContain("AUTODEEP");
    const audits = await db().execute<Row>(sql`select acted_by from commerce.audit_log where store_id = ${store.id}::uuid and acted_by = 'autopilot'`);
    expect(audits.length).toBeGreaterThan(0);
    await db().execute(sql`update commerce.assistant_plans set status = 'stopped' where id = ${plan.id}::uuid`);
  });

  it("turns a step that fails three times into a question, and tries again on the owner's word", async () => {
    const { plan } = await makePlan(actor(owner), {
      title: "Flaky",
      summary: "",
      steps: [{ key: "s1", title: "Busy model", kind: "task", brief: "Look.", tools: ["list_products"], after: [] }],
    });
    await start(plan.id);
    failTurns = true;
    for (let i = 0; i < 3; i++) {
      await due(plan.id);
      await runAutopilot({ turn: fakeTurn, connection: null });
    }
    failTurns = false;
    const asking = await stepOf(plan.id, "s1");
    expect(asking).toMatchObject({ status: "asking", tries: 3, question: { retry: true, options: ["Try again", "Skip this step", "Stop the plan"] } });
    expect(String((asking.question as { text: string }).text)).toContain("busy");
    await answerQuestion(actor(owner), { plan: plan.id, step: "s1", answer: "Try again" });
    await runUntilStill(plan.id);
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "done" });
  });

  it("pauses a plan whose maker no longer works in the store", async () => {
    const helper = await makeAccount("autopilot-leaver");
    await addMember(store.id, helper.id, "admin");
    const member = await membershipOf(store.slug, helper, "admin");
    const { plan } = await makePlan(actor(member), { title: "Theirs", summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] });
    await start(plan.id);
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${helper.id}::uuid`);
    await runUntilStill(plan.id, 3);
    expect(await planOf(plan.id)).toMatchObject({ status: "paused", pause_reason: expect.stringContaining("can no longer use") });
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "pending" });
  });

  it("counts every model call the autopilot made against its budget, whatever the feature, and stops on a call no price covers", async () => {
    await db().execute(sql`
      insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, per_image, effective_from)
      values ('autopilot-test', 'priced', 1000, 1000, 0.5, now() - interval '1 day')
    `);
    const call = (model: string, amounts: Record<string, number>) =>
      recordUsage({ storeId: store.id, feature: "page_pictures", accountId: owner.account.id }, { source: "platform", provider: "autopilot-test", model, kind: "image", amounts });
    // A person's picture is not the autopilot's; a picture an autopilot step asked for is, under its own feature.
    await call("priced", { images: 4 });
    await actingAs("autopilot", () => call("priced", { images: 1 }));
    expect(await autopilotCostThisMonth(store.id)).toEqual({ micros: 500_000, unpriced: 0 });
    await saveAutonomy(actor(owner), { budgets: { aiMonthlyUsd: 1 } });
    expect(await aiBudgetProblem(store.id, await autonomyFor(store.id))).toBeNull();
    await actingAs("autopilot", () => call("priced", { images: 1 }));
    expect(await aiBudgetProblem(store.id, await autonomyFor(store.id))).toContain("spent");

    // A call no price covers cannot be added up, so the budget cannot be kept: a task step pauses its plan and says why.
    await saveAutonomy(actor(owner), { budgets: { aiMonthlyUsd: 100 } });
    await actingAs("autopilot", () => call("unpriced-model", { inputTokens: 10 }));
    expect((await autopilotCostThisMonth(store.id)).unpriced).toBe(1);
    const { plan } = await makePlan(actor(owner), { title: "Costly", summary: "", steps: [{ key: "s1", title: "Look", kind: "task", brief: "Look.", tools: ["list_products"], after: [] }] });
    await start(plan.id);
    await runUntilStill(plan.id, 3);
    expect(await planOf(plan.id)).toMatchObject({ status: "paused", pause_reason: expect.stringContaining("no price covers") });
    // With no AI budget of its own, nothing stops it.
    await saveAutonomy(actor(owner), { budgets: { aiMonthlyUsd: null } });
    expect(await aiBudgetProblem(store.id, await autonomyFor(store.id))).toBeNull();
    await db().execute(sql`update commerce.assistant_plans set status = 'stopped' where id = ${plan.id}::uuid`);
    await db().execute(sql`delete from commerce.ai_usage where store_id = ${store.id}::uuid`);
  });

  it("runs nothing while the owner has paused the autopilot", async () => {
    await saveAutonomy(actor(owner), { paused: true });
    const { plan } = await makePlan(actor(owner), { title: "Held", summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] });
    await start(plan.id);
    await runAutopilot({ turn: fakeTurn, connection: null });
    expect(await stepOf(plan.id, "s1")).toMatchObject({ status: "pending" });
    await saveAutonomy(actor(owner), { paused: false });
  });
});
