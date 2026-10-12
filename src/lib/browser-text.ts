import type { Messages } from "./messages/en";
import { registeredUi } from "./ui-registry";

/**
 * The interface text a visitor's client components read (D212). The hand-written languages are each a module of their own
 * (`src/lib/messages/`); `t()` in `i18n.ts` imports them all, which the server and the admin may, but a visitor's browser loads
 * only the page's language: the root layout draws `LanguageTexts`, whose script for that language registers it here before
 * anything under it is drawn (on the server as in the browser). A language translated by AI (D111) is English with the
 * catalogue's texts over it (`UiTexts`). Kept on `globalThis` like the AI languages' registry, so separately bundled modules
 * share it.
 */
const KEY = "__kaizenHandText";

function registry(): Map<string, Messages> {
  const scope = globalThis as unknown as Record<string, Map<string, Messages> | undefined>;
  return (scope[KEY] ??= new Map());
}

/** Makes a hand-written language's text available to `browserText()`; called by its `LanguageTexts` module. */
export function registerHandText(lang: string, messages: Messages): void {
  registry().set(lang, messages);
}

/**
 * Text for a language subtag, as `t()` gives it, from what this page loaded: the hand-written language, else one translated by AI,
 * else English. A page that loaded no text at all draws a client component outside `LanguageTexts`, which is a mistake in code.
 */
export function browserText(lang: string): Messages {
  const found = registry().get(lang) ?? (registeredUi(lang) as Messages | undefined) ?? registry().get("en");
  if (!found) throw new Error(`No interface text on this page for "${lang}": draw the page inside <LanguageTexts>.`);
  return found;
}

/** The languages written by hand, each with a script of its own (`LanguageTexts`); any other is English with AI texts over it. */
export const HAND_WRITTEN = ["nb", "sv", "da", "en"] as const;

export type HandWritten = (typeof HAND_WRITTEN)[number];

/** The hand-written text a page in `lang` loads: its own, or English as the ground of a language translated by AI. */
export const textsFor = (lang: string): HandWritten => ((HAND_WRITTEN as readonly string[]).includes(lang) ? (lang as HandWritten) : "en");
