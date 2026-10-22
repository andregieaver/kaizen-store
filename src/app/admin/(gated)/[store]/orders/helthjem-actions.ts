"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parcelLinesInput } from "@/lib/parcel-input";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { checkPermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { helthjemBook } from "@/server/helthjem-shipping";
import { COPIED_ORDER_MESSAGE } from "@/server/order-admin";
import { getOrder } from "@/server/orders";
import { sendShipped } from "@/server/shopper-emails";

/** Refused before a member is known: the session's language (D312). */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;
const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;

const bookInput = z.object({ notify: z.boolean(), parcel: z.unknown(), /** What goes in this parcel (D174); none = everything still to send. */ lines: parcelLinesInput });

/**
 * Books the delivery the customer chose with Helthjem (D138): a real booking marks the order as sent (and tells the
 * customer when asked), a test one only says it worked.
 */
export async function helthjemBookAction(storeSlug: string, orderId: string, raw: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  if (!z.uuid().safeParse(orderId).success) return { ok: false, message: w.gone };
  const order = await getOrder(member.store.id, orderId);
  if (!order) return { ok: false, message: w.gone };
  if (order.copied) return { ok: false, message: COPIED_ORDER_MESSAGE };
  const input = bookInput.safeParse(raw);
  if (!input.success) return { ok: false, message: input.error.issues.some((i) => i.path[0] === "lines") ? w.lineNotWhole : w.enterWeight };
  const booked = await helthjemBook(member.account.id, member.store.id, orderId, input.data);
  if (!booked.ok) return { ok: false, message: booked.problem };
  if (booked.test) {
    return { ok: true, message: fillWords(w.helthjemTest, { tracking: booked.trackingNumber }) };
  }
  if (input.data.notify) await sendShipped(member.store.id, orderId, booked.shipment);
  refresh();
  return { ok: true, message: fillWords(w.booked, { carrier: "Helthjem", tracking: booked.shipment.trackingNumber ?? "", told: input.data.notify ? w.andTold : "" }) };
}
