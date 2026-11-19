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
const contracts = await import("./contracts");
const deals = await import("./deals");
const staff = await import("./customer-staff");

/**
 * Contracts in the Admin API (D695, D810): read with `customers:read`, newest first in pages, narrowed by status and deal, one by its id;
 * the signers in order with their dates, never an email; another store's contract is not found; a token without the scope is refused.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let reader = "";
let other = "";

async function call(path: string, token: string): Promise<{ status: number; body: Answer }> {
  const url = new URL(`https://kaizenaflow.example/api/admin/v1/${path}`);
  const response = await route.GET(new Request(url, { method: "GET", headers: { authorization: `Bearer ${token}` } }), {
    params: Promise.resolve({ path: url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean) }),
  } as never);
  return { status: response.status, body: (await response.json()) as Answer };
}

async function dealWithContract(title: string) {
  const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }] });
  const customer = await staff.createCustomer(store.member, { email: `k-${Math.random().toString(36).slice(2)}@example.com`, name: "Kari Nordmann" });
  if (!customer.ok) throw new Error("customer");
  const deal = await deals.createDeal(store.member, { title, customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
  if (!deal.ok) throw new Error(deal.problems.join(","));
  const made = await contracts.createContract(store.member, deal.id);
  if (!made.ok) throw new Error(made.problem);
  return { dealId: deal.id, contractId: made.id };
}

beforeAll(async () => {
  store = await newStore("apicontracts");
  await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${store.storeId}::uuid and not ('sales' = any(features))`);
  const r = await makeApiToken(store.member, { name: "Contracts", scopes: ["customers:read"] });
  const o = await makeApiToken(store.member, { name: "Products", scopes: ["products:read"] });
  if (!r.ok || !o.ok) throw new Error("no token");
  reader = r.token;
  other = o.token;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("contracts in the Admin API (D810)", () => {
  it("lists contracts newest first with their signers, narrows them, reads one, and never gives an email", async () => {
    const first = await dealWithContract("Avtale én");
    const second = await dealWithContract("Avtale to");
    // The second is sent: frozen as sending freezes it, without drawing a PDF.
    await db().execute(sql`
      update commerce.contracts set status = 'sent', sent_at = now(), sent_by = ${store.accountId}::uuid, expires_at = now() + interval '30 days',
        snapshot = blocks, pdf_path = 'contracts/api.pdf', pdf_sha256 = ${"a".repeat(64)}
      where store_id = ${store.storeId}::uuid and id = ${second.contractId}::uuid
    `);

    const list = await call("contracts?limit=1", reader);
    expect(list.status).toBe(200);
    ADMIN_API_BY_NAME["contracts.list"].response.parse(list.body);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: second.contractId, status: "sent", deal_id: second.dealId, signed_pdf: false });
    expect(list.body.data[0].signers.map((g: Answer) => g.role)).toEqual(["store", "customer"]);
    expect(list.body.next).toEqual(expect.any(String));
    const next = await call(`contracts?limit=1&after=${encodeURIComponent(list.body.next)}`, reader);
    expect(next.body.data[0]).toMatchObject({ id: first.contractId, status: "draft" });

    expect((await call("contracts?status=draft", reader)).body.data.map((c: Answer) => c.id)).toEqual([first.contractId]);
    expect((await call(`contracts?deal_id=${second.dealId}`, reader)).body.data.map((c: Answer) => c.id)).toEqual([second.contractId]);
    expect((await call("contracts?deal_id=nope", reader)).status).toBe(422);

    const one = await call(`contracts/${second.contractId}`, reader);
    expect(one.status).toBe(200);
    ADMIN_API_BY_NAME["contracts.get"].response.parse(one.body);
    expect(one.body.data.admin_url).toContain(`/deals/${second.dealId}/contracts/${second.contractId}`);
    expect(JSON.stringify([list.body, next.body, one.body])).not.toContain("@example.com");
  });

  it("finds no other store's contract and refuses a token without customers:read", async () => {
    const elsewhere = await newStore("apicontracts-other");
    const [pipeline] = await deals.ensurePipeline(elsewhere.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const customer = await staff.createCustomer(elsewhere.member, { email: "x@example.com", name: "X" });
    if (!customer.ok) throw new Error("customer");
    const deal = await deals.createDeal(elsewhere.member, { title: "Ikke din", customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!deal.ok) throw new Error("deal");
    const made = await contracts.createContract(elsewhere.member, deal.id);
    if (!made.ok) throw new Error("contract");
    expect((await call(`contracts/${made.id}`, reader)).status).toBe(404);
    expect((await call("contracts", other)).status).toBe(403);
  });
});
