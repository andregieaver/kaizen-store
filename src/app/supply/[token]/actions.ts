"use server";

import { redirect } from "next/navigation";

import { postSupplierParcel, reportSupplierProblem } from "@/server/supplier-orders";

/**
 * A drop-shipping supplier's two answers on its page (D551): the parcel it sent, or why it cannot send. The token in the address is the only key;
 * each answer goes back to the page with what happened (`?done=` or `?problem=`), so the page works without a script.
 */

export async function postParcelAction(token: string, form: FormData) {
  const result = await postSupplierParcel(token, { carrier: form.get("carrier"), trackingNumber: form.get("tracking"), trackingUrl: form.get("trackingUrl") });
  redirect(`/supply/${encodeURIComponent(token)}?${result.ok ? "done=sent" : `problem=${result.problem}`}`);
}

export async function reportProblemAction(token: string, form: FormData) {
  const result = await reportSupplierProblem(token, form.get("reason"));
  redirect(`/supply/${encodeURIComponent(token)}?${result.ok ? "done=problem" : `problem=${result.problem}`}`);
}
