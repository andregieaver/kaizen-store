/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the fixture reads them as such */
/**
 * Changes of an order written the way `applyOrderEdit()` writes them (wave 3, run 3, D174), for the database's tests (`fulfilment.test.ts`,
 * `invoice-parity.test.ts`): priced by the same pure function (`priceOrderEdit()`), written in one transaction under the edit context, with the refund or
 * payment of the difference and the change's documents. Nothing here is used by the application.
 */
import type { PGlite } from "@electric-sql/pglite";

import { vatIncluded } from "@/lib/checkout";
import { editBase, priceOrderEdit, type EditAddInput, type EditOrderFacts, type EditShippingInput, type EditTaxBasket, type SoldLine } from "@/lib/order-edit";
import type { OrderEditReason } from "@/lib/order-edit-status";

export type Tx = Pick<PGlite, "query">;
export type EditContext = { db: PGlite; account: string };

let counter = 0;
const next = () => (counter += 1);

/**
 * One transaction, begun and committed by hand: PGlite's own `transaction()` does not return when a deferred trigger refuses at commit, and the rules of a
 * change are checked there. A failure rolls everything back and is thrown.
 */
export async function transaction(db: PGlite, fn: (tx: Tx) => Promise<void>): Promise<void> {
  await db.exec("begin");
  try {
    await fn(db);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => undefined);
    throw error;
  }
}

/** The order as the pure pricing reads it. */
export async function factsOf(db: Tx, orderId: string): Promise<EditOrderFacts> {
  const o = (await db.query<any>("select * from commerce.orders where id = $1", [orderId])).rows[0];
  const lines = (await db.query<any>("select * from commerce.order_lines where order_id = $1 order by ctid", [orderId])).rows;
  return {
    currency: o.currency,
    subtotalMinor: Number(o.subtotal_minor),
    shippingMinor: Number(o.shipping_minor),
    discountMinor: Number(o.discount_minor),
    taxMinor: Number(o.tax_minor),
    totalMinor: Number(o.total_minor),
    memberDiscountMinor: Number(o.member_discount_minor),
    campaignDiscountMinor: Number(o.campaign_discount_minor),
    creditMinor: Number(o.credit_minor),
    referralDiscountMinor: Number(o.referral_discount_minor),
    staffDiscountMinor: Number(o.staff_discount_minor),
    vatReliefMinor: Number(o.vat_relief_minor),
    shippingTaxRate: o.shipping_tax_rate === null ? null : Number(o.shipping_tax_rate),
    lines: lines.map(
      (l): SoldLine => ({
        lineId: l.id,
        variantId: l.variant_id,
        sku: l.sku,
        title: l.title,
        quantity: l.quantity,
        unitPriceMinor: Number(l.unit_price_minor),
        totalMinor: Number(l.total_minor),
        taxMinor: Number(l.tax_minor),
        taxRate: Number(l.tax_rate),
        discountMinor: Number(l.discount_minor),
        parts: {
          member: Number(l.member_discount_minor),
          campaign: Number(l.campaign_discount_minor),
          bonus: Number(l.bonus_discount_minor),
          referral: Number(l.referral_discount_minor),
          staff: Number(l.staff_discount_minor),
          relief: Number(l.vat_relief_minor),
        },
        backorderQuantity: l.backorder_quantity,
        backorderDays: l.backorder_days,
        goods: l.variant_id !== null && l.delivery === "physical",
        physical: l.delivery === "physical",
        gift: l.gift,
      }),
    ),
  };
}

/** decideTax() for a standard order: the VAT in each line and the shipping. */
export const tax = (basket: EditTaxBasket) => ({
  taxMinor: 0,
  reliefMinor: 0,
  shippingRate: 0.25,
  decision: { kind: "standard", reverseCharge: false },
  result: {
    lines: basket.lines.map((l) => ({ key: l.key, rate: l.rate, totalMinor: l.totalMinor, taxMinor: vatIncluded(l.totalMinor, l.rate), reliefMinor: 0 })),
    shipping: { rate: 0.25, totalMinor: basket.shippingMinor, taxMinor: vatIncluded(basket.shippingMinor, 0.25), reliefMinor: 0 },
    taxMinor: 0,
    reliefMinor: 0,
  },
});

export async function newVariant(db: Tx, s: string, policy: "deny" | "continue" = "deny"): Promise<string> {
  const k = next();
  const product = (await db.query<{ id: string }>("insert into commerce.products (store_id, handle, tax_code, vat_category) values ($1, $2, 'txcd_99999999', 'standard') returning id", [s, `ful-p-${k}`])).rows[0].id;
  return (await db.query<{ id: string }>("insert into commerce.product_variants (store_id, product_id, sku, stock_policy, backorder_days) values ($1, $2, $3, $4, $5) returning id", [
    s,
    product,
    `FUL-${k}`,
    policy,
    policy === "continue" ? 10 : null,
  ])).rows[0].id;
}

export type EditOptions = {
  quantities?: Record<string, number>;
  added?: (Omit<EditAddInput, "key" | "sku" | "title" | "listPriceMinor" | "rate"> & { rate?: number })[];
  shipping?: EditShippingInput;
  reason?: OrderEditReason;
  /** Write it waiting for payment (a higher total): the order is unchanged, the added units held. */
  awaiting?: { holds?: { variantId: string; locationId: string; quantity: number }[] };
  /** How a higher total is paid when applied at once: recorded outside Kaizen (the default) or a Stripe payment. */
  payWith?: "manual" | "stripe";
  draw?: boolean;
  documents?: boolean;
};

export const tokenHash = () => `${"a".repeat(30)}${String(next()).padStart(13, "0")}`;

/** Writes the change's order lines and totals (the applying half of `applyOrderEdit()`), inside the edit context. */
export async function writeChange(tx: Tx, s: string, orderId: string, editId: string, priced: ReturnType<typeof priceOrderEdit>) {
  for (const r of priced.reduced) {
    await tx.query(
      `update commerce.order_lines set quantity = $2, total_minor = $3, tax_minor = $4, discount_minor = $5, member_discount_minor = $6, campaign_discount_minor = $7,
         bonus_discount_minor = $8, referral_discount_minor = $9, staff_discount_minor = $10, backorder_quantity = $11 where id = $1`,
      [r.lineId, r.after.quantity, r.after.totalMinor, r.after.taxMinor, r.after.discountMinor, r.after.parts.member, r.after.parts.campaign, r.after.parts.bonus, r.after.parts.referral, r.after.parts.staff, r.after.backorderQuantity],
    );
  }
  for (const l of priced.removed) await tx.query("delete from commerce.order_lines where id = $1", [l.lineId]);
  for (const a of priced.added) {
    const lineId = (
      await tx.query<{ id: string }>(
        `insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery, list_price_minor, order_edit_id)
         values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, 'txcd_99999999', 'physical', $11, $12) returning id`,
        [s, orderId, a.variantId, a.sku, a.title, a.quantity, a.unitPriceMinor, a.totalMinor, a.taxMinor, a.rate, a.listPriceMinor, editId],
      )
    ).rows[0].id;
    const n = priced.lines.find((l) => l.kind === "add" && l.key === a.key)!.n;
    await tx.query("update commerce.order_edit_lines set order_line_id = $3 where order_edit_id = $1 and n = $2", [editId, n, lineId]);
  }
  const t = priced.after;
  await tx.query(
    `update commerce.orders set subtotal_minor = $2, shipping_minor = $3, discount_minor = $4, member_discount_minor = $5, campaign_discount_minor = $6, credit_minor = $7,
       referral_discount_minor = $8, staff_discount_minor = $9::bigint, staff_discount_label = case when $9::bigint = 0 then null else staff_discount_label end, tax_minor = $10, total_minor = $11, edited_at = now()
     where id = $1`,
    [orderId, t.subtotalMinor, t.shippingMinor, t.discountMinor, t.memberDiscountMinor, t.campaignDiscountMinor, t.creditMinor, t.referralDiscountMinor, t.staffDiscountMinor, t.taxMinor, t.totalMinor],
  );
}

/** A change of an order, priced by `priceOrderEdit()` and written as `applyOrderEdit()` writes it. Returns the change's id and the pricing. */
export async function edit(ctx: EditContext, s: string, orderId: string, o: EditOptions = {}) {
  const { db, account } = ctx;
  const facts = await factsOf(db, orderId);
  const added = (o.added ?? []).map((a, i) => ({ ...a, key: `k${i}`, sku: `ADD-${i}`, title: `Added ${i}`, listPriceMinor: a.unitPriceMinor, rate: a.rate ?? 0.25 }));
  const priced = priceOrderEdit({ order: facts, quantities: o.quantities ?? {}, added, shipping: o.shipping ?? { kind: "keep" }, reason: o.reason ?? "customer_request" }, tax);
  if (!priced.ok) throw new Error(`not priced: ${JSON.stringify(priced.problems)}`);
  const awaiting = o.awaiting !== undefined;
  if (awaiting && priced.differenceMinor <= 0) throw new Error("a change waits for payment only with a higher total");
  let editId = "";
  await transaction(db, async (tx) => {
    await tx.query("select set_config('kaizen.order_edit', $1, true)", [orderId]);
    editId = (
      await tx.query<{ id: string }>(
        `insert into commerce.order_edits (store_id, order_id, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta, shipping_before,
           shipping_after, discount_delta, tax_delta, difference_minor, made_by, pay_token_hash, expires_at)
         values ($1, $2, $3, $4, true, true, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
        [
          s, orderId, awaiting ? "awaiting_payment" : "applied", o.reason ?? "customer_request", facts.currency, JSON.stringify(editBase(facts)), priced.before.totalMinor,
          priced.after.totalMinor, priced.subtotalDelta, priced.before.shippingMinor, priced.after.shippingMinor, priced.discountDelta, priced.taxDelta, priced.differenceMinor,
          account, awaiting ? tokenHash() : null, awaiting ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
        ],
      )
    ).rows[0].id;
    for (const l of priced.lines) {
      await tx.query(
        `insert into commerce.order_edit_lines (store_id, order_edit_id, n, kind, order_line_id, variant_id, sku, title, quantity, unit_price_minor, list_price_minor, total_minor,
           discount_minor, tax_minor, tax_rate, parts, before)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)`,
        [s, editId, l.n, l.kind, l.orderLineId, l.variantId, l.sku, l.title, l.quantity, l.unitPriceMinor, l.listPriceMinor, l.totalMinor, l.discountMinor, l.taxMinor, l.taxRate,
          JSON.stringify(l.parts), l.before ? JSON.stringify(l.before) : null],
      );
    }
    if (awaiting) {
      for (const h of o.awaiting?.holds ?? []) {
        await tx.query(
          "insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, order_id, order_edit_id, expires_at) values ($1, $2, $3, $4, $5, $6, now() + interval '7 days')",
          [s, h.variantId, h.locationId, h.quantity, orderId, editId],
        );
      }
      return;
    }
    await writeChange(tx, s, orderId, editId, priced);
    await settleMoney(tx, s, orderId, editId, priced.differenceMinor, o.payWith ?? "manual", account);
    if (o.draw) await tx.query("select commerce.draw_edit_stock($1)", [editId]);
    if (o.documents !== false) await tx.query("select commerce.issue_edit_documents($1, $2)", [s, editId]);
  });
  return { editId, priced };
}

/** The money of an applied change: a refund of the order's payment for a lower total, a payment of the difference for a higher one. */
export async function settleMoney(tx: Tx, s: string, orderId: string, editId: string, difference: number, payWith: "manual" | "stripe", account: string) {
  if (difference < 0) {
    const payment = (await tx.query<{ id: string }>("select id from commerce.payments where order_id = $1 and order_edit_id is null order by created_at limit 1", [orderId])).rows[0].id;
    const refund = (
      await tx.query<{ id: string }>(
        "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, order_edit_id) values ($1, $2, $3, 'Order change', $4, 'succeeded', $5) returning id",
        [s, payment, -difference, `re_edit_${next()}`, editId],
      )
    ).rows[0].id;
    await tx.query("update commerce.order_edits set refund_id = $2 where id = $1", [editId, refund]);
  } else if (difference > 0) {
    const manual = payWith === "manual";
    const payment = (
      await tx.query<{ id: string }>(
        `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by, order_edit_id)
         select $1, $2, $3, $4, $5, o.currency, 'captured', $6, $7, $8 from commerce.orders o where o.id = $2 returning id`,
        [s, orderId, manual ? "manual" : "stripe", `${manual ? "manual" : "cs"}_edit_${next()}`, difference, manual ? "cash" : null, manual ? account : null, editId],
      )
    ).rows[0].id;
    await tx.query("update commerce.order_edits set payment_id = $2 where id = $1", [editId, payment]);
  }
}

