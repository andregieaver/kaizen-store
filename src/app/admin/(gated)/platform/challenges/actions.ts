"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { parsePrice } from "@/lib/product-input";
import { endChallenge, saveChallenge } from "@/server/autopilot-settings";
import { pinChallenge } from "@/server/challenge-pin";
import { freezeBaseline, removeOriginalPeriod, saveOriginalPeriod } from "@/server/challenge-scoreboard";
import { storeIdBySlug } from "@/server/challenge-console";
import { OwnerToolError } from "@/server/owner-tool-error";
import { platformAction } from "@/server/store-action";

/**
 * The 100-day challenge's console (`docs/100-day-challenge.md` H2): setting, changing and ending a store's challenge is the settings area's
 * (an owner of the platform, D510), and `saveChallenge()` / `endChallenge()` hold it to a platform admin as well.
 */

const PATH = "/admin/platform/challenges";
const answer = (message: string): FormState => ({ status: "error", messages: [message] });
const write = (action: string) => ({ area: "settings" as const, action, answer });

/** The challenge's budgets as the form sends them: a number each, or left out for the challenge's default. */
const BUDGETS = [
  "broadcastsPerWeek",
  "supportRepliesPerDay",
  "aiMonthlyUsd",
  "priceChangePercent",
  "discountPercent",
  "adRaisePercent",
  "marginFloorPercent",
  "purchasePerOrder",
  "purchaseMonthly",
  "adMoney",
] as const;

/** The challenge from the form: its three dates, and each budget given. */
function challengeInput(formData: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of ["startsOn", "dayOne", "endsOn"] as const) input[key] = String(formData.get(key) ?? "");
  for (const key of BUDGETS) {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    if (raw !== "") input[key] = Number(raw);
  }
  return input;
}

/** Sets the challenge on the store at the address given, or changes its dates and budgets. */
export async function saveChallengeAction(_state: FormState, formData: FormData): Promise<FormState> {
  return platformAction(write("challenge.save"), async (account, lang) => {
    const w = adminText(lang, "console").challenges;
    const slug = String(formData.get("store") ?? "").trim().toLowerCase();
    const storeId = slug ? await storeIdBySlug(slug) : null;
    if (!storeId) return { status: "error", messages: [w.unknownStore], fields: { store: w.unknownStore } };
    try {
      // What the store's AI runs on is pinned when the challenge is first set (F5); a change after that is logged by the watch.
      await pinChallenge(storeId, await saveChallenge({ account }, storeId, challengeInput(formData)));
    } catch (error) {
      // The challenge's own refusals (a date in the wrong order, a budget out of range) are said as they are.
      if (error instanceof OwnerToolError) return answer(error.message);
      throw error;
    }
    revalidatePath(PATH);
    return { status: "ok", messages: [fillWords(w.saved, { store: slug })] };
  });
}

/** Takes the challenge off a store: the owner's own autopilot settings are in force again. */
export async function endChallengeAction(storeId: string): Promise<FormState> {
  return platformAction(write("challenge.end"), async (account, lang) => {
    const w = adminText(lang, "console").challenges;
    if (!z.uuid().safeParse(storeId).success) return answer(w.unknownStore);
    await endChallenge({ account }, storeId);
    revalidatePath(PATH);
    return { status: "ok", messages: [w.ended] };
  });
}

/** The original's money figures as the form sends them, in the currency's minor units; the field's name when one is not an amount. */
const MONEY_FIELDS = ["netSales", "cogs", "shipping", "paymentFees", "marketing", "other"] as const;

/** Adds a period of the original's signed P&L to the store's scoreboard (E7), or replaces the one that starts the same day. */
export async function saveOriginalAction(storeId: string, _state: FormState, formData: FormData): Promise<FormState> {
  return platformAction(write("challenge.original_save"), async (account, lang) => {
    const w = adminText(lang, "console").challenges.board;
    if (!z.uuid().safeParse(storeId).success) return answer(adminText(lang, "console").challenges.unknownStore);
    const text = (key: string) => String(formData.get(key) ?? "").trim();
    const currency = text("currency").toUpperCase();
    const input: Record<string, unknown> = { from: text("from"), to: text("to"), currency, signedBy: text("signedBy"), signedOn: text("signedOn") };
    for (const field of MONEY_FIELDS) {
      const raw = text(field);
      if (raw === "" && field !== "netSales" && field !== "cogs") continue;
      const minor = parsePrice(raw, currency || "NOK");
      if (minor === null || minor < 0) return answer(fillWords(w.badAmount, { field: w.fields[field].toLowerCase() }));
      input[`${field}Minor`] = minor;
    }
    for (const field of ["sessions", "orders"] as const) if (text(field) !== "") input[field] = Number(text(field));
    try {
      await saveOriginalPeriod({ account }, storeId, input);
    } catch (error) {
      if (error instanceof OwnerToolError) return answer(error.message);
      throw error;
    }
    revalidatePath(`${PATH}/${storeId}`);
    return { status: "ok", messages: [w.saved] };
  });
}

/** Takes a period of the original's figures off the scoreboard. */
export async function removeOriginalAction(storeId: string, from: string): Promise<FormState> {
  return platformAction(write("challenge.original_remove"), async (account, lang) => {
    const w = adminText(lang, "console").challenges.board;
    if (!z.uuid().safeParse(storeId).success || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return answer(adminText(lang, "console").challenges.unknownStore);
    await removeOriginalPeriod({ account }, storeId, from);
    revalidatePath(`${PATH}/${storeId}`);
    return { status: "ok", messages: [w.removed] };
  });
}

/** Freezes the challenge's baseline before Day 1 (E7, D648): the clone's cost estimates, the agreed ad money and its goods' cost prices. */
export async function freezeBaselineAction(storeId: string): Promise<FormState> {
  return platformAction(write("challenge.baseline_freeze"), async (account, lang) => {
    const w = adminText(lang, "console").challenges.board;
    if (!z.uuid().safeParse(storeId).success) return answer(adminText(lang, "console").challenges.unknownStore);
    try {
      await freezeBaseline({ account }, storeId);
    } catch (error) {
      if (error instanceof OwnerToolError) return answer(error.message);
      throw error;
    }
    revalidatePath(`${PATH}/${storeId}`);
    return { status: "ok", messages: [w.baseline.frozenNow] };
  });
}
