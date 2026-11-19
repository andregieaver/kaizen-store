import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { PageContent } from "@/lib/page-content";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const admin = await import("./experiment-admin");
const results = await import("./experiment-results");
const stores = await import("./stores");

/**
 * An A/B test's days are the store's own (D812): an exposure, a conversion and the test's start fall on the store's calendar day, as its
 * visits do (`visits.day`), never on UTC's. 23:30 in New York on 3 October is 03:30 UTC on the 4th; 00:30 in Auckland on 4 October is 11:30
 * UTC on the 3rd. Grouped by UTC day, the first would count on the 4th and the second on the 3rd, so a version could look like it won or
 * lost on a day the store never had.
 */

const run = Date.now().toString(36);
let storeId: string;
let slug: string;
let account: Account;
let testId: string;
let orderNumber = 0;

/** 23:30 on 3 October in New York, and 01:30 on the 4th. */
const NY_EVENING = "2026-10-04T03:30:00Z";
const NY_AFTER_MIDNIGHT = "2026-10-04T05:30:00Z";
/** 00:30 on 4 October in Auckland, and 23:30 on the 3rd. */
const AUCKLAND_NIGHT = "2026-10-03T11:30:00Z";
const AUCKLAND_EVENING = "2026-10-03T10:30:00Z";

async function inZone(timeZone: string) {
  await db().execute(sql`update commerce.stores set time_zone = ${timeZone} where id = ${storeId}::uuid`);
  const store = await stores.getStore(slug);
  if (!store) throw new Error("The test store is gone.");
  expect(store.timeZone).toBe(timeZone);
  return store;
}

async function expose(visitor: string, variant: "a" | "b", at: string) {
  await db().execute(sql`
    insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, first_seen) values (${storeId}::uuid, ${testId}::uuid, ${visitor}, ${variant}, ${at}::timestamptz)
  `);
}

/** A paid order of the visitor's cart, placed at a moment. */
async function orderAt(visitor: string, at: string) {
  orderNumber += 1;
  const store = (await stores.getStore(slug))!;
  const market = { code: store.markets[0].code, currency: store.markets[0].nativeCurrency, locale: store.markets[0].locale };
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day')
    returning id, market_code, currency, locale
  `);
  await db().execute(sql`insert into commerce.experiment_carts (store_id, cart_id, visitor) values (${storeId}::uuid, ${String(cart.id)}::uuid, ${visitor})`);
  await db().execute(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${`days-${run}-${orderNumber}`}, ${String(cart.market_code)}, ${String(cart.currency)}, ${String(cart.locale)}, ${`days-${orderNumber}@example.com`}, 'paid', ${String(cart.id)}::uuid,
      10000, 0, 2000, 10000, '{}', '{}', ${at}::timestamptz)
  `);
}

const dayOf = (r: Awaited<ReturnType<typeof results.experimentResults>>) => r.daily.map((d) => [d.day, d.variants.a.visitors, d.variants.b.visitors, d.variants.a.conversions + d.variants.b.conversions]);

beforeAll(async () => {
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`days-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`days-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  slug = String(row.slug);
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`days-admin-${run}@example.com`}, 'Days Admin') returning id`);
  account = { id: String(acc.id), email: `days-admin-${run}@example.com`, name: "Days Admin", platformAdmin: false };
  const [about] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = 'om-oss'`);
  const made = await admin.createExperiment(account, storeId, { name: "Store days", pageId: String(about.id), goal: "orders" });
  if (!made.ok) throw new Error(made.problems.join(" "));
  testId = made.id;
  // Version B's heading differs, so the test can start.
  const draft = (await admin.getExperiment(storeId, testId))!;
  const pageId = draft.variants.find((v) => v.key === "b")!.pageId!;
  const [page] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid`);
  const content = page.published as PageContent;
  const changed = JSON.stringify({ ...content, rows: content.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: `${b.text} (new)` } : b)) })) })) });
  await db().execute(sql`update commerce.pages set draft = ${changed}::jsonb, published = ${changed}::jsonb where id = ${pageId}::uuid`);
  const started = await admin.startExperiment(account, storeId, testId);
  if (!started.ok) throw new Error(started.problems.join(" "));
  // Started at 22:00 on 27 September in New York (02:00 UTC on the 28th, 15:00 on the 28th in Auckland).
  await db().execute(sql`update commerce.experiments set started_at = '2026-09-28T02:00:00Z' where id = ${testId}::uuid and store_id = ${storeId}::uuid`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.experiments set status = 'stopped', stopped_at = now() where id = ${testId}::uuid and store_id = ${storeId}::uuid and status = 'running'`);
  await closeDb();
});

describe("an A/B test's days are the store's (D812)", () => {
  it("counts an exposure at 23:30 in New York, and its order, on the New York day", async () => {
    const ny1 = `ny1-${randomUUID()}`;
    const ny2 = `ny2-${randomUUID()}`;
    await expose(ny1, "a", NY_EVENING);
    await expose(ny2, "b", NY_AFTER_MIDNIGHT);
    // The order is placed five minutes after the first visitor saw version A: still 3 October in New York.
    await orderAt(ny1, "2026-10-04T03:35:00Z");
    const test = (await admin.getExperiment(storeId, testId))!;
    const now = new Date("2026-10-10T12:00:00Z");

    const ny = await results.experimentResults(await inZone("America/New_York"), test, now);
    expect(dayOf(ny)).toEqual([
      ["2026-10-03", 1, 0, 1],
      ["2026-10-04", 0, 1, 0],
    ]);
    // The start's day is the store's too, 27 September in New York: 3 October is the seventh day (the first week), the 4th the eighth.
    expect(ny.weekly.map((w) => [w.week, w.variants.a.visitors + w.variants.b.visitors])).toEqual([
      [1, 1],
      [2, 1],
    ]);

    // On UTC's clock both visitors and the order would fall on 4 October, the seventh day after 28 September, in the first week.
    const utc = await results.experimentResults(await inZone("UTC"), test, now);
    expect(dayOf(utc)).toEqual([["2026-10-04", 1, 1, 1]]);
    expect(utc.weekly.map((w) => [w.week, w.variants.a.visitors + w.variants.b.visitors])).toEqual([[1, 2]]);
    // The figures themselves do not move with the clock: the same visitors, the same order, the same verdict.
    expect(ny.figures).toEqual(utc.figures);
    expect(ny.verdict.kind).toBe(utc.verdict.kind);

    await db().execute(sql`delete from commerce.experiment_exposures where experiment_id = ${testId}::uuid and store_id = ${storeId}::uuid`);
  });

  it("counts an exposure at 00:30 in Auckland on the new Auckland day, and a cart added at 23:30 on the day before", async () => {
    const late = `akl1-${randomUUID()}`;
    const early = `akl2-${randomUUID()}`;
    await expose(late, "a", AUCKLAND_NIGHT);
    await expose(early, "b", AUCKLAND_EVENING);
    await db().execute(sql`
      insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, occurred_at)
      values (${storeId}::uuid, ${testId}::uuid, ${early}, 'b', 'cart', ${AUCKLAND_EVENING}::timestamptz), (${storeId}::uuid, ${testId}::uuid, ${late}, 'a', 'cart', ${AUCKLAND_NIGHT}::timestamptz)
    `);
    // The cart's days come from the events: read them as a test of adding to the cart.
    const test = { ...(await admin.getExperiment(storeId, testId))!, goal: "cart" as const };
    const now = new Date("2026-10-10T12:00:00Z");

    const akl = await results.experimentResults(await inZone("Pacific/Auckland"), test, now);
    expect(dayOf(akl)).toEqual([
      ["2026-10-03", 0, 1, 1],
      ["2026-10-04", 1, 0, 1],
    ]);
    // Started at 15:00 on 28 September in Auckland: 3 and 4 October are the sixth and seventh days, the first week.
    expect(akl.weekly.map((w) => [w.week, w.variants.a.visitors + w.variants.b.visitors])).toEqual([[1, 2]]);
    const utc = await results.experimentResults(await inZone("UTC"), test, now);
    expect(dayOf(utc)).toEqual([["2026-10-03", 1, 1, 2]]);

    await db().execute(sql`delete from commerce.experiment_exposures where experiment_id = ${testId}::uuid and store_id = ${storeId}::uuid`);
  });
});
