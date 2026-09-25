"use server";

import { updateTag } from "next/cache";

import { requirePlatformAdmin } from "@/server/auth";
import { PLATFORM_NAVIGATION_TAG, savePlatformNavigation } from "@/server/platform-navigation";
import type { SaveResult } from "@/server/settings";

/** Saves Kaizen's logo, menus and business details; every platform page shows them at once (D42). */
export async function savePlatformNavigationAction(input: unknown): Promise<SaveResult> {
  const admin = await requirePlatformAdmin();
  const result = await savePlatformNavigation(admin, input);
  if (result.ok) updateTag(PLATFORM_NAVIGATION_TAG);
  return result;
}
