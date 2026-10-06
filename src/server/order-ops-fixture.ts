import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { newStore, type TestStore } from "./inventory-test-support";

type Row = Record<string, unknown>;

/**
 * What the order-operations tests share (wave 3, run 2, D173): a store with invoicing switched off (so orders written straight into the database, which never went through
 * `complete_order_payment()`, make no invoice and a refund of one makes no credit note), and `seedOrder()`, which writes one order the way the list needs to see it. A test file
 * that uses this mocks `server-only`, `next/headers`, `next/cache` and `./stripe` itself. Never imported by the app (a fixture, so the numbering scan test does not read it).
 */

export type Seed = {
  status?: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  market?: "NO" | "SE" | "DK";
  placedAt?: Date;
  totalMinor?: number;
  email?: string;
  name?: string;
  /** Lines: title and sku; `physical` false is a download. */
  lines?: { title: string; sku: string; quantity?: number; physical?: boolean; backorder?: number }[];
  /** A captured Stripe payment for the whole total, and a refund of this much (succeeded). */
  captured?: boolean;
  refundedMinor?: number;
  balanceMinor?: number;
  tracking?: string;
  tags?: string[];
  gift?: { to?: string; from?: string; message?: string } | null;
  draft?: { accountId: string } | null;
  copied?: boolean;
  archived?: boolean;
  restricted?: boolean;
  anonymised?: boolean;
};

const CURRENCY = { NO: "NOK", SE: "SEK", DK: "DKK" } as const;
const LOCALE = { NO: "nb-NO", SE: "sv-SE", DK: "da-DK" } as const;

/** A store whose invoicing is off. */
export async function newPlainStore(label: string): Promise<TestStore> {
  const store = await newStore(label);
  await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${store.storeId}::uuid, false) on conflict (store_id) do update set enabled = false`);
  return store;
}

/** Writes one order (and its lines, payment, refund, shipment and tags) as the Orders page will read it; returns its id and number. */
export async function seedOrder(store: Pick<TestStore, "storeId" | "account">, seed: Seed = {}): Promise<{ id: string; number: string }> {
  const storeId = store.storeId;
  const market = seed.market ?? "NO";
  const status = seed.status ?? "paid";
  const total = seed.totalMinor ?? 10_000;
  const tx = async (run: (tx: Pick<ReturnType<typeof db>, "execute">) => Promise<{ id: string; number: string }>) => db().transaction((t) => run(t));
  return tx(async (t) => {
    if (seed.copied) await t.execute(sql`select set_config('commerce.copying', 'on', true)`);
    const [numbered] = seed.copied
      ? await t.execute<Row>(sql`select 'C-' || (floor(random() * 1e9)::bigint)::text as number`)
      : await t.execute<Row>(sql`select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number from commerce.document_series s where s.store_id = ${storeId}::uuid and s.series = 'order'`);
    const number = String(numbered.number);
    const gift = seed.gift ?? null;
    const [order] = await t.execute<Row>(sql`
      insert into commerce.orders (
        store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
        billing_address, shipping_address, placed_at, balance_minor, copied_from, archived_at, restricted_at, anonymised_at,
        is_gift, gift_to, gift_from, gift_message, source, draft_id, made_by
      ) values (
        ${storeId}::uuid, ${number}, ${market}, ${CURRENCY[market]}, ${LOCALE[market]}, ${seed.email ?? "buyer@example.com"}, ${status},
        ${total}, 0, 0, ${Math.round(total * 0.2)}, ${total},
        ${seed.anonymised ? "{}" : JSON.stringify({ name: seed.name ?? "Test Buyer" })}::jsonb,
        ${seed.anonymised ? "{}" : JSON.stringify({ name: seed.name ?? "Test Buyer", line1: "Storgata 1", postalCode: "0155", city: "Oslo" })}::jsonb,
        ${(seed.placedAt ?? new Date()).toISOString()}::timestamptz, ${seed.balanceMinor ?? 0},
        ${seed.copied ? sql`gen_random_uuid()` : sql`null`}, ${seed.archived ? sql`now()` : sql`null`},
        ${seed.restricted ? sql`now()` : sql`null`}, ${seed.anonymised ? sql`now()` : sql`null`},
        ${Boolean(gift)}, ${gift?.to ?? null}, ${gift?.from ?? null}, ${gift?.message ?? null},
        ${seed.draft ? "draft" : "checkout"}, ${seed.draft ? sql`gen_random_uuid()` : sql`null`}, ${seed.draft ? seed.draft.accountId : null}::uuid
      )
      returning id
    `);
    const id = String(order.id);
    const lines = seed.lines ?? [{ title: "Mug White", sku: "MUG-1", quantity: 1, physical: true }];
    for (const line of lines) {
      await t.execute(sql`
        insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery,
          backorder_quantity, backorder_days)
        values (${storeId}::uuid, ${id}::uuid, ${line.sku}, ${line.title}, ${line.quantity ?? 1}, ${Math.floor(total / (lines.length * (line.quantity ?? 1)))}, 0,
          ${Math.floor(total / lines.length)}, 0, 0.25, 'txcd_99999999', 'none', ${line.physical === false ? "digital" : "physical"},
          ${line.backorder ?? 0}, ${line.backorder ? 7 : null})
      `);
    }
    if (seed.captured || seed.refundedMinor) {
      const reference = `cs_${id}`;
      const [payment] = await t.execute<Row>(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
        values (${storeId}::uuid, ${id}::uuid, 'stripe', ${reference}, ${store.account}, ${total}, ${CURRENCY[market]}, 'captured') returning id
      `);
      if (seed.refundedMinor) {
        await t.execute(sql`
          insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
          values (${storeId}::uuid, ${String(payment.id)}::uuid, ${seed.refundedMinor}, 'test', ${`re_${id}`}, 'succeeded')
        `);
      }
    }
    if (seed.tracking) {
      await t.execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values (${storeId}::uuid, ${id}::uuid, 'Posten', ${seed.tracking})`);
    }
    for (const label of seed.tags ?? []) {
      await t.execute(sql`insert into commerce.order_tags (store_id, order_id, key, label) values (${storeId}::uuid, ${id}::uuid, ${label.toLowerCase()}, ${label})`);
    }
    if (seed.copied) await t.execute(sql`select set_config('commerce.copying', 'off', true)`);
    return { id, number };
  });
}
