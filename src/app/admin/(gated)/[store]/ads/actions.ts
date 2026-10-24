"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { removeAdConnection, saveAdConnection } from "@/server/ad-connections";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole } from "@/server/permissions";

/** Ad platforms' server connections (D303 I2): the store's owner's only, as they hold the platforms' tokens. The store and platform are bound. */
export async function saveAdConnectionAction(storeSlug: string, platform: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "marketing").ads.ownerOnly] };
  const w = adminText(adminLangOf(member.account.adminLocale), "marketing").ads;
  const result = await saveAdConnection(member.store.id, member.account.id, {
    platform,
    accountId: String(form.get("accountId") ?? ""),
    token: String(form.get("token") ?? ""),
    dataLevel: String(form.get("dataLevel") ?? "standard"),
    testCode: String(form.get("testCode") ?? ""),
    on: form.get("on") === "on",
  });
  if (!result.ok) return { status: "error", messages: [w.problems[result.problem]] };
  refresh();
  return { status: "ok", messages: [] };
}

export async function removeAdConnectionAction(storeSlug: string, platform: string): Promise<void> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return;
  await removeAdConnection(member.store.id, member.account.id, platform);
  refresh();
}
