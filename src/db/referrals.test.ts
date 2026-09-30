import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The rules of Kaizen's referral program (D131, `referral_rules` migration), on a real schema: an append-only ledger of
 * credit per account and currency that can never go below zero, commission on the referred store's fees inside the
 * referral's months, taken back by refunded share, and the referral made when a request with a code is approved.
 */

let db: PGlite;
let counter = 0;
let template: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  template = await createStore("referral-template", ["NO"]);
  await db.query("update commerce.stores set is_template = true where id = $1", [template]);
  admin = await account("referral-admin@example.com");
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const scalar = async <T = number>(sql: string, params: unknown[] = []) => Object.values(await one<Record<string, unknown>>(sql, params))[0] as T;

async function account(email: string): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.accounts (email) values ($1) returning id", [email])).id;
}

async function createStore(slug: string, markets: string[]): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, $1) returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [id, markets],
  );
  return id;
}

/** The program's settings: on, 10 % for 12 months, pending 30 days, unless said. */
const program = (over: { enabled?: boolean; bps?: number; months?: number; pending?: number } = {}) =>
  db.query(
    `insert into commerce.referral_settings (id, enabled, commission_bps, months, pending_days, cookie_days)
     values (true, $1, $2, $3, $4, 30)
     on conflict (id) do update set enabled = excluded.enabled, commission_bps = excluded.commission_bps,
       months = excluded.months, pending_days = excluded.pending_days`,
    [over.enabled ?? true, over.bps ?? 1000, over.months ?? 12, over.pending ?? 30],
  );

/** An account that refers: its referrers row with a code. */
async function referrer(label: string) {
  counter += 1;
  const email = `${label}-${counter}@example.com`;
  const id = await account(email);
  const code = `code${String(counter).padStart(4, "0")}${label.slice(0, 3)}`.toLowerCase();
  await db.query("insert into commerce.referrers (account_id, code) values ($1, $2)", [id, code]);
  return { id, email, code };
}

/** A store that came through `code`: a request with it, approved. */
async function referred(code: string | null, over: { email?: string } = {}) {
  counter += 1;
  const email = over.email ?? `owner-${counter}@example.com`;
  const { id: request } = await one<{ id: string }>(
    "insert into commerce.access_requests (email, name, store_name, referral_code) values ($1, 'Kari', 'Shop', $2) returning id",
    [email, code],
  );
  const { store_id: storeId } = await one<{ store_id: string }>(
    "select commerce.approve_access_request($1, $2, 'Shop', $3) as store_id",
    [request, `shop-${counter}`, admin],
  );
  return { storeId, request, email };
}

const referralOf = (storeId: string) =>
  one<{ id: string; referrer_account_id: string; commission_bps: number; months: number; status: string } | undefined>(
    "select * from commerce.referrals where store_id = $1",
    [storeId],
  );

const balance = async (accountId: string, currency = "EUR") => {
  const row = await one<{ available_minor: string; pending_minor: string; pending_at: Date | null } | undefined>(
    "select * from commerce.referral_balance($1) where currency = $2",
    [accountId, currency],
  );
  return { available: Number(row?.available_minor ?? 0), pending: Number(row?.pending_minor ?? 0), pendingAt: row?.pending_at ?? null };
};
const verified = (accountId: string) => scalar<boolean>("select commerce.referral_verify($1)", [accountId]);
const entries = async (accountId: string) =>
  (
    await db.query<{ kind: string; amount_minor: string; currency: string; key: string }>(
      "select kind, amount_minor, currency, idempotency_key as key from commerce.referral_entries where account_id = $1 order by created_at, amount_minor desc",
      [accountId],
    )
  ).rows.map((r) => ({ kind: r.kind, amount: Number(r.amount_minor), currency: r.currency, key: r.key }));

/** Makes everything the account has earned usable now (the ledger is immutable, but a test may pull the trigger). */
async function maturing(accountId: string, days = 40) {
  await db.exec("alter table commerce.referral_entries disable trigger referral_entries_immutable");
  await db.query(
    "update commerce.referral_entries set created_at = created_at - make_interval(days => $2), available_at = available_at - make_interval(days => $2) where account_id = $1",
    [accountId, days],
  );
  await db.exec("alter table commerce.referral_entries enable trigger referral_entries_immutable");
}

const earn = (storeId: string, fee: number, ref: string, over: { currency?: string; at?: string } = {}) =>
  scalar<string>("select commerce.referral_earn($1, $2, $3, 'plan_invoice', $4, 'Plan invoice', coalesce($5::timestamptz, now()))", [
    storeId,
    fee,
    over.currency ?? "EUR",
    ref,
    over.at ?? null,
  ]).then(Number);

/** A paid order of a store with one captured Stripe payment carrying Kaizen's fee. */
async function sale(storeId: string, amount: number, fee: number, over: { status?: string; currency?: string } = {}) {
  counter += 1;
  const currency = over.currency ?? "EUR";
  const { id: orderId } = await one<{ id: string }>(
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
     values ($1, $2, 'NO', $3, 'nb-NO', 'x@example.com', $4, 0, 0, 0, $4, '{}', '{}') returning id`,
    [storeId, `R-${counter}`, currency, amount],
  );
  const { id: paymentId } = await one<{ id: string }>(
    `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor)
     values ($1, $2, 'stripe', $3, $4, $5, $6::commerce.payment_status, $7) returning id`,
    [storeId, orderId, `cs_ref_${counter}`, amount, currency, over.status ?? "captured", fee],
  );
  return { orderId, paymentId };
}
const refund = (storeId: string, paymentId: string, amount: number, status = "succeeded") =>
  db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, $3, 'test', $4::commerce.refund_status)", [
    storeId,
    paymentId,
    amount,
    status,
  ]);

describe("the referral ledger", () => {
  it("is append-only: no change to an entry or an allocation, and no delete but the account's own", async () => {
    await program();
    const r = await referrer("ledger");
    await db.query("select commerce.referral_adjust($1, 'EUR', 1000, 'test', null, 'adj-append')", [r.id]);
    await db.query("select commerce.referral_take($1, 'EUR', 'apply', 400, 'available', null, 'invoice', 'in_append', null, 'in_append', '', null, 'take-append')", [r.id]);
    const refused = /append-only/;
    await expect(db.query("update commerce.referral_entries set amount_minor = 5 where account_id = $1", [r.id])).rejects.toThrow(refused);
    await expect(db.query("delete from commerce.referral_entries where account_id = $1", [r.id])).rejects.toThrow(refused);
    await expect(
      db.query("update commerce.referral_allocations set amount_minor = 1 where entry_id in (select id from commerce.referral_entries where account_id = $1)", [r.id]),
    ).rejects.toThrow(refused);
    await expect(db.query("delete from commerce.referral_allocations")).rejects.toThrow(refused);
    // Deleting the account takes its ledger and allocations with it.
    await db.query("delete from commerce.accounts where id = $1", [r.id]);
    expect(await scalar("select count(*)::int from commerce.referral_entries where account_id = $1", [r.id])).toBe(0);
    expect(await scalar("select count(*)::int from commerce.referral_allocations a where not exists (select 1 from commerce.referral_entries e where e.id = a.entry_id)")).toBe(0);
  });

  it("does each grant and use once per key", async () => {
    const r = await referrer("once");
    for (let i = 0; i < 2; i++) await db.query("select commerce.referral_adjust($1, 'EUR', 500, 'same', null, 'adj-once')", [r.id]);
    expect((await balance(r.id)).available).toBe(500);
    for (let i = 0; i < 2; i++) {
      expect(Number(await scalar("select commerce.referral_take($1, 'EUR', 'apply', 200, 'available', null, 'invoice', 'in_once', null, 'in_once', '', null, 'take-once')", [r.id]))).toBe(200);
    }
    expect((await balance(r.id)).available).toBe(300);
    expect(await verified(r.id)).toBe(true);
  });

  it("never goes below zero, whatever writes to it", async () => {
    const r = await referrer("zero");
    await db.query("select commerce.referral_adjust($1, 'EUR', 300, 'usable', null, 'adj-zero-1')", [r.id]);
    await db.query("select commerce.referral_grant($1, 'EUR', 'earn', 1000, 'plan_invoice', 'in_later', null, null, now() + interval '5 days', '', null, 'pending-lot')", [r.id]);
    // Only what is usable now can be put on an invoice.
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_zero', 5000)", [r.id]))).toBe(300);
    expect(await balance(r.id)).toMatchObject({ available: 0, pending: 1000 });
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_zero_2', 5000)", [r.id]))).toBe(0);
    // An adjustment that removes more than there is, is refused.
    await expect(db.query("select commerce.referral_adjust($1, 'EUR', -5000, 'too much', null, 'adj-zero-2')", [r.id])).rejects.toThrow("referral.insufficient");
    // A negative entry not paid out of lots cannot be committed; nor an allocation beyond its lot.
    await expect(
      db.query("insert into commerce.referral_entries (account_id, currency, kind, amount_minor, idempotency_key) values ($1, 'EUR', 'reverse', -1, 'sneaky')", [r.id]),
    ).rejects.toThrow("referral.below_zero");
    const lot = await one<{ id: string }>("select id from commerce.referral_entries where account_id = $1 and amount_minor = 300", [r.id]);
    const spent = await one<{ id: string }>("select id from commerce.referral_entries where account_id = $1 and kind = 'apply'", [r.id]);
    await expect(db.query("insert into commerce.referral_allocations (lot_id, entry_id, amount_minor) values ($1, $2, 1)", [lot.id, spent.id])).rejects.toThrow();
    expect(await verified(r.id)).toBe(true);
  });

  it("keeps each currency apart: credit in one is never used in, or converted to, another", async () => {
    const r = await referrer("money");
    await db.query("select commerce.referral_adjust($1, 'NOK', 10000, 'nok', null, 'adj-money-nok')", [r.id]);
    await db.query("select commerce.referral_adjust($1, 'EUR', 500, 'eur', null, 'adj-money-eur')", [r.id]);
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'SEK', 'in_sek', 9999)", [r.id]))).toBe(0);
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_eur', 9999)", [r.id]))).toBe(500);
    expect(await balance(r.id, "NOK")).toMatchObject({ available: 10000 });
    expect(await balance(r.id, "EUR")).toMatchObject({ available: 0 });
    const rows = await db.query<{ currency: string; available_minor: string }>("select currency, available_minor from commerce.referral_balance($1) order by currency", [r.id]);
    expect(rows.rows.map((x) => [x.currency, Number(x.available_minor)])).toEqual([["NOK", 10000]]);
    expect(await verified(r.id)).toBe(true);
  });

  it("uses usable credit oldest first and reports what is pending and when it becomes usable", async () => {
    const r = await referrer("order");
    await db.query("select commerce.referral_grant($1, 'EUR', 'adjust', 100, 'adjust', 'a', null, null, now() - interval '2 days', '', null, 'old')", [r.id]);
    await db.query("select commerce.referral_grant($1, 'EUR', 'adjust', 100, 'adjust', 'b', null, null, now() - interval '1 day', '', null, 'newer')", [r.id]);
    await db.query("select commerce.referral_grant($1, 'EUR', 'adjust', 100, 'adjust', 'c', null, null, now() + interval '3 days', '', null, 'later')", [r.id]);
    await db.query("select commerce.referral_grant($1, 'EUR', 'adjust', 100, 'adjust', 'd', null, null, now() + interval '9 days', '', null, 'latest')", [r.id]);
    await db.query("select commerce.referral_apply_invoice($1, 'EUR', 'in_order', 150)", [r.id]);
    // The oldest is gone, half of the newer is left.
    const left = await db.query<{ key: string; remaining: string }>(
      "select e.idempotency_key as key, l.remaining from commerce.referral_lots($1, 'EUR') l join commerce.referral_entries e on e.id = l.id order by e.created_at",
      [r.id],
    );
    expect(Object.fromEntries(left.rows.map((x) => [x.key, Number(x.remaining)]))).toEqual({ old: 0, newer: 50, later: 100, latest: 100 });
    const b = await balance(r.id);
    expect(b).toMatchObject({ available: 50, pending: 200 });
    expect(b.pendingAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    expect(b.pendingAt!.getTime()).toBeLessThan(Date.now() + 4 * 86_400_000);
  });

  it("puts credit on an invoice once, restores it once, and can put it on again after a restore", async () => {
    const r = await referrer("invoice");
    await db.query("select commerce.referral_adjust($1, 'EUR', 1000, 'credit', null, 'adj-invoice')", [r.id]);
    const apply = () => scalar<string>("select commerce.referral_apply_invoice($1, 'EUR', 'in_inv', 400)", [r.id]).then(Number);
    expect(await apply()).toBe(400);
    // A retry changes nothing: the invoice already holds its credit, even when asked for more.
    expect(await apply()).toBe(400);
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_inv', 900)", [r.id]))).toBe(400);
    expect((await balance(r.id)).available).toBe(600);

    expect(Number(await scalar("select commerce.referral_restore_invoice('in_inv', 'voided')"))).toBe(400);
    expect(Number(await scalar("select commerce.referral_restore_invoice('in_inv', 'voided')"))).toBe(0);
    expect((await balance(r.id)).available).toBe(1000);
    // A second try for the same invoice (after the Stripe call failed and was taken back) is a new entry.
    expect(await apply()).toBe(400);
    expect((await balance(r.id)).available).toBe(600);
    expect((await entries(r.id)).map((e) => e.kind)).toEqual(["adjust", "apply", "restore", "apply"]);
    expect(await verified(r.id)).toBe(true);
  });

  it("does not use a blocked account's credit", async () => {
    const r = await referrer("blocked");
    await db.query("select commerce.referral_adjust($1, 'EUR', 1000, 'credit', null, 'adj-blocked')", [r.id]);
    await db.query("update commerce.referrers set blocked_at = now() where account_id = $1", [r.id]);
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_blocked', 400)", [r.id]))).toBe(0);
    await db.query("update commerce.referrers set blocked_at = null where account_id = $1", [r.id]);
    expect(Number(await scalar("select commerce.referral_apply_invoice($1, 'EUR', 'in_blocked', 400)", [r.id]))).toBe(400);
  });

  it("adds and removes credit for Kaizen, with a reason, and only for an account with a code", async () => {
    const r = await referrer("adjust");
    await db.query("select commerce.referral_adjust($1, 'EUR', 700, 'goodwill', $2, 'adj-a-1')", [r.id, admin]);
    expect(Number(await scalar("select commerce.referral_adjust($1, 'EUR', -200, 'mistake', $2, 'adj-a-2')", [r.id, admin]))).toBe(-200);
    expect((await balance(r.id)).available).toBe(500);
    await expect(db.query("select commerce.referral_adjust($1, 'EUR', 0, 'nothing', null, 'adj-a-3')", [r.id])).rejects.toThrow("referral.zero");
    const nobody = await account("nobody@example.com");
    await expect(db.query("select commerce.referral_adjust($1, 'EUR', 10, 'x', null, 'adj-a-4')", [nobody])).rejects.toThrow("referral.no_referrer");
    expect(await scalar("select note from commerce.referral_entries where idempotency_key = 'adj-a-1'")).toBe("goodwill");
  });
});

describe("the referral made at approval", () => {
  it("is made from the request's code, freezing the rate and the months as they are then", async () => {
    await program({ bps: 1000, months: 12 });
    const r = await referrer("approve");
    const { storeId, request } = await referred(r.code);
    expect(await referralOf(storeId)).toMatchObject({ referrer_account_id: r.id, commission_bps: 1000, months: 12, status: "active" });
    expect(await scalar("select access_request_id from commerce.referrals where store_id = $1", [storeId])).toBe(request);
    // A later change of the program does not change a referral already made.
    await program({ bps: 2500, months: 6 });
    expect(await referralOf(storeId)).toMatchObject({ commission_bps: 1000, months: 12 });
    const later = await referred(r.code);
    expect(await referralOf(later.storeId)).toMatchObject({ commission_bps: 2500, months: 6 });
    await program();
  });

  it("makes none for no code, a code nobody has, or a program that is off", async () => {
    await program();
    const r = await referrer("none");
    expect(await referralOf((await referred(null)).storeId)).toBeUndefined();
    expect(await referralOf((await referred("nosuchcode")).storeId)).toBeUndefined();
    await program({ enabled: false });
    expect(await referralOf((await referred(r.code)).storeId)).toBeUndefined();
    await program();
  });

  it("makes none for the referrer's own store: their email, in any case, or an account that is a member of it", async () => {
    await program();
    const r = await referrer("self");
    const own = await referred(r.code, { email: r.email.toUpperCase() });
    expect(await referralOf(own.storeId)).toBeUndefined();
    // Someone else's code on the same request is fine, and the code is case-insensitive.
    const other = await referrer("friend");
    expect(await referralOf((await referred(other.code.toUpperCase())).storeId)).toMatchObject({ referrer_account_id: other.id });
  });

  it("is made once per store, and a blocked referrer has the referral but earns nothing", async () => {
    await program();
    const r = await referrer("blockedref");
    await db.query("update commerce.referrers set blocked_at = now() where account_id = $1", [r.id]);
    const { storeId } = await referred(r.code);
    expect(await referralOf(storeId)).toMatchObject({ status: "active" });
    expect(await earn(storeId, 10_000, "in_blocked_ref")).toBe(0);
    await db.query("update commerce.referrers set blocked_at = null where account_id = $1", [r.id]);
    expect(await earn(storeId, 10_000, "in_blocked_ref")).toBe(1000);
    await expect(db.query("insert into commerce.referrals (referrer_account_id, store_id, commission_bps, months) values ($1, $2, 1, 1)", [r.id, storeId])).rejects.toThrow();
  });
});

describe("commission on a fee", () => {
  it("is a share of the fee, rounded down, in its own currency, pending until the pending days have passed", async () => {
    await program({ bps: 1000, pending: 30 });
    const r = await referrer("earn");
    const { storeId } = await referred(r.code);
    expect(await earn(storeId, 34_900, "in_earn_1", { currency: "NOK" })).toBe(3490);
    expect(await earn(storeId, 999, "in_earn_2", { currency: "NOK" })).toBe(99);
    expect(await earn(storeId, 5, "in_earn_3", { currency: "NOK" })).toBe(0);
    const b = await balance(r.id, "NOK");
    expect(b).toMatchObject({ available: 0, pending: 3490 + 99 });
    expect(b.pendingAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Nothing in another currency.
    expect(await balance(r.id, "EUR")).toMatchObject({ available: 0, pending: 0 });
    await maturing(r.id);
    expect(await balance(r.id, "NOK")).toMatchObject({ available: 3589, pending: 0 });
    expect(await verified(r.id)).toBe(true);
  });

  it("is earned once per source", async () => {
    await program();
    const r = await referrer("source");
    const { storeId } = await referred(r.code);
    expect(await earn(storeId, 10_000, "in_source")).toBe(1000);
    expect(await earn(storeId, 10_000, "in_source")).toBe(1000);
    expect(await earn(storeId, 50_000, "in_source")).toBe(1000);
    expect((await entries(r.id)).filter((e) => e.kind === "earn")).toHaveLength(1);
    expect(await balance(r.id)).toMatchObject({ pending: 1000 });
  });

  it("only counts fees paid inside the referral's months", async () => {
    await program({ months: 3 });
    const r = await referrer("window");
    const { storeId } = await referred(r.code);
    await program({ months: 3 });
    await db.query("update commerce.referrals set created_at = now() - interval '4 months' where store_id = $1", [storeId]);
    // Paid long ago, inside the months; paid now, after them.
    expect(await earn(storeId, 10_000, "in_inside", { at: new Date(Date.now() - 2 * 30 * 86_400_000 - 40 * 86_400_000).toISOString() })).toBe(1000);
    expect(await earn(storeId, 10_000, "in_outside")).toBe(0);
    // Before the referral existed is not counted either.
    expect(await earn(storeId, 10_000, "in_before", { at: new Date(Date.now() - 6 * 30 * 86_400_000).toISOString() })).toBe(0);
    await program();
  });

  it("earns nothing for a void referral, or while the program is off, or for a store without a referral", async () => {
    await program();
    const r = await referrer("void");
    const { storeId } = await referred(r.code);
    await program({ enabled: false });
    expect(await earn(storeId, 10_000, "in_off")).toBe(0);
    await program();
    await db.query("update commerce.referrals set status = 'void', void_reason = 'self' where store_id = $1", [storeId]);
    expect(await earn(storeId, 10_000, "in_void")).toBe(0);
    await db.query("update commerce.referrals set status = 'active' where store_id = $1", [storeId]);
    expect(await earn(storeId, 10_000, "in_void")).toBe(1000);
    const plain = await createStore("not-referred", ["NO"]);
    expect(await earn(plain, 10_000, "in_plain")).toBe(0);
    expect(await entries(r.id)).toHaveLength(1);
  });

  it("is taken back by the share of a credit note, never below zero: what was used stays used", async () => {
    await program();
    const r = await referrer("note");
    const { storeId } = await referred(r.code);
    await earn(storeId, 10_000, "in_note");
    await maturing(r.id);
    const reverse = (num: number, den: number, key: string) =>
      scalar<string>("select commerce.referral_reverse('plan_invoice', 'in_note', $1, $2, false, $3, 'credit note')", [num, den, key]).then(Number);
    // A quarter of the fee credited: a quarter of the 1 000 goes.
    expect(await reverse(2_500, 10_000, "cn-1")).toBe(250);
    expect(await reverse(2_500, 10_000, "cn-1")).toBe(250);
    expect((await balance(r.id)).available).toBe(750);
    // Part of it is used on an invoice.
    await db.query("select commerce.referral_apply_invoice($1, 'EUR', 'in_used', 700)", [r.id]);
    expect((await balance(r.id)).available).toBe(50);
    // The rest of the fee is credited: only the 50 still there is taken, never below zero.
    expect(await reverse(10_000, 10_000, "cn-2")).toBe(50);
    expect((await balance(r.id)).available).toBe(0);
    expect(await verified(r.id)).toBe(true);
    // Nothing more is taken for a source that is all taken back, and nothing for one that earned nothing.
    expect(await reverse(10_000, 10_000, "cn-3")).toBe(0);
    expect(Number(await scalar("select commerce.referral_reverse('plan_invoice', 'in_none', 1, 1, false, 'cn-x', 'x')"))).toBe(0);
  });
});

describe("the sale fee on the referred store's orders", () => {
  it("earns once when a payment is captured: inserted captured, or turned captured", async () => {
    await program({ bps: 1000, pending: 30 });
    const r = await referrer("sale");
    const { storeId } = await referred(r.code);
    const a = await sale(storeId, 20_000, 400);
    expect((await entries(r.id)).map((e) => [e.kind, e.amount, e.key])).toEqual([["earn", 40, `sale_fee:${a.paymentId}`]]);
    const b = await sale(storeId, 20_000, 400, { status: "pending" });
    expect(await balance(r.id)).toMatchObject({ pending: 40 });
    await db.query("update commerce.payments set status = 'captured' where id = $1", [b.paymentId]);
    expect(await balance(r.id)).toMatchObject({ pending: 80 });
    // Touching the payment again earns nothing more.
    await db.query("update commerce.payments set status = 'authorized' where id = $1", [b.paymentId]);
    await db.query("update commerce.payments set status = 'captured' where id = $1", [b.paymentId]);
    await db.query("update commerce.payments set updated_at = now() where id = $1", [b.paymentId]);
    expect(await balance(r.id)).toMatchObject({ pending: 80 });
    // No fee, no commission; and a store nobody referred earns no one anything.
    await sale(storeId, 20_000, 0);
    await sale(await createStore("plain-sale", ["NO"]), 20_000, 400);
    expect((await entries(r.id)).filter((e) => e.kind === "earn")).toHaveLength(2);
  });

  it("earns in the payment's currency, and nothing after the months, for a void referral or a blocked referrer", async () => {
    await program();
    const r = await referrer("salecases");
    const { storeId } = await referred(r.code);
    await sale(storeId, 100_000, 2_000, { currency: "NOK" });
    expect(await balance(r.id, "NOK")).toMatchObject({ pending: 200 });
    await db.query("update commerce.referrals set status = 'void' where store_id = $1", [storeId]);
    await sale(storeId, 100_000, 2_000);
    await db.query("update commerce.referrals set status = 'active' where store_id = $1", [storeId]);
    await db.query("update commerce.referrers set blocked_at = now() where account_id = $1", [r.id]);
    await sale(storeId, 100_000, 2_000);
    await db.query("update commerce.referrers set blocked_at = null where account_id = $1", [r.id]);
    await db.query("update commerce.referrals set created_at = now() - interval '13 months' where store_id = $1", [storeId]);
    await sale(storeId, 100_000, 2_000);
    expect((await entries(r.id)).map((e) => e.kind)).toEqual(["earn"]);
  });

  it("never earns on a copied order (D129), which cannot take a payment at all", async () => {
    await program();
    const r = await referrer("copied");
    const { storeId } = await referred(r.code);
    const { id: orderId } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, status, copied_from)
       values ($1, 'C-1', 'NO', 'EUR', 'nb-NO', 'x@example.com', 100, 0, 0, 0, 100, '{}', '{}', 'paid', gen_random_uuid()) returning id`,
      [storeId],
    );
    await expect(
      db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor) values ($1, $2, 'stripe', 'pi_copy', 100, 'EUR', 'captured', 50)", [storeId, orderId]),
    ).rejects.toThrow(/copied_order/);
    expect(await entries(r.id)).toEqual([]);
  });

  it("takes back the refunded share, cumulatively, however the refunds are cut", async () => {
    await program();
    const r = await referrer("refund");
    const { storeId } = await referred(r.code);
    const { paymentId } = await sale(storeId, 10_000, 1_000);
    await maturing(r.id);
    expect((await balance(r.id)).available).toBe(100);
    await refund(storeId, paymentId, 3_333);
    // floor(100 * 3333 / 10000) = 33 goes.
    expect((await balance(r.id)).available).toBe(67);
    await refund(storeId, paymentId, 3_333);
    expect((await balance(r.id)).available).toBe(34);
    // A failed refund takes nothing back.
    await refund(storeId, paymentId, 500, "failed");
    expect((await balance(r.id)).available).toBe(34);
    // The last part of the payment: the whole commission is gone, the pieces adding up to it.
    await refund(storeId, paymentId, 3_334);
    expect((await balance(r.id)).available).toBe(0);
    expect((await entries(r.id)).filter((e) => e.kind === "reverse").reduce((sum, e) => sum + e.amount, 0)).toBe(-100);
    expect(await verified(r.id)).toBe(true);
  });

  it("takes back only what is left of the commission when it has been used", async () => {
    await program();
    const r = await referrer("usedfee");
    const { storeId } = await referred(r.code);
    const { paymentId } = await sale(storeId, 10_000, 1_000);
    await maturing(r.id);
    await db.query("select commerce.referral_apply_invoice($1, 'EUR', 'in_usedfee', 80)", [r.id]);
    await refund(storeId, paymentId, 10_000);
    // 100 earned, 80 used: the 20 left goes; what was used stays used.
    expect((await balance(r.id)).available).toBe(0);
    expect((await entries(r.id)).filter((e) => e.kind === "reverse").map((e) => e.amount)).toEqual([-20]);
    expect(await verified(r.id)).toBe(true);
  });

  it("does not stop a payment when the commission cannot be worked out", async () => {
    await program();
    const r = await referrer("faulty");
    const { storeId } = await referred(r.code);
    // A currency code the ledger refuses would fail the grant; the payment itself is still taken.
    await db.exec("alter table commerce.referral_entries add constraint referral_test_fault check (currency <> 'XXX') not valid");
    try {
      const { paymentId } = await sale(storeId, 10_000, 1_000, { currency: "XXX" });
      expect(await scalar("select count(*)::int from commerce.payments where id = $1", [paymentId])).toBe(1);
    } finally {
      await db.exec("alter table commerce.referral_entries drop constraint referral_test_fault");
    }
  });
});

describe("visits", () => {
  it("counts a visit to a real code by day, and nothing for a code nobody has or a blocked one", async () => {
    const r = await referrer("visit");
    expect(await scalar<boolean>("select commerce.referral_visit($1)", [r.code])).toBe(true);
    expect(await scalar<boolean>("select commerce.referral_visit($1)", [r.code])).toBe(true);
    expect(await scalar<boolean>("select commerce.referral_visit('nosuchcode')")).toBe(false);
    expect(await scalar("select sum(visits)::int from commerce.referral_visits where code = $1 and store_id is null", [r.code])).toBe(2);
    expect(await scalar("select count(*)::int from commerce.referral_visits where code = $1", [r.code])).toBe(1);
    await db.query("update commerce.referrers set blocked_at = now() where account_id = $1", [r.id]);
    expect(await scalar<boolean>("select commerce.referral_visit($1)", [r.code])).toBe(false);
    expect(await scalar("select sum(visits)::int from commerce.referral_visits where code = $1", [r.code])).toBe(2);
  });
});

describe("the tables", () => {
  it("have row level security on, as every commerce table has", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relname like 'referral%' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("keep the program's settings to one row with the owner's limits", async () => {
    await expect(db.query("insert into commerce.referral_settings (id, commission_bps) values (false, 100)")).rejects.toThrow();
    await expect(db.query("update commerce.referral_settings set commission_bps = 5001")).rejects.toThrow();
    await expect(db.query("update commerce.referral_settings set months = 0")).rejects.toThrow();
    await expect(db.query("insert into commerce.referrers (account_id, code) values ($1, 'ABC')", [admin])).rejects.toThrow();
  });
});
