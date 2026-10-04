// Test support for the integration tests of the VAT, OSS and IOSS reports (D161): a store that sells in several countries and currencies,
// orders paid on a day of the test's choosing (the invoice's supply date is the day the payment was accepted, and the database makes an
// invoice at that moment, so a past day is made by taking invoicing off while the order is paid, moving the payment's event back, and
// letting the waiting invoice be issued). Not imported by the app.
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import { issueWaitingInvoices } from "./invoice-issue";
import * as fx from "./invoice-test-fixture";

type Row = Record<string, unknown>;

export const defs = {
  NO: { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  SE: { code: "SE", currency: "SEK", defaultLocale: "sv-SE" },
  DK: { code: "DK", currency: "DKK", defaultLocale: "da-DK" },
  DE: { code: "DE", currency: "EUR", defaultLocale: "de-DE" },
  FR: { code: "FR", currency: "EUR", defaultLocale: "fr-FR" },
} as const;
export const markets = { no: toMarket(defs.NO), se: toMarket(defs.SE), dk: toMarket(defs.DK), de: toMarket(defs.DE), fr: toMarket(defs.FR) };

/** The ECB's real rates of 30 September 2026 (read 2026-10-04), which the worked example of the spec rests on. */
export const ECB_2026_09_30 = { NOK: "10.9015", SEK: "11.331", DKK: "7.4755" } as const;

export async function insertEcb(day: string, rates: Record<string, string>) {
  for (const [currency, rate] of Object.entries(rates)) {
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values (${day}::date, ${currency}, ${rate}::numeric) on conflict do nothing`);
  }
}

export type SellerOptions = {
  country?: "SE" | "NO";
  /** The profile: the Union scheme with Sweden as member state, or an IOSS number for the listed markets. */
  oss?: boolean;
  ioss?: { number: string; markets: string[]; intermediary?: string };
  dispatch?: string;
  /** Prices of the demo mug with VAT in the market's own currency (minor units). */
  mugDE?: number;
  mugDK?: number;
  mugFR?: number;
  /** Invoicing is off until `issueBackdated()`; set `false` for a store whose invoices are made at payment. */
  invoicingOff?: boolean;
  /** Add a market for Germany and France with prices and no shipping. */
  eu?: boolean;
};

/** A store selling from Sweden (or Norway) to Germany, France and Denmark, free shipping everywhere, its prices set to round numbers. */
export async function sellerStore(label: string, o: SellerOptions = {}): Promise<fx.Fixture> {
  const country = o.country ?? "SE";
  const own = await fx.makeStore(label, { invoicing: o.invoicingOff === false ? true : false });
  const id = own.storeId;
  await db().execute(sql`update commerce.stores set country = ${country}, legal_name = 'Fixture AB', organisation_number = '556677889901', postal_address = 'Storgatan 1\n111 22 Stockholm' where id = ${id}::uuid`);
  await db().execute(sql`
    update commerce.store_tax_profile set vat_number = ${country === "SE" ? "SE556677889901" : "NO923456789MVA"}, oss_scheme = ${o.oss === false ? "none" : country === "SE" ? "union" : "none"},
      oss_member_state = ${o.oss === false || country !== "SE" ? null : "SE"}, dispatch_country = ${o.dispatch ?? country}
    where store_id = ${id}::uuid
  `);
  if (o.ioss) {
    await db().execute(sql`
      update commerce.store_tax_profile set ioss_number = ${o.ioss.number}, ioss_intermediary = ${o.ioss.intermediary ?? null}, ioss_markets = ${`{${o.ioss.markets.join(",")}}`}::text[]
      where store_id = ${id}::uuid
    `);
  }
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${id}::uuid, 'SEK', 11, 1, 2), (${id}::uuid, 'DKK', 7.5, 1, 3)
    on conflict do nothing
  `);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('DE', 'FR')
    on conflict do nothing
  `);
  const variants = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${id}::uuid`);
  const variant = (sku: string) => String(variants.find((v) => v.sku === sku)!.id);
  const prices: [string, string, number][] = [
    ["DEMO-MUG-WHITE", "DE", o.mugDE ?? 11_900],
    ["DEMO-MUG-WHITE", "DK", o.mugDK ?? 125_000],
    ["DEMO-MUG-WHITE", "FR", o.mugFR ?? 12_000],
    ["DEMO-LAMP", "DE", 11_900],
    ["DEMO-LAMP", "DK", 125_000],
    ["DEMO-NOTEBOOK-LINED", "DE", 2_000],
  ];
  for (const [sku, market, price] of prices) await db().execute(sql`select commerce.set_price(${variant(sku)}::uuid, ${market}, ${price})`);
  await db().execute(sql`delete from commerce.shipping_rates where store_id = ${id}::uuid and market_code in ('DE', 'FR', 'DK', 'SE', 'NO')`);
  await db().execute(sql`
    insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor)
    values (${id}::uuid, 'DE', 'EUR', 0), (${id}::uuid, 'FR', 'EUR', 0), (${id}::uuid, 'DK', 'DKK', 0), (${id}::uuid, 'SE', 'SEK', 0), (${id}::uuid, 'NO', 'NOK', 0)
  `);
  // The demo lamp is a download here.
  await db().execute(sql`update commerce.product_variants set delivery = 'digital' where store_id = ${id}::uuid and sku = 'DEMO-LAMP'`);
  await db().execute(sql`
    update commerce.products p set delivery = 'digital', download_limit = 2, download_days = 7
    from commerce.product_variants v where v.product_id = p.id and v.store_id = ${id}::uuid and v.sku = 'DEMO-LAMP'
  `);
  return own;
}

/**
 * The day an order was placed and paid, moved back (the event log is immutable, so its guard is lifted for the one update, in one
 * transaction). Noon in the store's time zone, so the store day is the day asked for.
 */
export async function backdate(storeId: string, orderId: string, day: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`alter table commerce.order_events disable trigger order_events_append_only`);
    await tx.execute(sql`
      update commerce.order_events set created_at = ((${day}::date + time '12:00') at time zone (select time_zone from commerce.stores where id = ${storeId}::uuid))
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = 'order.paid'
    `);
    await tx.execute(sql`alter table commerce.order_events enable trigger order_events_append_only`);
    await tx.execute(sql`
      update commerce.orders set placed_at = ((${day}::date + time '12:00') at time zone (select time_zone from commerce.stores where id = ${storeId}::uuid))
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
  });
}

/** Switches invoicing on for the store and issues the invoices that waited (their supply date is the day of the payment event). */
export async function issueBackdated(storeId: string): Promise<number> {
  // Switching invoicing on stamps `enabled_from` (an order paid before it is never invoiced), so the stamp is moved back past the backdated payments.
  await db().execute(sql`update commerce.invoice_settings set enabled = true where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.invoice_settings set enabled_from = null where store_id = ${storeId}::uuid`);
  return issueWaitingInvoices(storeId, 500);
}

/** A paid order on a past day. The store must have invoicing off (`sellerStore()` default); call `issueBackdated()` once all are placed. */
export async function paidOn(store: fx.Fixture, day: string, items: [sku: string, quantity: number][], o: fx.PayOptions = {}): Promise<fx.Placed> {
  // A basket with a download needs the shopper's consent to its immediate delivery.
  const placed = await fx.paidOrder(store, items, { consent: items.some(([sku]) => sku === "DEMO-LAMP") ? { digital: true } : undefined, ...o });
  await backdate(store.storeId, placed.orderId, day);
  return placed;
}
