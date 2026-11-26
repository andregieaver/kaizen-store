"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { fillWords } from "@/lib/admin-fill";
import { isPriceTuningLevel, PRICE_TUNING_RANGE_MAX, PRICE_TUNING_RANGE_MIN } from "@/lib/price-tuning";
import { keepPlatformRivalPrice, PLATFORM_RIVAL_PRICES_MAX, PlatformRivalError, removePlatformRivalPrice } from "@/server/market-rivals";
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

const said = { answer: (message: string): FormState => ({ status: "error", messages: [message] }) };

/**
 * Other store platforms' prices (D900 M4), on Platform → Plans: keep one as read on its platform's own page, or remove one. One server
 * function the card binds for each form (`keep`, `remove`), as every export is an entry of the server-reference manifest.
 */
export async function platformRivalsAction(intent: "keep" | "remove", _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: intent === "keep" ? "platform.rival_price_keep" : "platform.rival_price_remove", answer: said.answer }, async (account, lang) => {
    const w = PLATFORM_WORDS[lang].plans.rivals;
    if (intent === "remove") {
      if (!(await removePlatformRivalPrice(account, String(form.get("price") ?? "")))) return said.answer(w.problems.gone);
      refresh();
      return { status: "ok", messages: [w.removed] };
    }
    const field = (name: string) => String(form.get(name) ?? "");
    try {
      const kept = await keepPlatformRivalPrice(account, {
        platform: field("platform"),
        plan: field("plan"),
        price: field("price"),
        currency: field("currency"),
        interval: field("interval"),
        fee: field("fee"),
        ours: field("ours"),
        source: field("source"),
      });
      refresh();
      const name = `${field("platform").trim()} ${field("plan").trim()}`;
      const words = kept.onPage === null ? w.keptUnread : kept.onPage ? w.kept : w.keptUnconfirmed;
      return { status: "ok", messages: [fillWords(words, { name })] };
    } catch (error) {
      if (error instanceof PlatformRivalError) return said.answer(fillWords(w.problems[error.problem], { n: PLATFORM_RIVAL_PRICES_MAX }));
      throw error;
    }
  });
}

