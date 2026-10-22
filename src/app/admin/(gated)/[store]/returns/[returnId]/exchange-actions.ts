"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { adminText } from "@/lib/admin-text";
import type { ExchangeProblem } from "@/lib/exchange";
import { searchDraftVariants, type DraftVariantChoice } from "@/server/draft-orders";
import {
  cancelExchange,
  exchangeView,
  previewExchange,
  processExchange,
  proposeExchange,
  recordExchangeAgreement,
  recordExchangePaidOutside,
  resendExchange,
  saveExchangeDraft,
  withdrawProposal,
  type ExchangePreview,
  type ExchangeView,
} from "@/server/exchanges";
import { staffActor } from "@/server/order-actor";
import { checkPermission, NO_ACCESS } from "@/server/permissions";

/**
 * What staff do with a return's exchange (wave 3, D239, `docs/wave-3-exchanges.md` 2.2 and 4.9). Each action asks `orders:write` itself (`checkPermission()`: a store
 * the account is not a member of, or a role without the key, gets the refusal and nothing runs), takes the store slug and the return's id bound first by the page,
 * and finds the exchange only among this store's and this return's own. The server prices, checks and writes everything (`src/server/exchanges.ts`), including the
 * audit entries (`return.exchange_*`) and the order's history; these pass the screen's input through and answer in words, then `refresh()` the page.
 */

export type ExchangeProblemWords = { code: string; key: string | null; text: string };

export type ExchangeActionResponse = {
  ok: boolean;
  message: string;
  problems?: ExchangeProblemWords[];
  /** A link to share, shown once: only its hash is kept. */
  link?: string | null;
};

export type ExchangePreviewResponse = { ok: true; preview: ExchangePreview } | { ok: false; message: string; problems: ExchangeProblemWords[] };

const isId = (value: unknown): value is string => z.uuid().safeParse(value).success;
/** The member's words for the returns screens (D312 A4). */
const wordsFor = (member: { account: { adminLocale?: string | null } }): ReturnsMessages => adminText(adminLangOf(member.account.adminLocale), "returns");

const wordsOf = (problems: ExchangeProblem[] | undefined, w: ReturnsMessages): ExchangeProblemWords[] =>
  (problems ?? []).map((p) => ({ code: p.code, key: p.key ?? null, text: w.labels.exchangeProblems[p.code] }));

/** The builder's summary: the server's pricing of what is on the screen (`previewExchange()`, the same pricing the proposal freezes). Reads only. */
export async function previewExchangeAction(storeSlug: string, returnId: string, raw: unknown): Promise<ExchangePreviewResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS, problems: [] };
  const w = wordsFor(member);
  if (!isId(returnId)) return { ok: false, message: w.actions.gone, problems: [] };
  const preview = await previewExchange(member.store.id, returnId, raw);
  if ("message" in preview) return { ok: false, message: preview.message, problems: wordsOf(preview.problems, w) };
  return { ok: true, preview };
}

/** Goods the replacements can be: sellable in the original order's market (the draft orders' picker, D173). */
export async function searchExchangeVariantsAction(storeSlug: string, returnId: string, query: string): Promise<DraftVariantChoice[]> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member || !isId(returnId)) return [];
  // The market is the original order's, as the server works it out; never one the browser names.
  const base = await previewExchange(member.store.id, returnId, null);
  if ("message" in base || !base.marketSlug) return [];
  return searchDraftVariants(member.store.id, base.marketSlug, String(query ?? "").slice(0, 80));
}

/** *Save as draft*: keeps the replacements without sending anything (no token, no email, nothing held). */
export async function saveExchangeDraftAction(storeSlug: string, returnId: string, raw: unknown): Promise<ExchangeActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const w = wordsFor(member);
  if (!isId(returnId)) return { ok: false, message: w.actions.gone };
  const saved = await saveExchangeDraft(member.store.id, staffActor(member.account.id), returnId, raw);
  if (!saved.ok) return { ok: false, message: saved.message, problems: wordsOf(saved.problems, w) };
  refresh();
  return { ok: true, message: w.actions.draftSaved };
}

/** *Send to the customer* (an email to the order's own address) or *Create a link to share* (`createLink`, shown once). */
export async function proposeExchangeAction(storeSlug: string, returnId: string, raw: unknown, createLink: boolean): Promise<ExchangeActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const w = wordsFor(member);
  if (!isId(returnId)) return { ok: false, message: w.actions.gone };
  const sent = await proposeExchange(member.store.id, staffActor(member.account.id), returnId, raw, { createLink: createLink === true });
  if (!sent.ok) return { ok: false, message: sent.message, problems: wordsOf(sent.problems, w) };
  refresh();
  if (sent.link) return { ok: true, message: w.actions.linkReady, link: sent.link };
  return { ok: true, message: sent.emailed === "failed" ? w.actions.proposalEmailFailed : w.actions.proposalSent };
}

// ---------------------------------------------------------------------------------------------------------------------
// The steps of an exchange that is out: forms (`ActionForm`), bound to the store, the return and the exchange
// ---------------------------------------------------------------------------------------------------------------------

const done = (message: string): FormState => ({ status: "ok", messages: [message] });
const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The member and this return's exchange, or the refusal's words. */
type Found = { refused: string } | { refused?: undefined; member: NonNullable<Awaited<ReturnType<typeof checkPermission>>>; exchange: ExchangeView; w: ReturnsMessages };

async function exchangeOf(storeSlug: string, returnId: string, exchangeId: string): Promise<Found> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { refused: NO_ACCESS };
  const w = wordsFor(member);
  if (!isId(returnId) || !isId(exchangeId)) return { refused: w.actions.exchangeGone };
  const exchange = await exchangeView(member.store.id, exchangeId);
  if (!exchange || exchange.returnId !== returnId) return { refused: w.actions.exchangeGone };
  return { member, exchange, w };
}

/** *Send again* (a new email, at most five a day) or *Create a new link* (`createLink`): either way the earlier link stops working. */
export async function resendExchangeAction(storeSlug: string, returnId: string, exchangeId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const createLink = form.get("createLink") === "1";
  const sent = await resendExchange(found.member.store.id, staffActor(found.member.account.id), exchangeId, { createLink });
  if (!sent.ok) return failed(sent.message);
  refresh();
  if (sent.link) return done(fillWords(found.w.actions.newLink, { link: sent.link }));
  return sent.emailed === "failed" ? failed(found.w.actions.resendFailed) : done(found.w.actions.sentAgain);
}

/** *Withdraw the proposal*: it ends, and the customer's page says it no longer works. */
export async function withdrawExchangeAction(storeSlug: string, returnId: string, exchangeId: string): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const ended = await withdrawProposal(found.member.store.id, staffActor(found.member.account.id), exchangeId);
  if (!ended.ok) return failed(ended.message);
  refresh();
  return done(found.w.actions.withdrawn);
}

/** *Record the customer's agreement* (a voluntary return only; the server and the database refuse it for a withdrawal). */
export async function recordAgreementAction(storeSlug: string, returnId: string, exchangeId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const recorded = await recordExchangeAgreement(found.member.store.id, staffActor(found.member.account.id), exchangeId, {
    channel: text(form, "channel"),
    day: text(form, "day"),
    note: text(form, "note") || null,
  });
  if (!recorded.ok) return failed(recorded.message);
  refresh();
  return done(found.w.actions.agreementRecorded);
}

/** *Process the exchange* (and *Try again* on one whose refund did not go through). */
export async function processExchangeAction(storeSlug: string, returnId: string, exchangeId: string): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const processed = await processExchange(found.member.store.id, staffActor(found.member.account.id), exchangeId);
  const w = found.w;
  if (!processed.ok) return failed([processed.message, ...wordsOf(processed.problems, w).map((p) => p.text)].join(" "));
  refresh();
  if (processed.state === "settled") return done(fillWords(w.actions.exchangedSettled, { order: processed.orderNumber }));
  if (processed.state === "waiting") return done(fillWords(w.actions.exchangeWaiting, { order: processed.orderNumber }));
  return failed(processed.message ?? fillWords(w.actions.exchangeNotSettled, { order: processed.orderNumber }));
}

/** *Record as paid outside Kaizen*: the owner, or staff when the owner allows it (the server checks); cash above the country's ceiling is refused. */
export async function exchangePaidOutsideAction(storeSlug: string, returnId: string, exchangeId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const method = text(form, "method");
  if (method !== "cash" && method !== "bank_transfer" && method !== "other") return failed(found.w.actions.choosePaid);
  const recorded = await recordExchangePaidOutside(found.member, exchangeId, { method, receivedOn: text(form, "receivedOn") || null, reference: text(form, "reference").slice(0, 100) || null });
  if (!recorded.ok) return failed(recorded.message);
  refresh();
  return done(recorded.cashWarning ? found.w.actions.paidCashWarning : found.w.actions.paidOutside);
}

/** *Cancel the exchange and refund instead*: its order is cancelled (stock released), and the ordinary refund is offered. */
export async function cancelExchangeAction(storeSlug: string, returnId: string, exchangeId: string): Promise<FormState> {
  const found = await exchangeOf(storeSlug, returnId, exchangeId);
  if (found.refused !== undefined) return failed(found.refused);
  const cancelled = await cancelExchange(found.member.store.id, staffActor(found.member.account.id), exchangeId);
  if (!cancelled.ok) return failed(cancelled.message);
  refresh();
  return done(found.w.actions.exchangeCancelled);
}
