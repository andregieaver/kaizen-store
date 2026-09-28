"use server";

import { updateTag } from "next/cache";

import { requirePlatformAdmin } from "@/server/auth";
import { deleteMenu, savePlatformMenu, type MenuSaveResult } from "@/server/menus";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";

/** Saves one of Kaizen's menus (a new one without an id); every page shows it at once (D85). */
export async function savePlatformMenuAction(id: string | null, input: unknown): Promise<MenuSaveResult> {
  const admin = await requirePlatformAdmin();
  const result = await savePlatformMenu(admin, id, input);
  if (result.ok) updateTag(PLATFORM_NAVIGATION_TAG);
  return result;
}

/** Deletes one of Kaizen's menus; places that showed it show none. */
export async function deletePlatformMenuAction(id: string): Promise<{ ok: boolean }> {
  const admin = await requirePlatformAdmin();
  const ok = await deleteMenu(admin.id, null, id);
  if (ok) updateTag(PLATFORM_NAVIGATION_TAG);
  return { ok };
}
