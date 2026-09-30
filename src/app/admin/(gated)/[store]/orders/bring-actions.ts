"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMember } from "@/server/auth";
import { bringBook, bringOptionsFor, type BringOptions } from "@/server/bring-shipping";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { sendShipped } from "@/server/shopper-emails";

export type BringBookState = { ok: boolean; message: string };

async function orderFor(storeSlug: string, orderId: string) {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(orderId).success) return null;
  const order = await getOrder(member.store.id, orderId);
  return order ? { member, order } : null;
}

/** The Bring services and pickup points for this parcel and this order's recipient (D134). */
export async function bringOptionsAction(storeSlug: string, orderId: string, parcel: unknown): Promise<BringOptions> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return { ok: false, problem: "This order no longer exists." };
  if (found.order.copied) return { ok: false, problem: COPIED_ORDER_MESSAGE };
  return bringOptionsFor(found.member.store.id, orderId, parcel);
}

const bookInput = z.object({
  serviceId: z.string().trim().min(1).max(20),
  pickupPointId: z.string().trim().max(60).optional(),
  notify: z.boolean(),
  parcel: z.unknown(),
});

/** Books the chosen service: a real booking marks the order as sent (and tells the customer when asked), a test one only says it worked. */
export async function bringBookAction(storeSlug: string, orderId: string, raw: unknown): Promise<BringBookState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return { ok: false, message: "This order no longer exists." };
  if (found.order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: "Choose a service." };
  const booked = await bringBook(found.member.account.id, found.member.store.id, orderId, input.data);
  if (!booked.ok) return { ok: false, message: booked.problem };
  if (booked.test) {
    return { ok: true, message: `Test booking made (${booked.trackingNumber}). Bring shipped nothing, and the order is not marked as sent. Switch the carrier to live when you are ready.` };
  }
  if (input.data.notify) await sendShipped(found.member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: `Booked with Bring (${booked.shipment.trackingNumber}) and marked as sent${input.data.notify ? ", and the customer has been told" : ""}. Print the label below.` };
}
