"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { effectiveDispatch } from "@/lib/tax-profile";
import { actionAdminLang } from "@/server/admin-request-lang";
import { saveCustomsSetting } from "@/server/customs";
import { checkPermission } from "@/server/permissions";
import { getTaxProfile, storeCountry } from "@/server/tax-profile";

/**
 * Customs and duties (wave 7 unit I, D343): a country's choice saved by members who may change the store's settings, only through
 * `saveCustomsSetting()`. The cart reads it per request, so no cache is refreshed but the page.
 */
export async function saveCustomsAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "settings").common.noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "settings");
  const [profile, country] = await Promise.all([getTaxProfile(member.store.id), storeCountry(member.store.id)]);
  const result = await saveCustomsSetting(
    member.account.id,
    member.store.id,
    { market: String(formData.get("market") ?? ""), mode: String(formData.get("mode") ?? ""), vatScheme: formData.get("vatScheme") === "on" },
    effectiveDispatch(profile, country),
  );
  if (!result.ok) return { status: "error", messages: [w.customs.problems[result.problem]] };
  refresh();
  return { status: "ok", messages: [w.common.saved] };
}
