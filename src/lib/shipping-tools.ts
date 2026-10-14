/**
 * What the AI manager's shipping tools (wave 3, D237, `docs/wave-3-shipping-methods.md` 2.6 and 5.5) do that needs no database. `shipping_overview`
 * repeats the Shipping pages (methods with their rates per zone and profile, zones, profiles, the default weight, pickup places and local delivery
 * areas, per country) and `pickup_orders` the Orders page's *To hand over* and *Local deliveries* views. Both are read-only and ungated: no tool changes
 * shipping or marks an order ready, collected or out for delivery (section 7). Every amount is written by the caller's `formatMoney()`; the model
 * repeats the words and works nothing out. Pure, so tests hold it without a database.
 */

import { readyInWords } from "./pickup";
import type { RateBasis } from "./shipping-methods";

export const SHIPPING_TOOLS = ["shipping_overview", "pickup_orders"] as const;

/** Writes an amount in minor units of a currency (the tool's `formatMoney()` in the store's main locale). */
export type MoneyWords = (minor: number, currency: string) => string;

export type ToolRate = { zoneId: string | null; profileId: string | null; basis: RateBasis; minValue: number; maxValue: number | null; amountMinor: number };

/** A weight in grams as the Shipping page says it: whole kilograms as kg, anything under a kilogram in grams. */
export function weightWords(grams: number): string {
  if (grams >= 1000) return `${Number((grams / 1000).toFixed(3))} kg`;
  return `${grams} g`;
}

/**
 * One rate row in words. A tier's minimum counts and its maximum does not (4.2), so the words say "from … to under …", and an open tier "… and more".
 * Value tiers are the basket's value in the method's own currency, VAT included.
 */
export function tierWords(rate: Pick<ToolRate, "basis" | "minValue" | "maxValue" | "amountMinor">, currency: string, money: MoneyWords): string {
  const price = money(rate.amountMinor, currency);
  if (rate.basis === "flat") return `${price} for any basket`;
  const bound = (v: number) => (rate.basis === "weight" ? weightWords(v) : money(v, currency));
  const what = rate.basis === "weight" ? "weight" : "basket value";
  const range = rate.maxValue === null ? `${bound(rate.minValue)} and more` : `from ${bound(rate.minValue)} to under ${bound(rate.maxValue)}`;
  return `${what} ${range}: ${price}`;
}

export type ToolMethod = {
  name: string;
  currency: string;
  active: boolean;
  estimate: { min: number; max: number } | null;
  freeOverMinor: number | null;
  rates: ToolRate[];
};

/**
 * A method as the model reads it: its rates grouped by zone and profile (Rest of country and General when none is named), each group's basis and its
 * tiers in words, in the order the page stores them.
 */
export function shapeMethod(method: ToolMethod, zoneName: (id: string) => string, profileName: (id: string) => string, money: MoneyWords) {
  const groups = new Map<string, { zone: string; profile: string; basis: RateBasis; tiers: string[] }>();
  for (const rate of method.rates) {
    const key = `${rate.zoneId ?? ""}|${rate.profileId ?? ""}`;
    const group = groups.get(key) ?? {
      zone: rate.zoneId ? zoneName(rate.zoneId) : "Rest of country",
      profile: rate.profileId ? profileName(rate.profileId) : "General",
      basis: rate.basis,
      tiers: [],
    };
    group.tiers.push(tierWords(rate, method.currency, money));
    groups.set(key, group);
  }
  return {
    name: method.name,
    active: method.active,
    ...(method.estimate ? { delivery_days: method.estimate.min === method.estimate.max ? `${method.estimate.min}` : `${method.estimate.min} to ${method.estimate.max}` } : {}),
    ...(method.freeOverMinor !== null ? { free_over: money(method.freeOverMinor, method.currency) } : {}),
    rates: [...groups.values()].map((g) => ({ zone: g.zone, profile: g.profile, by: g.basis === "flat" ? "flat" : g.basis === "weight" ? "weight" : "basket value", prices: g.tiers })),
    ...(groups.size === 0 ? { note: "No rates yet: this method prices no basket." } : {}),
  };
}

/** How long a pickup usually takes, in English, from the Pickup page's own rule (`readyInWords()`: 0 is "when we say", hours under 48, else days). */
export function readyWords(hours: number): string {
  const w = readyInWords(hours);
  if (w.key === "notify") return "when the store says it is ready";
  if (w.key === "hours") return `usually within ${w.count} ${w.count === 1 ? "hour" : "hours"}`;
  return `usually within ${w.count} ${w.count === 1 ? "day" : "days"}`;
}

export const ZONE_PATTERNS_SHOWN = 10;

/** A zone as the model reads it: its name, how many postal codes and prefixes it holds and the first few (a prefix ends in `*`). */
export const shapeZone = (zone: { name: string; patterns: readonly string[] }) => ({
  name: zone.name,
  postal_patterns: zone.patterns.length,
  first_patterns: zone.patterns.slice(0, ZONE_PATTERNS_SHOWN),
});

export type ToolArea = {
  name: string;
  currency: string;
  kind: "postal" | "radius";
  placeName: string | null;
  patterns: readonly string[];
  radiusKm: number | null;
  amountMinor: number;
  minBasketMinor: number | null;
  freeOverMinor: number | null;
  active: boolean;
  /** A radius area whose place has no position cannot be switched on. */
  hasOrigin: boolean;
};

/** A local delivery area as the model reads it, with the radius's limit said where it applies. */
export function shapeArea(area: ToolArea, money: MoneyWords) {
  return {
    name: area.name,
    active: area.active,
    ...(area.kind === "postal"
      ? { covers: `${area.patterns.length} postal ${area.patterns.length === 1 ? "code or prefix" : "codes and prefixes"}`, first_patterns: area.patterns.slice(0, ZONE_PATTERNS_SHOWN) }
      : { covers: `${area.radiusKm ?? 0} km around ${area.placeName ?? "a place"}, measured between postal-code centres`, ...(area.hasOrigin ? {} : { note: "The place has no position, so this area cannot be switched on." }) }),
    price: money(area.amountMinor, area.currency),
    ...(area.minBasketMinor !== null ? { minimum_basket: money(area.minBasketMinor, area.currency) } : {}),
    ...(area.freeOverMinor !== null ? { free_over: money(area.freeOverMinor, area.currency) } : {}),
  };
}

export type HandoverOrder = {
  number: string;
  method: "pickup" | "local";
  /** The pickup place's or the local area's name as kept on the order (a snapshot), or null when the order keeps none. */
  where: string | null;
  placedAt: string;
  readyAt: string | null;
  /** Taken out for local delivery (a handover of method `local`), not delivered yet. */
  outAt: string | null;
};

/**
 * The orders to hand over, grouped by place or area, as the model reads them: counts and numbers only, never a name or an address (2.6). A pickup order
 * is ready or not yet; a local one is taken out or not yet. Oldest first inside each group, as the Orders page sorts them.
 */
export function groupHandovers(orders: readonly HandoverOrder[]) {
  const groups = new Map<string, { method: "pickup" | "local"; where: string; orders: HandoverOrder[] }>();
  for (const o of orders) {
    const where = o.where ?? (o.method === "pickup" ? "Pickup place not recorded" : "Local area not recorded");
    const key = `${o.method}|${where}`;
    const g = groups.get(key) ?? { method: o.method, where, orders: [] };
    g.orders.push(o);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => (a.method === b.method ? a.where.localeCompare(b.where) : a.method === "pickup" ? -1 : 1));
  return sorted.map((g) => {
    const list = [...g.orders].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    if (g.method === "pickup") {
      const ready = list.filter((o) => o.readyAt !== null);
      return {
        kind: "pickup" as const,
        place: g.where,
        orders: list.length,
        marked_ready: ready.length,
        not_marked_ready: list.length - ready.length,
        numbers: list.map((o) => o.number),
        oldest_placed: list[0]?.placedAt ?? null,
      };
    }
    const out = list.filter((o) => o.outAt !== null);
    return {
      kind: "local" as const,
      area: g.where,
      orders: list.length,
      out_for_delivery: out.length,
      not_taken_out: list.length - out.length,
      numbers: list.map((o) => o.number),
      oldest_placed: list[0]?.placedAt ?? null,
    };
  });
}
