"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AdminLang } from "@/lib/admin-lang";
import { commonEn } from "@/lib/admin-messages/common.en";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import type { AdminAreaMessages } from "@/lib/admin-text";

/**
 * The admin's words handed down by the signed-in layout (D312 A0), apart from `admin-text.tsx` and its English fallback of every area, so a
 * part shown outside the admin too (`ActionForm` on sign-up, the status page and sign-in) can read the words it needs without bringing every
 * catalogue into a visitor's scripts.
 */
export type ProvidedAdminText = { lang: AdminLang; texts: Partial<AdminAreaMessages> };

export const AdminTextContext = createContext<ProvidedAdminText>({ lang: "en", texts: {} });

/** Hands its client parts the account's language and the areas they read (`adminTexts()`); no catalogue of its own. */
export function AdminTextProvider({ lang, texts, children }: ProvidedAdminText & { children: ReactNode }) {
  return <AdminTextContext.Provider value={{ lang, texts }}>{children}</AdminTextContext.Provider>;
}

/** The common words (buttons, fields), in English unless handed down: for parts shown outside the signed-in admin too (PERF-11). */
export function useCommonText(): AdminAreaMessages["common"] {
  return useContext(AdminTextContext).texts.common ?? commonEn;
}

/** The sign-in words, in English unless handed down: on the signed-out pages as in the admin (PERF-11). */
export function useSignInText(): AdminAreaMessages["signIn"] {
  return useContext(AdminTextContext).texts.signIn ?? signInEn;
}
