"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { SettingsMessages } from "@/lib/admin-messages/settings.en";
import { adminText } from "@/lib/admin-text";
import { isPriceDecimals } from "@/lib/money";
import { NO_WORDS, type WordsByLocale } from "@/lib/price-words";
import { isQuantityPicker } from "@/lib/quantity-stepper";
import { countryName } from "@/lib/vat-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { readPriceDisplay, savePriceDisplay, type PriceDisplayProblem } from "@/server/price-display";

/** The admin's language as a locale, for the names of languages and countries in a message. */
const nameLocale = (lang: AdminLang) => (lang === "nb" ? "nb-NO" : "en-GB");

/**
 * Saves how the store shows prices and quantities (D429, D430): decimals, the words around a product's price in each language and the
 * quantity chooser, with each country's own decimals from the Advanced fold. `settings:write`; `savePriceDisplay()` checks every value
 * again and refreshes the store. A language the form does not show (kept while Several languages is off) keeps its words as they are; a
 * language other than the main one is written only when its own words are ticked, so it otherwise follows the main one's.
 */
export async function savePriceDisplayAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "settings").common.noChange] };
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "settings").prices;
  const { localization } = member.store;
  const shown = localization.locales;
  const main = shown[0] ?? "";
  const before = await readPriceDisplay(member.store.id);

  const text = (name: string) => String(form.get(name) ?? "");
  // Words kept for languages this form does not show, then the shown ones as typed: the main always, the others when ticked.
  const words: WordsByLocale = Object.fromEntries(Object.entries(before.words).filter(([locale]) => !shown.includes(locale)));
  for (const locale of shown) {
    if (locale !== main && form.get(`own:${locale}`) !== "on") continue;
    words[locale] = { ...NO_WORDS, prefix: text(`prefix:${locale}`), suffix: text(`suffix:${locale}`) };
  }
  const decimals = text("decimals");
  const picker = text("quantityPicker");
  const result = await savePriceDisplay(
    member,
    {
      decimals: isPriceDecimals(decimals) ? decimals : before.decimals,
      quantityPicker: isQuantityPicker(picker) ? picker : before.quantityPicker,
      markets: before.markets.map((market) => {
        const chosen = text(`market:${market.code}`);
        return { code: market.code, decimals: isPriceDecimals(chosen) ? chosen : null };
      }),
      words,
    },
    localization.keptLocales,
  );
  if (!result.ok) {
    const said = result.problems.map((problem) => problemText(problem, w, lang));
    const fields = Object.fromEntries(result.problems.flatMap((problem, i) => (problem.kind === "word" ? [[`${problem.place}:${problem.locale}`, said[i]]] : [])));
    return { status: "error", messages: [...new Set(said)], fields };
  }
  refresh();
  return { status: "ok", messages: [w.saved] };
}

function problemText(problem: PriceDisplayProblem, w: SettingsMessages["prices"], lang: AdminLang): string {
  switch (problem.kind) {
    case "decimals":
      return w.problems.decimals;
    case "picker":
      return w.problems.picker;
    case "market":
      return fillWords(w.problems.market, { country: countryName(problem.code, nameLocale(lang)) });
    case "word": {
      const where = {
        place: problem.place === "prefix" ? w.before : w.after,
        language: new Intl.DisplayNames([nameLocale(lang)], { type: "language" }).of(problem.locale) ?? problem.locale,
      };
      const found = problem.problem;
      if (found.kind === "long") return fillWords(w.problems.long, { ...where, max: found.max });
      if (found.kind === "plain") return fillWords(w.problems.plain, where);
      if (found.kind === "percent") return fillWords(w.problems.percent, where);
      return fillWords(w.problems.claim, { ...where, phrase: found.phrase, kind: w.claimKinds[found.claim] });
    }
  }
}
