import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const leads = await import("./leads");
const { ensurePipeline } = await import("./deals");
const { eraseSubject } = await import("./privacy-erasure");

/**
 * The leads inbox (S4, D475) through the server, against a real database: a question and a subscription from someone who is not a customer
 * are one lead; a paying customer is none; made a deal, the person becomes a customer with a deal in the first stage and leaves the inbox;
 * dismissed, they come back only by asking again; an erasure takes the decision with the person.
 */

afterAll(async () => {
  await closeDb();
});

const run = Date.now().toString(36);
const KINDS = { quote: "quote request", question: "question", chat: "chat", subscriber: "new subscriber" };

async function sellingStore(label: string) {
  const store = await fx.makeStore(`${label}-${run}`);
  await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${store.storeId}::uuid and not ('sales' = any(features))`);
  const owner = await fx.ownerOf(store);
  const selling = { ...owner, store: { ...owner.store, features: [...owner.store.features, "sales" as const] } };
  await ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }] });
  return { store, owner: selling };
}
const question = (storeId: string, email: string, message = "Do you make totes in green?") =>
  db().execute(sql`
    insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, payload, path, locale)
    values (${storeId}::uuid, 'b1', 'message', 'v1', 'logged', ${email}, ${JSON.stringify({ name: "Kari Nordmann", message })}::jsonb, '/contact', 'nb')`);
const subscriber = (storeId: string, email: string) =>
  db().execute(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${email}, 'nb', 'subscribed', 'form', 'Yes, send me news.', now(), ${randomBytes(32).toString("base64url")})`);

describe("the leads inbox", () => {
  it("is one row a person who asked for something and is not a customer, and none for a paying customer", async () => {
    const { store } = await sellingStore("leads-read");
    const kari = `kari-${run}@example.com`;
    await question(store.storeId, kari);
    await subscriber(store.storeId, kari);
    const paid = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const [order] = await db().execute<{ email: string }>(sql`select email from commerce.orders where id = ${paid.orderId}::uuid`);
    await question(store.storeId, order.email, "Where is my parcel?");
    const list = await leads.leadsOf(store.storeId);
    expect(list.map((l) => l.email)).toEqual([kari]);
    expect(list[0]).toMatchObject({ name: "Kari Nordmann" });
    expect(list[0].items.map((i) => i.kind).sort()).toEqual(["question", "subscriber"]);
  });

  it("makes a deal of a lead: the person a customer, the deal in the first stage, owned by who made it, and out of the inbox", async () => {
    const { store, owner } = await sellingStore("leads-deal");
    const ola = `ola-${run}@example.com`;
    await question(store.storeId, ola);
    const made = await leads.makeLeadDeal(owner, ola, KINDS);
    if (!made.ok || !made.dealId) throw new Error(JSON.stringify(made));
    const [deal] = await db().execute<{ title: string; owner_id: string; email: string; stage: string }>(sql`
      select d.title, d.owner_id, c.email, s.name as stage from commerce.deals d
        join commerce.customers c on c.id = d.customer_id join commerce.deal_stages s on s.id = d.stage_id
       where d.id = ${made.dealId}::uuid`);
    expect(deal).toEqual({ title: "Kari Nordmann: question", owner_id: owner.account.id, email: ola, stage: "New" });
    expect(await leads.leadsOf(store.storeId)).toEqual([]);
    expect(await leads.makeLeadDeal(owner, ola, KINDS)).toEqual({ ok: false, problem: "not_found" });
  });

  it("dismisses a lead until they ask again, and an erasure takes the decision with the person", async () => {
    const { store, owner } = await sellingStore("leads-dismiss");
    const per = `per-${run}@example.com`;
    await question(store.storeId, per);
    await db().execute(sql`update commerce.form_submissions set created_at = now() - interval '1 hour' where store_id = ${store.storeId}::uuid`);
    expect(await leads.dismissLead(owner, per)).toEqual({ ok: true, dealId: null });
    expect(await leads.leadsOf(store.storeId)).toEqual([]);
    await question(store.storeId, per, "One more thing");
    expect((await leads.leadsOf(store.storeId)).map((l) => l.items.length)).toEqual([1]);

    const reader = { ...owner, role: "admin" as const, permissions: ["customers:read"] as never };
    expect(await leads.dismissLead(reader, per)).toEqual({ ok: false, problem: "forbidden" });

    await eraseSubject(store.storeId, { email: per }, { channel: "staff", accountId: owner.account.id });
    const [left] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.lead_decisions where store_id = ${store.storeId}::uuid`);
    expect(left.n).toBe(0);
  });
});
