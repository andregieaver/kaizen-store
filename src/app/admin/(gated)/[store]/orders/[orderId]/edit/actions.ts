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
import { checkPermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { editProblemText, fillWords, type DraftsWords } from "@/lib/drafts-words";

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

/** The account's language and the `drafts` catalogue's words for it. */
const langOf = (member: { account: { adminLocale?: string | null } }): AdminLang => adminLangOf(member.account.adminLocale);
const wordsOf = (member: { account: { adminLocale?: string | null } }): DraftsWords => adminText(langOf(member), "drafts");
const noAccess = async () => adminText(await actionAdminLang(), "drafts").edit.actions.noAccess;
const words = (problems: { code: string; key?: string | null; text: string }[], w: DraftsWords) =>
  problems.map((p) => ({ code: p.code, key: p.key ?? null, text: editProblemText(p.code, p.text, w.edit) }));
const refusedWith = (problems: EditProblem[], w: DraftsWords, message = w.edit.actions.nothingChanged): EditActionResponse => ({ ok: false, message, problems: words(problems, w) });
const isId = (value: unknown): value is string => z.uuid().safeParse(value).success;
const orderGone = (w: DraftsWords): EditActionResponse => ({ ok: false, message: w.edit.actions.orderGone });
/** A link's last day, as the account reads dates. */
const untilOf = (iso: string, lang: AdminLang) => new Date(iso).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long" });

/** The summary beside the editor: the server's own pricing of what is on the screen (reads only). */
export async function previewOrderEditAction(storeSlug: string, orderId: string, raw: unknown): Promise<EditPreviewResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess(), problems: [] };
  const w = wordsOf(member);
  if (!isId(orderId)) return { ok: false, message: w.edit.actions.orderGone, problems: [] };
  const preview = await previewOrderEdit(member.store.id, orderId, raw);
  if (!preview) return { ok: false, message: w.edit.actions.orderGone, problems: [] };
  if (!("priced" in preview)) return { ok: false, message: w.edit.actions.checkChange, problems: words(preview.problems, w) };
  const summary = editSummaryView(preview);
  return { ok: true, summary: { ...summary, problems: words(summary.problems, w) } };
}

/** *Save the change* for a lower or equal total: applied at once, a lower total refunded in the same transaction. */
export async function applyOrderEditAction(storeSlug: string, orderId: string, raw: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  const a = w.edit.actions;
  if (!isId(orderId)) return orderGone(w);
  const result = await applyOrderEdit(member.store.id, orderId, raw, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems, w);
  refresh();
  const money = result.money === "refund" ? a.refunded : "";
  const told = result.emailed && result.emailed !== "failed" ? a.told : result.emailed === "failed" ? a.emailFailed : "";
  return { ok: true, message: fillWords(a.saved, { label: result.label, money, told }), label: result.label };
}

/** *Send the customer a pay link* (`email: true`) or *Create a link to share* (`email: false`) for a change with a higher total: the order stays as it is until paid. */
export async function sendOrderEditAction(storeSlug: string, orderId: string, raw: unknown, options: { email: boolean }): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  const a = w.edit.actions;
  if (!isId(orderId)) return orderGone(w);
  const email = options?.email === true;
  const result = await sendOrderEdit(member.store.id, orderId, raw, staffActor(member.account.id), { email });
  if (!result.ok) return refusedWith(result.problems, w);
  refresh();
  const values = { label: result.label, until: untilOf(result.expiresAt, langOf(member)) };
  return {
    ok: true,
    label: result.label,
    link: email ? null : result.link,
    message: fillWords(email ? (result.emailed && result.emailed !== "failed" ? a.waitingEmailed : a.waitingEmailFailed) : a.waitingLink, values),
  };
}

/** *Record as paid outside Kaizen* for a new change with a higher total: the difference is recorded as a payment taken outside Kaizen, and the change applied. */
export async function recordNewEditPaidOutsideAction(storeSlug: string, orderId: string, raw: unknown, outside: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  if (!isId(orderId)) return orderGone(w);
  const result = await recordEditPaidOutside(member.store.id, { orderId, raw }, outside, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems, w);
  refresh();
  return { ok: true, label: result.label, message: outsideDone(w, result.label, result.cashWarning) };
}

/** *Record as paid outside Kaizen* for a change already waiting for the customer's payment. */
export async function recordWaitingEditPaidOutsideAction(storeSlug: string, editId: string, outside: unknown): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = wordsOf(member);
  if (!isId(editId)) return { ok: false, message: w.edit.actions.changeGone };
  const result = await recordEditPaidOutside(member.store.id, { editId }, outside, staffActor(member.account.id));
  if (!result.ok) return refusedWith(result.problems, w);
  refresh();
  return { ok: true, label: result.label, message: outsideDone(w, result.label, result.cashWarning) };
}

/** The change is recorded as paid outside Kaizena Flow; a `warn` country's cash ceiling (D173's rule, `src/lib/cash-limits.ts`) adds its notice. */
const outsideDone = (w: DraftsWords, label: string, cashWarning: boolean | undefined) =>
  fillWords(w.edit.actions.outsideDone, { label, cash: cashWarning ? ` ${w.edit.actions.cashWarning}` : "" });

/** *Send again* (`email: true`) or *Create a link to share* for a change waiting for payment: a new link replaces the old one. */
export async function resendOrderEditAction(storeSlug: string, editId: string, options: { email: boolean }): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const a = wordsOf(member).edit.actions;
  if (!isId(editId)) return { ok: false, message: a.resend.not_found };
  const email = options?.email === true;
  const result = await resendOrderEdit(member.store.id, editId, staffActor(member.account.id), { email });
  refresh();
  if (!result.ok) return { ok: false, message: a.resend[result.problem] };
  const until = untilOf(result.expiresAt, langOf(member));
  return {
    ok: true,
    link: email ? null : result.link,
    message: fillWords(email ? (result.emailed && result.emailed !== "failed" ? a.resentEmailed : a.resentEmailFailed) : a.resentLink, { until }),
  };
}

/** *Cancel the change*: its Stripe session is closed first and the held units released; the order was never changed. */
export async function cancelOrderEditAction(storeSlug: string, editId: string): Promise<EditActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const a = wordsOf(member).edit.actions;
  if (!isId(editId)) return { ok: false, message: a.resend.not_found };
  const result = await cancelOrderEdit(member.store.id, editId, staffActor(member.account.id));
  refresh();
  if (!result.ok) return { ok: false, message: a.resend[result.problem] };
  return { ok: true, message: a.cancelled };
}

/** Goods the change can add, found by title or SKU in the order's own market (the draft order's picker, D173). */
export async function searchEditVariantsAction(storeSlug: string, orderId: string, query: string): Promise<DraftVariantChoice[]> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member || !isId(orderId)) return [];
  const found = await marketOfOrder(member.store.id, orderId);
  if (!found) return [];
  return searchDraftVariants(member.store.id, found.market.slug, String(query ?? "").slice(0, 80));
}
