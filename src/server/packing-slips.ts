import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { giftOfRow, NO_GIFT, type GiftFields } from "@/lib/gift";
import { BULK_PRINT_MAX, slipSkip, type BulkRefusal, type BulkRequestProblem } from "@/lib/order-bulk";

import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * What a packing slip prints, for one order or many (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.5). The slip has NO prices, no VAT, no totals and no payment, discount or invoice words
 * (D27): this data holds none, so no page built from it can print one. It is the order's number and date, the deliver-to address, the physical lines with quantity and SKU, and, for a
 * gift, the buyer's own words (`gift`: To, From and the message, drawn as text with `white-space: pre-line`, never as HTML). Each slip is in the ORDER's language. Copied history (D129) and
 * orders with nothing physical to ship are left out, with the reason; so are ids that are not this store's (no more than `not_found`). It changes no state.
 */

export type PackingSlip = {
  orderId: string;
  number: string;
  placedAt: string;
  /** The order's locale (`nb-NO`) and its language (`nb`): the words of the slip. */
  locale: string;
  lang: string;
  shipTo: { name: string | null; line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };
  lines: { quantity: number; title: string; sku: string }[];
  /** The buyer's gift (D173), null when the order is not one. */
  gift: GiftFields | null;
};

export type PackingSlipSet =
  | { ok: true; slips: PackingSlip[]; skipped: BulkRefusal[] }
  | { ok: false; problem: Extract<BulkRequestProblem, "empty" | "too_many"> };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The slips of up to 100 orders, in the order asked, and why any order is not among them. */
export async function packingSlipData(storeId: string, ids: readonly string[]): Promise<PackingSlipSet> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return { ok: false, problem: "empty" };
  if (unique.length > BULK_PRINT_MAX) return { ok: false, problem: "too_many" };
  const valid = unique.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)).map((id) => id.toLowerCase());
  const orders = valid.length
    ? await db().execute<Row>(sql`
        select o.id, o.number, o.placed_at, o.locale, o.shipping_address, o.copied_from is not null as copied, o.is_gift, o.gift_to, o.gift_from, o.gift_message,
          exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as physical
        from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${uuidList(valid)})
      `)
    : [];
  const lines = valid.length
    ? await db().execute<Row>(sql`
        select l.order_id, l.quantity, l.title, l.sku from commerce.order_lines l
        where l.store_id = ${storeId}::uuid and l.order_id = any(${uuidList(valid)}) and l.delivery = 'physical'
        order by l.order_id, l.title, l.sku
      `)
    : [];
  const byId = new Map(orders.map((o) => [String(o.id), o]));
  const slips: PackingSlip[] = [];
  const skipped: BulkRefusal[] = [];
  for (const id of unique) {
    const order = byId.get(id.toLowerCase());
    if (!order) {
      skipped.push({ id, number: null, reason: "not_found" });
      continue;
    }
    const skip = slipSkip({ copied: Boolean(order.copied), physical: Boolean(order.physical) });
    if (skip) {
      skipped.push({ id: String(order.id), number: String(order.number), reason: skip });
      continue;
    }
    const a = (order.shipping_address ?? {}) as Record<string, unknown>;
    const gift = giftOfRow(order);
    slips.push({
      orderId: String(order.id),
      number: String(order.number),
      placedAt: new Date(String(order.placed_at)).toISOString(),
      locale: String(order.locale),
      lang: String(order.locale).split("-")[0] || "en",
      shipTo: { name: text(a.name), line1: text(a.line1), line2: text(a.line2), postalCode: text(a.postalCode), city: text(a.city), country: text(a.country) },
      lines: lines.filter((l) => String(l.order_id) === String(order.id)).map((l) => ({ quantity: Number(l.quantity), title: String(l.title), sku: String(l.sku) })),
      gift: gift === NO_GIFT ? null : gift,
    });
  }
  return { ok: true, slips, skipped };
}
