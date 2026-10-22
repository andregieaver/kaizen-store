import type { Widen } from "./common.en";

/**
 * The words of the store's Domains page (D312, D313 `docs/language-domains.md`), converted as they were written: a language's own domain.
 * `{name}` is a language's name.
 */
export const domainsEn = {
  forOneLanguage: "Use for one language",
  language: "Language",
  everyLanguage: "Every language: leads to your address",
  languageOption: "{name}: your store in {name} here",
  activeInLanguage: "Active: your store in {name}",
  forLanguage: "For {name}",
  explain:
    "A language's own domain shows your store in that language without the language in its addresses. Each domain keeps its own cart, sign-in and cookie choices, as browsers keep them per site.",
  save: "Save",
};

export type DomainsMessages = Widen<typeof domainsEn>;
