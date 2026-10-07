"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { editSummaryView, type EditSummaryView } from "@/lib/order-edit-view";
import { staffActor } from "@/server/order-actor";
import { searchDraftVariants, type DraftVariantChoice } from "@/server/draft-orders";
import {
  applyOrderEdit,
  cancelOrderEdit,
  marketOfOrder,
  previewOrderEdit,
  recordEditPaidOutside,
  resendOrderEdit,
  sendOrderEdit,
  type EditProblem,
} from "@/server/order-edits";
import { checkPermission, NO_ACCESS } from "@/server/permissions";

/**
 * The actions of changing an order after purchase (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2 and 4.5). Each asks `orders:write` itself and takes the store slug
 * bound first; every server function it calls names the store, so another store's order or change is simply not found. The server prices, checks and writes everything
 * (`src/server/order-edits.ts`) and writes its own audit entries and history events: these only pass the editor's input through and answer in words. Recording money
 * taken or paid back outside Kaizen is the owner's, or staff's when the owner allowed it (the server checks that too).
 */

export type EditActionResponse = {
  ok: boolean;
  message: string;
  problems?: { code: string; key: string | null; text: string }[];
  /** A link to share, shown once; only its hash is kept. */
  link?: string | null;
  /** The change's number on the order (`E1`). */
  label?: string | null;
};

export type EditPreviewResponse = { ok: true; summary: EditSummaryView } | { ok: false; message: string; problems: { code: string; key: string | null; text: string }[] };

const words = (problems: EditProblem[]) => problems.map((p) => ({ code: p.code, key: p.key ?? null, text: p.text }));
const refusedWith = (problems: EditProblem[], message = "Nothing was changed."): EditActionResponse => ({ ok: false, message, problems: words(problems) });
const isId = (value: unknown): value is string => z.uuid().safeParse(value).success;
const ORDER_GONE: EditActionResponse = { ok: false, message: "This order no longer exists." };

/** The summary beside the editor: the server's own pricing of what is on the screen (reads only). */
export async function previewOrderEditAction(storeSlug: string, orderId: string, raw: unknown): Promise<EditPreviewResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS, problems: [] };
  if (!isId(orderId)) return { ok: false, message: "This order no longer exists.", problems: [] };
  const preview = await previewOrderEdit(member.store.id, orderId, raw);
  if (!preview) return { ok: false, message: "This order no longer exists.", problems: [] };
  if (!("priced" in preview)) return { ok: false, message: "Check the change and try again.", problems: words(preview.problems) };
  return { ok: true, summary: editSummaryView(preview) };
}

/** *Save the change* for a lower or equal total: applied at once, a lower total refunded in the same transaction. */
export async function applyOrderEditAction(storeSlug: string, orderId: string, raw: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(orderId)) return ORDER_GONE;
  const result = await applyOrderEdit(member.store.id, orderId, raw, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems);
  refresh();
  const money = result.money === "refund" ? " The difference is refunded." : "";
  const told = result.emailed && result.emailed !== "failed" ? " The customer has been told." : result.emailed === "failed" ? " The email to the customer could not be sent." : "";
  return { ok: true, message: `Change ${result.label} is saved.${money}${told}`, label: result.label };
}

/** *Send the customer a pay link* (`email: true`) or *Create a link to share* (`email: false`) for a change with a higher total: the order stays as it is until paid. */
export async function sendOrderEditAction(storeSlug: string, orderId: string, raw: unknown, options: { email: boolean }): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(orderId)) return ORDER_GONE;
  const email = options?.email === true;
  const result = await sendOrderEdit(member.store.id, orderId, raw, staffActor(member.account.id), { email });
  if (!result.ok) return refusedWith(result.problems);
  refresh();
  const until = new Date(result.expiresAt).toLocaleDateString("en-GB", { dateStyle: "long" });
  return {
    ok: true,
    label: result.label,
    link: email ? null : result.link,
    message: email
      ? result.emailed && result.emailed !== "failed"
        ? `Change ${result.label} is waiting for the customer's payment. They were emailed a link that works until ${until}.`
        : `Change ${result.label} is waiting for the customer's payment, but the email could not be sent: make a link to share from the order page.`
      : `Change ${result.label} is waiting for the customer's payment. The link works until ${until}.`,
  };
}

/** *Record as paid outside Kaizen* for a new change with a higher total: the difference is recorded as a payment taken outside Kaizen, and the change applied. */
export async function recordNewEditPaidOutsideAction(storeSlug: string, orderId: string, raw: unknown, outside: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(orderId)) return ORDER_GONE;
  const result = await recordEditPaidOutside(member.store.id, { orderId, raw }, outside, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems);
  refresh();
  return { ok: true, label: result.label, message: `Change ${result.label} is recorded as paid outside Kaizen and applied to the order.${result.cashWarning ? ` ${CASH_WARNING}` : ""}` };
}

/** *Record as paid outside Kaizen* for a change already waiting for the customer's payment. */
export async function recordWaitingEditPaidOutsideAction(storeSlug: string, editId: string, outside: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(editId)) return { ok: false, message: "This change was not found." };
  const result = await recordEditPaidOutside(member.store.id, { editId }, outside, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems);
  refresh();
  return { ok: true, label: result.label, message: `Change ${result.label} is recorded as paid outside Kaizen and applied to the order.${result.cashWarning ? ` ${CASH_WARNING}` : ""}` };
}

/** A `warn` country's cash ceiling (D173's rule, `src/lib/cash-limits.ts`): recorded, with a notice. */
const CASH_WARNING = "The order's cash is at or above this country's reported cash ceiling: check that the store may accept it.";

const RESEND_WORDS = {
  not_found: "This change was not found.",
  not_waiting: "This change is no longer waiting for payment.",
  limit: "This change's link was emailed as often as it may be today. Make a link to share instead.",
  processing: "A card payment for this change is still being processed: wait for it.",
  paid: "The customer has paid this change: it is applied.",
} as const;

/** *Send again* (`email: true`) or *Create a link to share* for a change waiting for payment: a new link replaces the old one. */
export async function resendOrderEditAction(storeSlug: string, editId: string, options: { email: boolean }): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(editId)) return { ok: false, message: RESEND_WORDS.not_found };
  const email = options?.email === true;
  const result = await resendOrderEdit(member.store.id, editId, staffActor(member.account.id), { email });
  refresh();
  if (!result.ok) return { ok: false, message: RESEND_WORDS[result.problem] };
  const until = new Date(result.expiresAt).toLocaleDateString("en-GB", { dateStyle: "long" });
  return {
    ok: true,
    link: email ? null : result.link,
    message: email
      ? result.emailed && result.emailed !== "failed"
        ? `Sent again. The new link works until ${until}; the old one no longer does.`
        : "A new link was made, but the email could not be sent. Make a link to share instead."
      : `A new link was made; it works until ${until}. The old one no longer does.`,
  };
}

/** *Cancel the change*: its Stripe session is closed first and the held units released; the order was never changed. */
export async function cancelOrderEditAction(storeSlug: string, editId: string): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  if (!isId(editId)) return { ok: false, message: RESEND_WORDS.not_found };
  const result = await cancelOrderEdit(member.store.id, editId, staffActor(member.account.id));
  refresh();
  if (!result.ok) return { ok: false, message: RESEND_WORDS[result.problem] };
  return { ok: true, message: "The change is cancelled. The order is as it was, and the items held for it are released." };
}

/** Goods the change can add, found by title or SKU in the order's own market (the draft order's picker, D173). */
export async function searchEditVariantsAction(storeSlug: string, orderId: string, query: string): Promise<DraftVariantChoice[]> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member || !isId(orderId)) return [];
  const found = await marketOfOrder(member.store.id, orderId);
  if (!found) return [];
  return searchDraftVariants(member.store.id, found.market.slug, String(query ?? "").slice(0, 80));
}
