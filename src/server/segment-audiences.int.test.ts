import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { RFM_SEGMENTS } from "@/lib/analytics-customers";
import { customPeriod } from "@/lib/analytics-period";
import { toRates } from "@/lib/currency";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const seg = await import("./segments");
const { segmentsOfBuyer } = await import("./segment-membership");
const { customersReport } = await import("./analytics-customers-data");
type Store = import("./stores").Store;

type Row = Record<string, unknown>;

/**
 * Segments everywhere (wave 11 unit A, D380): a segment's customer types are the Customers analytics page's own (the same count for every
 * type), one buyer is matched to a segment now (a guest and someone outside it are in none), a segment a code or campaign is limited to cannot
 * be deleted, a tag goes on or off many people at once with the limit of 50 a person kept, a segment's people page by page and as a CSV, and a
 * store's copy switches off a code limited to a segment. Main currency NOK.
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-20T12:00:00Z");
const SETTINGS = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 0, fixedCostsMonthlyMinor: 0, ltvLifespanYears: 3 };
let store: Store;
let owner: string;
let member: string;
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
    markets: [{ nativeCurrency: "NOK", code: "NO" }],
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([]) },
  } as unknown as Store;
}

async function order(s: Store, email: string, at: string, total: number, customerId: string | null = null) {
  n += 1;
  await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${s.id}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${customerId}::uuid, ${email}, 'paid'::commerce.order_status, ${total}, 0, 0,
        ${Math.round(total / 5)}, ${total}, '{}'::jsonb, '{}'::jsonb, ${at}::timestamptz)
      returning id
    `);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
  });
}

beforeAll(async () => {
  store = await makeStore("segaud");
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  owner = String(m.account_id);
  // 26 buyers with different counts, amounts and dates, so every customer type can have people.
  for (let i = 0; i < 26; i++) {
    const orders = 1 + (i % 4);
    for (let k = 0; k < orders; k++) {
      const day = String(1 + ((i * 7 + k * 3) % 27)).padStart(2, "0");
      const month = String(1 + ((i + k) % 10)).padStart(2, "0");
      await order(store, `p${i}-${run}@example.com`, `2026-${month}-${day}T10:00:00Z`, 10_000 + i * 2_500 + k * 1_000);
    }
  }
  const [c] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, locale, email_verified_at) values (${store.id}::uuid, ${`kari-${run}@example.com`}, 'Kari', 'nb-NO', now())
    returning id
  `);
  member = String(c.id);
  await order(store, `kari-${run}@example.com`, "2026-10-10T10:00:00Z", 50_000, member);
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.discount_codes where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.campaigns where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.customer_tags where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.segments where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("a segment's customer types are the Customers analytics page's (D380)", () => {
  it("counts every type as the page does", async () => {
    const report = await customersReport(store, customPeriod("2026-10-01", "2026-10-19"), SETTINGS, NOW);
    expect(report.segments.enough).toBe(true);
    let total = 0;
    for (const group of RFM_SEGMENTS) {
      const counted = await seg.evaluateSegment(store, { match: "all", conditions: [{ kind: "rfm", groups: [group] }] }, NOW);
      const shown = report.segments.summary.find((s) => s.segment === group)!.customers;
      expect(counted.people, group).toBe(shown);
      total += shown;
    }
    expect(total).toBe(27);
  });

  it("lists a segment's people a page at a time and writes everyone in it to a CSV", async () => {
    const everyone = { match: "all" as const, conditions: [{ kind: "orders" as const, op: "atLeast" as const, value: 1 }] };
    const first = await seg.evaluateSegment(store, everyone, NOW, 0);
    expect(first).toMatchObject({ people: 27, page: 0, pages: 1 });
    expect(first.sample).toHaveLength(27);
    // A page past the last shows the last.
    expect((await seg.evaluateSegment(store, everyone, NOW, 9)).page).toBe(0);
    const { csv, rows } = await seg.segmentCsv(store, everyone, NOW);
    expect(rows).toBe(27);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,name,orders,first_order,last_order,spent_without_vat,currency,customer_type,email_consent,tags");
    expect(lines).toHaveLength(28);
    expect(csv).toContain(`kari-${run}@example.com,Kari,1,2026-10-10,2026-10-10,400.00,NOK,`);
  });
});

describe("one buyer in a segment, and what a segment holds (D380)", () => {
  it("matches the signed-in buyer now: in while tagged, out once the tag is off, and a guest never", async () => {
    const saved = await seg.saveSegment(store.id, owner, null, { name: `Tagged ${run}`, rules: { match: "all", conditions: [{ kind: "tag", tags: ["Stam"] }] } });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await segmentsOfBuyer(db(), store.id, member, [saved.id], NOW)).toEqual(new Set());
    expect(await seg.addTag(store.id, owner, `kari-${run}@example.com`, "Stam")).toEqual({ ok: true });
    expect(await segmentsOfBuyer(db(), store.id, member, [saved.id], NOW)).toEqual(new Set([saved.id]));
    expect(await segmentsOfBuyer(db(), store.id, null, [saved.id], NOW)).toEqual(new Set());
    await seg.removeTag(store.id, owner, `kari-${run}@example.com`, "Stam");
    expect(await segmentsOfBuyer(db(), store.id, member, [saved.id], NOW)).toEqual(new Set());
  });

  it("is not deleted while a code or campaign is limited to it, and says which", async () => {
    const saved = await seg.saveSegment(store.id, owner, null, { name: `Kept ${run}`, rules: { match: "any", conditions: [] } });
    if (!saved.ok) throw new Error(saved.problem);
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent, segment_id) values (${store.id}::uuid, ${`KEPT${run}`.toUpperCase()}, 'percent', 10, ${saved.id}::uuid)`);
    expect(await seg.segmentUses(store.id, saved.id)).toEqual({ codes: [`KEPT${run}`.toUpperCase()], campaigns: [] });
    expect(await seg.deleteSegment(store.id, owner, saved.id)).toBe("in_use");
    // The database refuses it too.
    await expect(db().execute(sql`delete from commerce.segments where id = ${saved.id}::uuid`)).rejects.toThrow();
    await db().execute(sql`update commerce.discount_codes set segment_id = null where store_id = ${store.id}::uuid`);
    expect(await seg.deleteSegment(store.id, owner, saved.id)).toBe(true);
  });

  it("a segment of another store cannot be named by a code", async () => {
    const other = await makeStore("segaud-other");
    const saved = await seg.saveSegment(other.id, owner, null, { name: `Theirs ${run}`, rules: { match: "any", conditions: [] } });
    if (!saved.ok) throw new Error(saved.problem);
    await expect(
      db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent, segment_id) values (${store.id}::uuid, ${`THEIRS${run}`.toUpperCase()}, 'percent', 10, ${saved.id}::uuid)`),
    ).rejects.toThrow();
    await db().execute(sql`delete from commerce.segments where store_id = ${other.id}::uuid`);
  });

  it("a store's copy switches off a code and a campaign limited to a segment (segments are never copied)", async () => {
    const [def] = await db().execute<Row>(sql`select pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure) as def`);
    expect(String(def.def)).toContain("t.segment_id IS NOT NULL");
  });
});

describe("tags on many people at once (D380)", () => {
  it("adds and takes off a tag for everyone given, leaves a person at 50 tags as they were, and refuses more than 1,000", async () => {
    const emails = [0, 1, 2].map((i) => `p${i}-${run}@example.com`);
    // p2 is full: 50 tags already.
    for (let t = 0; t < 50; t++) await seg.addTag(store.id, owner, emails[2], `full-${t}`);
    const added = await seg.tagMany(store.id, owner, [...emails, emails[0].toUpperCase()], "Messe 2026", "add");
    expect(added).toEqual({ ok: true, changed: 2, full: 1 });
    expect((await seg.tagsOf(store.id, emails[0])).map((t) => t.label)).toContain("Messe 2026");
    // Again: nobody new.
    expect(await seg.tagMany(store.id, owner, emails, "messe 2026", "add")).toEqual({ ok: true, changed: 0, full: 1 });
    expect(await seg.tagMany(store.id, owner, emails, "MESSE 2026", "remove")).toEqual({ ok: true, changed: 2, full: 0 });
    expect(await seg.tagMany(store.id, owner, emails, "a,b", "add")).toEqual({ ok: false, problem: "bad_tag" });
    const many = Array.from({ length: seg.BULK_TAG_MAX + 1 }, (_, i) => `x${i}@example.com`);
    expect(await seg.tagMany(store.id, owner, many, "x", "add")).toEqual({ ok: false, problem: "too_many" });
    const [audit] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'customer.tags_added' order by created_at desc limit 1
    `);
    expect(JSON.stringify(audit.details)).not.toContain("@");
  });
});
