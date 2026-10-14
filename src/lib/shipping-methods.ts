import { shippingCost, type ShippingRate } from "./checkout";
import { areaFor, type AreaQuote, type AreaTerms, type GeoPoint } from "./local-delivery";
import { shown, type Market } from "./markets";
import { TIERS_MAX } from "./shipping-limits";

/**
 * Which shipping a basket gets and what it costs (D237, `docs/wave-3-shipping-methods.md` 4.1 and 4.2): the market's own methods priced by their rates
 * per zone and profile, the flat rate as the fallback, the store's pickup places and the cheapest local delivery area. The one place the arithmetic
 * lives: `chosenDelivery()` (the one reader of a cart's choice, for `cartSummary()` and `placeOrder()` alike) calls these functions over the same rows.
 * Amounts are stored in the market's own currency and compared and summed as shown (`shown()`, each converted on its own). Pure, no zod: the checkout,
 * a pay route, reads it.
 */

type View = Pick<Market, "conversion">;

export type RateBasis = "flat" | "weight" | "value";

/** One row of `shipping_method_rates`: `zoneId` null is Rest of country, `profileId` null is General. Bounds are grams or minor units (native). */
export type MethodRate = {
  zoneId: string | null;
  profileId: string | null;
  basis: RateBasis;
  minValue: number;
  maxValue: number | null;
  amountMinor: number;
};

/** A method as the checkout reads it (`shipping_methods` with its rates); amounts native. */
export type MethodTerms = {
  id: string;
  label: string;
  position: number;
  active: boolean;
  freeOverMinor: number | null;
  estimate: { min: number; max: number } | null;
  rates: readonly MethodRate[];
};

/** A line of the basket as shipping reads it: `totalMinor` is the line's value as shown, before discounts. */
export type ShippingLine = {
  profileId: string | null;
  quantity: number;
  weightGrams: number | null;
  totalMinor: number;
  physical: boolean;
  gift: boolean;
  recurring: boolean;
};

/** The part of a basket one profile holds: its weight in grams and its value as shown. */
export type BasketPart = { profileId: string | null; weightGrams: number; valueMinor: number };

const byProfile = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);

/**
 * The basket's parts by profile (4.2 point 1): its physical lines that are neither a free gift nor a subscription, General first. A unit with no weight
 * of its own weighs the store's default (`shipping_settings.default_weight_grams`).
 */
export function partsOf(lines: readonly ShippingLine[], defaultWeightGrams: number): BasketPart[] {
  const parts = new Map<string | null, BasketPart>();
  for (const line of lines) {
    if (!line.physical || line.gift || line.recurring || line.quantity <= 0) continue;
    const part = parts.get(line.profileId) ?? { profileId: line.profileId, weightGrams: 0, valueMinor: 0 };
    part.weightGrams += line.quantity * (line.weightGrams && line.weightGrams > 0 ? line.weightGrams : defaultWeightGrams);
    part.valueMinor += line.totalMinor;
    parts.set(line.profileId, part);
  }
  return [...parts.values()].sort((a, b) => byProfile(a.profileId, b.profileId));
}

/** The value free shipping is judged on (as `basketShipping()` judges it): every line but the free gifts, downloads included, before discounts. */
export function basketValue(lines: readonly ShippingLine[]): number {
  return lines.reduce((sum, l) => (l.gift ? sum : sum + l.totalMinor), 0);
}

/** The rates of one method for one zone and profile (a group: one flat row, or tiers). */
export function groupOf(rates: readonly MethodRate[], zoneId: string | null, profileId: string | null): MethodRate[] {
  return rates.filter((r) => r.zoneId === zoneId && r.profileId === profileId);
}

/**
 * The tier of a group that matches a part (4.2 point 3): the flat row, or the tier whose minimum is at most the part's weight (grams) or value (as
 * shown) and whose maximum is above it (an open tier has none). Value bounds are converted as shown, each on its own. Null: no tier matches.
 */
export function tierFor(group: readonly MethodRate[], part: BasketPart, view: View): MethodRate | null {
  for (const rate of group) {
    if (rate.basis === "flat") return rate;
    const x = rate.basis === "weight" ? part.weightGrams : part.valueMinor;
    const min = rate.basis === "weight" ? rate.minValue : shown(view, rate.minValue);
    const max = rate.maxValue === null ? null : rate.basis === "weight" ? rate.maxValue : shown(view, rate.maxValue);
    if (x >= min && (max === null || x < max)) return rate;
  }
  return null;
}

export type MethodPrice = {
  /** The method's price for the basket and its free-above, as shown: the basket's `ShippingRate` for `basketShipping()`. */
  rate: ShippingRate;
  /** What the basket pays (0 above the free-above). */
  priceMinor: number;
  /** The tier each part took, in the order of `parts`. */
  tiers: MethodRate[];
};

const safe = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error("shipping: an amount is out of range");
  return n;
};

/**
 * What a method costs a basket in a zone (4.2), or null when it is not offered: every part needs a matching tier in the zone's group for its profile
 * (a zone with no row for a profile does not fall back to Rest of country). The price is the sum of the parts' tiers (each converted, then added), and 0
 * when the whole basket's value reaches the method's free-above.
 */
export function methodPrice(method: MethodTerms, parts: readonly BasketPart[], zoneId: string | null, view: View, basketValueMinor: number): MethodPrice | null {
  if (!method.active || parts.length === 0) return null;
  const tiers: MethodRate[] = [];
  let amount = 0;
  for (const part of parts) {
    const tier = tierFor(groupOf(method.rates, zoneId, part.profileId), part, view);
    if (!tier) return null;
    tiers.push(tier);
    amount = safe(amount + shown(view, tier.amountMinor));
  }
  const rate: ShippingRate = { amountMinor: amount, freeOverMinor: method.freeOverMinor === null ? null : shown(view, method.freeOverMinor) };
  return { rate, priceMinor: shippingCost(basketValueMinor, rate), tiers };
}

/** A pickup place as the checkout reads it: its price native (0 = free). */
export type PickupTerms = { id: string; locationId: string; amountMinor: number; readyInHours: number; position: number; active: boolean };

export type OfferedDelivery =
  | { kind: "method"; id: string; label: string; position: number; rate: ShippingRate; priceMinor: number; estimate: { min: number; max: number } | null }
  | { kind: "flat"; id: "flat"; rate: ShippingRate; priceMinor: number }
  | { kind: "pickup"; id: string; locationId: string; position: number; rate: ShippingRate; priceMinor: number; readyInHours: number }
  | { kind: "local"; id: string; position: number; rate: ShippingRate; priceMinor: number };

export type OfferInput = {
  /** Whether anything in the basket is shipped (physical goods). */
  physical: boolean;
  /** Whether the basket holds a subscription (the flat rate only, D25). */
  subscription: boolean;
  view: View;
  /** The market's flat rate, native; null when the store set none. */
  flat: ShippingRate | null;
  methods: readonly MethodTerms[];
  parts: readonly BasketPart[];
  basketValueMinor: number;
  /** The zone of the delivery postal code (`zoneFor()`), null for Rest of country or before a code is given. */
  zoneId: string | null;
  pickups?: readonly PickupTerms[];
  areas?: readonly AreaTerms[];
  /** The delivery postal code (clean) and its centre in the reference data, for local delivery. */
  postalCode?: string | null;
  point?: GeoPoint | null;
};

export type DeliveryOffer = {
  /** `none`: nothing to ship; `ok`: something can be chosen; `no_shipping`: nothing ships the basket (pickup or local delivery may still be offered). */
  status: "none" | "ok" | "no_shipping";
  /** What ships the basket: the methods that price it, cheapest first, else the flat rate (as *Shipping*), else nothing. */
  ship: OfferedDelivery[];
  pickups: OfferedDelivery[];
  local: OfferedDelivery | null;
  /** A covering area the basket is below the minimum of, shown greyed ("Local delivery from {minimum}"), when no area is offered. */
  localBelowMinimum: AreaQuote | null;
  /** The cheapest of `ship` (4.1 point 4); never pickup or local delivery. */
  default: OfferedDelivery | null;
};

const order = (a: OfferedDelivery, b: OfferedDelivery) => {
  const pa = "position" in a ? a.position : 0;
  const pb = "position" in b ? b.position : 0;
  return a.priceMinor - b.priceMinor || pa - pb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/** What a flat rate costs the basket, as shown. */
function flatOffer(flat: ShippingRate, view: View, basketValueMinor: number): OfferedDelivery {
  const rate: ShippingRate = { amountMinor: shown(view, flat.amountMinor), freeOverMinor: flat.freeOverMinor === null ? null : shown(view, flat.freeOverMinor) };
  return { kind: "flat", id: "flat", rate, priceMinor: shippingCost(basketValueMinor, rate) };
}

/**
 * Everything a basket may choose (4.1): nothing when nothing is shipped; the flat rate alone with a subscription; otherwise the methods that price the
 * basket in its zone, else the flat rate, plus the market's active pickup places and the cheapest local area covering the postal code. Carriers' services
 * (D135) are the server's to add; they are never the default.
 */
export function deliveryOffer(input: OfferInput): DeliveryOffer {
  const empty: DeliveryOffer = { status: "none", ship: [], pickups: [], local: null, localBelowMinimum: null, default: null };
  if (!input.physical) return empty;
  if (input.subscription) {
    const flat = input.flat ? [flatOffer(input.flat, input.view, input.basketValueMinor)] : [];
    return { ...empty, status: flat.length > 0 ? "ok" : "no_shipping", ship: flat, default: flat[0] ?? null };
  }
  const methods: OfferedDelivery[] = [];
  for (const method of input.methods) {
    const price = methodPrice(method, input.parts, input.zoneId, input.view, input.basketValueMinor);
    if (price) methods.push({ kind: "method", id: method.id, label: method.label, position: method.position, rate: price.rate, priceMinor: price.priceMinor, estimate: method.estimate });
  }
  methods.sort(order);
  const ship = methods.length > 0 ? methods : input.flat ? [flatOffer(input.flat, input.view, input.basketValueMinor)] : [];
  const pickups: OfferedDelivery[] = (input.pickups ?? [])
    .filter((p) => p.active)
    .map((p) => {
      const rate: ShippingRate = { amountMinor: shown(input.view, p.amountMinor), freeOverMinor: null };
      return { kind: "pickup" as const, id: p.id, locationId: p.locationId, position: p.position, rate, priceMinor: rate.amountMinor, readyInHours: p.readyInHours };
    })
    .sort(order);
  const { offered, belowMinimum } = areaFor(input.areas ?? [], input.postalCode ?? null, input.point ?? null, input.basketValueMinor, input.view);
  const local: OfferedDelivery | null = offered ? { kind: "local", id: offered.area.id, position: offered.area.position, rate: offered.rate, priceMinor: offered.priceMinor } : null;
  return { status: ship.length > 0 ? "ok" : "no_shipping", ship, pickups, local, localBelowMinimum: belowMinimum, default: ship[0] ?? null };
}

/** The default delivery of an offer (4.1 point 4): the cheapest way it ships, never pickup or local delivery; null when nothing ships it. */
export const defaultDelivery = (offer: DeliveryOffer): OfferedDelivery | null => offer.default;

export type DeliveryChoice = { kind: "method" | "pickup" | "local"; id: string } | null;

/**
 * The delivery a cart's choice comes to (4.1 point 5): the chosen method, pickup place or local area while the offer still has it, else the default and
 * `changed` (the choice no longer prices the basket, the place was switched off or the area no longer covers the code or the basket fell below its
 * minimum). No choice is the default and not a change.
 */
export function chosenFrom(offer: DeliveryOffer, choice: DeliveryChoice): { delivery: OfferedDelivery | null; changed: boolean } {
  if (!choice) return { delivery: offer.default, changed: false };
  const pool = choice.kind === "method" ? offer.ship : choice.kind === "pickup" ? offer.pickups : offer.local ? [offer.local] : [];
  const found = pool.find((d) => d.kind === choice.kind && d.id === choice.id);
  return found ? { delivery: found, changed: false } : { delivery: offer.default, changed: true };
}

/**
 * The cheapest standard delivery offered to the basket (4.3, D153's `orders.standard_shipping_minor`): the lowest of the options the shopper was
 * actually OFFERED to ship it (`offer.ship`): the methods that price it, after their free-above, or the flat rate when it is the fallback offered (4.1
 * point 3). A flat rate kept only as a fallback the basket never reaches does not count: CRD Art. 13(2) speaks of the least expensive standard
 * delivery "offered by the trader" (adversarial review; legal review item 3). Pickup and local delivery do not count (an assumption for legal review).
 * Null when nothing ships the basket.
 */
export function standardShippingMinor(offer: DeliveryOffer): number | null {
  const candidates = offer.ship.filter((d) => d.kind === "method" || d.kind === "flat").map((d) => d.priceMinor);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The editor's checks (the database holds the same: `commerce.shipping_rate_group_problem()`)
// ---------------------------------------------------------------------------------------------------------------------

export type TierProblem = "too_many" | "mixed_basis" | "two_flat" | "flat_range" | "negative" | "empty_range" | "gap" | "overlap";

export type TierRow = { basis: RateBasis; minValue: number; maxValue: number | null; amountMinor: number };

/**
 * What is wrong with the rows of one (method, zone, profile), in the order the editor shows them (none: *Not offered*, which is fine): one basis, a flat
 * group of one row from 0 with no maximum, amounts and bounds not negative, each tier's maximum above its minimum, the first tier from 0 and each next
 * from where the one before ends, only the last open, at most `TIERS_MAX`.
 */
export function tierProblems(rows: readonly TierRow[]): TierProblem[] {
  const problems = new Set<TierProblem>();
  if (rows.length === 0) return [];
  if (rows.length > TIERS_MAX) problems.add("too_many");
  if (new Set(rows.map((r) => r.basis)).size > 1) problems.add("mixed_basis");
  for (const r of rows) {
    if (r.amountMinor < 0 || r.minValue < 0 || !Number.isSafeInteger(r.amountMinor) || !Number.isSafeInteger(r.minValue)) problems.add("negative");
    if (r.maxValue !== null && r.maxValue <= r.minValue) problems.add("empty_range");
    if (r.basis === "flat" && (r.minValue !== 0 || r.maxValue !== null)) problems.add("flat_range");
  }
  if (rows.every((r) => r.basis === "flat")) {
    if (rows.length > 1) problems.add("two_flat");
    return [...problems];
  }
  const sorted = [...rows].sort((a, b) => a.minValue - b.minValue || (a.maxValue ?? Infinity) - (b.maxValue ?? Infinity));
  let expected = 0;
  let open = false;
  for (const r of sorted) {
    if (open || r.minValue < expected) problems.add("overlap");
    else if (r.minValue > expected) problems.add("gap");
    if (r.maxValue === null) open = true;
    else expected = Math.max(expected, r.maxValue);
  }
  return [...problems];
}

// ---------------------------------------------------------------------------------------------------------------------
// The hub's warnings (2.1), computed and never stored
// ---------------------------------------------------------------------------------------------------------------------

export type MarketShippingFacts = {
  marketCode: string;
  hasFlat: boolean;
  zones: number;
  methods: readonly { active: boolean; rates: readonly Pick<MethodRate, "zoneId" | "basis">[] }[];
};

export type ShippingWarning =
  | { code: "no_flat_with_methods"; marketCode: string }
  | { code: "zones_without_rest"; marketCode: string }
  | { code: "subscriptions_need_flat"; marketCode: string }
  | { code: "default_weight_used"; variants: number };

/**
 * What the Shipping page warns about: a market with methods and no flat rate (a basket no method prices cannot be bought); a market with zones and no
 * Rest-of-country rate on any active method (addresses outside the zones cannot be served by a method); subscriptions or weekly boxes on with no flat
 * rate (they pay the flat rate); weight tiers in use while active goods variants have no weight (they weigh the default).
 */
export function shippingWarnings(
  markets: readonly MarketShippingFacts[],
  { recurringOn, variantsWithoutWeight }: { recurringOn: boolean; variantsWithoutWeight: number },
): ShippingWarning[] {
  const warnings: ShippingWarning[] = [];
  let weightTiers = false;
  for (const m of markets) {
    const active = m.methods.filter((x) => x.active);
    if (active.some((x) => x.rates.some((r) => r.basis === "weight"))) weightTiers = true;
    if (active.length > 0 && !m.hasFlat) warnings.push({ code: "no_flat_with_methods", marketCode: m.marketCode });
    if (m.zones > 0 && !active.some((x) => x.rates.some((r) => r.zoneId === null))) warnings.push({ code: "zones_without_rest", marketCode: m.marketCode });
    if (recurringOn && !m.hasFlat) warnings.push({ code: "subscriptions_need_flat", marketCode: m.marketCode });
  }
  if (weightTiers && variantsWithoutWeight > 0) warnings.push({ code: "default_weight_used", variants: variantsWithoutWeight });
  return warnings;
}
