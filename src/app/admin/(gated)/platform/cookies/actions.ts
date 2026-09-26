"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { saveTracking } from "@/server/site-cookies";

/** Kaizen's own analytics and marketing tools (D58). */
export async function savePlatformTrackingAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await saveTracking(admin, null, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  // Kaizen's layout loads the tools and asks about them, with its header and footer settings.
  updateTag(PLATFORM_NAVIGATION_TAG);
  return { status: "ok", messages: ["Saved. Kaizen's site asks and loads accordingly now."] };
}
