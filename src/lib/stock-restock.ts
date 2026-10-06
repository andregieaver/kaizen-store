/**
 * Where units go back when a refund, a cancellation or an inspected return restocks them (wave 3, D172,
 * `docs/wave-3-inventory.md` 2.6, 4.3). Pure, deterministic.
 *
 * DEFAULT: the units go back to the location(s) they were taken from, worked out from the order's own movements: per location, the
 * units the order's `sale` movements took there minus what already went back there for this order. They are filled from the
 * highest-ranked location first, within what is left to restore at each. A location that is no longer active gives its share to the
 * first active location in rank order (`fallback: true`, and the dialog says so). Staff MAY CHOOSE one active location for all of an
 * item's units instead.
 *
 * A restock above what the order took is refused (`too_many`, as `Only n of ... can go back in stock` is today). An order with no
 * recorded sale movements (paid before the history existed) is put back at the default location, and the caller bounds the
 * quantity by the line, as it always did.
 */

export type Part = { locationId: string; quantity: number };

export type RestockPart = {
  locationId: string;
  quantity: number;
  /** The units are going to a place they were not taken from (a chosen location, or the fallback for an inactive original). */
  elsewhere: boolean;
  /** The original location is no longer active, so the first active location takes the units. */
  fallback: boolean;
};

export type RestockPlan =
  | { ok: true; parts: RestockPart[] }
  | { ok: false; reason: "too_many"; max: number }
  | { ok: false; reason: "location_not_active" }
  | { ok: false; reason: "no_active_location" };

const sum = (parts: readonly Part[]): number => parts.reduce((total, p) => total + p.quantity, 0);

/** What is left to put back at each location: taken minus returned, never below 0, in the order locations first appear in `taken`. */
export function leftToRestore(taken: readonly Part[], returned: readonly Part[]): Part[] {
  const left = new Map<string, number>();
  for (const t of taken) left.set(t.locationId, (left.get(t.locationId) ?? 0) + t.quantity);
  for (const r of returned) if (left.has(r.locationId)) left.set(r.locationId, (left.get(r.locationId) ?? 0) - r.quantity);
  // Units put back at a place the order never took from (a chosen location) are taken off the whole, not off one place.
  const outside = returned.filter((r) => !left.has(r.locationId)).reduce((total, r) => total + r.quantity, 0);
  const result = [...left.entries()].map(([locationId, quantity]) => ({ locationId, quantity: Math.max(quantity, 0) }));
  let spill = outside;
  // Take the units that already went elsewhere off the places that still have some, last place first.
  for (let i = result.length - 1; i >= 0 && spill > 0; i--) {
    const cut = Math.min(result[i].quantity, spill);
    result[i].quantity -= cut;
    spill -= cut;
  }
  return result.filter((p) => p.quantity > 0);
}

/**
 * How many units of a variant an order can still put back: what its sale movements took minus what already went back, in all. An
 * order that took less than its lines say (a hold that expired and the stock was sold meanwhile: the draw took what was left and
 * wrote `stock.short`) can put back only what it took, so a cancellation or a refund that asks for "the whole line" asks for this
 * much, not for the line's quantity. Null when the order has no recorded sale (paid before the history was kept): the line decides.
 */
export function restockableTotal(taken: readonly Part[], returned: readonly Part[]): number | null {
  if (taken.length === 0) return null;
  return sum(leftToRestore(taken, returned));
}

/**
 * How many units each line of an order can still put back in stock: the line's own room (`quantity - restocked`), and, for lines of
 * a variant whose units the order took in part only, what is left of what it took, shared out over the variant's lines in the order
 * given. `lines` are the physical lines with a variant, in order.
 */
export function restockRoom(
  lines: readonly { id: string; variantId: string; quantity: number; restocked: number }[],
  history: ReadonlyMap<string, { taken: readonly Part[]; returned: readonly Part[] }>,
): Map<string, number> {
  const left = new Map<string, number | null>();
  for (const [variantId, entry] of history) left.set(variantId, restockableTotal(entry.taken, entry.returned));
  const room = new Map<string, number>();
  for (const line of lines) {
    const own = Math.max(line.quantity - line.restocked, 0);
    const pool = left.get(line.variantId);
    if (pool === null || pool === undefined) {
      room.set(line.id, own);
      continue;
    }
    const give = Math.min(own, pool);
    room.set(line.id, give);
    left.set(line.variantId, pool - give);
  }
  return room;
}

/**
 * The plan for putting back `quantity` units of one variant of an order.
 *
 * @param taken     what the order's sale movements took, per location (positive quantities)
 * @param returned  what already went back for this order, per location (positive quantities)
 * @param activeRank the ids of the store's active locations in rank order
 * @param chosen    the location staff chose for all of the units, or null for the default
 */
export function restockPlan(args: { taken: readonly Part[]; returned: readonly Part[]; quantity: number; activeRank: readonly string[]; chosen?: string | null }): RestockPlan {
  const quantity = Math.floor(args.quantity);
  const parts: RestockPart[] = [];
  if (!(quantity > 0)) return { ok: true, parts };
  const first = args.activeRank[0];
  if (!first) return { ok: false, reason: "no_active_location" };
  if (args.chosen != null && !args.activeRank.includes(args.chosen)) return { ok: false, reason: "location_not_active" };

  const left = leftToRestore(args.taken, args.returned);
  const hasHistory = args.taken.length > 0;
  const total = sum(left);
  if (hasHistory && quantity > total) return { ok: false, reason: "too_many", max: total };

  // A chosen location takes everything, and is "elsewhere" for the units it was not taken from.
  if (args.chosen != null) {
    const original = left.find((p) => p.locationId === args.chosen)?.quantity ?? 0;
    return { ok: true, parts: [{ locationId: args.chosen, quantity, elsewhere: !hasHistory ? false : original < quantity, fallback: false }] };
  }
  // No history (an order from before it was kept): the default location.
  if (!hasHistory) return { ok: true, parts: [{ locationId: first, quantity, elsewhere: false, fallback: false }] };

  const active = new Set(args.activeRank);
  const rankOf = (id: string): number => {
    const at = args.activeRank.indexOf(id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  // Highest-ranked first; places that are no longer active come after, in the order the order took from them.
  const ordered = left.map((p, i) => ({ ...p, i })).sort((a, b) => rankOf(a.locationId) - rankOf(b.locationId) || a.i - b.i);
  let remaining = quantity;
  const merged = new Map<string, RestockPart>();
  for (const place of ordered) {
    if (remaining === 0) break;
    const take = Math.min(place.quantity, remaining);
    if (take <= 0) continue;
    const isActive = active.has(place.locationId);
    const destination = isActive ? place.locationId : first;
    const have = merged.get(destination);
    if (have) {
      have.quantity += take;
      have.elsewhere = have.elsewhere || !isActive;
      have.fallback = have.fallback || !isActive;
    } else {
      merged.set(destination, { locationId: destination, quantity: take, elsewhere: !isActive, fallback: !isActive });
    }
    remaining -= take;
  }
  parts.push(...merged.values());
  return { ok: true, parts };
}
