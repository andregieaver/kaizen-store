import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { requestDrills, runLiveDrills } = await import("./live-drills");

/** Live drills (D406): only a test-mode store, only orders paid on a test account to Resend's test domain. */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId: string;
const account = `acct_drill${run}`;

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Drill') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Drill', null) as id`);
  return String(store.id);
}

/** A paid order of one physical line, its payment captured on the given account. */
async function paidOrder(n: string, email: string, providerAccount: string | null): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address)
    values (${storeId}::uuid, ${`DR-${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', 19900, 0, 0, 3980, 19900, '{}'::jsonb, '{}'::jsonb)
    returning id
  `);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    select ${storeId}::uuid, ${id}::uuid, v.id, v.sku, 'Mug', 1, 19900, 19900, 3980, 0.25, 'txcd_99999999'
    from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where p.store_id = ${storeId}::uuid and p.kind = 'goods' and v.delivery = 'physical' order by v.sku limit 1
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
    values (${storeId}::uuid, ${id}::uuid, 'stripe', ${`cs_drill_${run}_${n}`}, ${providerAccount}, 19900, 0, 'NOK', 'captured')
  `);
  return id;
}

const shipments = async (orderId: string) =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${orderId}::uuid`))[0].n);

beforeAll(async () => {
  storeId = await newStore("drills");
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${account}, 'active', false)`);
  await db().execute(sql`
    insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${storeId}::uuid, 'stripe', true, 'test')
    on conflict (store_id, provider) do update set enabled = true, active_mode = 'test'
  `);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.live_drills where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("live drills (D406)", () => {
  it("refuses a store whose checkout is not in test mode, and an empty plan", async () => {
    const live = await newStore("drills-live");
    await db().execute(sql`
      insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${live}::uuid, 'stripe', true, 'live')
      on conflict (store_id, provider) do update set enabled = true, active_mode = 'live'
    `);
    expect(await requestDrills(live, ["mark_sent"], null)).toMatchObject({ ok: false });
    expect(await requestDrills(storeId, ["nonsense"], null)).toMatchObject({ ok: false });
  });

  it("marks sent only an order paid on a test account to Resend's test domain, and keeps the result", async () => {
    const shopper = await paidOrder("1", "kari@example.com", account);
    const unknownAccount = await paidOrder("2", "delivered@resend.dev", null);
    const drill = await paidOrder("3", "delivered@resend.dev", account);
    const asked = await requestDrills(storeId, ["mark_sent"], null);
    expect(asked.ok).toBe(true);
    // Another request may be waiting from other tests: run until ours is done.
    for (let i = 0; i < 5; i++) {
      await runLiveDrills();
      const [row] = await db().execute<Row>(sql`select status from commerce.live_drills where id = ${asked.ok ? asked.id : ""}::uuid`);
      if (row.status === "done") break;
    }
    const [done] = await db().execute<Row>(sql`select status, results from commerce.live_drills where id = ${asked.ok ? asked.id : ""}::uuid`);
    expect(done.status).toBe("done");
    expect(done.results).toEqual([expect.objectContaining({ kind: "mark_sent", outcome: "passed", order: `DR-${run}-3` })]);
    expect(await shipments(drill)).toBe(1);
    expect(await shipments(shopper)).toBe(0);
    expect(await shipments(unknownAccount)).toBe(0);
  });

  it("writes Kaizena Flow's legal pages only for a platform admin who asked", async () => {
    const [person] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`drill-staff-${run}@example.com`}, 'Staff') returning id`);
    for (const requester of [null, String(person.id)]) {
      const asked = await requestDrills(storeId, ["platform_legal_pages"], requester);
      if (!asked.ok) throw new Error(asked.problem);
      for (let i = 0; i < 5; i++) {
        await runLiveDrills();
        const [row] = await db().execute<Row>(sql`select status from commerce.live_drills where id = ${asked.id}::uuid`);
        if (row.status === "done") break;
      }
      const [done] = await db().execute<Row>(sql`select results from commerce.live_drills where id = ${asked.id}::uuid`);
      expect(done.results).toEqual([expect.objectContaining({ kind: "platform_legal_pages", outcome: "skipped" })]);
    }
  });
});
