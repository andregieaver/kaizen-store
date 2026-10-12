/**
 * Interface text by language. A market uses its locale's language, and any
 * language without its own text falls back to English. Each hand-written
 * language is a module of its own (`src/lib/messages/`, D212): the server and
 * the admin read them all here, a visitor's browser only its page's
 * (`browserText()`, `LanguageTexts`). Legal texts (terms, withdrawal
 * information) are not here: they need human review and live in their own files.
 */
import { da } from "./messages/da";
import { en, type Messages } from "./messages/en";
import { nb } from "./messages/nb";
import { sv } from "./messages/sv";
import { registeredUi } from "./ui-registry";

export type { Messages };

const messages: Partial<Record<string, Messages>> = { nb, sv, da, en };
/**
 * Text for a language subtag such as `nb`: the hand-written languages, else
 * one translated by AI and kept as data (D111, `src/lib/ui-registry.ts`),
 * key by key with English for what it lacks, else English.
 */
export function t(lang: string): Messages {
  return (Object.hasOwn(messages, lang) ? messages[lang] : undefined) ?? (registeredUi(lang) as Messages | undefined) ?? en;
}

/** Human label for a variant option such as `{ colour: "white" }`. */
/** A variant's option values as the shopper reads them: the demo's "white" is "Hvit" in Norwegian. Names stay as they are. */
export function shownOptions(m: Messages, options: Record<string, string>): Record<string, string> {
  const labels = m.options as Record<string, string>;
  return Object.fromEntries(Object.entries(options).map(([name, value]) => [name, labels[value] ?? value]));
}

export function optionLabel(m: Messages, options: Record<string, string>): string {
  const labels = m.options as Record<string, string>;
  return Object.entries(options)
    .map(([key, value]) => `${labels[key] ?? key}: ${labels[value] ?? value}`)
    .join(", ");
}

