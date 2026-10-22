import "server-only";

import { headers } from "next/headers";

import { adminLangOf, browserAdminLang, type AdminLang } from "@/lib/admin-lang";

import { readSession } from "./auth";

/**
 * The admin's language for a page a person may see before they are let in (D312 A1): the signed-in account's choice where there is a
 * session (also one held at its second step), else the browser's `Accept-Language` (`browserAdminLang()`). It never depends on an email typed,
 * so the sign-in forms answer an email with access and one without in the same words.
 */
export async function requestAdminLang(): Promise<AdminLang> {
  const account = (await readSession())?.account;
  if (account?.adminLocale) return adminLangOf(account.adminLocale);
  return browserAdminLang((await headers()).get("accept-language"));
}

