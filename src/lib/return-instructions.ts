import { MAX_INSTRUCTIONS } from "./withdrawal";

/**
 * The store's return instructions in its other languages (D153, D110). The text in `return_settings.instructions` is in the
 * store's main language; `return_settings.instructions_translations` holds `{ "sv": "…" }` for the others, written by staff
 * or accepted from the store translation (`/admin/{store}/translate`, scope `returns`). Pure and shared with the browser.
 */

export type InstructionTranslations = Record<string, string>;

/**
 * The instructions to show or send in `locale`: its translation when there is one, else the main language's. Anything that
 * shows a store's instructions to a shopper reads them through this.
 */
export function instructionsIn(main: string, translations: InstructionTranslations | null | undefined, locale: string): string {
  const own = translations?.[locale]?.trim();
  if (own) return own;
  // `nb-NO` finds `nb`, as the other store texts do.
  const language = locale.split("-")[0];
  const near = language !== locale ? translations?.[language]?.trim() : "";
  return near || main;
}

/** What is stored read as translations: only non-empty texts of the languages the store offers, never the main language's own. */
export function cleanTranslations(raw: unknown, allowed: readonly string[]): InstructionTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: InstructionTranslations = {};
  for (const locale of allowed) {
    const value = (raw as Record<string, unknown>)[locale];
    if (typeof value === "string" && value.trim() !== "") out[locale] = value.trim().slice(0, MAX_INSTRUCTIONS);
  }
  return out;
}

export type TranslationProblem = { locale: string; message: string };

/** Whether each translation fits (`MAX_INSTRUCTIONS`) and names a language the store offers; the first problem is shown beside its field. */
export function translationProblems(raw: unknown, allowed: readonly string[]): TranslationProblem[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) return [{ locale: "", message: "The translated instructions are not in the expected shape." }];
  const problems: TranslationProblem[] = [];
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(locale)) problems.push({ locale, message: `${locale} is not one of the store's other languages.` });
    else if (typeof value !== "string") problems.push({ locale, message: "Instructions are text." });
    else if (value.trim().length > MAX_INSTRUCTIONS) problems.push({ locale, message: `Instructions are at most ${MAX_INSTRUCTIONS} characters.` });
  }
  return problems;
}
