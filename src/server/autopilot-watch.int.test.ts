import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { watchAutopilotChanges, watchedChanges } = await import("./autopilot-watch");
const { newStore } = await import("./inventory-test-support");
const { newPageContent } = await import("@/lib/page-content");

type Row = Record<string, unknown>;

/**
 * Watch and roll back (`docs/100-day-challenge.md` F4) on real stores: a price the autopilot raised, after which nobody buys though the same
 * hours of the weeks before sold well, is set back and the verdict kept once; a code on a store with too little traffic is judged quiet when its
 * watch ends; a store that counts no visits is not watched.
 */

let busy: Awaited<ReturnType<typeof newStore>>;
let quiet: Awaited<ReturnType<typeof newStore>>;
let blind: Awaited<ReturnType<typeof newStore>>;
let broken: Awaited<ReturnType<typeof newStore>>;
let failing: Awaited<ReturnType<typeof newStore>>;
const SKU = "DEMO-MUG-WHITE";

/** `n` visitors first seen in the hour that starts `hoursAgo` hours ago. */
async function visitors(storeId: string, hoursAgo: number, n: number) {
  await db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, device, channel, landing_path, first_seen, last_seen)
    select ${storeId}::uuid, (now() - make_interval(hours => ${hoursAgo}))::date, substr(md5(random()::text || g::text), 1, 24), 'mobile', 'direct', '/',
      now() - make_interval(hours => ${hoursAgo}) + make_interval(secs => g), now() - make_interval(hours => ${hoursAgo}) + make_interval(secs => g)
    from generate_series(1, ${n}) g
  `);
}

/** The drain's counts for the whole hour that ends `hoursAgo - 1` hours ago (D669): `requests` of which `errors` were server errors. */
async function hourly(storeId: string, hoursAgo: number, requests: number, errors: number) {
  await db().execute(sql`
    insert into commerce.store_traffic_hourly (store_id, hour, requests, server_errors)
    values (${storeId}::uuid, date_trunc('hour', now() - make_interval(hours => ${hoursAgo}) + interval '1 hour'), ${requests}, ${errors})
    on conflict do nothing
  `);
}

/** `n` paid orders placed in the hour that starts `hoursAgo` hours ago. */
async function orders(storeId: string, hoursAgo: number, n: number) {
  for (let i = 0; i < n; i++) {
    const number = `W-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const [o] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
        total_minor, billing_address, shipping_address, placed_at)
      values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'paid', 19900, 0, 0, 3980, 19900, '{}'::jsonb, '{}'::jsonb,
        now() - make_interval(hours => ${hoursAgo}) + make_interval(secs => ${i + 1}))
      returning id
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_${number}`}, 'acct_watch', 19900, 0, 'NOK', 'captured')
    `);
  }
}

/** An autopilot change as the tool runner keeps it, `hoursAgo` hours ago, with the entries its tool wrote just before. */
async function change(s: typeof busy, tool: string, args: Record<string, unknown>, hoursAgo: number, before: { action: string; target?: string; details: unknown; changes?: unknown }[] = []) {
  for (const b of before) {
    await db().execute(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, target_type, target_id, changes, acted_by, created_at)
      values (${s.storeId}::uuid, ${s.accountId}::uuid, ${b.action}, ${JSON.stringify(b.details)}::jsonb, 'product', ${b.target ?? null}, ${JSON.stringify(b.changes ?? null)}::jsonb,
        'autopilot', now() - ${hoursAgo} * interval '1 hour' - interval '1 second')
    `);
  }
  await db().execute(sql`
    insert into commerce.audit_log (store_id, account_id, action, details, acted_by, created_at)
    values (${s.storeId}::uuid, ${s.accountId}::uuid, ${`store.assistant.${tool}`}, ${JSON.stringify({ args })}::jsonb, 'autopilot', now() - ${hoursAgo} * interval '1 hour')
  `);
}

const priceNow = async (storeId: string) =>
  Number(
    (
      await db().execute<Row>(sql`
        select p.amount_minor from commerce.prices p join commerce.product_variants v on v.id = p.variant_id
        where v.store_id = ${storeId}::uuid and v.sku = ${SKU} and p.market_code = 'NO' and p.valid_to is null
      `)
    )[0]?.amount_minor,
  );

beforeAll(async () => {
  busy = await newStore("watch-busy");
  quiet = await newStore("watch-quiet");
  blind = await newStore("watch-blind");
  broken = await newStore("watch-broken");
  failing = await newStore("watch-failing");
  for (const s of [busy, quiet, blind, broken, failing]) await db().execute(sql`update commerce.stores set status = 'active', visit_counting = ${s !== blind} where id = ${s.storeId}::uuid`);
  // The busy store: in the same eight hours of each of the four weeks before, 100 visitors and 10 orders; since the change, 200 visitors and none.
  for (let week = 1; week <= 4; week++) {
    for (let h = 1; h <= 8; h++) await visitors(busy.storeId, week * 168 + h, h <= 4 ? 13 : 12);
    await orders(busy.storeId, week * 168 + 4, 10);
  }
  for (let h = 1; h <= 8; h++) await visitors(busy.storeId, h, 25);
  // The autopilot raised the mug from 199 to 299 kr eight and a half hours ago.
  const [v] = await db().execute<Row>(sql`select v.id, v.product_id from commerce.product_variants v where v.store_id = ${busy.storeId}::uuid and v.sku = ${SKU}`);
  await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', 19900)`);
  await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', 29900)`);
  await change(busy, "set_prices", { product: "mug", changes: [{ sku: SKU, prices: { NO: "299" } }] }, 8.5, [
    { action: "product.price_changed", target: String(v.product_id), details: { sku: SKU, market: "NO", currency: "NOK" }, changes: { priceMinor: { from: 19900, to: 29900 } } },
  ]);
  await change(quiet, "create_discount", { code: "QUIET10", percent: 10 }, 49);
  // The broken store (D663): it sells as before since the change (25 visitors and 2 orders an hour as in the weeks before), but 12 of the 200
  // visitors since met an error page, and none in the weeks before.
  for (let week = 1; week <= 4; week++) {
    for (let h = 1; h <= 8; h++) await visitors(broken.storeId, week * 168 + h, 25);
    await orders(broken.storeId, week * 168 + 4, 16);
  }
  for (let h = 1; h <= 8; h++) await visitors(broken.storeId, h, 25);
  await orders(broken.storeId, 4, 16);
  await db().execute(sql`
    update commerce.visits set error_at = first_seen + interval '1 minute'
    where id in (select id from commerce.visits where store_id = ${broken.storeId}::uuid and first_seen > now() - interval '8 hours' order by first_seen limit 12)
  `);
  // The failing store (D669): it sells as before, but since the change 3 % of its requests were server errors against 0.1 % in the same hours
  // of the weeks before, by the drain's hourly counts.
  for (let week = 1; week <= 4; week++) {
    for (let h = 1; h <= 8; h++) await visitors(failing.storeId, week * 168 + h, 25);
    await orders(failing.storeId, week * 168 + 4, 16);
    for (let h = 1; h <= 8; h++) await hourly(failing.storeId, week * 168 + h, 1000, 1);
  }
  for (let h = 1; h <= 8; h++) await visitors(failing.storeId, h, 25);
  await orders(failing.storeId, 4, 16);
  for (let h = 1; h <= 8; h++) await hourly(failing.storeId, h, 1000, 30);
  const [fv] = await db().execute<Row>(sql`select v.id, v.product_id from commerce.product_variants v where v.store_id = ${failing.storeId}::uuid and v.sku = ${SKU}`);
  await db().execute(sql`select commerce.set_price(${String(fv.id)}::uuid, 'NO', 19900)`);
  await db().execute(sql`select commerce.set_price(${String(fv.id)}::uuid, 'NO', 24900)`);
  await change(failing, "set_prices", { product: "mug", changes: [{ sku: SKU, prices: { NO: "249" } }] }, 8.5, [
    { action: "product.price_changed", target: String(fv.product_id), details: { sku: SKU, market: "NO", currency: "NOK" }, changes: { priceMinor: { from: 19900, to: 24900 } } },
  ]);
  const [bv] = await db().execute<Row>(sql`select v.id, v.product_id from commerce.product_variants v where v.store_id = ${broken.storeId}::uuid and v.sku = ${SKU}`);
  await db().execute(sql`select commerce.set_price(${String(bv.id)}::uuid, 'NO', 19900)`);
  await db().execute(sql`select commerce.set_price(${String(bv.id)}::uuid, 'NO', 24900)`);
  await change(broken, "set_prices", { product: "mug", changes: [{ sku: SKU, prices: { NO: "249" } }] }, 8.5, [
    { action: "product.price_changed", target: String(bv.product_id), details: { sku: SKU, market: "NO", currency: "NOK" }, changes: { priceMinor: { from: 19900, to: 24900 } } },
  ]);
  await change(blind, "create_campaign", { name: "Blind sale" }, 7);
});

afterAll(closeDb);

describe("watch and roll back (F4)", () => {
  it("sets a price back after a clear fall, keeps the verdict once, and judges quiet changes when their watch ends", async () => {
    const run = await watchAutopilotChanges({ everyRun: true });
    expect(run.reverted).toBeGreaterThanOrEqual(1);
    expect(await priceNow(busy.storeId)).toBe(19900);
    const [verdict] = await watchedChanges(busy.storeId);
    expect(verdict).toMatchObject({ tool: "set_prices", verdict: "fall", undone: [`${SKU} in NO back to its price before`] });
    expect(verdict.words).toContain("A clear fall in conversion");
    expect(await watchedChanges(quiet.storeId)).toEqual([expect.objectContaining({ tool: "create_discount", verdict: "too_little", undone: [] })]);
    expect(await watchedChanges(blind.storeId)).toEqual([expect.objectContaining({ verdict: "not_watched", words: expect.stringContaining("Visit counting is off") })]);
    // Judged once: the next hour finds nothing new on these stores.
    await watchAutopilotChanges({ everyRun: true });
    expect(await watchedChanges(busy.storeId)).toHaveLength(1);
  });

  it("undoes a change after which visitors meet error pages, though sales hold (D663)", async () => {
    await watchAutopilotChanges({ everyRun: true });
    const [verdict] = await watchedChanges(broken.storeId);
    expect(verdict).toMatchObject({ tool: "set_prices", verdict: "fall", undone: [`${SKU} in NO back to its price before`] });
    expect(verdict.words).toContain("A clear rise in visitors meeting an error");
    expect(await priceNow(broken.storeId)).toBe(19900);
  });

  it("undoes a change after which the store's server errors rise, though sales hold (D669)", async () => {
    await watchAutopilotChanges({ everyRun: true });
    const [verdict] = await watchedChanges(failing.storeId);
    expect(verdict).toMatchObject({ tool: "set_prices", verdict: "fall", undone: [`${SKU} in NO back to its price before`] });
    expect(verdict.words).toContain("A clear rise in server errors");
    expect(await priceNow(failing.storeId)).toBe(19900);
  });

  it("leaves a price someone changed since alone", async () => {
    const [v] = await db().execute<Row>(sql`select v.id, v.product_id from commerce.product_variants v where v.store_id = ${busy.storeId}::uuid and v.sku = ${SKU}`);
    await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', 34900)`);
    await change(busy, "set_prices", { product: "mug", changes: [{ sku: SKU, prices: { NO: "299" } }] }, 8.2, [
      { action: "product.price_changed", target: String(v.product_id), details: { sku: SKU, market: "NO", currency: "NOK" }, changes: { priceMinor: { from: 19900, to: 29900 } } },
    ]);
    await watchAutopilotChanges({ everyRun: true });
    expect(await priceNow(busy.storeId)).toBe(34900);
    expect((await watchedChanges(busy.storeId))[0]).toMatchObject({ verdict: "fall", undone: [] });
  });
});

describe("a page the autopilot published (F4, D651)", () => {
  const page = (slug: string, text: string) => ({
    ...newPageContent(),
    title: "Autumn",
    slug,
    rows: [{ id: "row-1", type: "row" as const, layout: "1", columns: [{ id: "column-1", blocks: [{ id: "heading-1", type: "heading" as const, text, level: 2 as const }] }] }],
  });
  const live = async (id: string) =>
    (await db().execute<Row>(sql`select published -> 'rows' -> 0 -> 'columns' -> 0 -> 'blocks' -> 0 ->> 'text' as text from commerce.pages where id = ${id}::uuid`))[0]?.text;

  /**
   * A page live as "before" ten days ago and published again as "after" by the autopilot `hoursAgo` hours ago, written as the page and its
   * versions stand then (the audit log is append-only, so the publishes are not made through the save, which would date them now).
   */
  async function published(slug: string, hoursAgo: number): Promise<string> {
    const before = JSON.stringify(page(slug, "before"));
    const after = JSON.stringify(page(slug, "after"));
    const [row] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
      values (${busy.storeId}::uuid, 'page', ${slug}, ${after}::jsonb, ${after}::jsonb, now() - ${hoursAgo} * interval '1 hour', now() - interval '10 days')
      returning id
    `);
    const id = String(row.id);
    await db().execute(sql`
      insert into commerce.page_versions (store_id, page_id, kind, content, created_at)
      values (${busy.storeId}::uuid, ${id}::uuid, 'published', ${before}::jsonb, now() - interval '10 days'),
             (${busy.storeId}::uuid, ${id}::uuid, 'published', ${after}::jsonb, now() - ${hoursAgo} * interval '1 hour' - interval '1 second')
    `);
    await change(busy, "publish_page", { page: slug, type: "page" }, hoursAgo, [{ action: "store.page_published", target: id, details: { slug } }]);
    return id;
  }

  it("publishes the version that was live before again after a clear fall, and leaves a page someone edited since", async () => {
    const watched = await published(`autumn-${Date.now().toString(36)}`, 8.1);
    const edited = await published(`autumn-edited-${Date.now().toString(36)}`, 8.05);
    // Someone changed the second page's draft after the autopilot published it: it stays as they left it.
    await db().execute(sql`update commerce.pages set draft = jsonb_set(draft, '{title}', '"Autumn, edited"') where id = ${edited}::uuid`);
    await watchAutopilotChanges({ everyRun: true });
    expect(await live(watched)).toBe("before");
    expect(await live(edited)).toBe("after");
    const verdicts = (await watchedChanges(busy.storeId)).filter((w) => w.tool === "publish_page");
    expect(verdicts.map((v) => v.undone)).toEqual(expect.arrayContaining([["the page back to the version that was live before"], []]));
  });
});
