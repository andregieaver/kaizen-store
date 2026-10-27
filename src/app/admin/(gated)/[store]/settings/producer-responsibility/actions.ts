"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { catalogTag } from "@/server/catalog";
import { checkPermission } from "@/server/permissions";
import { removeRegistration, saveRegistration } from "@/server/producer-registrations";

/**
 * Producer responsibility (wave 7 unit H, D342): a registration or exemption saved or taken away, by members who may change the store's
 * settings, only through `src/server/producer-registrations.ts`. The product pages show the numbers chosen to be shown, so the catalogue's tag is
 * refreshed; whether a product is sold is read per request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveRegistrationAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "settings").common.noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "settings").producer;
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };
  const id = text("id");
  if (id && !UUID.test(id)) return { status: "error", messages: [w.problems.missing] };
  const result = await saveRegistration(
    member.store,
    member.account.id,
    {
      scheme: text("scheme"),
      market: text("market"),
      kind: text("kind"),
      number: text("number"),
      authority: text("authority"),
      exemption: text("exemption"),
      showNumber: formData.get("showNumber") === "on",
      validFrom: text("validFrom"),
      validTo: text("validTo"),
    },
    id || null,
  );
  if (!result.ok) {
    return { status: "error", messages: "missing" in result ? [w.problems.missing] : result.problems.map((p) => w.problems[p] ?? p) };
  }
  updateTag(catalogTag(member.store.id));
  refresh();
  return { status: "ok", messages: [w.saved] };
}

export async function removeRegistrationAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "settings").common.noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "settings").producer;
  const id = formData.get("id");
  if (typeof id !== "string" || !UUID.test(id) || !(await removeRegistration(member.store.id, member.account.id, id))) {
    return { status: "error", messages: [w.problems.missing] };
  }
  updateTag(catalogTag(member.store.id));
  refresh();
  return { status: "ok", messages: [w.removed] };
}
