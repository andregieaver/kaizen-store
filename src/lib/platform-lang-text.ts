import type { PlatformLang } from "./platform-lang";

/**
 * The words of the language switch and the suggestion bar (D312), each in the language it offers, so a reader of that language
 * understands it whatever the page is in. Written by hand; the rest of the site's own texts are P2's catalogue.
 */
export const LANGUAGE_HINT_TEXT: Record<PlatformLang, { offer: string; go: string; close: string; switchLabel: string }> = {
  en: { offer: "Kaizena Flow's site is in English too.", go: "Read it in English", close: "Close", switchLabel: "Language" },
  nb: { offer: "Kaizena Flows nettsted finnes også på norsk.", go: "Les det på norsk", close: "Lukk", switchLabel: "Språk" },
};

/** Where the suggestion bar keeps, with a visitor's consent to preferences, that they closed it (`KNOWN_COOKIES`, `kaizen_lang_hint`). */
export const LANGUAGE_HINT_KEY = "kaizen_lang_hint";
