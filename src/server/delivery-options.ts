import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  CHECKOUT_COUNTRIES,
  CHECKOUT_PRICING,
  DEFAULT_CHECKOUT_SETTINGS,
  MAX_OPTIONS,
  MAX_PICKUP_POINTS,
  MAX_WINDOWS,
  QUOTE_MINUTES,
  cleanPostalCode,
  estimateDays,
  shopperPrice,
  type CheckoutSettings,
  type DeliveryOption,
  type DeliveryOptions,
  type OrderDelivery,
  type QuotedPickupPoint,
} from "@/lib/delivery-options";
import { shown, type Market } from "@/lib/markets";
import { carrierInfo, type CarrierContext, type CarrierId, type PickupPoint, type ShippingAddress, type ShippingOption } from "@/lib/shipping-carriers";
import { BRING_PRODUCTS } from "@/lib/bring";
import { POSTNORD_SERVICES } from "@/lib/postnord";
import { PORTERBUDDY_PRODUCTS } from "@/lib/porterbuddy";
import { HELTHJEM_SERVICES } from "@/lib/helthjem";

import { audit } from "./auth";
import { adapterFor } from "./carriers";
import { carrierContext } from "./shipping-carriers";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Delivery options at checkout (D135, `src/lib/delivery-options.ts`): a carrier's services shown to the shopper next to
 * the market's flat rate. `quoteDelivery()` asks the store's carrier agreement for the services and prices for a postal
 * code and keeps each answer as a `delivery_quotes` row; `chooseDelivery()` puts one on the cart, and `chosenDelivery()`
 * is what `cartSummary()` and `placeOrder()` both read, so the price is the one shown and no carrier is called while an
 * order is placed. A carrier that does not answer leaves the flat rate, never an empty checkout.
 */

/** The services of a carrier a store may offer at checkout, by its own ids. */
export const CHECKOUT_SERVICES: Partial<Record<CarrierId, { id: string; name: string; needsPickupPoint: boolean; maxWeightGrams?: number }[]>> = {
  bring: BRING_PRODUCTS,
  postnord: POSTNORD_SERVICES,
  porterbuddy: PORTERBUDDY_PRODUCTS,
  helthjem: HELTHJEM_SERVICES,
};

/** The carriers that have checkout services built. */
export const CHECKOUT_CARRIERS = Object.keys(CHECKOUT_SERVICES) as CarrierId[];

// ---------------------------------------------------------------------------
// The store's settings
// ---------------------------------------------------------------------------

export async function getCheckoutSettings(runner: Runner, storeId: string, carrier: CarrierId): Promise<CheckoutSettings> {
  const [row] = await runner.execute<Row>(sql`
    select checkout_enabled, checkout_services, markup_percent, markup_minor, free_over_minor, default_weight_grams, checkout_prices
    from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = ${carrier}
  `);
  if (!row) return DEFAULT_CHECKOUT_SETTINGS;
  return {
    enabled: Boolean(row.checkout_enabled),
    services: (row.checkout_services ?? []) as string[],
    markup: { percent: Number(row.markup_percent), minor: Number(row.markup_minor) },
    freeOverMinor: row.free_over_minor === null ? null : Number(row.free_over_minor),
    defaultWeightGrams: Number(row.default_weight_grams),
    prices: (row.checkout_prices ?? {}) as CheckoutSettings["prices"],
  };
}

/** Saves what the store offers at checkout. The carrier's agreement must be saved and complete first. */
export async function saveCheckoutSettings(
  accountId: string,
  storeId: string,
  carrier: CarrierId,
  settings: CheckoutSettings,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const known = (CHECKOUT_SERVICES[carrier] ?? []).map((s) => s.id);
  if (known.length === 0) return { ok: false, problems: ["This carrier has no services at checkout yet."] };
  if (settings.services.some((id) => !known.includes(id))) return { ok: false, problems: ["One of the services is not one this carrier offers."] };
  const rows = await db().execute<Row>(sql`
    update commerce.shipping_carriers set
      checkout_enabled = ${settings.enabled}, checkout_services = ARRAY[${sql.join(settings.services.map((s) => sql`${s}`), sql`, `)}]::text[],
      markup_percent = ${settings.markup.percent}, markup_minor = ${settings.markup.minor},
      free_over_minor = ${settings.freeOverMinor}, default_weight_grams = ${settings.defaultWeightGrams},
      checkout_prices = ${JSON.stringify(settings.prices)}::jsonb,
      updated_at = now(), updated_by = ${accountId}::uuid
    where store_id = ${storeId}::uuid and carrier = ${carrier} and (complete or not ${settings.enabled})
    returning carrier
  `);
  if (rows.length === 0) return { ok: false, problems: ["Save all the agreement details first, then switch the services on."] };
  await audit(accountId, storeId, "shipping.checkout_saved", { carrier, enabled: settings.enabled, services: settings.services.length });
  return { ok: true };
}

type ActiveCarrier = { carrier: CarrierId; settings: CheckoutSettings };

/**
 * The carriers whose services this country offers at checkout, with their settings: on, complete, ticked for the country
 * and covering it, with a service to offer (for a carrier whose prices the store enters, one with a price here).
 */
async function activeCarriers(runner: Runner, storeId: string, country: string): Promise<ActiveCarrier[]> {
  const rows = await runner.execute<Row>(sql`
    select carrier, countries from commerce.shipping_carriers
    where store_id = ${storeId}::uuid and checkout_enabled and complete and carrier in (${sql.join(CHECKOUT_CARRIERS.map((c) => sql`${c}`), sql`, `)})
    order by carrier
  `);
  const active: ActiveCarrier[] = [];
  for (const row of rows) {
    const carrier = row.carrier as CarrierId;
    const offered = (row.countries ?? []) as string[];
    if (!offered.includes(country) || !(CHECKOUT_COUNTRIES[carrier] ?? []).includes(country)) continue;
    const settings = await getCheckoutSettings(runner, storeId, carrier);
    const priced = CHECKOUT_PRICING[carrier] === "store" ? settings.services.filter((id) => id in (settings.prices[country]?.services ?? {})) : settings.services;
    if (priced.length > 0) active.push({ carrier, settings });
  }
  return active;
}

/** Whether a carrier's services are offered at checkout in this country: the page shows the choice only then. */
export async function deliveryChoiceOn(storeId: string, country: string): Promise<boolean> {
  return (await activeCarriers(db(), storeId, country)).length > 0;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** The weight of what the cart ships, in grams: the variants' own, and the store's default once for goods that have none. */
async function cartWeightGrams(storeId: string, cartId: string, defaultGrams: number): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(cl.quantity * v.weight_grams) filter (where v.weight_grams is not null), 0)::bigint as known,
      bool_or(v.weight_grams is null) as unknown
    from commerce.cart_lines cl
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid and v.delivery = 'physical'
  `);
  const total = Number(row?.known ?? 0) + (row?.unknown ? defaultGrams : 0);
  return Math.min(35_000, Math.max(total, 1));
}

const senderOf = (context: CarrierContext): ShippingAddress => ({
  name: context.details.senderName ?? "",
  street: context.details.senderStreet ?? "",
  postalCode: context.details.senderPostalCode ?? "",
  city: context.details.senderCity ?? "",
  country: "NO",
});

const quotedPoint = (p: PickupPoint): QuotedPickupPoint => ({
  id: p.id,
  name: p.name,
  street: p.address.street,
  postalCode: p.address.postalCode,
  city: p.address.city,
  distanceMeters: p.distanceMeters ?? null,
});

export type QuoteResult = { ok: true } | { ok: false; problem: "postal_code" | "unavailable" | "none" };

/** One service a carrier offers for this cart, priced as the shopper would pay for it, with the pickup points it needs. */
type Offer = {
  carrier: CarrierId;
  serviceId: string;
  name: string;
  amountMinor: number;
  freeOverMinor: number | null;
  estimate: { minDays: number; maxDays: number } | null;
  needsPickupPoint: boolean;
  /** A delivery window (Porterbuddy): when it is delivered, and until when the carrier holds it. */
  window: { start: string; end: string; expiresAt: string } | null;
  points: QuotedPickupPoint[];
};

/**
 * What one carrier offers for this cart and postal code: from its price service for the parcel (priced with VAT and the
 * store's markup), or from the prices the store entered for the country. Null when the carrier cannot be asked.
 */
async function offersFrom(
  active: ActiveCarrier,
  shop: { storeId: string; market: Pick<Market, "code" | "nativeCurrency"> },
  cartId: string,
  postalCode: string,
  vatRate: number,
): Promise<Offer[] | null> {
  const { storeId, market } = shop;
  const adapter = adapterFor(active.carrier);
  const context = await carrierContext(storeId, active.carrier);
  if (!adapter || !context) return null;
  const to: ShippingAddress = { name: "", street: "", postalCode, city: "", country: market.code };
  const known = CHECKOUT_SERVICES[active.carrier] ?? [];
  let found: Omit<Offer, "points">[];
  if (CHECKOUT_PRICING[active.carrier] === "store") {
    const prices = active.settings.prices[market.code];
    // A service has a weight it takes at most: not offered for a heavier cart.
    const weight = known.some((s) => s.maxWeightGrams) ? await cartWeightGrams(storeId, cartId, active.settings.defaultWeightGrams) : 0;
    found = active.settings.services
      .filter((id) => prices && id in prices.services)
      .filter((id) => {
        const max = known.find((s) => s.id === id)?.maxWeightGrams;
        return !max || weight <= max;
      })
      .map((id) => ({
        carrier: active.carrier,
        serviceId: id,
        name: known.find((s) => s.id === id)?.name ?? id,
        amountMinor: prices!.services[id],
        freeOverMinor: prices!.freeOverMinor,
        estimate: null,
        window: null,
        needsPickupPoint: Boolean(known.find((s) => s.id === id)?.needsPickupPoint),
      }));
  } else {
    if (!adapter.rates) return null;
    const weight = await cartWeightGrams(storeId, cartId, active.settings.defaultWeightGrams);
    let offered: ShippingOption[];
    try {
      offered = await adapter.rates(context, {
        from: senderOf(context),
        to,
        parcels: [{ weightGrams: weight }],
        currency: market.nativeCurrency,
        products: active.settings.services,
      });
    } catch {
      return null;
    }
    // Only what the store switched on and what is priced in the country's own currency.
    found = offered
      .filter((o) => active.settings.services.includes(o.serviceId) && o.currency === market.nativeCurrency)
      .map((o) => ({
        carrier: active.carrier,
        serviceId: o.serviceId,
        name: o.name,
        // A price made for the shopper to see already holds VAT (D137).
        amountMinor: shopperPrice(o.priceMinor, o.includesVat ? 0 : vatRate, active.settings.markup),
        freeOverMinor: active.settings.freeOverMinor,
        window: o.window ? { start: o.window.start, end: o.window.end, expiresAt: o.window.expiresAt } : null,
        estimate: o.estimate && "minDays" in o.estimate ? o.estimate : null,
        needsPickupPoint: Boolean(o.needsPickupPoint),
      }));
  }
  let points: QuotedPickupPoint[] = [];
  if (found.some((o) => o.needsPickupPoint) && adapter.pickupPoints) {
    try {
      points = (await adapter.pickupPoints(context, to)).slice(0, MAX_PICKUP_POINTS).map(quotedPoint);
    } catch {
      // Without pickup points, the services that need one are left out rather than half offered.
      points = [];
    }
  }
  return found.filter((o) => !o.needsPickupPoint || points.length > 0).map((o) => ({ ...o, points: o.needsPickupPoint ? points : [] }));
}

/**
 * Asks the store's carriers for their services to this postal code and keeps what they offer with the cart: the services
 * the store switched on, at the price the shopper would pay, and the nearest pickup points for a service that needs one.
 * With more than one carrier the services are listed together, cheapest first, each named for its carrier. The earlier
 * answers for the cart go, except the one chosen.
 */
export async function quoteDelivery(
  shop: { storeId: string; market: Pick<Market, "code" | "nativeCurrency"> },
  cartId: string,
  typedPostalCode: string,
): Promise<QuoteResult> {
  const { storeId, market } = shop;
  const postalCode = cleanPostalCode(market.code, typedPostalCode);
  if (!postalCode) return { ok: false, problem: "postal_code" };
  const active = await activeCarriers(db(), storeId, market.code);
  if (active.length === 0) return { ok: false, problem: "unavailable" };

  const [cart] = await db().execute<Row>(sql`
    select 1 from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open' and market_code = ${market.code}
  `);
  if (!cart) return { ok: false, problem: "unavailable" };
  // A carrier's price takes the destination's standard VAT rate (D157: read through `commerce.vat_rate()`, like every rate); how the
  // order splits the shipping's VAT is the shipping rule's (`placeOrder()`), which never changes the price.
  const [country] = await db().execute<Row>(sql`select commerce.vat_rate(${market.code}, 'standard') as standard_rate`);
  const vatRate = Number(country?.standard_rate ?? 0);

  const answers = await Promise.all(active.map((a) => offersFrom(a, shop, cartId, postalCode, vatRate)));
  const offers = answers.flatMap((answer) => answer ?? []);
  // A carrier that cannot be asked leaves the others; when none can be, the flat rate is all there is.
  if (offers.length === 0) return { ok: false, problem: answers.every((answer) => answer === null) ? "unavailable" : "none" };
  const several = active.length > 1;
  const named = (o: Offer) => {
    const brand = carrierInfo(o.carrier)?.name ?? o.carrier;
    return several && !o.name.toLowerCase().includes(o.carrier) ? `${brand}: ${o.name}` : o.name;
  };
  // Services cheapest first; delivery windows apart, the earliest first.
  const usable = [
    ...offers.filter((o) => !o.window).sort((a, b) => a.amountMinor - b.amountMinor).slice(0, MAX_OPTIONS),
    ...offers.filter((o) => o.window).sort((a, b) => a.window!.start.localeCompare(b.window!.start)).slice(0, MAX_WINDOWS),
  ];

  await db().transaction(async (tx) => {
    // Answers that ran out a day ago go, whichever cart they were for.
    await tx.execute(sql`delete from commerce.delivery_quotes where store_id = ${storeId}::uuid and expires_at < now() - interval '1 day'`);
    await tx.execute(sql`
      delete from commerce.delivery_quotes q
      where q.store_id = ${storeId}::uuid and q.cart_id = ${cartId}::uuid
        and q.id is distinct from (select delivery_quote_id from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid)
    `);
    for (const o of usable) {
      await tx.execute(sql`
        insert into commerce.delivery_quotes (
          store_id, cart_id, carrier, service_id, label, amount_minor, free_over_minor, currency, country, postal_code,
          estimate, needs_pickup_point, pickup_points, window_start, window_end, expires_at
        ) values (
          ${storeId}::uuid, ${cartId}::uuid, ${o.carrier}, ${o.serviceId}, ${named(o).slice(0, 120)},
          ${o.amountMinor}, ${o.freeOverMinor},
          ${market.nativeCurrency}, ${market.code}, ${postalCode},
          ${o.estimate ? JSON.stringify(o.estimate) : null}::jsonb,
          ${o.needsPickupPoint}, ${JSON.stringify(o.points)}::jsonb,
          ${o.window?.start ?? null}::timestamptz, ${o.window?.end ?? null}::timestamptz,
          least(now() + make_interval(mins => ${QUOTE_MINUTES}), ${o.window?.expiresAt ?? null}::timestamptz)
        )
      `);
    }
  });
  return { ok: true };
}

/** What the cart's chosen delivery costs, as the basket's shipping rate (in the currency shown), and what to keep of it on the order. */
export type ChosenDelivery = {
  quoteId: string;
  rate: { amountMinor: number; freeOverMinor: number | null };
  delivery: OrderDelivery;
};

/**
 * The delivery the shopper chose for this cart, or null for the flat rate: a quote of the cart that has not run out, for
 * this country, with its pickup point chosen when it needs one. Read by `cartSummary()` and, inside its transaction, by
 * `placeOrder()`, so both charge the same.
 */
export async function chosenDelivery(
  runner: Runner,
  storeId: string,
  cartId: string,
  market: Pick<Market, "code" | "conversion">,
): Promise<ChosenDelivery | null> {
  const [row] = await runner.execute<Row>(sql`
    select q.id, q.carrier, q.service_id, q.label, q.amount_minor, q.free_over_minor, q.postal_code, q.needs_pickup_point,
      q.pickup_points, q.pickup_point_id, q.window_start, q.window_end
    from commerce.carts c
    join commerce.delivery_quotes q on q.store_id = c.store_id and q.id = c.delivery_quote_id and q.cart_id = c.id
    where c.store_id = ${storeId}::uuid and c.id = ${cartId}::uuid and c.status = 'open'
      and q.expires_at > now() and q.country = ${market.code} and c.market_code = ${market.code}
  `);
  if (!row) return null;
  const points = (row.pickup_points ?? []) as QuotedPickupPoint[];
  const point = row.needs_pickup_point ? (points.find((p) => p.id === row.pickup_point_id) ?? null) : null;
  if (row.needs_pickup_point && !point) return null;
  return {
    quoteId: String(row.id),
    rate: {
      amountMinor: shown(market, Number(row.amount_minor)),
      freeOverMinor: row.free_over_minor === null ? null : shown(market, Number(row.free_over_minor)),
    },
    delivery: {
      carrier: row.carrier as CarrierId,
      serviceId: String(row.service_id),
      label: String(row.label),
      postalCode: String(row.postal_code),
      pickupPoint: point ? { id: point.id, name: point.name, street: point.street, postalCode: point.postalCode, city: point.city } : null,
      window: row.window_start && row.window_end ? { start: new Date(String(row.window_start)).toISOString(), end: new Date(String(row.window_end)).toISOString() } : null,
    },
  };
}

/**
 * The options the page shows: the flat rate and the cart's quotes that are still good, each priced for this basket by
 * `priceFor` (the rate's price with free shipping taken off). The chosen one is marked; none chosen is the flat rate.
 */
export async function deliveryOptionsFor(
  shop: { storeId: string; market: Pick<Market, "code" | "conversion"> },
  cartId: string,
  flat: { label: string; rate: { amountMinor: number; freeOverMinor: number | null } | null },
  priceFor: (rate: { amountMinor: number; freeOverMinor: number | null }) => number,
): Promise<DeliveryOptions> {
  const { storeId, market } = shop;
  const chosen = await chosenDelivery(db(), storeId, cartId, market);
  const rows = await db().execute<Row>(sql`
    select id, carrier, label, amount_minor, free_over_minor, postal_code, estimate, needs_pickup_point, pickup_points, pickup_point_id,
      window_start, window_end
    from commerce.delivery_quotes
    where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid and expires_at > now() and country = ${market.code}
    order by (window_start is not null), window_start, amount_minor, label
  `);
  const options: DeliveryOption[] = [];
  if (flat.rate) {
    options.push({
      id: "flat",
      carrier: "flat",
      label: flat.label,
      priceMinor: priceFor(flat.rate),
      freeOverMinor: flat.rate.freeOverMinor,
      estimate: null,
      needsPickupPoint: false,
      window: null,
      pickupPoints: [],
      pickupPointId: null,
      selected: chosen === null,
    });
  }
  for (const row of rows) {
    const rate = {
      amountMinor: shown(market, Number(row.amount_minor)),
      freeOverMinor: row.free_over_minor === null ? null : shown(market, Number(row.free_over_minor)),
    };
    options.push({
      id: String(row.id),
      carrier: row.carrier as CarrierId,
      label: String(row.label),
      priceMinor: priceFor(rate),
      freeOverMinor: rate.freeOverMinor,
      estimate: estimateDays(row.estimate),
      window: row.window_start && row.window_end ? { start: new Date(String(row.window_start)).toISOString(), end: new Date(String(row.window_end)).toISOString() } : null,
      needsPickupPoint: Boolean(row.needs_pickup_point),
      pickupPoints: (row.pickup_points ?? []) as QuotedPickupPoint[],
      pickupPointId: row.pickup_point_id ? String(row.pickup_point_id) : null,
      selected: chosen?.quoteId === String(row.id),
    });
  }
  const postal = rows[0] ? String(rows[0].postal_code) : (chosen?.delivery.postalCode ?? null);
  return { postalCode: postal, options };
}

export type ChooseResult = { ok: true } | { ok: false; problem: "gone" | "pickup_point" };

/**
 * The shopper's choice: a service from the last answer (with the pickup point it needs), or the flat rate. The order is
 * placed again afterwards (the caller), at the price this sets.
 */
export async function chooseDelivery(
  shop: { storeId: string; market: Pick<Market, "code"> },
  cartId: string,
  optionId: string,
  pickupPointId?: string,
): Promise<ChooseResult> {
  const { storeId, market } = shop;
  if (optionId === "flat") {
    await db().execute(sql`
      update commerce.carts set delivery_quote_id = null, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open'
    `);
    return { ok: true };
  }
  if (!/^[0-9a-f-]{36}$/i.test(optionId)) return { ok: false, problem: "gone" };
  return db().transaction(async (tx): Promise<ChooseResult> => {
    const [quote] = await tx.execute<Row>(sql`
      select id, needs_pickup_point, pickup_points from commerce.delivery_quotes
      where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid and id = ${optionId}::uuid and expires_at > now() and country = ${market.code}
      for update
    `);
    if (!quote) return { ok: false, problem: "gone" };
    let point: string | null = null;
    if (quote.needs_pickup_point) {
      const points = (quote.pickup_points ?? []) as QuotedPickupPoint[];
      if (!pickupPointId || !points.some((p) => p.id === pickupPointId)) return { ok: false, problem: "pickup_point" };
      point = pickupPointId;
    }
    await tx.execute(sql`update commerce.delivery_quotes set pickup_point_id = ${point} where store_id = ${storeId}::uuid and id = ${optionId}::uuid`);
    const done = await tx.execute<Row>(sql`
      update commerce.carts set delivery_quote_id = ${optionId}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open' returning id
    `);
    return done.length > 0 ? { ok: true } : { ok: false, problem: "gone" };
  });
}
