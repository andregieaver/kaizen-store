"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { draftMarketOptions, draftMarketSlug } from "@/lib/draft-markets";
import { draftProblemText, type DraftProblem } from "@/lib/draft-order";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { formatPriceInput } from "@/lib/product-input";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { countWords, fillWords } from "@/lib/drafts-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission, mayFindDraftCustomers } from "@/server/permissions";
import { staffActor } from "@/server/order-actor";
import {
  createDraft,
  deleteDraft,
  draftCustomerDetails,
  previewDraft,
  recordDraftPaidOutside,
  reopenDraft,
  resendDraftLink,
  saveDraft,
  searchDraftCustomers,
  searchDraftVariants,
  sendDraft,
  type DraftCustomerChoice,
  type DraftFieldProblem,
  type DraftSummary,
  type DraftVariantChoice,
} from "@/server/draft-orders";

/** The `drafts` catalogue in the account's language; without a member, the request's language (`actionAdminLang()`), for the one refusal it answers. */
const draftWords = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "drafts");
const noAccess = async () => adminText(await actionAdminLang(), "drafts").actions.noAccess;

/** A problem with its words, so the browser draws what the server decided and never invents a sentence. */
export type DraftProblemWords = { code: string; key: string | null; blocking: boolean; text: string };
const wordsOf = (problems: readonly DraftProblem[], words: Record<DraftProblem["code"], string>): DraftProblemWords[] =>
  problems.map((p) => ({ code: p.code, key: p.key ?? null, blocking: p.blocking, text: draftProblemText(p.code, words) }));

export type SaveDraftResponse =
  | {
      ok: true;
      version: number;
      /** What the draft totals now, worked out by the server from what was just saved (the same pricing the send uses). */
      summary: DraftSummary | null;
      problems: DraftProblemWords[];
      blocking: boolean;
      /** The market was changed: which prices followed the new market's list prices, which typed prices stayed, which lines it does not sell (line numbers from 1). */
      marketNote: string | null;
      market: { slug: string; currency: string; locale: string; name: string } | null;
      /** The lines as saved, in order: the title and SKU the server wrote and the list price as typed text, so the editor shows the prices of the market it was just saved in. */
      lines: { title: string; sku: string; listPrice: string | null }[];
    }
  | { ok: false; kind: "conflict" | "invalid" | "not_open" | "market" | "gone" | "denied"; message: string; fields?: DraftFieldProblem[] };

/**
 * Saves the editor's draft and answers with its summary (wave 3, D173, `docs/wave-3-orders.md` 2.4). The browser sends the whole draft and the version it loaded; the server validates it
 * again (`draftInput`), refuses an old version ("changed by someone else"), saves, and prices what it saved with `previewDraft()`: the summary is never worked out in the browser.
 * Saving holds no stock and uses no number. `orders:write`.
 */
export async function saveDraftAction(storeSlug: string, draftId: string, input: unknown): Promise<SaveDraftResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, kind: "denied", message: await noAccess() };
  const all = draftWords(member);
  const w = all.actions;
  const saved = await saveDraft(member.store.id, staffActor(member.account.id), draftId, input);
  if (!saved.ok) {
    const message =
      saved.problem === "conflict"
        ? w.changed
        : saved.problem === "not_open"
          ? w.notOpen
          : saved.problem === "not_found"
            ? w.gone
            : saved.problem === "market"
              ? w.chooseMarket
              : (saved.fields?.[0]?.message ?? w.checkDraft);
    return { ok: false, kind: saved.problem === "not_found" ? "gone" : saved.problem, message, fields: saved.fields };
  }
  const preview = await previewDraft(member.store.id, draftId);
  const change = saved.marketChange;
  const notes: string[] = [];
  if (change) {
    if (change.changed.length > 0) notes.push(countWords(change.changed.length, w.tookList));
    if (change.kept.length > 0) notes.push(countWords(change.kept.length, w.keptTyped));
    if (change.unavailable.length > 0) notes.push(countWords(change.unavailable.length, w.unavailable));
  }
  // No refresh(): the editor holds the draft it is showing, and re-rendering the page on every autosave would only repaint it.
  return {
    ok: true,
    version: saved.draft.version,
    summary: preview?.summary ?? null,
    problems: wordsOf(preview?.problems ?? [], all.problems),
    blocking: (preview?.blocking.length ?? 1) > 0,
    marketNote: notes.length > 0 ? notes.join(" ") : null,
    market: preview?.market ? { slug: preview.market.slug, currency: preview.market.currency, locale: preview.market.locale, name: preview.market.name } : null,
    lines: saved.draft.lines.map((line) => ({ title: line.title, sku: line.sku, listPrice: line.listPriceMinor === null ? null : formatPriceInput(line.listPriceMinor, saved.draft.currency) })),
  };
}

/** Goods the draft can sell in its market, found by title or SKU. */
export async function searchDraftVariantsAction(storeSlug: string, marketSlug: string, query: string): Promise<DraftVariantChoice[]> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return [];
  return searchDraftVariants(member.store.id, String(marketSlug).slice(0, 20), String(query ?? "").slice(0, 80));
}

/**
 * Customers found by name or email: name and email only. A draft needs `orders:write`, and the customer list is the customers' own area: a role that may write orders but not read customers (a fulfilment or packing
 * role) cannot list or open them from here either (D158). Such a role types the customer's email on the draft.
 */
export async function searchDraftCustomersAction(storeSlug: string, query: string): Promise<DraftCustomerChoice[]> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member || !mayFindDraftCustomers(member)) return [];
  return searchDraftCustomers(member.store.id, String(query ?? "").slice(0, 80));
}

/** What choosing a customer fills in: their email, phone, address and company, as they keep them. */
export async function draftCustomerDetailsAction(storeSlug: string, customerId: string): Promise<Awaited<ReturnType<typeof draftCustomerDetails>>> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member || !mayFindDraftCustomers(member)) return null;
  return draftCustomerDetails(member.store.id, String(customerId));
}

export type DraftActionResponse = { ok: boolean; message: string; problems?: DraftProblemWords[]; /** A link to share, shown once; only its hash is kept. */ link?: string | null; orderId?: string | null };

/**
 * Sends the draft to the customer, or makes a link to share (`createLink`). One transaction makes the order, holds the stock until the link expires and takes the order number; a refusal
 * writes nothing and says why. The email goes after the commit: a failure leaves the draft sent and says so. `orders:write`.
 */
export async function sendDraftAction(storeSlug: string, draftId: string, request: { version: number; validDays?: number; createLink?: boolean }): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const all = draftWords(member);
  const w = all.actions;
  const sent = await sendDraft(member.store.id, staffActor(member.account.id), draftId, request);
  if (!sent.ok) {
    const message: Record<typeof sent.problem, string> = { not_found: w.gone, conflict: w.changed, ...w.send };
    return { ok: false, message: message[sent.problem], problems: sent.problems ? wordsOf(sent.problems, all.problems) : undefined };
  }
  refresh();
  const mailed =
    sent.emailed === null
      ? w.sentShare
      : sent.emailed === "sent"
        ? w.sentEmailed
        : sent.emailed === "logged"
          ? w.sentLogged
          : w.sentFailed;
  return { ok: sent.emailed !== "failed", message: fillWords(w.sentDone, { number: sent.number, mailed }), link: sent.link, orderId: sent.orderId };
}

/** *Send again* and *Create a link to share* on a draft that is already sent: a new link replaces the old one. */
export async function resendDraftLinkAction(storeSlug: string, draftId: string, request: { createLink?: boolean }): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = draftWords(member).actions;
  const done = await resendDraftLink(member.store.id, staffActor(member.account.id), draftId, { createLink: request.createLink === true });
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = { not_found: w.gone, ...w.resend };
    return { ok: false, message: message[done.problem] };
  }
  refresh();
  if (done.emailed === null) return { ok: true, message: w.resendShare, link: done.link };
  if (done.emailed === "sent") return { ok: true, message: w.resendEmailed };
  if (done.emailed === "logged") return { ok: false, message: w.resendLogged };
  return { ok: false, message: w.resendFailed };
}

/**
 * *Reopen*: a sent, expired or cancelled draft becomes editable again. Its unpaid order is cancelled (the number stays on it, the stock is released) and the pay link stops
 * working; sending it again makes a new order and a new number. Refused when a payment arrived meanwhile.
 */
export async function reopenDraftAction(storeSlug: string, draftId: string): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = draftWords(member).actions;
  const done = await reopenDraft(member.store.id, staffActor(member.account.id), draftId);
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = { not_found: w.gone, ...w.reopen };
    return { ok: false, message: message[done.problem] };
  }
  refresh();
  return { ok: true, message: w.reopened };
}

/** Deletes a draft that is not sent, then goes to the list. */
export async function deleteDraftAction(storeSlug: string, draftId: string): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = draftWords(member).actions;
  const done = await deleteDraft(member.store.id, staffActor(member.account.id), draftId);
  if (!done.ok) return { ok: false, message: done.problem === "sent" ? w.deleteSent : w.gone };
  refresh();
  redirect(`/admin/${member.store.slug}/orders/drafts`);
}

/**
 * Records money taken outside Kaizen for the draft (bank transfer, cash, other). The owner may; staff may only when the owner allowed it (checked by the server). The order is
 * made and marked paid, the invoice is issued saying it was paid outside the online checkout, and the confirmation goes to the buyer. Kaizen takes no sale fee on money it never touched.
 */
export async function recordPaidOutsideAction(storeSlug: string, draftId: string, input: unknown): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: await noAccess() };
  const all = draftWords(member);
  const w = all.actions;
  const done = await recordDraftPaidOutside(member, draftId, input);
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = {
      not_found: w.gone,
      conflict: w.changed,
      ...w.outside,
      received_on: fillWords(w.outside.received_on, { max: MANUAL_RECEIVED_DAYS_MAX }),
    };
    return { ok: false, message: message[done.problem], problems: done.problems ? wordsOf(done.problems, all.problems) : undefined };
  }
  refresh();
  const mailed = done.emailed === "sent" ? w.outsideEmailed : done.emailed === "logged" ? w.outsideLogged : w.outsideFailed;
  const cash = done.cashWarning ? w.outsideCash : "";
  return { ok: done.emailed !== "failed", message: fillWords(w.outsideDone, { number: done.number, mailed, cash }), orderId: done.orderId };
}

/** Starts a draft in a market (a country in a language and a currency the store offers), then opens it. */
export async function createDraftAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const w = draftWords(member).actions;
  const options = draftMarketOptions(member.store.markets, member.store.localization);
  const slug = draftMarketSlug(options, {
    country: String(form.get("country") ?? ""),
    lang: String(form.get("lang") ?? ""),
    currency: String(form.get("currency") ?? ""),
  });
  if (!slug) return { status: "error", messages: [w.chooseView] };
  const made = await createDraft(member.store.id, staffActor(member.account.id), { marketSlug: slug });
  if (!made.ok) return { status: "error", messages: [made.problem === "too_many_open_drafts" ? w.tooMany : w.chooseMarket] };
  refresh();
  redirect(`/admin/${member.store.slug}/orders/drafts/${made.draft.id}`);
}
