import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { makePlan } = await import("./autopilot-plans");
const { saveChallenge } = await import("./autopilot-settings");
const { challengeStores, storeIdBySlug } = await import("./challenge-console");
const { ensureDesk } = await import("./support");
const { systemDesk } = await import("./support-desk");
const { handOver } = await import("./support-route");
type Membership = import("./auth").Membership;

type Row = Record<string, unknown>;

/**
 * The challenge console (`docs/100-day-challenge.md` H2) on real stores: a running challenge with a kept call and an escalated customer waiting,
 * read with its day, queues, AI budget and ratios; one that starts later, with no ratios yet and listed after.
 */

let running: Awaited<ReturnType<typeof makeStore>>;
let later: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  running = await makeStore("console-running");
  later = await makeStore("console-later");
  owner = await membershipOf(running.slug, running.account, "owner");
  const admin = { account: await makeAccount("console-admin", { platformAdmin: true }) };
  await saveChallenge(admin, running.id, { startsOn: day(-10), dayOne: day(-6), endsOn: day(93), aiMonthlyUsd: 120 });
  await saveChallenge(admin, later.id, { startsOn: day(20), dayOne: day(30), endsOn: day(129) });
  // A call the autopilot kept for a yes, three hours ago.
  const { plan } = await makePlan(
    { account: owner.account, store: owner.store, holder: { role: owner.role, kind: owner.kind, permissions: owner.permissions } },
    { title: "Kept", summary: "", steps: [{ key: "s1", title: "Look", kind: "tool", tool: "list_products", args: {}, after: [] }] },
  );
  await db().execute(sql`
    insert into commerce.assistant_approvals (store_id, account_id, conversation_id, tool, args, summary, category, created_at)
    values (${running.id}::uuid, ${owner.account.id}::uuid, ${plan.conversationId}::uuid, 'refund_order', '{}'::jsonb, 'Refund', 'public', now() - interval '3 hours')
  `);
  // A customer the AI handed to the owner (an escalation), queued two hours ago.
  const desk = systemDesk(running.id);
  await ensureDesk(desk);
  await db().execute(sql`update commerce.support_settings set mode = 'ai_first' where store_id = ${running.id}::uuid`);
  const [made] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${running.id}::uuid, 'site', 'ai', ${`t-console-${Date.now()}`}, 'nb-NO') returning id
  `);
  await handOver(desk, String(made.id), "ai", "ai", "Wants a person.", "asked_for_person");
  await db().execute(sql`update commerce.support_conversations set queued_at = now() - interval '2 hours' where id = ${String(made.id)}::uuid`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${running.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id in (${running.id}::uuid, ${later.id}::uuid)`);
  await closeDb();
});

describe("the challenge console (H2)", () => {
  it("reads a running challenge's day, queues, AI budget and ratios", async () => {
    const stores = await challengeStores();
    const s = stores.find((x) => x.storeId === running.id);
    expect(s).toMatchObject({ phase: "on", day: 7, paused: false, ai: { budgetUsd: 120 } });
    expect(s?.queues.decisions).toMatchObject({ count: 1, oldestAt: expect.any(String) });
    expect(s?.queues.escalations).toMatchObject({ count: 1 });
    expect(s?.queues.faults).toMatchObject({ count: 0, oldestAt: null });
    // Approving the store and setting the challenge are platform fixes (challenge mode here began before the store); the owner making a plan
    // is an intervention, listed.
    expect(s?.interventions).toEqual({ refund: 0, escalation: 0, platform: 2, other: 1 });
    expect(s?.other.map((o) => o.what)).toEqual(["ai.plan_made"]);
    // No sales yet: the ratios are read, and none is measured rather than 0.
    expect(s?.ratios).toMatchObject({ from: day(-6), to: day(0), netRevenueMinor: 0, margin: null, perKrone: null });
  });

  it("lists one that starts later after it, with no ratios yet", async () => {
    const stores = await challengeStores();
    const ids = stores.map((x) => x.storeId);
    expect(ids.indexOf(running.id)).toBeLessThan(ids.indexOf(later.id));
    expect(stores.find((x) => x.storeId === later.id)).toMatchObject({ phase: "upcoming", day: null, ratios: null });
  });

  it("finds a store by its address", async () => {
    expect(await storeIdBySlug(` ${running.slug.toUpperCase()} `)).toBe(running.id);
    expect(await storeIdBySlug("no-such-store-here")).toBeNull();
  });
});
