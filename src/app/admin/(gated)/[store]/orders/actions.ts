"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { orderEn } from "@/lib/admin-messages/order.en";
import { putBackChoice } from "@/lib/inventory-admin";
import { parseAmount } from "@/lib/field-money";
import { formatMoney } from "@/lib/money";
import { parsePrice } from "@/lib/product-input";
import { checkPermission, requirePermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { saveStaffFields } from "@/server/field-entities";
import type { SaveResult } from "@/server/settings";
import { getOrder } from "@/server/orders";
import {
  addOrderNote,
  cancelOrder,
  CARRIERS,
  COPIED_ORDER_MESSAGE,
  getOrderAdmin,
  markBalancePaid,
  markSent,
  refundOrder,
  updateOrderContact,
  VENUE_METHODS,
  sendRefusalText,
  undoRefusalText,
  undoShipment,
} from "@/server/order-admin";
import { sendCancelled, sendOrderConfirmation, sendRefunded, sendShipped } from "@/server/shopper-emails";
import { recordTermsPaidOutside } from "@/server/payment-terms";
import { audit } from "@/server/auth";
import { FULFILMENT_AUDIT_ACTIONS } from "@/lib/order-ops-events";
import { undoneMessage } from "@/lib/shipment-undo";
import type { FormState } from "@/components/admin/action-form";
import { parcelLinesFromForm } from "@/lib/parcel-form";
import { chargeDelivery, deliveryOfOrder } from "@/server/standing-orders";

export type OrderActionState = { ok: boolean; message: string | null };

const done = (message: string): OrderActionState => ({ ok: true, message });
const failed = (message: string): OrderActionState => ({ ok: false, message });

async function orderFor(storeSlug: string, orderId: string) {
  const member = await requirePermission(storeSlug, "orders:write");
  if (!z.uuid().safeParse(orderId).success) return null;
  const order = await getOrder(member.store.id, orderId);
  return order ? { member, order, w: wordsOf(member) } : null;
}

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "order").messages;
/** Refused before a member is known: the session's language (D312). */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;

/**
 * Records a parcel (D174, `docs/wave-3-fulfilment.md` 2.1): the lines and units chosen in the *Send* card (`qty:{lineId}` fields, sent with `parcel=lines`), or, without a
 * choice (a weekly box, an old form), everything still to send. `seen` is the order's fulfilment as the card saw it: `markSent()` refuses `changed` when another parcel or a
 * withdrawal came in between. The parcel's own email lists what is in it. Audit `order.sent_part` (counts only).
 */
export async function sendOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const input = z
    .object({
      carrier: z.enum(CARRIERS.map((c) => c.id) as [string, ...string[]]),
      trackingNumber: z.string().trim().max(100),
      trackingUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]),
      notify: z.boolean(),
    })
    .safeParse({
      carrier: form.get("carrier"),
      trackingNumber: form.get("trackingNumber") ?? "",
      trackingUrl: String(form.get("trackingUrl") ?? "").trim(),
      notify: form.get("notify") === "on",
    });
  if (!input.success) return failed(w.trackingLink);
  // A weekly delivery (D102) is paid as it is sent: its card is charged first, and a refusal stops the sending.
  let charged = false;
  if (found.order.status === "pending_payment" && (await deliveryOfOrder(found.member.store.id, orderId))) {
    const charge = await chargeDelivery(found.member.store.id, orderId);
    if (!charge.ok) {
      refresh();
      return failed(charge.problem);
    }
    charged = true;
    await sendOrderConfirmation(found.member.store.id, orderId);
  }
  const chosen = parcelLinesFromForm(form);
  if (chosen === "invalid") return failed(w.notWhole);
  const seen = String(form.get("seen") ?? "").slice(0, 100) || null;
  const sent = await markSent(
    found.member.store.id,
    orderId,
    { ...input.data, trackingUrl: input.data.trackingUrl || null },
    found.member.account.id,
    null,
    { lines: chosen, seen },
  );
  if (!sent.ok) return failed(sendRefusalText(sent.reason));
  const units = sent.shipment.lines.reduce((sum, line) => sum + line.quantity, 0);
  await audit(found.member.account.id, found.member.store.id, FULFILMENT_AUDIT_ACTIONS.sentPart, { shipment: sent.shipment.id, units, left: sent.left }, { target: { type: "order", id: orderId } });
  if (input.data.notify) await sendShipped(found.member.store.id, orderId, sent.shipment);
  refresh();
  const paid = charged ? w.chargedAnd : "";
  const what = sent.left > 0 ? `${paid ? `${paid}${w.partlySent}` : w.parcelRecorded}${countWords(sent.left, w.stillToSend)}` : paid ? `${paid}${w.markedSentAfter}` : w.markedSent;
  return done(fillWords(input.data.notify ? w.told : w.plain, { what }));
}

/** Emails the customer about one parcel again (its carrier, tracking and contents), e.g. when they could not find the first email (D174 2.1). */
export async function resendShippedAction(storeSlug: string, orderId: string, shipmentId: string): Promise<OrderActionState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return failed(await noAccess());
  const w = wordsOf(member);
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(shipmentId).success) return failed(w.parcelNotFound);
  const order = await getOrderAdmin(member.store.id, orderId);
  if (!order || order.copied) return failed(w.parcelNotFound);
  if (!order.email) return failed(w.noEmail);
  const shipment = order.shipments.find((s) => s.id === shipmentId);
  if (!shipment) return failed(w.parcelNotFound);
  // An undone parcel (D174 follow-up) was not sent: its email is never sent again.
  if (shipment.undone) return failed(w.undoneNotEmailed);
  const outcome = await sendShipped(member.store.id, orderId, shipment, { resend: true });
  refresh();
  if (outcome === "sent") return done(fillWords(w.sentTo, { email: order.email }));
  if (outcome === "logged") return done(w.logged);
  return failed(w.emailFailed);
}

/**
 * Takes "sent" back for one parcel (D174 follow-up, `docs/wave-3-fulfilment.md` "Undoing a parcel"): `undoShipment()` marks it undone (never deleted), puts its units back
 * to send, moves a sent order back to *Partly sent* or *Not sent* and clears a recorded receipt. A carrier booking is not cancelled at the carrier and the customer is not
 * emailed: the answer says so. `reason` is optional, at most 200 characters. The audit entry is `undoShipment()`'s.
 */
export async function undoShipmentAction(
  storeSlug: string,
  orderId: string,
  shipmentId: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const refused = (message: string): FormState => ({ status: "error", messages: [message] });
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return refused(await noAccess());
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(shipmentId).success) return refused(undoRefusalText("not_found"));
  const reason = z.string().trim().max(200).safeParse(String(form.get("reason") ?? ""));
  if (!reason.success) return refused(undoRefusalText("reason_too_long"));
  const undone = await undoShipment(member.store.id, orderId, shipmentId, member.account.id, reason.data || null);
  if (!undone.ok) return refused(undoRefusalText(undone.reason));
  refresh();
  return { status: "ok", messages: [undoneMessage(undone, adminText(adminLangOf(member.account.adminLocale), "order").parcels)] };
}

/** Refunds an amount through Stripe and puts chosen items back in stock. */
export async function refundOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const typed = String(form.get("amount") ?? "").trim();
  const amountMinor = typed === "" ? 0 : parsePrice(typed, found.order.currency);
  if (amountMinor === null) return failed(fillWords(w.notAmount, { typed, currency: found.order.currency }));
  // "Put back at" (wave 3, D172): empty is where the units were taken from; a chosen place must be an active location of this store, which `refundOrder()` checks.
  const restock = found.order.lines
    .map((line) => ({ lineId: line.id, quantity: Math.floor(Number(form.get(`restock:${line.id}`) ?? 0)) || 0, locationId: putBackChoice(form.get(`restockAt:${line.id}`)) }))
    .filter((item) => item.quantity > 0);
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || "Refund";
  // "These units were not sent" (D174): the units put back come off what is still to send. Only a checkbox ticked "on" counts; the server decides how many under the order's lock.
  const notSent = form.get("notSent") === "on";
  // Refund to store credit (D364): a gift card of the store's, emailed to the order's own address by `refundOrder()`; the refund email is not sent.
  const toCredit = form.get("refundTo") === "credit";
  const outcome = await refundOrder(found.member.store.id, orderId, { amountMinor, reason, restock, notSent, toCredit }, found.member.account.id);
  if (!outcome.ok) return failed(outcome.problem);
  if (outcome.credit) {
    refresh();
    const amount = formatMoney(outcome.credit.amountMinor, found.order.currency, "en-GB");
    return done(`${fillWords(w.creditIssued, { amount, code: outcome.credit.code })}${outcome.credit.emailed === "sent" ? w.creditEmailed : w.creditNotEmailed}`);
  }
  if (amountMinor > 0 && form.get("notify") === "on") {
    await sendRefunded(found.member.store.id, orderId, outcome.refundId, amountMinor);
  }
  const closed = outcome.closedUnits ?? 0;
  if (closed > 0) {
    await audit(found.member.account.id, found.member.store.id, FULFILMENT_AUDIT_ACTIONS.unsentClosed, { units: closed, refund: outcome.refundId || null }, { target: { type: "order", id: orderId } });
  }
  refresh();
  const closedWords = closed > 0 ? countWords(closed, w.closed) : "";
  return done(`${amountMinor > 0 ? w.refunded : w.putBack}${closedWords}`);
}

/** Cancels an order that is paid but not sent: full refund, stock back, customer told. */
export async function cancelOrderAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || "Cancelled by the store";
  const outcome = await cancelOrder(found.member.store.id, orderId, reason, found.member.account.id);
  if (!outcome.ok) return failed(outcome.problem);
  if (form.get("notify") === "on") await sendCancelled(found.member.store.id, orderId, outcome.amountMinor, { unpaid: outcome.unpaid });
  refresh();
  return done(w.cancelled);
}

/** Records what was left to pay at the venue as paid (D66): card terminal, cash or otherwise. */
export async function markBalancePaidAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const method = VENUE_METHODS.find((m) => m === form.get("method")) ?? "other";
  if (!(await markBalancePaid(found.member.store.id, orderId, method, found.member.account.id))) {
    return failed(w.nothingToPay);
  }
  refresh();
  return done(w.markedPaid);
}

/** Records the invoice of an order on payment terms as paid outside Kaizena Flow (D293): the method, the day received and a reference. */
export async function recordTermsPaidAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const text = (name: string) => String(form.get(name) ?? "").trim();
  // A part of what is owed (D387): the amount typed in the order's currency; left empty, the whole balance.
  const currency = found.order.currency;
  const amountMinor = text("amount") ? parseAmount(text("amount"), currency) : undefined;
  if (amountMinor === null || amountMinor === 0) return failed(w.terms.amount);
  const result = await recordTermsPaidOutside(
    found.member.store.id,
    orderId,
    {
      method: text("method"),
      ...(amountMinor ? { amountMinor } : {}),
      ...(text("receivedOn") ? { receivedOn: text("receivedOn") } : {}),
      ...(text("reference") ? { reference: text("reference") } : {}),
    },
    found.member.account.id,
  );
  if (!result.ok) {
    return failed(w.terms[result.problem]);
  }
  refresh();
  const recorded = result.left ? fillWords(w.recordedPart, { left: formatMoney(result.left, currency, ADMIN_LANG_FACTS[adminLangOf(found.member.account.adminLocale)].locale) }) : w.recordedPaid;
  return done(result.cashWarning ? `${recorded} ${w.cashNearLimit}` : recorded);
}

/** Corrects the customer's email or delivery address. */
export async function updateContactAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const field = (name: string, max = 200) => String(form.get(name) ?? "").trim().slice(0, max);
  const email = z.email().safeParse(field("email"));
  if (!email.success) return failed(w.validEmail);
  const ok = await updateOrderContact(found.member.store.id, orderId, {
    email: email.data,
    shippingAddress: {
      name: field("name"),
      line1: field("line1"),
      line2: field("line2") || null,
      postalCode: field("postalCode", 20),
      city: field("city", 100),
      phone: field("phone", 40) || null,
    },
  });
  refresh();
  return ok ? done(w.saved) : failed(w.cannotChange);
}

/** A note for staff only; the customer never sees it. */
export async function addNoteAction(
  storeSlug: string,
  orderId: string,
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const note = String(form.get("note") ?? "").trim().slice(0, 2000);
  if (!note) return failed(w.writeNote);
  await addOrderNote(found.member.store.id, orderId, note, found.member.account.email);
  refresh();
  return done(w.noteAdded);
}

/** Sends the order confirmation again, e.g. when the customer could not find it. */
export async function resendConfirmationAction(storeSlug: string, orderId: string): Promise<OrderActionState> {
  const found = await orderFor(storeSlug, orderId);
  if (!found) return failed(orderEn.messages.gone);
  const { w } = found;
  if (found.order.copied) return failed(COPIED_ORDER_MESSAGE);
  const outcome = await sendOrderConfirmation(found.member.store.id, orderId, { resend: true });
  refresh();
  if (outcome === "sent") return done(fillWords(w.sentTo, { email: found.order.email ?? "" }));
  if (outcome === "logged") return done(w.logged);
  return failed(w.confirmationFailed);
}


/**
 * Saves staff's custom fields for an order (D120). They are for staff only and
 * never shown to the shopper or on the site; the server checks everything
 * against the store's own groups.
 */
export async function saveOrderFieldsAction(storeSlug: string, orderId: string, changes: unknown): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  if (!z.uuid().safeParse(orderId).success) return { ok: false, problems: [wordsOf(member).unknownOrder] };
  const result = await saveStaffFields(member, "order", orderId, changes);
  if (result.ok) refresh();
  return result;
}
