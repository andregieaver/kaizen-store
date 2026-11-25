import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ADMIN_API_BY_NAME } from "@/lib/admin-api-routes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));
delete process.env.RESEND_API_KEY;

const route = await import("@/app/api/admin/v1/[...path]/route");
const { makeApiToken } = await import("./api-tokens");
const { newStore } = await import("./inventory-test-support");
const deals = await import("./deals");
const activities = await import("./activities");
const staff = await import("./customer-staff");

/**
 * The CRM in the Admin API (D902, D901 P29): pipelines, deals, activities, leads and companies read with `customers:read`; deals newest first in
 * pages with their worth as the board has it and narrowed by status, stage and person; activities by done; a person's company on the
 * customer; never a lost deal's reason, an activity's note or a lead's words; another store's records not found; a token without the scope
 * refused.
 */

const run = randomBytes(4).toString("hex");
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let reader = "";
let productsOnly = "";

async function call(path: string, token: string): Promise<{ status: number; body: Answer }> {
  const url = new URL(`https://kaizenaflow.example/api/admin/v1/${path}`);
  const response = await route.GET(new Request(url, { method: "GET", headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ path: url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean) }),
  } as never);
  return { status: response.status, body: (await response.json()) as Answer };
}

const salesOn = (storeId: string) =>
  db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${storeId}::uuid and not ('sales' = any(features))`);

async function person(target: typeof store, name: string) {
  const made = await staff.createCustomer(target.member, { email: `${name.toLowerCase()}-${run}@example.com`, name });
  if (!made.ok) throw new Error("customer");
  return made.id;
}

beforeAll(async () => {
  store = await newStore("apicrm");
  other = await newStore("apicrm2");
  await salesOn(store.storeId);
  await salesOn(other.storeId);
  const r = await makeApiToken(store.member, { name: "CRM", scopes: ["customers:read"] });
  const p = await makeApiToken(store.member, { name: "Products", scopes: ["products:read"] });
  if (!r.ok || !p.ok) throw new Error("no token");
  reader = r.token;
  productsOnly = p.token;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("the CRM in the Admin API (D902, D901 P29)", () => {
  it("lists pipelines with their stages, and deals newest first with their worth, narrowed and paged", async () => {
    const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Quote sent", quoteStage: true }] });
    const kari = await person(store, "Kari");
    const first = await deals.createDeal(store.member, { title: "Kaffe til kontoret", customerId: kari, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, estimate: "1250" });
    const second = await deals.createDeal(store.member, { title: "Kaffemaskin", customerId: kari, pipelineId: pipeline.id, stageId: pipeline.stages[1].id });
    if (!first.ok || !second.ok) throw new Error("deal");
    const lost = await deals.closeDeal(store.member, second.id, "lost", "Too dear for them this year");
    expect(lost.ok).toBe(true);

    const pipelines = await call("pipelines", reader);
    expect(pipelines.status).toBe(200);
    ADMIN_API_BY_NAME["pipelines.list"].response.parse(pipelines.body);
    const sales = pipelines.body.data.find((p: Answer) => p.id === pipeline.id);
    expect(sales.stages.map((s: Answer) => [s.name, s.position, s.quote_stage])).toEqual([
      ["New", 0, false],
      ["Quote sent", 1, true],
    ]);

    const list = await call("deals?limit=1", reader);
    expect(list.status).toBe(200);
    ADMIN_API_BY_NAME["deals.list"].response.parse(list.body);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(second.id);
    expect(list.body.next).toBeTruthy();
    const rest = await call(`deals?limit=1&after=${encodeURIComponent(list.body.next)}`, reader);
    expect(rest.body.data[0].id).toBe(first.id);
    expect(rest.body.data[0]).toMatchObject({
      title: "Kaffe til kontoret",
      status: "open",
      pipeline: { id: pipeline.id, name: "Sales" },
      stage: { name: "New", position: 0 },
      customer: { id: kari, name: "Kari" },
      company: null,
    });
    // The board's worth: the estimate while nothing is linked, in the store's main currency's units.
    const board = (await deals.listDeals(store.member.store, { id: first.id }))[0];
    expect(rest.body.data[0].value).toBe(board.value.minor === null ? null : board.value.minor / 100);

    const open = await call("deals?status=open", reader);
    expect(open.body.data.map((d: Answer) => d.id)).toEqual([first.id]);
    const quoted = await call(`deals?stage_id=${pipeline.stages[1].id}`, reader);
    expect(quoted.body.data.map((d: Answer) => d.id)).toEqual([second.id]);
    const hers = await call(`deals?customer_id=${kari}`, reader);
    expect(hers.body.data).toHaveLength(2);
    const later = await call(`deals?updated_after=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, reader);
    expect(later.body.data).toEqual([]);

    const one = await call(`deals/${second.id}`, reader);
    expect(one.status).toBe(200);
    ADMIN_API_BY_NAME["deals.get"].response.parse(one.body);
    expect(one.body.data).toMatchObject({ status: "lost", closed_via: "person" });
    expect(JSON.stringify(one.body)).not.toContain("Too dear");

    expect((await call("deals?status=maybe", reader)).status).toBe(422);
    expect((await call("deals?owner_id=nobody", reader)).status).toBe(422);
  });

  it("lists activities, narrowed by done, without their notes", async () => {
    const [pipeline] = await deals.pipelinesOf(store.storeId);
    const ola = await person(store, "Ola");
    const deal = await deals.createDeal(store.member, { title: "Kaffe til lageret", customerId: ola, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!deal.ok) throw new Error("deal");
    const call1 = await activities.createActivity(store.member, { kind: "call", title: "Ring Ola", dealId: deal.id, dueOn: "2026-12-01", dueTime: "09:00", note: "Ask about the grinder" });
    const task = await activities.createActivity(store.member, { kind: "task", title: "Send prisliste", dealId: deal.id, dueOn: "2026-12-02" });
    if (!call1.ok || !task.ok) throw new Error(`activity: ${JSON.stringify([call1, task])}`);
    await activities.setActivityDone(store.member, task.id, true);

    const list = await call(`activities?deal_id=${deal.id}`, reader);
    expect(list.status).toBe(200);
    ADMIN_API_BY_NAME["activities.list"].response.parse(list.body);
    expect(list.body.data.map((a: Answer) => a.title).sort()).toEqual(["Ring Ola", "Send prisliste"]);
    expect(JSON.stringify(list.body)).not.toContain("grinder");
    const todo = await call(`activities?deal_id=${deal.id}&done=false`, reader);
    expect(todo.body.data.map((a: Answer) => a.id)).toEqual([call1.id]);
    expect(todo.body.data[0]).toMatchObject({ kind: "call", timed: true, deal_id: deal.id, assignee: { id: store.accountId } });

    const one = await call(`activities/${task.id}`, reader);
    ADMIN_API_BY_NAME["activities.get"].response.parse(one.body);
    expect(one.body.data.done_at).not.toBeNull();
    expect((await call("activities?done=maybe", reader)).status).toBe(422);
  });

  it("lists companies with their people, and a customer names their company", async () => {
    const [company] = await db().execute<{ id: string }>(sql`
      insert into commerce.customer_companies (store_id, name, organisation_number) values (${store.storeId}::uuid, ${`Kaffebaren ${run}`}, '915429777') returning id`);
    const buyer = await person(store, "Per");
    await db().execute(sql`update commerce.customers set company_id = ${company.id}::uuid, company_role = 'employee' where store_id = ${store.storeId}::uuid and id = ${buyer}::uuid`);

    const list = await call("companies", reader);
    expect(list.status).toBe(200);
    ADMIN_API_BY_NAME["companies.list"].response.parse(list.body);
    const one = await call(`companies/${company.id}`, reader);
    ADMIN_API_BY_NAME["companies.get"].response.parse(one.body);
    expect(one.body.data).toMatchObject({ name: `Kaffebaren ${run}`, organisation_number: "915429777", people: 1, active: true });

    const customer = await call(`customers/${buyer}`, reader);
    expect(customer.body.data.company_id).toBe(company.id);
  });

  it("lists leads by who and what they asked, never their words", async () => {
    const email = `lead-${run}@example.com`;
    await db().execute(sql`
      insert into commerce.marketing_subscribers (store_id, email, name, locale, status, source, consent_text, consented_at, token)
      values (${store.storeId}::uuid, ${email}, 'Lise', 'nb', 'subscribed', 'form', 'Yes, send me news.', now(), ${randomBytes(32).toString("base64url")})`);
    const leads = await call("leads", reader);
    expect(leads.status).toBe(200);
    ADMIN_API_BY_NAME["leads.list"].response.parse(leads.body);
    const lise = leads.body.data.find((l: Answer) => l.email === email);
    expect(lise).toMatchObject({ name: "Lise", requests: [{ kind: "subscriber", source: "subscriber" }] });
    expect(JSON.stringify(lise)).not.toContain("send me news");
  });

  it("finds nothing of another store's, and refuses a token without customers:read", async () => {
    const [pipeline] = await deals.ensurePipeline(other.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const theirs = await deals.createDeal(other.member, { title: "Not yours", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, customerId: await person(other, "Eva") });
    if (!theirs.ok) throw new Error("deal");
    expect((await call(`deals/${theirs.id}`, reader)).status).toBe(404);
    expect((await call("deals", reader)).body.data.map((d: Answer) => d.id)).not.toContain(theirs.id);
    expect((await call("deals", productsOnly)).status).toBe(403);
    expect((await call("companies", productsOnly)).status).toBe(403);
  });
});
