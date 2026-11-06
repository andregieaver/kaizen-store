import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { houseCustomerOfAccount, houseStoreId, syncHouseCustomers } = await import("./house-customers");
const { eraseSubject } = await import("./privacy-erasure");

/**
 * Kaizena Flow's own customers (D467), against the database: owners and applicants become customers of Kaizena Flow's own store with the
 * platform's tags, an application opens a deal on Sign-ups that follows it to won or lost, staff's own tags and a closed deal are left alone,
 * a person nobody holds any more is forgotten, and an erased account takes everything of its address with it. Other files' people share the
 * database, so every assertion names this run's addresses.
 */

const run = Date.now().toString(36);
const mail = (who: string) => `${who}-${run}@example.com`;

const one = async (query: ReturnType<typeof sql>): Promise<Row | undefined> => (await db().execute<Row>(query))[0];

async function store(slug: string, opened = false): Promise<string> {
  const row = await one(sql`
    insert into commerce.stores (slug, name, setup_completed_at) values (${`${slug}-${run}`}, ${slug}, ${opened ? new Date().toISOString() : null}::timestamptz)
    returning id
  `);
  return String(row!.id);
}

async function owner(email: string, storeId: string): Promise<string> {
  const row = await one(sql`insert into commerce.accounts (email, name) values (${email}, 'Ola Owner') returning id`);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${String(row!.id)}::uuid, 'owner')`);
  return String(row!.id);
}

async function plan(name: string): Promise<string> {
  return String((await one(sql`insert into commerce.plans (name) values (${name}) returning id`))!.id);
}

async function bill(storeId: string, planId: string | null, status: string | null) {
  await db().execute(sql`
    insert into commerce.store_billing (store_id, plan_id, status) values (${storeId}::uuid, ${planId}::uuid, ${status})
    on conflict (store_id) do update set plan_id = excluded.plan_id, status = excluded.status
  `);
}

async function request(email: string, storeName: string, extra: { selfServe?: boolean; confirmed?: boolean } = {}): Promise<string> {
  const row = await one(sql`
    insert into commerce.access_requests (email, name, store_name, self_serve, confirmed_at)
    values (${email}, 'Ada Applicant', ${storeName}, ${extra.selfServe ?? false}, ${extra.confirmed ? new Date().toISOString() : null}::timestamptz)
    returning id
  `);
  return String(row!.id);
}

const house = async () => (await houseStoreId())!;

async function customer(email: string): Promise<Row | undefined> {
  return one(sql`select id, name, locale from commerce.customers where store_id = ${await house()}::uuid and lower(email) = ${email}`);
}

async function tags(email: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`select label from commerce.customer_tags where store_id = ${await house()}::uuid and email = ${email} order by label`);
  return rows.map((r) => String(r.label));
}

async function deal(email: string): Promise<{ title: string; stage: string; status: string; via: string | null; reason: string | null } | null> {
  const row = await one(sql`
    select d.title, s.name as stage, d.status, d.closed_via, d.close_reason from commerce.deals d
    join commerce.deal_stages s on s.store_id = d.store_id and s.id = d.stage_id
    join commerce.customers c on c.store_id = d.store_id and c.id = d.customer_id
    where d.store_id = ${await house()}::uuid and lower(c.email) = ${email}
  `);
  return row ? { title: String(row.title), stage: String(row.stage), status: String(row.status), via: row.closed_via ? String(row.closed_via) : null, reason: row.close_reason ? String(row.close_reason) : null } : null;
}

describe("Kaizena Flow's own customers (D467)", () => {
  it("brings an owner in with the tags of their stores and plans, linked to the account", async () => {
    const shop = await store("growth-shop", true);
    const growth = await plan(`Growth ${run}`);
    await bill(shop, growth, "active");
    const email = mail("owner");
    const account = await owner(email, shop);
    await syncHouseCustomers();
    expect(await customer(email)).toMatchObject({ name: "Ola Owner", locale: "en-GB" });
    expect(await tags(email)).toEqual(["Owner", `Plan: Growth ${run}`, "Store open"]);
    const link = await houseCustomerOfAccount(account);
    expect(link?.storeSlug).toBe("kaizenaflow");
    expect(link?.customerId).toBe(String((await customer(email))!.id));
    // A plan overdue is told; paid again, the tag goes. Staff's own tag is never touched.
    await db().execute(sql`insert into commerce.customer_tags (store_id, email, key, label, created_by) values (${await house()}::uuid, ${email}, 'vip', 'VIP', ${account}::uuid)`);
    await bill(shop, growth, "past_due");
    await syncHouseCustomers();
    expect(await tags(email)).toEqual(["Overdue", "Owner", `Plan: Growth ${run}`, "Store open", "VIP"]);
    await bill(shop, null, null);
    await syncHouseCustomers();
    expect(await tags(email)).toEqual(["No plan", "Owner", "Store open", "VIP"]);
  });

  it("keeps a name staff typed, and fills one only while it is empty", async () => {
    const email = mail("named");
    await owner(email, await store("named-shop"));
    await syncHouseCustomers();
    await db().execute(sql`update commerce.customers set name = 'Ola from the fair' where store_id = ${await house()}::uuid and lower(email) = ${email}`);
    await syncHouseCustomers();
    expect((await customer(email))?.name).toBe("Ola from the fair");
  });

  it("opens a deal for an application and follows it to won when the store's plan is paid", async () => {
    const email = mail("applicant");
    const id = await request(email, "Ada's Apples");
    await syncHouseCustomers();
    expect(await tags(email)).toEqual(["Lead"]);
    expect(await deal(email)).toEqual({ title: "Ada's Apples", stage: "Asked", status: "open", via: null, reason: null });

    const shop = await store("ada-apples");
    await db().execute(sql`update commerce.access_requests set status = 'approved', store_id = ${shop}::uuid, decided_at = now() where id = ${id}::uuid`);
    await owner(email.replace("@", "+not-the-same@"), shop);
    await syncHouseCustomers();
    expect(await deal(email)).toMatchObject({ stage: "Approved", status: "open" });

    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${shop}::uuid`);
    await syncHouseCustomers();
    expect(await deal(email)).toMatchObject({ stage: "Store opened", status: "open" });

    await bill(shop, await plan(`Start ${run}`), "active");
    await syncHouseCustomers();
    expect(await deal(email)).toMatchObject({ stage: "Store opened", status: "won", via: "platform" });
  });

  it("loses the deal of a declined application, and leaves a deal a person closed or moved alone", async () => {
    const declined = mail("declined");
    const id = await request(declined, "Never Mind");
    await syncHouseCustomers();
    await db().execute(sql`update commerce.access_requests set status = 'declined', decided_at = now() where id = ${id}::uuid`);
    await syncHouseCustomers();
    expect(await deal(declined)).toMatchObject({ stage: "Asked", status: "lost", via: "platform", reason: "Declined" });

    const closed = mail("closed-by-hand");
    const other = await request(closed, "Hand Closed");
    await syncHouseCustomers();
    await db().execute(sql`
      update commerce.deals set status = 'lost', closed_at = now(), closed_via = 'person', close_reason = 'Chose another'
      where store_id = ${await house()}::uuid and customer_id = (select id from commerce.customers where store_id = ${await house()}::uuid and lower(email) = ${closed})
    `);
    await db().execute(sql`update commerce.access_requests set status = 'approved', decided_at = now() where id = ${other}::uuid`);
    await syncHouseCustomers();
    expect(await deal(closed)).toMatchObject({ stage: "Asked", status: "lost", via: "person" });
  });

  it("brings in a self-serve application only once its link was opened", async () => {
    const waiting = mail("unconfirmed");
    await request(waiting, "Not Yet", { selfServe: true });
    const confirmed = mail("confirmed");
    await request(confirmed, "Confirmed Shop", { selfServe: true, confirmed: true });
    await syncHouseCustomers();
    expect(await customer(waiting)).toBeUndefined();
    expect(await customer(confirmed)).toBeDefined();
  });

  it("forgets an applicant whose application was blanked, unless they asked for news", async () => {
    const quiet = mail("quiet");
    const quietId = await request(quiet, "Quiet Shop");
    const news = mail("news");
    const newsId = await request(news, "News Shop");
    await syncHouseCustomers();
    await db().execute(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${await house()}::uuid, ${news}, 'en-GB', 'subscribed', 'form', 'Send me news', now(), ${randomBytes(32).toString("base64url")})
    `);
    for (const id of [quietId, newsId]) {
      await db().execute(sql`update commerce.access_requests set email = 'erased-' || id || '@erased.invalid', name = '', message = '' where id = ${id}::uuid`);
    }
    await syncHouseCustomers();
    expect(await customer(quiet)).toBeUndefined();
    expect(await deal(quiet)).toBeNull();
    expect(await customer(news)).toBeDefined();
    expect(await tags(news)).toEqual([]);
  });

  it("takes everything of an erased account's address with it", async () => {
    const email = mail("erased");
    const shop = await store("erased-shop", true);
    const account = await owner(email, shop);
    // The store keeps another owner, as an account's own erasure needs (D377).
    await owner(mail("partner"), shop);
    await syncHouseCustomers();
    await db().execute(sql`
      insert into commerce.customer_notes (store_id, email, body, created_by) values (${await house()}::uuid, ${email}, 'Met at the fair', ${account}::uuid)
    `);
    await db().execute(sql`delete from commerce.store_members where account_id = ${account}::uuid`);
    await db().execute(sql`update commerce.accounts set email = ${`erased-${account}@erased.invalid`}, name = null, disabled_at = now() where id = ${account}::uuid`);
    await syncHouseCustomers();
    expect(await customer(email)).toBeUndefined();
    expect((await one(sql`select count(*)::int as n from commerce.customer_notes where store_id = ${await house()}::uuid and email = ${email}`))?.n).toBe(0);
  });

  it("does not bring back an applicant Kaizena Flow's store erased: their application is blanked with them", async () => {
    const email = mail("erase-me");
    const id = await request(email, "Erase Me");
    await syncHouseCustomers();
    const erased = await eraseSubject(await house(), { email }, { channel: "staff", accountId: null });
    expect(erased.ok).toBe(true);
    expect((await one(sql`select email from commerce.access_requests where id = ${id}::uuid`))?.email).toBe(`erased-${id}@erased.invalid`);
    await syncHouseCustomers();
    expect(await customer(email)).toBeUndefined();
  });

  it("changes nothing on a second run", async () => {
    await syncHouseCustomers();
    const again = await syncHouseCustomers();
    expect(again).toMatchObject({ added: 0, tagsAdded: 0, tagsRemoved: 0, dealsOpened: 0, dealsChanged: 0, forgotten: 0 });
  });
});
