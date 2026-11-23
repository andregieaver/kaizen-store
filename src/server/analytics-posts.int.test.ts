import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";
import { postRows } from "@/lib/post-links";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { postReport } = await import("./analytics-traffic-data");

/**
 * What each tagged post sold (D870 S1.1, `docs/analytics.md` "Post"), against a hand-made shop. NOK, Europe/Oslo, 25 % VAT, visits counted from
 * 3 September; the period is 3 to 4 September.
 *
 * Visits on 09-03:
 *   V1 instagram / spring / p-abc123, cart C1 → O1: 1 mug 100.00, cost 30.00      revenue 8000, line revenue 8000, cogs 3000
 *   V2 instagram / spring / p-abc123, no cart
 *   V3 pinterest / social / bio, cart C3 → O3: 1 mug 50.00, cost not known         revenue 4000, line revenue 4000, known 0
 *   V4 direct, untagged, cart C4 → O4: 1 mug 100.00                               not a post: never in the rows
 * Another store has a tagged visit and order in the same days that must never reach this one.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf([], [{ currency: "NOK", rate: 1, roundTo: 1 }], [no]);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization, visitCounting: true }) as unknown as Store;

let store: Store;
let serial = 0;
const variants: Record<string, string> = {};

const taxOf = (amount: number) => amount - Math.round(amount / 1.25);

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

async function visit(storeId: string, key: string, tags: { channel: string; source?: string; campaign?: string; content?: string }) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, source, campaign, content, landing_path)
    values (${storeId}::uuid, '2026-09-03'::date, ${Buffer.from(`${key}${run}`).toString("hex").slice(0, 24).padEnd(24, "0")}, 'NO', 'mobile', ${tags.channel},
      ${tags.source ?? ""}, ${tags.campaign ?? ""}, ${tags.content ?? ""}, '/no') returning id
  `);
  return String(row.id);
}

async function cartOf(storeId: string, visitId: string) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, visit_id) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '30 days', ${visitId}::uuid) returning id
  `);
  return String(row.id);
}

async function order(storeId: string, cart: string, unit: number, cost: number | null, variant: string) {
  serial += 1;
  const tax = taxOf(unit);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at, cart_id, source)
    values (${storeId}::uuid, ${`P-${run}-${serial}`}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'paid', ${unit}, 0, 0, ${tax}, ${unit},
      '{}'::jsonb, '{}'::jsonb, '2026-09-03T12:00:00+02:00'::timestamptz, ${cart}::uuid, 'checkout')
    returning id
  `);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${id}::uuid, ${variant}::uuid, 'DEMO-MUG-WHITE', 'Mug', 1, ${unit}, ${cost}, 0, ${unit}, ${tax}, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
    values (${storeId}::uuid, ${id}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_posts', ${unit}, 0, 'NOK', 'captured'::commerce.payment_status)
  `);
}

const PERIOD = customPeriod("2026-09-03", "2026-09-04");
const NOW = new Date("2026-09-05T10:00:00Z");

beforeAll(async () => {
  const id = await makeStore(`posts-${run}`);
  const otherId = await makeStore(`posts-other-${run}`);
  store = storeOf(id, `posts-${run}`);
  for (const storeId of [id, otherId]) {
    const [v] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    variants[storeId] = String(v.id);
  }
  const ig = { channel: "organic_social", source: "instagram", campaign: "spring", content: "p-abc123" };
  const v1 = await visit(id, "v1", ig);
  await visit(id, "v2", ig);
  const v3 = await visit(id, "v3", { channel: "organic_social", source: "pinterest", campaign: "social", content: "bio" });
  const v4 = await visit(id, "v4", { channel: "direct" });
  await order(id, await cartOf(id, v1), 10_000, 3_000, variants[id]);
  await order(id, await cartOf(id, v3), 5_000, null, variants[id]);
  await order(id, await cartOf(id, v4), 10_000, 3_000, variants[id]);
  const vo = await visit(otherId, "vo", ig);
  await order(otherId, await cartOf(otherId, vo), 90_000, 1_000, variants[otherId]);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("what each tagged post sold", () => {
  it("follows a post's visits to their carts, paid orders, revenue and cost of goods, and leaves untagged visits and other stores out", async () => {
    const report = await postReport(store, PERIOD, NOW);
    expect(report.counting).toBe(true);
    expect(report.missingCurrencies).toEqual([]);
    expect(report.rows).toEqual([
      { source: "instagram", campaign: "spring", content: "p-abc123", sessions: 2, carts: 1, orders: 1, revenueMinor: 8_000, cogsMinor: 3_000, lineRevenueMinor: 8_000, knownLineRevenueMinor: 8_000 },
      { source: "pinterest", campaign: "social", content: "bio", sessions: 1, carts: 1, orders: 1, revenueMinor: 4_000, cogsMinor: 0, lineRevenueMinor: 4_000, knownLineRevenueMinor: 0 },
    ]);
  });

  it("gives a profit only where every line's cost is known", async () => {
    const [instagram, pinterest] = postRows((await postReport(store, PERIOD, NOW)).rows);
    expect(instagram).toMatchObject({ conversion: 0.5, costCoverage: 1, grossProfitMinor: 5_000 });
    expect(pinterest).toMatchObject({ conversion: 1, costCoverage: 0, grossProfitMinor: null });
  });

  it("knows nothing while visits are not counted", async () => {
    const report = await postReport({ ...store, visitCounting: false } as Store, PERIOD, NOW);
    expect(report).toMatchObject({ counting: false, covered: null, rows: [] });
  });
});
