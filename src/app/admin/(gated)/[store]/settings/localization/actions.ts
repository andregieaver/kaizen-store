"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { parseRate, stepMinor } from "@/lib/currency";
import { isOfferable, languageOptions } from "@/lib/localization";
import { OFFERABLE_CURRENCIES } from "@/lib/money";
import { featureOffText, featureOn } from "@/lib/store-features";
import { type Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { enabledLanguages } from "@/server/languages";
import { fetchRatesNow, saveCurrencies, saveLanguages, type CurrencyInput } from "@/server/localization";
import type { SaveResult } from "@/server/settings";
import { STORES_TAG } from "@/server/seo";
import { storeTag } from "@/server/stores";

// What a store offers is read by its layouts, catalogue and emails, so a
// change clears the store's and its catalogue's caches.

async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  return (await checkOwnerRole(storeSlug)) ?? { status: "error", messages: ["Only an owner can change this."] };
}

function done(member: Membership, result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  updateTag(STORES_TAG);
  refresh();
  return { status: "ok", messages: [result.note ?? success] };
}

/** The store's languages (main first) and each country's default language. */
export async function saveLanguagesAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  // The languages are hidden while Several languages is off (D178): a stale page changes nothing.
  if (!featureOn(owner.store, "languages")) return { status: "error", messages: [featureOffText("languages")] };
  const locales: string[] = [];
  const offered = await enabledLanguages();
  for (const { lang, locales: variants } of languageOptions(offered)) {
    if (formData.get(`language:${lang}`) !== "on") continue;
    const variant = String(formData.get(`variant:${lang}`) ?? variants[0]);
    locales.push(variants.includes(variant) ? variant : variants[0]);
  }
  // The main language goes first.
  const main = String(formData.get("main") ?? "");
  const mainLocale = locales.find((locale) => locale.split("-")[0] === main);
  const ordered = mainLocale ? [mainLocale, ...locales.filter((locale) => locale !== mainLocale)] : locales;
  const marketLocales: Record<string, string> = {};
  for (const market of owner.store.markets) {
    const chosen = String(formData.get(`market:${market.code}`) ?? "");
    const locale = ordered.find((l) => l.split("-")[0] === chosen);
    if (locale && isOfferable(offered, locale)) marketLocales[market.code] = locale;
  }
  return done(owner, await saveLanguages(owner, ordered, marketLocales), "Languages saved.");
}

/** The currencies offered, their rates and rounding, and whether the rates follow the ECB's. */
export async function saveCurrenciesAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  // The currencies are hidden while Several currencies is off (D178): a stale page changes nothing, and the rates are kept as they are.
  if (!featureOn(owner.store, "currencies")) return { status: "error", messages: [featureOffText("currencies")] };
  const natives = new Set(owner.store.keptMarkets.map((market) => market.nativeCurrency));
  const rows: CurrencyInput[] = [];
  const problems: string[] = [];
  for (const currency of OFFERABLE_CURRENCIES) {
    if (!natives.has(currency) && formData.get(`offer:${currency}`) !== "on") continue;
    const rateText = String(formData.get(`rate:${currency}`) ?? "").trim();
    const rate = currency === "EUR" ? 1 : rateText ? parseRate(rateText) : null;
    if (rateText && rate === null) problems.push(`"${rateText}" is not a rate for ${currency}.`);
    const step = Number(String(formData.get(`round:${currency}`) ?? "0").replace(",", "."));
    rows.push({ currency, rate, roundTo: Number.isFinite(step) && step > 0 ? stepMinor(currency, step) : 1 });
  }
  if (problems.length > 0) return { status: "error", messages: problems };
  return done(owner, await saveCurrencies(owner, rows, formData.get("ratesAuto") === "on"), "Currencies saved.");
}

/** Sets the rates to the ECB's latest now. */
export async function fetchRatesAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  if (!featureOn(owner.store, "currencies")) return { status: "error", messages: [featureOffText("currencies")] };
  return done(owner, await fetchRatesNow(owner), "Rates updated.");
}
