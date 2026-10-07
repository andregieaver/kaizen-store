/**
 * The pick list (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3): what to take off the shelves for the selected orders, summed by product (one row
 * per variant) or listed by order. Only what is still to send counts (`unitsToSend()`: digital and service lines, units already in parcels and units withdrawn
 * before sending are left out). Pure; `pickListData()` on the server reads the orders of one store and hands them here. A staff document: English, no
 * prices, no names or addresses (by order: the order number only). It changes nothing.
 */
import { unitsToSend, type FulfilmentLine } from "./fulfilment";
import { PICK_LIST_MAX } from "./fulfilment-limits";

export const PICK_BY = ["product", "order"] as const;
export type PickBy = (typeof PICK_BY)[number];
export const PICK_SORTS = ["sku", "title", "quantity"] as const;
export type PickSort = (typeof PICK_SORTS)[number];

/** A line of an order as the pick list reads it. */
export type PickInputLine = FulfilmentLine & {
  variantId: string | null;
  sku: string;
  /** The line's title as sold (the product and its options). */
  title: string;
};

/** An order asked for: found in the store (with its lines), or not (another store's, or no such order). */
export type PickInputOrder =
  | { id: string; found: false }
  | {
      id: string;
      found: true;
      number: string;
      copied: boolean;
      /** Paid (not waiting for payment, not cancelled or closed). */
      paid: boolean;
      /** A change waits for the customer's payment: the order is unchanged until it is paid, so it is picked as it is, with a warning. */
      editPending: boolean;
      lines: PickInputLine[];
    };

export const PICK_SKIPS = ["not_found", "copied", "unpaid", "nothing_to_send"] as const;
export type PickSkipReason = (typeof PICK_SKIPS)[number];

export const PICK_SKIP_WORDS: Record<PickSkipReason, string> = {
  not_found: "Not found",
  copied: "A copied order (history, never sent)",
  unpaid: "Not paid",
  nothing_to_send: "Nothing left to send",
};
export const PICK_WARNING_WORDS = { edit_pending: "A change waits for the customer's payment: picked as the order stands now" } as const;

export type PickProductRow = { variantId: string | null; sku: string; title: string; units: number; orders: number };
export type PickOrderRow = { orderId: string; number: string; units: number; lines: { lineId: string; sku: string; title: string; units: number }[] };

export type PickList = {
  by: PickBy;
  sort: PickSort;
  products: PickProductRow[];
  orders: PickOrderRow[];
  skipped: { orderId: string; number: string | null; reason: PickSkipReason }[];
  warnings: { orderId: string; number: string; reason: keyof typeof PICK_WARNING_WORDS }[];
  /** Units to pick in all, and the orders that have some. */
  totalUnits: number;
  orderCount: number;
};

const compareText = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

/** The pick list of the given orders, in the order asked for (duplicates once). Rows are by variant (a line with no variant by its SKU and title). */
export function pickList(orders: readonly PickInputOrder[], options: { by?: PickBy; sort?: PickSort } = {}): PickList {
  const by = options.by ?? "product";
  const sort = options.sort ?? "sku";
  const seen = new Set<string>();
  const skipped: PickList["skipped"] = [];
  const warnings: PickList["warnings"] = [];
  const orderRows: PickOrderRow[] = [];
  const products = new Map<string, PickProductRow & { orderIds: Set<string> }>();

  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    if (!order.found) {
      skipped.push({ orderId: order.id, number: null, reason: "not_found" });
      continue;
    }
    if (order.copied) {
      skipped.push({ orderId: order.id, number: order.number, reason: "copied" });
      continue;
    }
    if (!order.paid) {
      skipped.push({ orderId: order.id, number: order.number, reason: "unpaid" });
      continue;
    }
    const lines = order.lines.map((l) => ({ line: l, units: unitsToSend(l) })).filter((x) => x.units > 0);
    if (lines.length === 0) {
      skipped.push({ orderId: order.id, number: order.number, reason: "nothing_to_send" });
      continue;
    }
    if (order.editPending) warnings.push({ orderId: order.id, number: order.number, reason: "edit_pending" });
    orderRows.push({
      orderId: order.id,
      number: order.number,
      units: lines.reduce((s, x) => s + x.units, 0),
      lines: lines.map(({ line, units }) => ({ lineId: line.lineId, sku: line.sku, title: line.title, units })).sort((a, b) => compareText(a.title, b.title) || compareText(a.sku, b.sku)),
    });
    for (const { line, units } of lines) {
      const key = line.variantId ?? `${line.sku}\u0000${line.title}`;
      const row = products.get(key) ?? { variantId: line.variantId, sku: line.sku, title: line.title, units: 0, orders: 0, orderIds: new Set<string>() };
      row.units += units;
      row.orderIds.add(order.id);
      row.orders = row.orderIds.size;
      products.set(key, row);
    }
  }

  const productRows: PickProductRow[] = [...products.values()].map((row) => ({ variantId: row.variantId, sku: row.sku, title: row.title, units: row.units, orders: row.orders }));
  productRows.sort((a, b) => {
    if (sort === "quantity") return b.units - a.units || compareText(a.sku, b.sku) || compareText(a.title, b.title);
    if (sort === "title") return compareText(a.title, b.title) || compareText(a.sku, b.sku);
    return compareText(a.sku, b.sku) || compareText(a.title, b.title);
  });
  orderRows.sort((a, b) => (sort === "quantity" ? b.units - a.units : 0) || compareText(a.number, b.number));
  return {
    by,
    sort,
    products: productRows,
    orders: orderRows,
    skipped,
    warnings,
    totalUnits: orderRows.reduce((s, o) => s + o.units, 0),
    orderCount: orderRows.length,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The address's `ids` (comma-separated order ids, as the list's bulk bar sends them), `by` and `sort`, read defensively: unknown values fall back to the
 * defaults, ids that are not ids are dropped, duplicates go, and more than `PICK_LIST_MAX` is refused (Shopify's Order Printer prints 50; Kaizen 100).
 */
export function parsePickParams(params: { ids?: string | null; by?: string | null; sort?: string | null }):
  | { ok: true; ids: string[]; by: PickBy; sort: PickSort }
  | { ok: false; problem: "none" | "too_many" } {
  const ids = [...new Set((params.ids ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s)))];
  const by = (PICK_BY as readonly string[]).includes(params.by ?? "") ? (params.by as PickBy) : "product";
  const sort = (PICK_SORTS as readonly string[]).includes(params.sort ?? "") ? (params.sort as PickSort) : "sku";
  if (ids.length === 0) return { ok: false, problem: "none" };
  if (ids.length > PICK_LIST_MAX) return { ok: false, problem: "too_many" };
  return { ok: true, ids, by, sort };
}
