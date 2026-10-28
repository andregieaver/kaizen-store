"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parcelLinesInput } from "@/lib/parcel-input";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { orderEn } from "@/lib/admin-messages/order.en";
import { requirePermission } from "@/server/permissions";
import { bringBook, bringOptionsFor, type BringOptions } from "@/server/bring-shipping";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { sendShipped } from "@/server/shopper-emails";

export type BringBookState = { ok: boolean; message: string };

async function orderFor(storeSlug: string, orderId: string) {
  const member = await requirePermission(storeSlug, "orders:write");
  if (!z.uuid().safeParse(orderId).success) return null;
  const order = await getOrder(member.store.id, orderId);
  return order ? { member, order, w: wordsOf(member) } : null;
}

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;


/** The Bring services and pickup points for this parcel and this order's recipient (D134). */
export async function bringOptionsAction(storeSlug: string, orderId: string, parcel: unknown): Promise<BringOptions> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return { ok: false, problem: orderEn.messages.gone };
  if (found.order.copied) return { ok: false, problem: COPIED_ORDER_MESSAGE };
  return bringOptionsFor(found.member.store.id, orderId, parcel);
}

const bookInput = z.object({
  serviceId: z.string().trim().min(1).max(20),
  pickupPointId: z.string().trim().max(60).optional(),
  notify: z.boolean(),
  parcel: z.unknown(),
  /** What goes in this parcel (D174); none = everything still to send. */
  lines: parcelLinesInput,
  /** The order's fulfilment as the page showed it (D372): a press made before it showed the last parcel is refused. */
  seen: z.string().max(100).nullish(),
});

/** Books the chosen service: a real booking marks the order as sent (and tells the customer when asked), a test one only says it worked. */
export async function bringBookAction(storeSlug: string, orderId: string, raw: unknown): Promise<BringBookState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return { ok: false, message: orderEn.messages.gone };
  const { w } = found;
  if (found.order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: input.error.issues.some((i) => i.path[0] === "lines") ? w.lineNotWhole : w.chooseService };
  const booked = await bringBook(found.member.account.id, found.member.store.id, orderId, input.data);
  if (!booked.ok) return { ok: false, message: booked.problem };
  if (booked.test) {
    return { ok: true, message: fillWords(w.bringTest, { tracking: booked.trackingNumber }) };
  }
  if (input.data.notify) await sendShipped(found.member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: fillWords(w.booked, { carrier: "Bring", tracking: booked.shipment.trackingNumber ?? "", told: input.data.notify ? w.andTold : "" }) };
}
