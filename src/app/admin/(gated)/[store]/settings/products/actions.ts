"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { PRODUCTS_WORDS } from "@/lib/admin-words/products";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { saveProductSettings } from "@/server/product-settings";

/** Saves the store's product settings (D557): the stock left and a quantity chooser on product tiles. `settings:write` changes them. */
export async function saveProductSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [PRODUCTS_WORDS[await actionAdminLang()].settings.noChange] };
  const w = PRODUCTS_WORDS[adminLangOf(member.account.adminLocale)].settings;
  await saveProductSettings(member, {
    tileStock: form.get("tileStock") === "on",
    tileQuantity: form.get("tileQuantity") === "on",
    zeroFree: form.get("zeroFree") === "on",
  });
  refresh();
  return { status: "ok", messages: [w.saved] };
}
