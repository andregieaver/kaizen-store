"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { MARKET_CHECK_WORDS } from "@/lib/admin-words/market-check";
import { OFFERS_PER_RIVAL, RIVALS_PER_MARKET } from "@/lib/market-rivals";
import { englishMoney } from "@/lib/money";
import { addRival, readRivalOffer, removeRival, RivalError } from "@/server/market-rivals";
import { OwnerToolError } from "@/server/owner-tool-error";
import { storeAction } from "@/server/store-action";

/**
 * Analytics → Markets' rivals (D900 M2): add a rival, remove one, read one of its product pages. Bound to the store's slug; each runs
 * through `storeAction()` with `analytics:write`, and the server module refuses the rest (`src/server/market-rivals.ts`). A refusal is said
 * in the member's language; a page that could not be read says why in the reader's own words.
 */

type Words = (typeof MARKET_CHECK_WORDS)["en"]["rivals"];

/** A refusal of the server module's in the member's words; anything else is a failure `storeAction()` logs. */
function refusal(w: Words, error: unknown): FormState {
  if (error instanceof RivalError) {
    return { status: "error", messages: [fillWords(w.problems[error.problem], { n: error.problem === "full" ? RIVALS_PER_MARKET : OFFERS_PER_RIVAL })] };
  }
  if (error instanceof OwnerToolError) return { status: "error", messages: [fillWords(w.problems.unreadable, { why: error.message })] };
  throw error;
}

/** How `storeAction()` says a refusal or a failure here: the form's problem. */
const said = { answer: (message: string): FormState => ({ status: "error", messages: [message] }) };

export async function addRivalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_add", answer: said.answer }, async (member, lang) => {
    const w = MARKET_CHECK_WORDS[lang].rivals;
    try {
      const rival = await addRival(member, { market: String(form.get("market") ?? ""), name: String(form.get("name") ?? ""), address: String(form.get("address") ?? "") });
      refresh();
      return { status: "ok", messages: [fillWords(w.added, { name: rival.name })] };
    } catch (error) {
      return refusal(w, error);
    }
  });
}

export async function removeRivalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_remove", answer: said.answer }, async (member, lang) => {
    if (!(await removeRival(member, String(form.get("rival") ?? "")))) return said.answer(MARKET_CHECK_WORDS[lang].rivals.problems.rival);
    refresh();
    return { status: "ok", messages: [] };
  });
}

export async function readRivalOfferAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_read", answer: said.answer }, async (member, lang) => {
    const w = MARKET_CHECK_WORDS[lang].rivals;
    try {
      const input = { rival: String(form.get("rival") ?? ""), page: String(form.get("page") ?? "").trim(), product: String(form.get("product") ?? "") || null };
      const { offer } = await readRivalOffer(member, input);
      refresh();
      return { status: "ok", messages: [fillWords(w.readOk, { name: offer.name, price: englishMoney(offer.priceMinor, offer.currency) })] };
    } catch (error) {
      return refusal(w, error);
    }
  });
}
