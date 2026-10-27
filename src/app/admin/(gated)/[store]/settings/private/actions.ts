"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { setPrivateMode, setPrivatePassword, signEveryoneOut, type PrivateResult } from "@/server/private-mode";

/**
 * Private mode (D339): switched, given a password or signed out by members who may change the store's settings, only through
 * `src/server/private-mode.ts`, which audits each change and refreshes the store's caches.
 */

async function words(storeSlug: string) {
  const member = await checkPermission(storeSlug, "settings:write");
  const lang = member ? adminLangOf(member.account.adminLocale) : await actionAdminLang();
  return { member, w: adminText(lang, "settings").privateMode };
}

function answer(result: PrivateResult, w: Awaited<ReturnType<typeof words>>["w"], ok: string): FormState {
  if (result.ok) {
    refresh();
    return { status: "ok", messages: [ok] };
  }
  const message = result.problem === "short" ? w.password.short : result.problem === "long" ? w.password.long : result.problem === "never_private" ? w.stateNever : w.notAllowed;
  return { status: "error", messages: [message] };
}

export async function setPrivateModeAction(storeSlug: string, on: boolean): Promise<FormState> {
  const { member, w } = await words(storeSlug);
  if (!member) return { status: "error", messages: [w.notAllowed] };
  return answer(await setPrivateMode(member, on), w, on ? w.madePrivate : w.madePublic);
}

export async function setPrivatePasswordAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const { member, w } = await words(storeSlug);
  if (!member) return { status: "error", messages: [w.notAllowed] };
  const remove = formData.get("remove") === "1";
  const password = remove ? null : String(formData.get("password") ?? "");
  return answer(await setPrivatePassword(member, password), w, remove ? w.password.removed : w.password.saved);
}

export async function signEveryoneOutAction(storeSlug: string): Promise<FormState> {
  const { member, w } = await words(storeSlug);
  if (!member) return { status: "error", messages: [w.notAllowed] };
  return answer(await signEveryoneOut(member), w, w.signOut.done);
}
