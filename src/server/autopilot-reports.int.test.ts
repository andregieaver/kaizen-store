import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { makePlan } = await import("./autopilot-plans");
const { sendAutopilotReports, latestReport } = await import("./autopilot-reports");
type OutgoingEmail = import("./email").OutgoingEmail;
type Membership = import("./auth").Membership;

type Row = Record<string, unknown>;

/**
 * The autopilot's digest and weekly report (D309, `docs/ai-autopilot.md` 7.5): sent to the person whose plan ran, once per period, a digest only
 * when there is something to tell, the weekly report with the store's figures, and never to someone who left the store.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Membership;
const emails: OutgoingEmail[] = [];
const send = async (message: OutgoingEmail) => {
  emails.push(message);
  return "logged" as const;
};
const actor = (m: Membership) => ({ account: m.account, store: m.store, holder: { role: m.role, kind: m.kind, permissions: m.permissions } });

beforeAll(async () => {
  store = await makeStore("autopilot-reports");
  owner = await membershipOf(store.slug, store.account, "owner");
  const { plan } = await makePlan(actor(owner), {
    title: "Reports",
    summary: "",
    steps: [
      { key: "s1", title: "Look at the products", kind: "tool", tool: "list_products", args: {}, after: [] },
      { key: "s2", title: "Ask", kind: "question", question: "Go on?", options: [], after: ["s1"] },
    ],
  });
  await db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${plan.id}::uuid`);
  await db().execute(sql`update commerce.assistant_plan_steps set status = 'done' where plan_id = ${plan.id}::uuid and key = 's1'`);
  await db().execute(sql`update commerce.assistant_plan_steps set status = 'asking', question = '{"text": "Go on?", "options": []}' where plan_id = ${plan.id}::uuid and key = 's2'`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_reports where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.assistant_plans where store_id = ${store.id}::uuid`);
  await closeDb();
});

/** 19:00 on a Wednesday in the store's own time zone: both a digest and the week's report are due. */
async function wednesdayEvening(): Promise<Date> {
  const [row] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${store.id}::uuid`);
  const zone = String(row.time_zone);
  const [at] = await db().execute<Row>(sql`select (timestamp '2026-10-28 19:00' at time zone ${zone}) as at`);
  return new Date(String(at.at));
}

describe("the digest and the weekly report", () => {
  it("go once per period to the person whose plan ran, saying what was done and what waits", async () => {
    const now = await wednesdayEvening();
    const first = await sendAutopilotReports({ now, send, connection: null });
    const mine = emails.filter((e) => e.storeId === store.id);
    expect(first.daily).toBeGreaterThanOrEqual(1);
    expect(mine.map((e) => e.kind).sort()).toEqual(["autopilot.digest", "autopilot.weekly"]);
    expect(mine.every((e) => e.to === owner.account.email)).toBe(true);
    const digest = mine.find((e) => e.kind === "autopilot.digest")!;
    expect(digest.email.text).toContain("Look at the products");
    expect(digest.email.text).toContain("One thing waits for your yes or an answer.");
    expect(digest.email.text).toContain(`/admin/${store.slug}/assistant/autopilot`);

    await sendAutopilotReports({ now, send, connection: null });
    expect(emails.filter((e) => e.storeId === store.id)).toHaveLength(2);
    const [rows] = await db().execute<Row>(sql`select count(*)::int as n from commerce.autopilot_reports where store_id = ${store.id}::uuid and sent_at is not null`);
    expect(rows.n).toBe(2);
  });

  it("keep the weekly report for the page, with the store's figures written by code and no note without a model", async () => {
    const report = await latestReport({ account: owner.account, store: owner.store });
    expect(report).toMatchObject({ periodStart: "2026-10-26", note: null, facts: { kind: "weekly", stepsDoneCount: 1, orders: { now: 0, before: 0 } } });
    expect(report?.facts.sales?.now).toEqual(expect.any(String));
  });

  it("go to nobody who no longer works in the store", async () => {
    const helper = await makeAccount("autopilot-report-leaver");
    await addMember(store.id, helper.id, "admin");
    const member = await membershipOf(store.slug, helper, "admin");
    const { plan } = await makePlan(actor(member), {
      title: "Left behind",
      summary: "",
      steps: [{ key: "s1", title: "Count the pages", kind: "tool", tool: "list_products", args: {}, after: [] }],
    });
    await db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${plan.id}::uuid`);
    await db().execute(sql`update commerce.assistant_plan_steps set status = 'done' where plan_id = ${plan.id}::uuid`);
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${helper.id}::uuid`);
    const next = new Date((await wednesdayEvening()).getTime() + 86_400_000);
    await sendAutopilotReports({ now: next, send, connection: null });
    expect(emails.some((e) => e.to === member.account.email)).toBe(false);
    const [rows] = await db().execute<Row>(sql`select count(*)::int as n from commerce.autopilot_reports where account_id = ${helper.id}::uuid`);
    expect(rows.n).toBe(0);
  });
});
