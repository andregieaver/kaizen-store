"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { requestScan } from "@/server/cookie-scans";
import { cookiesTag, saveCookieNote, saveTracking } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/** The store's analytics and marketing tools (D58): the owner's to change, as they decide what shoppers are asked. */
export async function saveStoreTrackingAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { status: "error", messages: ["Only an owner can change the store's tools."] };
  const result = await saveTracking(member.account, member.store.id, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  // The storefront's layout loads the tools and asks about them.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: ["Saved. The store asks and loads accordingly now."] };
}

/** Scans the store's storefront soon (D58); anyone on the staff may ask. */
export async function requestStoreScanAction(storeSlug: string): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const queued = await requestScan(member.account, member.store.id);
  return { status: "ok", messages: [queued ? "Scan asked for. It starts within a minute." : "A scan is already on its way."] };
}

/** Describes an item the scan found (D58): the owner's, as it decides what shoppers are asked. */
export async function saveStoreCookieNoteAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { status: "error", messages: ["Only an owner can describe the store's cookies."] };
  const result = await saveCookieNote(member.account, member.store.id, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(cookiesTag(member.store.id));
  return { status: "ok", messages: ["Saved. The cookie page lists it now."] };
}
