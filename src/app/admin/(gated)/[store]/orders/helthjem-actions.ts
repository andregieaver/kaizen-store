"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { helthjemBook } from "@/server/helthjem-shipping";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { sendShipped } from "@/server/shopper-emails";

const bookInput = z.object({ notify: z.boolean(), parcel: z.unknown() });

/**
 * Books the delivery the customer chose with Helthjem (D138): a real booking marks the order as sent (and tells the
 * customer when asked), a test one only says it worked.
 */
export async function helthjemBookAction(storeSlug: string, orderId: string, raw: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: "This order no longer exists." };
  const order = await getOrder(member.store.id, orderId);
  if (!order) return { ok: false, message: "This order no longer exists." };
  if (order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: "Enter the parcel's weight." };
  const booked = await helthjemBook(member.account.id, member.store.id, orderId, input.data);
  if (!booked.ok) return { ok: false, message: booked.problem };
  if (booked.test) {
    return { ok: true, message: `Test booking made (${booked.trackingNumber}). Helthjem delivers nothing from its test environment, and the order is not marked as sent. Switch the carrier to live when you are ready.` };
  }
  if (input.data.notify) await sendShipped(member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: `Booked with Helthjem (${booked.shipment.trackingNumber}) and marked as sent${input.data.notify ? ", and the customer has been told" : ""}. Print the label below.` };
}
