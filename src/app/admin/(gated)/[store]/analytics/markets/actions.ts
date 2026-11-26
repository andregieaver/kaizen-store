"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { MARKET_CHECK_WORDS } from "@/lib/admin-words/market-check";
import { OFFERS_PER_RIVAL, RIVALS_PER_MARKET, SERVICE_PRICES_PER_RIVAL } from "@/lib/market-rivals";
import { englishMoney } from "@/lib/money";
import { addRival, keepServicePrice, readRivalOffer, removeRival, removeServicePrice, RivalError, ServicePriceError } from "@/server/market-rivals";
import { OwnerToolError } from "@/server/owner-tool-error";
import { storeAction } from "@/server/store-action";

/**
 * Analytics → Markets' rivals (D900 M2): add a rival, remove one, read one of its product pages; keep or remove a rival's published service
 * price (D905 M5d). Bound to the store's slug; each runs
 * through `storeAction()` with `analytics:write`, and the server module refuses the rest (`src/server/market-rivals.ts`). A refusal is said
 * in the member's language; a page that could not be read says why in the reader's own words. The three share one export, `rivalsAction`,
 * which the page binds once for each form: every `"use server"` export is an entry of the server-reference manifest, which the route budget
 * holds (`scripts/route-budget.json`).
 */

type Words = (typeof MARKET_CHECK_WORDS)["en"]["rivals"];

/** A refusal of the server module's in the member's words; anything else is a failure `storeAction()` logs. */
function refusal(w: Words, error: unknown): FormState {
  if (error instanceof ServicePriceError) return { status: "error", messages: [fillWords(w.prices.problems[error.problem], { n: SERVICE_PRICES_PER_RIVAL })] };
  if (error instanceof RivalError) {
    return { status: "error", messages: [fillWords(w.problems[error.problem], { n: error.problem === "full" ? RIVALS_PER_MARKET : OFFERS_PER_RIVAL })] };
  }
  if (error instanceof OwnerToolError) return { status: "error", messages: [fillWords(w.problems.unreadable, { why: error.message })] };
  throw error;
}

/** How `storeAction()` says a refusal or a failure here: the form's problem. */
const said = { answer: (message: string): FormState => ({ status: "error", messages: [message] }) };

async function addRivalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
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

async function removeRivalAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_remove", answer: said.answer }, async (member, lang) => {
    if (!(await removeRival(member, String(form.get("rival") ?? "")))) return said.answer(MARKET_CHECK_WORDS[lang].rivals.problems.rival);
    refresh();
    return { status: "ok", messages: [] };
  });
}

async function readRivalOfferAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
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

async function keepPriceAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_price_keep", answer: said.answer }, async (member, lang) => {
    const w = MARKET_CHECK_WORDS[lang].rivals;
    const field = (name: string) => String(form.get(name) ?? "");
    try {
      const kept = await keepServicePrice(member, {
        rival: field("rival"),
        service: field("service"),
        price: field("price"),
        currency: field("currency"),
        per: field("per"),
        own: field("own"),
        product: field("product"),
        source: field("source"),
      });
      refresh();
      return { status: "ok", messages: [fillWords(w.prices.kept, { service: kept.service, price: englishMoney(kept.priceMinor, kept.currency) })] };
    } catch (error) {
      return refusal(w, error);
    }
  });
}

async function removePriceAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.rival_price_remove", answer: said.answer }, async (member, lang) => {
    if (!(await removeServicePrice(member, String(form.get("price") ?? "")))) return said.answer(MARKET_CHECK_WORDS[lang].rivals.prices.problems.rival);
    refresh();
    return { status: "ok", messages: [] };
  });
}

export type RivalIntent = "add" | "remove" | "read" | "keepPrice" | "removePrice";

/** The rivals' one server function: the page binds the store and which form it is (`add`, `remove`, `read`, `keepPrice`, `removePrice`). */
export async function rivalsAction(storeSlug: string, intent: RivalIntent, state: FormState, form: FormData): Promise<FormState> {
  switch (intent) {
    case "add":
      return addRivalAction(storeSlug, state, form);
    case "remove":
      return removeRivalAction(storeSlug, state, form);
    case "read":
      return readRivalOfferAction(storeSlug, state, form);
    case "keepPrice":
      return keepPriceAction(storeSlug, state, form);
    case "removePrice":
      return removePriceAction(storeSlug, state, form);
    default:
      return { status: "error", messages: [] };
  }
}
