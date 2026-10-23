"use server";

import { platformActionWords } from "@/server/platform-site-words";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { StoreTheme } from "@/lib/theme";
import { requirePlatformAdmin } from "@/server/auth";
import { savePlatformInstallLook } from "@/server/platform-theme-installs";

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/**
 * Keeps theme settings in one of Kaizena Flow's installs that is not live (D252). Nothing visitors see changes, so no tag is refreshed; the
 * page is, so its preview and What changes read the new settings.
 */
export async function savePlatformInstallThemeAction(installId: string, payload: string): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  const result = await savePlatformInstallLook(admin, String(installId), { theme: read(payload) });
  if (!result.ok) return result;
  refresh();
  return { ok: true, theme: result.theme as StoreTheme };
}

/** Keeps its own CSS in one of Kaizena Flow's installs that is not live (D252). */
export async function savePlatformInstallCssAction(installId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await savePlatformInstallLook(admin, String(installId), { css: String(formData.get("css") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).installSaved] };
}
