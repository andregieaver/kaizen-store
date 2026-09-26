"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { installFont, saveSiteFonts } from "@/server/fonts";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";

const family = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || undefined;

/** Kaizen's own heading and body fonts (D59). */
export async function savePlatformFontsAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await saveSiteFonts(admin, null, { heading: family(form, "heading"), body: family(form, "body") });
  if (!result.ok) return { status: "error", messages: result.problems };
  // Kaizen's layout sets the fonts, with its header and footer settings.
  updateTag(PLATFORM_NAVIGATION_TAG);
  return { status: "ok", messages: ["Saved. Kaizen's site uses these fonts now."] };
}

/** Copies a Google Fonts family to Kaizen for its own pages (D59). */
export async function installPlatformFontAction(fontFamily: string) {
  await requirePlatformAdmin();
  return installFont(String(fontFamily));
}
