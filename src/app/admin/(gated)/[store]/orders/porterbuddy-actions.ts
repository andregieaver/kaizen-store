"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parcelLinesInput } from "@/lib/parcel-input";

import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { porterbuddyBook } from "@/server/porterbuddy-shipping";
import { sendShipped } from "@/server/shopper-emails";

export type PorterbuddyBookState = { ok: boolean; message: string };

const bookInput = z.object({ notify: z.boolean(), parcel: z.unknown(), /** What goes in this parcel (D174); none = everything still to send. */ lines: parcelLinesInput });

/**
 * Books the window the customer chose with Porterbuddy (D137): a real booking marks the order as sent (and tells the
 * customer when asked), a test one only says it worked.
 */
export async function porterbuddyBookAction(storeSlug: string, orderId: string, raw: unknown): Promise<PorterbuddyBookState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: "This order no longer exists." };
  const order = await getOrder(member.store.id, orderId);
  if (!order) return { ok: false, message: "This order no longer exists." };
  if (order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: input.error.issues.some((i) => i.path[0] === "lines") ? "A number in the parcel is not a whole number of 0 or more." : "Enter the parcel's weight." };
  const booked = await porterbuddyBook(member.account.id, member.store.id, orderId, input.data);
  if (!booked.ok) return { ok: false, message: booked.problem };
  if (booked.test) {
    return { ok: true, message: `Test booking made (${booked.trackingNumber}). Porterbuddy delivers nothing in its test environment, and the order is not marked as sent. Switch the carrier to live when you are ready.` };
  }
  if (input.data.notify) await sendShipped(member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: `Booked with Porterbuddy (order ${booked.shipment.trackingNumber}) and marked as sent${input.data.notify ? ", and the customer has been told" : ""}. Print the label below.` };
}
