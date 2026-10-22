"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole, checkPermission } from "@/server/permissions";
import { requestScan } from "@/server/cookie-scans";
import { cookiesTag, saveCookieNote, saveCustomCode, saveTracking } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/** The answers, in the account's language (D312 A8); before a member is known, the request's. */
const words = async (adminLocale?: string | null) => adminText(adminLocale === undefined ? await actionAdminLang() : adminLangOf(adminLocale), "legal").actions;

/** The store's analytics and marketing tools (D58): the owner's to change, as they decide what shoppers are asked. */
export async function saveStoreTrackingAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [(await words()).ownerTools] };
  const result = await saveTracking(member.account, member.store.id, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  // The storefront's layout loads the tools and asks about them.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: [(await words(member.account.adminLocale)).toolsSaved] };
}

/**
 * The store's own code for its pages (D61): the owner's, as it runs on the
 * store with full access to its pages. The form's `{place}.code` and
 * `{place}.category` fields become one object per place.
 */
export async function saveStoreCustomCodeAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [(await words()).ownerCode] };
  const input: Record<string, Record<string, FormDataEntryValue>> = {};
  for (const [key, value] of form) {
    const [place, field] = key.split(".");
    if (field) (input[place] ??= {})[field] = value;
  }
  const result = await saveCustomCode(member.account, member.store.id, input);
  if (!result.ok) return { status: "error", messages: result.problems };
  // The storefront's layouts add the code and ask about it.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: [(await words(member.account.adminLocale)).codeSaved] };
}

/** Scans the store's storefront soon (D58); anyone on the staff may ask. */
export async function requestStoreScanAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [(await words()).noAccess] };
  const queued = await requestScan(member.account, member.store.id);
  const w = await words(member.account.adminLocale);
  return { status: "ok", messages: [queued ? w.scanAsked : w.scanAlready] };
}

/** Describes an item the scan found (D58): the owner's, as it decides what shoppers are asked. */
export async function saveStoreCookieNoteAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [(await words()).ownerNote] };
  const result = await saveCookieNote(member.account, member.store.id, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(cookiesTag(member.store.id));
  return { status: "ok", messages: [(await words(member.account.adminLocale)).noteSaved] };
}
