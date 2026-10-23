import "server-only";

import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { setWorkLang } from "@/lib/work-text";

import { getAccount } from "./auth";

/**
 * Work's words for this request (D312 A10): the signed-in account's language, English where there is no account or no request (a job,
 * a test). `locale` writes money, dates and hours in it. It also sets the request's language for `workText()`, so a Work page
 * calls it before drawing.
 */
export async function workWords() {
  let lang: AdminLang = "en";
  try {
    lang = adminLangOf((await getAccount())?.adminLocale);
  } catch {
    lang = "en";
  }
  setWorkLang(lang);
  return { w: adminText(lang, "work"), locale: ADMIN_LANG_FACTS[lang].locale, lang };
}
