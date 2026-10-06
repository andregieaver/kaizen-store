"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { draftMarketOptions, draftMarketSlug } from "@/lib/draft-markets";
import { draftProblemText, type DraftProblem } from "@/lib/draft-order";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { formatPriceInput } from "@/lib/product-input";
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

const NO_ACCESS = "You do not have access to do this.";
const GONE = "This draft no longer exists.";
const CHANGED = "This draft was changed by someone else. Reload the page to see their changes.";

/** A problem with its words, so the browser draws what the server decided and never invents a sentence. */
export type DraftProblemWords = { code: string; key: string | null; blocking: boolean; text: string };
const wordsOf = (problems: readonly DraftProblem[]): DraftProblemWords[] =>
  problems.map((p) => ({ code: p.code, key: p.key ?? null, blocking: p.blocking, text: draftProblemText(p.code) }));

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
  if (!member) return { ok: false, kind: "denied", message: NO_ACCESS };
  const saved = await saveDraft(member.store.id, staffActor(member.account.id), draftId, input);
  if (!saved.ok) {
    const message =
      saved.problem === "conflict"
        ? CHANGED
        : saved.problem === "not_open"
          ? "This draft was sent or ended, so it cannot be edited. Reopen it first."
          : saved.problem === "not_found"
            ? GONE
            : saved.problem === "market"
              ? "Choose a market the store sells to."
              : (saved.fields?.[0]?.message ?? "Check the draft.");
    return { ok: false, kind: saved.problem === "not_found" ? "gone" : saved.problem, message, fields: saved.fields };
  }
  const preview = await previewDraft(member.store.id, draftId);
  const change = saved.marketChange;
  const notes: string[] = [];
  if (change) {
    if (change.changed.length > 0) notes.push(`${change.changed.length === 1 ? "A line took" : `${change.changed.length} lines took`} the new market's list price.`);
    if (change.kept.length > 0) notes.push(`${change.kept.length === 1 ? "A typed price" : `${change.kept.length} typed prices`} stayed as typed, now in the new currency: check ${change.kept.length === 1 ? "it" : "them"}.`);
    if (change.unavailable.length > 0) notes.push(`${change.unavailable.length === 1 ? "A line is" : `${change.unavailable.length} lines are`} not for sale in the new market.`);
  }
  // No refresh(): the editor holds the draft it is showing, and re-rendering the page on every autosave would only repaint it.
  return {
    ok: true,
    version: saved.draft.version,
    summary: preview?.summary ?? null,
    problems: wordsOf(preview?.problems ?? []),
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
  if (!member) return { ok: false, message: NO_ACCESS };
  const sent = await sendDraft(member.store.id, staffActor(member.account.id), draftId, request);
  if (!sent.ok) {
    const message: Record<typeof sent.problem, string> = {
      not_found: GONE,
      not_open: "This draft was already sent.",
      conflict: CHANGED,
      invalid: "Check the number of days: a link is valid for 1 to 30.",
      closed: "This store is not open, so a draft cannot be sent.",
      payments_off: "Payments are off for this store, so there is nothing for the customer to pay with. Turn them on under Settings, Payments.",
      limit: "Too many pay links were sent in the last hour. Try again later.",
      problems: "The draft cannot be sent yet.",
      market: "The market of this draft no longer exists.",
    };
    return { ok: false, message: message[sent.problem], problems: sent.problems ? wordsOf(sent.problems) : undefined };
  }
  refresh();
  const mailed =
    sent.emailed === null
      ? "Copy the link below and share it: it is shown only now."
      : sent.emailed === "sent"
        ? "The pay link was emailed to the customer."
        : sent.emailed === "logged"
          ? "The pay link was recorded, but email is not set up for this store, so it was not sent. Create a link to share instead."
          : "The email could not be sent. Send it again, or create a link to share.";
  return { ok: sent.emailed !== "failed", message: `Order ${sent.number} was made and its stock is held until the link expires. ${mailed}`, link: sent.link, orderId: sent.orderId };
}

/** *Send again* and *Create a link to share* on a draft that is already sent: a new link replaces the old one. */
export async function resendDraftLinkAction(storeSlug: string, draftId: string, request: { createLink?: boolean }): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const done = await resendDraftLink(member.store.id, staffActor(member.account.id), draftId, { createLink: request.createLink === true });
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = {
      not_found: GONE,
      not_sent: "This draft has not been sent.",
      expired: "The link has expired. Reopen the draft and send it again.",
      limit: "A draft's link can be sent 5 times a day and the store's 60 an hour. Try again later.",
      closed: "This store is not open, so a link cannot be sent.",
    };
    return { ok: false, message: message[done.problem] };
  }
  refresh();
  if (done.emailed === null) return { ok: true, message: "A new link was made and the old one no longer works. Copy it now: it is shown only once.", link: done.link };
  if (done.emailed === "sent") return { ok: true, message: "A new link was emailed to the customer. The old one no longer works." };
  if (done.emailed === "logged") return { ok: false, message: "Email is not set up for this store, so nothing was sent. Create a link to share instead." };
  return { ok: false, message: "The email could not be sent. Try again, or create a link to share." };
}

/**
 * *Reopen*: a sent, expired or cancelled draft becomes editable again. Its unpaid order is cancelled (the number stays on it, the stock is released) and the pay link stops
 * working; sending it again makes a new order and a new number. Refused when a payment arrived meanwhile.
 */
export async function reopenDraftAction(storeSlug: string, draftId: string): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const done = await reopenDraft(member.store.id, staffActor(member.account.id), draftId);
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = {
      not_found: GONE,
      not_reopenable: "This draft cannot be reopened: a paid draft is final.",
      paid: "The customer already paid through Stripe. The order is completed; the draft cannot be reopened.",
      processing: "A payment is being processed for this order. Try again in a minute.",
      changed: "The order was paid or changed meanwhile. Reload the page.",
    };
    return { ok: false, message: message[done.problem] };
  }
  refresh();
  return { ok: true, message: "The draft is open again. Its order was cancelled and its stock released." };
}

/** Deletes a draft that is not sent, then goes to the list. */
export async function deleteDraftAction(storeSlug: string, draftId: string): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const done = await deleteDraft(member.store.id, staffActor(member.account.id), draftId);
  if (!done.ok) return { ok: false, message: done.problem === "sent" ? "A sent draft has an order: reopen it first." : GONE };
  refresh();
  redirect(`/admin/${member.store.slug}/orders/drafts`);
}

/**
 * Records money taken outside Kaizen for the draft (bank transfer, cash, other). The owner may; staff may only when the owner allowed it (checked by the server). The order is
 * made and marked paid, the invoice is issued saying it was paid outside the online checkout, and the confirmation goes to the buyer. Kaizen takes no sale fee on money it never touched.
 */
export async function recordPaidOutsideAction(storeSlug: string, draftId: string, input: unknown): Promise<DraftActionResponse> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const done = await recordDraftPaidOutside(member, draftId, input);
  if (!done.ok) {
    const message: Record<typeof done.problem, string> = {
      not_found: GONE,
      not_allowed: "Only the owner can record a payment taken outside Kaizen, unless the owner has allowed staff to (Settings, Orders).",
      invalid: "Choose how it was paid.",
      conflict: CHANGED,
      closed: "This store is not open.",
      no_email: "Add the customer's email address first: the confirmation of the order, which states the right of withdrawal, goes to it.",
      already_paid: "This draft was already paid.",
      processing: "A payment is being processed for this order. Try again in a minute.",
      not_payable: "This draft cannot be marked as paid now.",
      problems: "The draft cannot be turned into an order yet.",
      received_on: `The day the money was received cannot be in the future or more than ${MANUAL_RECEIVED_DAYS_MAX} days back: it decides which VAT period the sale belongs to.`,
      cash_limit: "This country does not let a business receive cash for an amount this large, so it cannot be recorded as cash. Record it as a bank transfer if that is how it was paid, or ask your accountant.",
    };
    return { ok: false, message: message[done.problem], problems: done.problems ? wordsOf(done.problems) : undefined };
  }
  refresh();
  const mailed = done.emailed === "sent" ? "The confirmation was emailed to the customer." : done.emailed === "logged" ? "Email is not set up for this store, so the confirmation was not sent." : "The confirmation could not be sent: send it again from the order.";
  const cash = done.cashWarning ? " Take care: this country has a ceiling on cash payments close to this amount (see the warning beside Cash)." : "";
  return { ok: done.emailed !== "failed", message: `Order ${done.number} is paid and its invoice was issued. ${mailed}${cash}`, orderId: done.orderId };
}

/** Starts a draft in a market (a country in a language and a currency the store offers), then opens it. */
export async function createDraftAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "orders:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const options = draftMarketOptions(member.store.markets, member.store.localization);
  const slug = draftMarketSlug(options, {
    country: String(form.get("country") ?? ""),
    lang: String(form.get("lang") ?? ""),
    currency: String(form.get("currency") ?? ""),
  });
  if (!slug) return { status: "error", messages: ["Choose a country, a language and a currency the store offers."] };
  const made = await createDraft(member.store.id, staffActor(member.account.id), { marketSlug: slug });
  if (!made.ok) return { status: "error", messages: [made.problem === "too_many_open_drafts" ? "The store has 500 open drafts. Delete or send one first." : "Choose a market the store sells to."] };
  refresh();
  redirect(`/admin/${member.store.slug}/orders/drafts/${made.draft.id}`);
}
