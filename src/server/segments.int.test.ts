import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toRates } from "@/lib/currency";

vi.mock("server-only", () => ({}));

const seg = await import("./segments");
type Store = import("./stores").Store;

type Row = Record<string, unknown>;

/**
 * Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4.5): the reader's facts for an account, a guest, a subscriber only
 * and a copied order (never counted); money in two currencies and one without a rate; tags; saving and its limits; one store never sees another's
 * people. Main currency NOK, 1 EUR = 10 NOK; SEK has no rate.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-20T12:00:00Z");
let store: Store;
let other: Store;
let owner: string;
let n = 0;

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
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([{ currency: "NOK", rate: 10, roundTo: 1 }]) },
  } as unknown as Store;
}

/** A paid order straight into the tables: total with VAT, tax, its payment captured (or none), a refund. */
async function order(s: Store, o: { email: string; at: string; total: number; tax: number; currency?: string; customerId?: string; copied?: boolean; refund?: number; market?: string; paid?: boolean }) {
  n += 1;
  return db().transaction(async (tx) => {
    if (o.copied) await tx.execute(sql`set local session_replication_role = replica`);
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, copied_from)
      values (${s.id}::uuid, ${`${o.copied ? "C-" : ""}${run}-${n}`}, ${o.market ?? "NO"}, ${o.currency ?? "NOK"}, 'nb-NO', ${o.customerId ?? null}::uuid, ${o.email},
        ${o.paid === false ? "pending_payment" : "paid"}::commerce.order_status, ${o.total}, 0, 0, ${o.tax}, ${o.total}, '{}'::jsonb, '{"name":"Ola Gjest"}'::jsonb,
        ${o.at}::timestamptz, ${o.copied ? sql`gen_random_uuid()` : sql`null`})
      returning id
    `);
    if (o.paid === false) return String(row.id);
    const [p] = await tx.execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${o.total}, ${o.currency ?? "NOK"}, 'captured') returning id
    `);
    if (o.refund) {
      await tx.execute(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
        values (${s.id}::uuid, ${String(p.id)}::uuid, ${o.refund}, 'test', ${`re_${run}_${n}`}, 'succeeded')
      `);
    }
    return String(row.id);
  });
}

const person = async (s: Store, email: string) => (await seg.segmentPeople(s, NOW)).people.find((p) => p.email === email);

beforeAll(async () => {
  store = await makeStore("seg");
  other = await makeStore("seg-other");
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  owner = String(m.account_id);
  const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${store.id}::uuid, 'Gull', 10) returning id`);
  const [anna] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, locale, email_verified_at, tier_id) values (${store.id}::uuid, ${`Anna-${run}@example.com`}, 'Anna', 'sv-SE', now(), ${String(tier.id)}::uuid)
    returning id
  `);
  // Anna: two orders, one in euro (100 EUR with 20 EUR VAT = 80 EUR net = 800 NOK) and one in NOK (1 250 with 250 VAT, 250 refunded: 1000 - 200 = 800).
  await order(store, { email: `anna-${run}@example.com`, customerId: String(anna.id), at: "2026-01-10T10:00:00Z", total: 10_000, tax: 2_000, currency: "EUR", market: "DK" });
  await order(store, { email: `anna-${run}@example.com`, customerId: String(anna.id), at: "2026-10-01T10:00:00Z", total: 125_000, tax: 25_000, refund: 25_000, market: "SE" });
  // A guest: one order in SEK, which has no rate.
  await order(store, { email: `gjest-${run}@example.com`, at: "2026-09-01T10:00:00Z", total: 50_000, tax: 10_000, currency: "SEK" });
  // A copied order and an unpaid one make nobody a buyer.
  await order(store, { email: `kopi-${run}@example.com`, at: "2026-09-01T10:00:00Z", total: 50_000, tax: 10_000, copied: true });
  await order(store, { email: `ubetalt-${run}@example.com`, at: "2026-09-01T10:00:00Z", total: 50_000, tax: 10_000, paid: false });
  // A subscriber who never bought.
  await db().execute(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${store.id}::uuid, ${`abonnent-${run}@example.com`}, 'nb-NO', 'NO', 'subscribed', 'form', 'Ja takk', now(), ${("s" + run + "x".repeat(43)).slice(0, 43)})
  `);
  // Another store's buyer.
  await order(other, { email: `fremmed-${run}@example.com`, at: "2026-09-01T10:00:00Z", total: 50_000, tax: 10_000 });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.marketing_subscribers where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.customer_tags where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await db().execute(sql`delete from commerce.segments where store_id in (${store.id}::uuid, ${other.id}::uuid)`);
  await closeDb();
});

describe("the people of a store (D296)", () => {
  it("reads an account with its orders, net revenue in the main currency, last country, language and group", async () => {
    const anna = await person(store, `anna-${run}@example.com`);
    expect(anna).toMatchObject({ account: true, orders: 2, spentMinor: 160_000, country: "se", language: "sv", consent: "none", company: false });
    expect(anna?.groupId).not.toBeNull();
    expect(anna?.firstOrderAt).toBe("2026-01-10T10:00:00.000Z");
  });

  it("reads a guest by their orders, with money it cannot convert left unknown", async () => {
    const people = await seg.segmentPeople(store, NOW);
    const guest = people.people.find((p) => p.email === `gjest-${run}@example.com`);
    expect(guest).toMatchObject({ account: false, orders: 1, spentMinor: null, name: "Ola Gjest" });
    expect(people.missingRates).toContain("SEK");
    expect(people.moneyUnknown).toBeGreaterThanOrEqual(1);
  });

  it("reads a subscriber who never bought, and never a copied or unpaid order's buyer, or another store's", async () => {
    expect(await person(store, `abonnent-${run}@example.com`)).toMatchObject({ orders: 0, consent: "subscribed", country: "no", language: "nb", lastOrderAt: null });
    expect(await person(store, `kopi-${run}@example.com`)).toBeUndefined();
    expect(await person(store, `ubetalt-${run}@example.com`)).toBeUndefined();
    expect(await person(store, `fremmed-${run}@example.com`)).toBeUndefined();
  });

  it("gives no customer type below twenty customers", async () => {
    const people = await seg.segmentPeople(store, NOW);
    expect(people.rfmReady).toBe(false);
    expect(people.people.every((p) => p.rfm === null)).toBe(true);
  });
});

describe("a segment", () => {
  it("counts the people its rules match, and those who want the emails", async () => {
    const result = await seg.evaluateSegment(store, { match: "any", conditions: [{ kind: "consent", statuses: ["subscribed"] }, { kind: "orders", op: "atLeast", value: 2 }] }, NOW);
    expect(result).toMatchObject({ people: 2, subscribed: 1 });
    expect(result.sample.map((p) => p.email).sort()).toEqual([`abonnent-${run}@example.com`, `anna-${run}@example.com`]);
    const money = await seg.evaluateSegment(store, { match: "all", conditions: [{ kind: "spent", op: "atLeast", minor: 100_000 }] }, NOW);
    expect(money).toMatchObject({ people: 1, moneyUnknown: 1 });
  });

  it("is saved with a unique name, changed, listed and deleted, audited without people", async () => {
    const rules = { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }] };
    const saved = await seg.saveSegment(store.id, owner, null, { name: "Abonnenter", rules });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await seg.saveSegment(store.id, owner, null, { name: "abonnenter", rules })).toEqual({ ok: false, problem: "Another segment already has that name." });
    expect(await seg.saveSegment(store.id, owner, null, { name: "Bad", rules: { match: "all", conditions: [{ kind: "sql" }] } })).toMatchObject({ ok: false });
    expect(await seg.saveSegment(store.id, owner, saved.id, { name: "Nyhetsbrev", rules })).toEqual({ ok: true, id: saved.id });
    expect((await seg.listSegments(store.id)).map((s) => s.name)).toEqual(["Nyhetsbrev"]);
    expect(await seg.getSegment(other.id, saved.id)).toBeNull();
    expect(await seg.saveSegment(other.id, owner, saved.id, { name: "Stolen", rules })).toEqual({ ok: false, problem: "That segment is no longer there." });
    expect(await seg.deleteSegment(other.id, owner, saved.id)).toBe(false);
    expect(await seg.deleteSegment(store.id, owner, saved.id)).toBe(true);
    const audits = await db().execute<Row>(sql`select action, details from commerce.audit_log where store_id = ${store.id}::uuid and action like 'segment.%' order by created_at`);
    expect(audits.map((a) => a.action)).toEqual(["segment.saved", "segment.saved", "segment.deleted"]);
    expect(JSON.stringify(audits)).not.toContain("@example.com");
  });
});

describe("customer tags", () => {
  it("are added by the words typed, once per key, matched by segments, and removed", async () => {
    const email = `gjest-${run}@example.com`;
    expect(await seg.addTag(store.id, owner, email.toUpperCase(), "  Messe 2026 ")).toEqual({ ok: true });
    expect(await seg.addTag(store.id, owner, email, "messe 2026")).toEqual({ ok: true });
    expect(await seg.addTag(store.id, owner, email, "a,b")).toEqual({ ok: false, problem: "A tag cannot hold a comma." });
    expect(await seg.tagsOf(store.id, email)).toEqual([{ key: "messe 2026", label: "Messe 2026" }]);
    expect(await seg.tagsOf(other.id, email)).toEqual([]);
    expect((await seg.storeTags(store.id))[0]).toEqual({ key: "messe 2026", label: "Messe 2026", people: 1 });
    const tagged = await seg.evaluateSegment(store, { match: "all", conditions: [{ kind: "tag", tags: ["MESSE 2026"] }] }, NOW);
    expect(tagged.sample.map((p) => p.email)).toEqual([email]);
    expect(await seg.removeTag(store.id, owner, email, "Messe 2026")).toBe(true);
    expect(await seg.tagsOf(store.id, email)).toEqual([]);
    const audits = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.id}::uuid and action like 'customer.tag_%'`);
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("@example.com");
  });
});
