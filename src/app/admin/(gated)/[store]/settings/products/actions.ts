"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { saveProductSettings } from "@/server/product-settings";

/** Saves the store's product settings (D557): the stock left and a quantity chooser on product tiles. `settings:write` changes them. */
export async function saveProductSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "products").settings.noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "products").settings;
  await saveProductSettings(member, { tileStock: form.get("tileStock") === "on", tileQuantity: form.get("tileQuantity") === "on" });
  refresh();
  return { status: "ok", messages: [w.saved] };
}
