"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { previewData, type RefundPreviewData } from "@/lib/return-admin";
import { parsePrice } from "@/lib/product-input";
import type { ReturnAddress } from "@/lib/withdrawal";
import { audit, type Membership } from "@/server/auth";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
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
 * page. Every one asks `requirePermission()` first (a store the account is not a member of is a 404, and the return is looked
 * up by this store's id, so another store's return is "no longer exists"), reads the form into the shape the server's own
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

async function member(storeSlug: string, returnId: string): Promise<{ member: Membership; valid: boolean }> {
  const found = await requirePermission(storeSlug, "orders:write");
  return { member: found, valid: z.uuid().safeParse(returnId).success };
}

const GONE = "This return no longer exists.";

/** Runs one step: checks the member and the id, calls the server, audits what was done, and refreshes the page. */
async function step(
  storeSlug: string,
  returnId: string,
  action: string,
  work: (member: Membership) => Promise<Done>,
  message: string,
  details: Record<string, unknown> = {},
): Promise<FormState> {
  const { member: found, valid } = await member(storeSlug, returnId);
  if (!valid) return failed(GONE);
  const result = await work(found);
  if (!result.ok) return failed(result.problem);
  await audit(found.account.id, found.store.id, action, { returnId, ...details });
  refresh();
  return done(message);
}

export async function approveReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.approved",
    (m) => approveReturn(m.store.id, { returnId, instructions: text(form, "instructions"), labelUrl: text(form, "labelUrl"), returnAddress: addressOf(form), note: null }, m.account.id),
    "Approved. The customer has been told how to send the goods back.",
  );
}

export async function declineReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.declined",
    (m) => declineReturn(m.store.id, { returnId, reason: text(form, "reason") }, m.account.id),
    "Declined. The customer has been told why.",
  );
}

export async function declineReturnLineAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const lineId = text(form, "lineId");
  return step(
    storeSlug,
    returnId,
    "return.line_declined",
    (m) => declineReturnLine(m.store.id, { returnId, lineId, reason: text(form, "reason") }, m.account.id),
    "The line is declined.",
    { lineId },
  );
}

export async function returnInstructionsAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.instructions_changed",
    (m) => setReturnInstructions(m.store.id, { returnId, instructions: text(form, "instructions"), labelUrl: text(form, "labelUrl"), returnAddress: addressOf(form) }, m.account.id),
    "Saved.",
  );
}

export async function markInTransitAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.in_transit",
    (m) => markInTransit(m.store.id, { returnId, on: text(form, "on") || null }, m.account.id),
    "Marked as on their way.",
  );
}

export async function markReceivedAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.received",
    (m) => markReceived(m.store.id, { returnId, on: text(form, "on") || null }, m.account.id),
    "Marked as received. The customer has been told.",
  );
}

/** The inspection, read from the form's per-line fields; the amounts are typed in the order's currency. */
export async function inspectReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { member: found, valid } = await member(storeSlug, returnId);
  if (!valid) return failed(GONE);
  const detail = await getReturn(found.store.id, returnId);
  if (!detail) return failed(GONE);
  const lines: unknown[] = [];
  for (const line of detail.lines.filter((l) => l.decision === "accept")) {
    const typed = text(form, `deduction:${line.lineId}`);
    const deductionMinor = typed === "" ? 0 : parsePrice(typed, detail.currency);
    if (deductionMinor === null) return failed(`"${typed}" is not an amount in ${detail.currency}.`);
    lines.push({
      lineId: line.lineId,
      condition: text(form, `condition:${line.lineId}`),
      restock: form.get(`restock:${line.lineId}`) === "on",
      deductionMinor,
      deductionNote: text(form, `deductionNote:${line.lineId}`),
    });
  }
  return step(
    storeSlug,
    returnId,
    "return.inspected",
    (m) => inspectReturn(m.store.id, { returnId, lines }, m.account.id),
    "Inspected.",
  );
}

/** The refund: the amount typed in the order's currency, a reason when it differs from the working, and stock to put back. */
export async function refundReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { member: found, valid } = await member(storeSlug, returnId);
  if (!valid) return failed(GONE);
  const detail = await getReturn(found.store.id, returnId);
  if (!detail) return failed(GONE);
  const typedAmount = text(form, "amount");
  const amountMinor = parsePrice(typedAmount, detail.currency);
  if (amountMinor === null) return failed(`"${typedAmount}" is not an amount in ${detail.currency}.`);
  const typedShipping = text(form, "shipping");
  const returnShippingMinor = typedShipping === "" ? 0 : parsePrice(typedShipping, detail.currency);
  if (returnShippingMinor === null) return failed(`"${typedShipping}" is not an amount in ${detail.currency}.`);
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
  return done(result.outside ? "Recorded as refunded outside Kaizen's Stripe." : "Refunded.");
}

export async function closeReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.closed",
    (m) => closeReturn(m.store.id, { returnId, note: text(form, "note") }, m.account.id, { confirmNoRefund: form.get("confirmNoRefund") === "on" }),
    "Closed.",
  );
}

export async function cancelReturnAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.cancelled",
    (m) => cancelReturn(m.store.id, { returnId, note: text(form, "note") }, m.account.id),
    "Cancelled.",
  );
}

export async function returnNoteAction(storeSlug: string, returnId: string, _previous: FormState, form: FormData): Promise<FormState> {
  return step(
    storeSlug,
    returnId,
    "return.note_changed",
    (m) => setReturnNote(m.store.id, { returnId, note: text(form, "note") }),
    "Saved.",
  );
}

/** Sends a confirmed withdrawal's acknowledgement again, to the address the customer gave. */
export async function sendAcknowledgementAction(storeSlug: string, returnId: string): Promise<FormState> {
  const { member: found, valid } = await member(storeSlug, returnId);
  if (!valid) return failed(GONE);
  const detail = await getReturn(found.store.id, returnId);
  if (!detail?.request || !detail.request.confirmedAt) return failed("This return has no confirmed withdrawal to acknowledge.");
  const result = await resendAcknowledgement(found.store.id, detail.request.id);
  if (!result.ok) return failed(result.problem);
  await audit(found.account.id, found.store.id, "return.acknowledgement_resent", { returnId, sent: result.sent });
  refresh();
  return result.sent ? done("The acknowledgement was sent again.") : failed("The email could not be sent. It is kept, and the system tries again every few minutes.");
}

export type RecalculateResult = { ok: true; preview: RefundPreviewData } | { ok: false; problem: string };

/** The refund's working for a return shipping cost the screen typed; the same sum the refund itself works out. */
export async function recalculateRefundAction(storeSlug: string, returnId: string, shipping: string): Promise<RecalculateResult> {
  const { member: found, valid } = await member(storeSlug, returnId);
  if (!valid) return { ok: false, problem: GONE };
  const detail = await getReturn(found.store.id, returnId);
  if (!detail) return { ok: false, problem: GONE };
  const typed = String(shipping ?? "").trim().slice(0, 40);
  const minor = typed === "" ? 0 : parsePrice(typed, detail.currency);
  if (minor === null) return { ok: false, problem: `"${typed}" is not an amount in ${detail.currency}.` };
  const preview = await previewRefund(found.store.id, returnId, minor);
  return preview ? { ok: true, preview: previewData(preview) } : { ok: false, problem: GONE };
}

/**
 * *Mark delivered* (D153): the day the customer received the goods, which starts their 14 days. Bound to the store and the
 * order by the order page; `requirePermission()` first, and the order is looked up by this store's id.
 */
export async function markDeliveredAction(storeSlug: string, orderId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const found = await checkPermission(storeSlug, "orders:write");
  if (!found) return { status: "error", messages: [NO_ACCESS] };
  if (!z.uuid().safeParse(orderId).success) return failed("This order no longer exists.");
  const result = await markDelivered(found.store.id, { orderId, on: text(form, "on") || null }, found.account.id);
  if (!result.ok) return failed(result.problem);
  await audit(found.account.id, found.store.id, "order.delivered", { orderId, deliveredAt: result.deliveredAt });
  refresh();
  return done("Saved. The customer's 14 days count from that day.");
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
  const found = await checkPermission(storeSlug, "orders:write");
  if (!found) return { status: "error", messages: [NO_ACCESS] };
  if (!z.uuid().safeParse(orderId).success) return failed("This order no longer exists.");
  const order = await getOrder(found.store.id, orderId);
  if (!order) return failed("This order no longer exists.");
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
    ? done(`Registered as ${result.number}. The customer has been sent the acknowledgement.`)
    : done(`Registered as ${result.number}. The acknowledgement could not be sent yet: it is kept, and the system tries again every few minutes.`);
}
