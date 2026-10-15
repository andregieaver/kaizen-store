"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { DESIGNS_TAG, installPresetOnPlatform, undoPlatformThemeUpdate, updatePlatformInstall } from "@/server/design-presets";
import { PAGES_TAG } from "@/server/pages";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { removePlatformInstall, setPlatformFollowsUpdates, switchPlatformInstall } from "@/server/platform-theme-installs";

/**
 * Kaizena Flow's own theme library (`docs/theme-phase-4.md` step 1): add a published theme without going live, switch the site to an installed
 * one, remove one that is not live. Each refreshes the platform's look (`PLATFORM_NAVIGATION_TAG`: theme, fonts, CSS) and pages (`PAGES_TAG`:
 * the header and footer), and the themes list, which counts Kaizena Flow's installs as use.
 */
const refreshLook = () => {
  updateTag(PLATFORM_NAVIGATION_TAG);
  updateTag(PAGES_TAG);
  updateTag(DESIGNS_TAG);
  refresh();
};

const lines = (title: string, notes: string[], first: string) => [first.replace("{title}", title), ...notes];

export async function addPlatformThemeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await installPresetOnPlatform(admin, String(formData.get("design") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshLook();
  return { status: "ok", messages: lines(result.title, result.notes, "“{title}” is in Kaizena Flow's themes, not live. Switch to it when it is ready.") };
}

export async function switchPlatformThemeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await switchPlatformInstall(admin, String(formData.get("install") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshLook();
  return { status: "ok", messages: lines(result.title, result.notes, `Kaizena Flow's site now wears “{title}”. “${result.from}” is kept in its themes.`) };
}

export async function removePlatformThemeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await removePlatformInstall(admin, String(formData.get("install") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshLook();
  return { status: "ok", messages: [`“${result.title}” was removed. Its header and footer stay among Kaizena Flow's pages.`] };
}

/** Updates one of Kaizena Flow's installed themes to its theme's latest version now (D253), keeping the admins' own changes. */
export async function updatePlatformThemeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await updatePlatformInstall(admin, String(formData.get("install") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshLook();
  const own = result.own > 0 ? ` ${result.own} of its own ${result.own === 1 ? "setting stays" : "settings stay"}.` : "";
  return { status: "ok", messages: [`${result.title} is now version ${result.version}.${own}`, ...result.notes] };
}

/** Undoes an update of one of Kaizena Flow's installed themes (D253) while nothing has changed since. */
export async function undoPlatformThemeUpdateAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await undoPlatformThemeUpdate(admin, String(formData.get("update") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshLook();
  return { status: "ok", messages: [`${result.title} is back as it was before the update.`] };
}

/** Whether one of Kaizena Flow's installed themes updates by itself (D253). */
export async function followPlatformUpdatesAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const follows = formData.get("follows") === "on";
  const result = await setPlatformFollowsUpdates(admin, String(formData.get("install") ?? ""), follows);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [follows ? `${result.title} will update by itself.` : `${result.title} waits for you to update it.`] };
}
