import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const au = await import("./automations");
const stock = await import("./stock-requests");
const { eraseSubject } = await import("./privacy-erasure");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.8): a welcome goes once to someone who joined after it was switched on, never to
 * one before nor to a pending or unsubscribed address; an after-purchase email goes once per delivered paid order to a subscribed address, never
 * for a copied order; win-back goes after the lapse and again only after a new order lapses; nothing for a store that is not open; back in stock
 * waits for a typed address's link, a verified customer's at once, sends one email each when stock rises and only once; another store's requests
 * are never read; erasure removes sends and requests.
 */

const run = Date.now().toString(36);
const DAY = 86_400_000;
let storeId: string;
let otherId: string;
let owner: string;
let n = 0;

const words = (subject: string): BroadcastContent => ({
  "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph", text: `${subject}: hei` }] },
});

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${id}::uuid`);
  return id;
}

async function subscriber(store: string, email: string, status: "subscribed" | "pending" | "unsubscribed", at = new Date()): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at,
      confirm_hash, confirm_until, token)
    values (${store}::uuid, ${email}, 'nb-NO', 'NO', ${status === "pending" ? "pending" : "subscribed"}, 'account', 'Yes please', ${at.toISOString()}::timestamptz,
      ${status === "pending" ? randomBytes(32).toString("hex") : null}, ${status === "pending" ? sql`now() + interval '7 days'` : sql`null`},
      ${randomBytes(32).toString("base64url")})
    returning id
  `);
  if (status === "unsubscribed") {
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where id = ${String(row.id)}::uuid`);
  }
  return String(row.id);
}

async function order(store: string, o: { email: string; at: Date; delivered?: Date; copied?: boolean }): Promise<string> {
  n += 1;
  return db().transaction(async (tx) => {
    if (o.copied) await tx.execute(sql`set local session_replication_role = replica`);
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, copied_from, delivered_at, delivered_source)
      values (${store}::uuid, ${`${o.copied ? "C-" : ""}au${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${o.email}, 'paid'::commerce.order_status, 10000, 0, 0, 2000, 10000,
        '{}'::jsonb, '{"name":"Ola"}'::jsonb, ${o.at.toISOString()}::timestamptz, ${o.copied ? sql`gen_random_uuid()` : sql`null`},
        ${o.delivered ? o.delivered.toISOString() : null}::timestamptz, ${o.delivered ? "staff" : null})
      returning id
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_au${run}_${n}`}, 10000, 'NOK', 'captured')
    `);
    return String(row.id);
  });
}

async function store() {
  const s = await storeById(storeId);
  if (!s) throw new Error("no store");
  return s;
}

async function switchOn(kind: "welcome" | "after_purchase" | "win_back", delayDays: number, on = storeId) {
  const s = await storeById(on);
  if (!s) throw new Error("no store");
  const saved = await au.saveAutomation(s, owner, kind, { delayDays, content: words(kind) });
  if (!saved.ok) throw new Error(saved.problem);
  const switched = await au.switchAutomation(s, owner, kind, true);
  if (!switched.ok) throw new Error(switched.problem);
}

const sends = (kind: string) =>
  db().execute<Row>(sql`
    select x.key, m.email from commerce.automation_sends x join commerce.marketing_subscribers m on m.store_id = x.store_id and m.id = x.subscriber_id
    where x.store_id = ${storeId}::uuid and x.kind = ${kind} order by x.created_at
  `);

beforeAll(async () => {
  storeId = await makeStore("au");
  otherId = await makeStore("au-other");
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("settings", () => {
  it("start from hand-written words and switch on only with words it can send", async () => {
    const before = await au.getAutomations(await store());
    expect(before.welcome.saved).toBe(false);
    expect(before.welcome.content?.["nb-NO"]?.subject).toBe("Velkommen");
    expect(before.back_in_stock.content).toBeNull();
    expect(await au.switchAutomation(await store(), owner, "win_back", true)).toEqual({ ok: false, problem: "Save its words first." });
    expect((await au.saveAutomation(await store(), owner, "win_back", { delayDays: 5, content: words("x") })).ok).toBe(false);
  });
});

describe("welcome", () => {
  it("goes once to someone who joined after it was switched on, never to one before, pending or unsubscribed", async () => {
    const early = `early-${run}@example.com`;
    await subscriber(storeId, early, "subscribed", new Date(Date.now() - 3_600_000));
    await switchOn("welcome", 0);
    const late = `late-${run}@example.com`;
    await subscriber(storeId, late, "subscribed", new Date(Date.now() + 1000));
    await subscriber(storeId, `pending-${run}@example.com`, "pending", new Date(Date.now() + 1000));
    await subscriber(storeId, `gone-${run}@example.com`, "unsubscribed", new Date(Date.now() + 1000));

    const first = await au.runAutomations({ only: storeId, now: new Date(Date.now() + 5000) });
    expect(first.sent).toBe(1);
    expect((await sends("welcome")).map((r) => r.email)).toEqual([late]);
    const [email] = await db().execute<Row>(sql`select kind, status, html from commerce.email_messages where idempotency_key = ${`automation:${storeId}:${String((await sends("welcome"))[0].key)}`}`);
    expect(email.kind).toBe("marketing.automation");
    expect(String(email.html)).toContain("/unsubscribe/");

    const second = await au.runAutomations({ only: storeId, now: new Date(Date.now() + 6000) });
    expect(second.sent).toBe(0);
  });
});

describe("after a purchase", () => {
  it("goes once per delivered paid order to a subscribed address, never for a copied order or an address not on the list", async () => {
    await switchOn("after_purchase", 1);
    const buyer = `buyer-${run}@example.com`;
    await subscriber(storeId, buyer, "subscribed", new Date(Date.now() - 2 * DAY));
    const soon = new Date(Date.now() + 1000);
    const real = await order(storeId, { email: buyer, at: new Date(Date.now() - DAY), delivered: soon });
    await order(storeId, { email: buyer, at: new Date(Date.now() - DAY), delivered: soon, copied: true });
    await order(storeId, { email: `stranger-${run}@example.com`, at: new Date(Date.now() - DAY), delivered: soon });

    // Not a day after delivery yet.
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 3_600_000) });
    expect(await sends("after_purchase")).toHaveLength(0);
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2 * DAY) });
    expect((await sends("after_purchase")).map((r) => r.key)).toEqual([`after_purchase:${real}`]);
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2 * DAY + 1000) });
    expect(await sends("after_purchase")).toHaveLength(1);
  });
});

describe("win-back", () => {
  it("goes after the lapse, and again only after a new order lapses", async () => {
    await switchOn("win_back", 30);
    const lapsed = `lapsed-${run}@example.com`;
    await subscriber(storeId, lapsed, "subscribed", new Date(Date.now() - 60 * DAY));
    const first = await order(storeId, { email: lapsed, at: new Date(Date.now() - 29 * DAY) });

    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 2 * DAY) });
    const once = (await sends("win_back")).filter((r) => r.email === lapsed);
    expect(once.map((r) => r.key)).toEqual([expect.stringMatching(new RegExp(`:${first}$`))]);
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 3 * DAY) });
    expect((await sends("win_back")).filter((r) => r.email === lapsed)).toHaveLength(1);

    const next = await order(storeId, { email: lapsed, at: new Date(Date.now() - 25 * DAY) });
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 4 * DAY) });
    expect((await sends("win_back")).filter((r) => r.email === lapsed)).toHaveLength(1);
    await au.runAutomations({ only: storeId, now: new Date(Date.now() + 6 * DAY) });
    const twice = (await sends("win_back")).filter((r) => r.email === lapsed);
    expect(twice.map((r) => String(r.key).split(":").pop())).toEqual([first, next]);
  });
});

describe("a store that is not open", () => {
  it("sends nothing", async () => {
    const other = await storeById(otherId);
    if (!other) throw new Error("no store");
    await switchOn("welcome", 0, otherId);
    await subscriber(otherId, `other-${run}@example.com`, "subscribed", new Date(Date.now() + 1000));
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${otherId}::uuid`);
    const result = await au.runAutomations({ only: otherId, now: new Date(Date.now() + 5000) });
    expect(result.sent).toBe(0);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${otherId}::uuid`);
  });
});

describe("back in stock", () => {
  let variant: string;
  const visitor = `v-${run}`;

  beforeAll(async () => {
    const [v] = await db().execute<Row>(sql`
      select v.id from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and v.stock_policy = 'deny' and p.status = 'active'
        and p.kind = 'goods' and p.audience = 'all' and not p.subscription_only
        and exists (select 1 from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id)
      order by v.id limit 1
    `);
    variant = String(v.id);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${storeId}::uuid and variant_id = ${variant}::uuid`);
  });

  const ask = (email: string, customerId: string | null = null) =>
    stock.requestStock({ storeId, marketCode: "NO", locale: "nb-NO", variantId: variant, email, visitor, customerId });
  const statusOf = async (email: string) =>
    (await db().execute<Row>(sql`select status from commerce.stock_requests where store_id = ${storeId}::uuid and email = ${email}`)).map((r) => String(r.status));

  it("is refused while the store has it off", async () => {
    expect(await ask(`off-${run}@example.com`)).toBe("unavailable");
  });

  it("waits for a typed address's link, and a verified customer's at once", async () => {
    await au.switchAutomation(await store(), owner, "back_in_stock", true);
    const typed = `typed-${run}@example.com`;
    expect(await ask(typed)).toBe("check");
    expect(await statusOf(typed)).toEqual(["pending"]);
    // Asking again within the day sends no second link and says the same.
    expect(await ask(typed.toUpperCase())).toBe("check");
    const links = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'stock.confirm' and to_address = ${typed}`);
    expect(links).toHaveLength(1);
    const token = /\/account\/stock\/([A-Za-z0-9_-]{43})/.exec(String(links[0].html))?.[1] ?? "";
    expect(await stock.stockConfirmWaiting(storeId, token, "nb-NO")).toBeTruthy();
    expect(await stock.confirmStockRequest(storeId, token)).toBe(true);
    expect(await stock.confirmStockRequest(storeId, token)).toBe(false);
    expect(await statusOf(typed)).toEqual(["waiting"]);

    const verified = `verified-${run}@example.com`;
    const [c] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at) values (${storeId}::uuid, ${verified}, 'Kari', now()) returning id
    `);
    expect(await ask(verified, String(c.id))).toBe("waiting");
    // Someone signed in asking for another address proves nothing.
    expect(await ask(`someone-${run}@example.com`, String(c.id))).toBe("check");
  });

  it("stops a request from its email's link, or from the product page for the signed-in customer's own (D392)", async () => {
    const changed = `changed-${run}@example.com`;
    expect(await ask(changed)).toBe("check");
    const [mail] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'stock.confirm' and to_address = ${changed}`);
    const token = /\/account\/stock\/([A-Za-z0-9_-]{43})\?cancel=1/.exec(String(mail.html))?.[1] ?? "";
    expect(token).not.toBe("");
    // Confirmed first, it can still be stopped with the same link while it waits.
    expect(await stock.confirmStockRequest(storeId, token)).toBe(true);
    expect(await stock.stockCancelWaiting(storeId, token, "nb-NO")).toBeTruthy();
    expect(await stock.cancelStockRequest(storeId, token)).toBe(true);
    expect(await stock.cancelStockRequest(storeId, token)).toBe(false);
    expect(await stock.stockCancelWaiting(storeId, token, "nb-NO")).toBeNull();
    expect(await statusOf(changed)).toEqual(["cancelled"]);

    const mine = `mine-${run}@example.com`;
    const [me] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at) values (${storeId}::uuid, ${mine}, 'Ola', now()) returning id
    `);
    const [other] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at) values (${storeId}::uuid, ${`other-${run}@example.com`}, 'Per', now()) returning id
    `);
    expect(await ask(mine, String(me.id))).toBe("waiting");
    // Another signed-in customer cannot stop it.
    await stock.cancelOwnStockRequest(storeId, String(other.id), variant);
    expect(await statusOf(mine)).toEqual(["waiting"]);
    await stock.cancelOwnStockRequest(storeId, String(me.id), variant);
    expect(await statusOf(mine)).toEqual(["cancelled"]);
  });

  it("emails every waiting address once when stock is back, and never for another store", async () => {
    expect((await au.runAutomations({ only: storeId })).backInStock.sent).toBe(0);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 5 where store_id = ${storeId}::uuid and variant_id = ${variant}::uuid`);
    expect((await stock.runBackInStock({ only: otherId })).sent).toBe(0);
    const result = await au.runAutomations({ only: storeId });
    expect(result.backInStock.sent).toBe(2);
    expect(await statusOf(`typed-${run}@example.com`)).toEqual(["sent"]);
    const emails = await db().execute<Row>(sql`select to_address from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'stock.back_in_stock' order by to_address`);
    expect(emails.map((r) => r.to_address)).toEqual([`typed-${run}@example.com`, `verified-${run}@example.com`]);
    // The price as the shopper's market shows it now (D392).
    const [back] = await db().execute<Row>(sql`select text from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'stock.back_in_stock' and to_address = ${`verified-${run}@example.com`}`);
    expect(String(back.text)).toMatch(/Pris nå: .*kr/);
    expect((await au.runAutomations({ only: storeId })).backInStock.sent).toBe(0);
    // In stock now, so it cannot be asked for.
    expect(await ask(`instock-${run}@example.com`)).toBe("unavailable");
    // The pending one that never confirmed was not told.
    expect(await statusOf(`someone-${run}@example.com`)).toEqual(["pending"]);
  });
});

describe("erasure", () => {
  it("removes the person's sends and requests", async () => {
    const email = `late-${run}@example.com`;
    await db().execute(sql`
      insert into commerce.stock_requests (store_id, variant_id, product_id, email, locale, status)
      select store_id, id, product_id, ${email}, 'nb-NO', 'waiting' from commerce.product_variants where store_id = ${storeId}::uuid limit 1
    `);
    const erased = await eraseSubject(storeId, { email }, { channel: "staff", accountId: owner });
    expect(erased.ok).toBe(true);
    const [left] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.stock_requests where store_id = ${storeId}::uuid and email = ${email}) as requests,
        (select count(*)::int from commerce.automation_sends where store_id = ${storeId}::uuid and key like 'welcome:%') as welcomes
    `);
    expect(left).toEqual({ requests: 0, welcomes: 0 });
  });
});
