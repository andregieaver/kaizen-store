import { emailText } from "./email-text";
import { t } from "./i18n";
import { catalogOf, type CatalogEntry } from "./ui-catalog";

/** The languages whose interface text is written by hand, in code (D111): they are never in the database. */
export const BUILT_IN_LANGUAGES = ["nb", "sv", "da", "en"] as const;
export const isBuiltIn = (lang: string) => (BUILT_IN_LANGUAGES as readonly string[]).includes(lang);

let memo: CatalogEntry[] | null = null;

/** Every text and message of the storefront and the emails, from English: what a language is translated from. */
export function fullCatalog(): CatalogEntry[] {
  return (memo ??= [...catalogOf("ui", t("en")), ...catalogOf("email", emailText("en"))]);
}

let index: Map<string, CatalogEntry> | null = null;

export function catalogEntry(key: string): CatalogEntry | undefined {
  return (index ??= new Map(fullCatalog().map((entry) => [entry.key, entry]))).get(key);
}
