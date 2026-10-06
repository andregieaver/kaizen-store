import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor, totalSales } from "@/lib/control-center";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const center = await import("./control-center");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let account: Account;
let storeId: string;
let variant: { id: string; sku: string };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`center-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`center-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`center-${run}@example.com`}`);
  account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  const [v] = await db().execute<Row>(sql`
    select v.id, v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.status = 'active' order by v.sku limit 1
  `);
  variant = { id: String(v.id), sku: String(v.sku) };
  await db().execute(sql`update commerce.inventory_levels set on_hand = 1 where variant_id = ${variant.id}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

/** An order of the store: paid or not, placed some days ago. */
async function order(n: number, status: "paid" | "pending_payment" | "fulfilled", daysAgo: number, total: number, captured = true) {
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${status}, ${total}, 0, 0, ${total},
      ${JSON.stringify({ name: "Ane" })}, ${JSON.stringify({ name: "Ane", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })},
      now() - make_interval(days => ${daysAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${storeId}::uuid, ${String(o.id)}::uuid, ${variant.id}::uuid, ${variant.sku}, 'Kopp', 1, ${total}, ${total}, 0, 0.25, 'txcd_99999999')
  `);
  if (captured) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
  }
}

describe("the control center (D107)", () => {
  it("shows a new owner's store as not open yet, with nothing sold", async () => {
    const view = await center.controlCenter(account);
    expect(view.stores).toHaveLength(1);
    expect(view.stores[0]).toMatchObject({ slug: `center-${run}`, role: "owner", open: false, toSend: 0, sales: [] });
    expect(view.latest).toEqual([]);
    expect(attentionFor(view.stores).map((i) => i.action)).toContain("Finish setup");
  });

  it("counts the week's paid sales against the week before, orders to send, and stock running out, in code", async () => {
    await order(1, "paid", 1, 20_000);
    await order(2, "fulfilled", 3, 10_000);
    await order(3, "paid", 10, 5_000);
    // Unpaid checkouts are never sales.
    await order(4, "pending_payment", 1, 99_000, false);
    const view = await center.controlCenter(account);
    const store = view.stores[0];
    expect(store.sales).toEqual([{ currency: "NOK", week: 30_000, prior: 5_000, orders: 2, priorOrders: 1 }]);
    expect(totalSales(view.stores)[0].week).toBe(30_000);
    // Two paid orders with something to ship: the recent one and the older one.
    expect(store.toSend).toBe(2);
    expect(store.oldestToSend && Date.now() - Date.parse(store.oldestToSend) > 9 * 86_400_000).toBe(true);
    expect(store.lowStock).toBeGreaterThanOrEqual(1);
    expect(view.latest.map((o) => o.number)).toEqual([`${run}-1`, `${run}-2`, `${run}-3`]);
    const text = attentionFor(view.stores).map((i) => i.text).join("\n");
    expect(text).toContain("2 orders are waiting to be sent");
  });

  it("gives one store's own view, and nothing for a store the account is not in", async () => {
    expect((await center.controlCenter(account, `center-${run}`)).stores).toHaveLength(1);
    expect((await center.controlCenter(account, "no-such-store")).stores).toEqual([]);
    const stranger: Account = { ...account, id: "00000000-0000-4000-8000-000000000000" };
    expect((await center.controlCenter(stranger)).stores).toEqual([]);
  });

  it("counts open privacy requests past their clock or due this week, per store, as counts only (D162)", async () => {
    const insert = async (email: string, status: string, receivedAgo: number, dueIn: number) => {
      await db().execute(sql`
        insert into commerce.privacy_requests (store_id, kind, channel, status, subject_email, received_at, due_at, handled_by)
        values (${storeId}::uuid, 'erasure', 'staff', ${status}, ${email}, now() - make_interval(days => ${receivedAgo}),
          now() + make_interval(days => ${dueIn}), ${account.id}::uuid)
      `);
    };
    // Overdue, due in 3 days, due in 20 days (not flagged), and one answered (never flagged).
    await insert(`p1-${run}@example.com`, "open", 40, -9);
    await insert(`p2-${run}@example.com`, "open", 27, 3);
    await insert(`p3-${run}@example.com`, "open", 10, 20);
    await db().execute(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, outcome, subject_email, received_at, due_at, completed_at, handled_by)
      values (${storeId}::uuid, 'export', 'staff', 'done', 'exported', ${`p4-${run}@example.com`}, now() - interval '50 days', now() - interval '20 days', now() - interval '30 days', ${account.id}::uuid)
    `);
    const view = await center.controlCenter(account);
    expect(view.stores[0].privacy).toEqual({ overdue: 1, dueSoon: 1 });
    const items = attentionFor(view.stores);
    expect(items.find((i) => i.text.includes("past the one-month deadline"))?.urgent).toBe(true);
    // Counts and ids only: nothing of the requests' emails reaches the figures.
    expect(JSON.stringify(view)).not.toContain(`p1-${run}`);
  });

  it("asks for no figures when there is no store, or for one the account has no request in", async () => {
    const { privacyAttention } = await import("./privacy-attention");
    expect((await privacyAttention([])).size).toBe(0);
    expect((await privacyAttention(["00000000-0000-4000-8000-000000000000"])).size).toBe(0);
  });
});

describe("the control center and stock (wave 3, D172)", () => {
  // A store of its own, so the stock above (set for the first test) does not change what is counted here.
  let stockAccount: Account;
  let stockStore: string;
  const variantOf: Record<string, string> = {};

  beforeAll(async () => {
    const email = `center-stock-${run}@example.com`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Siri', 'Stock') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`center-stock-${run}`}, 'Stock', null) as id`);
    stockStore = String(created.id);
    const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
    stockAccount = { id: String(row.id), email: String(row.email), name: "Siri", platformAdmin: false };
    for (const v of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${stockStore}::uuid`)) variantOf[String(v.sku)] = String(v.id);
    // Plenty of everything, then the cases.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where store_id = ${stockStore}::uuid`);
    const set = (sku: string, onHand: number) => db().execute(sql`update commerce.inventory_levels set on_hand = ${onHand} where variant_id = ${variantOf[sku]}::uuid`);
    await set("DEMO-MUG-WHITE", 0); // stops at zero: out
    await set("DEMO-THERMOS", -2); // keeps selling: not out, owed
    await set("DEMO-LAMP", 4); // own level 10: at or below it, and not in the fixed "3 or fewer"
    await set("DEMO-TOTE", 2); // no level of its own: running low by the fixed rule
    await db().execute(sql`update commerce.product_variants set low_stock_threshold = 10 where id = ${variantOf["DEMO-LAMP"]}::uuid`);
    // A closed location holding stock of the variant that is out: not for sale, so it is still out.
    const [closed] = await db().execute<Row>(sql`
      insert into commerce.inventory_locations (store_id, name, country, active) values (${stockStore}::uuid, 'Gammelt lager', 'NO', false) returning id
    `);
    await db().execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${stockStore}::uuid, ${variantOf["DEMO-MUG-WHITE"]}::uuid, ${String(closed.id)}::uuid, 100)
    `);
    // Units owed: paid and not sent, a sent order, and a copied one.
    let n = 0;
    const order = async (status: string, quantity: number, owed: number, copied = false) => {
      n += 1;
      const [o] = await db().execute<Row>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
          billing_address, shipping_address, copied_from)
        values (${stockStore}::uuid, ${`${copied ? "C-" : ""}${run}-s${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${status}, 1000, 0, 0, 1000, '{}'::jsonb, '{}'::jsonb, ${copied ? crypto.randomUUID() : null})
        returning id
      `);
      const line = (runner: Pick<ReturnType<typeof db>, "execute">) =>
        runner.execute(sql`
          insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery,
            backorder_quantity, backorder_days)
          values (${stockStore}::uuid, ${String(o.id)}::uuid, ${variantOf["DEMO-THERMOS"]}::uuid, 'DEMO-THERMOS', 'Termokopp', ${quantity}, 1000, ${1000 * quantity}, 0, 0.25,
            'txcd_99999999', 'physical', ${owed}, 7)
        `);
      if (copied) {
        await db().transaction(async (tx) => {
          await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
          await line(tx);
        });
      } else await line(db());
    };
    await order("paid", 2, 2);
    await order("fulfilled", 3, 3);
    await order("paid", 4, 4, true);
  });

  it("counts what cannot be sold as out, and what the owner's own level or the fixed rule flags as running low", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    // MUG-WHITE only: the thermos sells past zero, and the closed location's 100 do not count.
    expect(view.outOfStock).toBe(1);
    // The tote (2, no level) by the fixed rule; the lamp has a level of its own and is not counted twice, and the ones that are gone are out, not low.
    expect(view.lowStock).toBe(1);
    expect(view.belowLevel).toBe(1);
  });

  it("counts the units owed on paid orders not yet sent, never a sent or a copied one", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    expect(view.owedUnits).toBe(2);
  });

  it("agrees with the Inventory page's own counts", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    const { inventoryCounts } = await import("./inventory");
    const page = await inventoryCounts(stockStore);
    expect(view.owedUnits).toBe(page.owed);
    expect(view.belowLevel).toBe(page.low);
  });

  it("says it to the owner, with links that open the Inventory page filtered to it", async () => {
    const view = await center.controlCenter(stockAccount);
    const items = attentionFor(view.stores);
    const level = items.find((i) => i.text.includes("warning level you set"));
    expect(level).toMatchObject({ href: `/admin/center-stock-${run}/inventory?status=low`, action: "Open inventory" });
    expect(items.find((i) => i.text.includes("owed on backorder"))).toMatchObject({ href: `/admin/center-stock-${run}/inventory?status=backorder` });
    expect(items.find((i) => i.text.includes("out of stock"))).toBeDefined();
  });

  it("reads a warning level that was crossed by a sale: the lamp rises above its level and is no longer counted", async () => {
    await db().execute(sql`update commerce.inventory_levels set on_hand = 40 where variant_id = ${variantOf["DEMO-LAMP"]}::uuid`);
    expect((await center.controlCenter(stockAccount)).stores[0].belowLevel).toBe(0);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 4 where variant_id = ${variantOf["DEMO-LAMP"]}::uuid`);
    expect((await center.controlCenter(stockAccount)).stores[0].belowLevel).toBe(1);
  });

  it("leaves the stock out for a member who may not open Products, as a figure that is missing and never as zero", async () => {
    const view = (await center.controlCenter(stockAccount)).stores[0];
    expect(view.hides).toBeUndefined();
    const hidden = attentionFor([{ ...view, hides: ["stock"] }]);
    expect(hidden.some((i) => i.text.includes("owed") || i.text.includes("warning level") || i.text.includes("out of stock"))).toBe(false);
  });
});
