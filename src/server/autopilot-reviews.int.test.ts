import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { setGoal } = await import("./autopilot-goals");
const { runGoalReviews } = await import("./autopilot-reviews");
const { saveAutonomy } = await import("./autopilot-settings");
const { makePlanTool } = await import("./autopilot-tools");
type Membership = import("./auth").Membership;
type TurnInput = import("./owner-assistant").TurnInput;

type Row = Record<string, unknown>;

/**
 * The autopilot keeps going (D328, `docs/ai-autopilot.md` 12.5): with a stand-in turn that makes its plan through the real tool, a goal is
 * reviewed only while the owner keeps working toward goals; its plan waits for a yes or starts by itself as they chose, within the plans
 * a week; no review while the goal's plan is open, another once it ended; a turn that makes no plan, and one that fails, are said so.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
let goalId: string;
const turns: TurnInput[] = [];
let turnDoes: "plan" | "nothing" | "fail" = "plan";

const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });

const fakeTurn = async (input: TurnInput) => {
  turns.push(input);
  if (turnDoes === "fail") return input.emit({ type: "error", message: "The AI did not answer: busy" });
  if (turnDoes === "plan") {
    await makePlanTool(
      { ...actor(owner), scheduled: true, turn: { conversationId: input.conversationId ?? "" }, autopilot: input.autopilot },
      { title: `Next step ${turns.length}`, summary: "", steps: [{ key: "s1", title: "Look at the products", kind: "tool", tool: "list_products", args: {}, after: [] }] },
    );
  }
  input.emit({
    type: "done",
    message: { id: "m", role: "assistant", content: turnDoes === "plan" ? "I planned a look at the products." : "The figures need a week more.", tools: [], feedback: null, createdAt: "" },
  });
};

const review = () => runGoalReviews({ turn: fakeTurn, connection: null });
const reviewsOf = async () => db().execute<Row>(sql`select * from commerce.autopilot_reviews where goal_id = ${goalId}::uuid order by created_at`);
const plansOf = async () => db().execute<Row>(sql`select * from commerce.assistant_plans where goal_id = ${goalId}::uuid order by created_at`);
const settings = (planning: Record<string, unknown>) => saveAutonomy(actor(owner), { planning });
/** Ends the goal's open plans and moves its reviews back in time, so the next review is due because a plan ended. */
async function endPlansAndAge() {
  await db().execute(sql`update commerce.assistant_approvals set status = 'declined', decided_at = now() where status = 'pending' and store_id = ${store.id}::uuid`);
  await db().execute(sql`update commerce.assistant_plans set status = 'running' where goal_id = ${goalId}::uuid and status = 'draft'`);
  await db().execute(sql`update commerce.assistant_plans set status = 'done' where goal_id = ${goalId}::uuid and status = 'running'`);
  await db().execute(sql`update commerce.autopilot_reviews set created_at = created_at - interval '2 hours', finished_at = finished_at - interval '2 hours' where goal_id = ${goalId}::uuid`);
  await db().execute(sql`update commerce.assistant_plans set finished_at = now() where goal_id = ${goalId}::uuid`);
}

beforeAll(async () => {
  store = await makeStore("autopilot-reviews");
  owner = await membershipOf(store.slug, store.account, "owner");
  goalId = (await setGoal(actor(owner), { title: "A full catalogue", targets: [{ kind: "products", count: 5000 }] })).id;
});

beforeEach(() => {
  turns.length = 0;
  turnDoes = "plan";
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_reviews where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.assistant_goals where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("reviews of goals", () => {
  it("never run while the owner has not chosen to keep working toward goals", async () => {
    await review();
    await settings({ continues: false });
    await review();
    expect(await reviewsOf()).toHaveLength(0);
    expect(turns.filter((t) => t.member.store?.id === store.id)).toHaveLength(0);
  });

  it("make the next plan, which waits for the owner's yes at Ask, in the goal's conversation", async () => {
    await settings({ continues: true, starts: "ask" });
    await review();
    const turn = turns.find((t) => t.member.store?.id === store.id);
    expect(turn?.autopilot).toMatchObject({ review: true });
    expect(turn?.autopilot?.tools).toContain("make_autopilot_plan");
    expect(turn?.autopilot?.tools).not.toContain("create_product");
    expect(turn?.autopilot?.tools).not.toContain("start_autopilot_plan");
    expect(turn?.message).toContain(`review of the goal "A full catalogue" (id ${goalId})`);
    const [plan] = await plansOf();
    expect(plan).toMatchObject({ status: "draft", conversation_id: turn?.conversationId });
    const [row] = await reviewsOf();
    expect(row).toMatchObject({ status: "done", plan_id: plan.id, started: false, conversation_id: turn?.conversationId });
    expect(String(row.outcome)).toContain("waits for your yes");
    const [kept] = await db().execute<Row>(sql`select * from commerce.assistant_approvals where tool = 'start_autopilot_plan' and args ->> 'plan' = ${String(plan.id)}`);
    expect(kept).toMatchObject({ status: "pending", category: "plan", conversation_id: turn?.conversationId });
    expect((kept.args as { approved_version?: number }).approved_version).toBe(1);
  });

  it("wait while the goal's plan is open", async () => {
    await review();
    expect(await reviewsOf()).toHaveLength(1);
  });

  it("come again once the plan ended, and start the plan at Just start, in the same conversation", async () => {
    await settings({ continues: true, starts: "auto", plansPerWeek: 1 });
    await endPlansAndAge();
    await review();
    const rows = await reviewsOf();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: "done", started: true, conversation_id: rows[0].conversation_id });
    const plans = await plansOf();
    expect(plans[1]).toMatchObject({ status: "running", id: rows[1].plan_id });
    const [audited] = await db().execute<Row>(sql`select acted_by from commerce.audit_log where store_id = ${store.id}::uuid and action = 'ai.plan_started' order by created_at desc limit 1`);
    expect(audited).toMatchObject({ acted_by: "autopilot" });
  });

  it("keep the start for a yes past the plans a week", async () => {
    await endPlansAndAge();
    await review();
    const rows = await reviewsOf();
    expect(rows[2]).toMatchObject({ status: "done", started: false });
    expect(String(rows[2].outcome)).toContain("your limit");
    expect((await plansOf())[2]).toMatchObject({ status: "draft" });
  });

  it("say when there is nothing to do, and when the turn failed", async () => {
    await endPlansAndAge();
    turnDoes = "nothing";
    await review();
    let rows = await reviewsOf();
    expect(rows[3]).toMatchObject({ status: "done", plan_id: null, outcome: "Nothing to do now: The figures need a week more." });
    // A finished review with nothing done comes back on the schedule, not before.
    turnDoes = "fail";
    await review();
    expect(await reviewsOf()).toHaveLength(4);
    await db().execute(sql`update commerce.autopilot_reviews set finished_at = now() - interval '8 days' where goal_id = ${goalId}::uuid`);
    await review();
    rows = await reviewsOf();
    expect(rows[4]).toMatchObject({ status: "failed", outcome: "The AI did not answer: busy" });
  });
});
