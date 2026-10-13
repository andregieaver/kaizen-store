import { daBrowser } from "./messages/da-browser";
import { enBrowser, type BrowserMessages } from "./messages/en-browser";
import { nbBrowser } from "./messages/nb-browser";
import { svBrowser } from "./messages/sv-browser";
import { registeredUi } from "./ui-registry";

export type { BrowserMessages };

/**
 * The interface text a visitor's client components read (D212). `t()` in `i18n.ts` holds every text of every language, 270 KB that
 * only the server and the admin need; a visitor's browser gets the few texts its client components read (`messages/*-browser.ts`,
 * about 4 KB a language), loaded with the page, so nothing waits for a language when the page wakes up. A language translated by
 * AI (D111) is these English texts with the catalogue's laid over them (`UiTexts`), else English.
 */
const HAND: Partial<Record<string, BrowserMessages>> = { nb: nbBrowser, sv: svBrowser, da: daBrowser, en: enBrowser };

export function browserText(lang: string): BrowserMessages {
  return (Object.hasOwn(HAND, lang) ? HAND[lang] : undefined) ?? (registeredUi(lang) as BrowserMessages | undefined) ?? enBrowser;
}
