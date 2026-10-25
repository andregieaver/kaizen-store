import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import type { OrderEditReason } from "@/lib/order-edit-status";
import { parsePrice } from "@/lib/product-input";

import type { Account } from "./auth";
import { staffActor } from "./order-actor";
import { applyOrderEdit, previewOrderEdit, sendOrderEdit, type EditPreview, type EditProblem } from "./order-edits";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's order changes (PSI AGT-01; D174, `docs/wave-3-fulfilment.md`): a change previewed and made only through the order
 * editor's own functions (`previewOrderEdit()`, `applyOrderEdit()`, `sendOrderEdit()`), so a sold unit keeps its price, added goods are
 * priced as the cart prices them, and the documents follow. A lower total is refunded at once and a higher one asks the customer to pay
 * by a link emailed to the order's own address, both on the owner's yes (`spend`). The yes is for the order as it was shown: the order's
 * state is kept with the approval (`approved_base`) and the change refuses if the order moved since.
 */

type Ctx = { account: Account; store: Store };

export type OrderChangeInput = {
  order: string;
  change: { item: string; quantity: number }[];
  add: { sku: string; quantity: number }[];
  shipping?: string;
  reason: OrderEditReason;
  note?: string;
  notify: boolean;
  restock: boolean;
  approved_base?: unknown;
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

type Row = Record<string, unknown>;

const words = (problems: EditProblem[]) => [...new Set(problems.map((p) => p.text))].join(" ");

/** The order (not a copy) and its lines, by its number or id. */
async function orderOf(store: Store, ref: string) {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const [order] = await db().execute<Row>(sql`
    select id, number, trim(currency) as currency, locale, copied_from is not null as copied from commerce.orders
    where store_id = ${store.id}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`number = ${ref.replace(/^#/, "")}`}
  `);
  if (!order) return fail(`No order ${ref} in this store.`);
  if (order.copied) return fail(`Order ${ref} is history copied from another store, so it is read-only.`);
  const lines = await db().execute<Row>(sql`
    select id, sku, title, quantity from commerce.order_lines where store_id = ${store.id}::uuid and order_id = ${String(order.id)}::uuid order by id
  `);
  return { id: String(order.id), number: String(order.number), currency: String(order.currency), locale: String(order.locale ?? "en"), lines };
}

/** The editor's input from the owner's words: lines by SKU or title, added goods by SKU, a shipping price as written. */
async function rawOf(store: Store, input: OrderChangeInput) {
  const order = await orderOf(store, input.order);
  const quantities: Record<string, number> = {};
  for (const c of input.change) {
    const wanted = c.item.trim().toLowerCase();
    const found = order.lines.filter((l) => String(l.sku).toLowerCase() === wanted || String(l.title).toLowerCase() === wanted);
    if (found.length !== 1) {
      return fail(found.length > 1 ? `Several lines of order ${order.number} match "${c.item}": give the SKU.` : `Order ${order.number} has no line "${c.item}". Its lines: ${order.lines.map((l) => `${l.title} (${l.sku}, ${l.quantity})`).join("; ")}.`);
    }
    quantities[String(found[0].id)] = c.quantity;
  }
  const added: { variantId: string; quantity: number }[] = [];
  for (const a of input.add) {
    const [variant] = await db().execute<Row>(sql`
      select id from commerce.product_variants where store_id = ${store.id}::uuid and lower(sku) = lower(${a.sku.trim()}) limit 2
    `);
    if (!variant) return fail(`No product variant with SKU ${a.sku}. Look with list_products.`);
    added.push({ variantId: String(variant.id), quantity: a.quantity });
  }
  let shipping: { kind: "keep" } | { kind: "set"; amountMinor: number } = { kind: "keep" };
  if (input.shipping !== undefined) {
    const minor = parsePrice(input.shipping, order.currency);
    if (minor === null) return fail(`"${input.shipping}" is not a shipping price in ${order.currency}.`);
    shipping = { kind: "set", amountMinor: minor };
  }
  const raw = {
    quantities,
    added,
    shipping,
    reason: input.reason,
    ...(input.note ? { note: input.note } : {}),
    notify: input.notify,
    restock: input.restock,
    noRestock: [],
    ...(input.approved_base !== undefined ? { base: input.approved_base } : {}),
  };
  return { order, raw };
}

async function previewOf(ctx: Ctx, input: OrderChangeInput): Promise<{ preview: EditPreview; orderId: string; raw: Awaited<ReturnType<typeof rawOf>>["raw"] }> {
  const { order, raw } = await rawOf(ctx.store, input);
  if (Object.keys(raw.quantities).length === 0 && raw.added.length === 0 && raw.shipping.kind === "keep") return fail("Say what changes: a line's new quantity, goods to add, or the shipping price.");
  const preview = await previewOrderEdit(ctx.store.id, order.id, raw);
  if (!preview) return fail(`No order ${input.order} in this store.`);
  if (!("orderId" in preview)) return fail(words(preview.problems));
  return { preview, orderId: order.id, raw };
}

const amount = (ctx: Ctx, p: EditPreview) => formatMoney(Math.abs(p.differenceMinor), p.currency, ctx.store.markets[0]?.locale ?? "en");

function describe(ctx: Ctx, p: EditPreview) {
  return {
    order: p.number,
    can_be_made: p.ok,
    problems: p.problems.map((x) => x.text),
    money: p.money === "charge" ? `The customer pays ${amount(ctx, p)} more, by a link emailed to them.` : p.money === "refund" ? `${amount(ctx, p)} goes back to the customer.` : "No money moves.",
    in_detail: p.sentences.money,
    documents: p.sentences.documents,
    added: p.added.map((a) => ({ title: a.title, quantity: a.quantity, ...(a.backorder ? { on_backorder: a.backorder.units } : {}) })),
  };
}

/** `preview_order_change`: what a change would do (money, documents, problems), read only. */
export async function previewOrderChangeTool(ctx: Ctx, input: OrderChangeInput) {
  const { preview } = await previewOf(ctx, input);
  return { ...describe(ctx, preview), note: "Nothing is changed. change_order makes it, on the owner's yes." };
}

/** Checked before the owner is asked: a change the editor would refuse is refused now. */
export async function preflightChangeOrder(ctx: Ctx, input: OrderChangeInput): Promise<void> {
  const { preview } = await previewOf(ctx, input);
  if (!preview.ok) fail(words(preview.problems) || "The order cannot be changed so.");
}

/** What the owner is asked, and the order's state it describes (kept with the call as `approved_base`). */
export async function orderChangeApprovalDetails(ctx: Ctx, input: OrderChangeInput): Promise<{ summary: string; base: unknown } | null> {
  try {
    const { preview } = await previewOf(ctx, { ...input, approved_base: undefined });
    const parts = [
      ...input.change.map((c) => (c.quantity === 0 ? `take off ${c.item}` : `${c.item} down to ${c.quantity}`)),
      ...preview.added.map((a) => `add ${a.quantity} × ${a.title}`),
      ...(input.shipping !== undefined ? [`shipping ${input.shipping} ${preview.currency}`] : []),
    ];
    const money = preview.money === "charge" ? `email the customer a link to pay ${amount(ctx, preview)}` : preview.money === "refund" ? `refund ${amount(ctx, preview)}` : "no money moves";
    return { summary: `Change order ${preview.number}: ${parts.join(", ")}; ${money}.`, base: preview.base };
  } catch {
    return null;
  }
}

/** `change_order`: applied at once (a lower or equal total, refunded) or sent to the customer as a pay link (a higher total). */
export async function changeOrderTool(ctx: Ctx, input: OrderChangeInput) {
  const { preview, orderId, raw } = await previewOf(ctx, input);
  const actor = staffActor(ctx.account.id);
  if (preview.money === "charge") {
    const sent = await sendOrderEdit(ctx.store.id, orderId, raw, actor, { email: true });
    if (!sent.ok) return fail(words(sent.problems));
    return {
      done: `Change ${sent.label} waits for the customer to pay ${amount(ctx, preview)}: ${sent.emailed && sent.emailed !== "failed" ? "the link is emailed to them" : "the email could not be sent, so share the link from the order page"}. The order is unchanged until they pay.`,
      link: `/admin/${ctx.store.slug}/orders/${orderId}`,
    };
  }
  const applied = await applyOrderEdit(ctx.store.id, orderId, raw, actor);
  if (!applied.ok) return fail(words(applied.problems));
  return {
    done: `Change ${applied.label} is made${applied.money === "refund" ? `, and ${amount(ctx, preview)} goes back to the customer` : ""}${applied.emailed && applied.emailed !== "failed" ? "; the customer is told by email" : ""}.`,
    link: `/admin/${ctx.store.slug}/orders/${orderId}`,
  };
}
