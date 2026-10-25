import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { exchangeProblemText, type ExchangeProblem } from "@/lib/exchange";
import { formatMoney } from "@/lib/money";

import type { Account } from "./auth";
import { orderDeliveryAddress } from "./exchange-admin";
import { openExchangeOf, previewExchange, processExchange, proposeExchange, type ExchangePreview } from "./exchanges";
import { staffActor } from "./order-actor";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's exchanges (PSI AGT-01; D239, `docs/wave-3-exchanges.md`): a return's credit offered for replacements, through the
 * exchange builder's own functions (`previewExchange()`, `proposeExchange()`, `processExchange()`). Replacements are at their list price
 * as the order's market shows it (a lower price is the builder's, by a person), sent to the order's delivery address, and the proposal is
 * emailed to the order's own address only, never a link (`send`). Processing a confirmed exchange makes the new order and moves the money
 * (`spend`). Both on the owner's yes, both checked first.
 */

type Ctx = { account: Account; store: Store };
type Row = Record<string, unknown>;

export type ProposeInput = { return: string; replacements: { sku: string; quantity: number }[]; shipping: "free" | "standard" };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const problemWords = (problems: ExchangeProblem[]) => [...new Set(problems.map((p) => exchangeProblemText(p.code)))].join(" ");

/** A return by its number (1042-R1), its id, or its order's number when the order has one. */
async function returnOf(store: Store, ref: string): Promise<{ id: string; number: string; orderId: string }> {
  const clean = ref.trim().replace(/^#/, "");
  const byId = /^[0-9a-f-]{36}$/i.test(clean);
  const rows = await db().execute<Row>(sql`
    select r.id, r.number, r.order_id from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${store.id}::uuid and ${byId ? sql`r.id = ${clean}::uuid` : sql`(upper(r.number) = upper(${clean}) or o.number = ${clean})`}
    order by r.created_at limit 6
  `);
  if (rows.length === 0) return fail(`No return ${ref} in this store. list_returns shows the queue.`);
  if (rows.length > 1) return fail(`Order ${clean} has several returns: ${rows.map((r) => String(r.number)).join(", ")}. Name one by its number.`);
  return { id: String(rows[0].id), number: String(rows[0].number), orderId: String(rows[0].order_id) };
}

const money = (ctx: Ctx, minor: number, currency: string) => formatMoney(minor, currency, ctx.store.markets[0]?.locale ?? "en");

/** The builder's input: replacements by SKU at their list price as shown, the order's delivery address. */
async function builderOf(ctx: Ctx, input: ProposeInput) {
  const ret = await returnOf(ctx.store, input.return);
  const lines: { variantId: string; quantity: number; unitPriceMinor: number }[] = [];
  for (const r of input.replacements) {
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${ctx.store.id}::uuid and lower(sku) = lower(${r.sku.trim()}) limit 1`);
    if (!variant) return fail(`No product variant with SKU ${r.sku}. Look with list_products.`);
    lines.push({ variantId: String(variant.id), quantity: r.quantity, unitPriceMinor: 0 });
  }
  const address = await orderDeliveryAddress(ctx.store.id, ret.orderId);
  if (!address.name || !address.street || !address.postalCode || !address.city) return fail("The order has no full delivery address: build this exchange on the return's page.");
  const raw = (prices: number[]) => ({
    lines: lines.map((l, i) => ({ ...l, unitPriceMinor: prices[i] ?? 0 })),
    shipping: { kind: input.shipping },
    deliveryAddress: { name: address.name, street: address.street, postalCode: address.postalCode, city: address.city, country: address.country, phone: address.phone || null },
  });
  // The list prices as the order's market shows them come from the builder's own preview; nothing is priced here.
  const first = await previewExchange(ctx.store.id, ret.id, raw([]));
  if (!("lines" in first)) return fail(first.message);
  if (first.block) return fail(exchangeProblemText(first.block));
  const prices = first.lines.map((l, i) => l.listPriceMinor ?? fail(`${l.title || input.replacements[i]?.sku} is not for sale in the order's country.`));
  const preview = await previewExchange(ctx.store.id, ret.id, raw(prices));
  if (!("lines" in preview)) return fail(preview.message);
  return { ret, raw: raw(prices), preview };
}

function outcomeWords(ctx: Ctx, p: ExchangePreview): string {
  const o = p.outcome;
  if (!o) return "";
  if (o.kind === "refund_due") return `${money(ctx, o.refundMinor, p.currency)} of the credit goes back to the customer.`;
  if (o.kind === "to_pay") return `The customer pays ${money(ctx, o.toPayMinor, p.currency)} more.`;
  return "The credit covers it exactly.";
}

/** `preview_exchange`: the credit, the replacements priced, and who pays what. Read only. */
export async function previewExchangeTool(ctx: Ctx, input: ProposeInput) {
  const { ret, preview } = await builderOf(ctx, input);
  return {
    return: ret.number,
    can_be_proposed: preview.ok,
    problems: preview.problems.length ? problemWords(preview.problems) : null,
    credit: preview.credit ? money(ctx, preview.credit.amountMinor, preview.currency) : null,
    replacements: preview.lines.map((l) => ({ title: l.title, quantity: l.quantity, price: money(ctx, l.unitPriceMinor, preview.currency), stock: l.stock.state.replace("_", " ") })),
    total: money(ctx, preview.totalMinor, preview.currency),
    outcome: outcomeWords(ctx, preview),
    note: "Nothing is sent. propose_exchange emails it to the customer on the owner's yes.",
  };
}

export async function preflightProposeExchange(ctx: Ctx, input: ProposeInput): Promise<void> {
  const { preview } = await builderOf(ctx, input);
  if (!preview.ok) fail(problemWords(preview.problems) || "This return cannot be exchanged so.");
}

export async function proposeApprovalSummary(ctx: Ctx, input: ProposeInput): Promise<string | null> {
  try {
    const { ret, preview } = await builderOf(ctx, input);
    const goods = preview.lines.map((l) => `${l.quantity} × ${l.title}`).join(", ");
    return `Email the customer of return ${ret.number} an exchange: ${goods} for ${money(ctx, preview.totalMinor, preview.currency)} against a credit of ${preview.credit ? money(ctx, preview.credit.amountMinor, preview.currency) : "the refund"}. ${outcomeWords(ctx, preview)}`;
  } catch {
    return null;
  }
}

/** `propose_exchange`: the proposal frozen as previewed and emailed to the order's own address; the customer confirms it on their page. */
export async function proposeExchangeTool(ctx: Ctx, input: ProposeInput) {
  const { ret, raw } = await builderOf(ctx, input);
  const done = await proposeExchange(ctx.store.id, staffActor(ctx.account.id), ret.id, raw);
  if (!done.ok) return fail(done.problems?.length ? problemWords(done.problems) : done.message);
  const emailed = done.emailed === "sent" || done.emailed === "logged" || done.emailed === "duplicate";
  return {
    done: emailed
      ? `The exchange for return ${ret.number} is emailed to the customer; it waits for their confirmation, and then for process_exchange.`
      : `The exchange for return ${ret.number} is kept, but the email could not be sent: resend it from the return's page.`,
    link: `/admin/${ctx.store.slug}/returns/${ret.id}`,
  };
}

/** The return's exchange the customer confirmed, or a refusal saying where it stands. */
async function confirmedOf(ctx: Ctx, ref: string) {
  const ret = await returnOf(ctx.store, ref);
  const exchange = await openExchangeOf(ctx.store.id, ret.id);
  if (!exchange) return fail(`Return ${ret.number} has no exchange: propose one first.`);
  if (exchange.status === "proposed") return fail(`The customer has not confirmed the exchange for return ${ret.number} yet.`);
  if (exchange.status !== "confirmed" && exchange.status !== "processed") return fail(`The exchange for return ${ret.number} is ${exchange.status}.`);
  return { ret, exchange };
}

export async function preflightProcessExchange(ctx: Ctx, { return: ref }: { return: string }): Promise<void> {
  await confirmedOf(ctx, ref);
}

/** `process_exchange`: the new order made and the money moved as the return's page does it. */
export async function processExchangeTool(ctx: Ctx, { return: ref }: { return: string }) {
  const { ret, exchange } = await confirmedOf(ctx, ref);
  const done = await processExchange(ctx.store.id, staffActor(ctx.account.id), exchange.id);
  if (!done.ok) return fail(done.problems?.length ? problemWords(done.problems) : done.message);
  const state =
    done.state === "settled"
      ? "settled: the credit pays for it, and any rest goes back to the customer"
      : done.state === "waiting"
        ? "made, and the customer is emailed a link to pay the difference"
        : `made, but the refund did not go through: ${done.message ?? "try again from the return's page"}`;
  return { done: `Exchange order ${done.orderNumber} for return ${ret.number} is ${state}.`, link: `/admin/${ctx.store.slug}/orders/${done.orderId}` };
}
