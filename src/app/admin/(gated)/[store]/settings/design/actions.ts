"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import { designChoice } from "@/lib/design-presets";
import { BUILDER_WRITE } from "@/lib/permissions";
import { NO_ACCESS, checkPermission, requireAnyPermission, requirePermission } from "@/server/permissions";
import { setOpenCartOnAdd } from "@/server/cart";
import { applyDesignPreset, designTags, installDesignPreset, restoreDesignLook, undoThemeUpdate, updateThemeInstall } from "@/server/design-presets";
import { presetChoice } from "@/lib/design-variations";
import { chargeToken, readChargeToken } from "@/lib/theme-prices";
import { detachDryRun, runDetach, undoDetach } from "@/server/theme-detach";
import { removeInstall, setFollowsUpdates, switchToInstall } from "@/server/theme-installs";
import { installFont } from "@/server/fonts";
import { storeTag } from "@/server/stores";
import { chargeDueThemePurchases } from "@/server/theme-prices";
import { deleteSavedTheme, saveSavedTheme, saveStoreTheme, saveThemeLibrary, saveThemeTab } from "@/server/themes";

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

/**
 * Puts what the page builder's Theme tab holds on the store (D182): the elements, the content width and the body background, and
 * nothing else of the theme.
 */
export async function saveThemeTabAction(storeSlug: string, payload: string) {
  const member = await requirePermission(storeSlug, "website:write");
  const result = await saveThemeTab(member.account, member.store, read(payload));
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}

/** Saves the store's saved colours and gradients (D183), from the page builder's colour fields; nothing else of the theme. */
export async function saveLibraryAction(storeSlug: string, payload: string) {
  // The builder's own pages use them, so whoever may edit pages may keep them; the theme is changed only in this one part.
  const member = await requireAnyPermission(storeSlug, BUILDER_WRITE);
  const result = await saveThemeLibrary(member.account, member.store, read(payload));
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

/** The price a person agreed to for a premium theme (D286), as the form's `charge` sends it; only one that could be a price passes. */
const agreedCharge = (formData: FormData): string | null => {
  const price = readChargeToken(formData.get("charge"));
  return price ? chargeToken(price) : null;
};

/**
 * Applies a design profile to the store (D176): the theme, a header, footer and product layout as new pages, and the CSS; the look from
 * before is kept so it can be put back.
 */
export async function applyDesignAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const presetId = designChoice(formData.get("design"));
  if (!presetId) return { status: "error", messages: ["Choose a theme."] };
  // A premium theme (D286): the price the owner was shown and agreed to, which the database checks.
  const charge = agreedCharge(formData);
  const result = await applyDesignPreset(member.store.id, presetId, member.account.id, {}, presetChoice(formData.get("preset")), charge);
  if (!result.ok) return { status: "error", messages: result.problems };
  if (charge) after(() => chargeDueThemePurchases({ storeId: member.store.id }));
  for (const tag of designTags(member.store)) updateTag(tag);
  const notes = result.notes.length > 0 ? ` ${result.notes.join(" ")}` : "";
  return { status: "ok", messages: [`Applied. Your look from before stays in your theme library as “${result.previous}”, and can be put back here.${notes}`] };
}

/** Makes one of the store's installed themes live (D241); the live one is put away with every change made to it. */
export async function switchThemeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const charge = agreedCharge(formData);
  const result = await switchToInstall(member.store.id, String(formData.get("install") ?? ""), member.account.id, charge);
  if (!result.ok) return { status: "error", messages: result.problems };
  if (charge) after(() => chargeDueThemePurchases({ storeId: member.store.id }));
  for (const tag of designTags(member.store)) updateTag(tag);
  const notes = result.notes.length > 0 ? ` ${result.notes.join(" ")}` : "";
  return { status: "ok", messages: [`${result.title} is live. ${result.from} stays in your theme library.${notes}`] };
}

/** Removes an installed theme that is not live (D241). */
export async function removeThemeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await removeInstall(member.store.id, String(formData.get("install") ?? ""), member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [`${result.title} is removed from your theme library.`] };
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

const settingsWord = (n: number) => `${n} ${n === 1 ? "setting" : "settings"}`;
const pagesWord = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

/** Counts the settings on the store's pages that only repeat the live theme (D243); nothing is changed. */
export async function countThemeFollowAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const report = await detachDryRun(member.store.id);
  if (!report) return { status: "error", messages: ["That store no longer exists."] };
  if (report.followed === 0) return { status: "ok", messages: ["Your pages repeat nothing of the theme: there is nothing to take out."] };
  const on = report.pages.filter((p) => p.followed > 0).length;
  return { status: "ok", messages: [`${settingsWord(report.followed)} on ${pagesWord(on)} only repeat the theme and would follow it. ${settingsWord(report.own)} are your own and stay.`] };
}

/** Takes out of the store's pages the settings that only repeat the live theme (D243): they look the same and follow it from then on. */
export async function runThemeFollowAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await runDetach(member.store.id, member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  if (result.pages === 0) return { status: "ok", messages: ["Your pages repeat nothing of the theme: nothing was changed."] };
  for (const tag of designTags(member.store)) updateTag(tag);
  return { status: "ok", messages: [`${settingsWord(result.followed)} on ${pagesWord(result.pages)} now follow the theme. Your pages look as before.`] };
}

/** Undoes a run of the page migration (D243), page by page while a page is as the run left it. */
export async function undoThemeFollowAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await undoDetach(member.store.id, String(formData.get("run") ?? ""), member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  const since = result.changedSince > 0 ? ` ${pagesWord(result.changedSince)} changed since kept the change.` : "";
  return { status: "ok", messages: [`${pagesWord(result.restored)} put back as they were.${since}`] };
}

/** Updates an installed theme to its theme's latest version now (D245), keeping the owner's own changes. */
export async function updateThemeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await updateThemeInstall(member.store.id, String(formData.get("install") ?? ""), member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  const own = result.own > 0 ? ` ${result.own} of your own ${result.own === 1 ? "setting stays" : "settings stay"}.` : "";
  const notes = result.notes.length > 0 ? ` ${result.notes.join(" ")}` : "";
  return { status: "ok", messages: [`${result.title} is now version ${result.version}.${own}${notes}`] };
}

/** Undoes an update of an installed theme (D245) while nothing has changed since. */
export async function undoThemeUpdateAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await undoThemeUpdate(member.store.id, String(formData.get("update") ?? ""), member.account.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  return { status: "ok", messages: [`${result.title} is back as it was before the update.`] };
}

/** Whether an installed theme updates by itself (D245). */
export async function followUpdatesAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const follows = formData.get("follows") === "on";
  const result = await setFollowsUpdates(member.store.id, String(formData.get("install") ?? ""), member.account.id, follows);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [follows ? `${result.title} will update by itself.` : `${result.title} waits for you to update it.`] };
}

/**
 * Adds a theme to the store's library without making it live (`docs/theme-phase-3.md` step 2), then opens its own page (D244) to preview
 * and customise it. Visitors see nothing until the store switches to it.
 */
export async function installThemeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const presetId = designChoice(formData.get("design"));
  if (!presetId) return { status: "error", messages: ["Choose a theme."] };
  const result = await installDesignPreset(member.store.id, presetId, member.account.id, {}, presetChoice(formData.get("preset")));
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(member.store)) updateTag(tag);
  redirect(`/admin/${member.store.slug}/settings/design/themes/${result.installId}?added=1`);
}
