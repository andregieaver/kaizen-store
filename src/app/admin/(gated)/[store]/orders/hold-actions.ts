"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { holdOrder, releaseHold } from "@/server/order-hold";
import { checkParcelNow } from "@/server/shipment-tracking";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;
/** Refused before a member is known: the session's language (D312). */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;

/**
 * Holding an order's fulfilment by hand and releasing a hold (wave 3, D238, `docs/wave-3-notifications.md` 2.6): `orders:write`. `holdOrder()` refuses a
 * copied order, an unpaid one, one sent in full and one already held; while held, nothing of it can be sent or handed over (the database refuses a
 * shipment). Each writes the order's event and the audit entry.
 */
export async function holdOrderAction(storeSlug: string, orderId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  if (!z.uuid().safeParse(orderId).success) return { status: "error", messages: [wordsOf(member).gone] };
  const result = await holdOrder(member.store.id, orderId, { reason: form.get("reason"), by: { account: member.account.id } });
  if (!result.ok) return { status: "error", messages: [result.message] };
  refresh();
  return { status: "ok", messages: [wordsOf(member).onHold] };
}

export async function releaseHoldAction(storeSlug: string, orderId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  if (!z.uuid().safeParse(orderId).success) return { status: "error", messages: [wordsOf(member).gone] };
  const result = await releaseHold(member.store.id, orderId, member.account.id);
  if (!result.ok) return { status: "error", messages: [result.message] };
  refresh();
  return { status: "ok", messages: [wordsOf(member).releasedHold] };
}

/**
 * *Check now* on a parcel (2.3): the same check the five-minute job makes, for this parcel at once, at most once a minute. `orders:read`, as the spec says
 * (4.10): it reads the carrier and keeps what it says, it changes nothing of the order a person decided.
 */
export async function checkParcelNowAction(storeSlug: string, orderId: string, shipmentId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:read");
  if (!member) return { status: "error", messages: [await noAccess()] };
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(shipmentId).success) return { status: "error", messages: [wordsOf(member).gone] };
  const result = await checkParcelNow(member.store.id, orderId, shipmentId);
  if (!result.ok) return { status: "error", messages: [result.message] };
  refresh();
  return { status: "ok", messages: [wordsOf(member).checked] };
}
