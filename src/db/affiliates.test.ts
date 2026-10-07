import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The store's affiliate program (D131): the rules that live in SQL, against every migration applied to a real
 * Postgres (PGlite). Who is whose friend, the guards, the reward when an order is paid and its reversal by refund or
 * cancellation, all through the bonus ledger, which stays whole with referral lots in it.
 */

let db: PGlite;
let shop: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country, features) values ('aff-shop', 'Aff', 'NO', '{shop,bonus,referrals}') returning id");
  shop = id;
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [shop, ["NO", "DE"]],
  );
  await db.query(
    `insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values ($1, 'NOK', 11.5, 1, 0), ($1, 'EUR', 1, 1, 1)`,
    [shop],
  );
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const n = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);

/** The bonus program (the reward's credits) and the affiliate program, on unless said. */
async function programs(over: { bonus?: boolean; affiliate?: boolean; bps?: number; orders?: number | null; percent?: number; cap?: number | null; pendingDays?: number; expires?: number | null } = {}) {
  await db.query(
    `insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, expires_months, currency)
     values ($1, $2, 500, $3, 50, $4, commerce.bonus_currency($1))
     on conflict (store_id) do update set enabled = excluded.enabled, pending_days = excluded.pending_days, expires_months = excluded.expires_months`,
    [shop, over.bonus ?? true, over.pendingDays ?? 14, over.expires ?? null],
  );
  await db.query(
    `insert into commerce.affiliate_settings (store_id, enabled, reward_bps, reward_orders, friend_percent, monthly_cap_minor)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (store_id) do update set enabled = excluded.enabled, reward_bps = excluded.reward_bps, reward_orders = excluded.reward_orders,
       friend_percent = excluded.friend_percent, monthly_cap_minor = excluded.monthly_cap_minor`,
    [shop, over.affiliate ?? true, over.bps ?? 500, over.orders === undefined ? 1 : over.orders, over.percent ?? 10, over.cap ?? null],
  );
}

async function customer(email?: string): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.customers (store_id, email, name) values ($1, $2, $3) returning id", [shop, email ?? `aff-${counter}@example.com`, `Name ${counter}`])).id;
}
const emailOf = async (id: string) => (await one<{ email: string }>("select email from commerce.customers where id = $1", [id])).email;

/** Deletes a customer as the store does (`deleteCustomer()`): their orders let go of them first. */
async function deleteCustomer(id: string) {
  await db.query("update commerce.orders set customer_id = null where customer_id = $1", [id]);
  await db.query("delete from commerce.customers where id = $1", [id]);
}

/** A customer with a referral link. */
async function affiliate(): Promise<{ id: string; code: string; email: string }> {
  const id = await customer();
  counter += 1;
  const code = `code${String(counter).padStart(4, "0")}ab`;
  await db.query("insert into commerce.affiliates (store_id, customer_id, code) values ($1, $2, $3)", [shop, id, code]);
  return { id, code, email: await emailOf(id) };
}

/** An order waiting for payment: one line of goods (and shipping on top), in NOK unless said. */
async function order(customerId: string | null, goods: number, over: { venue?: number; shipping?: number; currency?: string; email?: string } = {}) {
  counter += 1;
  const shipping = over.shipping ?? 0;
  const currency = over.currency ?? "NOK";
  const email = over.email ?? (customerId ? await emailOf(customerId) : `guest-${counter}@example.com`);
  const { id } = await one<{ id: string }>(
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id,
       subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
     values ($1, $2, $3, $4, 'nb-NO', $5, $6, $7, $8, 0, 0, $9, '{}', '{}') returning id`,
    [shop, `A-${counter}`, currency === "NOK" ? "NO" : "DE", currency, email, customerId, goods, shipping, goods + shipping],
  );
  await db.query(
    `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, venue_minor, delivery)
     values ($1, $2, 'SIGNUP-FEE', 'Thing', 1, $3, $3, 0, 0.25, 'txcd_99999999', $4, 'digital')`,
    [shop, id, goods, over.venue ?? 0],
  );
  return id;
}

const attribute = async (orderId: string, code: string | null, discount = 0) =>
  (await one<{ v: string }>("select commerce.affiliate_attribute_order($1, $2, $3) as v", [orderId, code, discount])).v;
const pay = async (orderId: string) => (await one<{ done: boolean }>("select commerce.complete_order_payment($1, 'cs') as done", [orderId])).done;
const attribution = async (orderId: string) => {
  const row = await one<{ status: string; reject_reason: string | null; reward_minor: string; discount_minor: string; affiliate_customer_id: string; friend_customer_id: string | null }>(
    "select status, reject_reason, reward_minor, discount_minor, affiliate_customer_id, friend_customer_id from commerce.affiliate_attributions where order_id = $1",
    [orderId],
  );
  return row && { ...row, reward_minor: Number(row.reward_minor), discount_minor: Number(row.discount_minor) };
};
const balance = (customerId: string) =>
  one<{ available_minor: string; pending_minor: string }>("select * from commerce.bonus_balance($1, $2)", [shop, customerId]).then((r) => ({ available: Number(r.available_minor), pending: Number(r.pending_minor) }));
const verified = async (customerId: string) => (await one<{ ok: boolean }>("select commerce.bonus_verify($1, $2) as ok", [shop, customerId])).ok;
const entries = async (customerId: string) =>
  (await db.query<{ kind: string; amount_minor: string; order_id: string | null }>("select kind, amount_minor, order_id from commerce.bonus_entries where customer_id = $1 order by created_at, amount_minor desc", [customerId])).rows.map((r) => ({
    kind: r.kind,
    amount: Number(r.amount_minor),
    orderId: r.order_id,
  }));
const resolve = async (customerId: string | null, code: string | null, except: string | null = null) =>
  one<{ affiliate_customer_id: string | null; verdict: string; welcome: boolean }>("select * from commerce.affiliate_resolve($1, $2, $3, $4)", [shop, customerId, code, except]);

/** Moves a customer's whole ledger back in time, so credits pending for 14 days have passed (the ledger is immutable, but a test may pull the trigger). */
async function ageBonus(customerId: string, days: number) {
  await db.exec("alter table commerce.bonus_entries disable trigger bonus_entries_immutable");
  await db.query(
    `update commerce.bonus_entries set created_at = created_at - make_interval(days => $2), available_at = available_at - make_interval(days => $2),
       expires_at = expires_at - make_interval(days => $2) where customer_id = $1`,
    [customerId, days],
  );
  await db.exec("alter table commerce.bonus_entries enable trigger bonus_entries_immutable");
}

async function payment(orderId: string, amount: number): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, $4, 'NOK', 'captured') returning id",
      [shop, orderId, `cs_aff_${counter}`, amount],
    )
  ).id;
}
const refund = (paymentId: string, amount: number, status = "succeeded") =>
  db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, $3, 'test', $4::commerce.refund_status)", [shop, paymentId, amount, status]);

/** Makes an order a copy of another store's (D129) behind the triggers' back (they refuse it), as a copy's history would be. */
async function makeCopy(orderId: string) {
  await db.exec("set session_replication_role = replica");
  await db.query("update commerce.orders set copied_from = id, number = 'C-' || number where id = $1", [orderId]);
  await db.exec("set session_replication_role = origin");
}

/** A friend's first order through a referrer's link, paid: what the referrer has, the order and the friend. */
async function friendOrders(ref: { id: string; code: string }, goods: number, over: { venue?: number; shipping?: number; discount?: number } = {}) {
  const friend = await customer();
  const o = await order(friend, goods, over);
  await attribute(o, ref.code, over.discount ?? 0);
  await pay(o);
  return { friend, o };
}

describe("the affiliate program's tables", () => {
  it("has row level security on, and no direct way in for the public", async () => {
    for (const table of ["affiliate_settings", "affiliates", "affiliate_attributions", "referral_visits"]) {
      const row = await one<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = $1", [table]);
      expect(row.relrowsecurity, table).toBe(true);
    }
  });

  it("keeps a code to a customer, in the store's own format, unique in the store", async () => {
    await programs();
    const c = await customer();
    await expect(db.query("insert into commerce.affiliates (store_id, customer_id, code) values ($1, $2, 'ABC')", [shop, c])).rejects.toThrow();
    const a = await affiliate();
    await expect(db.query("insert into commerce.affiliates (store_id, customer_id, code) values ($1, $2, $3)", [shop, c, a.code])).rejects.toThrow();
    await expect(db.query("insert into commerce.affiliates (store_id, customer_id, code) values ($1, $2, 'other234')", [shop, a.id])).rejects.toThrow();
  });

  it("ties a customer to a referrer who is an affiliate of the store, once, never themselves", async () => {
    await programs();
    const a = await affiliate();
    const c = await customer();
    const plain = await customer();
    await expect(db.query("update commerce.customers set referred_by_customer_id = $2 where id = $1", [c, plain])).rejects.toThrow("affiliate.unknown");
    await expect(db.query("update commerce.customers set referred_by_customer_id = id where id = $1", [a.id])).rejects.toThrow("affiliate.self");
    await db.query("update commerce.customers set referred_by_customer_id = $2 where id = $1", [c, a.id]);
    const b = await affiliate();
    await expect(db.query("update commerce.customers set referred_by_customer_id = $2 where id = $1", [c, b.id])).rejects.toThrow("affiliate.moved");
    // The referrer leaving the store lets their friends go free.
    await deleteCustomer(a.id);
    expect((await one<{ r: string | null }>("select referred_by_customer_id as r from commerce.customers where id = $1", [c])).r).toBeNull();
  });
});

describe("whose friend an order is", () => {
  it("says off while either program is off, and none for a code nobody has", async () => {
    await programs({ affiliate: false });
    const a = await affiliate();
    const c = await customer();
    expect((await resolve(c, a.code)).verdict).toBe("off");
    await programs({ bonus: false });
    expect((await resolve(c, a.code)).verdict).toBe("off");
    expect(await one<{ on: boolean }>("select commerce.affiliate_program_on($1) as on", [shop])).toEqual({ on: false });
    await programs();
    expect((await resolve(c, "nosuchcode")).verdict).toBe("none");
    expect((await resolve(c, null)).verdict).toBe("none");
  });

  it("gives a first-order friend the welcome, a guest nothing but the nudge, and never the referrer themselves", async () => {
    await programs();
    const a = await affiliate();
    const c = await customer();
    expect(await resolve(c, a.code)).toMatchObject({ verdict: "ok", welcome: true, affiliate_customer_id: a.id });
    expect(await resolve(null, a.code)).toMatchObject({ verdict: "guest", welcome: false });
    expect(await resolve(a.id, a.code)).toMatchObject({ verdict: "self", welcome: false });
  });

  it("refuses a blocked referrer, and a friend who has ordered before", async () => {
    await programs();
    const a = await affiliate();
    const c = await customer();
    await db.query("update commerce.affiliates set blocked_at = now(), blocked_reason = 'abuse' where customer_id = $1", [a.id]);
    expect((await resolve(c, a.code)).verdict).toBe("blocked");
    await db.query("update commerce.affiliates set blocked_at = null where customer_id = $1", [a.id]);
    // An order paid, fulfilled or closed is an earlier order; one only waiting for payment is not; a guest purchase by the same email counts.
    const earlier = await order(c, 5_000);
    expect((await resolve(c, a.code)).welcome).toBe(true);
    await pay(earlier);
    expect(await resolve(c, a.code)).toMatchObject({ verdict: "not_new", welcome: false });
    const d = await customer();
    const guest = await order(null, 5_000, { email: await emailOf(d) });
    await pay(guest);
    expect((await resolve(d, a.code)).verdict).toBe("not_new");
    // The order being placed is not an earlier one.
    const e = await customer();
    const own = await order(e, 5_000);
    await pay(own);
    expect((await resolve(e, a.code, own)).welcome).toBe(true);
  });

  it("counts a paid order that was cancelled since, and so cannot be bought new twice", async () => {
    await programs();
    const a = await affiliate();
    const c = await customer();
    const o = await order(c, 5_000);
    await pay(o);
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o]);
    expect((await resolve(c, a.code)).verdict).toBe("not_new");
  });

  it("follows the referrer a friend registered through for later orders, and stops at the store's limit of rewarded orders", async () => {
    await programs({ orders: 2 });
    const a = await affiliate();
    const b = await affiliate();
    const { friend } = await friendOrders(a, 10_000);
    // The first reward made them a's friend: their next orders count for a whatever link is in their cart.
    expect((await one<{ r: string }>("select referred_by_customer_id as r from commerce.customers where id = $1", [friend])).r).toBe(a.id);
    expect(await resolve(friend, b.code)).toMatchObject({ verdict: "ok", welcome: false, affiliate_customer_id: a.id });
    expect(await resolve(friend, null)).toMatchObject({ verdict: "ok", welcome: false, affiliate_customer_id: a.id });
    const second = await order(friend, 10_000);
    expect(await attribute(second, null)).toBe("ok");
    await pay(second);
    expect((await attribution(second)).status).toBe("rewarded");
    // Two orders have earned: the third does not, and is not even attributed.
    expect((await resolve(friend, null)).verdict).toBe("limit");
    const third = await order(friend, 10_000);
    expect(await attribute(third, null)).toBe("limit");
    expect(await attribution(third)).toBeUndefined();
  });
});

describe("attributing an order", () => {
  it("records one row per order, with the discount it was given", async () => {
    await programs();
    const a = await affiliate();
    const c = await customer();
    const o = await order(c, 10_000);
    expect(await attribute(o, a.code, 1_000)).toBe("ok");
    expect(await attribution(o)).toMatchObject({ status: "pending", discount_minor: 1000, reward_minor: 0, affiliate_customer_id: a.id, friend_customer_id: c });
    // Again: nothing more, nothing changed.
    await attribute(o, a.code, 5);
    expect(await n("select count(*) as n from commerce.affiliate_attributions where order_id = $1", [o])).toBe(1);
    expect((await attribution(o)).discount_minor).toBe(1000);
  });

  it("records a guard that stops the reward as a rejected row, with no discount kept", async () => {
    await programs();
    const a = await affiliate();
    const self = await order(a.id, 10_000);
    expect(await attribute(self, a.code, 1_000)).toBe("self");
    expect(await attribution(self)).toMatchObject({ status: "rejected", reject_reason: "self", discount_minor: 0 });
    const old = await customer();
    await pay(await order(old, 1_000));
    const again = await order(old, 10_000);
    expect(await attribute(again, a.code, 1_000)).toBe("not_new");
    expect(await attribution(again)).toMatchObject({ status: "rejected", reject_reason: "not_new", discount_minor: 0 });
    await db.query("update commerce.affiliates set blocked_at = now() where customer_id = $1", [a.id]);
    const c = await customer();
    const blocked = await order(c, 10_000);
    expect(await attribute(blocked, a.code)).toBe("blocked");
    expect(await attribution(blocked)).toMatchObject({ status: "rejected", reject_reason: "blocked" });
  });

  it("records nothing for a guest, a program that is off, a copied order or a host's", async () => {
    await programs();
    const a = await affiliate();
    const guest = await order(null, 10_000);
    expect(await attribute(guest, a.code)).toBe("none");
    const c = await customer();
    const copied = await order(c, 10_000);
    await makeCopy(copied);
    expect(await attribute(copied, a.code)).toBe("none");
    const hostAccount = (await one<{ id: string }>("insert into commerce.accounts (email) values ($1) returning id", [`aff-host-${++counter}@example.com`])).id;
    const hostId = (await one<{ id: string }>("insert into commerce.hosts (store_id, account_id, name) values ($1, $2, 'Host') returning id", [shop, hostAccount])).id;
    const hosted = await order(c, 10_000);
    await db.query("update commerce.orders set host_id = $2 where id = $1", [hosted, hostId]);
    expect(await attribute(hosted, a.code)).toBe("none");
    await programs({ affiliate: false });
    const off = await order(await customer(), 10_000);
    expect(await attribute(off, a.code)).toBe("off");
    expect(await n("select count(*) as n from commerce.affiliate_attributions where order_id = any($1)", [[guest, copied, hosted, off]])).toBe(0);
    await programs();
  });

  it("refuses by itself what the database must never hold: the referrer as a friend who earns, a copied or host's order", async () => {
    await programs();
    const a = await affiliate();
    const self = await order(a.id, 1_000);
    await expect(
      db.query("insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, friend_customer_id, code) values ($1, $2, $3, $3, $4)", [shop, self, a.id, a.code]),
    ).rejects.toThrow("affiliate.self");
    const c = await customer();
    const o = await order(c, 1_000);
    // The friend must be the order's customer.
    await expect(
      db.query("insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, friend_customer_id, code) values ($1, $2, $3, $4, $5)", [shop, o, a.id, a.id, a.code]),
    ).rejects.toThrow();
    const copied = await order(c, 1_000);
    await makeCopy(copied);
    await expect(
      db.query("insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, friend_customer_id, code) values ($1, $2, $3, $4, $5)", [shop, copied, a.id, c, a.code]),
    ).rejects.toThrow("affiliate.not_attributable");
  });

  it("keeps a row append-only: who, which order and the discount never change, and a settled row stays settled", async () => {
    await programs();
    const a = await affiliate();
    const { o } = await friendOrders(a, 10_000, { discount: 1_000 });
    await expect(db.query("update commerce.affiliate_attributions set discount_minor = 0 where order_id = $1", [o])).rejects.toThrow("append-only");
    await expect(db.query("update commerce.affiliate_attributions set code = 'changed23' where order_id = $1", [o])).rejects.toThrow("append-only");
    await expect(db.query("update commerce.affiliate_attributions set status = 'pending' where order_id = $1", [o])).rejects.toThrow("affiliate.settled");
    await expect(db.query("update commerce.affiliate_attributions set reward_minor = 1 where order_id = $1", [o])).rejects.toThrow("affiliate.settled");
    await expect(db.query("delete from commerce.affiliate_attributions where order_id = $1", [o])).rejects.toThrow("append-only");
    // The friend's account going away leaves the row, without them; the referrer's takes their rows with it.
    const { friend, o: o2 } = await friendOrders(await affiliate(), 10_000);
    await deleteCustomer(friend);
    expect((await attribution(o2)).friend_customer_id).toBeNull();
    const b = await affiliate();
    const { o: o3 } = await friendOrders(b, 10_000);
    await deleteCustomer(b.id);
    expect(await attribution(o3)).toBeUndefined();
  });
});

describe("the reward when an order is paid", () => {
  it("grants the referrer the share of what was paid online for goods, as a pending referral lot, once", async () => {
    await programs({ bps: 500, pendingDays: 14 });
    const a = await affiliate();
    const friend = await customer();
    // 1 000 of goods, 99 of shipping, 300 of the goods left for the venue: 5 % of 700.
    const o = await order(friend, 1_000, { shipping: 99, venue: 300 });
    await attribute(o, a.code, 0);
    expect(await pay(o)).toBe(true);
    expect(await attribution(o)).toMatchObject({ status: "rewarded", reward_minor: 35 });
    expect(await entries(a.id)).toEqual([{ kind: "referral", amount: 35, orderId: null }]);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 35 });
    const lot = await one<{ available_at: Date; key: string }>("select available_at, idempotency_key as key from commerce.bonus_entries where customer_id = $1", [a.id]);
    expect(lot.key).toBe(`referral:${o}`);
    expect(lot.available_at.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    // Paid again: nothing more.
    expect(await pay(o)).toBe(false);
    expect(await entries(a.id)).toHaveLength(1);
    expect(await verified(a.id)).toBe(true);
    // The friend's own credits are the bonus program's: 5 % of what they paid, apart from the referrer's.
    expect((await entries(friend)).map((e) => e.kind)).toEqual(["earn"]);
  });

  it("counts what the friend paid after the discount they were given", async () => {
    await programs({ bps: 500, pendingDays: 0 });
    const a = await affiliate();
    // Goods of 10 000 less a welcome discount of 1 000: the order's line total is 9 000.
    const { o } = await friendOrders(a, 9_000, { discount: 1_000 });
    expect((await attribution(o)).reward_minor).toBe(450);
    expect(await balance(a.id)).toEqual({ available: 450, pending: 0 });
  });

  it("converts what was paid in another currency into the credits' currency, rounded down", async () => {
    await programs({ bps: 500 });
    const a = await affiliate();
    const friend = await customer();
    // 100.00 EUR of goods: 5 % is 5.00 EUR, which is 57.50 NOK at 11.5 (5 750 øre).
    const o = await order(friend, 10_000, { currency: "EUR" });
    await attribute(o, a.code);
    await pay(o);
    expect((await attribution(o)).reward_minor).toBe(5750);
  });

  it("makes the credits usable after the wait, like any others, and never lets a balance go below zero", async () => {
    await programs({ bps: 1_000, pendingDays: 14 });
    const a = await affiliate();
    await friendOrders(a, 10_000);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 1_000 });
    const use = await order(a.id, 20_000);
    await expect(db.query("select commerce.bonus_redeem($1, $2, $3, 1, $4)", [shop, a.id, use, `redeem:${use}`])).rejects.toThrow("bonus.insufficient");
    await ageBonus(a.id, 14);
    expect(await balance(a.id)).toEqual({ available: 1_000, pending: 0 });
    await db.query("select commerce.bonus_redeem($1, $2, $3, 400, $4)", [shop, a.id, use, `redeem:${use}`]);
    expect(await balance(a.id)).toEqual({ available: 600, pending: 0 });
    await expect(db.query("select commerce.bonus_redeem($1, $2, $3, 601, $4)", [shop, a.id, await order(a.id, 1_000), "redeem:x"])).rejects.toThrow("bonus.insufficient");
    expect(await verified(a.id)).toBe(true);
  });

  it("expires referral credits as the bonus program's settings say, and writes them off like the others", async () => {
    await programs({ bps: 1_000, pendingDays: 0, expires: 1 });
    const a = await affiliate();
    await friendOrders(a, 10_000);
    expect(await balance(a.id)).toEqual({ available: 1_000, pending: 0 });
    const lot = await one<{ expires_at: Date | null }>("select expires_at from commerce.bonus_entries where customer_id = $1", [a.id]);
    expect(lot.expires_at).not.toBeNull();
    await ageBonus(a.id, 40);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 0 });
    expect(await n("select commerce.bonus_expire_due() as n")).toBeGreaterThanOrEqual(1);
    expect((await entries(a.id)).map((e) => e.kind)).toEqual(["referral", "expire"]);
    expect(await verified(a.id)).toBe(true);
    await programs();
  });

  it("does not reward a guard that applies when it is paid: a blocked referrer, the referrer's own email; the program off is no such guard", async () => {
    await programs();
    const a = await affiliate();
    // Switched off between placing and paying, by its own switch or its store feature (D178): the order was attributed while the program
    // was on, so its reward is still given when it is paid.
    const c1 = await customer();
    const o1 = await order(c1, 10_000);
    await attribute(o1, a.code);
    await programs({ affiliate: false });
    await pay(o1);
    expect(await attribution(o1)).toMatchObject({ status: "rewarded" });
    await programs();
    const c0 = await customer();
    const o0 = await order(c0, 10_000);
    await attribute(o0, a.code);
    await db.query("update commerce.stores set features = '{shop,bonus}' where id = $1", [shop]);
    // A new order while it is off is not attributed at all.
    const late = await order(await customer(), 10_000);
    expect(await attribute(late, a.code)).toBe("off");
    await pay(o0);
    expect(await attribution(o0)).toMatchObject({ status: "rewarded" });
    expect(await attribution(late)).toBeUndefined();
    await db.query("update commerce.stores set features = '{shop,bonus,referrals}' where id = $1", [shop]);
    // Blocked meanwhile.
    const c2 = await customer();
    const o2 = await order(c2, 10_000);
    await attribute(o2, a.code);
    await db.query("update commerce.affiliates set blocked_at = now() where customer_id = $1", [a.id]);
    await pay(o2);
    expect(await attribution(o2)).toMatchObject({ status: "rejected", reject_reason: "blocked" });
    await db.query("update commerce.affiliates set blocked_at = null where customer_id = $1", [a.id]);
    // The friend pays with the referrer's own email.
    const c3 = await customer();
    const o3 = await order(c3, 10_000, { email: a.email.toUpperCase() });
    await attribute(o3, a.code);
    await pay(o3);
    expect(await attribution(o3)).toMatchObject({ status: "rejected", reject_reason: "self" });
    // The two orders placed while the program was on, and nothing else.
    expect(await entries(a.id)).toHaveLength(2);
  });

  it("does not reward a friend who paid another order first, even when both were placed as first orders", async () => {
    await programs({ pendingDays: 0 });
    const a = await affiliate();
    const friend = await customer();
    const first = await order(friend, 10_000);
    const second = await order(friend, 10_000);
    await attribute(first, a.code, 1_000);
    await attribute(second, a.code, 1_000);
    await pay(first);
    await pay(second);
    expect(await attribution(first)).toMatchObject({ status: "rewarded" });
    // The second is the friend's too (referred by the first's reward), but the limit of one rewarded order is reached.
    expect(await attribution(second)).toMatchObject({ status: "rejected", reject_reason: "limit" });
    expect(await entries(a.id)).toHaveLength(1);
  });

  it("rewards only as many of the friend's orders as the store says, or every one", async () => {
    await programs({ orders: 1, pendingDays: 0 });
    const a = await affiliate();
    const { friend } = await friendOrders(a, 10_000);
    const second = await order(friend, 10_000);
    expect(await attribute(second, null)).toBe("limit");
    await programs({ orders: null, pendingDays: 0 });
    const third = await order(friend, 10_000);
    expect(await attribute(third, null)).toBe("ok");
    await pay(third);
    expect((await attribution(third)).status).toBe("rewarded");
    await programs({ pendingDays: 0 });
  });

  it("stops at the monthly limit per referrer: less is given when little is left, and nothing, recorded as the limit, after", async () => {
    await programs({ bps: 1_000, cap: 1_500, pendingDays: 0 });
    const a = await affiliate();
    const one1 = await friendOrders(a, 10_000);
    expect((await attribution(one1.o)).reward_minor).toBe(1000);
    const two = await friendOrders(a, 10_000);
    // 500 of the 1 500 are left.
    expect(await attribution(two.o)).toMatchObject({ status: "rewarded", reward_minor: 500 });
    const three = await friendOrders(a, 10_000);
    expect(await attribution(three.o)).toMatchObject({ status: "rejected", reject_reason: "cap", reward_minor: 0 });
    expect(await balance(a.id)).toEqual({ available: 1_500, pending: 0 });
    // Another referrer has their own limit, and last month's rewards do not count this month.
    const b = await affiliate();
    expect((await attribution((await friendOrders(b, 10_000)).o)).reward_minor).toBe(1000);
    await db.exec("alter table commerce.affiliate_attributions disable trigger affiliate_attributions_guard");
    await db.query("update commerce.affiliate_attributions set rewarded_at = rewarded_at - interval '40 days' where affiliate_customer_id = $1", [a.id]);
    await db.exec("alter table commerce.affiliate_attributions enable trigger affiliate_attributions_guard");
    expect((await attribution((await friendOrders(a, 10_000)).o)).reward_minor).toBe(1000);
    await programs();
  });

  it("gives nothing for an order that earns nothing, and never for a copied order", async () => {
    await programs({ bps: 500 });
    const a = await affiliate();
    const c = await customer();
    const tiny = await order(c, 10);
    await attribute(tiny, a.code);
    await pay(tiny);
    expect(await attribution(tiny)).toMatchObject({ status: "rejected", reject_reason: "zero" });
    // A copied order that is paid (history) does nothing.
    const d = await customer();
    const copied = await order(d, 10_000);
    await attribute(copied, a.code);
    await makeCopy(copied);
    // Whatever calls it, nothing is earned; and it cannot be paid either, the copy's rules refuse.
    await db.query("select commerce.affiliate_order_paid($1)", [copied]);
    await expect(pay(copied)).rejects.toThrow("copied_order");
    expect((await attribution(copied))?.status).toBe("pending");
    expect(await entries(a.id)).toEqual([]);
  });
});

describe("taking the reward back", () => {
  it("takes back the refunded share, adding up exactly however the refunds are cut, and marks it reversed at the end", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const a = await affiliate();
    const { o } = await friendOrders(a, 9_000);
    expect(await balance(a.id)).toEqual({ available: 900, pending: 0 });
    const paymentId = await payment(o, 9_000);
    // A third refunded: a third of the 900 goes.
    await refund(paymentId, 3_000);
    expect(await balance(a.id)).toEqual({ available: 600, pending: 0 });
    expect((await attribution(o)).status).toBe("rewarded");
    // A failed refund changes nothing.
    await refund(paymentId, 1_000, "failed");
    expect(await balance(a.id)).toEqual({ available: 600, pending: 0 });
    await refund(paymentId, 3_000);
    await refund(paymentId, 3_000);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 0 });
    expect((await attribution(o)).status).toBe("reversed");
    const taken = (await entries(a.id)).filter((e) => e.kind === "reverse").reduce((sum, e) => sum + e.amount, 0);
    expect(taken).toBe(-900);
    expect(await verified(a.id)).toBe(true);
  });

  it("does not disturb what the friend's own refund does to the friend's credits", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const a = await affiliate();
    const { friend, o } = await friendOrders(a, 10_000);
    // The friend earned 5 % of the 10 000 they paid, the referrer 10 % of it.
    expect(await balance(friend)).toEqual({ available: 500, pending: 0 });
    await refund(await payment(o, 10_000), 5_000);
    // Half of each earned amount is taken back, the friend's and the referrer's, each from its own ledger.
    expect(await balance(friend)).toEqual({ available: 250, pending: 0 });
    expect(await balance(a.id)).toEqual({ available: 500, pending: 0 });
    expect(await verified(friend)).toBe(true);
    expect(await verified(a.id)).toBe(true);
  });

  it("never takes back what the referrer has already spent, and never goes below zero", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const a = await affiliate();
    const { o } = await friendOrders(a, 10_000);
    const spend = await order(a.id, 20_000);
    await db.query("select commerce.bonus_redeem($1, $2, $3, 700, $4)", [shop, a.id, spend, `redeem:${spend}`]);
    expect(await balance(a.id)).toEqual({ available: 300, pending: 0 });
    await refund(await payment(o, 10_000), 10_000);
    // 1 000 earned, 700 spent: only the 300 left can be taken; what was used stays used.
    expect(await balance(a.id)).toEqual({ available: 0, pending: 0 });
    expect((await attribution(o)).status).toBe("reversed");
    expect(await verified(a.id)).toBe(true);
  });

  it("takes back what is left when a paid order is cancelled, once", async () => {
    await programs({ bps: 1_000, pendingDays: 14 });
    const a = await affiliate();
    const { o } = await friendOrders(a, 10_000);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 1_000 });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [o]);
    expect(await balance(a.id)).toEqual({ available: 0, pending: 0 });
    expect((await attribution(o)).status).toBe("reversed");
    expect((await entries(a.id)).map((e) => e.kind)).toEqual(["referral", "reverse"]);
    // A cancel after a full refund takes nothing twice.
    expect((await entries(a.id)).length).toBe(2);
    expect(await verified(a.id)).toBe(true);
  });

  it("leaves an unpaid order's attribution waiting, and rewards it if the payment comes after all", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const a = await affiliate();
    const friend = await customer();
    const o = await order(friend, 10_000);
    await attribute(o, a.code);
    await db.query("select commerce.cancel_unpaid_order($1, 'expired')", [o]);
    expect((await attribution(o)).status).toBe("pending");
    expect(await entries(a.id)).toEqual([]);
    expect(await pay(o)).toBe(true);
    expect((await attribution(o)).status).toBe("rewarded");
    expect(await balance(a.id)).toEqual({ available: 1_000, pending: 0 });
  });

  it("is idempotent: the same key grants and takes back once", async () => {
    await programs({ bps: 1_000, pendingDays: 0 });
    const a = await affiliate();
    const { o } = await friendOrders(a, 10_000);
    await db.query("select commerce.affiliate_order_paid($1)", [o]);
    await db.query("select commerce.affiliate_order_paid($1)", [o]);
    expect(await entries(a.id)).toHaveLength(1);
    const paymentId = await payment(o, 10_000);
    await refund(paymentId, 10_000);
    const [{ id: refundId }] = (await db.query<{ id: string }>("select id from commerce.refunds where payment_id = $1", [paymentId])).rows;
    await db.query("select commerce.affiliate_refund_applied($1)", [refundId]);
    await db.query("select commerce.affiliate_refund_applied($1)", [refundId]);
    expect((await entries(a.id)).filter((e) => e.kind === "reverse")).toHaveLength(1);
  });
});

describe("a link's visits", () => {
  it("counts a live code by day, and leaves no trace for any other", async () => {
    await programs();
    const a = await affiliate();
    const count = (code: string) => one<{ v: boolean }>("select commerce.affiliate_count_visit($1, $2) as v", [shop, code]);
    expect((await count(a.code)).v).toBe(true);
    expect((await count(a.code)).v).toBe(true);
    expect((await count("madeup234")).v).toBe(false);
    expect(await n("select coalesce(sum(visits), 0) as n from commerce.referral_visits where store_id = $1 and code = $2", [shop, a.code])).toBe(2);
    expect(await n("select count(*) as n from commerce.referral_visits where code = 'madeup234'")).toBe(0);
    await db.query("update commerce.affiliates set blocked_at = now() where customer_id = $1", [a.id]);
    expect((await count(a.code)).v).toBe(false);
    await programs({ affiliate: false });
    const b = await affiliate();
    expect((await count(b.code)).v).toBe(false);
    await programs();
  });
});

describe("copying a store", () => {
  it("copies the program's settings and nothing of its customers' links or earnings", async () => {
    await programs({ bps: 700, percent: 12, cap: 9_000, orders: 3 });
    const a = await affiliate();
    await friendOrders(a, 10_000);
    const owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ($1) returning id", [`aff-owner-${++counter}@example.com`])).id;
    const { id: copy } = await one<{ id: string }>("select commerce.duplicate_store($1, $2, 'Copy', $3) as id", [shop, `aff-copy-${counter}`, owner]);
    const row = await one<{ enabled: boolean; reward_bps: number; friend_percent: number; monthly_cap_minor: number; reward_orders: number }>(
      "select enabled, reward_bps, friend_percent, monthly_cap_minor, reward_orders from commerce.affiliate_settings where store_id = $1",
      [copy],
    );
    expect(row).toMatchObject({ enabled: true, reward_bps: 700, friend_percent: 12, monthly_cap_minor: 9000, reward_orders: 3 });
    expect(await n("select count(*) as n from commerce.affiliates where store_id = $1", [copy])).toBe(0);
    expect(await n("select count(*) as n from commerce.affiliate_attributions where store_id = $1", [copy])).toBe(0);
    await programs();
  });
});
