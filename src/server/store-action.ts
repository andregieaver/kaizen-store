import "server-only";

import { unstable_rethrow } from "next/navigation";

import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import type { PlatformAccess, PlatformArea } from "@/lib/platform-access";
import type { PermissionKey } from "@/lib/permission-keys";

import { getAccount, platformCan, type Account, type Membership } from "./auth";
import { actionAdminLang } from "./admin-request-lang";
import { log } from "./log";
import { checkPermission } from "./permissions";

/**
 * One way for a server action to run (code review step 1.4, finding FV9): the guard, the person's language, and a catch. A member without
 * the key is refused in their words, never shown a 404; a handler that throws what nobody planned for is logged once (`action.failed`, the
 * action's name and the store, never the form's values) and answered with a plain line in the form, never Next's error page. Next's own
 * signals (`redirect()`, `notFound()`, `refresh()`) pass through untouched.
 *
 * The actions return many shapes (`{ ok, message }`, `FormState`, `SaveResult`), so each says how its refusal and its failure look:
 *
 *   export async function sendOrderAction(store: string, id: string, _s: State, form: FormData) {
 *     return storeAction({ store, key: "orders:write", action: "order.send", answer: failed }, async (member) => { … });
 *   }
 */
/** The action's result for a refusal or a failure: the line to show, and which it is (a form that shows no line can still tell them apart). */
export type ActionAnswer<T> = (message: string, kind: "refused" | "failed") => T;

type Common = { noAccess: string; failed: string };
const wordsIn = (lang: AdminLang): Common => COMMON_WORDS[lang].action;

/** A store admin's action: `key` is checked for the member, `answer` turns a refusal or a failure into the action's result. */
export async function storeAction<T>(
  options: { store: string; key: PermissionKey; action: string; answer: ActionAnswer<T> },
  run: (member: Membership, lang: AdminLang) => Promise<T>,
): Promise<T> {
  const member = await checkPermission(options.store, options.key);
  if (!member) return options.answer(wordsIn(await actionAdminLang()).noAccess, "refused");
  const lang = adminLangOf(member.account.adminLocale);
  try {
    return await run(member, lang);
  } catch (error) {
    unstable_rethrow(error);
    log("error", "action.failed", { action: options.action, storeId: member.store.id }, error);
    return options.answer(wordsIn(lang).failed, "failed");
  }
}

/** The platform admin's twin: someone on Kaizena Flow's team who may `access` the `area` (D510). */
export async function platformAction<T>(
  options: { area: PlatformArea; access?: PlatformAccess; action: string; answer: ActionAnswer<T> },
  run: (account: Account, lang: AdminLang) => Promise<T>,
): Promise<T> {
  const account = await getAccount();
  if (!account || !platformCan(account, options.area, options.access ?? "write")) return options.answer(wordsIn(await actionAdminLang()).noAccess, "refused");
  const lang = adminLangOf(account.adminLocale);
  try {
    return await run(account, lang);
  } catch (error) {
    unstable_rethrow(error);
    log("error", "action.failed", { action: options.action, platform: true }, error);
    return options.answer(wordsIn(lang).failed, "failed");
  }
}
