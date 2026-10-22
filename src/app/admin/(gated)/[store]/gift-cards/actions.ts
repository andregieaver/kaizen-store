"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { GiftCardsMessages } from "@/lib/admin-messages/gift-cards.en";
import { adminText } from "@/lib/admin-text";
import { parseAmount } from "@/lib/field-money";
import { GIFT_CARD_NOTE_MAX } from "@/lib/gift-card-admin";
import { deliverGiftCards } from "@/server/gift-card-delivery";
import { adjustGiftCard, deactivateGiftCard, issueGiftCard, saveGiftCardSettings, type ChangeProblem } from "@/server/gift-cards-admin";
import { requirePermission } from "@/server/permissions";

/** What issuing a card by hand answers: the code to show once, or why not. */
export type IssueState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; cardId: string; code: string; emailed: "sent" | "failed" | "not_asked" };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** What the actions answer, in the account's language (D312 A5). */
const wordsOf = (member: { account: { adminLocale?: string | null } }): GiftCardsMessages["actions"] =>
  adminText(adminLangOf(member.account.adminLocale), "giftCards").actions;

const issueInput = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  email: z.union([z.literal(""), z.email().max(254)]),
  name: z.string().max(80),
  message: z.string().max(500),
  note: z.string().max(GIFT_CARD_NOTE_MAX),
  lang: z.string().regex(/^[a-z]{2}$/),
});

/**
 * Issues a gift card by hand (D300 F4): the right to change products, the Products section's; the code is answered once and never kept. An
 * amount is read in the card's currency's own decimals.
 */
export async function issueGiftCardAction(storeSlug: string, _state: IssueState, form: FormData): Promise<IssueState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const parsed = issueInput.safeParse({
    currency: text(form, "currency").toUpperCase(),
    email: text(form, "email"),
    name: text(form, "name"),
    message: text(form, "message"),
    note: text(form, "note"),
    lang: text(form, "lang") || "en",
  });
  if (!parsed.success) return { status: "error", message: w.checkCurrencyEmail };
  const amountMinor = parseAmount(text(form, "amount"), parsed.data.currency);
  if (amountMinor === null || amountMinor <= 0) return { status: "error", message: w.amountAboveZero };
  const lang = member.store.localization.locales.some((l) => l.startsWith(parsed.data.lang)) ? parsed.data.lang : (member.store.localization.locales[0] ?? "en").slice(0, 2);
  const outcome = await issueGiftCard(member.store, member.account.id, {
    amountMinor,
    currency: parsed.data.currency,
    recipientEmail: parsed.data.email || null,
    recipientName: parsed.data.name || null,
    message: parsed.data.message || null,
    lang,
    note: parsed.data.note,
  });
  if (!outcome.ok) {
    return {
      status: "error",
      message:
        outcome.problem === "currency" ? w.chooseCurrency : outcome.problem === "amount" ? w.amountPositive : w.noKey,
    };
  }
  refresh();
  return { status: "ok", cardId: outcome.cardId, code: outcome.code, emailed: outcome.emailed };
}

const changeWords = (w: GiftCardsMessages["actions"]): Record<ChangeProblem, string> => ({
  unknown: w.unknown,
  inactive: w.inactive,
  below_zero: w.belowZero,
  reason: w.reason,
  amount: w.notZero,
});

/** Changes a card's balance up or down with a reason (`products:write`). */
export async function adjustGiftCardAction(storeSlug: string, cardId: string, currency: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const CHANGE_WORDS = changeWords(w);
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [CHANGE_WORDS.unknown] };
  const amount = parseAmount(text(form, "amount"), currency);
  if (amount === null || amount === 0) return { status: "error", messages: [CHANGE_WORDS.amount] };
  const signed = text(form, "direction") === "down" ? -amount : amount;
  const done = await adjustGiftCard(member.store.id, member.account.id, cardId, signed, text(form, "reason"));
  if (!done.ok) return { status: "error", messages: [CHANGE_WORDS[done.problem]] };
  refresh();
  return { status: "ok", messages: [w.changed] };
}

/** Deactivates a card: what is left on it goes, for good (`products:write`). */
export async function deactivateGiftCardAction(storeSlug: string, cardId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const CHANGE_WORDS = changeWords(w);
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [CHANGE_WORDS.unknown] };
  const done = await deactivateGiftCard(member.store.id, member.account.id, cardId, text(form, "reason"));
  if (!done.ok) return { status: "error", messages: [CHANGE_WORDS[done.problem]] };
  refresh();
  return { status: "ok", messages: [w.deactivated] };
}

/** Tries again to deliver a bought card whose day has come and whose email did not go (`products:write`). */
export async function sendGiftCardAgainAction(storeSlug: string, cardId: string, _state: FormState): Promise<FormState> {
  const w = wordsOf(await requirePermission(storeSlug, "products:write"));
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [w.unknown] };
  const run = await deliverGiftCards({ cardId });
  refresh();
  return run.sent > 0 ? { status: "ok", messages: [w.sent] } : { status: "error", messages: [w.notSent] };
}

/** How long new cards last (`products:write`): cards already issued keep their date. */
export async function saveGiftCardSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const value = text(form, "expiry");
  const months = value === "never" ? null : Number(value);
  const ok = await saveGiftCardSettings(member.store.id, member.account.id, months);
  if (!ok) return { status: "error", messages: [w.expiryRange] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}
