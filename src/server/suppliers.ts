import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  DROP_SHIP_SUPPLIERS_MAX,
  SUPPLIER_PRIORITY_BASE,
  shipsFromOutsideEu,
  supplierInput,
  supplierLocationName,
  type OrderMethod,
} from "@/lib/drop-shipping";
import type { DocumentLanguage } from "@/lib/invoice-text";
import { variantLabel } from "@/lib/product-input";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { setStockContext } from "./stock-context";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Drop shipping (D550, `docs/drop-shipping.md` 3, step 1): suppliers that send the store's goods to its customers. A supplier is a row of
 * `commerce.suppliers` (the same row its bills are booked on, D492) with `drop_ships` on, and one stock location of its own
 * (`inventory_locations.supplier_id`), ranked after every own location so online orders take the store's own stock first. A variant the
 * supplier sends names it (`product_variants.supplier_id`). This module is the only writer of those columns.
 *
 * Staff who may change products add, edit and mark (`products:write`); stopping a supplier takes its goods off sale, so it is the OWNER's.
 */

export type DropShipSupplier = {
  id: string;
  name: string;
  orderEmail: string;
  shipsFrom: string;
  outsideEu: boolean;
  orderLanguage: DocumentLanguage;
  dispatchDays: number;
  orderMethod: OrderMethod;
  returnAddress: string;
  orderNote: string;
  locationId: string | null;
  /** Variants marked as sent by this supplier, and the units its location says it has of them. */
  variants: number;
  units: number;
};

const supplierRow = z.object({
  id: col.uuid,
  name: col.text,
  order_email: col.text,
  ships_from: col.text,
  order_language: z.enum(["nb", "sv", "da", "en"]),
  dispatch_days: col.int,
  order_method: z.enum(["email", "connected", "file"]),
  return_address: col.text,
  order_note: col.text,
  location_id: col.textOrNull,
  variants: col.int,
  units: col.int,
});

const toSupplier = (r: z.output<typeof supplierRow>): DropShipSupplier => ({
  id: r.id,
  name: r.name,
  orderEmail: r.order_email,
  shipsFrom: r.ships_from.trim(),
  outsideEu: shipsFromOutsideEu(r.ships_from.trim()),
  orderLanguage: r.order_language,
  dispatchDays: r.dispatch_days,
  orderMethod: r.order_method,
  returnAddress: r.return_address,
  orderNote: r.order_note,
  locationId: r.location_id,
  variants: r.variants,
  units: r.units,
});

const SUPPLIER_SELECT = (storeId: string) => sql`
  select s.id, s.name, s.order_email, s.ships_from, s.order_language, s.dispatch_days, s.order_method, s.return_address, s.order_note,
         loc.id::text as location_id,
         (select count(*)::int from commerce.product_variants v where v.store_id = s.store_id and v.supplier_id = s.id) as variants,
         coalesce((select sum(greatest(l.on_hand, 0))::int from commerce.inventory_levels l where l.store_id = s.store_id and l.location_id = loc.id), 0) as units
  from commerce.suppliers s
  left join commerce.inventory_locations loc on loc.store_id = s.store_id and loc.supplier_id = s.id
  where s.store_id = ${storeId}::uuid and s.drop_ships
`;

/** The store's drop-shipping suppliers, by name. */
export async function listDropShipSuppliers(storeId: string): Promise<DropShipSupplier[]> {
  const rows = await typedRows(supplierRow, sql`${SUPPLIER_SELECT(storeId)} order by lower(s.name), s.id`);
  return rows.map(toSupplier);
}

/** One drop-shipping supplier of the store, or null. */
export async function getDropShipSupplier(storeId: string, id: string): Promise<DropShipSupplier | null> {
  if (!UUID.test(id)) return null;
  const row = await typedRow(supplierRow, sql`${SUPPLIER_SELECT(storeId)} and s.id = ${id}::uuid`);
  return row ? toSupplier(row) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupplierResult = { ok: true; id: string } | { ok: false; problem: string };

const errorText = (error: unknown): string =>
  JSON.stringify({ m: (error as Error)?.message, c: (error as { cause?: { message?: string } })?.cause?.message, code: (error as { code?: string })?.code, cc: (error as { cause?: { code?: string } })?.cause?.code });

/**
 * Adds a drop-shipping supplier (no `id`) or changes one. A new one whose name is a supplier the store already books bills from becomes that
 * supplier (one business, one row). Its location is made with it, named after it, in the country it ships from, ranked after the store's own
 * places; a change of name or country follows to the location. `products:write`.
 */
export async function saveDropShipSupplier(member: Membership, raw: unknown, id: string | null = null): Promise<SupplierResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = supplierInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the supplier's details." };
  const input = parsed.data;
  const name = input.name.replace(/\s+/g, " ");
  const storeId = member.store.id;
  if (id !== null && !UUID.test(id)) return { ok: false, problem: "This supplier is not in this store." };
  try {
    const result = await db().transaction(async (tx): Promise<SupplierResult> => {
      // The store's row first, so two adds cannot both pass the count.
      await tx.execute(sql`select id from commerce.stores where id = ${storeId}::uuid for no key update`);
      let supplierId: string;
      if (id) {
        const updated = await typedRow(
          z.object({ id: col.uuid }),
          sql`update commerce.suppliers set name = ${name}, order_email = ${input.orderEmail}, ships_from = ${input.shipsFrom},
                order_language = ${input.orderLanguage}, dispatch_days = ${input.dispatchDays}, order_method = ${input.orderMethod},
                return_address = ${input.returnAddress}, order_note = ${input.orderNote}, updated_at = now()
              where store_id = ${storeId}::uuid and id = ${id}::uuid and drop_ships
              returning id`,
          tx,
        );
        if (!updated) return { ok: false, problem: "This supplier is not in this store." };
        supplierId = updated.id;
      } else {
        const counted = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.suppliers where store_id = ${storeId}::uuid and drop_ships`, tx);
        if ((counted?.n ?? 0) >= DROP_SHIP_SUPPLIERS_MAX) return { ok: false, problem: `A store has at most ${DROP_SHIP_SUPPLIERS_MAX} drop-shipping suppliers.` };
        const existing = await typedRow(
          z.object({ id: col.uuid, drop_ships: col.bool }),
          sql`select id, drop_ships from commerce.suppliers where store_id = ${storeId}::uuid and lower(name) = lower(${name})`,
          tx,
        );
        if (existing?.drop_ships) return { ok: false, problem: "A drop-shipping supplier already has this name." };
        const saved = await typedRow(
          z.object({ id: col.uuid }),
          existing
            ? sql`update commerce.suppliers set drop_ships = true, order_email = ${input.orderEmail}, ships_from = ${input.shipsFrom},
                    order_language = ${input.orderLanguage}, dispatch_days = ${input.dispatchDays}, order_method = ${input.orderMethod},
                    return_address = ${input.returnAddress}, order_note = ${input.orderNote}, updated_at = now()
                  where store_id = ${storeId}::uuid and id = ${existing.id}::uuid returning id`
            : sql`insert into commerce.suppliers (store_id, name, drop_ships, order_email, ships_from, order_language, dispatch_days, order_method, return_address, order_note)
                  values (${storeId}::uuid, ${name}, true, ${input.orderEmail}, ${input.shipsFrom}, ${input.orderLanguage}, ${input.dispatchDays},
                          ${input.orderMethod}, ${input.returnAddress}, ${input.orderNote})
                  returning id`,
          tx,
        );
        if (!saved) return { ok: false, problem: "This supplier could not be saved." };
        supplierId = saved.id;
      }
      // Its location: made once, then kept in step with the supplier's name and country, and active while it drop-ships.
      const location = await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.inventory_locations set name = ${supplierLocationName(name)}, country = ${input.shipsFrom}, active = true, fulfils_online = true
            where store_id = ${storeId}::uuid and supplier_id = ${supplierId}::uuid returning id`,
        tx,
      );
      if (!location) {
        const top = await typedRow(
          z.object({ top: col.int }),
          sql`select coalesce(max(priority), ${SUPPLIER_PRIORITY_BASE})::int as top from commerce.inventory_locations where store_id = ${storeId}::uuid and supplier_id is not null`,
          tx,
        );
        await tx.execute(sql`
          insert into commerce.inventory_locations (store_id, name, country, priority, fulfils_online, supplier_id)
          values (${storeId}::uuid, ${supplierLocationName(name)}, ${input.shipsFrom}, ${(top?.top ?? SUPPLIER_PRIORITY_BASE) + 1}, true, ${supplierId}::uuid)
        `);
      }
      return { ok: true, id: supplierId };
    });
    if (result.ok) {
      await audit(member.account.id, storeId, "products.supplier_saved", { added: id === null, shipsFrom: input.shipsFrom, method: input.orderMethod }, { area: "products", target: { type: "supplier", id: result.id } }).catch(
        (error) => log("error", "suppliers.save_audit_failed", {}, error),
      );
      refreshTag(catalogTag(storeId));
    }
    return result;
  } catch (error) {
    const said = errorText(error);
    if (said.includes("23505")) {
      return said.includes("inventory_locations") ? { ok: false, problem: "One of your own stock locations already has this name. Rename it or the supplier." } : { ok: false, problem: "A supplier already has this name." };
    }
    throw error;
  }
}

/**
 * Stops a supplier drop-shipping: its variants go back to the store (sent from the store's own stock from now on) and its location closes, so
 * what it said it had is no longer for sale. The supplier row stays (its bills and, later, its orders name it). OWNER only. Refused while a
 * checkout in progress holds stock at its location, as closing any location is.
 */
export async function stopDropShipping(member: Membership, id: string): Promise<{ ok: true; variants: number } | { ok: false; problem: string }> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  if (!UUID.test(id)) return { ok: false, problem: "This supplier is not in this store." };
  const storeId = member.store.id;
  let variants = 0;
  try {
    const found = await db().transaction(async (tx) => {
      const supplier = await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.suppliers set drop_ships = false, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid and drop_ships returning id`,
        tx,
      );
      if (!supplier) return false;
      const freed = await tx.execute(sql`update commerce.product_variants set supplier_id = null where store_id = ${storeId}::uuid and supplier_id = ${id}::uuid returning id`);
      variants = freed.length;
      await tx.execute(sql`update commerce.inventory_locations set active = false where store_id = ${storeId}::uuid and supplier_id = ${id}::uuid and active`);
      return true;
    });
    if (!found) return { ok: false, problem: "This supplier is not in this store, or it has already stopped." };
  } catch (error) {
    if (errorText(error).includes("location.held")) return { ok: false, problem: "Checkouts in progress hold this supplier's stock; try again in a few minutes." };
    throw error;
  }
  await audit(member.account.id, storeId, "products.supplier_stopped", { variants }, { area: "products", target: { type: "supplier", id } }).catch((error) => log("error", "suppliers.stop_audit_failed", {}, error));
  refreshTag(catalogTag(storeId));
  return { ok: true, variants };
}

export type SupplierVariant = { id: string; productId: string; product: string; title: string; sku: string | null; supplierId: string | null; onHand: number };

const variantRow = z.object({ id: col.uuid, product_id: col.uuid, product: col.text, options: z.record(z.string(), z.unknown()).nullable(), sku: col.textOrNull, supplier_id: col.textOrNull, on_hand: col.int });

/**
 * The variants a supplier can be given: physical goods, the supplier's own first, then by product. `search` narrows by product name or SKU.
 * With the supplier's units at its location (`onHand`), for its own.
 */
export async function supplierVariants(storeId: string, supplierId: string, search = "", limit = 200): Promise<SupplierVariant[]> {
  if (!UUID.test(supplierId)) return [];
  const like = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await typedRows(
    variantRow,
    sql`select v.id, p.id as product_id, coalesce(pt.title, p.handle) as product, v.options, v.sku,
               v.supplier_id::text as supplier_id,
               coalesce((select l.on_hand from commerce.inventory_levels l
                          join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.supplier_id = ${supplierId}::uuid
                         where l.store_id = v.store_id and l.variant_id = v.id), 0)::int as on_hand
        from commerce.product_variants v
        join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
        left join lateral (
          select t.title from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1
        ) pt on true
        where v.store_id = ${storeId}::uuid and v.delivery = 'physical' and p.kind = 'goods' and p.status <> 'archived'
          and (${search.trim()} = '' or pt.title ilike ${like} or v.sku ilike ${like} or p.handle ilike ${like})
        order by (v.supplier_id is not distinct from ${supplierId}::uuid) desc, lower(coalesce(pt.title, p.handle)), v.sku, v.id
        limit ${Math.min(Math.max(limit, 1), 500)}`,
  );
  return rows.map((r) => ({ id: r.id, productId: r.product_id, product: r.product, title: r.options && Object.keys(r.options).length > 0 ? variantLabel(Object.fromEntries(Object.entries(r.options).map(([k, v]) => [k, String(v)]))) : "", sku: r.sku, supplierId: r.supplier_id, onHand: r.on_hand }));
}

/**
 * Marks variants as sent by a supplier (`supplierId`) or takes them back to the store (`null`, only those that are the given supplier's). Only
 * physical goods of the store; a variant another supplier sends moves to this one. A variant marked gets a level at the supplier's location
 * (0 until the supplier's stock is set), so it shows on the stock pages. `products:write`.
 */
export async function setVariantsSupplier(
  member: Membership,
  supplierId: string,
  variantIds: readonly string[],
  on: boolean,
): Promise<{ ok: true; changed: number } | { ok: false; problem: string }> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  const ids = [...new Set(variantIds)].filter((v) => UUID.test(v)).sort();
  if (!UUID.test(supplierId)) return { ok: false, problem: "This supplier is not in this store." };
  if (ids.length === 0) return { ok: false, problem: "Choose at least one variant." };
  if (ids.length > 500) return { ok: false, problem: "Mark at most 500 variants at a time." };
  const storeId = member.store.id;
  const list = sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `);
  const changed = await db().transaction(async (tx) => {
    const supplier = await typedRow(
      z.object({ location_id: col.textOrNull }),
      sql`select loc.id::text as location_id from commerce.suppliers s
          left join commerce.inventory_locations loc on loc.store_id = s.store_id and loc.supplier_id = s.id
          where s.store_id = ${storeId}::uuid and s.id = ${supplierId}::uuid and s.drop_ships for update of s`,
      tx,
    );
    if (!supplier?.location_id) return null;
    if (!on) {
      const rows = await tx.execute(sql`
        update commerce.product_variants set supplier_id = null
        where store_id = ${storeId}::uuid and supplier_id = ${supplierId}::uuid and id in (${list}) returning id
      `);
      return rows.length;
    }
    const rows = await tx.execute(sql`
      update commerce.product_variants v set supplier_id = ${supplierId}::uuid
      from commerce.products p
      where v.store_id = ${storeId}::uuid and v.id in (${list}) and p.store_id = v.store_id and p.id = v.product_id
        and v.delivery = 'physical' and p.kind = 'goods' and v.supplier_id is distinct from ${supplierId}::uuid
      returning v.id
    `);
    if (rows.length > 0) {
      // A level of 0 at the supplier's location, recorded as an opening by the person who marked it.
      await setStockContext(tx, { reason: "opening", source: "editor", accountId: member.account.id, note: "Marked as sent by a supplier" });
      await tx.execute(sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        select ${storeId}::uuid, r.id, ${supplier.location_id}::uuid, 0
        from unnest(array[${sql.join(rows.map((r) => sql`${String(r.id)}::uuid`), sql`, `)}]) as r(id)
        order by r.id
        on conflict (variant_id, location_id) do nothing
      `);
    }
    return rows.length;
  });
  if (changed === null) return { ok: false, problem: "This supplier is not in this store." };
  if (changed > 0) {
    await audit(member.account.id, storeId, on ? "products.supplier_variants_marked" : "products.supplier_variants_unmarked", { variants: changed }, { area: "products", target: { type: "supplier", id: supplierId } }).catch(
      (error) => log("error", "suppliers.mark_audit_failed", {}, error),
    );
    refreshTag(catalogTag(storeId));
  }
  return { ok: true, changed };
}
