"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { designChoice } from "@/lib/design-presets";
import { BUILDER_WRITE } from "@/lib/permissions";
import { NO_ACCESS, checkPermission, requireAnyPermission, requirePermission } from "@/server/permissions";
import { setOpenCartOnAdd } from "@/server/cart";
import { applyDesignPreset, designTags, restoreDesignLook } from "@/server/design-presets";
import { installFont } from "@/server/fonts";
import { storeTag } from "@/server/stores";
import { deleteSavedTheme, saveSavedTheme, saveStoreTheme } from "@/server/themes";

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/** Puts the theme on the store's storefront (D60). */
export async function saveThemeAction(storeSlug: string, payload: string) {
  const member = await requirePermission(storeSlug, "website:write");
  const result = await saveStoreTheme(member.account, member.store.id, read(payload));
  // Every storefront page draws the theme from the store's layout.
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}

/** Saves the settings as one of the store's own themes, new or over one it has (D60). */
export async function saveSavedThemeAction(storeSlug: string, payload: string) {
  const member = await requirePermission(storeSlug, "website:write");
  return saveSavedTheme(member.account, member.store.id, read(payload));
}

/** Deletes one of the store's saved themes (D60). */
export async function deleteSavedThemeAction(storeSlug: string, id: string) {
  const member = await requirePermission(storeSlug, "website:write");
  const deleted = await deleteSavedTheme(member.account, member.store.id, String(id));
  if (deleted) updateTag(storeTag(member.store.slug));
  return { ok: deleted };
}

/** Copies a Google Fonts family to Kaizen for the store's staff to use (D59): in the theme and the page builder. */
export async function installStoreFontAction(storeSlug: string, fontFamily: string) {
  // The page builder installs the fonts a block uses too, whichever kind of page it edits.
  await requireAnyPermission(storeSlug, BUILDER_WRITE);
  return installFont(String(fontFamily));
}

/** Whether phones open the slide-out cart once something is added (D64). */
export async function saveCartBehaviourAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  await setOpenCartOnAdd(member, formData.get("openCartOnAdd") === "on");
  // Product pages pass the choice to their add-to-cart buttons.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: ["Saved."] };
}

/**
 * Applies a design profile to the store (D176): the theme, a header, footer and product layout as new pages, and the CSS; the look from
 * before is kept so it can be put back.
 */
export async function applyDesignAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const presetId = designChoice(formData.get("design"));
  if (!presetId) return { status: "error", messages: ["Choose a design profile."] };
  const result = await applyDesignPreset(member.store.id, presetId, member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  const notes = result.notes.length > 0 ? ` ${result.notes.join(" ")}` : "";
  return { status: "ok", messages: [`Applied. Your look from before is kept as the saved theme “${result.savedTheme}”, and can be put back here.${notes}`] };
}

/** Puts back the store's look from before its latest design profile (D176). */
export async function restoreDesignAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await restoreDesignLook(member.store.id, member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  return { status: "ok", messages: [`The look from before ${result.presetTitle} is back.`] };
}
