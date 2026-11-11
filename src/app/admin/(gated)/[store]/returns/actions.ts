"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { adminText } from "@/lib/admin-text";
import { previewData, type RefundPreviewData } from "@/lib/return-admin";
import { parsePrice } from "@/lib/product-input";
import type { ReturnAddress } from "@/lib/withdrawal";
import { audit, type Membership } from "@/server/auth";
import { storeAction } from "@/server/store-action";
import { markDelivered } from "@/server/order-delivery";
import { getOrder } from "@/server/orders";
import { getReturn, previewRefund, type Done } from "@/server/returns";
import {
  approveReturn,
  cancelReturn,
  closeReturn,
  declineReturn,
  declineReturnLine,
  inspectReturn,
  markInTransit,
  markReceived,
  refundReturn,
  setReturnInstructions,
  setReturnNote,
} from "@/server/returns";
import { registerWithdrawal, resendAcknowledgement } from "@/server/withdrawals";

/**
 * What staff do with a return (D153): each step is a server action bound to the store's slug and the return's id by the
 * page. Every one runs inside `storeAction()` with `orders:write` (a member without it is refused in the form, and the return is
 * looked up by this store's id, so another store's return is "no longer exists"), reads the form into the shape the server's own
 * schema checks again, writes the change to the audit log and refreshes the page. The queue is for everyone who works the
 * store's orders; the rules are the owner's (`settings/returns`).
 */

const done = (message: string): FormState => ({ status: "ok", messages: [message] });
const failed = (message: string): FormState => ({ status: "error", messages: [message] });

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The return's address fields as one address, or none when they are all empty (the server asks for the rest). */
function addressOf(form: FormData): ReturnAddress | null {
  const address = {
    name: text(form, "addressName"),
    street: text(form, "addressStreet"),
    postalCode: text(form, "addressPostalCode"),
    city: text(form, "addressCity"),
    country: text(form, "addressCountry"),
  };
  return Object.values(address).every((v) => v === "") ? null : address;
}

/** The member's words, and whether the id can be a return's (the member is checked once, by `storeAction()` with `orders:write`). */
function checked(found: Membership, returnId: string): { valid: boolean; words: ReturnsMessages } {
  return { valid: z.uuid().safeParse(returnId).success, words: wordsOf(found) };
}

/** The member's words for the returns screens (D312 A4): what an action answers is in the language they read the admin in. */
const wordsOf = (found: Membership): ReturnsMessages => adminText(adminLangOf(found.account.adminLocale), "returns");

const notAmount = (words: ReturnsMessages, typed: string, currency: string): string => fillWords(words.actions.notAmount, { typed, currency });

/** Runs one step for a member `storeAction()` has checked: checks the id, calls the server, audits what was done, and refreshes the page. */
async function step(
  found: Membership,
  returnId: string,
  action: string,
  work: (member: Membership) => Promise<Done>,
  message: (words: ReturnsMessages) => string,
  details: Record<string, unknown> = {},
): Promise<FormState> {
  const { valid, words } = checked(found, returnId);
  if (!valid) return failed(words.actions.gone);
  const result = await work(found);
  if (!result.ok) return failed(result.problem);
  await audit(found.account.id, found.store.id, action, { returnId, ...details });
  refresh();
  return done(message(words));
}

export async function approveReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.approve", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.approved",
      (m) => approveReturn(m.store.id, { returnId, instructions: text(form, "instructions"), labelUrl: text(form, "labelUrl"), returnAddress: addressOf(form), note: null }, m.account.id),
      (w) => w.forms.approved,
    );
  });
}

export async function declineReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.decline", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.declined",
      (m) => declineReturn(m.store.id, { returnId, reason: text(form, "reason") }, m.account.id),
      (w) => w.forms.declined,
    );
  });
}

export async function declineReturnLineAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.decline_line", answer: failed }, async (found) => {
    const lineId = text(form, "lineId");
    return step(
      found,
      returnId,
      "return.line_declined",
      (m) => declineReturnLine(m.store.id, { returnId, lineId, reason: text(form, "reason") }, m.account.id),
      (w) => w.forms.lineDeclined,
      { lineId },
    );
  });
}

export async function returnInstructionsAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.instructions", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.instructions_changed",
      (m) => setReturnInstructions(m.store.id, { returnId, instructions: text(form, "instructions"), labelUrl: text(form, "labelUrl"), returnAddress: addressOf(form) }, m.account.id),
      (w) => w.actions.saved,
    );
  });
}

export async function markInTransitAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.in_transit", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.in_transit",
      (m) => markInTransit(m.store.id, { returnId, on: text(form, "on") || null }, m.account.id),
      (w) => w.detail.markedOnWay,
    );
  });
}

export async function markReceivedAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.received", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.received",
      (m) => markReceived(m.store.id, { returnId, on: text(form, "on") || null }, m.account.id),
      (w) => w.detail.markedReceived,
    );
  });
}

/** The inspection, read from the form's per-line fields; the amounts are typed in the order's currency. */
export async function inspectReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.inspect", answer: failed }, async (found) => {
    const { valid, words } = checked(found, returnId);
    if (!valid) return failed(words.actions.gone);
    const detail = await getReturn(found.store.id, returnId);
    if (!detail) return failed(words.actions.gone);
    const lines: unknown[] = [];
    for (const line of detail.lines.filter((l) => l.decision === "accept")) {
      const typed = text(form, `deduction:${line.lineId}`);
      const deductionMinor = typed === "" ? 0 : parsePrice(typed, detail.currency);
      if (deductionMinor === null) return failed(notAmount(words, typed, detail.currency));
      lines.push({
        lineId: line.lineId,
        condition: text(form, `condition:${line.lineId}`),
        restock: form.get(`restock:${line.lineId}`) === "on",
        deductionMinor,
        deductionNote: text(form, `deductionNote:${line.lineId}`),
      });
    }
    return step(
      found,
      returnId,
      "return.inspected",
      (m) => inspectReturn(m.store.id, { returnId, lines }, m.account.id),
      (w) => w.forms.inspected,
    );
  });
}

/** The refund: the amount typed in the order's currency, a reason when it differs from the working, and stock to put back. */
export async function refundReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.refund", answer: failed }, async (found) => {
    const { valid, words } = checked(found, returnId);
    if (!valid) return failed(words.actions.gone);
    const detail = await getReturn(found.store.id, returnId);
    if (!detail) return failed(words.actions.gone);
    const typedAmount = text(form, "amount");
    const amountMinor = parsePrice(typedAmount, detail.currency);
    if (amountMinor === null) return failed(notAmount(words, typedAmount, detail.currency));
    const typedShipping = text(form, "shipping");
    const returnShippingMinor = typedShipping === "" ? 0 : parsePrice(typedShipping, detail.currency);
    if (returnShippingMinor === null) return failed(notAmount(words, typedShipping, detail.currency));
    const restock = detail.lines
      .map((line) => ({ lineId: line.lineId, quantity: Math.floor(Number(form.get(`restock:${line.lineId}`) ?? 0)) || 0 }))
      .filter((item) => item.quantity > 0);
    const result = await refundReturn(found.store.id, { returnId, amountMinor, reason: text(form, "reason"), returnShippingMinor, restock }, found.account.id);
    if (!result.ok) return failed(result.problem);
    await audit(found.account.id, found.store.id, "return.refunded", {
      returnId,
      amountMinor: result.amountMinor,
      computedMinor: result.computedMinor,
      adjusted: result.adjusted,
      outside: result.outside,
    });
    refresh();
    return done(result.outside ? words.forms.refundedOutside : words.forms.refunded);
  });
}

export async function closeReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.close", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.closed",
      (m) => closeReturn(m.store.id, { returnId, note: text(form, "note") }, m.account.id, { confirmNoRefund: form.get("confirmNoRefund") === "on" }),
      (w) => w.forms.closed,
    );
  });
}

export async function cancelReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.cancel", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.cancelled",
      (m) => cancelReturn(m.store.id, { returnId, note: text(form, "note") }, m.account.id),
      (w) => w.forms.cancelled,
    );
  });
}

export async function returnNoteAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.note", answer: failed }, async (found) => {
    return step(
      found,
      returnId,
      "return.note_changed",
      (m) => setReturnNote(m.store.id, { returnId, note: text(form, "note") }),
      (w) => w.actions.saved,
    );
  });
}

/** Sends a confirmed withdrawal's acknowledgement again, to the address the customer gave. */
export async function sendAcknowledgementAction(storeSlug: string, returnId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.acknowledge", answer: failed }, async (found) => {
    const { valid, words } = checked(found, returnId);
    if (!valid) return failed(words.actions.gone);
    const detail = await getReturn(found.store.id, returnId);
    if (!detail?.request || !detail.request.confirmedAt) return failed(words.actions.noConfirmed);
    const result = await resendAcknowledgement(found.store.id, detail.request.id);
    if (!result.ok) return failed(result.problem);
    await audit(found.account.id, found.store.id, "return.acknowledgement_resent", { returnId, sent: result.sent });
    refresh();
    return result.sent ? done(words.forms.ackSent) : failed(words.actions.emailFailed);
  });
}

export type RecalculateResult = { ok: true; preview: RefundPreviewData } | { ok: false; problem: string };

const recalculateFailed = (problem: string): RecalculateResult => ({ ok: false, problem });

/** The refund's working for a return shipping cost the screen typed; the same sum the refund itself works out. */
export async function recalculateRefundAction(storeSlug: string, returnId: string, shipping: string): Promise<RecalculateResult> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.recalculate", answer: recalculateFailed }, async (found) => {
    const { valid, words } = checked(found, returnId);
    if (!valid) return { ok: false, problem: words.actions.gone };
    const detail = await getReturn(found.store.id, returnId);
    if (!detail) return { ok: false, problem: words.actions.gone };
    const typed = String(shipping ?? "").trim().slice(0, 40);
    const minor = typed === "" ? 0 : parsePrice(typed, detail.currency);
    if (minor === null) return { ok: false, problem: notAmount(words, typed, detail.currency) };
    const preview = await previewRefund(found.store.id, returnId, minor);
    return preview ? { ok: true, preview: previewData(preview) } : { ok: false, problem: words.actions.gone };
  });
}

/**
 * *Mark delivered* (D153): the day the customer received the goods, which starts their 14 days. Bound to the store and the
 * order by the order page; `storeAction()` with `orders:write` first, and the order is looked up by this store's id.
 */
export async function markDeliveredAction(storeSlug: string, orderId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "order.delivered", answer: failed }, async (found) => {
    const words = wordsOf(found);
    if (!z.uuid().safeParse(orderId).success) return failed(words.actions.orderGone);
    const result = await markDelivered(found.store.id, { orderId, on: text(form, "on") || null }, found.account.id);
    if (!result.ok) return failed(result.problem);
    await audit(found.account.id, found.store.id, "order.delivered", { orderId, deliveredAt: result.deliveredAt });
    refresh();
    return done(words.actions.deliveredSaved);
  });
}

/** The lines ticked in the register form: `take:{lineId}` with `qty:{lineId}` beside it. */
function ticked(form: FormData): { lineId: string; quantity: number }[] {
  const lines: { lineId: string; quantity: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("take:") || value === "off") continue;
    const lineId = key.slice(5);
    const typed = text(form, `qty:${lineId}`);
    lines.push({ lineId, quantity: /^\d{1,6}$/.test(typed) ? Number(typed) : 0 });
  }
  return lines;
}

/** Registers a withdrawal the customer made outside the withdrawal function, on the order's page. */
export async function registerWithdrawalAction(storeSlug: string, orderId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "orders:write", action: "return.register", answer: failed }, async (found) => {
    const words = wordsOf(found);
    if (!z.uuid().safeParse(orderId).success) return failed(words.actions.orderGone);
    const order = await getOrder(found.store.id, orderId);
    if (!order) return failed(words.actions.orderGone);
    const result = await registerWithdrawal(
      found.store.id,
      {
        orderNumber: order.number,
        name: text(form, "name"),
        channel: text(form, "channel"),
        informedOn: text(form, "informedOn") || null,
        lines: ticked(form),
        note: text(form, "note") || null,
        late: form.get("late") === "on",
        lateReason: text(form, "lateReason") || null,
      },
      found.account.id,
    );
    if (!result.ok) return failed(result.problem);
    await audit(found.account.id, found.store.id, "return.withdrawal_registered", { orderId, returnId: result.returnId, channel: text(form, "channel") });
    refresh();
    return result.acknowledged
      ? done(fillWords(words.actions.registered, { number: result.number }))
      : done(fillWords(words.actions.registeredNotSent, { number: result.number }));
  });
}
