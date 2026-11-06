import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
const background = vi.hoisted(() => ({ tasks: [] as (() => unknown)[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: () => unknown) => background.tasks.push(task),
}));

const { closeDb, db } = await import("@/db/client");
const fx = await import("./invoice-test-fixture");
const inbound = await import("./support-inbound");
const filing = await import("./email-filing");
const { readTimeline } = await import("./customer-timeline");
const { eraseSubject } = await import("./privacy-erasure");
type ReceivedEmail = import("./support-inbound").ReceivedEmail;
type Row = Record<string, unknown>;

/**
 * Email on the timeline (S5, D476) through the real inbound pipeline, against a real database: mail a team member copies or forwards to the
 * store's filing address is filed on the customers it names (the forwarded part too), their company and their open deals, and shows on their
 * timeline; mail from someone outside the team, or about nobody the store knows, is not kept; an erasure takes it with the person.
 */

afterAll(async () => {
  await closeDb();
});

const DOMAIN = "in.example.com";
const env = { SUPPORT_INBOUND_DOMAIN: DOMAIN, RESEND_API_KEY: "re_test" };
const emails = new Map<string, ReceivedEmail>();
const fakeFetch = (async (url: string) => {
  const email = emails.get(decodeURIComponent(String(url).split("/").pop() ?? ""));
  return email ? Response.json(email) : new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
const run = Date.now().toString(36);
let counter = 0;

async function receive(to: string, from: string, email: Partial<ReceivedEmail> = {}) {
  const id = `fe_${run}_${++counter}`;
  emails.set(id, { from, subject: "Re: Tote bags", text: "Hi Kari, here is the price.", headers: {}, message_id: `<${id}@mail.example.com>`, ...email });
  await inbound.receiveInboundEvent({ type: "email.received", data: { email_id: id, from, to: [to], subject: "Re: Tote bags", message_id: `<${id}@mail.example.com>` } }, { fetch: fakeFetch, env });
  for (const task of background.tasks.splice(0)) await task();
  const [row] = await db().execute<Row>(sql`select status, reason, purpose from commerce.support_inbound_emails where provider_id = ${id}`);
  return row;
}

async function sellingStore(label: string) {
  const store = await fx.makeStore(`${label}-${run}`);
  await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${store.storeId}::uuid and not ('sales' = any(features))`);
  const owner = await fx.ownerOf(store);
  const address = await filing.filingAddressOf(store.storeId, env);
  if (!address) throw new Error("no filing address");
  return { store, owner, address, staff: owner.account.email.toLowerCase() };
}

describe("mail copied or forwarded to a store's filing address", () => {
  it("is filed on the customers it names, the forwarded part too, their company and open deal, and shows on their timeline", async () => {
    const { store, owner, address, staff } = await sellingStore("filing");
    expect(address).toMatch(/^bcc-[a-z0-9]{20}@in\.example\.com$/);
    expect(await filing.filingAddressOf(store.storeId, env)).toBe(address);
    const kari = `kari-${run}@kunde.no`;
    const ola = `ola-${run}@kunde.no`;
    const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name) values (${store.storeId}::uuid, 'Kunde AS') returning id`);
    const [k] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, company_id, company_role) values (${store.storeId}::uuid, ${kari}, 'Kari', ${String(company.id)}::uuid, 'employee') returning id`);
    await db().execute(sql`insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${ola}, 'Ola')`);
    const [pipeline] = await db().execute<Row>(sql`insert into commerce.deal_pipelines (store_id, name) values (${store.storeId}::uuid, 'Sales') returning id`);
    const [stage] = await db().execute<Row>(sql`insert into commerce.deal_stages (store_id, pipeline_id, name, position) values (${store.storeId}::uuid, ${String(pipeline.id)}::uuid, 'New', 0) returning id`);
    const [deal] = await db().execute<Row>(sql`
      insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency) values (${store.storeId}::uuid, 'Totes', ${String(k.id)}::uuid, ${String(pipeline.id)}::uuid, ${String(stage.id)}::uuid, 'NOK') returning id`);

    const forwarded = ["Over to you.", "", "---------- Forwarded message ---------", `From: Ola <${ola}>`, `To: ${staff}`, "", "Can we get 40 by Friday?"].join("\n");
    expect(await receive(address, `Owner <${staff}>`, { headers: { To: `Kari <${kari}>`, Cc: address }, text: forwarded })).toEqual({ status: "done", reason: null, purpose: "filing" });
    const [filed] = await db().execute<Row>(sql`select addresses, cardinality(customer_ids)::int as customers, company_ids, deal_ids, body from commerce.filed_emails where store_id = ${store.storeId}::uuid`);
    expect(filed.addresses).toEqual([kari, ola]);
    expect(filed.customers).toBe(2);
    expect(filed.company_ids).toEqual([String(company.id)]);
    expect(filed.deal_ids).toEqual([String(deal.id)]);
    expect(String(filed.body)).toContain("Can we get 40 by Friday?");

    const selling = { ...owner, store: { ...owner.store, features: [...owner.store.features, "sales" as const] } };
    const read = await readTimeline(selling, { kind: "person", email: kari, customerId: String(k.id) });
    expect(read.events.find((e) => e.what === "email_filed")).toMatchObject({ label: "Tote bags" });
    expect(await filing.filedEmailsOf(store.storeId, { dealId: String(deal.id) })).toHaveLength(1);

    await eraseSubject(store.storeId, { customerId: String(k.id) }, { channel: "staff", accountId: owner.account.id });
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.filed_emails where store_id = ${store.storeId}::uuid`);
    expect(left.n).toBe(0);
  });

  it("is not kept when it is not from the team, is about nobody the store knows, or Deals is off", async () => {
    const { store, address, staff } = await sellingStore("filing-refused");
    expect(await receive(address, `Someone <stranger-${run}@else.no>`)).toMatchObject({ status: "refused", reason: "not_staff" });
    expect(await receive(address, staff, { headers: { To: `nobody-${run}@else.no` } })).toMatchObject({ status: "refused", reason: "no_match" });
    await db().execute(sql`update commerce.stores set features = array_remove(features, 'sales') where id = ${store.storeId}::uuid`);
    expect(await receive(address, staff, { headers: { To: `kari-${run}@kunde.no` } })).toMatchObject({ status: "refused", reason: "sales_off" });
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.filed_emails where store_id = ${store.storeId}::uuid`);
    expect(kept.n).toBe(0);
  });
});
