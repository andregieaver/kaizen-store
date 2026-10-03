import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RETURN_KINDS, RETURN_STATUSES, canMove, type ReturnKind, type ReturnStatus } from "@/lib/return-status";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { RETURN_REASONS } from "@/lib/withdrawal";

import { createTestDatabase } from "./testing";

/**
 * Withdrawals and returns (D153, docs/returns.md): the rules that live in SQL, against every migration applied to a
 * real Postgres (PGlite). Quantities, the lifecycle, a confirmed withdrawal as a record, numbering, refunds never above
 * what was paid, expiry of unconfirmed requests, copied orders, and the return settings travelling with a store.
 */

let db: PGlite;
let shop: string;
let owner: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('ret-shop', 'Returns', 'NO') returning id")).id;
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = any($2)`,
    [shop, ["DE", "NO"]],
  );
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('ret-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

type Made = { order: string; number: string; lines: { a: string; b: string }; payment: string };

/**
 * A paid order in euros: line A, 3 units for 3000 (so 1000 each), line B, one perishable unit for 1000 (excluded by
 * the law), 490 shipping, 4490 paid by Stripe.
 */
async function paidOrder(over: { status?: string; company?: string | null; payments?: number | null } = {}): Promise<Made> {
  counter += 1;
  const number = `R-${1000 + counter}`;
  const { id: order } = await one<{ id: string }>(
    `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
       discount_minor, tax_minor, total_minor, billing_address, shipping_address, company_name)
     values ($1, $2, 'DE', 'EUR', 'de-DE', 'shopper@example.com', $3, 4000, 490, 0, 700, 4490, '{}', '{}', $4) returning id`,
    [shop, number, over.status ?? "paid", over.company ?? null],
  );
  const line = async (sku: string, qty: number, total: number, exclusion = "none") =>
    (
      await one<{ id: string }>(
        `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate,
           tax_code, withdrawal_exclusion)
         values ($1, $2, $3, $3, $4, $5, $6, 0, 0.19, 'txcd_99999999', $7::commerce.withdrawal_exclusion) returning id`,
        [shop, order, sku, qty, total / qty, total, exclusion],
      )
    ).id;
  const a = await line(`A-${counter}`, 3, 3000);
  const b = await line(`B-${counter}`, 1, 1000, "perishable");
  let payment = "";
  if (over.payments !== null) {
    payment = (
      await one<{ id: string }>(
        `insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
         values ($1, $2, 'stripe', $3, 'acct_ret', $4, 'EUR', 'captured') returning id`,
        [shop, order, `pi_ret_${counter}`, over.payments ?? 4490],
      )
    ).id;
  }
  return { order, number, lines: { a, b }, payment };
}

/** A withdrawal request for lines of an order, confirmed unless said. */
async function request(o: Made, lines: Record<string, number>, confirm = true): Promise<string> {
  const { id } = await one<{ id: string }>(
    "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'A Shopper', 'shopper@example.com', 'web') returning id",
    [shop, o.order],
  );
  for (const [line, quantity] of Object.entries(lines)) {
    await db.query("insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, $4)", [
      shop,
      id,
      line,
      quantity,
    ]);
  }
  if (confirm) await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [id]);
  return id;
}

type Ret = { id: string; number: string };
/** A withdrawal return for a confirmed request, with its lines. */
async function withdrawalReturn(o: Made, lines: Record<string, number>): Promise<Ret> {
  const req = await request(o, lines);
  const r = await one<Ret>(
    "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id, number",
    [shop, o.order, req],
  );
  for (const [line, quantity] of Object.entries(lines)) await addLine(r.id, line, quantity);
  return r;
}
/** A voluntary return, with its lines. */
async function voluntaryReturn(o: Made, lines: Record<string, number>, status = "requested"): Promise<Ret> {
  const r = await one<Ret>("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', $3) returning id, number", [
    shop,
    o.order,
    status,
  ]);
  for (const [line, quantity] of Object.entries(lines)) await addLine(r.id, line, quantity);
  return r;
}
const addLine = (ret: string, line: string, quantity: number, decision = "accept", declineReason: string | null = null) =>
  db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision, decline_reason) values ($1, $2, $3, $4, $5, $6)", [
    shop,
    ret,
    line,
    quantity,
    decision,
    declineReason,
  ]);
/** Moves a request's clock back (the only way a request ages: nothing in the app changes its times). */
async function age(id: string, set: string) {
  await db.exec("alter table commerce.withdrawal_requests disable trigger withdrawal_requests_rules");
  try {
    await db.query(`update commerce.withdrawal_requests set ${set} where id = $1`, [id]);
  } finally {
    await db.exec("alter table commerce.withdrawal_requests enable trigger withdrawal_requests_rules");
  }
}
const status = async (ret: string, to: string, set = "") => db.query(`update commerce.returns set status = $2${set} where id = $1`, [ret, to]);

describe("withdrawal requests", () => {
  it("start pending, expire in 24 hours, and are confirmed once, with the time set", async () => {
    const o = await paidOrder();
    const id = await request(o, { [o.lines.a]: 2 }, false);
    const row = await one<{ status: string; confirmed_at: string | null; hours: string }>(
      "select status, confirmed_at, extract(epoch from expires_at - submitted_at) / 3600 as hours from commerce.withdrawal_requests where id = $1",
      [id],
    );
    expect(row).toMatchObject({ status: "pending", confirmed_at: null });
    expect(Number(row.hours)).toBeCloseTo(24, 3);
    await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [id]);
    const confirmed = await one<{ status: string; confirmed_at: string }>("select status, confirmed_at from commerce.withdrawal_requests where id = $1", [id]);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_at).toBeTruthy();
  });

  it("cannot start confirmed, nor be confirmed by a time alone", async () => {
    const o = await paidOrder();
    await rejects(
      "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, status, confirmed_at) values ($1, $2, 'A', 'a@example.com', 'web', 'confirmed', now())",
      [shop, o.order],
      /withdrawal_starts_pending/,
    );
    const id = await request(o, { [o.lines.a]: 1 }, false);
    await rejects("update commerce.withdrawal_requests set confirmed_at = now() where id = $1", [id], /withdrawal_confirmed/);
  });

  it("is only for an order that was paid", async () => {
    for (const unpaid of ["pending_payment", "cancelled"]) {
      const o = await paidOrder({ status: unpaid });
      await rejects(
        "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'A', 'a@example.com', 'web')",
        [shop, o.order],
        /withdrawal_order_not_paid/,
      );
    }
  });

  it("refuses a confirmation without lines, or after the request lapsed", async () => {
    const o = await paidOrder();
    const none = await request(o, {}, false);
    await rejects("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [none], /withdrawal_no_lines/);
    const late = await request(o, { [o.lines.a]: 1 }, false);
    await age(late, "submitted_at = now() - interval '3 days', expires_at = now() - interval '2 days'");
    await rejects("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [late], /withdrawal_lapsed/);
    // A lapsed request marked expired cannot be brought back either.
    await db.query("update commerce.withdrawal_requests set status = 'expired' where id = $1", [late]);
    await rejects("update commerce.withdrawal_requests set status = 'pending' where id = $1", [late], /withdrawal_lapsed/);
  });

  it("holds lines within what is left of the order's line, of the same order only", async () => {
    const o = await paidOrder();
    const other = await paidOrder();
    const id = await request(o, { [o.lines.a]: 3 }, false);
    await rejects("update commerce.withdrawal_request_lines set quantity = 4 where withdrawal_request_id = $1", [id], /withdrawal_quantity/);
    await rejects(
      "insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, 1)",
      [shop, id, other.lines.a],
      /withdrawal_line_order/,
    );
  });

  it("is a record once confirmed: only its acknowledgement is recorded, never taken back, and it is never deleted", async () => {
    const o = await paidOrder();
    const id = await request(o, { [o.lines.a]: 1 });
    await rejects("update commerce.withdrawal_requests set name = 'Someone else' where id = $1", [id], /withdrawal_fixed/);
    await rejects("update commerce.withdrawal_requests set status = 'pending', confirmed_at = null where id = $1", [id], /withdrawal_confirmed/);
    await rejects("delete from commerce.withdrawal_requests where id = $1", [id], /withdrawal_confirmed/);
    await rejects("delete from commerce.withdrawal_request_lines where withdrawal_request_id = $1", [id], /withdrawal_confirmed/);
    await rejects(
      "insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, 1)",
      [shop, id, o.lines.b],
      /withdrawal_confirmed/,
    );
    await db.query("update commerce.withdrawal_requests set acknowledged_at = now(), acknowledgement_reference = 'msg-1' where id = $1", [id]);
    await rejects("update commerce.withdrawal_requests set acknowledged_at = null where id = $1", [id], /withdrawal_acknowledged|ack_after_confirm/);
  });

  it("is acknowledged only after it was confirmed, and not before the confirmation", async () => {
    const o = await paidOrder();
    const id = await request(o, { [o.lines.a]: 1 }, false);
    await rejects("update commerce.withdrawal_requests set acknowledged_at = now() where id = $1", [id], /withdrawal_requests_ack_after_confirm/);
    await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [id]);
    await rejects(
      "update commerce.withdrawal_requests set acknowledged_at = confirmed_at - interval '1 minute' where id = $1",
      [id],
      /withdrawal_requests_ack_in_order/,
    );
  });

  it("keeps the hashed guesses a day, only to limit them, and deletes older ones with the daily job", async () => {
    await db.query("select commerce.expire_withdrawal_requests()");
    await db.query("insert into commerce.withdrawal_attempts (store_id, key_kind, key_hash) values ($1, 'email', 'fresh')", [shop]);
    await db.query("insert into commerce.withdrawal_attempts (store_id, key_kind, key_hash, at) values ($1, 'order', 'old', now() - interval '2 days')", [shop]);
    await rejects("insert into commerce.withdrawal_attempts (store_id, key_kind, key_hash) values ($1, 'ip', 'x')", [shop], /withdrawal_attempts_kind/);
    await db.query("select commerce.expire_withdrawal_requests()");
    const left = await db.query<{ key_hash: string }>("select key_hash from commerce.withdrawal_attempts where store_id = $1", [shop]);
    expect(left.rows.map((row) => row.key_hash)).toEqual(["fresh"]);
    await db.query("delete from commerce.withdrawal_attempts where store_id = $1", [shop]);
  });

  it("deletes unconfirmed requests past their time, and nothing else", async () => {
    await db.query("select commerce.expire_withdrawal_requests()"); // what earlier tests left lapsed
    const o = await paidOrder();
    const lapsed = await request(o, { [o.lines.a]: 1 }, false);
    await age(lapsed, "submitted_at = now() - interval '3 days', expires_at = now() - interval '2 days'");
    const marked = await request(o, { [o.lines.a]: 1 }, false);
    await age(marked, "submitted_at = now() - interval '3 days', expires_at = now() - interval '2 days'");
    await db.query("update commerce.withdrawal_requests set status = 'expired' where id = $1", [marked]);
    const fresh = await request(o, { [o.lines.a]: 1 }, false);
    const kept = await request(o, { [o.lines.a]: 1 });
    // A confirmed one whose time has long passed is a legal record.
    await age(kept, "submitted_at = now() - interval '9 days', expires_at = now() - interval '8 days', confirmed_at = now() - interval '8 days'");
    const { n } = await one<{ n: number }>("select commerce.expire_withdrawal_requests() as n");
    expect(n).toBe(2);
    const left = await db.query<{ id: string }>("select id from commerce.withdrawal_requests where order_id = $1 order by id", [o.order]);
    expect(left.rows.map((r) => r.id).sort()).toEqual([fresh, kept].sort());
    // The lines of the deleted ones went with them.
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.withdrawal_request_lines where withdrawal_request_id = any($1::uuid[])", [[lapsed, marked]])).n)).toBe(0);
    expect((await one<{ n: number }>("select commerce.expire_withdrawal_requests() as n")).n).toBe(0);
  });
});

describe("what an order keeps for its withdrawals", () => {
  it("records who pays for sending goods back, and the standard delivery, as the store's rules stood at the sale", async () => {
    const o = await paidOrder();
    await db.query("update commerce.orders set return_cost_payer = 'shopper', standard_shipping_minor = 490 where id = $1", [o.order]);
    await db.query("update commerce.orders set return_cost_payer = null, standard_shipping_minor = null where id = $1", [o.order]);
    await rejects("update commerce.orders set return_cost_payer = 'nobody' where id = $1", [o.order], /orders_return_cost_payer/);
    await rejects("update commerce.orders set standard_shipping_minor = -1 where id = $1", [o.order], /orders_standard_shipping/);
  });

  it("finds an order by the number as typed (without spaces, in any case) through an index, not by reading every order", async () => {
    await paidOrder();
    await db.query("set enable_seqscan = off");
    try {
      const plan = await db.query<{ "QUERY PLAN": string }>(
        "explain select id from commerce.orders where store_id = $1 and upper(regexp_replace(number, '\\s', '', 'g')) = 'R-1001'",
        [shop],
      );
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("orders_number_normalised_idx");
    } finally {
      await db.query("set enable_seqscan = on");
    }
  });
});

describe("returns", () => {
  it("numbers a return {order number}-R{n}, per order, and a withdrawal return starts approved", async () => {
    const o = await paidOrder();
    const first = await withdrawalReturn(o, { [o.lines.a]: 1 });
    expect(first.number).toBe(`${o.number}-R1`);
    const second = await voluntaryReturn(o, { [o.lines.a]: 1 });
    expect(second.number).toBe(`${o.number}-R2`);
    const row = await one<{ status: string; approved_at: string | null; refund_deadline: string | null; confirmed_at: string; token: string }>(
      `select r.status, r.approved_at, r.refund_deadline, w.confirmed_at, r.public_token as token
         from commerce.returns r join commerce.withdrawal_requests w on w.id = r.withdrawal_request_id where r.id = $1`,
      [first.id],
    );
    expect(row.status).toBe("approved");
    expect(row.approved_at).toBeTruthy();
    expect(new Date(row.refund_deadline!).getTime() - new Date(row.confirmed_at).getTime()).toBe(14 * 24 * 3600 * 1000);
    expect(row.token).toHaveLength(64);
    // Another order starts again; a number is the app's to ask for, never to choose.
    const o2 = await paidOrder();
    expect((await voluntaryReturn(o2, { [o2.lines.a]: 1 })).number).toBe(`${o2.number}-R1`);
    const chosen = await one<{ number: string }>(
      "insert into commerce.returns (store_id, order_id, kind, number) values ($1, $2, 'return', 'MINE') returning number",
      [shop, o2.order],
    );
    expect(chosen.number).toBe(`${o2.number}-R2`);
  });

  it("needs a confirmed withdrawal for a withdrawal return, of the same order, and never one for a voluntary return", async () => {
    const o = await paidOrder();
    const other = await paidOrder();
    const pending = await request(o, { [o.lines.a]: 1 }, false);
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved')",
      [shop, o.order, pending],
      /return_needs_confirmed_withdrawal/,
    );
    const confirmed = await request(other, { [other.lines.a]: 1 });
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved')",
      [shop, o.order, confirmed],
      /return_needs_confirmed_withdrawal/,
    );
    await rejects("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'withdrawal', 'approved')", [shop, o.order], /return_needs_confirmed_withdrawal/);
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind) values ($1, $2, $3, 'return')",
      [shop, other.order, confirmed],
      /returns_kind_request/,
    );
    // The right is not the store's to refuse: it does not start as requested.
    const ok = await request(o, { [o.lines.a]: 1 });
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'requested')",
      [shop, o.order, ok],
      /return_lifecycle/,
    );
    // One return per withdrawal.
    await db.query("insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved')", [shop, o.order, ok]);
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved')",
      [shop, o.order, ok],
      /returns_withdrawal_request_key/,
    );
  });

  it("gives a company no statutory withdrawal, only a voluntary return, and nothing for an order not paid", async () => {
    const company = await paidOrder({ company: "Acme AS" });
    const req = await request(company, { [company.lines.a]: 1 });
    await rejects(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved')",
      [shop, company.order, req],
      /return_business_order/,
    );
    await voluntaryReturn(company, { [company.lines.a]: 1 });
    const unpaid = await paidOrder({ status: "pending_payment" });
    await rejects("insert into commerce.returns (store_id, order_id, kind) values ($1, $2, 'return')", [shop, unpaid.order], /return_order_not_paid/);
  });

  it("only moves forward, and fills in each step's time", async () => {
    const o = await paidOrder();
    const r = await withdrawalReturn(o, { [o.lines.a]: 1 });
    await rejects("update commerce.returns set status = 'requested' where id = $1", [r.id], /return_lifecycle/);
    await rejects("update commerce.returns set status = 'inspected' where id = $1", [r.id], /return_lifecycle/);
    await status(r.id, "in_transit");
    expect((await one<{ shipped_at: string | null }>("select shipped_at from commerce.returns where id = $1", [r.id])).shipped_at).toBeTruthy();
    await rejects("update commerce.returns set status = 'approved' where id = $1", [r.id], /return_lifecycle/);
    await status(r.id, "received");
    await rejects("update commerce.returns set status = 'in_transit' where id = $1", [r.id], /return_lifecycle/);
    await status(r.id, "inspected");
    await status(r.id, "closed");
    const done = await one<{ received_at: string; inspected_at: string; closed_at: string; outcome: string }>(
      "select received_at, inspected_at, closed_at, outcome from commerce.returns where id = $1",
      [r.id],
    );
    expect(done.outcome).toBe("no_refund");
    expect(new Date(done.received_at) <= new Date(done.inspected_at)).toBe(true);
    expect(new Date(done.inspected_at) <= new Date(done.closed_at)).toBe(true);
    // Ended: only a note may be added.
    await rejects("update commerce.returns set status = 'received' where id = $1", [r.id], /return_ended/);
    await rejects("update commerce.returns set instructions = 'x' where id = $1", [r.id], /return_ended/);
    await db.query("update commerce.returns set staff_note = 'Checked twice' where id = $1", [r.id]);
  });

  it("keeps the steps' times in order, never early and never moved", async () => {
    const o = await paidOrder();
    const r = await withdrawalReturn(o, { [o.lines.a]: 1 });
    await rejects("update commerce.returns set received_at = now() where id = $1", [r.id], /return_times/);
    await status(r.id, "received");
    await rejects("update commerce.returns set received_at = received_at + interval '1 hour' where id = $1", [r.id], /return_times/);
    await rejects("update commerce.returns set inspected_at = now() where id = $1", [r.id], /return_times/);
    await rejects(
      "update commerce.returns set shipped_at = received_at + interval '1 hour' where id = $1",
      [r.id],
      /returns_times_in_order/,
    );
  });

  it("declines a voluntary return with a reason, never a withdrawal return, and cancels either", async () => {
    const o = await paidOrder();
    const withdrawal = await withdrawalReturn(o, { [o.lines.a]: 1 });
    await rejects("update commerce.returns set status = 'declined', decision_note = 'No' where id = $1", [withdrawal.id], /return_withdrawal_not_declinable/);
    const voluntary = await voluntaryReturn(o, { [o.lines.a]: 1 });
    await rejects("update commerce.returns set status = 'declined' where id = $1", [voluntary.id], /return_decline_reason/);
    await db.query("update commerce.returns set status = 'declined', decision_note = 'Outside our window' where id = $1", [voluntary.id]);
    expect((await one<{ outcome: string }>("select outcome from commerce.returns where id = $1", [voluntary.id])).outcome).toBe("declined");
    await rejects("update commerce.returns set status = 'approved' where id = $1", [voluntary.id], /return_ended/);
    // A voluntary return can be cancelled; a withdrawal cannot (it is effective on the statement): it is closed instead.
    const another = await voluntaryReturn(o, {});
    await db.query("update commerce.returns set status = 'cancelled' where id = $1", [another.id]);
    expect((await one<{ outcome: string }>("select outcome from commerce.returns where id = $1", [another.id])).outcome).toBe("cancelled");
  });

  it("never cancels a withdrawal return, from any status: the withdrawal and its refund deadline stay on record, and it is closed without a refund instead", async () => {
    const o = await paidOrder();
    const withdrawal = await withdrawalReturn(o, { [o.lines.a]: 1 });
    for (const via of [[], ["in_transit"], ["in_transit", "received"]]) {
      for (const step of via) await db.query("update commerce.returns set status = $2 where id = $1", [withdrawal.id, step]);
      await rejects("update commerce.returns set status = 'cancelled' where id = $1", [withdrawal.id], /return_withdrawal_not_cancellable/);
    }
    await db.query("update commerce.returns set status = 'closed' where id = $1", [withdrawal.id]);
    const closed = await one<{ outcome: string; refund_deadline: string | null }>("select outcome, refund_deadline from commerce.returns where id = $1", [withdrawal.id]);
    expect(closed.outcome).toBe("no_refund");
    expect(closed.refund_deadline).toBeTruthy();
  });

  it("is never deleted, nor its lines", async () => {
    const o = await paidOrder();
    const r = await withdrawalReturn(o, { [o.lines.a]: 1 });
    await rejects("delete from commerce.returns where id = $1", [r.id], /return_kept/);
    await rejects("delete from commerce.return_lines where return_id = $1", [r.id], /return_kept/);
    await rejects("update commerce.returns set order_id = $2 where id = $1", [r.id, (await paidOrder()).order], /return_fixed/);
    await rejects("update commerce.returns set number = 'X' where id = $1", [r.id], /return_fixed/);
  });

  it("holds the field checks: reasons, lengths, an https label", async () => {
    const o = await paidOrder();
    const r = await voluntaryReturn(o, { [o.lines.a]: 1 });
    await db.query("update commerce.returns set reason = 'changed_mind', reason_note = 'Too big', label_url = 'https://label.example/1' where id = $1", [r.id]);
    await rejects("update commerce.returns set reason = 'because' where id = $1", [r.id], /returns_reason/);
    await rejects("update commerce.returns set reason_note = repeat('x', 501) where id = $1", [r.id], /returns_reason_note/);
    await rejects("update commerce.returns set label_url = 'http://label.example/1' where id = $1", [r.id], /returns_label_url/);
  });
});

describe("the lifecycle table of the app", () => {
  /** A return of a kind brought to a status by the steps the app takes. */
  async function reach(o: Made, kind: ReturnKind, target: ReturnStatus): Promise<string | null> {
    // No lines on the return: only the status moves are under test, so no units are taken from the order.
    const ret =
      kind === "withdrawal"
        ? (
            await one<{ id: string }>(
              "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id",
              [shop, o.order, await request(o, { [o.lines.a]: 1 })],
            )
          ).id
        : (await voluntaryReturn(o, {})).id;
    const path: Record<ReturnStatus, string[]> = {
      requested: [],
      approved: ["approved"],
      in_transit: ["approved", "in_transit"],
      received: ["approved", "received"],
      inspected: ["approved", "received", "inspected"],
      closed: ["approved", "received", "closed"],
      declined: ["declined"],
      cancelled: ["cancelled"],
    };
    if (kind === "withdrawal" && target === "requested") return null;
    if (kind === "withdrawal" && target === "declined") return null;
    if (kind === "withdrawal" && target === "cancelled") return null;
    for (const step of path[target]) {
      if (kind === "withdrawal" && step === "approved") continue; // starts approved
      await db.query("update commerce.returns set status = $2, decision_note = 'Because' where id = $1", [ret, step]);
    }
    return ret;
  }

  it("accepts exactly the moves `canMove()` offers, for both kinds", async () => {
    const o = await paidOrder();
    for (const kind of RETURN_KINDS) {
      for (const from of RETURN_STATUSES) {
        for (const to of RETURN_STATUSES) {
          if (from === to) continue;
          const ret = await reach(o, kind, from);
          if (!ret) continue;
          let accepted = true;
          try {
            await db.query("update commerce.returns set status = $2, decision_note = 'Because' where id = $1", [ret, to]);
          } catch {
            accepted = false;
          }
          expect([kind, from, to, accepted]).toEqual([kind, from, to, canMove(kind, from, to)]);
        }
      }
    }
  });

  it("holds the same reasons as the app's list", async () => {
    const o = await paidOrder();
    const r = await voluntaryReturn(o, {});
    for (const reason of RETURN_REASONS) await db.query("update commerce.returns set reason = $2 where id = $1", [r.id, reason]);
  });
});

describe("return lines", () => {
  it("take only what is left of the order line, over every return not declined or cancelled", async () => {
    const o = await paidOrder();
    await voluntaryReturn(o, { [o.lines.a]: 2 });
    const second = await voluntaryReturn(o, {});
    await rejects(
      "insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 2)",
      [shop, second.id, o.lines.a],
      /return_quantity: only 1 of 3 is left/,
    );
    await addLine(second.id, o.lines.a, 1);
    const third = await voluntaryReturn(o, {});
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, third.id, o.lines.a], /return_quantity: only 0 of 3/);
  });

  it("give their units back when the return is declined or cancelled, or the line is declined", async () => {
    const o = await paidOrder();
    const first = await voluntaryReturn(o, { [o.lines.a]: 3 });
    const second = await voluntaryReturn(o, {});
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, second.id, o.lines.a], /return_quantity/);
    await db.query("update commerce.returns set status = 'declined', decision_note = 'No' where id = $1", [first.id]);
    await addLine(second.id, o.lines.a, 3);
    await db.query("update commerce.returns set status = 'cancelled' where id = $1", [second.id]);
    const third = await voluntaryReturn(o, { [o.lines.a]: 3 });
    // A line declined on a voluntary return counts for nothing.
    const fourth = await voluntaryReturn(o, {});
    await db.query("update commerce.return_lines set decision = 'decline', decline_reason = 'Used' where return_id = $1", [third.id]);
    await addLine(fourth.id, o.lines.a, 3);
    // ... and cannot be taken back into a count that no longer has room.
    await rejects("update commerce.return_lines set decision = 'accept', decline_reason = null where return_id = $1", [third.id], /return_quantity/);
  });

  it("are counted under a lock on the line: the same units cannot be taken by two returns", async () => {
    const o = await paidOrder();
    const a = await voluntaryReturn(o, {});
    const b = await voluntaryReturn(o, {});
    const take = (ret: string) =>
      db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 2)", [shop, ret, o.lines.a]);
    const results = await Promise.allSettled([take(a.id), take(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("of a withdrawal accept sealed goods (the right lasts until they are unsealed), and still refuse a line the law excludes outright", async () => {
    const o = await paidOrder();
    const sealed = (
      await one<{ id: string }>(
        `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion)
         values ($1, $2, 'SEALED', 'Sealed', 1, 500, 500, 0, 0.19, 'txcd_99999999', 'sealed_hygiene') returning id`,
        [shop, o.order],
      )
    ).id;
    const media = (
      await one<{ id: string }>(
        `insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion)
         values ($1, $2, 'MEDIA', 'Media', 1, 500, 500, 0, 0.19, 'txcd_99999999', 'sealed_media') returning id`,
        [shop, o.order],
      )
    ).id;
    const req = await request(o, { [sealed]: 1, [media]: 1, [o.lines.b]: 1 });
    const r = await one<Ret>(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id, number",
      [shop, o.order, req],
    );
    await addLine(r.id, sealed, 1);
    await addLine(r.id, media, 1);
    // The perishable line is still refused as accepted, and the sealed line can still be declined at the inspection (the seal was broken).
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, r.id, o.lines.b], /return_excluded/);
    await db.query("update commerce.return_lines set decision = 'decline', decline_reason = 'The seal was broken' where return_id = $1 and order_line_id = $2", [r.id, media]);
    expect((await one<{ decision: string }>("select decision from commerce.return_lines where return_id = $1 and order_line_id = $2", [r.id, media])).decision).toBe("decline");
  });

  it("of a withdrawal hold only what was declared, accept only a line the law leaves the right on, and decline the rest", async () => {
    const o = await paidOrder();
    const req = await request(o, { [o.lines.a]: 2, [o.lines.b]: 1 });
    const r = await one<Ret>(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id, number",
      [shop, o.order, req],
    );
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 3)", [shop, r.id, o.lines.a], /return_not_declared/);
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, r.id, o.lines.b], /return_excluded/);
    await addLine(r.id, o.lines.b, 1, "decline", "Perishable goods are excluded by law");
    await rejects(
      "insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision, decline_reason) values ($1, $2, $3, 2, 'decline', 'No')",
      [shop, r.id, o.lines.a],
      /return_decline_withdrawal/,
    );
    await addLine(r.id, o.lines.a, 2);
    // A line that was not declared at all is not part of this withdrawal.
    const o2 = await paidOrder();
    const req2 = await request(o2, { [o2.lines.a]: 1 });
    const r2 = await one<Ret>(
      "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id, number",
      [shop, o2.order, req2],
    );
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, r2.id, o2.lines.b], /return_not_declared/);
  });

  it("belong to the return's own order, and need a reason to be declined", async () => {
    const o = await paidOrder();
    const other = await paidOrder();
    const r = await voluntaryReturn(o, {});
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, r.id, other.lines.a], /return_line_order/);
    await rejects(
      "insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values ($1, $2, $3, 1, 'decline')",
      [shop, r.id, o.lines.a],
      /return_lines_decline_reason/,
    );
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 0)", [shop, r.id, o.lines.a], /return_lines_quantity_positive/);
  });

  it("are not changed in quantity, only inspected once the goods have arrived, and never past the line's value", async () => {
    const o = await paidOrder();
    const r = await withdrawalReturn(o, { [o.lines.a]: 2 });
    await rejects("update commerce.return_lines set quantity = 1 where return_id = $1", [r.id], /return_fixed/);
    await rejects("update commerce.return_lines set condition = 'used' where return_id = $1", [r.id], /return_not_received/);
    await rejects("update commerce.return_lines set deduction_minor = 100 where return_id = $1", [r.id], /return_not_received/);
    await db.query("update commerce.return_lines set restock = true where return_id = $1", [r.id]);
    await status(r.id, "received");
    await db.query("update commerce.return_lines set condition = 'opened', deduction_minor = 500, deduction_note = 'Opened, used once' where return_id = $1", [r.id]);
    // Two units of 1000 each: a deduction is at most 2000.
    await db.query("update commerce.return_lines set deduction_minor = 2000 where return_id = $1", [r.id]);
    await rejects("update commerce.return_lines set deduction_minor = 2001 where return_id = $1", [r.id], /return_deduction/);
    await rejects("update commerce.return_lines set condition = 'broken' where return_id = $1", [r.id], /return_lines_condition/);
    await status(r.id, "inspected");
    await status(r.id, "closed");
    await rejects("update commerce.return_lines set restock = false where return_id = $1", [r.id], /return_ended/);
  });

  it("take no more lines once the goods are on their way", async () => {
    const o = await paidOrder();
    const r = await withdrawalReturn(o, { [o.lines.a]: 1 });
    await status(r.id, "in_transit");
    await rejects("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values ($1, $2, $3, 1)", [shop, r.id, o.lines.b], /return_locked/);
  });
});

describe("refunds on a return", () => {
  async function approvedWithRefund(o: Made) {
    const r = await withdrawalReturn(o, { [o.lines.a]: 3 });
    await status(r.id, "received");
    return r;
  }

  it("are recorded once, never above what was paid, and close the return as refunded", async () => {
    const o = await paidOrder();
    const r = await approvedWithRefund(o);
    await rejects("update commerce.returns set refund_minor = 4491, refund_outside = true where id = $1", [r.id], /return_refund_over_paid/);
    await db.query("update commerce.returns set refund_computed_minor = 3490, refund_minor = 3490, refund_outside = true where id = $1", [r.id]);
    expect((await one<{ refunded_at: string }>("select refunded_at from commerce.returns where id = $1", [r.id])).refunded_at).toBeTruthy();
    await rejects("update commerce.returns set refund_minor = 100 where id = $1", [r.id], /return_refund_recorded/);
    await status(r.id, "closed");
    expect((await one<{ outcome: string }>("select outcome from commerce.returns where id = $1", [r.id])).outcome).toBe("refunded");
  });

  it("add up over an order's returns to at most what was paid", async () => {
    const o = await paidOrder();
    const first = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    const second = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    await db.query("update commerce.returns set refund_minor = 3000, refund_outside = true where id = $1", [first.id]);
    await rejects("update commerce.returns set refund_minor = 1491, refund_outside = true where id = $1", [second.id], /return_refund_over_paid/);
    await db.query("update commerce.returns set refund_minor = 1490, refund_outside = true where id = $1", [second.id]);
  });

  it("gives back an order's delivery once in all, as part of the refund and never more than was paid for it", async () => {
    const o = await paidOrder();
    const first = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    const second = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    // Delivery is 490: it is part of the refund, so it cannot be more than the refund.
    await rejects("update commerce.returns set refund_minor = 400, shipping_refund_minor = 490, refund_outside = true where id = $1", [first.id], /return_refund_shipping/);
    await db.query("update commerce.returns set refund_minor = 1490, shipping_refund_minor = 490, refund_outside = true where id = $1", [first.id]);
    // Another return of the order cannot give the delivery back again.
    await rejects("update commerce.returns set refund_minor = 1490, shipping_refund_minor = 1, refund_outside = true where id = $1", [second.id], /return_refund_shipping/);
    await db.query("update commerce.returns set refund_minor = 1000, shipping_refund_minor = 0, refund_outside = true where id = $1", [second.id]);
    // And what a return gave back of the delivery is not changed afterwards.
    await rejects("update commerce.returns set shipping_refund_minor = 0 where id = $1", [first.id], /return_refund_recorded/);
    await rejects("update commerce.returns set shipping_refund_minor = -1 where id = $1", [second.id], /returns_amounts|return_refund_recorded/);
  });

  it("claims a refund on the return without disturbing the rules, and a claim never outlives the refund", async () => {
    const o = await paidOrder();
    const r = await approvedWithRefund(o);
    await db.query("update commerce.returns set refund_claimed_at = now() where id = $1", [r.id]);
    await db.query("update commerce.returns set refund_claimed_at = null where id = $1", [r.id]);
    await db.query("update commerce.returns set refund_claimed_at = now() where id = $1", [r.id]);
    await db.query("update commerce.returns set refund_minor = 3000, refund_outside = true, refund_claimed_at = null where id = $1", [r.id]);
    expect((await one<{ c: string | null }>("select refund_claimed_at as c from commerce.returns where id = $1", [r.id])).c).toBeNull();
  });

  it("falls back to the order's total when no payment was recorded (paid outside Stripe)", async () => {
    const o = await paidOrder({ payments: null });
    const r = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    await rejects("update commerce.returns set refund_minor = 4491, refund_outside = true where id = $1", [r.id], /return_refund_over_paid/);
    await db.query("update commerce.returns set refund_minor = 4490, refund_outside = true where id = $1", [r.id]);
  });

  it("are made after approval only, and a Stripe refund must be this order's, for the amount recorded", async () => {
    const o = await paidOrder();
    const asked = await voluntaryReturn(o, { [o.lines.a]: 1 });
    await rejects("update commerce.returns set refund_minor = 100, refund_outside = true where id = $1", [asked.id], /return_refund_state/);
    const r = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    const other = await paidOrder();
    const foreign = (
      await one<{ id: string }>(
        "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, 1000, 'x', 'succeeded') returning id",
        [shop, other.payment],
      )
    ).id;
    await rejects("update commerce.returns set refund_id = $2, refund_minor = 1000 where id = $1", [r.id, foreign], /return_refund_match/);
    const mine = (
      await one<{ id: string }>(
        "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, 1000, 'x', 'succeeded') returning id",
        [shop, o.payment],
      )
    ).id;
    await rejects("update commerce.returns set refund_id = $2, refund_minor = 900 where id = $1", [r.id, mine], /return_refund_match/);
    await db.query("update commerce.returns set refund_id = $2, refund_minor = 1000 where id = $1", [r.id, mine]);
    // One refund pays one return.
    const next = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    await rejects("update commerce.returns set refund_id = $2, refund_minor = 1000 where id = $1", [next.id, mine], /returns_refund_key|return_refund_/);
  });

  it("close with an outcome that matches: refunded has a refund, no_refund has none", async () => {
    const o = await paidOrder();
    const r = await voluntaryReturn(o, { [o.lines.a]: 1 }, "approved");
    await rejects("update commerce.returns set status = 'closed', outcome = 'refunded' where id = $1", [r.id], /return_outcome/);
    // Nothing to give back (everything deducted, or only restocked) is a refund of nothing, and closes with no refund.
    await db.query("update commerce.returns set refund_minor = 0 where id = $1", [r.id]);
    await rejects("update commerce.returns set status = 'closed', outcome = 'refunded' where id = $1", [r.id], /return_outcome/);
    await db.query("update commerce.returns set status = 'closed' where id = $1", [r.id]);
    expect((await one<{ outcome: string }>("select outcome from commerce.returns where id = $1", [r.id])).outcome).toBe("no_refund");
  });
});

describe("copied orders", () => {
  it("take no withdrawal request and no return", async () => {
    const original = await paidOrder();
    const { id: copy } = await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
         discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
       values ($1, $2, 'DE', 'EUR', 'de-DE', 'shopper@example.com', 'paid', 1000, 0, 0, 100, 1000, '{}', '{}', $3) returning id`,
      [shop, `C-${original.number}`, original.order],
    );
    await rejects(
      "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'A', 'a@example.com', 'web')",
      [shop, copy],
      /copied_order/,
    );
    await rejects("insert into commerce.returns (store_id, order_id, kind) values ($1, $2, 'return')", [shop, copy], /copied_order/);
  });
});

describe("return settings", () => {
  it("default to the legal rules, with row-level security on, and hold their ranges", async () => {
    await db.query("insert into commerce.return_settings (store_id) values ($1)", [shop]);
    const row = await one<Record<string, unknown>>("select * from commerce.return_settings where store_id = $1", [shop]);
    expect(row).toMatchObject({
      window_days: 14,
      transit_days: 3,
      who_pays_return: "shopper",
      refund_when: "received",
      accept_excluded: false,
      instructions: "",
      return_address: null,
      b2b_returns: false,
    });
    expect((await one<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'commerce' and c.relname = 'return_settings'")).relrowsecurity).toBe(true);
    await rejects("update commerce.return_settings set window_days = 13 where store_id = $1", [shop], /return_settings_window/);
    await rejects("update commerce.return_settings set window_days = 101 where store_id = $1", [shop], /return_settings_window/);
    await rejects("update commerce.return_settings set transit_days = 15 where store_id = $1", [shop], /return_settings_transit/);
    await rejects("update commerce.return_settings set transit_days = -1 where store_id = $1", [shop], /return_settings_transit/);
    await rejects("update commerce.return_settings set who_pays_return = 'carrier' where store_id = $1", [shop], /return_settings_who_pays/);
    await rejects("update commerce.return_settings set refund_when = 'later' where store_id = $1", [shop], /return_settings_refund_when/);
    await rejects("update commerce.return_settings set instructions = repeat('x', 2001) where store_id = $1", [shop], /return_settings_instructions/);
    await db.query("update commerce.return_settings set window_days = 30, transit_days = 0, who_pays_return = 'store' where store_id = $1", [shop]);
  });

  it("are copied with a store (clone_store and duplicate_store), and only they", async () => {
    await db.query(
      `update commerce.return_settings set window_days = 30, transit_days = 5, who_pays_return = 'store', refund_when = 'request',
         accept_excluded = true, instructions = 'Pack it well.', b2b_returns = true,
         instructions_translations = '{"sv":"Packa väl."}'::jsonb,
         return_address = '{"name":"Returns","street":"Lager 1","postalCode":"0150","city":"Oslo","country":"NO"}'::jsonb
       where store_id = $1`,
      [shop],
    );
    // Something that must stay behind with the original.
    const o = await paidOrder();
    await voluntaryReturn(o, { [o.lines.a]: 1 });
    const same = `select window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, instructions_translations, b2b_returns, return_address
                    from commerce.return_settings where store_id = $1`;
    const want = await one(same, [shop]);

    const { id: cloned } = await one<{ id: string }>("select commerce.clone_store($1, 'ret-clone', 'Clone', $2) as id", [shop, owner]);
    expect(await one(same, [cloned])).toEqual(want);
    const { id: duplicated } = await one<{ id: string }>("select commerce.duplicate_store($1, 'ret-dup', 'Dup', $2) as id", [shop, owner]);
    expect(await one(same, [duplicated])).toEqual(want);
    for (const copy of [cloned, duplicated]) {
      for (const table of ["returns", "return_lines", "withdrawal_requests", "withdrawal_request_lines"]) {
        expect([table, Number((await one<{ n: string }>(`select count(*) as n from commerce.${table} where store_id = $1`, [copy])).n)]).toEqual([table, 0]);
      }
    }
    // A store without a row has none to copy, and gets none made up.
    const { id: bare } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ('ret-bare', 'Bare') returning id");
    const { id: fromBare } = await one<{ id: string }>("select commerce.duplicate_store($1, 'ret-bare-copy', 'Copy', $2) as id", [bare, owner]);
    expect(Number((await one<{ n: string }>("select count(*) as n from commerce.return_settings where store_id = $1", [fromBare])).n)).toBe(0);
  });

  it("are a settings table in the copy rules, and the processes stay behind", () => {
    expect(COPY_RULES.return_settings?.group).toBe("settings");
    for (const table of ["returns", "return_lines", "withdrawal_requests", "withdrawal_request_lines"]) {
      expect([table, COPY_RULES[table]?.group]).toEqual([table, "never"]);
    }
  });
});
