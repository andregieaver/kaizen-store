import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined, cacheTag: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));

const creators = await import("./creators");
const { validAffiliateCode, captureAffiliate } = await import("./affiliates");

/**
 * Creators on a real database (wave 11 unit G, D386): applying, approving, the code a visitor arrives with, the commission a paid order
 * earns (goods without VAT, a category's own rate, in the order's own currency, a euro case), what refunds and a cancellation take back,
 * the creator's own order, copied orders, payouts never above what is owed, the creator's page naming no buyer, and erasure.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Account;
let staff: Account;
let goodsVariant: string;
let otherVariant: string;
let giftVariant: string | null = null;
let categoryId: string;
let counter = 0;

const account = async (role: "owner" | "admin", label: string): Promise<Account> => {
  const email = `${label}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`);
  const id = String(row.id);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${id}::uuid, ${role})`);
  return { id, email, name: label, platformAdmin: false };
};

const customer = async (label: string, verified = true) => {
  counter += 1;
  const email = `${label}${counter}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, email_verified_at) values (${storeId}::uuid, ${email}, ${label}, ${verified ? sql`now()` : null})
    returning id
  `);
  return { id: String(row.id), email };
};

type Line = { variant: string; total: number; tax: number; delivery?: "physical" | "digital" | "service" };

/** An order waiting for payment with its lines, in `currency`. */
async function order(lines: Line[], currency = "NOK", over: { email?: string; customerId?: string | null; copied?: boolean } = {}) {
  counter += 1;
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const tax = lines.reduce((sum, line) => sum + line.tax, 0);
  const email = over.email ?? `buyer${counter}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, copied_from, status)
    values (${storeId}::uuid, ${`${over.copied ? "C-" : ""}CR-${run}-${counter}`}, 'NO', ${currency}, 'nb-NO', ${email}, ${over.customerId ?? null}::uuid,
      ${total}, 0, 0, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${over.copied ? sql`gen_random_uuid()` : null},
      ${over.copied ? "paid" : "pending_payment"}::commerce.order_status)
    returning id
  `);
  const id = String(row.id);
  if (over.copied) await db().execute(sql`select set_config('commerce.copying', 'on', false)`);
  for (const line of lines) {
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${storeId}::uuid, ${id}::uuid, ${line.variant}::uuid, 'CR', 'Thing', 1, ${line.total}, ${line.total}, ${line.tax}, 0.25, 'txcd_99999999',
        ${line.delivery ?? "physical"}::commerce.delivery)
    `);
  }
  if (over.copied) await db().execute(sql`select set_config('commerce.copying', 'off', false)`);
  return { id, total, currency };
}

const attribute = async (orderId: string, code: string | null) =>
  String((await db().execute<Row>(sql`select commerce.creator_attribute_order(${orderId}::uuid, ${code}) as v`))[0].v);

/** A captured payment, then the order paid (as Stripe's webhook does). */
async function pay(o: { id: string; total: number; currency: string }) {
  counter += 1;
  const [p] = await db().execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status)
    values (${storeId}::uuid, ${o.id}::uuid, 'stripe', ${`cs_cr_${run}_${counter}`}, ${o.total}, 0, ${o.currency}, 'captured')
    returning id
  `);
  await db().execute(sql`select commerce.complete_order_payment(${o.id}::uuid, ${`cs_cr_${run}_${counter}`})`);
  return String(p.id);
}

const refund = async (paymentId: string, amount: number) => {
  counter += 1;
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
    values (${storeId}::uuid, ${paymentId}::uuid, ${amount}, 'test', ${`re_cr_${run}_${counter}`}, 'succeeded')
  `);
};

const ledger = async (orderId: string) =>
  (await db().execute<Row>(sql`
    select kind, currency, amount_minor from commerce.creator_commissions where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by created_at, kind
  `)).map((r) => ({ kind: String(r.kind), currency: String(r.currency).trim(), amount: Number(r.amount_minor) }));

const statusOf = async (orderId: string) =>
  String((await db().execute<Row>(sql`select status from commerce.creator_attributions where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`))[0]?.status ?? "");

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`cr-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`cr-${run}`}, 'Creator test', null) as id`);
  storeId = String(store.id);
  owner = await account("owner", "owner");
  staff = await account("admin", "staff");
  const variants = await db().execute<Row>(sql`
    select v.id, p.id as product_id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where v.store_id = ${storeId}::uuid and p.kind = 'goods' order by p.created_at, v.created_at limit 1
  `);
  goodsVariant = String(variants[0].id);
  const [other] = await db().execute<Row>(sql`
    select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where v.store_id = ${storeId}::uuid and p.kind = 'goods' and p.id <> ${String(variants[0].product_id)}::uuid limit 1
  `);
  otherVariant = String(other?.id ?? variants[0].id);
  const [gift] = await db().execute<Row>(sql`
    select v.id from commerce.product_variants v join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    where v.store_id = ${storeId}::uuid and p.kind = 'gift_card' limit 1
  `);
  giftVariant = gift ? String(gift.id) : null;
  const [term] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug) values (${storeId}::uuid, 'product', 'category', 'Creator picks', ${`picks-${run}`}) returning id
  `);
  categoryId = String(term.id);
  await db().execute(sql`
    insert into commerce.product_terms (store_id, product_id, term_id, content_type)
    values (${storeId}::uuid, ${String(variants[0].product_id)}::uuid, ${categoryId}::uuid, 'product')
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("the programme's settings", () => {
  it("are the owner's, and a category's rate only for one of the store's product categories", async () => {
    const base = { enabled: true, commissionBps: 1000, categoryBps: { [categoryId]: 2000 }, cookieDays: 45 };
    expect(await creators.saveCreatorSettings(staff, storeId, base)).toEqual({ ok: false, problem: "owner_only" });
    expect(await creators.saveCreatorSettings(owner, storeId, { ...base, categoryBps: { [crypto.randomUUID()]: 100 } })).toEqual({
      ok: false,
      problem: "category",
    });
    expect(await creators.saveCreatorSettings(owner, storeId, { ...base, commissionBps: 9000 })).toEqual({ ok: false, problem: "invalid" });
    expect(await creators.saveCreatorSettings(owner, storeId, base)).toEqual({ ok: true });
    expect(await creators.getCreatorSettings(storeId)).toEqual(base);
    expect(await creators.creatorProgramOn(storeId)).toBe(true);
  });
});

let creator: { id: string; email: string };
let creatorId: string;
let code: string;

describe("applying and approving", () => {
  it("takes a signed-in customer whose address is proven, once, with the consent's words", async () => {
    const unproven = await customer("unproven", false);
    const input = { name: "Mia Makes", channelUrl: "https://video.example/@mia", consent: true };
    expect(await creators.applyAsCreator(storeId, unproven.id, input, "I agree")).toEqual({ ok: false, problem: "unverified" });
    creator = await customer("creator");
    expect(await creators.applyAsCreator(storeId, creator.id, { ...input, channelUrl: "javascript:alert(1)" }, "I agree")).toEqual({
      ok: false,
      problem: "channel",
    });
    expect(await creators.applyAsCreator(storeId, creator.id, { ...input, consent: false }, "I agree")).toEqual({ ok: false, problem: "invalid" });
    expect(await creators.applyAsCreator(storeId, creator.id, input, "I agree to the terms")).toEqual({ ok: true });
    expect(await creators.applyAsCreator(storeId, creator.id, input, "I agree to the terms")).toEqual({ ok: false, problem: "already" });
    const [row] = await creators.listCreators(storeId);
    expect(row).toMatchObject({ status: "applied", name: "Mia Makes", code: null, email: creator.email });
    creatorId = row.id;
    // An application gives no code yet: a link of it is no one's.
    expect((await creators.creatorDashboard(storeId, creator.id))?.code).toBeNull();
  });

  it("gives a code on approval, which a visitor's link and the cart then know", async () => {
    expect(await creators.decideCreator(staff, storeId, creatorId, "stop")).toEqual({ ok: false, problem: "status" });
    expect(await creators.decideCreator(staff, storeId, creatorId, "approve")).toEqual({ ok: true });
    const [row] = await creators.listCreators(storeId);
    expect(row.status).toBe("approved");
    code = String(row.code);
    expect(code).toMatch(/^[a-z0-9]{6,16}$/);
    expect(await validAffiliateCode(db(), storeId, code)).toBe(code);
    expect(await captureAffiliate(storeId, code)).toBe(true);
    expect((await creators.creatorDashboard(storeId, creator.id))?.visits).toBe(1);
    // A code is never changed once given, and the ledger is never written by hand.
    await expect(db().execute(sql`update commerce.creators set code = 'abcdefgh' where id = ${creatorId}::uuid`)).rejects.toThrow();
  });
});

describe("the commission", () => {
  it("is goods without VAT at each line's rate, once the order is paid, and nothing for gift cards or services", async () => {
    const lines: Line[] = [
      { variant: goodsVariant, total: 12500, tax: 2500 }, // in the category: 20 % of 10000 = 2000
      { variant: otherVariant, total: 6250, tax: 1250 },
      { variant: goodsVariant, total: 1000, tax: 0, delivery: "service" }, // a service earns nothing
    ];
    if (giftVariant) lines.push({ variant: giftVariant, total: 50000, tax: 0, delivery: "digital" });
    const o = await order(lines);
    expect(await attribute(o.id, code)).toBe("ok");
    expect(await statusOf(o.id)).toBe("pending");
    await pay(o);
    expect(await statusOf(o.id)).toBe("earned");
    const second = otherVariant === goodsVariant ? 1000 : 500; // the same category's 20 %, else the programme's 10 % of 5000
    expect(await ledger(o.id)).toEqual([{ kind: "earned", currency: "NOK", amount: 2000 + second }]);
  });

  it("is taken back in proportion to a refund, and all of it once all is refunded", async () => {
    const o = await order([{ variant: otherVariant, total: 12500, tax: 2500 }]);
    await attribute(o.id, code);
    const payment = await pay(o);
    const earned = (await ledger(o.id))[0].amount;
    await refund(payment, 6250);
    expect((await ledger(o.id)).filter((l) => l.kind === "reversed").reduce((s, l) => s + l.amount, 0)).toBe(Math.floor(earned / 2));
    expect(await statusOf(o.id)).toBe("earned");
    await refund(payment, 6250);
    expect((await ledger(o.id)).filter((l) => l.kind === "reversed").reduce((s, l) => s + l.amount, 0)).toBe(earned);
    expect(await statusOf(o.id)).toBe("reversed");
  });

  it("is taken back when a paid order is cancelled, and never earned by an unpaid one cancelled", async () => {
    const paid = await order([{ variant: goodsVariant, total: 5000, tax: 1000 }]);
    await attribute(paid.id, code);
    await pay(paid);
    await db().execute(sql`update commerce.orders set status = 'cancelled' where id = ${paid.id}::uuid`);
    expect(await ledger(paid.id)).toEqual([
      { kind: "earned", currency: "NOK", amount: 800 },
      { kind: "reversed", currency: "NOK", amount: 800 },
    ]);
    const unpaid = await order([{ variant: goodsVariant, total: 5000, tax: 1000 }]);
    await attribute(unpaid.id, code);
    await db().execute(sql`select commerce.cancel_unpaid_order(${unpaid.id}::uuid, 'expired')`);
    expect(await ledger(unpaid.id)).toEqual([]);
    expect(await statusOf(unpaid.id)).toBe("reversed");
  });

  it("is nothing for the creator's own order, a copied order or a stopped creator's code", async () => {
    const own = await order([{ variant: goodsVariant, total: 5000, tax: 1000 }], "NOK", { email: creator.email });
    expect(await attribute(own.id, code)).toBe("self");
    await pay(own);
    expect(await ledger(own.id)).toEqual([]);
    const copied = await order([{ variant: goodsVariant, total: 5000, tax: 1000 }], "NOK", { copied: true });
    expect(await attribute(copied.id, code)).toBe("none");
    expect(await creators.decideCreator(staff, storeId, creatorId, "stop")).toEqual({ ok: true });
    const later = await order([{ variant: goodsVariant, total: 5000, tax: 1000 }]);
    expect(await attribute(later.id, code)).toBe("none");
    expect(await validAffiliateCode(db(), storeId, code)).toBeNull();
    expect(await creators.decideCreator(staff, storeId, creatorId, "approve")).toEqual({ ok: true });
  });

  it("is kept in the order's own currency, never converted: a euro order earns euros", async () => {
    const o = await order([{ variant: otherVariant, total: 2500, tax: 500 }], "EUR");
    await attribute(o.id, code);
    await pay(o);
    const [entry] = await ledger(o.id);
    expect(entry.currency).toBe("EUR");
    expect(entry.amount).toBe(otherVariant === goodsVariant ? 400 : 200);
    const [row] = await creators.listCreators(storeId);
    expect(row.balances.map((b) => b.currency)).toEqual(["EUR", "NOK"]);
  });
});

describe("payouts", () => {
  it("are the owner's, in a currency owed and never more than is owed there", async () => {
    const [row] = await creators.listCreators(storeId);
    const nok = row.balances.find((b) => b.currency === "NOK")!;
    expect(nok.owedMinor).toBeGreaterThan(0);
    const payout = { currency: "NOK", amountMinor: nok.owedMinor, paidOn: "2026-10-28", reference: "Bank transfer" };
    expect(await creators.recordCreatorPayout(staff, storeId, creatorId, payout)).toEqual({ ok: false, problem: "owner_only" });
    expect(await creators.recordCreatorPayout(owner, storeId, creatorId, { ...payout, amountMinor: nok.owedMinor + 1 })).toEqual({
      ok: false,
      problem: "payout_over",
    });
    expect(await creators.recordCreatorPayout(owner, storeId, creatorId, { ...payout, currency: "SEK" })).toEqual({ ok: false, problem: "payout_over" });
    expect(await creators.recordCreatorPayout(owner, storeId, creatorId, payout)).toEqual({ ok: true });
    const [after] = await creators.listCreators(storeId);
    expect(after.balances.find((b) => b.currency === "NOK")).toMatchObject({ owedMinor: 0, paidMinor: nok.owedMinor });
    const csv = await creators.creatorPayoutsCsv(storeId);
    expect(csv.split("\r\n")[0]).toBe("paid_on,creator,currency,amount,reference");
    expect(csv).toContain("2026-10-28,Mia Makes,NOK,");
    await expect(db().execute(sql`delete from commerce.creator_payouts where store_id = ${storeId}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.creator_commissions set amount_minor = 1 where store_id = ${storeId}::uuid`)).rejects.toThrow();
  });
});

describe("the creator's page and personal data", () => {
  it("shows counts and money, never a buyer", async () => {
    const page = await creators.creatorDashboard(storeId, creator.id);
    expect(page).toMatchObject({ status: "approved", code });
    expect(page!.orders.earned).toBeGreaterThan(0);
    expect(page!.orders.rejected).toBe(1);
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/buyer\d+-/);
    expect(text).not.toContain("CR-");
  });

  it("forgets the creator on erasure, keeping the ledger's rows with no one in them", async () => {
    const before = (await db().execute<Row>(sql`select count(*)::int as n from commerce.creator_commissions where store_id = ${storeId}::uuid`))[0].n;
    expect(await creators.forgetCreator(db(), storeId, creator.id)).toBe(1);
    const [row] = await db().execute<Row>(sql`select customer_id, name, channel_url, status from commerce.creators where id = ${creatorId}::uuid`);
    expect(row).toMatchObject({ customer_id: null, name: "", channel_url: "", status: "stopped" });
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.creator_commissions where store_id = ${storeId}::uuid`))[0].n).toBe(before);
    expect(await creators.decideCreator(staff, storeId, creatorId, "approve")).toEqual({ ok: false, problem: "not_found" });
    expect(await creators.creatorDashboard(storeId, creator.id)).toBeNull();
  });
});
