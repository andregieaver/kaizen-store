"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { endChallenge, saveChallenge } from "@/server/autopilot-settings";
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
const BUDGETS = ["broadcastsPerWeek", "supportRepliesPerDay", "aiMonthlyUsd", "priceChangePercent", "discountPercent", "adRaisePercent", "marginFloorPercent"] as const;

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
      await saveChallenge({ account }, storeId, challengeInput(formData));
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
