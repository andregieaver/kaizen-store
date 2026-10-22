"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { markOutForDelivery } from "@/server/local-delivery";
import { checkPermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { markCollected, markReadyForPickup } from "@/server/pickup";

/**
 * The order page's buttons for a pickup or local-delivery order (D237, `docs/wave-3-shipping-methods.md` 2.2, 2.3): *Ready for pickup* (once, with
 * *Send the email again* only after a failed first), *Collected* (a handover and the receipt in one transaction) and *Out for delivery*. Each asks
 * `orders:write` itself; the server functions lock the order, refuse in words and pass D174's `seen` basis, so two people pressing at once get one
 * success and one *changed*. `haveStock` is staff confirming they have units sold on backorder (the order page only).
 */

const error = (message: string): FormState => ({ status: "error", messages: [message] });
const ok = (message: string): FormState => ({ status: "ok", messages: [message] });

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;
/** Refused before a member is known: the session's language (D312). */
const noAccess = async () => error(adminText(await actionAdminLang(), "order").messages.noAccess);

async function member(storeSlug: string, orderId: string) {
  const found = await checkPermission(storeSlug, "orders:write");
  if (!found || !z.uuid().safeParse(orderId).success) return null;
  return found;
}

const seenOf = (form: FormData) => String(form.get("seen") ?? "").slice(0, 4000) || null;

export async function readyForPickupAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return noAccess();
  const w = wordsOf(m);
  const resend = form.get("resend") === "1";
  const done = await markReadyForPickup(
    m.store.id,
    { orderId, seen: resend ? null : seenOf(form), haveStock: form.get("haveStock") === "on" },
    m.account.id,
    { resend },
  );
  refresh();
  if (!done.ok) return error(done.message);
  const email = done.email ? w.emails[done.email] ?? "." : w.noEmailNeeded;
  return ok(resend ? (done.email === "sent" ? w.emailSentAgain : fillWords(w.emailNotSent, { why: done.email ?? w.nothingToSend })) : fillWords(w.markedReady, { email }));
}

export async function collectedAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return noAccess();
  const w = wordsOf(m);
  const on = String(form.get("on") ?? "").trim() || undefined;
  const done = await markCollected(m.store.id, { orderId, on, seen: seenOf(form), haveStock: form.get("haveStock") === "on" }, m.account.id);
  refresh();
  if (!done.ok) return error(done.message);
  return ok(w.markedCollected);
}

export async function outForDeliveryAction(storeSlug: string, orderId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug, orderId);
  if (!m) return noAccess();
  const w = wordsOf(m);
  const done = await markOutForDelivery(m.store.id, { orderId, seen: seenOf(form) }, m.account.id);
  refresh();
  if (!done.ok) return error(done.message);
  return ok(fillWords(w.markedOut, { email: done.email ? w.emails[done.email] ?? "." : w.noEmailNeeded }));
}
