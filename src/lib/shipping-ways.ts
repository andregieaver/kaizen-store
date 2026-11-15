/**
 * Ways most shops deliver (round 11, D634): three methods that open Add a method with a name and a delivery time filled in, the price left
 * for the owner, and collecting from the shop, which is the store's own pickup places. Pure.
 */
export const WAY_KEYS = ["home", "pickup_point", "express"] as const;
export type WayKey = (typeof WAY_KEYS)[number];

export const WAY_DAYS: Record<WayKey, { min: number; max: number }> = {
  home: { min: 2, max: 4 },
  pickup_point: { min: 1, max: 3 },
  express: { min: 1, max: 1 },
};

export function isWayKey(value: unknown): value is WayKey {
  return typeof value === "string" && (WAY_KEYS as readonly string[]).includes(value);
}
