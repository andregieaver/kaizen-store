"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { CAPTURE_PROBLEM_WORDS } from "@/lib/capture";
import { parsePrice } from "@/lib/product-input";
import { capturePayment, voidAuthorization } from "@/server/payment-capture";
import { getOrder } from "@/server/orders";
import { requirePermission } from "@/server/permissions";
import { sendCancelled } from "@/server/shopper-emails";

import type { OrderActionState } from "./actions";

const done = (message: string): OrderActionState => ({ ok: true, message });
const failed = (message: string): OrderActionState => ({ ok: false, message });

async function orderFor(storeSlug: string, orderId: string) {
  const member = await requirePermission(storeSlug, "orders:write");
  if (!z.uuid().safeParse(orderId).success) return null;
  const order = await getOrder(member.store.id, orderId);
  return order ? { member, order } : null;
}

/**
 * Charges a held card (wave 4 unit B, D289): the whole hold, or the amount typed (the rest is released and credited). `orders:write`; the server checks
 * the amount against what is held again (`capturePayment()`), and a second press finds nothing held.
 */
export async function captureOrderAction(storeSlug: string, orderId: string, _previous: OrderActionState, form: FormData): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const typed = String(form.get("amount") ?? "").trim();
  const amountMinor = typed === "" ? null : parsePrice(typed, found.order.currency);
  if (typed !== "" && amountMinor === null) return failed(`"${typed}" is not an amount in ${found.order.currency}.`);
  const outcome = await capturePayment(found.member.store.id, orderId, { amountMinor, accountId: found.member.account.id });
  refresh();
  if (!outcome.ok) return failed(CAPTURE_PROBLEM_WORDS[outcome.problem]);
  return done(outcome.releasedMinor > 0 ? "Captured. The rest of the hold was released." : "Captured.");
}

/** Lets the held card go and cancels the order (D289): nothing is charged and its items are no longer held. The customer is told when ticked. */
export async function releaseCardAction(storeSlug: string, orderId: string, _previous: OrderActionState, form: FormData): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const outcome = await voidAuthorization(found.member.store.id, orderId, found.member.account.id);
  refresh();
  if (!outcome.ok) return failed(CAPTURE_PROBLEM_WORDS[outcome.problem]);
  if (form.get("notify") === "on") await sendCancelled(found.member.store.id, orderId, 0, { unpaid: true });
  return done("The hold is released and the order is cancelled.");
}
