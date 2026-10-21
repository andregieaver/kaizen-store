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
    await rejects("update commerce.gift_cards set code_hash = 'other', last4 = 'ZZ99' where id = $1", [card], /gift_cards.code/);
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
