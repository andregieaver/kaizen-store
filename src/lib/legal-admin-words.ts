import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";

/**
 * The names of the languages a legal draft was written in (D312 A8), as the admin's language writes them: `nb` is "Norwegian Bokmål" in
 * English and "norsk bokmål" in Norwegian. A code `Intl` does not know is shown as it is.
 */
export function languageNames(codes: readonly string[], lang: AdminLang): string {
  const names = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  return codes.map((code) => names.of(code) ?? code).join(", ");
}
