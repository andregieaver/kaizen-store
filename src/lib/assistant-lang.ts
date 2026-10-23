import type { AdminLang } from "./admin-lang";

/**
 * What the AI manager is told about the person's admin language (D312 A10): with the admin in Norwegian it answers in Norwegian and names
 * pages and buttons as the admin shows them, unless they write to it in another language. English adds nothing (the prompt already says to
 * answer in the language they write in).
 */
export function assistantLanguageLines(lang: AdminLang): string[] {
  return lang === "nb"
    ? ["- Their admin is in Norwegian (bokmål): answer in Norwegian unless they write to you in another language. Page and button names are the admin's Norwegian ones."]
    : [];
}
