/**
 * Which location an order's units come from (wave 3, D172, `docs/wave-3-inventory.md` 2.5, 4.3). Pure, deterministic.
 *
 * One stated rule, and `placeOrder()` calls it after it has locked the level rows (every writer locks them in (variant id,
 * location id) order, so two checkouts cannot deadlock):
 *
 *  1. Candidates are the ACTIVE locations in rank order (`priority`, then `created_at`, then `id`). The free units of a variant at
 *     a location are `on_hand` minus the live reservations of other checkouts, never below 0.
 *  2. KEEP AN ORDER TOGETHER. If one location can supply every line of the order in full from its free units, the order comes from
 *     the first such location in rank order.
 *  3. Otherwise each variant, in the order of the lines, takes from the locations in rank order: as much as the location has free,
 *     then the next. (The order is split.)
 *  4. THE BACKORDERED REMAINDER (units beyond all free units, `continue` variants only) is taken at the first location in rank order
 *     that has a level row for the variant, else at the first location in rank order.
 *  5. A `deny` variant with fewer units free than wanted makes the order fail with the `stock` problem and allocates nothing.
 *
 * Two lines of one variant are one want (summed, at the position of the first). Lines with no quantity are ignored. The caller
 * passes only physical goods lines.
 *
 * NEAREST FIRST (D383, the store's `order_settings.stock_routing = 'nearest'`): with `nearCountry` given, the locations in that country come
 * first and the others after, each group in rank order; every step above reads that order. A location that does not fulfil online orders
 * is never a candidate: the caller passes only those that do.
 */

import { inRankOrder, type Rankable } from "./inventory";

/** A candidate location; `country` (ISO 3166-1 alpha-2) is read only for the nearest-first order. */
export type RoutingLocation = Rankable & { active: boolean; country?: string };

/** What the store holds of a variant at a location: a level row (its figure) and the units live reservations hold there. */
export type StockCell = { variantId: string; locationId: string; onHand: number; reserved: number };

export type WantedLine = { variantId: string; quantity: number; policy: "deny" | "continue" };

/** The units of one variant taken at one location. `backordered` is the part of `quantity` beyond the location's free units (the remainder, step 4). */
export type Take = { variantId: string; locationId: string; quantity: number; backordered: number };

export type AllocateResult =
  | {
      ok: true;
      takes: Take[];
      /** The location the whole order comes from (step 2), or null when it is split or has a backordered part. */
      wholeOrderAt: string | null;
    }
  | { ok: false; reason: "stock"; variantId: string; short: number }
  | { ok: false; reason: "no_location"; variantId: string; short: number };

/** The free units of a variant at a location (never below 0). */
export const freeUnits = (cell: Pick<StockCell, "onHand" | "reserved"> | undefined): number => (cell ? Math.max(cell.onHand - cell.reserved, 0) : 0);

type Want = { variantId: string; quantity: number; policy: "deny" | "continue" };

/** The wants of an order: lines of one variant summed, in the order of first appearance. A variant that is `deny` in any of its lines is `deny`. */
export function wantsOf(lines: readonly WantedLine[]): Want[] {
  const byVariant = new Map<string, Want>();
  for (const line of lines) {
    const quantity = Math.floor(line.quantity);
    if (!(quantity > 0)) continue;
    const have = byVariant.get(line.variantId);
    if (have) {
      have.quantity += quantity;
      if (line.policy === "deny") have.policy = "deny";
    } else {
      byVariant.set(line.variantId, { variantId: line.variantId, quantity, policy: line.policy });
    }
  }
  return [...byVariant.values()];
}

/** The candidates in the order the steps read them: rank order, or the delivery country's first (each group in rank) when one is given. */
export function routingOrder<L extends RoutingLocation>(locations: readonly L[], nearCountry?: string | null): L[] {
  const ranked = inRankOrder(locations.filter((l) => l.active));
  if (!nearCountry) return ranked;
  const near = nearCountry.toUpperCase();
  return [...ranked.filter((l) => l.country?.toUpperCase() === near), ...ranked.filter((l) => l.country?.toUpperCase() !== near)];
}

export function allocate(args: {
  locations: readonly RoutingLocation[];
  cells: readonly StockCell[];
  lines: readonly WantedLine[];
  /** The delivery country, for a store that takes the nearest locations first; none: rank order. */
  nearCountry?: string | null;
}): AllocateResult {
  const wants = wantsOf(args.lines);
  if (wants.length === 0) return { ok: true, takes: [], wholeOrderAt: null };

  const ranked = routingOrder(args.locations, args.nearCountry);
  const cellAt = new Map<string, StockCell>();
  for (const cell of args.cells) cellAt.set(`${cell.variantId}\u0000${cell.locationId}`, cell);
  const cell = (variantId: string, locationId: string) => cellAt.get(`${variantId}\u0000${locationId}`);
  const free = (variantId: string, locationId: string) => freeUnits(cell(variantId, locationId));

  // Step 2: the first location that has every want in full from its free units.
  for (const location of ranked) {
    if (wants.every((w) => free(w.variantId, location.id) >= w.quantity)) {
      return {
        ok: true,
        takes: wants.map((w) => ({ variantId: w.variantId, locationId: location.id, quantity: w.quantity, backordered: 0 })),
        wholeOrderAt: location.id,
      };
    }
  }

  // Steps 3 to 5: variant by variant, in rank order.
  const takes: Take[] = [];
  for (const want of wants) {
    let left = want.quantity;
    for (const location of ranked) {
      if (left === 0) break;
      const quantity = Math.min(free(want.variantId, location.id), left);
      if (quantity > 0) {
        takes.push({ variantId: want.variantId, locationId: location.id, quantity, backordered: 0 });
        left -= quantity;
      }
    }
    if (left === 0) continue;
    if (want.policy === "deny") return { ok: false, reason: "stock", variantId: want.variantId, short: left };
    // Step 4: the remainder at the first location that has a level row for the variant, else the first location.
    const home = ranked.find((l) => cell(want.variantId, l.id) !== undefined) ?? ranked[0];
    if (!home) return { ok: false, reason: "no_location", variantId: want.variantId, short: left };
    const same = takes.find((t) => t.variantId === want.variantId && t.locationId === home.id);
    if (same) {
      same.quantity += left;
      same.backordered += left;
    } else {
      takes.push({ variantId: want.variantId, locationId: home.id, quantity: left, backordered: left });
    }
  }
  return { ok: true, takes, wholeOrderAt: null };
}

/** The units of an allocation by variant (what a line says it will take in all), and the backordered part. */
export function totalsOf(takes: readonly Take[]): Map<string, { quantity: number; backordered: number }> {
  const totals = new Map<string, { quantity: number; backordered: number }>();
  for (const t of takes) {
    const have = totals.get(t.variantId) ?? { quantity: 0, backordered: 0 };
    have.quantity += t.quantity;
    have.backordered += t.backordered;
    totals.set(t.variantId, have);
  }
  return totals;
}

/**
 * The locks to take, in the one order every writer uses: (variant id, location id), each pair once. Works on text, so two
 * transactions sort the same way whatever the driver.
 */
export function lockOrder(pairs: readonly { variantId: string; locationId: string }[]): { variantId: string; locationId: string }[] {
  const seen = new Set<string>();
  const unique: { variantId: string; locationId: string }[] = [];
  for (const p of pairs) {
    const key = `${p.variantId}\u0000${p.locationId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ variantId: p.variantId, locationId: p.locationId });
    }
  }
  return unique.sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0));
}
