import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LOCATIONS_MAX, deactivationWords, locationInput, moveInRank } from "@/lib/inventory";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { locationImpact, type LocationImpact } from "./inventory";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";

type Row = Record<string, unknown>;

/**
 * The store's stock locations (wave 3, D172, `docs/wave-3-inventory.md` 2.3). A location is added, renamed and ranked by staff (`products:write`: the
 * rank is the order an order's units are taken in, `allocate()`), and deactivated or reactivated by the OWNER only, because that takes stock off sale or
 * puts it back. A location is never deleted: levels, movements and refunds refer to it. The database holds the rules that cannot be raced (one active
 * location always, no deactivation while a checkout holds stock there, no two active locations with one name); this module gives the sentences.
 */

export type StockLocation = {
  id: string;
  name: string;
  country: string;
  active: boolean;
  priority: number;
  deactivatedAt: string | null;
  /** Units on hand and variants that have units here (positive levels). */
  units: number;
  variants: number;
};

/** The store's locations in rank order, active ones first; with what each holds. */
export async function listLocations(storeId: string): Promise<StockLocation[]> {
  const rows = await db().execute<Row>(sql`
    select loc.id, loc.name, loc.country, loc.active, loc.priority, loc.deactivated_at,
           coalesce(sum(greatest(l.on_hand, 0)), 0)::int as units, count(l.variant_id) filter (where l.on_hand > 0)::int as variants
    from commerce.inventory_locations loc
    left join commerce.inventory_levels l on l.store_id = loc.store_id and l.location_id = loc.id
    where loc.store_id = ${storeId}::uuid
    group by loc.id
    order by loc.active desc, loc.priority, loc.created_at, loc.id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    country: String(r.country),
    active: Boolean(r.active),
    priority: Number(r.priority),
    deactivatedAt: r.deactivated_at ? new Date(String(r.deactivated_at)).toISOString() : null,
    units: Number(r.units),
    variants: Number(r.variants),
  }));
}

export type LocationResult = { ok: true; id: string } | { ok: false; problem: string };

const text = (error: unknown): string => JSON.stringify({ m: (error as Error)?.message, c: (error as { cause?: { message?: string; code?: string } })?.cause?.message, code: (error as { code?: string })?.code, cc: (error as { cause?: { code?: string } })?.cause?.code });
const isUnique = (error: unknown): boolean => text(error).includes("23505");

const SAME_NAME = "Another active location already has this name.";

/**
 * Adds a location (no `id`: it goes last in the rank) or changes one's name and country. At most `LOCATIONS_MAX` locations, active or not. The
 * country is one of the store's known countries; a name is unique among the store's ACTIVE locations, case-insensitively. `products:write`.
 */
export async function saveLocation(member: Membership, raw: unknown, id: string | null = null): Promise<LocationResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = locationInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the location's name and country." };
  const { name, country } = parsed.data;
  const storeId = member.store.id;
  const [known] = await db().execute<Row>(sql`select code from commerce.countries where code = ${country}`);
  if (!known) return { ok: false, problem: "Choose a country." };
  try {
    return await db().transaction(async (tx): Promise<LocationResult> => {
      // The store's row is locked first, so two adds cannot both pass the count.
      await tx.execute(sql`select id from commerce.stores where id = ${storeId}::uuid for no key update`);
      if (id) {
        const [row] = await tx.execute<Row>(sql`
          update commerce.inventory_locations set name = ${name}, country = ${country}
          where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
        `);
        return row ? { ok: true, id: String(row.id) } : { ok: false, problem: "This location is not in this store." };
      }
      const [counted] = await tx.execute<Row>(sql`select count(*)::int as n, coalesce(max(priority), 0) as top from commerce.inventory_locations where store_id = ${storeId}::uuid`);
      if (Number(counted?.n ?? 0) >= LOCATIONS_MAX) return { ok: false, problem: `A store has at most ${LOCATIONS_MAX} stock locations.` };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.inventory_locations (store_id, name, country, priority)
        values (${storeId}::uuid, ${name}, ${country}, ${Number(counted?.top ?? 0) + 1})
        returning id
      `);
      return { ok: true, id: String(row.id) };
    }).then(async (result) => {
      if (result.ok) {
        await audit(member.account.id, storeId, "products.location_saved", { added: id === null, country }, { area: "products", target: { type: "inventory_location", id: result.id } }).catch((error) =>
          console.error("[inventory] the location could not be logged", error),
        );
        refreshTag(catalogTag(storeId));
      }
      return result;
    });
  } catch (error) {
    if (isUnique(error)) return { ok: false, problem: SAME_NAME };
    throw error;
  }
}

/**
 * Moves a location up or down in the rank (the order an order's units are taken in) and renumbers `priority` 1..n in one transaction: the active
 * locations first, in their order, then the inactive ones. Moving past an end changes nothing. `products:write`.
 */
export async function moveLocation(member: Membership, id: string, direction: "up" | "down"): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  if (direction !== "up" && direction !== "down") return { ok: false, problem: "Move a location up or down." };
  const storeId = member.store.id;
  const moved = await db().transaction(async (tx) => {
    await tx.execute(sql`select id from commerce.stores where id = ${storeId}::uuid for no key update`);
    const rows = await tx.execute<Row>(sql`
      select id, active from commerce.inventory_locations where store_id = ${storeId}::uuid order by active desc, priority, created_at, id
    `);
    const active = rows.filter((r) => r.active).map((r) => String(r.id));
    const inactive = rows.filter((r) => !r.active).map((r) => String(r.id));
    if (!rows.some((r) => String(r.id) === id)) return null;
    const next = moveInRank(active, id, direction);
    const order = [...next, ...inactive];
    for (const [i, locationId] of order.entries()) {
      await tx.execute(sql`update commerce.inventory_locations set priority = ${i + 1} where store_id = ${storeId}::uuid and id = ${locationId}::uuid and priority <> ${i + 1}`);
    }
    return order;
  });
  if (!moved) return { ok: false, problem: "This location is not in this store." };
  await audit(member.account.id, storeId, "products.location_saved", { moved: direction }, { area: "products", target: { type: "inventory_location", id } }).catch((error) => console.error("[inventory] the move could not be logged", error));
  refreshTag(catalogTag(storeId));
  return { ok: true };
}

export type DeactivateResult =
  | { ok: true; impact: LocationImpact; notice: string }
  | { ok: false; problem: string; impact?: LocationImpact };

/**
 * Deactivates a location: its stock stops being for sale. OWNER only. The dialog showed `locationImpact()`; the owner confirms by sending the unit
 * figure it showed, and the server recomputes it and refuses if it changed (stock arrived, or a checkout took some). It is refused while checkouts in
 * progress hold stock there and for the last active location (the database refuses those two too). The audit entry carries the counts.
 */
export async function deactivateLocation(member: Membership, id: string, confirmedUnits: number): Promise<DeactivateResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  const storeId = member.store.id;
  const impact = await locationImpact(db(), storeId, id);
  if (!impact) return { ok: false, problem: "This location is not in this store." };
  const words = deactivationWords(impact);
  if (words.refusal) return { ok: false, problem: words.refusal, impact };
  if (!Number.isInteger(confirmedUnits) || confirmedUnits !== impact.units) {
    return { ok: false, problem: `The stock at this location changed to ${impact.units} ${impact.units === 1 ? "unit" : "units"}. Read the figures again and confirm.`, impact };
  }
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.inventory_locations set active = false
      where store_id = ${storeId}::uuid and id = ${id}::uuid and active
      returning id
    `);
    if (!row) return { ok: false, problem: "This location is already inactive." };
  } catch (error) {
    const said = text(error);
    if (said.includes("location.last_active")) return { ok: false, problem: "A store keeps at least one active stock location. Add or reactivate another one first.", impact };
    if (said.includes("location.held")) return { ok: false, problem: "Checkouts in progress hold stock at this location; try again in a few minutes.", impact };
    throw error;
  }
  await audit(member.account.id, storeId, "products.location_deactivated", { units: impact.units, variants: impact.variants, owed: impact.owedUnits }, { area: "products", target: { type: "inventory_location", id } }).catch((error) =>
    console.error("[inventory] the deactivation could not be logged", error),
  );
  refreshTag(catalogTag(storeId));
  return { ok: true, impact, notice: words.notice };
}

/** Reactivates a location: its stock is for sale again at once. OWNER only. The name must not be an active location's. */
export async function reactivateLocation(member: Membership, id: string): Promise<{ ok: true; impact: LocationImpact } | { ok: false; problem: string }> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  const storeId = member.store.id;
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.inventory_locations set active = true
      where store_id = ${storeId}::uuid and id = ${id}::uuid and not active
      returning id
    `);
    if (!row) return { ok: false, problem: "This location is not in this store, or it is already active." };
  } catch (error) {
    if (isUnique(error)) return { ok: false, problem: `${SAME_NAME} Rename one of them first.` };
    throw error;
  }
  const impact = (await locationImpact(db(), storeId, id)) ?? { units: 0, variants: 0, committedUnits: 0, owedUnits: 0 };
  await audit(member.account.id, storeId, "products.location_reactivated", { units: impact.units, variants: impact.variants }, { area: "products", target: { type: "inventory_location", id } }).catch((error) =>
    console.error("[inventory] the reactivation could not be logged", error),
  );
  refreshTag(catalogTag(storeId));
  return { ok: true, impact };
}
