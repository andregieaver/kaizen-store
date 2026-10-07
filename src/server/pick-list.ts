import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { PICK_LIST_MAX } from "@/lib/fulfilment-limits";
import { pickList, type PickBy, type PickInputOrder, type PickList, type PickSort } from "@/lib/pick-list";

import { toSend } from "./fulfilment";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PickListData = { ok: true; list: PickList } | { ok: false; problem: "empty" | "too_many" };

/**
 * The pick list of up to 100 orders of one store (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3): each order's lines with what is still to send
 * (`toSend()`, the database's `line_to_send()`), handed to the pure `pickList()`. Ids that are not this store's orders are `not_found` and nothing of them is
 * read; copied orders and orders not paid are skipped with the reason; an order whose change waits for payment is picked as it stands, with a warning. No
 * amounts, names or addresses are read. It changes nothing.
 */
export async function pickListData(storeId: string, ids: readonly string[], options: { by?: PickBy; sort?: PickSort } = {}): Promise<PickListData> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return { ok: false, problem: "empty" };
  if (unique.length > PICK_LIST_MAX) return { ok: false, problem: "too_many" };
  const valid = [...new Set(unique.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  const heads = valid.length
    ? await db().execute<Row>(sql`
        select o.id, o.number, o.status, o.copied_from is not null as copied,
          exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment') as edit_pending
        from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(valid)})
      `)
    : [];
  const lines = await toSend(db(), storeId, heads.map((h) => String(h.id)));
  const byId = new Map(heads.map((h) => [String(h.id), h]));
  const input: PickInputOrder[] = unique.map((id) => {
    const head = byId.get(id.toLowerCase());
    if (!head) return { id, found: false };
    const orderId = String(head.id);
    return {
      id: orderId,
      found: true,
      number: String(head.number),
      copied: Boolean(head.copied),
      paid: ["paid", "fulfilled"].includes(String(head.status)),
      editPending: Boolean(head.edit_pending),
      lines: (lines.get(orderId) ?? []).map((l) => ({
        lineId: l.lineId,
        quantity: l.quantity,
        physical: l.physical,
        shipped: l.shipped,
        withdrawn: l.withdrawn,
        closed: l.closed,
        backordered: l.backordered,
        variantId: l.variantId,
        sku: l.sku,
        title: l.title,
      })),
    };
  });
  return { ok: true, list: pickList(input, options) };
}

/** "Everything to send" for the AI manager's `pick_list` (2.5): the ids of up to 100 paid orders of the store with units still to send, oldest first. */
export async function ordersToSend(storeId: string, limit = PICK_LIST_MAX): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select o.id from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.status = 'paid' and o.copied_from is null
      and exists (select 1 from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and commerce.line_to_send(ol.id) > 0)
    order by o.placed_at, o.id
    limit ${Math.max(1, Math.min(limit, PICK_LIST_MAX))}
  `);
  return rows.map((r) => String(r.id));
}
