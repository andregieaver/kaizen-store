"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { storeDetailsInput } from "@/lib/store-details";
import { requireMember } from "@/server/auth";
import { audienceInput, saveStoreAudience } from "@/server/b2b";
import { catalogTag } from "@/server/catalog";
import { deleteLocation, saveLocation } from "@/server/company";
import { STORES_TAG } from "@/server/seo";
import { saveStoreDetails } from "@/server/setup";
import { storeTag } from "@/server/stores";

const problems = (messages: string[]): FormState => ({ status: "error", messages });

/** The business that sells (D40): the owner's to change, as in setup. */
export async function saveBusinessAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return problems(["Only an owner can change the business details."]);
  const parsed = storeDetailsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  await saveStoreDetails(member, parsed.data);
  // The name and details show in the storefront's header and footer, and in the sitemap.
  updateTag(storeTag(member.store.slug));
  updateTag(STORES_TAG);
  return { status: "ok", messages: ["Business details saved."] };
}

/** Who the store sells to (B2B): how prices show on every page, so the catalogue is drawn again. */
export async function saveAudienceAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return problems(["Only an owner can change who the store sells to."]);
  const parsed = audienceInput.safeParse({
    audience: formData.get("audience"),
    businessPopup: formData.get("businessPopup") === "on",
  });
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  await saveStoreAudience(member, parsed.data);
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  return { status: "ok", messages: ["Saved."] };
}

/** The office's address and hours. */
export async function saveOfficeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const result = await saveLocation(member, null, { ...Object.fromEntries(formData), kind: "office" });
  return result.ok ? { status: "ok", messages: ["Office saved."] } : problems(result.problems);
}

/** A shop or pickup point; a new one goes back to the Company page once saved. */
export async function savePlaceAction(
  storeSlug: string,
  placeId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (placeId && !z.uuid().safeParse(placeId).success) return problems(["That place no longer exists."]);
  const result = await saveLocation(member, placeId, Object.fromEntries(formData));
  if (!result.ok) return problems(result.problems);
  if (!placeId) redirect(`/admin/${storeSlug}/settings/company`);
  return { status: "ok", messages: ["Saved."] };
}

export async function deletePlaceAction(storeSlug: string, placeId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(placeId).success || !(await deleteLocation(member, placeId))) {
    return { ok: false, problems: ["That place no longer exists."] };
  }
  redirect(`/admin/${storeSlug}/settings/company`);
}
