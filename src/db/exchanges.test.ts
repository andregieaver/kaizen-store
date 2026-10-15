/* eslint-disable @typescript-eslint/no-explicit-any -- rows and snapshots are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { creditNoteSnapshot, parseWorking } from "@/lib/credit-allocation";
import { exchangeBlock, type ExchangeFacts } from "@/lib/exchange";
import { EXCHANGES_PER_RETURN_MAX, EXCHANGE_LINES_MAX, EXCHANGE_QUANTITY_MAX, EXCHANGE_WISH_NOTE_MAX } from "@/lib/exchange-limits";
import { EXCHANGE_STATUSES, EXCHANGE_TRANSITIONS, type ExchangeStatus } from "@/lib/exchange-status";
import { MOVEMENT_SOURCES } from "@/lib/inventory";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0, type OrderSpec } from "./invoice-fixture";
import { newVariant, transaction, type Tx } from "./order-edit-fixture";
import { createTestDatabase } from "./testing";

/**
 * Exchanges and return labels (wave 3, D239, docs/wave-3-exchanges.md 3.3): every rule the database holds, against every migration applied to a real Postgres
 * (PGlite). Exchanges are written the way `src/server/exchanges.ts` writes them: proposed with their replacements in one transaction; processed under the
 * exchange context (`kaizen.exchange`) by inserting the exchange order and its lines; settled by the transfer pair, the remainder or the difference, the
 * return's refund and `commerce.complete_exchange_order()` in one transaction.
 */

let db: PGlite;
let store: string;
let account: string;
let counter = 0;
const next = () => (counter += 1);

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const tx = (fn: (t: Tx) => Promise<void>) => transaction(db, fn);
const hash = () => {
  const n = String(next()).padStart(6, "0");
  return `h${n}`.padEnd(43, "x");
};

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "exc-a");
  account = await scalar<string>("insert into commerce.accounts (email) values ('exc-staff@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

/** A paid order of two units of A at 100,00 and shipping 49,00 (an invoice of its own). */
async function paid(spec: Partial<OrderSpec> = {}, s = store) {
  return placeOrder(db, s, { lines: [{ sku: "A", quantity: 2, unit: 10000 }], shipping: 4900, ...spec });
}

/** A confirmed withdrawal of units of a line: a return that starts approved (D153). */
async function withdrawal(orderId: string, lineId: string, quantity = 1, s = store): Promise<string> {
  const req = await scalar<string>(
    "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'A Shopper', 'shopper@example.com', 'web') returning id",
    [s, orderId],
  );
  await db.query("insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, $4)", [s, req, lineId, quantity]);
  await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [req]);
  const ret = await scalar<string>(
    "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id",
    [s, orderId, req],
  );
  await db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values ($1, $2, $3, $4, 'accept')", [s, ret, lineId, quantity]);
  return ret;
}

/** A voluntary return the store approved. */
async function voluntary(orderId: string, lineId: string, quantity = 1, s = store, status = "approved"): Promise<string> {
  const ret = await scalar<string>("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', $3) returning id", [s, orderId, status]);
  await db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values ($1, $2, $3, $4, 'accept')", [s, ret, lineId, quantity]);
  return ret;
}

type Replacement = { variant: string; quantity?: number; unit: number; list?: number };
type ProposeOptions = { credit?: number; shipping?: number; status?: "draft" | "proposed"; lines?: Replacement[] };

/** A proposal with its replacements, written in one transaction; T is the replacements plus the shipping, C the credit given. */
async function propose(ret: string, orderId: string, lines: Replacement[], o: ProposeOptions = {}, s = store): Promise<{ id: string; total: number; credit: number }> {
  const credit = o.credit ?? 10000;
  const shipping = o.shipping ?? 0;
  const total = lines.reduce((sum, l) => sum + l.unit * (l.quantity ?? 1), 0) + shipping;
  let id = "";
  await tx(async (t) => {
    id = (
      await t.query<{ id: string }>(
        `insert into commerce.return_exchanges (store_id, return_id, order_id, seq, status, currency, market_slug, shipping_kind, shipping_minor, delivery_address,
           credit_minor, total_minor, difference_minor, token_hash, expires_at, made_by)
         values ($1, $2, $3, 0, $4, (select currency from commerce.orders where id = $3), 'no', $5, $6, '{"name":"Kari"}'::jsonb, $7, $8, $9, $10, now() + interval '7 days', $11)
         returning id`,
        [s, ret, orderId, o.status ?? "proposed", shipping > 0 ? "set" : "free", shipping, credit, total, total - credit, hash(), account],
      )
    ).rows[0].id;
    for (const [i, l] of lines.entries()) {
      await t.query(
        "insert into commerce.return_exchange_lines (store_id, exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor) values ($1, $2, $3, $4, $5, 'Replacement', $6, $7, $8)",
        [s, id, i + 1, l.variant, `R-${i}`, l.quantity ?? 1, l.list ?? l.unit, l.unit],
      );
    }
  });
  return { id, total, credit };
}

const confirm = (id: string, by: "customer" | "staff" = "customer") =>
  db.query("update commerce.return_exchanges set status = 'confirmed', confirmed_by = $2, confirmed_channel = $3 where id = $1", [id, by, by === "customer" ? "web" : "phone"]);

/** Step (a): the exchange order and its lines under the exchange context, and the exchange processed. */
async function processExchange(id: string, s = store): Promise<string> {
  const e = await one<any>("select * from commerce.return_exchanges where id = $1", [id]);
  const original = await one<any>("select * from commerce.orders where id = $1", [e.order_id]);
  const lines = await rows<any>("select * from commerce.return_exchange_lines where exchange_id = $1 order by n", [id]);
  let orderId = "";
  await tx(async (t) => {
    await t.query("select set_config('kaizen.exchange', $1, true)", [id]);
    const number = await t.query<{ n: string }>("select commerce.next_document_number($1, 'order')::text as n", [s]);
    const goods = lines.reduce((sum, l) => sum + Number(l.unit_price_minor) * l.quantity, 0);
    const shipping = Number(e.shipping_minor);
    const tax = lines.reduce((sum, l) => sum + Math.round((Number(l.unit_price_minor) * l.quantity * 20) / 100), 0) + Math.round((shipping * 20) / 100);
    orderId = (
      await t.query<{ id: string }>(
        `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
           billing_address, shipping_address, source, exchange_id, made_by, vat_kind)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11::jsonb, $11::jsonb, 'exchange', $12, $13, 'standard') returning id`,
        [s, `EX-${number.rows[0].n}`, original.market_code, original.currency, original.locale, original.email, goods, shipping, tax, goods + shipping,
          JSON.stringify(original.shipping_address), id, account],
      )
    ).rows[0].id;
    for (const l of lines) {
      const total = Number(l.unit_price_minor) * l.quantity;
      await t.query(
        `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
         values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 0.25, 'txcd_99999999', 'physical')`,
        [s, orderId, l.variant_id, l.sku, l.title, l.quantity, l.unit_price_minor, total, Math.round((total * 20) / 100)],
      );
    }
    await t.query(
      `update commerce.return_exchanges set status = 'processed', exchange_order_id = $2, credit_at_processing = credit_minor, difference_at_processing = difference_minor
        where id = $1`,
      [id, orderId],
    );
  });
  return orderId;
}

type SettleOptions = { payWith?: "manual" | "stripe"; transfer?: number; credit?: number; outcomeOnly?: boolean };

/** Step (b): the transfer pair, the remainder or the difference, the return's refund, the order completed. Returns the refund and payment ids. */
async function settle(id: string, o: SettleOptions = {}, s = store) {
  const e = await one<any>("select * from commerce.return_exchanges where id = $1", [id]);
  const ret = await one<any>("select * from commerce.returns where id = $1", [e.return_id]);
  const order = await one<any>("select * from commerce.orders where id = $1", [e.exchange_order_id]);
  const original = await one<any>("select * from commerce.payments where order_id = $1 and provider <> 'exchange' order by created_at limit 1", [e.order_id]);
  const credit = o.credit ?? Number(e.credit_at_processing);
  const total = Number(order.total_minor);
  const transfer = o.transfer ?? Math.min(credit, total);
  const ids: { transfer?: string; payment?: string; remainder?: string; difference?: string } = {};
  await tx(async (t) => {
    await t.query("select set_config('kaizen.exchange', $1, true)", [id]);
    if (transfer > 0) {
      ids.transfer = (
        await t.query<{ id: string }>(
          "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id) values ($1, $2, $3, 'Exchange', 'succeeded', 'transfer', $4) returning id",
          [s, original.id, transfer, id],
        )
      ).rows[0].id;
      ids.payment = (
        await t.query<{ id: string }>(
          `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, exchange_id, transfer_refund_id)
           values ($1, $2, 'exchange', $3, $4, $5, 'captured', $6, $7) returning id`,
          [s, order.id, `exchange:${ids.transfer}`, transfer, order.currency, id, ids.transfer],
        )
      ).rows[0].id;
    }
    if (credit > total) {
      ids.remainder = (
        await t.query<{ id: string }>(
          "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference, exchange_id) values ($1, $2, $3, 'Exchange', 'succeeded', $4, $5) returning id",
          [s, original.id, credit - total, `re_x_${next()}`, id],
        )
      ).rows[0].id;
    }
    if (total > credit) {
      const manual = (o.payWith ?? "manual") === "manual";
      ids.difference = (
        await t.query<{ id: string }>(
          `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, exchange_id, method, recorded_by)
           values ($1, $2, $3, $4, $5, $6, 'captured', $7, $8, $9) returning id`,
          [s, order.id, manual ? "manual" : "stripe", `diff_${next()}`, total - credit, order.currency, id, manual ? "cash" : null, manual ? account : null],
        )
      ).rows[0].id;
    }
    const lines = await t.query<any>("select order_line_id, quantity from commerce.return_lines where return_id = $1", [ret.id]);
    const working = {
      lines: lines.rows.map((l) => ({ lineId: l.order_line_id, quantity: l.quantity, valueMinor: credit, deductionMinor: 0 })),
      deliveryMinor: 0,
      returnShippingMinor: 0,
      adjustmentMinor: 0,
      amountMinor: credit,
      outside: false,
    };
    await t.query(
      "update commerce.returns set refund_minor = $2, refund_computed_minor = $2, refund_working = $3::jsonb, refund_id = $4, outcome = 'exchanged' where id = $1",
      [ret.id, credit, JSON.stringify(working), ids.remainder ?? null],
    );
    if (!o.outcomeOnly) await t.query("select commerce.complete_exchange_order($1)", [id]);
  });
  return ids;
}

/** An original order, a withdrawal of one unit of A (C = 100,00) and a replacement variant. */
async function scene(kind: "withdrawal" | "voluntary" = "withdrawal", spec: Partial<OrderSpec> = {}) {
  const order = await paid(spec);
  const ret = kind === "withdrawal" ? await withdrawal(order.id, order.lineIds[0]) : await voluntary(order.id, order.lineIds[0]);
  const variant = await newVariant(db, store);
  return { order, ret, variant };
}

// ---------------------------------------------------------------------------------------------------------------------

describe("the tables (3.2, 3.7)", () => {
  it("has row-level security on, a store id on every row, and is never copied", async () => {
    for (const table of ["return_exchanges", "return_exchange_lines"]) {
      expect(await scalar<boolean>("select relrowsecurity from pg_class where oid = $1::regclass", [`commerce.${table}`])).toBe(true);
      expect(await scalar<boolean>("select exists (select 1 from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = 'store_id' and is_nullable = 'NO')", [table])).toBe(true);
      expect(COPY_RULES[table]?.group).toBe("never");
    }
  });

  it("knows the exchange as a source of stock movements", () => {
    expect(MOVEMENT_SOURCES).toContain("exchange");
  });

  it("pins the limits in the checks", async () => {
    const def = (name: string) => scalar<string>("select pg_get_constraintdef(oid) from pg_constraint where conname = $1", [name]);
    expect(await def("return_exchanges_seq")).toContain(`${EXCHANGES_PER_RETURN_MAX}`);
    expect(await def("return_exchange_lines_n")).toContain(`${EXCHANGE_LINES_MAX}`);
    expect(await def("return_exchange_lines_quantity")).toContain(`${EXCHANGE_QUANTITY_MAX}`);
    expect(await def("returns_exchange_wish")).toContain(`${EXCHANGE_WISH_NOTE_MAX}`);
  });
});

describe("the lifecycle (3.3 point 1)", () => {
  it("is the table of src/lib/exchange-status.ts", async () => {
    const fn = await scalar<string>("select pg_get_functiondef('commerce.return_exchanges_rules()'::regprocedure)");
    const found: Record<string, string[]> = {};
    for (const m of fn.matchAll(/\(v_old = '(\w+)' AND v_new IN \(([^)]*)\)\)/g)) found[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const status of EXCHANGE_STATUSES) {
      expect([status, (found[status] ?? []).sort()]).toEqual([status, [...EXCHANGE_TRANSITIONS[status as ExchangeStatus]].sort()]);
    }
  });

  it("goes draft, proposed, confirmed, processed, settled, and each step keeps its time", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 12000 }], { status: "draft" });
    expect(await scalar("select seq from commerce.return_exchanges where id = $1", [e.id])).toBe(1);
    await db.query("update commerce.return_exchanges set status = 'proposed' where id = $1", [e.id]);
    await confirm(e.id);
    const confirmed = await one<any>("select confirmed_at, status from commerce.return_exchanges where id = $1", [e.id]);
    expect(confirmed.status).toBe("confirmed");
    await rejects("update commerce.return_exchanges set confirmed_at = now() + interval '1 day' where id = $1", [e.id], /exchange\.times/);
    await processExchange(e.id);
    await settle(e.id);
    const done = await one<any>("select status, settled_at is not null as settled, processed_at is not null as processed from commerce.return_exchanges where id = $1", [e.id]);
    expect(done).toEqual({ status: "settled", settled: true, processed: true });
    await rejects("update commerce.return_exchanges set status = 'cancelled' where id = $1", [e.id], /exchange\.ended/);
    // The token hash alone may go, 90 days after (application code).
    await db.query("update commerce.return_exchanges set token_hash = null where id = $1", [e.id]);
    await rejects("update commerce.return_exchanges set token_hash = $2 where id = $1", [e.id, hash()], /exchange\.ended/);
  });

  it("refuses a step the table does not have, a delete, and a start other than a draft or a proposal", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await rejects("update commerce.return_exchanges set status = 'settled' where id = $1", [e.id], /exchange\.lifecycle|return_exchanges_lifecycle/);
    await rejects("update commerce.return_exchanges set status = 'draft' where id = $1", [e.id], /exchange\.lifecycle/);
    await rejects("delete from commerce.return_exchanges where id = $1", [e.id], /exchange\.kept/);
    await db.query("update commerce.return_exchanges set status = 'cancelled' where id = $1", [e.id]);
    await expect(
      tx(async (t) => {
        await t.query(
          `insert into commerce.return_exchanges (store_id, return_id, order_id, seq, status, currency, market_slug, delivery_address, credit_minor, total_minor, difference_minor, made_by,
             confirmed_at, confirmed_by, confirmed_channel, token_hash, expires_at)
           values ($1, $2, $3, 0, 'confirmed', 'NOK', 'no', '{}'::jsonb, 0, 0, 0, $4, now(), 'customer', 'web', $5, now())`,
          [store, ret, order.id, account, hash()],
        );
      }),
    ).rejects.toThrow(/exchange\.lifecycle/);
  });

  it("numbers proposals per return, keeps one open at a time and stops at the limit", async () => {
    const { order, ret, variant } = await scene();
    const first = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await expect(propose(ret, order.id, [{ variant, unit: 9000 }])).rejects.toThrow(/return_exchanges_open_key/);
    await db.query("update commerce.return_exchanges set status = 'cancelled' where id = $1", [first.id]);
    for (let i = 2; i <= EXCHANGES_PER_RETURN_MAX; i++) {
      const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
      expect(await scalar("select seq from commerce.return_exchanges where id = $1", [e.id])).toBe(i);
      await db.query("update commerce.return_exchanges set status = 'declined_by_customer' where id = $1", [e.id]);
    }
    await expect(propose(ret, order.id, [{ variant, unit: 9000 }])).rejects.toThrow(/exchange\.limit/);
    expect(await scalar("select count(*)::int from commerce.return_exchanges where return_id = $1 and ended_at is not null", [ret])).toBe(EXCHANGES_PER_RETURN_MAX);
  });

  it("needs replacements on a proposal (at commit), and a proposal is frozen", async () => {
    const { order, ret, variant } = await scene();
    await expect(propose(ret, order.id, [])).rejects.toThrow(/exchange\.no_lines/);
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await rejects("update commerce.return_exchanges set total_minor = 1, difference_minor = 1 - credit_minor where id = $1", [e.id], /exchange\.frozen/);
    await rejects("update commerce.return_exchanges set delivery_address = '{\"name\":\"Other\"}'::jsonb where id = $1", [e.id], /exchange\.frozen/);
    await rejects("update commerce.return_exchanges set market_slug = 'se' where id = $1", [e.id], /exchange\.fixed/);
  });

  it("refuses staff's recorded agreement for a withdrawal return, and takes it for a voluntary return", async () => {
    const w = await scene("withdrawal");
    const ew = await propose(w.ret, w.order.id, [{ variant: w.variant, unit: 9000 }]);
    await expect(confirm(ew.id, "staff")).rejects.toThrow(/exchange\.withdrawal_needs_customer/);
    await confirm(ew.id, "customer");
    const v = await scene("voluntary");
    const ev = await propose(v.ret, v.order.id, [{ variant: v.variant, unit: 9000 }]);
    await confirm(ev.id, "staff");
    expect(await scalar("select confirmed_by from commerce.return_exchanges where id = $1", [ev.id])).toBe("staff");
    // The customer's press is `web`; staff never record `web`.
    const v2 = await scene("voluntary");
    const ev2 = await propose(v2.ret, v2.order.id, [{ variant: v2.variant, unit: 9000 }]);
    await rejects("update commerce.return_exchanges set status = 'confirmed', confirmed_by = 'staff', confirmed_channel = 'web' where id = $1", [ev2.id], /return_exchanges_confirmation/);
  });
});

describe("the replacements", () => {
  it("are physical goods, added to a draft or with the proposal, and changed only while a draft", async () => {
    const { order, ret, variant } = await scene();
    const service = await newVariant(db, store);
    await db.query("update commerce.product_variants set delivery = 'service' where id = $1", [service]);
    await expect(propose(ret, order.id, [{ variant: service, unit: 5000 }])).rejects.toThrow(/exchange\.not_goods/);
    const draft = await propose(ret, order.id, [{ variant, unit: 9000 }], { status: "draft" });
    await db.query("update commerce.return_exchange_lines set quantity = 2 where exchange_id = $1", [draft.id]);
    await db.query("delete from commerce.return_exchange_lines where exchange_id = $1", [draft.id]);
    await db.query(
      "insert into commerce.return_exchange_lines (store_id, exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor) values ($1, $2, 1, $3, 'R', 'R', 1, 9000, 9000)",
      [store, draft.id, variant],
    );
    await db.query("update commerce.return_exchanges set status = 'proposed', token_hash = $2 where id = $1", [draft.id, hash()]);
    await rejects("update commerce.return_exchange_lines set quantity = 3 where exchange_id = $1", [draft.id], /exchange_line\.frozen/);
    await rejects("delete from commerce.return_exchange_lines where exchange_id = $1", [draft.id], /exchange_line\.frozen/);
    await rejects(
      "insert into commerce.return_exchange_lines (store_id, exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor) values ($1, $2, 2, $3, 'R', 'R', 1, 9000, 9000)",
      [store, draft.id, variant],
      /exchange_line\.frozen/,
    );
  });

  it("is never charged above its list price", async () => {
    const { order, ret, variant } = await scene();
    await expect(propose(ret, order.id, [{ variant, unit: 13000, list: 12000 }])).rejects.toThrow(/return_exchange_lines_prices/);
    await propose(ret, order.id, [{ variant, unit: 10000, list: 12000 }]);
  });
});

describe("which returns can be exchanged (3.3 point 2, the same as exchangeBlock())", () => {
  const facts = (over: Partial<ExchangeFacts>): ExchangeFacts => ({
    settingOn: true,
    copied: false,
    host: false,
    vatKind: "standard",
    subscription: false,
    weeklyBox: false,
    booking: false,
    allGoods: true,
    restricted: false,
    storeOpen: true,
    shopOn: true,
    returnStatus: "approved",
    refunded: false,
    editPending: false,
    proposals: 0,
    testModeMismatch: false,
    paymentsNeeded: false,
    paymentsOn: true,
    ...over,
  });

  it("refuses a reverse-charge order, as the code does", async () => {
    const order = await paid({ vatKind: "reverse_charge", company: { name: "Firma AS", vatNumber: "SE556677889901" }, market: "SE" });
    const ret = await voluntary(order.id, order.lineIds[0]);
    expect(await scalar("select commerce.exchange_block($1)", [ret])).toBe("vat_kind");
    expect(exchangeBlock(facts({ vatKind: "reverse_charge" }))).toBe("vat_kind");
    const variant = await newVariant(db, store);
    await expect(propose(ret, order.id, [{ variant, unit: 1000 }])).rejects.toThrow(/exchange\.vat_kind/);
  });

  it("refuses a requested, a refunded and an ended return, and a store with exchanges off", async () => {
    const order = await paid();
    const requested = await voluntary(order.id, order.lineIds[0], 1, store, "requested");
    expect(await scalar("select commerce.exchange_block($1)", [requested])).toBe("requested");
    expect(exchangeBlock(facts({ returnStatus: "requested" }))).toBe("requested");
    await db.query("update commerce.returns set status = 'cancelled' where id = $1", [requested]);
    expect(await scalar("select commerce.exchange_block($1)", [requested])).toBe("ended");
    expect(exchangeBlock(facts({ returnStatus: "cancelled" }))).toBe("ended");
    const ret = await voluntary(order.id, order.lineIds[0]);
    await db.query("update commerce.returns set refund_claimed_at = now() where id = $1", [ret]);
    expect(await scalar("select commerce.exchange_block($1)", [ret])).toBe("refunded");
    expect(await scalar("select commerce.exchange_block($1, true)", [ret])).toBeNull();
    expect(exchangeBlock(facts({ refunded: true }))).toBe("refunded");
    await db.query("update commerce.returns set refund_claimed_at = null where id = $1", [ret]);
    const other = await createInvoiceStore(db, "exc-off");
    await db.query("insert into commerce.return_settings (store_id, exchanges) values ($1, false)", [other]);
    const o2 = await paid({}, other);
    const r2 = await voluntary(o2.id, o2.lineIds[0], 1, other);
    expect(await scalar("select commerce.exchange_block($1)", [r2])).toBe("off");
    expect(exchangeBlock(facts({ settingOn: false }))).toBe("off");
  });

  it("refuses a restricted order and a return of a line that is not goods", async () => {
    const order = await paid({ lines: [{ sku: "A", quantity: 1, unit: 10000 }, { sku: "S", quantity: 1, unit: 5000, delivery: "service" }] });
    const ret = await voluntary(order.id, order.lineIds[1]);
    expect(await scalar("select commerce.exchange_block($1)", [ret])).toBe("not_goods");
    expect(exchangeBlock(facts({ allGoods: false }))).toBe("not_goods");
    await db.query("update commerce.orders set restricted_at = now(), customer_id = null where id = $1", [order.id]);
    expect(await scalar("select commerce.exchange_block($1)", [ret])).toBe("restricted");
    expect(exchangeBlock(facts({ restricted: true }))).toBe("restricted");
  });

  it("is null for a standard order's approved return of goods", async () => {
    const { ret } = await scene();
    expect(await scalar("select commerce.exchange_block($1)", [ret])).toBeNull();
    expect(exchangeBlock(facts({}))).toBeNull();
  });
});

describe("the exchange order (3.3 point 3)", () => {
  it("is made only under the exchange context, from a confirmed exchange, in the original order's market", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    const insert = (context: string | null, currency = "NOK") =>
      tx(async (t) => {
        if (context) await t.query("select set_config('kaizen.exchange', $1, true)", [context]);
        await t.query(
          `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
             billing_address, shipping_address, source, exchange_id, made_by) values ($1, $2, 'NO', $3, 'nb-NO', 'x@example.com', 9000, 0, 0, 1800, 9000, '{}', '{}', 'exchange', $4, $5)`,
          [store, `EXT-${next()}`, currency, e.id, account],
        );
      });
    await expect(insert(null)).rejects.toThrow(/order_exchange\.context/);
    await expect(insert(e.id)).rejects.toThrow(/order_exchange\.state/);
    await confirm(e.id);
    await expect(insert(e.id, "SEK")).rejects.toThrow(/order_exchange\.market/);
    // A checkout order cannot pose as one, and an exchange order needs its maker.
    await rejects(
      "insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, source) values ($1, $2, 'NO', 'NOK', 'nb-NO', 'x@example.com', 0, 0, 0, 0, 0, '{}', '{}', 'exchange')",
      [store, `EXT-${next()}`],
      /orders_source_(exchange|draft)/,
    );
  });

  it("holds exactly the replacements, keeps its exchange, and is one live order per exchange", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await confirm(e.id);
    const other = await newVariant(db, store);
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
        const id = (
          await t.query<{ id: string }>(
            `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
               billing_address, shipping_address, source, exchange_id, made_by) values ($1, $2, 'NO', 'NOK', 'nb-NO', 'x@example.com', 9000, 0, 0, 1800, 9000, '{}', '{}', 'exchange', $3, $4) returning id`,
            [store, `EXT-${next()}`, e.id, account],
          )
        ).rows[0].id;
        await t.query(
          "insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery) values ($1, $2, $3, 'X', 'X', 1, 9000, 0, 9000, 1800, 0.25, 'txcd_99999999', 'physical')",
          [store, id, other],
        );
      }),
    ).rejects.toThrow(/order_exchange\.line/);
    const orderId = await processExchange(e.id);
    await rejects("update commerce.orders set exchange_id = null, source = 'checkout' where id = $1", [orderId], /order_exchange\.frozen|order_origin\.frozen/);
    expect(await scalar("select source from commerce.orders where id = $1", [orderId])).toBe("exchange");
    // A second live order for the same exchange is refused.
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
        await t.query(
          `insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
             billing_address, shipping_address, source, exchange_id, made_by) values ($1, $2, 'NO', 'NOK', 'nb-NO', 'x@example.com', 0, 0, 0, 0, 0, '{}', '{}', 'exchange', $3, $4)`,
          [store, `EXT-${next()}`, e.id, account],
        );
      }),
    ).rejects.toThrow(/order_exchange\.state|orders_exchange_live_key/);
  });

  it("leaves no live order when a processed exchange ends", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 15000 }]);
    await confirm(e.id);
    const orderId = await processExchange(e.id);
    await expect(tx(async (t) => void (await t.query("update commerce.return_exchanges set status = 'expired' where id = $1", [e.id])))).rejects.toThrow(/exchange\.order_live/);
    await tx(async (t) => {
      await t.query("select commerce.cancel_unpaid_order($1, 'exchange_expired')", [orderId]);
      await t.query("update commerce.return_exchanges set status = 'expired' where id = $1", [e.id]);
    });
    expect(await scalar("select status from commerce.return_exchanges where id = $1", [e.id])).toBe("expired");
  });

  it("is never attributed to an affiliate", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await confirm(e.id);
    const orderId = await processExchange(e.id);
    expect(await scalar("select commerce.affiliate_attribute_order($1, 'ANYCODE', 0)", [orderId])).toBe("none");
  });
});

describe("settling: the transfer, the remainder, the difference (3.3 points 4 and 7)", () => {
  it("refund due (C > T): transfer T, remainder C − T, the order paid, the return exchanged; one credit note for the return, none for its refunds", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    const exOrder = await processExchange(e.id);
    // Stock was never held for the proposal; the exchange order holds none here either, so nothing is reserved for the exchange before processing.
    const ids = await settle(e.id);
    expect(ids.remainder).toBeDefined();
    expect(await scalar("select status::text from commerce.orders where id = $1", [exOrder])).toBe("paid");
    const r = await one<any>("select outcome, refund_minor::int as refund, refund_id, status::text as status from commerce.returns where id = $1", [ret]);
    expect(r).toEqual({ outcome: "exchanged", refund: 10000, refund_id: ids.remainder, status: "approved" });
    const sums = await one<any>("select transfer_minor::int as t, remainder_minor::int as r from commerce.exchange_refunds_of($1)", [e.id]);
    expect(sums).toEqual({ t: 8000, r: 2000 });
    // Documents: the original's credit note covers the whole credit; the transfer and the remainder get none of their own.
    const notes = await rows<any>(
      "select c.source, c.total_minor::int as total from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1",
      [order.id],
    );
    expect(notes).toEqual([{ source: "return_exchange", total: 10000 }]);
    // The note is what the oracle makes of the return's working (invoice-parity.test.ts holds the oracle to the SQL for every other source).
    const invoice = await one<any>("select id, snapshot from commerce.invoices where order_id = $1 and kind = 'order'", [order.id]);
    const note = await one<any>("select c.document_number, to_char(c.issued_on, 'YYYY-MM-DD') as issued_on, c.snapshot from commerce.credit_notes c where c.return_id = $1", [ret]);
    const r2 = await one<any>("select number, refund_working from commerce.returns where id = $1", [ret]);
    const oracle = creditNoteSnapshot({
      invoice: { id: invoice.id, snapshot: invoice.snapshot },
      earlier: [],
      source: "return_exchange",
      returnNumber: r2.number,
      refundMinor: 10000,
      working: parseWorking(r2.refund_working),
      number: note.document_number,
      issuedOn: note.issued_on,
    });
    expect(note.snapshot).toEqual(JSON.parse(JSON.stringify(oracle.snapshot)));
    expect(await scalar("select count(*)::int from commerce.order_events where order_id = $1 and type = 'credit_note.covered_by_exchange'", [order.id])).toBe(2);
    // The exchange order's invoice names the credit as a payment of its own.
    const inv = await one<any>("select snapshot from commerce.invoices where order_id = $1 and kind = 'order'", [exOrder]);
    expect(inv.snapshot.payments).toEqual([
      expect.objectContaining({ kind: "settled_by_return", amountMinor: 8000, provider: "exchange", returnNumber: expect.stringMatching(/-R1$/), orderNumber: order.number }),
    ]);
    // Settling twice does nothing.
    await tx(async (t) => {
      await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
      expect((await t.query<{ v: boolean }>("select commerce.complete_exchange_order($1) as v", [e.id])).rows[0].v).toBe(false);
    });
  });

  it("to pay (T > C): transfer C and the difference recorded outside Kaizen; the invoice says both", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 12000 }]);
    await confirm(e.id);
    const exOrder = await processExchange(e.id);
    const ids = await settle(e.id, { payWith: "manual" });
    expect(ids.remainder).toBeUndefined();
    expect(await scalar("select refund_id from commerce.returns where id = $1", [ret])).toBeNull();
    const inv = await one<any>("select snapshot from commerce.invoices where order_id = $1 and kind = 'order'", [exOrder]);
    expect(inv.snapshot.payments.map((p: any) => [p.kind, p.amountMinor])).toEqual([
      ["settled_by_return", 10000],
      ["paid_outside", 2000],
    ]);
  });

  it("refuses a settlement whose transfer is not min(C, T), or whose order is underpaid", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    await processExchange(e.id);
    await expect(settle(e.id, { transfer: 7000 })).rejects.toThrow(/exchange\.(underpaid|transfer|refunds)|return_refund_match/);
    const { order: o2, ret: r2, variant: v2 } = await scene();
    const e2 = await propose(r2, o2.id, [{ variant: v2, unit: 12000 }]);
    await confirm(e2.id);
    await processExchange(e2.id);
    // The difference not paid: the order's payments do not add up to its total.
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e2.id]);
        await t.query("select commerce.complete_exchange_order($1)", [e2.id]);
      }),
    ).rejects.toThrow(/exchange\.underpaid/);
  });

  it("pairs every transfer with its exchange payment at commit, and both are records", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    const exOrder = await processExchange(e.id);
    const payment = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
    await expect(
      tx(async (t) => {
        await t.query(
          "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id) values ($1, $2, 8000, 'x', 'succeeded', 'transfer', $3)",
          [store, payment, e.id],
        );
      }),
    ).rejects.toThrow(/refund_exchange\.context/);
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
        await t.query(
          "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id) values ($1, $2, 8000, 'x', 'succeeded', 'transfer', $3)",
          [store, payment, e.id],
        );
      }),
    ).rejects.toThrow(/exchange\.transfer_unpaired/);
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
        const rf = (
          await t.query<{ id: string }>(
            "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id) values ($1, $2, 8000, 'x', 'succeeded', 'transfer', $3) returning id",
            [store, payment, e.id],
          )
        ).rows[0].id;
        await t.query(
          "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, exchange_id, transfer_refund_id) values ($1, $2, 'exchange', $3, 7000, 'NOK', 'captured', $4, $5)",
          [store, exOrder, `exchange:${rf}`, e.id, rf],
        );
      }),
    ).rejects.toThrow(/payment_exchange\.transfer/);
    const ids = await settle(e.id);
    await rejects("update commerce.refunds set amount_minor = 1 where id = $1", [ids.transfer], /refund_exchange\.transfer_final/);
    await rejects("update commerce.payments set amount_minor = 1 where id = $1", [ids.payment], /payment_exchange\.final/);
    await rejects("update commerce.refunds set kind = 'transfer' where id = $1", [ids.remainder], /refund_exchange\.frozen|refunds_transfer/);
  });

  it("never lets later refunds take the money the exchange order rests on", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    const exOrder = await processExchange(e.id);
    const ids = await settle(e.id);
    // The original payment of 249,00 carried 80,00 to the exchange order and 20,00 back: 149,00 is left.
    const original = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
    await rejects(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values ($1, $2, 14901, 'Goodwill', 'pending', 're_late_1')",
      [store, original],
      /refund\.over_payment/,
    );
    await db.query(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values ($1, $2, 14900, 'Goodwill', 'pending', 're_late_2')",
      [store, original],
    );
    // A return of the exchange order refunds its exchange payment, never above it.
    await rejects(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values ($1, $2, 8001, 'Return', 'pending', 're_ex_1')",
      [store, ids.payment],
      /refund\.over_payment/,
    );
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, provider_reference) values ($1, $2, 8000, 'Return', 'pending', 're_ex_2')", [
      store,
      ids.payment,
    ]);
    expect(exOrder).toBeTruthy();
  });

  it("keeps a test order's credit a test: the exchange order gets no invoice number", async () => {
    await db.query("insert into commerce.stripe_accounts (store_id, mode, account_id) values ($1, 'test', 'acct_EXCTEST')", [store]);
    const { order, ret, variant } = await scene("withdrawal", { account: "acct_EXCTEST" });
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    const exOrder = await processExchange(e.id);
    const ids = await settle(e.id);
    expect(await scalar("select test_mode from commerce.payments where id = $1", [ids.payment])).toBe(true);
    expect(await scalar("select commerce.invoice_eligibility($1)", [exOrder])).toBe("test_mode");
    expect(await scalar("select count(*)::int from commerce.invoices where order_id = $1", [exOrder])).toBe(0);
  });
});

describe("the return learns exchanges (3.3 points 1 and 4)", () => {
  it("ends exchanged only by settling its exchange, and closes exchanged later", async () => {
    const { order, ret, variant } = await scene();
    await rejects("update commerce.returns set refund_minor = 100, outcome = 'exchanged' where id = $1", [ret], /return_outcome/);
    const e = await propose(ret, order.id, [{ variant, unit: 8000 }]);
    await confirm(e.id);
    await processExchange(e.id);
    // While processed, the return's refund is recorded only by the exchange.
    await rejects("update commerce.returns set refund_minor = 10000, refund_outside = true where id = $1", [ret], /return_exchange_pending/);
    await settle(e.id);
    await db.query("update commerce.returns set status = 'received' where id = $1", [ret]);
    await db.query("update commerce.returns set status = 'inspected' where id = $1", [ret]);
    await db.query("update commerce.returns set status = 'closed' where id = $1", [ret]);
    expect(await one("select status::text as status, outcome from commerce.returns where id = $1", [ret])).toEqual({ status: "closed", outcome: "exchanged" });
  });

  it("refuses a settled exchange whose return is not exchanged at commit", async () => {
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 10000 }]);
    await confirm(e.id);
    await processExchange(e.id);
    await expect(
      tx(async (t) => {
        await t.query("select set_config('kaizen.exchange', $1, true)", [e.id]);
        const payment = (await t.query<{ id: string }>("select id from commerce.payments where order_id = $1", [order.id])).rows[0].id;
        const exOrder = (await t.query<{ id: string }>("select exchange_order_id as id from commerce.return_exchanges where id = $1", [e.id])).rows[0].id;
        const rf = (
          await t.query<{ id: string }>(
            "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id) values ($1, $2, 10000, 'x', 'succeeded', 'transfer', $3) returning id",
            [store, payment, e.id],
          )
        ).rows[0].id;
        await t.query(
          "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, exchange_id, transfer_refund_id) values ($1, $2, 'exchange', $3, 10000, 'NOK', 'captured', $4, $5)",
          [store, exOrder, `exchange:${rf}`, e.id, rf],
        );
        await t.query("select commerce.complete_exchange_order($1)", [e.id]);
      }),
    ).rejects.toThrow(/exchange\.return/);
  });

  it("keeps the customer's wish as it was made", async () => {
    const { ret } = await scene();
    await rejects("update commerce.returns set exchange_wish_note = 'size M' where id = $1", [ret], /returns_exchange_wish/);
    await db.query("update commerce.returns set exchange_wish_at = now(), exchange_wish_note = 'size M' where id = $1", [ret]);
    await rejects("update commerce.returns set exchange_wish_note = 'size L' where id = $1", [ret], /return_exchange_wish/);
    await rejects("update commerce.returns set exchange_wish_note = $2 where id = $1", [ret, "x".repeat(EXCHANGE_WISH_NOTE_MAX + 1)], /return_exchange_wish|returns_exchange_wish/);
  });

  it("is blanked by the anonymising: the wish and the exchange's delivery address", async () => {
    const def = await scalar<string>("select pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure)");
    expect(def).toContain("exchange_wish_note = CASE");
    expect(def).toContain("UPDATE commerce.return_exchanges SET delivery_address = '{}'::jsonb");
    const { order, ret, variant } = await scene();
    const e = await propose(ret, order.id, [{ variant, unit: 9000 }]);
    await db.query("update commerce.returns set exchange_wish_at = now(), exchange_wish_note = 'Kari wants M' where id = $1", [ret]);
    await tx(async (t) => {
      await t.query("select set_config('commerce.anonymising', 'on', true)");
      await t.query("update commerce.returns set exchange_wish_note = '[removed]' where id = $1", [ret]);
      await t.query("update commerce.return_exchanges set delivery_address = '{}'::jsonb where id = $1", [e.id]);
    });
    expect(await scalar("select exchange_wish_note from commerce.returns where id = $1", [ret])).toBe("[removed]");
    expect(await scalar("select delivery_address from commerce.return_exchanges where id = $1", [e.id])).toEqual({});
    // Nothing else of an exchange is anonymised.
    await expect(
      tx(async (t) => {
        await t.query("select set_config('commerce.anonymising', 'on', true)");
        await t.query("update commerce.return_exchanges set market_slug = 'se' where id = $1", [e.id]);
      }),
    ).rejects.toThrow(/exchange\.fixed/);
  });
});

describe("return labels (3.1, 3.3 point 9)", () => {
  it("marks a pasted label as pasted, both ways", async () => {
    const { ret } = await scene();
    await db.query("update commerce.returns set label_url = 'https://label.example/1' where id = $1", [ret]);
    expect(await scalar("select label_source from commerce.returns where id = $1", [ret])).toBe("pasted");
    await db.query("update commerce.returns set label_url = null where id = $1", [ret]);
    expect(await scalar("select label_source from commerce.returns where id = $1", [ret])).toBeNull();
    // A pasted source without its address does not stay.
    await db.query("update commerce.returns set label_source = 'pasted' where id = $1", [ret]);
    expect(await scalar("select label_source from commerce.returns where id = $1", [ret])).toBeNull();
  });

  it("keeps a booked label's carrier, numbers and addresses together, with a known carrier and https", async () => {
    const { ret } = await scene();
    const book = (sql: string) => db.query(`update commerce.returns set ${sql} where id = $1`, [ret]);
    await expect(book("label_source = 'carrier', label_carrier_id = 'bring'")).rejects.toThrow(/returns_label_carrier/);
    await expect(book("label_source = 'carrier', label_carrier_id = 'dhl', label_booked_at = now()")).rejects.toThrow(/returns_label_carrier/);
    await expect(book("label_source = 'carrier', label_carrier_id = 'bring', label_booked_at = now(), label_carrier_url = 'http://api.bring.com/x'")).rejects.toThrow(/returns_label_urls/);
    await expect(book("label_tracking_number = '123'")).rejects.toThrow(/returns_label_carrier/);
    await book(
      "label_source = 'carrier', label_carrier_id = 'bring', label_service = '9300', label_booked_at = now(), label_consignment_number = '7070', label_tracking_number = '3707', label_carrier_url = 'https://api.bring.com/labels/1.pdf', label_cost_minor = 9900, label_cost_carrier = '{\"amountMinor\":9900,\"currency\":\"NOK\",\"vatIncluded\":true}'::jsonb, label_test = true",
    );
    // A booked label and a pasted one are not both kept.
    await expect(book("label_url = 'https://label.example/2'")).rejects.toThrow(/returns_label_pasted/);
    // Received: the label is no longer changed (the job's tries still count).
    await db.query("update commerce.returns set status = 'received' where id = $1", [ret]);
    await expect(book("label_cost_minor = 100")).rejects.toThrow(/return_label_state/);
    await book("label_tries = label_tries + 1");
  });
});

describe("store copies keep the choice to offer exchanges, never the label carrier (3.7)", () => {
  it("copies `exchanges` in clone_store() and duplicate_store()", async () => {
    const src = await createInvoiceStore(db, "exc-src");
    await db.query("insert into commerce.return_settings (store_id, exchanges, label_carrier, label_service, label_auto) values ($1, false, 'bring', '9300', true)", [src]);
    const owner = await scalar<string>("insert into commerce.accounts (email) values ('exc-owner@example.com') returning id");
    const fresh = await scalar<string>("select commerce.clone_store($1, 'exc-fresh', 'Fresh', $2)", [src, owner]);
    const copy = await scalar<string>("select commerce.duplicate_store($1, 'exc-copy', 'Copy', $2)", [src, owner]);
    for (const id of [fresh, copy]) {
      expect(await one("select exchanges, label_carrier, label_service, label_auto from commerce.return_settings where store_id = $1", [id])).toEqual({
        exchanges: false,
        label_carrier: null,
        label_service: null,
        label_auto: false,
      });
    }
  });
});
