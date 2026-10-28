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
  postalMismatch,
  readDelivery,
  type AnyOrderDelivery,
  type CarrierDelivery,
  type DeliveryOption,
  type DeliveryOptions,
  type QuotedPickupPoint,
} from "@/lib/delivery-options";
import type { ShippingRate } from "@/lib/checkout";
import { rulesOnOffer, shownLabel, type RuleOutcome } from "@/lib/checkout-rules";
import { cleanShopperText } from "@/lib/gift";
import { t } from "@/lib/i18n";
import { areaCovers, type AreaTerms } from "@/lib/local-delivery";
import { shown, type Market } from "@/lib/markets";
import { zoneFor } from "@/lib/postal-patterns";
import { DEFAULT_WEIGHT_GRAMS, NOTE_MAX } from "@/lib/shipping-limits";
import {
  basketValue,
  chosenFrom,
  deliveryOffer,
  partsOf,
  standardShippingMinor,
  type DeliveryChoice,
  type DeliveryOffer,
  type MethodTerms,
  type OfferedDelivery,
  type PickupTerms,
  type RateBasis,
  type ShippingLine,
} from "@/lib/shipping-methods";
import { carrierInfo, type CarrierContext, type CarrierId, type PickupPoint, type ShippingAddress, type ShippingOption } from "@/lib/shipping-carriers";
import { BRING_PRODUCTS } from "@/lib/bring";
import { POSTNORD_SERVICES } from "@/lib/postnord";
import { PORTERBUDDY_PRODUCTS } from "@/lib/porterbuddy";
import { HELTHJEM_SERVICES } from "@/lib/helthjem";

import { audit } from "./auth";
import { checkoutRuleOutcome } from "./checkout-rules";
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
    // The code the prices are for is the cart's delivery postal code too (D237): the store's own zones and areas read it.
    await tx.execute(sql`
      update commerce.carts set delivery_postal_code = ${postalCode}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open'
    `);
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


// ---------------------------------------------------------------------------
// The cart's delivery (D237, docs/wave-3-shipping-methods.md 4.1): every kind, one reader
// ---------------------------------------------------------------------------

/** What the market offers to choose from, read once per resolution: its flat rate, methods with their rates, zones, pickup places and local areas. */
export type MarketShipping = {
  flat: ShippingRate | null;
  methods: (MethodTerms & { name: string; zoneNames?: never })[];
  zones: { id: string; name: string; patterns: string[]; position: number }[];
  defaultWeightGrams: number;
  pickups: (PickupTerms & { place: PickupPlace; instructions: string; instructionsT: Record<string, string> })[];
  areas: (AreaTerms & { name: string; names: Record<string, string>; info: string; infoT: Record<string, string> })[];
  /** Whether any carrier's checkout services are on in the country (D135). */
  carriers: boolean;
};

/** A pickup place as an order keeps it (`PickupDelivery`'s snapshot without the order's words). */
export type PickupPlace = { name: string; street: string; postalCode: string; city: string; country: string; hours: unknown };

const localized = (texts: unknown, market: Pick<Market, "locale" | "lang">, fallback: string): string => {
  const t = texts && typeof texts === "object" ? (texts as Record<string, unknown>) : {};
  for (const key of [market.locale, market.lang]) {
    const value = t[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * The market's shipping setup as the checkout reads it (only what is switched on): the flat rate (`shipping_rates`), active methods with their rates
 * in their order, zones, the store's default weight, active pickup options with their place, active local areas with their place's position, and
 * whether a carrier's checkout services are on. Amounts are native (the market's own currency); `deliveryOffer()` shows them.
 */
export async function marketShipping(runner: Runner, storeId: string, market: Pick<Market, "code" | "locale" | "lang">): Promise<MarketShipping> {
  const [flatRow] = await runner.execute<Row>(sql`
    select amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = ${market.code}
  `);
  const methodRows = await runner.execute<Row>(sql`
    select m.id, m.name, m.names, m.estimate_min_days, m.estimate_max_days, m.free_over_minor, m.position,
      coalesce((select jsonb_agg(jsonb_build_object('zoneId', r.zone_id, 'profileId', r.profile_id, 'basis', r.basis, 'minValue', r.min_value,
        'maxValue', r.max_value, 'amountMinor', r.amount_minor) order by r.min_value)
        from commerce.shipping_method_rates r where r.store_id = m.store_id and r.method_id = m.id), '[]'::jsonb) as rates
    from commerce.shipping_methods m
    where m.store_id = ${storeId}::uuid and m.market_code = ${market.code} and m.active
    order by m.position, m.id
  `);
  const zoneRows = await runner.execute<Row>(sql`
    select id, name, patterns, position from commerce.shipping_zones
    where store_id = ${storeId}::uuid and market_code = ${market.code} order by position, id
  `);
  const [settings] = await runner.execute<Row>(sql`select default_weight_grams from commerce.shipping_settings where store_id = ${storeId}::uuid`);
  const pickupRows = await runner.execute<Row>(sql`
    select po.id, po.location_id, po.amount_minor, po.ready_in_hours, po.instructions, po.instructions_t, po.position,
      l.name, l.street, l.postal_code, l.city, l.country, l.hours
    from commerce.pickup_options po
    join commerce.store_locations l on l.store_id = po.store_id and l.id = po.location_id
    where po.store_id = ${storeId}::uuid and po.market_code = ${market.code} and po.active and l.kind in ('shop', 'pickup') and l.country = ${market.code}
    order by po.position, po.id
  `);
  const areaRows = await runner.execute<Row>(sql`
    select a.id, a.kind, a.patterns, a.radius_km, a.amount_minor, a.min_basket_minor, a.free_over_minor, a.position, a.name, a.names, a.info, a.info_t,
      l.latitude, l.longitude
    from commerce.local_delivery_areas a
    left join commerce.store_locations l on l.store_id = a.store_id and l.id = a.location_id
    where a.store_id = ${storeId}::uuid and a.market_code = ${market.code} and a.active
    order by a.position, a.id
  `);
  const carriers = (await activeCarriers(runner, storeId, market.code)).length > 0;
  return {
    flat: flatRow ? { amountMinor: Number(flatRow.amount_minor), freeOverMinor: nullableNumber(flatRow.free_over_minor) } : null,
    methods: methodRows.map((m) => ({
      id: String(m.id),
      name: String(m.name),
      label: localized(m.names, market, String(m.name)),
      position: Number(m.position),
      active: true,
      freeOverMinor: nullableNumber(m.free_over_minor),
      estimate:
        m.estimate_min_days === null || m.estimate_min_days === undefined
          ? null
          : { min: Number(m.estimate_min_days), max: Number(m.estimate_max_days) },
      rates: ((m.rates ?? []) as Record<string, unknown>[]).map((r) => ({
        zoneId: r.zoneId ? String(r.zoneId) : null,
        profileId: r.profileId ? String(r.profileId) : null,
        basis: r.basis as RateBasis,
        minValue: Number(r.minValue),
        maxValue: nullableNumber(r.maxValue),
        amountMinor: Number(r.amountMinor),
      })),
    })),
    zones: zoneRows.map((z) => ({ id: String(z.id), name: String(z.name), patterns: (z.patterns ?? []) as string[], position: Number(z.position) })),
    defaultWeightGrams: settings ? Number(settings.default_weight_grams) : DEFAULT_WEIGHT_GRAMS,
    pickups: pickupRows.map((p) => ({
      id: String(p.id),
      locationId: String(p.location_id),
      amountMinor: Number(p.amount_minor),
      readyInHours: Number(p.ready_in_hours),
      position: Number(p.position),
      active: true,
      instructions: String(p.instructions ?? ""),
      instructionsT: (p.instructions_t ?? {}) as Record<string, string>,
      place: {
        name: String(p.name ?? ""),
        street: String(p.street ?? ""),
        postalCode: String(p.postal_code ?? ""),
        city: String(p.city ?? ""),
        country: String(p.country ?? "").trim(),
        hours: p.hours ?? null,
      },
    })),
    areas: areaRows.map((a) => ({
      id: String(a.id),
      kind: a.kind === "radius" ? ("radius" as const) : ("postal" as const),
      patterns: (a.patterns ?? []) as string[],
      radiusKm: nullableNumber(a.radius_km),
      origin: a.latitude === null || a.latitude === undefined ? null : { lat: Number(a.latitude), lon: Number(a.longitude) },
      amountMinor: Number(a.amount_minor),
      minBasketMinor: nullableNumber(a.min_basket_minor),
      freeOverMinor: nullableNumber(a.free_over_minor),
      position: Number(a.position),
      active: true,
      name: String(a.name),
      names: (a.names ?? {}) as Record<string, string>,
      info: String(a.info ?? ""),
      infoT: (a.info_t ?? {}) as Record<string, string>,
    })),
    carriers,
  };
}

/** Whether the market has anything of the store's own to choose besides the flat rate, or carriers (the checkout shows the choice then). */
export const hasChoice = (s: MarketShipping) => s.carriers || s.methods.length > 0 || s.zones.length > 0 || s.pickups.length > 0 || s.areas.length > 0;

/** Whether the price may depend on the postal code: zones, a local area or a carrier (the pay press waits for a code then, unless pickup is chosen). */
export const priceNeedsPostalCode = (s: MarketShipping) => s.zones.length > 0 || s.areas.length > 0;

/** The cart's side of the resolution: its lines as shipping reads them, its choice, postal code and note. */
type CartDeliveryFacts = {
  lines: ShippingLine[];
  subscription: boolean;
  postalCode: string | null;
  note: string | null;
  quoteId: string | null;
  methodId: string | null;
  pickupId: string | null;
  areaId: string | null;
  /** What every line comes to as shown, before discounts: the fallback basket value when the caller gives none. */
  valueMinor: number;
};

async function cartDeliveryFacts(runner: Runner, storeId: string, cartId: string, market: Pick<Market, "code" | "conversion">): Promise<CartDeliveryFacts | null> {
  const [cart] = await runner.execute<Row>(sql`
    select delivery_postal_code, delivery_note, delivery_quote_id, shipping_method_id, pickup_option_id, local_area_id
    from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open' and market_code = ${market.code}
  `);
  if (!cart) return null;
  const rows = await runner.execute<Row>(sql`
    select cl.quantity, cl.selling_plan_id, cl.starts_at, v.delivery, v.weight_grams, p.shipping_profile_id, p.kind, cp.amount_minor
    from commerce.cart_lines cl
    join commerce.product_variants v on v.store_id = cl.store_id and v.id = cl.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    where cl.store_id = ${storeId}::uuid and cl.cart_id = ${cartId}::uuid
  `);
  const lines: ShippingLine[] = rows.map((r) => {
    const unit = r.amount_minor === null || r.amount_minor === undefined ? 0 : shown(market, Number(r.amount_minor));
    const ranged = Boolean(r.starts_at) && (r.kind === "stay" || r.kind === "rental");
    return {
      profileId: r.shipping_profile_id ? String(r.shipping_profile_id) : null,
      quantity: Number(r.quantity),
      weightGrams: nullableNumber(r.weight_grams),
      totalMinor: ranged ? unit : unit * Number(r.quantity),
      physical: r.delivery === "physical" && !r.starts_at,
      gift: false,
      recurring: r.selling_plan_id !== null && r.selling_plan_id !== undefined,
    };
  });
  return {
    lines,
    subscription: lines.some((l) => l.recurring),
    postalCode: cart.delivery_postal_code ? String(cart.delivery_postal_code) : null,
    note: cart.delivery_note ? String(cart.delivery_note) : null,
    quoteId: cart.delivery_quote_id ? String(cart.delivery_quote_id) : null,
    methodId: cart.shipping_method_id ? String(cart.shipping_method_id) : null,
    pickupId: cart.pickup_option_id ? String(cart.pickup_option_id) : null,
    areaId: cart.local_area_id ? String(cart.local_area_id) : null,
    valueMinor: basketValue(lines),
  };
}

/** A carrier quote of the cart that is still good (D135), or null. */
async function chosenQuote(runner: Runner, storeId: string, cartId: string, market: Pick<Market, "code" | "conversion">) {
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
  const delivery: CarrierDelivery = {
    kind: "carrier",
    carrier: row.carrier as CarrierId,
    serviceId: String(row.service_id),
    label: String(row.label),
    postalCode: String(row.postal_code),
    pickupPoint: point ? { id: point.id, name: point.name, street: point.street, postalCode: point.postalCode, city: point.city } : null,
    window: row.window_start && row.window_end ? { start: new Date(String(row.window_start)).toISOString(), end: new Date(String(row.window_end)).toISOString() } : null,
  };
  return {
    quoteId: String(row.id),
    rate: {
      amountMinor: shown(market, Number(row.amount_minor)),
      freeOverMinor: row.free_over_minor === null ? null : shown(market, Number(row.free_over_minor)),
    },
    delivery,
  };
}

/** What the cart's delivery comes to, as the basket's shipping rate (in the currency shown), and what the order keeps of it. */
export type ChosenDelivery = {
  kind: "carrier" | "method" | "pickup" | "local";
  /** The carrier quote's id (D135); null for the store's own kinds. */
  quoteId: string | null;
  /** The option's id as the page names it: a quote's id, `method:{id}`, `pickup:{id}`, `local:{id}`. */
  optionId: string;
  rate: ShippingRate;
  delivery: AnyOrderDelivery;
};

export type DeliveryResolution = {
  /** Everything the basket may choose (`deliveryOffer()`, with the checkout rules laid over it, D357), for the page. */
  offer: DeliveryOffer;
  /** What the checkout rules (D357) came to for this basket: hidden and renamed options, payment methods left out, a refusal. */
  rules: RuleOutcome;
  shipping: MarketShipping;
  /** The delivery postal code the prices are for, and its zone (null: Rest of country). */
  postalCode: string | null;
  zone: { id: string; name: string } | null;
  /** What the basket is charged (handed to `basketShipping()`); null when nothing ships it (`no_shipping`) or nothing is physical. */
  rate: ShippingRate | null;
  /** The cart's delivery when it is not the flat rate (a carrier's service, a method, pickup or local), else null. */
  chosen: ChosenDelivery | null;
  /** What the order keeps (`orders.delivery`): null only when nothing ships. */
  delivery: AnyOrderDelivery | null;
  /** `orders.delivery_method`. */
  method: "ship" | "pickup" | "local";
  pickupLocationId: string | null;
  /** The note for the driver, with local delivery only. */
  note: string | null;
  /** The cart's choice no longer prices the basket (2.7): the default is charged instead. */
  changed: boolean;
  /** The market prices by postal code and none is given, and pickup is not chosen: the pay press waits (2.4 point 4). */
  needsPostalCode: boolean;
  /** The cheapest standard delivery offered (4.3): methods and the flat rate, never pickup or local delivery. */
  standardShippingMinor: number | null;
};

const NOTHING: DeliveryOffer = { status: "none", ship: [], pickups: [], local: null, localBelowMinimum: null, default: null };

/**
 * The ONE reader of a cart's delivery (D135, D237 4.1): `cartSummary()` and, inside its transaction with its runner, `placeOrder()` both call it, so they
 * charge the same. It reads the market's setup and the cart's lines and choice, prices the store's own methods for the basket on every read (never a
 * stored price), and returns the choice while it still holds (a carrier quote that has not run out, a method that prices the basket in the code's zone,
 * an active pickup option, the local area offered for the code), else the default (the cheapest method, else the flat rate) with `changed`.
 * `basketValueMinor` is the value free shipping is judged on, as the caller works it out for `basketShipping()` (the lines' totals before discounts,
 * gifts out); left out, it is read from the cart. A basket with a subscription gets the flat rate only (D25), and one with nothing physical nothing.
 */
export async function resolveDelivery(
  runner: Runner,
  storeId: string,
  cartId: string,
  market: Pick<Market, "code" | "conversion" | "locale" | "lang">,
  {
    basketValueMinor,
    customerId = null,
    rules: given,
  }: {
    basketValueMinor?: number;
    /** The buyer, for rules on customer groups (D357). */
    customerId?: string | null;
    /** The rules' outcome when the caller has it already (`checkoutRuleOutcome()`), else read here. */
    rules?: RuleOutcome;
  } = {},
): Promise<DeliveryResolution | null> {
  const cart = await cartDeliveryFacts(runner, storeId, cartId, market);
  if (!cart) return null;
  const shipping = await marketShipping(runner, storeId, market);
  const physical = cart.lines.some((l) => l.physical);
  const value = basketValueMinor ?? cart.valueMinor;
  const quote = physical && !cart.subscription && cart.quoteId ? await chosenQuote(runner, storeId, cartId, market) : null;
  const postalCode = cart.postalCode ?? quote?.delivery.postalCode ?? null;
  const zone = zoneFor(shipping.zones, postalCode);
  const [point] =
    postalCode && shipping.areas.some((a) => a.kind === "radius")
      ? await runner.execute<Row>(sql`select latitude, longitude from commerce.postal_points where country = ${market.code} and postal_code = ${postalCode}`)
      : [];
  // Checkout rules (D357) hide or rename the store's own options before anything is chosen from them; a carrier's services are not theirs.
  const rules = given ?? (await checkoutRuleOutcome(runner, storeId, cartId, market, { customerId, basketValueMinor: value }));
  const offer = physical
    ? rulesOnOffer(deliveryOffer({
        physical,
        subscription: cart.subscription,
        view: market,
        flat: shipping.flat,
        methods: shipping.methods,
        parts: partsOf(cart.lines, shipping.defaultWeightGrams),
        basketValueMinor: value,
        zoneId: zone?.id ?? null,
        pickups: cart.subscription ? [] : shipping.pickups,
        areas: cart.subscription ? [] : shipping.areas,
        postalCode,
        point: point ? { lat: Number(point.latitude), lon: Number(point.longitude) } : null,
      }), rules)
    : NOTHING;
  const base = {
    offer,
    rules,
    shipping,
    postalCode,
    zone: zone ? { id: zone.id, name: zone.name } : null,
    standardShippingMinor: physical ? standardShippingMinor(offer) : null,
  };
  if (!physical) {
    return { ...base, rate: null, chosen: null, delivery: null, method: "ship", pickupLocationId: null, note: null, changed: false, needsPostalCode: false };
  }

  // A carrier's service (D135) stands on its own quote; the store's own kinds are looked up in the offer.
  let changed = false;
  let picked: OfferedDelivery | null = null;
  if (quote) {
    const chosen: ChosenDelivery = { kind: "carrier", quoteId: quote.quoteId, optionId: quote.quoteId, rate: quote.rate, delivery: quote.delivery };
    return { ...base, rate: quote.rate, chosen, delivery: quote.delivery, method: "ship", pickupLocationId: null, note: null, changed: false, needsPostalCode: false };
  }
  if (cart.quoteId) changed = true;
  const choice: DeliveryChoice = cart.methodId
    ? { kind: "method", id: cart.methodId }
    : cart.pickupId
      ? { kind: "pickup", id: cart.pickupId }
      : cart.areaId
        ? { kind: "local", id: cart.areaId }
        : null;
  if (cart.subscription) {
    picked = offer.default;
    changed = changed || choice !== null;
  } else {
    const found = chosenFrom(offer, choice);
    picked = found.delivery;
    changed = changed || found.changed;
  }
  const pickupChosen = picked?.kind === "pickup";
  const needsPostalCode = priceNeedsPostalCode(shipping) && !postalCode && !pickupChosen && !cart.subscription;
  if (!picked) {
    return { ...base, rate: null, chosen: null, delivery: null, method: "ship", pickupLocationId: null, note: null, changed, needsPostalCode };
  }
  const snapshot = deliverySnapshot(picked, shipping, market, postalCode, zone);
  const chosen: ChosenDelivery | null =
    picked.kind === "flat" ? null : { kind: picked.kind, quoteId: null, optionId: `${picked.kind}:${picked.id}`, rate: picked.rate, delivery: snapshot };
  return {
    ...base,
    rate: picked.rate,
    chosen,
    delivery: snapshot,
    method: picked.kind === "pickup" ? "pickup" : picked.kind === "local" ? "local" : "ship",
    pickupLocationId: picked.kind === "pickup" ? picked.locationId : null,
    note: picked.kind === "local" ? cart.note : null,
    changed,
    needsPostalCode,
  };
}

/** What the order keeps of an offered delivery (`orders.delivery`, read by `readDelivery()`), in the market's language. */
function deliverySnapshot(
  picked: OfferedDelivery,
  shipping: MarketShipping,
  market: Pick<Market, "lang" | "locale">,
  postalCode: string | null,
  zone: { id: string; name: string } | null,
): AnyOrderDelivery {
  switch (picked.kind) {
    case "flat":
      return { kind: "flat", label: shownLabel(picked, t(market.lang).shipping), postalCode };
    case "method":
      return { kind: "method", methodId: picked.id, label: picked.label, zone: zone ? { id: zone.id, name: zone.name } : null, postalCode, estimate: picked.estimate };
    case "pickup": {
      const option = shipping.pickups.find((p) => p.id === picked.id)!;
      return {
        kind: "pickup",
        label: shownLabel(picked, option.place.name),
        locationId: option.locationId,
        ...option.place,
        instructions: localized(option.instructionsT, market, option.instructions),
        readyInHours: option.readyInHours,
      };
    }
    case "local": {
      const area = shipping.areas.find((a) => a.id === picked.id)!;
      const name = localized(area.names, market, area.name);
      return { kind: "local", label: shownLabel(picked, name), areaId: area.id, name, postalCode: postalCode ?? "", info: localized(area.infoT, market, area.info) };
    }
  }
}

/**
 * The cart's delivery when it is not the market's flat rate (D135, D237): a carrier's service, one of the store's methods, a pickup place or a local area;
 * null for the flat rate or nothing to ship. The short form of `resolveDelivery()`.
 */
export async function chosenDelivery(
  runner: Runner,
  storeId: string,
  cartId: string,
  market: Pick<Market, "code" | "conversion"> & Partial<Pick<Market, "locale" | "lang">>,
  options: { basketValueMinor?: number; customerId?: string | null } = {},
): Promise<ChosenDelivery | null> {
  const resolved = await resolveDelivery(runner, storeId, cartId, { locale: "en", lang: "en", ...market }, options);
  return resolved?.chosen ?? null;
}

/** Whether the checkout shows a delivery choice in this country: a carrier's services, or the store's own methods, zones, pickup places or areas. */
export async function deliveryChoiceOn(storeId: string, country: string): Promise<boolean> {
  return hasChoice(await marketShipping(db(), storeId, { code: country, locale: "en", lang: "en" }));
}

/**
 * The postal code the shopper typed for delivery prices (D237 2.4): cleaned by the country's rule and kept on the cart, so zones and local areas price
 * the basket; null for a code the country does not write. A choice of local delivery stays only while its area still covers the new code
 * (`resolveDelivery()` reports `changed` otherwise).
 */
export async function setDeliveryPostalCode(
  shop: { storeId: string; market: Pick<Market, "code"> },
  cartId: string,
  typed: string,
): Promise<{ ok: true; postalCode: string } | { ok: false; problem: "postal_code" | "gone" }> {
  const postalCode = cleanPostalCode(shop.market.code, typed.slice(0, 20));
  if (!postalCode) return { ok: false, problem: "postal_code" };
  const done = await db().execute<Row>(sql`
    update commerce.carts set delivery_postal_code = ${postalCode}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open' and market_code = ${shop.market.code}
    returning id
  `);
  return done.length > 0 ? { ok: true, postalCode } : { ok: false, problem: "gone" };
}

/** The note for the driver (local delivery only): cleaned like a gift message (`cleanShopperText()`), at most `NOTE_MAX` characters and 8 lines. */
export async function setDeliveryNote(
  shop: { storeId: string },
  cartId: string,
  typed: unknown,
): Promise<{ ok: true } | { ok: false; problem: "too_long" | "not_local" }> {
  const cleaned = cleanShopperText(typed, { maxChars: NOTE_MAX, maxLines: 8 });
  if (!cleaned.ok) return { ok: false, problem: "too_long" };
  const done = await db().execute<Row>(sql`
    update commerce.carts set delivery_note = ${cleaned.value}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open' and (local_area_id is not null or ${cleaned.value}::text is null)
    returning id
  `);
  return done.length > 0 ? { ok: true } : { ok: false, problem: "not_local" };
}

export type ChooseResult = { ok: true } | { ok: false; problem: "gone" | "pickup_point" | "postal_code" | "note" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shopper's choice (D135, D237): `flat` (or the default), a carrier's service from the last answer (its id, with the pickup point it needs),
 * `method:{id}`, `pickup:{id}` or `local:{id}` (with the note for the driver). The cart keeps one choice (`carts_one_delivery`); a store's own option
 * must be offered to the basket now (`resolveDelivery()`'s offer). The order is placed again afterwards (the caller), at the price this sets.
 */
export async function chooseDelivery(
  shop: { storeId: string; market: Pick<Market, "code" | "conversion"> & Partial<Pick<Market, "locale" | "lang">> },
  cartId: string,
  optionId: string,
  pickupPointId?: string,
  { note, customerId = null }: { note?: unknown; customerId?: string | null } = {},
): Promise<ChooseResult> {
  const { storeId, market } = shop;
  const clear = sql`delivery_quote_id = null, shipping_method_id = null, pickup_option_id = null, local_area_id = null, delivery_note = null`;
  if (optionId === "flat") {
    await db().execute(sql`
      update commerce.carts set ${clear}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open'
    `);
    return { ok: true };
  }
  const own = /^(method|pickup|local):(.+)$/.exec(optionId);
  if (own) {
    const [, kind, id] = own;
    if (!UUID.test(id)) return { ok: false, problem: "gone" };
    let cleanNote: string | null = null;
    if (kind === "local") {
      const cleaned = cleanShopperText(note, { maxChars: NOTE_MAX, maxLines: 8 });
      if (!cleaned.ok) return { ok: false, problem: "note" };
      cleanNote = cleaned.value;
    }
    return db().transaction(async (tx): Promise<ChooseResult> => {
      const [cart] = await tx.execute<Row>(sql`
        select id from commerce.carts where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open' and market_code = ${market.code} for update
      `);
      if (!cart) return { ok: false, problem: "gone" };
      const resolved = await resolveDelivery(tx, storeId, cartId, { locale: "en", lang: "en", ...market }, { customerId });
      if (!resolved) return { ok: false, problem: "gone" };
      const pool = kind === "method" ? resolved.offer.ship : kind === "pickup" ? resolved.offer.pickups : resolved.offer.local ? [resolved.offer.local] : [];
      if (!pool.some((d) => d.kind === kind && d.id === id)) {
        return { ok: false, problem: kind === "local" && !resolved.postalCode ? "postal_code" : "gone" };
      }
      await tx.execute(sql`
        update commerce.carts set delivery_quote_id = null,
          shipping_method_id = ${kind === "method" ? id : null}::uuid,
          pickup_option_id = ${kind === "pickup" ? id : null}::uuid,
          local_area_id = ${kind === "local" ? id : null}::uuid,
          delivery_note = ${cleanNote},
          updated_at = now()
        where store_id = ${storeId}::uuid and id = ${cartId}::uuid
      `);
      return { ok: true };
    });
  }
  if (!UUID.test(optionId)) return { ok: false, problem: "gone" };
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
      update commerce.carts set delivery_quote_id = ${optionId}::uuid, shipping_method_id = null, pickup_option_id = null, local_area_id = null,
        delivery_note = null, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open' returning id
    `);
    return done.length > 0 ? { ok: true } : { ok: false, problem: "gone" };
  });
}

export type ReadyProblem = "postal_code" | "changed" | "no_shipping";

/**
 * Whether the pay press may go ahead (D237 2.4 point 4, 2.7), asked by the action the pay press calls before Stripe's `confirm`: refused with
 * `postal_code` while the price depends on a postal code that is not given (and pickup is not chosen), `no_shipping` when nothing ships the basket and no
 * pickup or local delivery is chosen, and `changed` ONCE when the cart's choice no longer prices the basket: the void choice is taken off the cart, so
 * the order is placed again at the default and the next press goes ahead.
 */
export async function deliveryReady(
  shop: { storeId: string; market: Pick<Market, "code" | "conversion"> & Partial<Pick<Market, "locale" | "lang">> },
  cartId: string,
  customerId: string | null = null,
): Promise<{ ok: true } | { ok: false; problem: ReadyProblem }> {
  const resolved = await resolveDelivery(db(), shop.storeId, cartId, { locale: "en", lang: "en", ...shop.market }, { customerId });
  if (!resolved || resolved.offer.status === "none") return { ok: true };
  if (resolved.changed) {
    await db().execute(sql`
      update commerce.carts set delivery_quote_id = null, shipping_method_id = null, pickup_option_id = null, local_area_id = null, delivery_note = null, updated_at = now()
      where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
    `);
    return { ok: false, problem: "changed" };
  }
  if (resolved.needsPostalCode) return { ok: false, problem: "postal_code" };
  if (!resolved.rate) return { ok: false, problem: "no_shipping" };
  return { ok: true };
}

/**
 * The options the checkout page shows (D135, D237 2.4): the ways the basket ships (the store's methods that price it, cheapest first, else the flat rate
 * as *Shipping*), the carrier's services asked for so far, the market's pickup places and the local area offered for the code, each priced for this basket
 * by `priceFor` (the rate's price with free shipping taken off, `cartSummary().shippingAt`). The one the cart resolves to is marked.
 */
export async function deliveryOptionsFor(
  shop: { storeId: string; market: Pick<Market, "code" | "conversion"> & Partial<Pick<Market, "locale" | "lang">> },
  cartId: string,
  flat: { label: string; rate: { amountMinor: number; freeOverMinor: number | null } | null },
  priceFor: (rate: { amountMinor: number; freeOverMinor: number | null }) => number,
  customerId: string | null = null,
): Promise<DeliveryOptions> {
  const { storeId } = shop;
  const market = { locale: "en", lang: "en", ...shop.market };
  const resolved = await resolveDelivery(db(), storeId, cartId, market, { customerId });
  const selectedId = resolved?.chosen?.optionId ?? "flat";
  const options: DeliveryOption[] = [];
  const plain = (): Pick<DeliveryOption, "needsPickupPoint" | "window" | "pickupPoints" | "pickupPointId"> => ({ needsPickupPoint: false, window: null, pickupPoints: [], pickupPointId: null });
  for (const d of resolved?.offer.ship ?? []) {
    if (d.kind === "flat") {
      // The flat rate as the caller shows it (`cartSummary().checkout.shipping`); a caller with none offers none.
      const rate = flat.rate;
      if (!rate) continue;
      options.push({ id: "flat", kind: "flat", carrier: "flat", label: shownLabel(d, flat.label), priceMinor: priceFor(rate), freeOverMinor: rate.freeOverMinor, estimate: null, ...plain(), selected: selectedId === "flat" });
    } else if (d.kind === "method") {
      const id = `method:${d.id}`;
      options.push({ id, kind: "method", carrier: "flat", label: d.label, priceMinor: priceFor(d.rate), freeOverMinor: d.rate.freeOverMinor, estimate: d.estimate, ...plain(), selected: selectedId === id });
    }
  }
  // Without a basket to price (nothing physical), the flat rate as the page knew it.
  if (!resolved && flat.rate) {
    options.push({ id: "flat", kind: "flat", carrier: "flat", label: flat.label, priceMinor: priceFor(flat.rate), freeOverMinor: flat.rate.freeOverMinor, estimate: null, ...plain(), selected: true });
  }
  const rows = await db().execute<Row>(sql`
    select id, carrier, label, amount_minor, free_over_minor, postal_code, estimate, needs_pickup_point, pickup_points, pickup_point_id,
      window_start, window_end
    from commerce.delivery_quotes
    where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid and expires_at > now() and country = ${market.code}
    order by (window_start is not null), window_start, amount_minor, label
  `);
  for (const row of rows) {
    const rate = {
      amountMinor: shown(market, Number(row.amount_minor)),
      freeOverMinor: row.free_over_minor === null ? null : shown(market, Number(row.free_over_minor)),
    };
    options.push({
      id: String(row.id),
      kind: "carrier",
      carrier: row.carrier as CarrierId,
      label: String(row.label),
      priceMinor: priceFor(rate),
      freeOverMinor: rate.freeOverMinor,
      estimate: estimateDays(row.estimate),
      window: row.window_start && row.window_end ? { start: new Date(String(row.window_start)).toISOString(), end: new Date(String(row.window_end)).toISOString() } : null,
      needsPickupPoint: Boolean(row.needs_pickup_point),
      pickupPoints: (row.pickup_points ?? []) as QuotedPickupPoint[],
      pickupPointId: row.pickup_point_id ? String(row.pickup_point_id) : null,
      selected: resolved?.chosen?.quoteId === String(row.id),
    });
  }
  const shipping = resolved?.shipping;
  for (const d of resolved?.offer.pickups ?? []) {
    if (d.kind !== "pickup") continue;
    const option = shipping!.pickups.find((p) => p.id === d.id)!;
    const id = `pickup:${d.id}`;
    options.push({
      id,
      kind: "pickup",
      carrier: "flat",
      label: shownLabel(d, option.place.name),
      priceMinor: d.priceMinor,
      freeOverMinor: null,
      estimate: null,
      ...plain(),
      selected: selectedId === id,
      place: { ...option.place, readyInHours: option.readyInHours, instructions: localized(option.instructionsT, market, option.instructions) },
    });
  }
  const local = resolved?.offer.local;
  if (local && local.kind === "local") {
    const area = shipping!.areas.find((a) => a.id === local.id)!;
    const id = `local:${local.id}`;
    options.push({
      id,
      kind: "local",
      carrier: "flat",
      label: shownLabel(local, localized(area.names, market, area.name)),
      priceMinor: priceFor(local.rate),
      freeOverMinor: local.rate.freeOverMinor,
      estimate: null,
      ...plain(),
      selected: selectedId === id,
      info: localized(area.infoT, market, area.info),
    });
  }
  const below = resolved?.offer.localBelowMinimum ?? null;
  const postal = resolved?.postalCode ?? (rows[0] ? String(rows[0].postal_code) : null);
  return {
    postalCode: postal,
    options,
    needsPostalCode: resolved?.needsPostalCode ?? false,
    changed: resolved?.changed ?? false,
    noShipping: Boolean(resolved && resolved.offer.status === "no_shipping"),
    note: resolved?.note ?? null,
    localBelowMinimum: below
      ? { label: localized((below.area as MarketShipping["areas"][number]).names, market, (below.area as MarketShipping["areas"][number]).name), minimumMinor: below.minimumMinor ?? 0 }
      : null,
  };
}

/**
 * After Stripe collected the address (D237 2.7): when the order's delivery was priced for another postal code than the address's in a way that matters
 * (another zone for a method, outside the local area, another code for a carrier's service; `postalMismatch()`), the order is flagged once
 * (`orders.delivery_mismatch_at`) with the event `order.delivery_mismatch` holding the two postal codes only. The payment is never changed or refused.
 * Never for a pickup order, the flat rate or a copied order.
 */
export async function flagDeliveryMismatch(storeId: string, orderId: string): Promise<{ priced: string | null; address: string } | null> {
  const [order] = await db().execute<Row>(sql`
    select o.delivery, o.delivery_method, o.market_code, o.shipping_address ->> 'postalCode' as address_code, o.delivery_mismatch_at,
      o.copied_from is not null as copied
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!order || order.copied || order.delivery_mismatch_at || order.delivery_method === "pickup") return null;
  const delivery = readDelivery(order.delivery);
  if (!delivery) return null;
  const country = String(order.market_code).trim();
  const zoneRows =
    delivery.kind === "method" || delivery.kind === "flat"
      ? await db().execute<Row>(sql`
          select z.id, z.patterns, z.position,
            exists (
              select 1 from commerce.shipping_method_rates r
              join commerce.shipping_methods m on m.store_id = r.store_id and m.id = r.method_id and m.active
              where r.store_id = z.store_id and r.zone_id = z.id
            ) as priced
          from commerce.shipping_zones z where z.store_id = ${storeId}::uuid and z.market_code = ${country}
        `)
      : [];
  const zones = zoneRows.map((z) => ({ id: String(z.id), patterns: (z.patterns ?? []) as string[], position: Number(z.position) }));
  const pricedZones = new Set(zoneRows.filter((z) => z.priced === true).map((z) => String(z.id)));
  let area: AreaTerms | null = null;
  if (delivery.kind === "local") {
    const [row] = await db().execute<Row>(sql`
      select a.id, a.kind, a.patterns, a.radius_km, a.amount_minor, a.min_basket_minor, a.free_over_minor, a.position, l.latitude, l.longitude
      from commerce.local_delivery_areas a left join commerce.store_locations l on l.store_id = a.store_id and l.id = a.location_id
      where a.store_id = ${storeId}::uuid and a.id = ${delivery.areaId}::uuid
    `);
    area = row
      ? {
          id: String(row.id),
          kind: row.kind === "radius" ? "radius" : "postal",
          patterns: (row.patterns ?? []) as string[],
          radiusKm: nullableNumber(row.radius_km),
          origin: row.latitude === null || row.latitude === undefined ? null : { lat: Number(row.latitude), lon: Number(row.longitude) },
          amountMinor: Number(row.amount_minor),
          minBasketMinor: nullableNumber(row.min_basket_minor),
          freeOverMinor: nullableNumber(row.free_over_minor),
          position: Number(row.position),
          active: true,
        }
      : null;
  }
  const addressCode = order.address_code ? String(order.address_code) : null;
  const cleanAddress = addressCode ? cleanPostalCode(country, addressCode) : null;
  const [point] =
    area?.kind === "radius" && cleanAddress
      ? await db().execute<Row>(sql`select latitude, longitude from commerce.postal_points where country = ${country} and postal_code = ${cleanAddress}`)
      : [];
  const found = postalMismatch(delivery, country, addressCode, {
    zoneOf: (code) => zoneFor(zones, code)?.id ?? null,
    pricedZoneOf: (code) => {
      const zone = zoneFor(zones, code)?.id ?? null;
      return zone && pricedZones.has(zone) ? zone : null;
    },
    areaCovers: (code) => (area ? areaCovers(area, code, point ? { lat: Number(point.latitude), lon: Number(point.longitude) } : null) : false),
  });
  if (!found) return null;
  const marked = await db().execute<Row>(sql`
    update commerce.orders set delivery_mismatch_at = now()
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid and delivery_mismatch_at is null
    returning id
  `);
  if (marked.length === 0) return null;
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${storeId}::uuid, ${orderId}::uuid, 'order.delivery_mismatch', ${JSON.stringify(found)}::jsonb, 'system')
  `);
  return found;
}
