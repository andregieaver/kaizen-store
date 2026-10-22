"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { storeDetailsInput } from "@/lib/store-details";
import { NO_ACCESS, checkOwnerRole, checkPermission } from "@/server/permissions";
import { audienceInput, saveStoreAudience } from "@/server/b2b";
import { catalogTag } from "@/server/catalog";
import { deleteLocation, placeDeleteBlockers, saveLocation } from "@/server/company";
import { STORES_TAG } from "@/server/seo";
import { saveStoreDetails } from "@/server/setup";
import { storeTag } from "@/server/stores";

const problems = (messages: string[]): FormState => ({ status: "error", messages });

/** The company page's words in the member's language (D312 A8). */
const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "settings");
const before = async () => adminText(await actionAdminLang(), "settings");

/** The server's English answers, in the member's language where the catalogue knows them. */
const said = (member: Membership, messages: string[]) => {
  const map = wordsOf(member).company.problems;
  return messages.map((m) => map[m] ?? m);
};

/** The business that sells (D40): the owner's to change, as in setup. */
export async function saveBusinessAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return problems([(await before()).company.onlyOwnerBusiness]);
  const parsed = storeDetailsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  await saveStoreDetails(member, parsed.data);
  // The name and details show in the storefront's header and footer, and in the sitemap.
  updateTag(storeTag(member.store.slug));
  updateTag(STORES_TAG);
  return { status: "ok", messages: [wordsOf(member).company.actions.businessSaved] };
}

/** Who the store sells to (B2B): how prices show on every page, so the catalogue is drawn again. */
export async function saveAudienceAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return problems([(await before()).company.onlyOwnerAudience]);
  const parsed = audienceInput.safeParse({
    audience: formData.get("audience"),
    businessPopup: formData.get("businessPopup") === "on",
  });
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  const saved = await saveStoreAudience(member, parsed.data);
  if (!saved.ok) return problems([saved.problem]);
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  return { status: "ok", messages: [wordsOf(member).common.saved] };
}

/** The office's address and hours. */
export async function saveOfficeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await saveLocation(member, null, { ...Object.fromEntries(formData), kind: "office" });
  return result.ok ? { status: "ok", messages: [wordsOf(member).company.actions.officeSaved] } : problems(said(member, result.problems));
}

/** A shop or pickup point; a new one goes back to the Company page once saved. */
export async function savePlaceAction(
  storeSlug: string,
  placeId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (placeId && !z.uuid().safeParse(placeId).success) return problems([wordsOf(member).company.actions.gone]);
  const result = await saveLocation(member, placeId, Object.fromEntries(formData));
  if (!result.ok) return problems(said(member, result.problems));
  if (!placeId) redirect(`/admin/${storeSlug}/settings/company`);
  return { status: "ok", messages: [wordsOf(member).common.saved] };
}

export async function deletePlaceAction(storeSlug: string, placeId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const w = wordsOf(member).company.actions;
  if (!z.uuid().safeParse(placeId).success) return { ok: false, problems: [w.gone] };
  // Orders waiting to be collected there keep its id without a link (D237 2.2): it stays until they are collected or cancelled.
  const waiting = await placeDeleteBlockers(member.store.id, placeId);
  if (waiting > 0) return { ok: false, problems: [countWords(waiting, w.waiting)] };
  if (!(await deleteLocation(member, placeId))) return { ok: false, problems: [w.gone] };
  redirect(`/admin/${storeSlug}/settings/company`);
}
