import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const deals = await import("./deals");
const staff = await import("./customer-staff");
const { mergeCustomers } = await import("./customer-merge");
const { deleteCompany, saveCompany } = await import("./companies");
const { resolveSubject } = await import("./privacy-subject");
const { gatherExport } = await import("./privacy-export");
const { newStore, pay, place } = await import("./inventory-test-support");

type TestStore = Awaited<ReturnType<typeof newStore>>;
type Row = Record<string, unknown>;

/**
 * Deals and pipelines (S2, D464) through the server, against a real database. What is held: a store's first pipeline is made once; a deal
 * names only its own store's person, company, owner and stage; its value is its linked things' before VAT once there are any; a paid
 * order wins it through the real payment path; a person moves, wins, loses with a reason and reopens it, each kept in its history; one
 * thing belongs to one deal; a stage taken away moves its deals; a member who may not change customers changes nothing; a merge moves a
 * person's deals, a company with open ones is not deleted, and the person's export lists them.
 */

let store: TestStore;
let other: TestStore;

beforeAll(async () => {
  store = await newStore("deals");
  other = await newStore("deals-other");
});

afterAll(async () => {
  await closeDb();
});

const FIRST = { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }, { name: "Quote sent", quoteStage: true }] };

async function customer(s: TestStore, email: string): Promise<string> {
  const made = await staff.createCustomer(s.member, { email, name: "Kari Nordmann" });
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  return made.id;
}

async function firstPipeline(s: TestStore) {
  const [pipeline] = await deals.ensurePipeline(s.storeId, FIRST);
  return pipeline;
}

async function newDeal(s: TestStore, over: Record<string, unknown> = {}): Promise<string> {
  const pipeline = await firstPipeline(s);
  const made = await deals.createDeal(s.member, { title: "Totes for the fair", customerId: await customer(s, `deal-${Math.random().toString(36).slice(2)}@example.com`), pipelineId: pipeline.id, stageId: pipeline.stages[0].id, ...over });
  if (!made.ok) throw new Error(made.problems.join(","));
  return made.id;
}

describe("a store's pipelines", () => {
  it("are made once on the first visit, however many ask at once, with the quote stage marked", async () => {
    const fresh = await newStore("deals-first");
    const [a, b] = await Promise.all([deals.ensurePipeline(fresh.storeId, FIRST), deals.ensurePipeline(fresh.storeId, FIRST)]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0].stages.map((s) => [s.name, s.quoteStage])).toEqual([["New", false], ["Talking", false], ["Quote sent", true]]);
  });

  it("are added, named once each and deleted only empty and never the last", async () => {
    const pipeline = await firstPipeline(store);
    const made = await deals.createPipeline(store.member, " Partners ", [{ id: null, name: "Met", probability: 10, quoteStage: false }]);
    expect(made.ok).toBe(true);
    expect(await deals.createPipeline(store.member, "partners", [{ id: null, name: "Met", probability: null, quoteStage: false }])).toEqual({ ok: false, problem: "taken" });
    expect(await deals.createPipeline(store.member, "Bad", [{ id: null, name: "x", probability: 140, quoteStage: false }])).toEqual({ ok: false, problem: "stages" });
    await newDeal(store);
    expect(await deals.deletePipeline(store.member, pipeline.id)).toEqual({ ok: false, problem: "has_deals" });
    if (made.ok) expect(await deals.deletePipeline(store.member, made.id)).toEqual({ ok: true, id: made.id });
    const lone = await newStore("deals-lone");
    const [only] = await deals.ensurePipeline(lone.storeId, FIRST);
    expect(await deals.deletePipeline(lone.member, only.id)).toEqual({ ok: false, problem: "too_many" });
  });

  it("move a taken-away stage's deals to the first stage, and keep one quote stage", async () => {
    const made = await deals.createPipeline(store.member, "Projects", [
      { id: null, name: "Lead", probability: null, quoteStage: false },
      { id: null, name: "Offer", probability: 50, quoteStage: true },
    ]);
    if (!made.ok) throw new Error(made.problem);
    const pipeline = (await deals.pipelinesOf(store.storeId)).find((p) => p.id === made.id)!;
    const id = await newDeal(store, { pipelineId: pipeline.id, stageId: pipeline.stages[1].id });
    const saved = await deals.saveStages(store.member, pipeline.id, [
      { id: null, name: "Brief", probability: 5, quoteStage: true },
      { id: pipeline.stages[0].id, name: "Lead", probability: 20, quoteStage: false },
    ]);
    expect(saved.ok).toBe(true);
    const after = (await deals.pipelinesOf(store.storeId)).find((p) => p.id === made.id)!;
    expect(after.stages.map((s) => [s.name, s.probability, s.quoteStage])).toEqual([["Brief", 5, true], ["Lead", 20, false]]);
    expect((await deals.getDeal(store.member.store, id))?.stageId).toBe(after.stages[0].id);
    expect(await deals.saveStages(store.member, pipeline.id, [{ id: pipeline.stages[1].id, name: "Gone", probability: null, quoteStage: false }])).toEqual({ ok: false, problem: "stages" });
  });
});

describe("a deal", () => {
  it("names only its own store's person, company, owner and stage, and is its maker's unless they choose", async () => {
    const pipeline = await firstPipeline(store);
    const theirs = await customer(other, "theirs@example.com");
    expect(await deals.createDeal(store.member, { title: "Theirs", customerId: theirs, pipelineId: pipeline.id, stageId: pipeline.stages[0].id })).toEqual({ ok: false, problems: ["who"] });
    expect(await deals.createDeal(store.member, { title: "Owner", customerId: await customer(store, "owner-check@example.com"), ownerId: other.accountId, pipelineId: pipeline.id, stageId: pipeline.stages[0].id })).toEqual({ ok: false, problems: ["owner"] });
    const theirStage = (await firstPipeline(other)).stages[0].id;
    expect(await deals.createDeal(store.member, { title: "Stage", customerId: await customer(store, "stage-check@example.com"), pipelineId: pipeline.id, stageId: theirStage })).toEqual({ ok: false, problems: ["stage"] });
    const id = await newDeal(store, { estimate: "12 500" });
    const deal = await deals.getDeal(store.member.store, id);
    expect(deal).toMatchObject({ status: "open", owner: { id: store.accountId }, estimateMinor: 1_250_000, currency: "NOK", value: { minor: 1_250_000, source: "estimate" } });
    expect(deal?.moves).toHaveLength(1);
    expect(await deals.getDeal(other.member.store, id)).toBeNull();
  });

  it("changes nothing for a member who may not change customers", async () => {
    const id = await newDeal(store);
    const reader = { ...store.member, role: "admin" as const, permissions: ["customers:read"] as never };
    expect(await deals.closeDeal(reader, id, "won")).toEqual({ ok: false, problems: ["forbidden"] });
    expect(await deals.deleteDeal(reader, id)).toEqual({ ok: false, problems: ["forbidden"] });
    expect(deals.mayLink(reader, "order")).toBe(false);
  });

  it("is moved, lost with a reason, opened again and won, each kept in its history; a closed one is not moved", async () => {
    const pipeline = await firstPipeline(store);
    const id = await newDeal(store);
    expect(await deals.moveDeal(store.member, id, pipeline.stages[1].id)).toEqual({ ok: true, id });
    expect(await deals.closeDeal(store.member, id, "lost", "  Chose another\nsupplier ")).toEqual({ ok: true, id });
    expect(await deals.moveDeal(store.member, id, pipeline.stages[2].id)).toEqual({ ok: false, problems: ["closed"] });
    expect((await deals.getDeal(store.member.store, id))?.closeReason).toBe("Chose another supplier");
    expect(await deals.reopenDeal(store.member, id)).toEqual({ ok: true, id });
    expect(await deals.closeDeal(store.member, id, "won", "ignored")).toEqual({ ok: true, id });
    const deal = await deals.getDeal(store.member.store, id);
    expect(deal).toMatchObject({ status: "won", closedVia: "person", closeReason: null });
    expect(deal?.moves.map((m) => [m.stageName, m.status, m.via])).toEqual([
      ["New", "open", null],
      ["Talking", "open", null],
      ["Talking", "lost", "person"],
      ["Talking", "open", null],
      ["Talking", "won", "person"],
    ]);
  });

  it("is worth its order before VAT once linked, and is won when the order is paid", async () => {
    const id = await newDeal(store, { estimate: "99 999" });
    const order = await place(store.storeId, [["DEMO-TOTE", 2]]);
    expect(await deals.linkThing(store.member, id, "order", order.orderId)).toMatchObject({ ok: true });
    const [facts] = await db().execute<Row>(sql`select (total_minor - tax_minor)::bigint as net from commerce.orders where id = ${order.orderId}::uuid`);
    expect((await deals.getDeal(store.member.store, id))?.value).toEqual({ minor: Number(facts.net), source: "links", unconverted: [] });
    await pay(store.storeId, order, store.account);
    expect(await deals.getDeal(store.member.store, id)).toMatchObject({ status: "won", closedVia: "order" });
    const elsewhere = await newDeal(store);
    expect(await deals.linkThing(store.member, elsewhere, "order", order.orderId)).toEqual({ ok: false, problems: ["taken"] });
    const theirOrder = await place(other.storeId, [["DEMO-TOTE", 1]]);
    expect(await deals.linkThing(store.member, elsewhere, "order", theirOrder.orderId)).toEqual({ ok: false, problems: ["not_found"] });
  });

  it("follows its person into a merge, keeps a company with open deals, and is in the person's export", async () => {
    const keep = await customer(store, "keep-deal@example.com");
    const remove = await customer(store, "remove-deal@example.com");
    const id = await newDeal(store, { customerId: remove, estimate: "1 000" });
    const merged = await mergeCustomers(store.member, keep, remove);
    expect(merged.ok).toBe(true);
    expect((await deals.getDeal(store.member.store, id))?.customer?.id).toBe(keep);

    const company = await saveCompany(store.member, null, { name: "Kunde Deals AS" });
    if (!company.ok || !company.id) throw new Error("company not saved");
    const firms = await newDeal(store, { customerId: "", companyId: company.id });
    const refused = await deleteCompany(store.member, company.id);
    expect(refused.ok).toBe(false);
    expect(await deals.closeDeal(store.member, firms, "lost")).toMatchObject({ ok: true });
    expect((await deleteCompany(store.member, company.id)).ok).toBe(true);
    expect((await deals.getDeal(store.member.store, firms))?.company).toBeNull();

    const subject = await resolveSubject(store.storeId, { customerId: keep }, { channel: "staff" });
    const exported = await gatherExport(subject!, "en", new Date());
    expect(exported?.customerDeals).toEqual([
      expect.objectContaining({ title: "Totes for the fair", status: "open", stage: "New", estimateMinor: 100_000, currency: "NOK", closeReason: null }),
    ]);
  });
});
