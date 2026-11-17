import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toRates } from "@/lib/currency";

vi.mock("server-only", () => ({}));

const segments = await import("./segments");
const { segmentsOfPerson } = await import("./segment-membership");
const { personSubscription } = await import("./marketing-subscribers");
const { personSms } = await import("./sms");
type Store = import("./stores").Store;

type Row = Record<string, unknown>;

/**
 * One view of a person (ecosystem plan E2.4, D713), against a real database: the saved segments a customer is in now, read for them alone
 * (in a "spent over X" segment and not in one of two orders, and a smaller buyer in neither); their place on the email list; their number's
 * consent to texts, masked, and whether the store texts at all. Another store's rows are never theirs. Main currency NOK.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-11-10T12:00:00Z");
let store: Store;
let other: Store;
let owner: string;
let n = 0;
const big = `big-${run}@example.com`;
const small = `small-${run}@example.com`;
const token = () => randomBytes(32).toString("base64url");

async function makeStore(slug: string): Promise<Store> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  return {
    id: String(created.id),
    slug: `${slug}-${run}`,
    timeZone: "Europe/Oslo",
    markets: [{ nativeCurrency: "NOK" }],
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([{ currency: "NOK", rate: 1, roundTo: 1 }]) },
  } as unknown as Store;
}

/** A paid order straight into the tables: total with VAT and tax, its payment captured. */
async function paidOrder(s: Store, o: { email: string; total: number; tax: number; customerId?: string | null }) {
  n += 1;
  await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${s.id}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${o.customerId ?? null}::uuid, ${o.email}, 'paid'::commerce.order_status,
        ${o.total}, 0, 0, ${o.tax}, ${o.total}, '{}'::jsonb, '{}'::jsonb, '2026-10-01T10:00:00Z'::timestamptz)
      returning id
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_cm_${run}_${n}`}, ${o.total}, 'NOK', 'captured')
    `);
  });
}

beforeAll(async () => {
  store = await makeStore("cmk");
  other = await makeStore("cmk-other");
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  owner = String(m.account_id);
  const [account] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${store.id}::uuid, ${big}, 'Berit Stor') returning id`);
  // Berit: one order of 1 250 kr with 250 kr VAT, 1 000 kr spent without VAT. The small buyer: 125 kr with 25 kr VAT.
  await paidOrder(store, { email: big, total: 125_000, tax: 25_000, customerId: String(account.id) });
  await paidOrder(store, { email: small, total: 12_500, tax: 2_500 });
  for (const [name, rules] of [
    ["Spent over 500 kr", { match: "all", conditions: [{ kind: "spent", op: "atLeast", minor: 50_000 }] }],
    ["Ordered twice", { match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 2 }] }],
  ] as const) {
    const saved = await segments.saveSegment(store.id, owner, null, { name, rules });
    if (!saved.ok) throw new Error(saved.problem);
  }
  // Another store's segment of everyone holds nobody of this store.
  const [otherMember] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${other.id}::uuid limit 1`);
  await segments.saveSegment(other.id, String(otherMember.account_id), null, { name: "Everyone", rules: { match: "all", conditions: [] } });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.segments where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.marketing_subscribers where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.sms_subscribers where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.sms_settings where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await closeDb();
});

describe("the segments a person is in now", () => {
  it("puts a big spender in the segment of those who spent over 500 kr and not in the one of two orders", async () => {
    expect(await segmentsOfPerson(store, big, NOW)).toEqual({ saved: 2, in: [{ id: expect.any(String), name: "Spent over 500 kr" }] });
    // By any spelling of the address.
    expect((await segmentsOfPerson(store, ` ${big.toUpperCase()} `, NOW)).in.map((s) => s.name)).toEqual(["Spent over 500 kr"]);
  });

  it("puts a smaller buyer in neither, and someone the store does not know in none", async () => {
    expect(await segmentsOfPerson(store, small, NOW)).toEqual({ saved: 2, in: [] });
    expect(await segmentsOfPerson(store, `nobody-${run}@example.com`, NOW)).toEqual({ saved: 2, in: [] });
  });

  it("reads the person alone as the whole store's reading does", async () => {
    const all = await segments.segmentPeople(store, NOW, { rfm: false });
    const one = await segments.segmentPeople(store, NOW, { emails: [big], rfm: false });
    expect(one.people).toEqual(all.people.filter((p) => p.email === big));
    expect(one.people[0]).toMatchObject({ orders: 1, spentMinor: 100_000, account: true });
  });

  it("holds nobody of this store in another store's segment", async () => {
    expect(await segmentsOfPerson(other, big, NOW)).toEqual({ saved: 1, in: [] });
  });
});

describe("a person's email list and texts", () => {
  it("is not on the list until they join, then since when, and left with the day they left", async () => {
    expect(await personSubscription(store.id, big, null)).toBeNull();
    const [sub] = await db().execute<Row>(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token, confirm_hash, confirm_until)
      values (${store.id}::uuid, ${big}, 'nb-NO', 'pending', 'form', 'Ja takk', '2026-11-01T08:00:00Z', ${token()}, ${randomBytes(32).toString("hex")}, now() + interval '7 days')
      returning id
    `);
    expect(await personSubscription(store.id, big.toUpperCase(), null)).toEqual({ id: String(sub.id), status: "pending", since: "2026-11-01T08:00:00.000Z" });
    await db().execute(sql`
      update commerce.marketing_subscribers set status = 'subscribed', confirmed_at = '2026-11-02T09:00:00Z', confirm_hash = null, confirm_until = null
      where id = ${String(sub.id)}::uuid
    `);
    expect(await personSubscription(store.id, big, null)).toMatchObject({ status: "subscribed", since: "2026-11-02T09:00:00.000Z" });
    expect(await personSubscription(other.id, big, null)).toBeNull();
    // The database stamps when they left.
    const [left] = await db().execute<Row>(sql`
      update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'staff' where id = ${String(sub.id)}::uuid returning unsubscribed_at
    `);
    expect(await personSubscription(store.id, big, null)).toMatchObject({ status: "unsubscribed", since: new Date(String(left.unsubscribed_at)).toISOString() });
  });

  it("says whether the store texts, and the person's number masked with its consent", async () => {
    expect(await personSms(store.id, small, null)).toEqual({ offered: false, number: null });
    await db().execute(sql`
      insert into commerce.sms_settings (store_id, api_username, api_password_encrypted, currency, sender, inbound_key)
      values (${store.id}::uuid, 'u', 'x', 'NOK', 'Kaffe', ${token()})
    `);
    expect(await personSms(store.id, small, null)).toEqual({ offered: true, number: null });
    await db().execute(sql`
      insert into commerce.sms_subscribers (store_id, phone, country, email, locale, status, source, consent_text, consented_at, token)
      values (${store.id}::uuid, '+4791234567', 'NO', ${small}, 'nb-NO', 'subscribed', 'checkout', 'Ja', '2026-11-03T10:00:00Z', ${randomBytes(16).toString("base64url")})
    `);
    expect(await personSms(store.id, small, null)).toEqual({ offered: true, number: { status: "subscribed", phone: "+47 ••• 567", since: "2026-11-03T10:00:00.000Z" } });
    expect(await personSms(other.id, small, null)).toEqual({ offered: false, number: null });
  });
});
