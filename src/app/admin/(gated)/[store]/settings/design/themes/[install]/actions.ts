"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { StoreTheme } from "@/lib/theme";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { saveInstallLook } from "@/server/theme-installs";

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/**
 * Keeps theme settings in an installed theme that is not live (D244). Nothing visitors see changes, so no store tag is refreshed; the page
 * itself is refreshed so its preview link and What changes read the new settings.
 */
export async function saveInstallThemeAction(storeSlug: string, installId: string, payload: string): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await saveInstallLook(member.store.id, String(installId), member.account.id, { theme: read(payload) });
  if (!result.ok) return result;
  refresh();
  return { ok: true, theme: result.theme as StoreTheme };
}

/** Keeps its own CSS in an installed theme that is not live (D244). */
export async function saveInstallCssAction(storeSlug: string, installId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await saveInstallLook(member.store.id, String(installId), member.account.id, { css: String(formData.get("css") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved in this theme. Visitors see it once you switch to it."] };
}
