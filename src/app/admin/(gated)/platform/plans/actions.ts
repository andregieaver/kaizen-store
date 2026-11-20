"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { isPriceTuningLevel, PRICE_TUNING_RANGE_MAX, PRICE_TUNING_RANGE_MIN } from "@/lib/price-tuning";
import { savePriceTuning } from "@/server/price-tuning";
import { platformAction } from "@/server/store-action";

/** How far the AI may change Kaizena Flow's prices (D854), on Platform → Plans: the plans area, write. */
export async function savePriceTuningAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.price_tuning_save", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    const w = PLATFORM_WORDS[lang].plans.aiPrices;
    const level = form.get("level");
    const range = Number.parseInt(String(form.get("range") ?? ""), 10);
    if (!isPriceTuningLevel(level)) return { status: "error", messages: [w.badRange] };
    if (!(range >= PRICE_TUNING_RANGE_MIN && range <= PRICE_TUNING_RANGE_MAX)) return { status: "error", messages: [w.badRange] };
    const result = await savePriceTuning(account, { level, rangePercent: range });
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}
