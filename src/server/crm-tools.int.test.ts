import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const tools = await import("./crm-tools");
const deals = await import("./deals");
const staff = await import("./customer-staff");
const { newStore } = await import("./inventory-test-support");

type TestStore = Awaited<ReturnType<typeof newStore>>;

/**
 * The AI manager's CRM tools (ecosystem plan E2.5, D713): deals read and moved, a lead made a deal, an activity planned and today's list,
 * and a customer's timeline, through the pages' own functions; what people typed never in an answer.
 */

let store: TestStore;
let ctx: { account: TestStore["member"]["account"]; store: TestStore["member"]["store"] };
const run = Date.now().toString(36);

beforeAll(async () => {
  store = await newStore("crm-tools");
  await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${store.storeId}::uuid and not ('sales' = any(features))`);
  ctx = { account: store.member.account, store: store.member.store };
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function deal(title: string) {
  const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Proposal sent" }] });
  const customer = await staff.createCustomer(store.member, { email: `k-${Math.random().toString(36).slice(2)}@example.com`, name: "Kari Nordmann" });
  if (!customer.ok) throw new Error(JSON.stringify(customer.problem));
  const created = await deals.createDeal(store.member, { title, customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, estimate: "12000" });
  if (!created.ok) throw new Error(created.problems.join(","));
  return { id: created.id, customerId: customer.id };
}

describe("the AI manager's CRM tools", () => {
  it("list the open deals with their stage and next step, and move one by a part of its title", async () => {
    const { id } = await deal(`Kontorstoler ${run}`);
    const listed = (await tools.listDealsTool(ctx, { status: "open", limit: 25 })) as {
      deals: { id: string; stage: string | null; next_step: string | null; page: string }[];
      open_without_a_next_step: number;
      pipelines: { name: string; stages: string[] }[];
    };
    const line = listed.deals.find((d) => d.id === id)!;
    expect(line).toMatchObject({ stage: "New", next_step: "none planned", page: `/admin/${store.member.store.slug}/deals/${id}` });
    expect(listed.open_without_a_next_step).toBeGreaterThanOrEqual(1);
    expect(listed.pipelines[0].stages).toEqual(["New", "Proposal sent"]);

    const moved = (await tools.moveDealTool(ctx, { deal: `kontorstoler ${run}`, stage: "proposal sent" })) as { done: string };
    expect(moved.done).toContain("Proposal sent");
    const detail = (await tools.getDealTool(ctx, { deal: id })) as { stage: string; history: { stage: string | null }[] };
    expect(detail.stage).toBe("Proposal sent");
    expect(detail.history.map((h) => h.stage)).toContain("Proposal sent");

    await expect(tools.moveDealTool(ctx, { deal: id, stage: "Finnes ikke" })).rejects.toThrow('No stage "Finnes ikke"');
    expect(await tools.moveDealTool(ctx, { deal: id, outcome: "lost", reason: "Too expensive" })).toMatchObject({ done: expect.stringContaining("lost") });
    await expect(tools.moveDealTool(ctx, { deal: id, stage: "New" })).rejects.toThrow("already lost");
  });

  it("plans an activity on a deal, and lists it as due today", async () => {
    const { id } = await deal(`Lampeavtale ${run}`);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: store.member.store.timeZone });
    const planned = (await tools.logActivityTool(ctx, { kind: "call", title: "Ring om tilbudet", due_on: today, deal: id })) as { page: string };
    expect(planned.page).toBe(`/admin/${store.member.store.slug}/deals/${id}`);
    const todayList = (await tools.crmTodayTool(ctx, { who: "me" })) as { today: { title: string; about: string | null }[]; late: unknown[] };
    expect(todayList.today).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Ring om tilbudet", about: `Lampeavtale ${run}` })]));
    await expect(tools.logActivityTool(ctx, { kind: "task", title: "Nobody", due_on: today, customer: `nobody-${run}@example.com` })).rejects.toThrow("No customer");
  });

  it("lists a lead without what they wrote, and makes a deal of them", async () => {
    const email = `lead-${run}@example.com`;
    await db().execute(sql`
      insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, payload, path, locale)
      values (${store.storeId}::uuid, 'contact', 'message', 'v1', 'logged', ${email}, ${JSON.stringify({ name: "Ola Lead", message: `Secret words ${run}` })}::jsonb, '/contact', 'nb')
    `);
    const leads = (await tools.listLeadsTool(ctx, { limit: 20 })) as { leads: { email: string; name: string | null; asked: { kind: string }[] }[] };
    const lead = leads.leads.find((l) => l.email === email);
    expect(lead).toMatchObject({ name: "Ola Lead", asked: [{ kind: "question", times: 1 }] });
    expect(JSON.stringify(leads)).not.toContain(`Secret words ${run}`);

    const made = (await tools.makeDealFromLeadTool(ctx, { email })) as { page: string };
    expect(made.page).toMatch(new RegExp(`^/admin/${store.member.store.slug}/deals/[0-9a-f-]{36}$`));
    const after = (await tools.listLeadsTool(ctx, { limit: 20 })) as { leads: { email: string }[] };
    expect(after.leads.some((l) => l.email === email)).toBe(false);
  });

  it("reads a customer's timeline with names of the store's own things only", async () => {
    const { customerId } = await deal(`Tidslinje ${run}`);
    const timeline = (await tools.customerTimelineTool(ctx, { customer: customerId })) as { events: { kind: string; name?: string }[]; page: string };
    expect(timeline.page).toBe(`/admin/${store.member.store.slug}/customers/${customerId}`);
    expect(timeline.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: expect.stringMatching(/^deal/), name: `Tidslinje ${run}` })]));
    await expect(tools.customerTimelineTool(ctx, { customer: "not-a-customer" })).rejects.toThrow("No customer");
  });
});
