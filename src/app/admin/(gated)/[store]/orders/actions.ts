"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parsePrice } from "@/lib/product-input";
import { requireMember } from "@/server/auth";
import { getOrder } from "@/server/orders";
import {
  addOrderNote,
  cancelOrder,
  CARRIERS,
  markSent,
  refundOrder,
  updateOrderContact,
} from "@/server/order-admin";
import { sendCancelled, sendOrderConfirmation, sendRefunded, sendShipped } from "@/server/shopper-emails";

export type OrderActionState = { ok: boolean; message: string | null };

const done = (message: string): OrderActionState => ({ ok: true, message });
const failed = (message: string): OrderActionState => ({ ok: false, message });

async function orderFor(storeSlug: string, orderId: string) {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(orderId).success) return null;
  const order = await getOrder(member.store.id, orderId);
  return order ? { member, order } : null;
}

/** Marks the order as sent, with the parcel's tracking, and tells the customer. */
export async function sendOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const input = z
    .object({
      carrier: z.enum(CARRIERS.map((c) => c.id) as [string, ...string[]]),
      trackingNumber: z.string().trim().max(100),
      trackingUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]),
      notify: z.boolean(),
    })
    .safeParse({
      carrier: form.get("carrier"),
      trackingNumber: form.get("trackingNumber") ?? "",
      trackingUrl: String(form.get("trackingUrl") ?? "").trim(),
      notify: form.get("notify") === "on",
    });
  if (!input.success) return failed("Check the tracking link: it must start with https://.");
  const shipment = await markSent(
    found.member.store.id,
    orderId,
    { ...input.data, trackingUrl: input.data.trackingUrl || null },
    found.member.account.id,
  );
  if (!shipment) return failed("Only paid orders can be sent.");
  if (input.data.notify) await sendShipped(found.member.store.id, orderId, shipment);
  refresh();
  return done(input.data.notify ? "Marked as sent, and the customer has been told." : "Marked as sent.");
}

/** Refunds an amount through Stripe and puts chosen items back in stock. */
export async function refundOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const typed = String(form.get("amount") ?? "").trim();
  const amountMinor = typed === "" ? 0 : parsePrice(typed, found.order.currency);
  if (amountMinor === null) return failed(`"${typed}" is not an amount in ${found.order.currency}.`);
  const restock = found.order.lines
    .map((line) => ({ lineId: line.id, quantity: Math.floor(Number(form.get(`restock:${line.id}`) ?? 0)) || 0 }))
    .filter((item) => item.quantity > 0);
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || "Refund";
  const outcome = await refundOrder(found.member.store.id, orderId, { amountMinor, reason, restock }, found.member.account.id);
  if (!outcome.ok) return failed(outcome.problem);
  if (amountMinor > 0 && form.get("notify") === "on") {
    await sendRefunded(found.member.store.id, orderId, outcome.refundId, amountMinor);
  }
  refresh();
  return done(amountMinor > 0 ? "Refunded." : "Put back in stock.");
}

/** Cancels an order that is paid but not sent: full refund, stock back, customer told. */
export async function cancelOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || "Cancelled by the store";
  const outcome = await cancelOrder(found.member.store.id, orderId, reason, found.member.account.id);
  if (!outcome.ok) return failed(outcome.problem);
  if (form.get("notify") === "on") await sendCancelled(found.member.store.id, orderId, outcome.amountMinor);
  refresh();
  return done("The order is cancelled.");
}

/** Corrects the customer's email or delivery address. */
export async function updateContactAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const field = (name: string, max = 200) => String(form.get(name) ?? "").trim().slice(0, max);
  const email = z.email().safeParse(field("email"));
  if (!email.success) return failed("Enter a valid email address.");
  const ok = await updateOrderContact(found.member.store.id, orderId, {
    email: email.data,
    shippingAddress: {
      name: field("name"),
      line1: field("line1"),
      line2: field("line2") || null,
      postalCode: field("postalCode", 20),
      city: field("city", 100),
      phone: field("phone", 40) || null,
    },
  });
  refresh();
  return ok ? done("Saved.") : failed("This order cannot be changed.");
}

/** A note for staff only; the customer never sees it. */
export async function addNoteAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000);
  if (!note) return failed("Write a note first.");
  await addOrderNote(found.member.store.id, orderId, note, found.member.account.email);
  refresh();
  return done("Note added.");
}

/** Sends the order confirmation again, e.g. when the customer could not find it. */
export async function resendConfirmationAction(storeSlug: string, orderId: string): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed("This order no longer exists.");
  const outcome = await sendOrderConfirmation(found.member.store.id, orderId, { resend: true });
  refresh();
  if (outcome === "sent") return done(`Sent to ${found.order.email}.`);
  if (outcome === "logged") return done("Recorded, but email is not set up yet, so it was not sent.");
  return failed("The confirmation could not be sent.");
}

