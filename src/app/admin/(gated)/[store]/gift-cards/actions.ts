"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { parseAmount } from "@/lib/field-money";
import { GIFT_CARD_NOTE_MAX } from "@/lib/gift-card-admin";
import { deliverGiftCards } from "@/server/gift-card-delivery";
import { adjustGiftCard, deactivateGiftCard, issueGiftCard, saveGiftCardSettings, type ChangeProblem } from "@/server/gift-cards-admin";
import { requirePermission } from "@/server/permissions";

/** What issuing a card by hand answers: the code to show once, or why not. */
export type IssueState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; cardId: string; code: string; emailed: "sent" | "failed" | "not_asked" };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

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
  const parsed = issueInput.safeParse({
    currency: text(form, "currency").toUpperCase(),
    email: text(form, "email"),
    name: text(form, "name"),
    message: text(form, "message"),
    note: text(form, "note"),
    lang: text(form, "lang") || "en",
  });
  if (!parsed.success) return { status: "error", message: "Check the currency and the email address." };
  const amountMinor = parseAmount(text(form, "amount"), parsed.data.currency);
  if (amountMinor === null || amountMinor <= 0) return { status: "error", message: "Give an amount above zero, such as 500 or 250.50." };
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
        outcome.problem === "currency"
          ? "Choose a currency the store sells in."
          : outcome.problem === "amount"
            ? "Give an amount above zero."
            : "Gift cards can't be made on this server: its settings key is missing.",
    };
  }
  refresh();
  return { status: "ok", cardId: outcome.cardId, code: outcome.code, emailed: outcome.emailed };
}

const CHANGE_WORDS: Record<ChangeProblem, string> = {
  unknown: "That gift card is not in this store.",
  inactive: "A deactivated gift card can't be changed.",
  below_zero: "That would take the card below zero: it holds less than that.",
  reason: "Say why: the reason is kept with the change.",
  amount: "Give an amount that is not zero.",
};

/** Changes a card's balance up or down with a reason (`products:write`). */
export async function adjustGiftCardAction(storeSlug: string, cardId: string, currency: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [CHANGE_WORDS.unknown] };
  const amount = parseAmount(text(form, "amount"), currency);
  if (amount === null || amount === 0) return { status: "error", messages: [CHANGE_WORDS.amount] };
  const signed = text(form, "direction") === "down" ? -amount : amount;
  const done = await adjustGiftCard(member.store.id, member.account.id, cardId, signed, text(form, "reason"));
  if (!done.ok) return { status: "error", messages: [CHANGE_WORDS[done.problem]] };
  refresh();
  return { status: "ok", messages: ["Changed."] };
}

/** Deactivates a card: what is left on it goes, for good (`products:write`). */
export async function deactivateGiftCardAction(storeSlug: string, cardId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [CHANGE_WORDS.unknown] };
  const done = await deactivateGiftCard(member.store.id, member.account.id, cardId, text(form, "reason"));
  if (!done.ok) return { status: "error", messages: [CHANGE_WORDS[done.problem]] };
  refresh();
  return { status: "ok", messages: ["Deactivated."] };
}

/** Tries again to deliver a bought card whose day has come and whose email did not go (`products:write`). */
export async function sendGiftCardAgainAction(storeSlug: string, cardId: string, _state: FormState): Promise<FormState> {
  await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(cardId).success) return { status: "error", messages: [CHANGE_WORDS.unknown] };
  const run = await deliverGiftCards({ cardId });
  refresh();
  return run.sent > 0 ? { status: "ok", messages: ["Sent."] } : { status: "error", messages: ["It was not sent: its day may not have come, or the email failed again. Look at Emails for why."] };
}

/** How long new cards last (`products:write`): cards already issued keep their date. */
export async function saveGiftCardSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const value = text(form, "expiry");
  const months = value === "never" ? null : Number(value);
  const ok = await saveGiftCardSettings(member.store.id, member.account.id, months);
  if (!ok) return { status: "error", messages: ["Choose 12 to 120 months, or Never."] };
  refresh();
  return { status: "ok", messages: ["Saved. Cards already issued keep their date."] };
}
