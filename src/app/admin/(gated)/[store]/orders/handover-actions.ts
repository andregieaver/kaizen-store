"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { markOutForDelivery } from "@/server/local-delivery";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { markCollected, markReadyForPickup } from "@/server/pickup";

/**
 * The order page's buttons for a pickup or local-delivery order (D237, `docs/wave-3-shipping-methods.md` 2.2, 2.3): *Ready for pickup* (once, with
 * *Send the email again* only after a failed first), *Collected* (a handover and the receipt in one transaction) and *Out for delivery*. Each asks
 * `orders:write` itself; the server functions lock the order, refuse in words and pass D174's `seen` basis, so two people pressing at once get one
 * success and one *changed*. `haveStock` is staff confirming they have units sold on backorder (the order page only).
 */

const error = (message: string): FormState => ({ status: "error", messages: [message] });
const ok = (message: string): FormState => ({ status: "ok", messages: [message] });

const EMAIL_WORDS: Record<string, string> = {
  sent: "and the customer has been emailed.",
  logged: "but email is not set up yet, so the customer was not emailed.",
  duplicate: "and the email had been sent already.",
  suppressed: "but the customer's address does not take emails, so none was sent.",
  failed: "but the email could not be sent: try Send the email again.",
};

async function member(storeSlug: string, orderId: string) {
  const found = await checkPermission(storeSlug, "orders:write");
  if (!found || !z.uuid().safeParse(orderId).success) return null;
  return found;
}

const seenOf = (form: FormData) => String(form.get("seen") ?? "").slice(0, 4000) || null;

export async function readyForPickupAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return error(NO_ACCESS);
  const resend = form.get("resend") === "1";
  const done = await markReadyForPickup(
    m.store.id,
    { orderId, seen: resend ? null : seenOf(form), haveStock: form.get("haveStock") === "on" },
    m.account.id,
    { resend },
  );
  refresh();
  if (!done.ok) return error(done.message);
  const email = done.email ? EMAIL_WORDS[done.email] ?? "." : "and no email was needed.";
  return ok(resend ? `Email ${done.email === "sent" ? "sent again" : `not sent (${done.email ?? "nothing to send"})`}.` : `Marked ready for pickup, ${email}`);
}

export async function collectedAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return error(NO_ACCESS);
  const on = String(form.get("on") ?? "").trim() || undefined;
  const done = await markCollected(m.store.id, { orderId, on, seen: seenOf(form), haveStock: form.get("haveStock") === "on" }, m.account.id);
  refresh();
  if (!done.ok) return error(done.message);
  return ok("Marked as collected. The order is fulfilled, and the 14 days to withdraw count from that day.");
}

export async function outForDeliveryAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return error(NO_ACCESS);
  const done = await markOutForDelivery(m.store.id, { orderId, seen: seenOf(form) }, m.account.id);
  refresh();
  if (!done.ok) return error(done.message);
  return ok(`Marked out for delivery, ${done.email ? EMAIL_WORDS[done.email] ?? "." : "and no email was needed."} Mark it delivered when it is there.`);
}
