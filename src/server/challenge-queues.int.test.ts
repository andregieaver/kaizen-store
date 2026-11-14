import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { makePlan } = await import("./autopilot-plans");
const { saveChallenge } = await import("./autopilot-settings");
const { autopilotOverview } = await import("./autopilot-overview");
const { decideApproval } = await import("./owner-assistant");
const { findChallengeStalls } = await import("./challenge-watch");
const { interventionsOf } = await import("./interventions");
const { ensureDesk } = await import("./support");
const { systemDesk } = await import("./support-desk");
const { handOver } = await import("./support-route");
type Membership = import("./auth").Membership;

type Row = Record<string, unknown>;

/**
 * The challenge's people (`docs/100-day-challenge.md` A3, A5, A6): the store's owner sees and decides what the autopilot kept in anyone's
 * name, the stall watch finds what holds a challenge store up, and the intervention log classes what people did.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
let helper: Membership;
const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A call kept for a yes in a plan's own (autopilot) conversation, in `who`'s name. */
async function keptCall(who: Membership, tool: string, ageHours = 0) {
  const { plan } = await makePlan(actor(who), { title: `Kept ${tool}`, summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] });
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_approvals (store_id, account_id, conversation_id, tool, args, summary, category, created_at)
    values (${store.id}::uuid, ${who.account.id}::uuid, ${plan.conversationId}::uuid, ${tool}, ${JSON.stringify({ code: "KEPT", percent: 5 })}::jsonb,
      ${`Do ${tool}`}, 'public', now() - make_interval(hours => ${ageHours}))
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  store = await makeStore("challenge-queues");
  owner = await membershipOf(store.slug, store.account, "owner");
  const account = await makeAccount("challenge-helper");
  await addMember(store.id, account.id, "admin");
  helper = await membershipOf(store.slug, account, "admin");
  await saveChallenge({ account: await makeAccount("queues-admin", { platformAdmin: true }) }, store.id, { startsOn: day(-1), dayOne: day(0), endsOn: day(99) });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the refund queue (A3)", () => {
  it("shows the owner what the autopilot kept in anyone's name, and lets them decide it", async () => {
    const id = await keptCall(helper, "create_discount");
    const overview = await autopilotOverview(actor(owner));
    expect(overview.calls.map((c) => c.id)).toContain(id);
    // Someone who is not an owner sees only their own.
    expect((await autopilotOverview({ ...actor(helper), holder: { role: "admin" as const, kind: "staff" as const, permissions: ["marketing:write"] } })).calls.map((c) => c.id)).toContain(id);
    const decided = await decideApproval(owner, id, false, () => {});
    expect(decided).toMatchObject({ status: "declined" });
  });

  it("never lets anyone but the owner decide another person's call", async () => {
    const id = await keptCall(owner, "create_discount");
    expect(await decideApproval(helper, id, false, () => {})).toBeNull();
  });
});

describe("the stall watch (A6)", () => {
  it("finds a refund waiting more than a day and a fault in support", async () => {
    await keptCall(owner, "refund_order", 30);
    // A customer the AI could not answer (it was off): the desk hands them to a person, a fault and no escalation.
    const desk = systemDesk(store.id);
    await ensureDesk(desk);
    await db().execute(sql`update commerce.support_settings set mode = 'ai_first' where store_id = ${store.id}::uuid`);
    const [made] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${store.id}::uuid, 'site', 'ai', ${`t-cq-${Date.now()}`}, 'nb-NO') returning id
    `);
    await handOver(desk, String(made.id), "system", "no_ai");
    await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '20 minutes' where id = ${String(made.id)}::uuid`);
    const stalls = (await findChallengeStalls()).filter((s) => s.storeId === store.id);
    expect(stalls.map((s) => s.kind)).toEqual(expect.arrayContaining(["decision_waiting", "support_fault"]));
    expect(stalls.find((s) => s.kind === "decision_waiting")).toMatchObject({ count: 1 });
  });
});

describe("the intervention log (A5)", () => {
  it("counts decided calls by class and lists every one the challenge does not allow", async () => {
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 60_000);
    const { counts, other } = await interventionsOf(store.id, from, to);
    // The declined discount above is a decision the challenge does not allow.
    expect(counts.other).toBeGreaterThanOrEqual(1);
    expect(other.some((o) => o.what === "decided create_discount")).toBe(true);
  });
});
