"use server";

import { platformActionWords } from "@/server/platform-site-words";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { designLookChoice, designTabHref } from "@/lib/design-presets";
import { parseDemoDetails } from "@/lib/demo-stores";
import { DEMO_STORES_HREF, THEMES_ADMIN, demoStoreHref } from "@/lib/theme-admin-paths";
import { requirePlatformAdmin } from "@/server/auth";
import { DESIGNS_TAG } from "@/server/design-presets";
import { createDemoStore, demoLookAsPreset, demoLookAsTheme, demoLookIntoNextVersion, publishDemoStore, saveDemoDetails } from "@/server/demo-stores";
import { STARTERS_TAG, archiveStarter, deleteStarter, restoreStarter, unpublishStarter } from "@/server/store-starters";

/** What the theme store shows changed (D277): *See it live* on the themes' pages is read again. */
function liveChanged() {
  updateTag(STARTERS_TAG);
  refresh();
}

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

/**
 * *Make the demo store* (D277): a copy of the content chosen, wearing the theme or preset chosen, then its store admin, where it is
 * customised like any store. When the theme could not be applied, its page says so instead.
 */
export async function createDemoStoreAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const look = designLookChoice(formData.get("design"));
  if (!look) return { status: "error", messages: [(await platformActionWords()).chooseWears] };
  const result = await createDemoStore(admin, {
    name: text(formData.get("name")),
    slug: text(formData.get("slug")).toLowerCase(),
    look,
    contentId: text(formData.get("content")),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  if (!result.themed) redirect(`${demoStoreHref(result.id)}?made=1&unthemed=1`);
  redirect(`/admin/${result.slug}`);
}

/** Publishes a demo store (D277): live as it stands, listed under *See it live* on the theme it wears. */
export async function publishDemoStoreAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await publishDemoStore(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  return { status: "ok", messages: [(await platformActionWords()).demoPublished] };
}

/** Takes a demo store down (D277): no longer listed under *See it live*. */
export async function unpublishDemoStoreAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await unpublishStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  return { status: "ok", messages: [(await platformActionWords()).demoUnpublished] };
}

export async function archiveDemoStoreAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await archiveStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  return { status: "ok", messages: [(await platformActionWords()).demoArchived] };
}

export async function restoreDemoStoreAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await restoreStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  return { status: "ok", messages: [(await platformActionWords()).restored] };
}

/** Deletes a demo store after the admin confirmed: its store is closed and kept (D171), only its row goes. */
export async function deleteDemoStoreAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: [(await platformActionWords()).confirmDelete] };
  const result = await deleteStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  redirect(`${THEMES_ADMIN}?deleted=demo${DEMO_STORES_HREF.slice(THEMES_ADMIN.length)}`);
}

/** Its trade and picture for *See it live*, shown at once. */
export async function saveDemoDetailsAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = parseDemoDetails({ trade: formData.get("trade"), pictureUrl: formData.get("pictureUrl") });
  if (!details.ok) return { status: "error", messages: details.problems };
  const result = await saveDemoDetails(admin, starterId, details.details);
  if (!result.ok) return { status: "error", messages: result.problems };
  liveChanged();
  return { status: "ok", messages: [(await platformActionWords()).saved] };
}

/** *Publish this look… → As a new theme*: an unpublished theme with the demo store's look and a copy of its content, opened to name and publish. */
export async function demoAsThemeAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const title = text(formData.get("title"));
  if (!title) return { status: "error", messages: [(await platformActionWords()).nameTheme] };
  if (title.length > 80) return { status: "error", messages: [(await platformActionWords()).nameShort] };
  const result = await demoLookAsTheme(admin, starterId, { title, summary: "", description: "", pictureUrl: null });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  redirect(`${designTabHref(result.presetId, "details")}?made=1${result.notes.length > 0 ? "&notes=1" : ""}`);
}

/** *Publish this look… → As a preset of {theme}*: a new draft preset of the theme it wears, sent out when the theme is published. */
export async function demoAsPresetAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await demoLookAsPreset(admin, starterId, text(formData.get("name")));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  // The new preset in the theme editor, a draft until the theme is published.
  redirect(`${designTabHref(result.presetId, "presets")}/${result.key}`);
}

/** *Publish this look… → Into {theme}'s next version*: the theme's draft look becomes the demo store's, to review and publish. */
export async function demoIntoNextVersionAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: [(await platformActionWords()).confirmThemeReplace] };
  const result = await demoLookIntoNextVersion(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`${designTabHref(result.presetId, "details")}?copied=1${result.notes.length > 0 ? "&notes=1" : ""}`);
}
