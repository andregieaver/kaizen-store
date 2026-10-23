import type { AdminLang } from "./admin-lang";

/**
 * The language of a staff email to an address that is no account (a store's contact address, a booking resource's address; D312 A10): the
 * store's main language when it is Norwegian, else English. Pure.
 */
export function contactLang(mainLocale: string | null | undefined): AdminLang {
  return mainLocale?.toLowerCase().startsWith("nb") ? "nb" : "en";
}
