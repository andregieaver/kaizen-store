"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { requestScan } from "@/server/cookie-scans";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { cookiesTag, saveCookieNote, saveTracking } from "@/server/site-cookies";

/** Kaizen's own analytics and marketing tools (D58). */
export async function savePlatformTrackingAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await saveTracking(admin, null, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  // Kaizen's layout loads the tools and asks about them, with its header and footer settings.
  updateTag(PLATFORM_NAVIGATION_TAG);
  return { status: "ok", messages: ["Saved. Kaizen's site asks and loads accordingly now."] };
}

/** Scans Kaizen's own site soon (D58). */
export async function requestPlatformScanAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const queued = await requestScan(admin, null);
  return { status: "ok", messages: [queued ? "Scan asked for. It starts within a minute." : "A scan is already on its way."] };
}

/** Describes an item the scan of Kaizen's site found (D58). */
export async function savePlatformCookieNoteAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await saveCookieNote(admin, null, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(cookiesTag(null));
  return { status: "ok", messages: ["Saved. The cookie page lists it now."] };
}
