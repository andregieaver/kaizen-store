import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { REPLACEMENT_PHASES, replacementLines, type ReplacementLine } from "@/lib/replacements";

import { audit } from "./auth";
import { writeOrderEvent } from "./order-actor";
import { allocateStock, insertOrder, insertOrderLine, reserveStock } from "./order-insert";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A replacement for a lost or returned parcel (B3, D679, `docs/100-day-challenge.md` B3): when the carrier's tracking says a parcel is in trouble
 * (`problem`) or on its way back (`returned_to_sender`), the goods it held are sent again as a new order of their own at 0 (`orders.source =
 * 'replacement'`, `replaces_order_id` the order it replaces), at most once per order (`orders_replacement_live_key`). The order is made through
 * `insertOrder()`, its stock allocated and held as a checkout's is, and paid at once by `commerce.complete_order_payment()`, which draws the stock;
 * a total of 0 has no invoice (`invoice_eligibility()`: `zero_total`) and no VAT. No payment is captured, so it is no sale in the analytics (`PAID`):
 * Finance counts its goods at cost and its parcels as a cost of their own (`replacementsMinor`), and the lost order's profit shows them.
 */

const ORDER_ROW = z.object({
  id: col.uuid,
  number: col.text,
  status: col.text,
  source: col.text,
  market_code: col.text,
  currency: col.currency,
  locale: col.text,
  email: col.text,
  customer_id: col.textOrNull,
  billing_address: z.record(z.string(), z.unknown()).nullable(),
  shipping_address: z.record(z.string(), z.unknown()).nullable(),
  company_name: col.textOrNull,
  organisation_number: col.textOrNull,
  delivery_method: col.text,
  copied_from: col.textOrNull,
});

const LOST_ROW = z.object({
  order_line_id: col.uuid,
  variant_id: col.textOrNull,
  sku: col.text,
  title: col.text,
  quantity: col.int,
  line_quantity: col.int,
  unit_price_minor: col.minor,
  line_total_minor: col.minor,
  tax_rate: col.decimal,
  tax_code: col.text,
  withdrawal_exclusion: col.text,
  unit_cost_minor: col.minorOrNull,
  measure_amount: col.textOrNull,
  measure_unit: col.textOrNull,
  measure_base: col.textOrNull,
  list_price_minor: col.minorOrNull,
  stock_policy: col.textOrNull,
  shipment_id: col.uuid,
  phase: col.text,
});

const MADE_ROW = z.object({ id: col.uuid, number: col.text });

export type ReplacementPlan = {
  orderId: string;
  number: string;
  currency: string;
  lines: ReplacementLine[];
  /** What the customer paid for the goods sent again, with VAT, in the order's currency: what the challenge's cap is measured against. */
  valueMinor: number;
  /** The goods at their cost price, when every one has one. */
  costMinor: number | null;
  /** The parcels in trouble and what their tracking says. */
  parcels: { shipment: string; phase: string }[];
  /** The replacement already sent for it, if one is. */
  replacement: { id: string; number: string } | null;
};

export type ReplacementRefusal = "not_found" | "not_paid" | "copied" | "no_trouble" | "nothing_to_send";

/** The order by its id or number, with the goods of its parcels the tracking says are lost or coming back. */
export async function replacementPlan(storeId: string, ref: string): Promise<ReplacementPlan | { refused: ReplacementRefusal }> {
  const clean = ref.trim().replace(/^#/, "");
  const byId = z.uuid().safeParse(clean).success;
  const order = await typedRow(
    ORDER_ROW,
    sql`
      select o.id, o.number, o.status::text as status, o.source, o.market_code, o.currency, o.locale, o.email, o.customer_id::text as customer_id,
        o.billing_address, o.shipping_address, o.company_name, o.organisation_number, o.delivery_method, o.copied_from::text as copied_from
      from commerce.orders o where o.store_id = ${storeId}::uuid and ${byId ? sql`o.id = ${clean}::uuid` : sql`o.number = ${clean}`}
    `,
  );
  if (!order) return { refused: "not_found" };
  if (order.copied_from) return { refused: "copied" };
  if (!["paid", "fulfilled", "closed"].includes(order.status)) return { refused: "not_paid" };
  const rows = await lostLines(storeId, order.id);
  const parcels = [...new Map(rows.map((r) => [r.shipment_id, { shipment: r.shipment_id, phase: r.phase }])).values()];
  if (parcels.length === 0) return { refused: "no_trouble" };
  const lines = replacementLines(
    rows.map((r) => ({
      orderLineId: r.order_line_id,
      variantId: r.variant_id,
      sku: r.sku,
      title: r.title,
      quantity: r.quantity,
      lineQuantity: r.line_quantity,
      unitPriceMinor: r.unit_price_minor,
      lineTotalMinor: r.line_total_minor,
      taxRate: r.tax_rate,
      taxCode: r.tax_code,
      withdrawalExclusion: r.withdrawal_exclusion,
      unitCostMinor: r.unit_cost_minor,
      measure: r.measure_amount && r.measure_unit && r.measure_base ? { amount: r.measure_amount, unit: r.measure_unit, base: r.measure_base } : null,
      listPriceMinor: r.list_price_minor,
      policy: r.stock_policy === "continue" ? "continue" : "deny",
    })),
  );
  if (lines.length === 0) return { refused: "nothing_to_send" };
  const made = await typedRow(
    MADE_ROW,
    sql`select id, number from commerce.orders where store_id = ${storeId}::uuid and replaces_order_id = ${order.id}::uuid and status::text <> 'cancelled'`,
  );
  const costKnown = lines.every((l) => l.unitCostMinor !== null);
  return {
    orderId: order.id,
    number: order.number,
    currency: order.currency,
    lines,
    valueMinor: lines.reduce((s, l) => s + l.valueMinor, 0),
    costMinor: costKnown ? lines.reduce((s, l) => s + (l.unitCostMinor ?? 0) * l.quantity, 0) : null,
    parcels,
    replacement: made ? { id: made.id, number: made.number } : null,
  };
}

/** The goods lines in the order's parcels whose last tracking is lost or on the way back (not undone), with what the variant costs now. */
async function lostLines(storeId: string, orderId: string) {
  return typedRows(
    LOST_ROW,
    sql`
      select sl.order_line_id, ol.variant_id::text as variant_id, ol.sku, ol.title, sl.quantity, ol.quantity as line_quantity, ol.unit_price_minor,
        ol.total_minor as line_total_minor, ol.tax_rate, ol.tax_code, ol.withdrawal_exclusion::text as withdrawal_exclusion,
        coalesce(v.cost_minor, ol.unit_cost_minor) as unit_cost_minor,
        ol.measure_amount::text as measure_amount, ol.measure_unit, ol.measure_base, ol.list_price_minor, v.stock_policy,
        sh.id as shipment_id, t.phase
      from commerce.shipments sh
      join commerce.shipment_tracking t on t.store_id = sh.store_id and t.shipment_id = sh.id
      join commerce.shipment_lines sl on sl.store_id = sh.store_id and sl.shipment_id = sh.id
      join commerce.order_lines ol on ol.store_id = sl.store_id and ol.id = sl.order_line_id
      left join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid and sh.undone_at is null
        and t.phase = any(${`{${REPLACEMENT_PHASES.join(",")}}`}::text[])
      order by sh.created_at, ol.id
    `,
  );
}

export type SendResult =
  | { ok: true; orderId: string; number: string; replaces: string }
  | { ok: false; reason: ReplacementRefusal | "already" | "stock_short"; replacement?: { id: string; number: string } };

/**
 * Sends the goods of the order's lost or returned parcels again (B3, D679): in one transaction under the order's lock, the replacement is made at 0
 * (every line's price taken off in full), its stock allocated and held, then paid, which draws it; the two orders' histories name each other. A second
 * one while the first is not cancelled is `already` (the database's unique index holds that too). `accountId` is the staff member, or the owner the
 * autopilot acts for.
 */
export async function sendReplacement(storeId: string, accountId: string, ref: string): Promise<SendResult> {
  const plan = await replacementPlan(storeId, ref);
  if ("refused" in plan) return { ok: false, reason: plan.refused };
  if (plan.replacement) return { ok: false, reason: "already", replacement: plan.replacement };
  const made = await db().transaction(async (tx) => {
    const original = await typedRow(
      ORDER_ROW,
      sql`
        select o.id, o.number, o.status::text as status, o.source, o.market_code, o.currency, o.locale, o.email, o.customer_id::text as customer_id,
          o.billing_address, o.shipping_address, o.company_name, o.organisation_number, o.delivery_method, o.copied_from::text as copied_from
        from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${plan.orderId}::uuid for update
      `,
      tx,
    );
    if (!original) return { ok: false as const, reason: "not_found" as const };
    const again = await typedRow(
      MADE_ROW,
      sql`select id, number from commerce.orders where store_id = ${storeId}::uuid and replaces_order_id = ${plan.orderId}::uuid and status::text <> 'cancelled'`,
      tx,
    );
    if (again) return { ok: false as const, reason: "already" as const, replacement: again };
    const keeps = [...new Set(plan.lines.filter((l) => l.policy === "continue").map((l) => l.variantId))];
    const stock = await allocateStock(
      tx,
      storeId,
      plan.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, policy: l.policy })),
      keeps,
      { country: typeof original.shipping_address?.country === "string" ? original.shipping_address.country : null },
    );
    if (!stock.ok) return { ok: false as const, reason: "stock_short" as const };
    const behind = new Map(stock.behind);
    const subtotal = plan.lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
    const { orderId, number } = await insertOrder(tx, {
      storeId,
      marketCode: original.market_code,
      currency: original.currency,
      locale: original.locale,
      email: original.email,
      subtotalMinor: subtotal,
      shippingMinor: 0,
      discountMinor: subtotal,
      taxMinor: 0,
      totalMinor: 0,
      billingAddress: original.billing_address ?? {},
      shippingAddress: original.shipping_address ?? {},
      customerId: original.customer_id,
      companyName: original.company_name,
      organisationNumber: original.organisation_number,
      replacement: { of: original.id, madeBy: accountId },
    });
    for (const l of plan.lines) {
      const left = behind.get(l.variantId) ?? 0;
      const backordered = Math.min(left, l.quantity);
      behind.set(l.variantId, left - backordered);
      await insertOrderLine(tx, storeId, orderId, {
        variantId: l.variantId,
        sku: l.sku,
        title: l.title,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.unitPriceMinor * l.quantity,
        totalMinor: 0,
        taxMinor: 0,
        taxRate: l.taxRate,
        taxCode: l.taxCode,
        withdrawalExclusion: l.withdrawalExclusion,
        delivery: "physical",
        unitCostMinor: l.unitCostMinor,
        measure: l.measure,
        backorderQuantity: backordered,
        listPriceMinor: l.listPriceMinor,
      });
    }
    await reserveStock(tx, storeId, orderId, stock.holds, { minutes: 10 });
    await writeOrderEvent(tx, storeId, orderId, "order.placed", { replaces: original.number, replacesId: original.id }, "staff");
    await tx.execute(sql`select commerce.complete_order_payment(${orderId}::uuid, ${`replacement:${original.id}`})`);
    await writeOrderEvent(
      tx,
      storeId,
      original.id,
      "order.replacement_sent",
      { order: number, orderId, parcels: plan.parcels.map((p) => p.shipment), valueMinor: plan.valueMinor, by: accountId },
      "staff",
    );
    return { ok: true as const, orderId, number, replaces: original.number };
  });
  if (made.ok) {
    await audit(accountId, storeId, "order.replacement_sent", { orderId: plan.orderId, replacementId: made.orderId, valueMinor: plan.valueMinor }, { target: { type: "order", id: plan.orderId } });
  }
  return made;
}
