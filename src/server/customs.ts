import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { conversionFactor, type Rates, type StoreCurrency } from "@/lib/currency";
import {
  APPLIES_TO,
  crossesBorder,
  customsDecision,
  dutyEstimate,
  isCustomsMode,
  orderCustomsOf,
  type CustomsDecision,
  type CustomsMode,
  type DdpFallback,
  type DutyLine,
  type DutyRow,
  type OrderCustoms,
} from "@/lib/duties";
import type { BookingCustoms } from "@/lib/shipping-carriers";
import { EU_COUNTRIES, isEuMemberCountry } from "@/lib/vat-number";

import { audit } from "./auth";
import type { OrderView } from "./orders";
import type { TaxFacts } from "./tax-treatment";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` section 4, I): what a basket's duties and import VAT come to where its goods
 * cross a customs border, and who pays them, decided ONCE for the cart page (`cartSummary()`) and for the order (`placeOrder()`): both call
 * `loadCustomsFacts()` and then `decideCustoms()` with the same basket (each shipped line after every discount and its VAT, and the shipping), so the
 * estimate the cart shows is the one the order keeps and DDP collects. The arithmetic is `dutyEstimate()` (`src/lib/duties.ts`); the rates are the
 * platform's own table (`commerce.duty_rates`, read here only; written by `src/server/duty-rates.ts`). This module is also the only writer of a
 * store's choice per country (`commerce.customs_settings`). Every query of a store's table takes its id.
 */

const dayCol = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DUTY_RATE_ROW = z.object({
  id: col.uuid,
  destination: col.text,
  hs_prefix: col.text,
  origin: col.textOrNull,
  applies_to: z.enum(APPLIES_TO),
  duty_rate_bps: col.int.nullable(),
  per_item_minor: col.minorOrNull,
  threshold_minor: col.minorOrNull,
  vat_threshold_minor: col.minorOrNull,
  threshold_currency: col.currency.nullable(),
  threshold_per: z.enum(["consignment", "item"]),
  import_vat_bps: col.int.nullable(),
  shipping_in_value: col.bool,
  source: col.text,
  verified: col.bool,
  valid_from: dayCol.nullable(),
  valid_to: dayCol.nullable(),
});

export const asDutyRow = (r: z.output<typeof DUTY_RATE_ROW>): DutyRow => ({
  id: r.id,
  destination: r.destination,
  hsPrefix: r.hs_prefix,
  origin: r.origin,
  appliesTo: r.applies_to,
  dutyRateBps: r.duty_rate_bps,
  perItemMinor: r.per_item_minor,
  thresholdMinor: r.threshold_minor,
  vatThresholdMinor: r.vat_threshold_minor,
  thresholdCurrency: r.threshold_currency,
  thresholdPer: r.threshold_per,
  importVatBps: r.import_vat_bps,
  shippingInValue: r.shipping_in_value,
  source: r.source,
  verified: r.verified,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

export const DUTY_RATE_COLUMNS = sql`id, destination, hs_prefix, origin, applies_to, duty_rate_bps, per_item_minor, threshold_minor, vat_threshold_minor,
  threshold_currency, threshold_per, import_vat_bps, shipping_in_value, source, verified,
  to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to`;

/** The rows a destination may use (its own and the EU's for a member state), whatever the day: `dutyEstimate()` picks by day and scheme. */
export async function dutyRowsFor(destination: string, runner: Executor = db()): Promise<DutyRow[]> {
  const places = isEuMemberCountry(destination) ? [destination, "EU"] : [destination];
  const rows = await typedRows(
    DUTY_RATE_ROW,
    sql`select ${DUTY_RATE_COLUMNS} from commerce.duty_rates
        where destination in (${sql.join(places.map((p) => sql`${p}`), sql`, `)})
        order by destination, hs_prefix, origin nulls first, valid_from nulls first`,
    runner,
  );
  return rows.map(asDutyRow);
}

/** What the decision rests on, read once per cart page and once inside the order's transaction. */
export type CustomsFacts = {
  destination: string;
  dispatch: string | null;
  /** The store's choice for the destination (no row: DAP). */
  chosen: CustomsMode;
  /** The store is registered to collect the destination's VAT at the sale (VOEC); into the EU, IOSS is the tax decision's. */
  vatScheme: boolean;
  /** The store's own day. */
  on: string;
  rows: DutyRow[];
  /** The store's rates, with the ECB's latest reference rates for currencies the store keeps none for (a threshold's currency). */
  rates: Rates;
  /** Each variant's HS code and origin. */
  variants: Map<string, { hsCode: string | null; origin: string | null }>;
};

const SETTINGS_ROW = z.object({ mode: col.text, vat_scheme: col.bool, today: dayCol });

export async function loadCustomsFacts(
  runner: Executor,
  input: { storeId: string; market: { code: string }; variantIds: readonly string[]; tax: Pick<TaxFacts, "seller" | "rates"> },
): Promise<CustomsFacts> {
  const { storeId, market } = input;
  const ids = [...new Set(input.variantIds)];
  const dispatch = input.tax.seller.dispatchCountry;
  // Nothing to read where nothing can cross a border (the store's own country, the EU's customs union, an empty basket): the estimate is none.
  if (ids.length === 0 || (dispatch !== null && !crossesBorder(dispatch, market.code))) {
    return { destination: market.code, dispatch, chosen: "dap", vatScheme: false, on: new Date().toISOString().slice(0, 10), rows: [], rates: input.tax.rates, variants: new Map() };
  }
  const [settings, rows, variants, ecb] = await Promise.all([
    typedRow(
      SETTINGS_ROW,
      sql`select coalesce(cs.mode, 'dap') as mode, coalesce(cs.vat_scheme, false) as vat_scheme,
            to_char((now() at time zone s.time_zone)::date, 'YYYY-MM-DD') as today
          from commerce.stores s
          left join commerce.customs_settings cs on cs.store_id = s.id and cs.market_code = ${market.code}
          where s.id = ${storeId}::uuid`,
      runner,
    ),
    dutyRowsFor(market.code, runner),
    ids.length === 0
      ? Promise.resolve([])
      : typedRows(
          z.object({ id: col.uuid, hs_code: col.textOrNull, origin_country: col.textOrNull }),
          sql`select id, hs_code, trim(origin_country) as origin_country from commerce.product_variants
              where store_id = ${storeId}::uuid and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
          runner,
        ),
    typedRows(
      z.object({ currency: col.currency, rate: col.decimal }),
      sql`select distinct on (currency) currency, rate from commerce.ecb_reference_rates order by currency, rate_date desc`,
      runner,
    ),
  ]);
  const rates = new Map<string, StoreCurrency>(input.tax.rates);
  for (const r of ecb) if (!rates.get(r.currency)?.rate) rates.set(r.currency, { currency: r.currency, rate: r.rate, roundTo: 1 });
  return {
    destination: market.code,
    dispatch: input.tax.seller.dispatchCountry,
    chosen: isCustomsMode(settings?.mode) ? settings.mode : "dap",
    vatScheme: settings?.vat_scheme ?? false,
    on: settings?.today ?? new Date().toISOString().slice(0, 10),
    rows,
    rates,
    variants: new Map(variants.map((v) => [v.id, { hsCode: v.hs_code, origin: v.origin_country }])),
  };
}

/** One line of the basket as both callers give it: the tax decision's line (after every discount) and what it is. */
export type CustomsBasketLine = {
  key: string;
  variantId: string;
  title: string;
  quantity: number;
  /** Shipped goods (a physical line that is not a booking, and not a free gift a campaign added: the cart page has none). */
  shipped: boolean;
  /** The tax decision's line: its total and the VAT in it. */
  totalMinor: number;
  taxMinor: number;
  /** The goods' VAT rate in the destination, as a fraction (0.25), as order lines keep it. */
  rate: number;
};

export type CustomsBasket = {
  lines: readonly CustomsBasketLine[];
  /** The tax decision's shipping: its total and the VAT in it. */
  shippingMinor: number;
  shippingTaxMinor: number;
  currency: string;
  /** The order is an IOSS sale (the tax decision's `ioss === "applies"`): its VAT is collected at the sale. */
  ioss: boolean;
  /** A purchase DDP cannot be collected for: its payment is not the checkout's alone. */
  fallback: DdpFallback | null;
};

export type CustomsOutcome = CustomsDecision & {
  /** What the order keeps (`orders.customs`); null when nothing crosses a border. */
  record: OrderCustoms | null;
};

/** The decision over the facts and the basket. Pure arithmetic over what `loadCustomsFacts()` read; the cart page and `placeOrder()` both call it. */
export function decideCustoms(facts: CustomsFacts, basket: CustomsBasket): CustomsOutcome {
  const lines: DutyLine[] = basket.lines
    .filter((l) => l.shipped)
    .map((l) => {
      const v = facts.variants.get(l.variantId);
      return {
        key: l.key,
        title: l.title,
        hsCode: v?.hsCode ?? null,
        origin: v?.origin ?? null,
        quantity: l.quantity,
        valueMinor: l.totalMinor - l.taxMinor,
        vatMinor: l.taxMinor,
        vatRateBps: Math.round(l.rate * 10_000),
      };
    });
  const estimate = dutyEstimate({
    destination: facts.destination,
    dispatch: facts.dispatch,
    on: facts.on,
    currency: basket.currency,
    scheme: isEuMemberCountry(facts.destination) ? basket.ioss : facts.vatScheme,
    lines,
    shippingMinor: lines.length > 0 ? basket.shippingMinor - basket.shippingTaxMinor : 0,
    shippingVatMinor: lines.length > 0 ? basket.shippingTaxMinor : 0,
    rows: facts.rows,
    factorTo: (to) => conversionFactor(basket.currency, to, facts.rates)?.factor ?? null,
  });
  const decision = customsDecision(facts.chosen, estimate, basket.fallback);
  return { ...decision, record: orderCustomsOf(decision, facts.destination, basket.currency, facts.on) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The store's choice per country (Settings → Customs and duties)
// ---------------------------------------------------------------------------------------------------------------------

export type CustomsMarket = {
  code: string;
  currency: string;
  /** Goods sent from the store's dispatch country cross a customs border into it. */
  crosses: boolean;
  mode: CustomsMode;
  vatScheme: boolean;
  /** The platform's table has rows for the country (its own or the EU's). */
  inTable: boolean;
};

/** The store's countries (active markets) with its choice for each and whether the table covers it; the dispatch country decides which cross a border. */
export async function customsMarkets(storeId: string, dispatch: string | null, runner: Executor = db()): Promise<CustomsMarket[]> {
  const rows = await typedRows(
    z.object({ code: z.string().transform((v) => v.trim()), currency: col.currency, mode: col.text, vat_scheme: col.bool, in_table: col.bool }),
    sql`
      select m.code, m.currency, coalesce(cs.mode, 'dap') as mode, coalesce(cs.vat_scheme, false) as vat_scheme,
        exists (select 1 from commerce.duty_rates d where d.destination = m.code
                  or (d.destination = 'EU' and m.code = any(${`{${EU_COUNTRIES.join(",")}}`}::text[]))) as in_table
      from commerce.markets m
      left join commerce.customs_settings cs on cs.store_id = m.store_id and cs.market_code = m.code
      where m.store_id = ${storeId}::uuid and m.active
      order by m.created_at, m.code
    `,
    runner,
  );
  return rows.map((r) => ({
    code: r.code,
    currency: r.currency,
    crosses: crossesBorder(dispatch, r.code),
    mode: isCustomsMode(r.mode) ? r.mode : "dap",
    vatScheme: r.vat_scheme,
    inTable: r.in_table,
  }));
}

export const customsSettingInput = z.object({
  market: z.string().trim().regex(/^[A-Z]{2}$/),
  mode: z.enum(["dap", "ddp"]),
  vatScheme: z.boolean().default(false),
});

export type CustomsSaveResult = { ok: true } | { ok: false; problem: "not_found" | "invalid" | "no_border" };

/**
 * Saves the store's choice for one country (DAP removes the row unless the VAT scheme is ticked). Only a country of the store's own whose goods cross a
 * border takes DDP. Audited `shipping.customs_saved` (country, mode, scheme; area settings). The caller has checked `settings:write`.
 */
export async function saveCustomsSetting(accountId: string | null, storeId: string, raw: unknown, dispatch: string | null): Promise<CustomsSaveResult> {
  const parsed = customsSettingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const { market, mode, vatScheme } = parsed.data;
  const found = await typedRow(
    z.object({ code: col.text }),
    sql`select code from commerce.markets where store_id = ${storeId}::uuid and code = ${market}`,
  );
  if (!found) return { ok: false, problem: "not_found" };
  if (mode === "ddp" && !crossesBorder(dispatch, market)) return { ok: false, problem: "no_border" };
  if (mode === "dap" && !vatScheme) {
    await db().execute(sql`delete from commerce.customs_settings where store_id = ${storeId}::uuid and market_code = ${market}`);
  } else {
    await db().execute(sql`
      insert into commerce.customs_settings (store_id, market_code, mode, vat_scheme, updated_at)
      values (${storeId}::uuid, ${market}, ${mode}, ${vatScheme}, now())
      on conflict (store_id, market_code) do update set mode = excluded.mode, vat_scheme = excluded.vat_scheme, updated_at = now()
    `);
  }
  await audit(accountId, storeId, "shipping.customs_saved", { market, mode, vatScheme }, { target: { type: "market", id: market } });
  return { ok: true };
}

/** How many of the store's active products have a shipped variant with no HS code: what a DDP checkout would refuse. */
export async function productsWithoutHsCode(storeId: string, runner: Executor = db()): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(distinct p.id)::int as n from commerce.products p
        join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id
        where p.store_id = ${storeId}::uuid and p.status = 'active' and v.active and v.delivery = 'physical' and v.hs_code is null`,
    runner,
  );
  return row?.n ?? 0;
}

/**
 * The customs declaration a carrier booking carries for an order whose parcel crosses a customs border (D343): each shipped line's HS code and
 * origin as the product holds them now, its value without VAT in the order's currency, its title, quantity and weight. Who pays duties is the
 * order's own record (DDP when they were collected at checkout, else DAP). A line without a code or a weight is passed on as it is, so the
 * carrier's `book()` refuses it with a plain reason (`bookingCustomsProblem()`); nothing here invents a code, an origin or a weight.
 */
export async function bookingCustomsFor(
  storeId: string,
  order: Pick<OrderView, "id" | "number" | "currency" | "placedAt" | "customs">,
  runner: Executor = db(),
): Promise<BookingCustoms> {
  const lines = await typedRows(
    z.object({ title: col.text, quantity: col.int, value: col.minor, hs_code: col.textOrNull, origin: col.textOrNull, grams: col.int.nullable() }),
    sql`select l.title, l.quantity, (l.total_minor - l.tax_minor) as value, v.hs_code, trim(v.origin_country) as origin, (l.quantity * v.weight_grams)::int as grams
        from commerce.order_lines l
        join commerce.product_variants v on v.store_id = l.store_id and v.id = l.variant_id
        where l.store_id = ${storeId}::uuid and l.order_id = ${order.id}::uuid and l.delivery = 'physical'
        order by l.id`,
    runner,
  );
  return {
    incoterm: order.customs?.mode === "ddp" ? "DDP" : "DAP",
    currency: order.currency,
    invoiceNumber: order.number,
    invoiceDate: order.placedAt.slice(0, 10),
    lines: lines.map((l) => ({ hsCode: l.hs_code ?? "", origin: l.origin ?? "", valueMinor: l.value, description: l.title, quantity: l.quantity, weightGrams: l.grams ?? 0 })),
  };
}
