"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { staffActor } from "@/server/order-actor";
import { checkPermission, NO_ACCESS } from "@/server/permissions";
import { bookReturnLabel } from "@/server/return-labels";

/**
 * *Book a return label* on a return's page (wave 3, D239, `docs/wave-3-exchanges.md` 2.3, 4.7): `orders:write`, the store slug and the return's id bound first by the
 * page. The weight is the one staff typed in grams (empty: the estimate from the returned goods). The server checks everything again, books with the carrier, keeps
 * the booking on the return, writes `return.label_booked` to the audit log and emails the customer; a refusal by the carrier changes nothing on the return, and pasting a
 * label address still works.
 */
export async function bookReturnLabelAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!z.uuid().safeParse(returnId).success) return { status: "error", messages: ["This return no longer exists."] };
  const typed = String(form.get("weightGrams") ?? "").trim();
  if (typed !== "" && !/^\d{1,6}$/.test(typed)) return { status: "error", messages: ["The weight is a whole number of grams."] };
  const booked = await bookReturnLabel(member.store.id, returnId, { weightGrams: typed === "" ? null : Number(typed) }, staffActor(member.account.id));
  if (!booked.ok) return { status: "error", messages: [booked.message] };
  refresh();
  const test = booked.test ? " It is a test label: the carrier's test environment cannot be used to send anything." : "";
  const mail = booked.emailed === "failed" ? " The email to the customer could not be sent; they see the label on their status page." : " The customer has been emailed it.";
  return { status: "ok", messages: [`Booked: tracking number ${booked.trackingNumber}.${test}${mail}`] };
}
