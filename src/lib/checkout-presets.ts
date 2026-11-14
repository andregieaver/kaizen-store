import type { Words } from "./checkout-rules";

/**
 * Ready-made tick lists for checkout questions (task 3 of `docs/checkout-fields-tasks.md`, D598). The EU's 14 allergens are Annex II of
 * Regulation (EU) No 1169/2011 (food information to consumers), named as the regulation names them in each language, hand-written in nb, sv, da
 * and en. An allergen question is sensitive (GDPR article 9: a shopper's allergies may be health data), so the cart asks the shopper's explicit
 * consent once an allergen is ticked; "None of these" needs none. The owner's decision of 14 November 2026: a consent line, answers kept as
 * long as the order's other answers.
 */

type Lang = "nb" | "sv" | "da" | "en";
type ByLang = Record<Lang, string>;

/** The 14 allergens of Annex II, in the regulation's order. */
const ALLERGENS: readonly ByLang[] = [
  { en: "Cereals containing gluten", nb: "Korn som inneholder gluten", sv: "Spannmål som innehåller gluten", da: "Glutenholdige kornprodukter" },
  { en: "Crustaceans", nb: "Skalldyr", sv: "Kräftdjur", da: "Krebsdyr" },
  { en: "Eggs", nb: "Egg", sv: "Ägg", da: "Æg" },
  { en: "Fish", nb: "Fisk", sv: "Fisk", da: "Fisk" },
  { en: "Peanuts", nb: "Peanøtter", sv: "Jordnötter", da: "Jordnødder" },
  { en: "Soybeans", nb: "Soya", sv: "Sojabönor", da: "Soja" },
  { en: "Milk", nb: "Melk", sv: "Mjölk", da: "Mælk" },
  { en: "Nuts", nb: "Nøtter", sv: "Nötter", da: "Nødder" },
  { en: "Celery", nb: "Selleri", sv: "Selleri", da: "Selleri" },
  { en: "Mustard", nb: "Sennep", sv: "Senap", da: "Sennep" },
  { en: "Sesame seeds", nb: "Sesamfrø", sv: "Sesamfrön", da: "Sesamfrø" },
  { en: "Sulphur dioxide and sulphites", nb: "Svoveldioksid og sulfitter", sv: "Svaveldioxid och sulfiter", da: "Svovldioxid og sulfitter" },
  { en: "Lupin", nb: "Lupin", sv: "Lupin", da: "Lupin" },
  { en: "Molluscs", nb: "Bløtdyr", sv: "Blötdjur", da: "Bløddyr" },
];

const NONE: ByLang = { en: "None of these", nb: "Ingen av disse", sv: "Inget av dessa", da: "Ingen af disse" };
const QUESTION: ByLang = { en: "Allergies we should know about", nb: "Allergier vi bør vite om", sv: "Allergier vi bör känna till", da: "Allergier, vi bør kende til" };
const HELP: ByLang = {
  en: "Tick the allergens that apply, or None of these.",
  nb: "Kryss av for allergenene som gjelder, eller Ingen av disse.",
  sv: "Kryssa i de allergener som gäller, eller Inget av dessa.",
  da: "Sæt kryds ved de allergener, der gælder, eller Ingen af disse.",
};

/** The language a store's locale is written in for this list: Norwegian (nb, no, nn), Swedish, Danish, else English. */
function langOf(locale: string): Lang {
  const lang = locale.toLowerCase().split("-")[0];
  if (lang === "nb" || lang === "no" || lang === "nn") return "nb";
  if (lang === "sv" || lang === "da") return lang;
  return "en";
}

/** Words in the store's main locale, with its other locales' own (each in its language). */
const wordsFor = (text: ByLang, locales: readonly string[]): Words => ({
  text: text[langOf(locales[0] ?? "en")],
  byLocale: Object.fromEntries(locales.slice(1).map((l) => [l, text[langOf(l)]])),
});

/** The EU allergen question for a store with these locales (its main one first): a sensitive tick list ending with None of these. */
export function allergenQuestion(locales: readonly string[]) {
  return {
    label: wordsFor(QUESTION, locales),
    help: wordsFor(HELP, locales),
    options: [...ALLERGENS.map((a) => ({ label: wordsFor(a, locales) })), { label: wordsFor(NONE, locales), none: true }],
    sensitive: true,
  };
}

/** How many allergens Annex II lists (for tests and words). */
export const EU_ALLERGEN_COUNT = ALLERGENS.length;
