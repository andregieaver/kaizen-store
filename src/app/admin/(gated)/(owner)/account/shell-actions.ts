"use server";

import { isAdminLang } from "@/lib/admin-lang";
import { isAdminView } from "@/lib/admin-view";
import { isColorChoice } from "@/lib/color-mode";
import { requireAccount, saveAdminLang, saveAdminView, saveColorMode } from "@/server/auth";

// The admin shell's three actions from Your account, in a file of their own: every export of a "use server" file is listed in the
// server-reference manifest by every route that imports the file, and the shell and the store layout are on every admin route
// (bloat review step 2.24).

/** Keeps the account's language for the admin (D312 A0); the admin is drawn again in it. */
export async function adminLangAction(lang: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminLang(lang)) await saveAdminLang(account.id, lang);
}

/** Keeps the account's light or dark for the admin (D99); the page has applied it already. */
export async function colorModeAction(choice: unknown): Promise<void> {
  const account = await requireAccount();
  if (isColorChoice(choice) && choice !== account.colorMode) await saveColorMode(account.id, choice);
}

/**
 * Keeps how much of a store's admin the account is shown (D454); the page has switched already. A store's admin and Your account both
 * call it; nothing is drawn again, as the navigation follows the choice in the browser.
 */
export async function adminViewAction(view: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminView(view) && view !== account.adminView) await saveAdminView(account.id, view);
}
