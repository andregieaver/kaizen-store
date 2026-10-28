import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Gift cards (wave 5 unit F1, D300, `docs/wave-5-marketing.md` 8.1): the ledger's rules, in the database. */

let db: PGlite;
let store: string;
let other: string;
let staff: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const balance = (card: string) => scalar<string>("select commerce.gift_card_balance($1)::text", [card]).then(Number);

/** A card issued by a person, with a code (as the server sets it right after), in NOK unless said. */
async function staffCard(amount = 50000, currency = "NOK", test = false): Promise<string> {
  const card = await scalar<string>(
    "select commerce.gift_card_issue($1, 'staff', $2, $3, null, null, null, $4, $5, null, null, null, null, null, 'Goodwill')",
    [store, currency, amount, staff, test],
  );
  await db.query("update commerce.gift_cards set code_hash = md5(id::text), last4 = 'AB12' where id = $1", [card]);
  return card;
}

const order = async (sku: string) => (await placeOrder(db, store, { lines: [{ sku, unit: 100000 }], pay: false })).id;

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "gc-a");
  other = await createInvoiceStore(db, "gc-b");
  staff = await scalar<string>("insert into commerce.accounts (email, name) values ('gc-staff@example.com', 'Staff') returning id");
});

afterAll(async () => {
  await db.close();
});

describe("gift cards", () => {
  it("are written only by their functions", async () => {
    await rejects(
      "insert into commerce.gift_cards (store_id, currency, initial_minor, source, issued_by) values ($1, 'NOK', 100, 'staff', $2)",
      [store, staff],
      /gift_cards.writer/,
    );
    const card = await staffCard();
    await rejects("insert into commerce.gift_card_entries (store_id, card_id, kind, amount_minor, idempotency_key) values ($1, $2, 'issue', 100, 'x')", [store, card], /gift_cards.writer/);
  });

  it("issue with their amount on the ledger and an expiry from the store's settings", async () => {
    const card = await staffCard(25000);
    expect(await balance(card)).toBe(25000);
    expect(await scalar("select (expires_at::date - issued_at::date) between 1090 and 1100 from commerce.gift_cards where id = $1", [card])).toBe(true);
    await db.query("insert into commerce.gift_card_settings (store_id, expiry_months) values ($1, null)", [store]);
    try {
      const never = await staffCard();
      expect(await scalar("select expires_at from commerce.gift_cards where id = $1", [never])).toBeNull();
    } finally {
      await db.query("delete from commerce.gift_card_settings where store_id = $1", [store]);
    }
  });

  it("keep their ledger as it was written", async () => {
    const card = await staffCard();
    await rejects("update commerce.gift_card_entries set amount_minor = 1 where card_id = $1", [card], /gift_card_entries.fixed/);
    await rejects("delete from commerce.gift_card_entries where card_id = $1", [card], /gift_card_entries.fixed/);
    await rejects("delete from commerce.gift_cards where id = $1", [card], /gift_cards.kept/);
    await rejects("update commerce.gift_cards set initial_minor = 1 where id = $1", [card], /gift_cards.fixed/);
    // A code is made again while the card was never delivered (its email failed); once delivered it stays, and is never taken away.
    expect(await scalar("select commerce.gift_card_set_code($1, $2, 'again', 'CD34')", [store, card])).toBe(true);
    await rejects("update commerce.gift_cards set code_hash = null, last4 = null where id = $1", [card], /gift_cards.code/);
    expect(await scalar("select commerce.gift_card_mark_sent($1, $2)", [store, card])).toBe(true);
    expect(await scalar("select commerce.gift_card_mark_sent($1, $2)", [store, card])).toBe(false);
    expect(await scalar("select commerce.gift_card_set_code($1, $2, 'other', 'ZZ99')", [store, card])).toBe(false);
    await rejects("update commerce.gift_cards set code_hash = 'other', last4 = 'ZZ99' where id = $1", [card], /gift_cards.code/);
  });

  it("get a new code once delivered only through gift_card_new_code(), and only while live with money on it (D381)", async () => {
    const hash = (c: string) => c.padEnd(64, "0");
    const card = await staffCard(30000);
    // Not delivered yet: the code is still made again the ordinary way.
    expect(await scalar("select commerce.gift_card_new_code($1, $2, $3, 'NE01')", [store, card, hash("a")])).toBe("not_delivered");
    expect(await scalar("select commerce.gift_card_mark_sent($1, $2)", [store, card])).toBe(true);
    expect(await scalar("select commerce.gift_card_new_code($1, $2, $3, 'NE02')", [store, card, hash("b")])).toBe("ok");
    expect(await scalar("select last4 from commerce.gift_cards where id = $1", [card])).toBe("NE02");
    expect(await balance(card)).toBe(30000);
    // Anything else still finds the code fixed, the function's mark gone with its update.
    await rejects("update commerce.gift_cards set code_hash = 'x', last4 = 'ZZ99' where id = $1", [card], /gift_cards.code/);
    await rejects("select commerce.gift_card_new_code($1, $2, 'short', 'NE03')", [store, card], /gift_cards.code/);
    // Another store's card is not this store's to change.
    await rejects("select commerce.gift_card_new_code($1, $2, $3, 'NE04')", [other, card, hash("c")], /gift_cards.unknown/);
    // Empty, then deactivated: no new code.
    await db.query("select commerce.gift_card_adjust($1, $2, $3, -30000, 'test', 'empty:new')", [store, card, staff]);
    expect(await scalar("select commerce.gift_card_new_code($1, $2, $3, 'NE05')", [store, card, hash("d")])).toBe("empty");
    await db.query("select commerce.gift_card_void($1, $2, $3, 'test')", [store, card, staff]);
    expect(await scalar("select commerce.gift_card_new_code($1, $2, $3, 'NE06')", [store, card, hash("e")])).toBe("not_active");
  });

  it("hold, spend and refund for an order, never more than the card holds or the order spent", async () => {
    const card = await staffCard(50000);
    const o = await order("GC-1");
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 60000, 'hold:a')", [store, card, o], /gift_cards.balance/);
    await db.query("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 30000, 'hold:a')", [store, card, o]);
    // Once per key.
    await db.query("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 30000, 'hold:a')", [store, card, o]);
    expect(await balance(card)).toBe(20000);
    await db.query("select commerce.gift_card_spend($1, $2, $3, 'spend:a')", [store, card, o]);
    await rejects("select commerce.gift_card_release($1, $2, $3, 'release:a')", [store, card, o], /gift_cards.spent/);
    await db.query("select commerce.gift_card_refund($1, $2, $3, 10000, 'refund:1')", [store, card, o]);
    await rejects("select commerce.gift_card_refund($1, $2, $3, 25000, 'refund:2')", [store, card, o], /gift_cards.refund/);
    await db.query("select commerce.gift_card_refund($1, $2, $3, 20000, 'refund:2')", [store, card, o]);
    expect(await balance(card)).toBe(50000);
  });

  it("give back an unpaid order's hold, and refuse a refund of what was never spent", async () => {
    const card = await staffCard(40000);
    const o = await order("GC-2");
    await db.query("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 15000, 'hold:b')", [store, card, o]);
    await rejects("select commerce.gift_card_refund($1, $2, $3, 1000, 'refund:b')", [store, card, o], /gift_cards.not_spent/);
    await db.query("select commerce.gift_card_release($1, $2, $3, 'release:b')", [store, card, o]);
    expect(await balance(card)).toBe(40000);
    // Nothing left to release.
    expect(await scalar("select commerce.gift_card_release($1, $2, $3, 'release:b2')", [store, card, o])).toBeNull();
  });

  it("are spent only in their own currency and mode, while active and unexpired, in their own store", async () => {
    const card = await staffCard(10000);
    const o = await order("GC-3");
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'EUR', false, 100, 'c:1')", [store, card, o], /gift_cards.currency/);
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', true, 100, 'c:2')", [store, card, o], /gift_cards.mode/);
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 100, 'c:3')", [other, card, o], /gift_cards.unknown/);
    const test = await staffCard(10000, "NOK", true);
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 100, 'c:4')", [store, test, o], /gift_cards.mode/);
    // A card without its code yet is not spent.
    const pending = await scalar<string>("select commerce.gift_card_issue($1, 'staff', 'NOK', 500, null, null, null, $2, false, null, null, null, null, null, '')", [store, staff]);
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 100, 'c:5')", [store, pending, o], /gift_cards.inactive/);
  });

  it("are adjusted with a reason, deactivated with what is left going, and never spent after", async () => {
    const card = await staffCard(10000);
    await rejects("select commerce.gift_card_adjust($1, $2, $3, 500, '', 'adj:0')", [store, card, staff], /gift_card_entries_note/);
    await db.query("select commerce.gift_card_adjust($1, $2, $3, 500, 'Kind gesture', 'adj:1')", [store, card, staff]);
    await rejects("select commerce.gift_card_adjust($1, $2, $3, -20000, 'Too much', 'adj:2')", [store, card, staff], /gift_card_entries.balance/);
    expect(await balance(card)).toBe(10500);
    await db.query("select commerce.gift_card_void($1, $2, $3, 'Lost')", [store, card, staff]);
    expect(await balance(card)).toBe(0);
    expect(await scalar("select status from commerce.gift_cards where id = $1", [card])).toBe("deactivated");
    const o = await order("GC-4");
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 100, 'd:1')", [store, card, o], /gift_cards.inactive/);
    await rejects("update commerce.gift_cards set status = 'active', deactivated_at = null where id = $1", [card], /gift_cards.deactivated/);
  });

  it("lose what is left at expiry, once, and take a refund back after it", async () => {
    const card = await staffCard(8000);
    const o = await order("GC-5");
    await db.query("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 3000, 'e:h')", [store, card, o]);
    await db.query("select commerce.gift_card_spend($1, $2, $3, 'e:s')", [store, card, o]);
    // The card's date passes (set as the database would see it later: its identity is fixed, so the test moves the clock by the entry).
    await db.query("alter table commerce.gift_cards disable trigger gift_cards_rules");
    await db.query("update commerce.gift_cards set expires_at = now() - interval '1 day' where id = $1", [card]);
    await db.query("alter table commerce.gift_cards enable trigger gift_cards_rules");
    await rejects("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 100, 'e:h2')", [store, card, o], /gift_cards.expired/);
    await db.query("select commerce.gift_card_expire($1, $2)", [store, card]);
    expect(await balance(card)).toBe(0);
    expect(await scalar("select commerce.gift_card_expire($1, $2)", [store, card])).toBeNull();
    await db.query("select commerce.gift_card_refund($1, $2, $3, 3000, 'e:r')", [store, card, o]);
    expect(await balance(card)).toBe(3000);
    await db.query("select commerce.gift_card_expire($1, $2)", [store, card]);
    expect(await balance(card)).toBe(0);
  });

  it("issue once per unit of an order line, and keep who it is for as given or cleared", async () => {
    const o = await order("GC-6");
    const line = await scalar<string>("select id from commerce.order_lines where order_id = $1 limit 1", [o]);
    const issue = (unit: number) =>
      scalar<string>(
        "select commerce.gift_card_issue($1, 'order', 'NOK', 20000, $2, $3, $4, null, false, null, 'friend@example.com', 'Kari', 'Gratulerer', null, '')",
        [store, o, line, unit],
      );
    const first = await issue(1);
    expect(await issue(1)).toBe(first);
    expect(await issue(2)).not.toBe(first);
    await rejects("update commerce.gift_cards set recipient_email = 'other@example.com' where id = $1", [first], /gift_cards.person/);
    await db.query("update commerce.gift_cards set recipient_email = null, recipient_name = null, message = null where id = $1", [first]);
    expect(await scalar("select recipient_email from commerce.gift_cards where id = $1", [first])).toBeNull();
  });

  it("is a feature a store can keep on", async () => {
    await db.query("update commerce.stores set features = array['shop', 'gift_cards'] where id = $1", [store]);
    expect(await scalar("select commerce.feature_on($1, 'gift_cards')", [store])).toBe(true);
    expect(await scalar("select commerce.feature_needs('gift_cards')")).toEqual(["shop"]);
  });
});

/** Selling them (D300 F2): the product, its VAT, the cards a paid order issues, a withdrawal, and the person going with the order. */
describe("gift cards sold", () => {
  let product: string;
  let small: string;
  let large: string;

  beforeAll(async () => {
    product = await scalar<string>("select commerce.add_demo_gift_card($1)", [store]);
    small = await scalar<string>("select id from commerce.product_variants where product_id = $1 and sku = 'DEMO-GAVEKORT-500'", [product]);
    large = await scalar<string>("select id from commerce.product_variants where product_id = $1 and sku = 'DEMO-GAVEKORT-1000'", [product]);
  });

  /** An order of gift cards, unpaid: `lines` of a variant, units, and who it is for. */
  async function giftOrder(lines: { variant: string; unit: number; quantity: number; to?: string }[]): Promise<{ id: string; lines: string[] }> {
    const placed = await placeOrder(db, store, { lines: lines.map((l, i) => ({ sku: `GCX-${i}`, unit: l.unit, quantity: l.quantity, rate: 0, delivery: "digital" as const })), pay: false, shipping: 0 });
    for (const [i, l] of lines.entries()) {
      await db.query(
        `update commerce.order_lines set variant_id = $2, gift_card_to = $3, gift_card_to_name = $4, gift_card_message = $5, gift_card_send_on = $6::date where id = $1`,
        [placed.lineIds[i], l.variant, l.to ?? null, l.to ? "Kari" : null, l.to ? "Gratulerer!" : null, l.to ? "2026-12-24" : null],
      );
    }
    return { id: placed.id, lines: placed.lineIds };
  }

  async function pay(orderId: string, opts: { test?: boolean } = {}): Promise<void> {
    // A Stripe payment on no known account is a live one; a venue payment takes the store's Stripe mode (test, here).
    await db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, $3, $4, 1, 'NOK', 'pending')", [
      store,
      orderId,
      opts.test ? "venue" : "stripe",
      `pi_gc_${orderId}`,
    ]);
    await db.query("select commerce.complete_order_payment($1::uuid, 'ref')", [orderId]);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [orderId]);
  }

  const cards = (orderId: string) =>
    db.query<{ id: string; initial_minor: string; recipient_email: string | null; send_at: string | null; test_mode: boolean; unit_index: number }>(
      "select id, initial_minor::text, recipient_email, send_at, test_mode, unit_index from commerce.gift_cards where order_id = $1 order by order_line_id, unit_index",
      [orderId],
    ).then((r) => r.rows);

  it("are a product with the voucher category, which carries no VAT anywhere", async () => {
    expect(await scalar("select kind || '/' || vat_category from commerce.products where id = $1", [product])).toBe("gift_card/voucher");
    expect(await scalar("select delivery from commerce.product_variants where id = $1", [small])).toBe("digital");
    for (const country of ["NO", "SE", "DK", "DE", "FR"]) {
      expect(Number(await scalar("select commerce.vat_rate($1, 'voucher')", [country]))).toBe(0);
    }
    expect(Number(await scalar("select commerce.vat_rate('NO', 'standard')"))).toBeGreaterThan(0);
  });

  it("keep their rules: the voucher category, sold once, by email; the voucher on gift cards only", async () => {
    await rejects("update commerce.products set vat_category = 'standard' where id = $1", [product], /gift_card.product/);
    await rejects("update commerce.products set subscription_only = true where id = $1", [product], /gift_card.product/);
    await rejects("update commerce.product_variants set delivery = 'physical' where id = $1", [small], /gift_card.variants/);
    const goods = await scalar<string>("select id from commerce.products where store_id = $1 and kind = 'goods' limit 1", [store]);
    await rejects("update commerce.products set vat_category = 'voucher' where id = $1", [goods], /gift_card.voucher/);
  });

  it("are offered only while gift cards are on", async () => {
    await db.query("update commerce.stores set features = array['shop'] where id = $1", [store]);
    expect(await scalar("select commerce.kind_offered($1, 'gift_card', false)", [store])).toBe(false);
    await db.query("update commerce.stores set features = array['shop', 'gift_cards'] where id = $1", [store]);
    expect(await scalar("select commerce.kind_offered($1, 'gift_card', false)", [store])).toBe(true);
    expect(await scalar("select commerce.kind_offered($1, 'goods', false)", [store])).toBe(true);
  });

  it("issue one card per unit once the order is paid, for its amount and person, and never twice", async () => {
    const o = await giftOrder([
      { variant: small, unit: 50000, quantity: 2 },
      { variant: large, unit: 100000, quantity: 1, to: "friend@example.com" },
    ]);
    expect(await cards(o.id)).toHaveLength(0);
    await pay(o.id);
    const issued = await cards(o.id);
    expect(issued.map((c) => [Number(c.initial_minor), c.recipient_email, c.unit_index, c.test_mode])).toEqual([
      ...(o.lines[0] < o.lines[1]
        ? [
            [50000, null, 1, false],
            [50000, null, 2, false],
            [100000, "friend@example.com", 1, false],
          ]
        : [
            [100000, "friend@example.com", 1, false],
            [50000, null, 1, false],
            [50000, null, 2, false],
          ]),
    ]);
    const sent = issued.find((c) => c.recipient_email);
    expect(sent?.send_at).not.toBeNull();
    expect(issued.filter((c) => !c.recipient_email).every((c) => c.send_at === null)).toBe(true);
    for (const c of issued) expect(await balance(c.id)).toBe(Number(c.initial_minor));
    // Another capture (a change paid, a retry) issues nothing more.
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [o.id]);
    expect(await cards(o.id)).toHaveLength(3);
  });

  it("issue nothing before a payment is captured, and test cards for a test payment", async () => {
    const o = await giftOrder([{ variant: small, unit: 50000, quantity: 1 }]);
    await db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'venue', $3, 1, 'NOK', 'pending')", [
      store,
      o.id,
      `ven_t_${o.id}`,
    ]);
    expect(await scalar("select test_mode from commerce.payments where order_id = $1", [o.id])).toBe(true);
    await db.query("select commerce.complete_order_payment($1::uuid, 'ref')", [o.id]);
    expect(await cards(o.id)).toHaveLength(0);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1", [o.id]);
    expect((await cards(o.id)).map((c) => c.test_mode)).toEqual([true]);
  });

  it("are voided by the order's withdrawal while unspent, and not after", async () => {
    const o = await giftOrder([{ variant: small, unit: 50000, quantity: 2 }]);
    await pay(o.id);
    const [a, b] = await cards(o.id);
    await rejects("select commerce.gift_card_withdraw($1, $2, gen_random_uuid())", [store, a.id], /gift_card.order/);
    await db.query("select commerce.gift_card_withdraw($1, $2, $3)", [store, a.id, o.id]);
    expect(await balance(a.id)).toBe(0);
    expect(await scalar("select status from commerce.gift_cards where id = $1", [a.id])).toBe("deactivated");
    expect(await scalar("select order_id = $2 and account_id is null from commerce.gift_card_entries where card_id = $1 and kind = 'void'", [a.id, o.id])).toBe(true);
    // Part of the other is spent: it is no longer withdrawn.
    await db.query("update commerce.gift_cards set code_hash = md5(id::text), last4 = 'EF56' where id = $1", [b.id]);
    const spendOn = await order("GC-7");
    await db.query("select commerce.gift_card_hold($1, $2, $3, 'NOK', false, 1000, 'w:h')", [store, b.id, spendOn]);
    await rejects("select commerce.gift_card_withdraw($1, $2, $3)", [store, b.id, o.id], /gift_card.spent/);
  });

  it("forget who they were for when the order is anonymised, and keep the money", async () => {
    const o = await giftOrder([{ variant: large, unit: 100000, quantity: 1, to: "anna@example.com" }]);
    await pay(o.id);
    const [card] = await cards(o.id);
    await db.query("select set_config('commerce.anonymising', 'on', false)");
    await db.query("update commerce.orders set email = '[removed]', billing_address = '{}', shipping_address = '{}', customer_id = null, anonymised_at = now() where id = $1", [o.id]);
    await db.query("select set_config('commerce.anonymising', '', false)");
    expect(await scalar("select gift_card_to is null and gift_card_message is null and gift_card_send_on is null from commerce.order_lines where order_id = $1", [o.id])).toBe(true);
    expect(await scalar("select recipient_email is null and message is null from commerce.gift_cards where id = $1", [card.id])).toBe(true);
    expect(await balance(card.id)).toBe(100000);
  });
});

describe("gift cards spent (D300 F3)", () => {
  /** An unpaid order of goods for `unit` (NOK), with its lines' ids. */
  const goodsOrder = async (unit: number) => placeOrder(db, store, { lines: [{ sku: `GS-${unit}`, unit }], pay: false, shipping: 0 });
  /** A card in the store's own mode (its Stripe is in test mode unless said), with a code as delivered. */
  const liveCard = async (amount: number) => {
    const card = await staffCard(amount, "NOK", false);
    await db.query("update commerce.gift_cards set sent_at = now() where id = $1", [card]);
    return card;
  };
  const cardPays = (orderId: string, card: string, amount: number, status = "pending") =>
    db.query(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, gift_card_id) values ($1, $2, 'gift_card', $3, $4, 'NOK', $5::commerce.payment_status, $6) returning id",
      [store, orderId, `gc_${orderId}_${card}`, amount, status, card],
    ).then((r) => (r.rows[0] as { id: string }).id);
  const kinds = (card: string) => db.query<{ kind: string; amount: string }>("select kind, amount_minor::text as amount from commerce.gift_card_entries where card_id = $1 order by created_at, id", [card]).then((r) => r.rows.map((e) => `${e.kind}:${e.amount}`));

  beforeAll(async () => {
    // Real money: the store takes live payments, as a real card is spent only for real.
    await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1", [store]);
  });

  it("are held when the order is placed and spent when it is paid, the rest paid online, both on the invoice", async () => {
    const card = await liveCard(30000);
    const o = await goodsOrder(100000);
    await cardPays(o.id, card, 30000);
    expect(await balance(card)).toBe(0);
    await db.query(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, 70000, 'NOK', 'pending')",
      [store, o.id, `pi_gcs_${o.id}`],
    );
    await db.query("select commerce.complete_order_payment($1::uuid, 'ref')", [o.id]);
    await db.query("update commerce.payments set status = 'captured' where order_id = $1 and provider = 'stripe'", [o.id]);
    expect(await scalar("select status from commerce.payments where order_id = $1 and provider = 'gift_card'", [o.id])).toBe("captured");
    expect(await kinds(card)).toEqual(["issue:30000", "hold:-30000", "spend:0"]);
    const payments = await scalar<{ kind: string; amountMinor: number; cards?: string[] }[]>("select snapshot -> 'payments' from commerce.invoices where order_id = $1", [o.id]);
    expect(payments.map((p) => [p.kind, p.amountMinor, p.cards ?? null])).toEqual([
      ["paid_gift_card", 30000, ["AB12"]],
      ["paid_online", 70000, null],
    ]);
  });

  it("go back on the card when the order is cancelled unpaid", async () => {
    const card = await liveCard(50000);
    const o = await goodsOrder(40000);
    await cardPays(o.id, card, 40000);
    expect(await balance(card)).toBe(10000);
    await db.query("select commerce.cancel_unpaid_order($1::uuid, 'test')", [o.id]);
    expect(await scalar("select status from commerce.payments where order_id = $1 and provider = 'gift_card'", [o.id])).toBe("cancelled");
    expect(await balance(card)).toBe(50000);
    // An order paid after it was cancelled does not take its cards again: it says what they no longer pay.
    await db.query("select commerce.complete_order_payment($1::uuid, 'late')", [o.id]);
    expect(await balance(card)).toBe(50000);
    expect(await scalar("select data ->> 'amountMinor' from commerce.order_events where order_id = $1 and type = 'gift_card.unpaid'", [o.id])).toBe("40000");
  });

  it("take a refund back on the card, never more than the card paid", async () => {
    const card = await liveCard(20000);
    const o = await goodsOrder(20000);
    const payment = await cardPays(o.id, card, 20000);
    await db.query("select commerce.complete_order_payment($1::uuid, 'ref')", [o.id]);
    const refundOf = (amount: number, status = "succeeded") =>
      db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'test', $4, $5::commerce.refund_status)", [
        store,
        payment,
        amount,
        `gc_refund_${amount}_${Math.random()}`,
        status,
      ]);
    await refundOf(5000, "pending");
    expect(await balance(card)).toBe(0);
    await refundOf(15000);
    expect(await balance(card)).toBe(15000);
    await expect(refundOf(10000)).rejects.toThrow(/over_payment|refund/);
    expect(await balance(card)).toBe(15000);
  });

  it("pay at most what the order costs online, never for a gift card, and stay as made", async () => {
    const card = await liveCard(100000);
    const o = await goodsOrder(30000);
    await expect(cardPays(o.id, card, 30001)).rejects.toThrow(/gift_card_over/);
    const payment = await cardPays(o.id, card, 30000);
    await rejects("update commerce.payments set amount_minor = 1 where id = $1", [payment], /gift_card_fixed/);
    await rejects("update commerce.payments set status = 'authorized' where id = $1", [payment], /gift_card_status/);
    // A gift card line is never paid with a card.
    const product = await scalar<string>("select id from commerce.products where store_id = $1 and kind = 'gift_card' limit 1", [store]);
    const variant = await scalar<string>("select id from commerce.product_variants where product_id = $1 limit 1", [product]);
    const g = await placeOrder(db, store, { lines: [{ sku: "GC-LINE", unit: 50000, rate: 0, delivery: "digital" }], pay: false, shipping: 0 });
    await db.query("update commerce.order_lines set variant_id = $2 where id = $1", [g.lineIds[0], variant]);
    await expect(cardPays(g.id, card, 1000)).rejects.toThrow(/gift_card_over/);
  });

  it("are spent only in the store's own mode: a test card while it is live is refused", async () => {
    const testCard = await staffCard(10000, "NOK", true);
    await db.query("update commerce.gift_cards set sent_at = now() where id = $1", [testCard]);
    const o = await goodsOrder(10000);
    await expect(cardPays(o.id, testCard, 10000)).rejects.toThrow(/gift_cards.mode/);
    await db.query("update commerce.payment_providers set active_mode = 'test' where store_id = $1", [store]);
    try {
      await cardPays(o.id, testCard, 10000);
      expect(await scalar("select test_mode from commerce.payments where order_id = $1 and provider = 'gift_card'", [o.id])).toBe(true);
    } finally {
      await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1", [store]);
    }
  });
});
