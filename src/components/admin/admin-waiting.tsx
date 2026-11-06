"use client";

import { useSyncExternalStore } from "react";

import { ADMIN_LANG_KEY, isAdminLang, type AdminLang } from "@/lib/admin-lang";

function stored(): AdminLang {
  try {
    const value = localStorage.getItem(ADMIN_LANG_KEY);
    return isAdminLang(value) ? value : "en";
  } catch {
    return "en";
  }
}

const unchanging = () => () => {};

/**
 * The language this browser last used in the admin (D312, kept by `AdminLangSync`), for the moments before the account is known: the
 * signed-in layout's first wait and the session check. The server draws English; the browser then reads its own.
 */
export function useStoredAdminLang(): AdminLang {
  return useSyncExternalStore(unchanging, stored, () => "en");
}

/**
 * What the admin says while it finds out who is signed in, in the language the browser last used. The server hands in the words in
 * every language (`shell.frame`), so this module carries no catalogue.
 */
export function AdminWaiting({ words }: { words: Record<AdminLang, string> }) {
  return <p className="p-8 text-sm text-muted">{words[useStoredAdminLang()]}</p>;
}
