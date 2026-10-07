"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { designChoice, parseDesignDetails } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import {
  DESIGNS_TAG,
  applyDesignPreset,
  createDesign,
  designTags,
  moveDesign,
  restoreDesignLook,
  retakeDesign,
  setDesignPublished,
  setRecommendedDesign,
  updateDesign,
} from "@/server/design-presets";
import { STARTERS_TAG } from "@/server/store-starters";
import { getStore } from "@/server/stores";

/** The design profile form's fields, as the server reads them. */
const detailsOf = (formData: FormData) =>
  parseDesignDetails({
    title: formData.get("title"),
    summary: formData.get("summary"),
    description: formData.get("description"),
    pictureUrl: formData.get("pictureUrl"),
  });

const withNotes = (message: string, notes: string[]): string[] => [notes.length > 0 ? `${message} ${notes.join(" ")}` : message];

/** A new design profile (D176): a snapshot of the look of a store the admin works in, unpublished until they say. */
export async function createDesignAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const storeId = z.uuid().safeParse(formData.get("store"));
  if (!storeId.success) return { status: "error", messages: ["Choose the store whose look it keeps."] };
  const result = await createDesign(admin, { storeId: storeId.data, details: details.details });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: withNotes(`${details.details.title} is made, unpublished. Preview it, then publish it.`, result.notes) };
}

/** A design profile's details. */
export async function updateDesignAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const result = await updateDesign(admin, presetId, details.details);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

/** Takes the profile's snapshot again from its store, as the store looks now. */
export async function retakeDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await retakeDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: withNotes("Updated from its store. Stores that applied it keep the look they got.", result.notes) };
}

/** Offers a design profile to every store, or stops offering it. */
export async function publishDesignAction(presetId: string, published: boolean): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await setDesignPublished(admin, presetId, published);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [published ? "Published: every store can apply it now." : "Unpublished: stores that applied it keep their look."] };
}

/** Moves a design profile up or down in the order stores see. */
export async function moveDesignAction(presetId: string, direction: "up" | "down"): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await moveDesign(admin, presetId, direction === "up" ? "up" : "down");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: ["Moved."] };
}

/** The design profile a store template offers first when a store is made from it (D175, D176), or none. */
export async function recommendDesignAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await setRecommendedDesign(admin, starterId, designChoice(formData.get("design")));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

/** A platform admin applies a design profile to any store from its page on the platform (D176), a store template included. */
export async function applyDesignToStoreAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const store = await getStore(storeSlug);
  const presetId = designChoice(formData.get("design"));
  if (!store) return { status: "error", messages: ["That store no longer exists."] };
  if (!presetId) return { status: "error", messages: ["Choose a design profile."] };
  const result = await applyDesignPreset(store.id, presetId, admin.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(store)) updateTag(tag);
  refresh();
  return { status: "ok", messages: withNotes(`Applied. The look from before is kept as the saved theme “${result.savedTheme}” and can be put back.`, result.notes) };
}

/** Puts back the look a store had before its latest design profile, from its page on the platform. */
export async function restoreDesignForStoreAction(storeSlug: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const store = await getStore(storeSlug);
  if (!store) return { status: "error", messages: ["That store no longer exists."] };
  const result = await restoreDesignLook(store.id, admin.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(store)) updateTag(tag);
  refresh();
  return { status: "ok", messages: [`The look from before ${result.presetTitle} is back.`] };
}
