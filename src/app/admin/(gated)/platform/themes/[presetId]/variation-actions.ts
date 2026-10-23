"use server";

import { platformActionWords } from "@/server/platform-site-words";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { designTabHref } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import { addVariation, moveVariation, removeVariation, renameVariation, saveVariationTheme } from "@/server/design-variations";
import { installFont } from "@/server/fonts";

/**
 * A theme's presets (`docs/theme-showcase-phase-1.md` step 1), edited on its *Presets* tab: each action is bound to the theme's id (and the
 * preset's key) and checks the platform admin every time; the server functions work on that theme's own rows only. Everything here is the
 * theme's draft: stores get it when the theme is published.
 */

const failed = (problems: string[]): FormState => ({ status: "error", messages: problems });

export async function addVariationAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await addVariation(admin, presetId, formData.get("name"));
  if (!result.ok) return failed(result.problems);
  redirect(`${designTabHref(presetId, "presets")}/${result.key}`);
}

export async function renameVariationAction(presetId: string, key: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await renameVariation(admin, presetId, key, formData.get("name"));
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).renamed] };
}

export async function moveVariationAction(presetId: string, key: string, direction: "up" | "down"): Promise<void> {
  const admin = await requirePlatformAdmin();
  await moveVariation(admin, presetId, key, direction === "up" ? "up" : "down");
  refresh();
}

export async function removeVariationAction(presetId: string, key: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await removeVariation(admin, presetId, key);
  if (!result.ok) return failed(result.problems);
  redirect(designTabHref(presetId, "presets"));
}

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/** The theme editor's save for one preset's look. */
export async function saveVariationThemeAction(presetId: string, key: string, payload: string) {
  const admin = await requirePlatformAdmin();
  return saveVariationTheme(admin, presetId, key, read(payload));
}

/** The theme editor's font picker: a family installed before a preset uses it (D59). */
export async function installVariationFontAction(fontFamily: string) {
  await requirePlatformAdmin();
  return installFont(String(fontFamily));
}
