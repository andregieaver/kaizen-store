"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { designChoice, designTabHref, parseDesignDetails } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import {
  DESIGNS_TAG,
  applyDesignPreset,
  archiveDesign,
  copyStoreLookToDraft,
  createDesign,
  deleteDesign,
  designTags,
  moveDesign,
  publishDesign,
  restoreDesign,
  restoreDesignLook,
  saveDesignDraft,
  unpublishDesign,
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

/** What stores are offered changed: the cards, the recommendations of store templates (D175) and the public previews are read again. */
function offeredChanged() {
  updateTag(DESIGNS_TAG);
  updateTag(STARTERS_TAG);
  refresh();
}

/**
 * A new design profile (D177): from a store the admin works in (its look copied into the profile's workspace, to change there) or from
 * scratch (Kaizen's standard look); unpublished until they say. Opens the profile's own page.
 */
export async function createDesignAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  let origin: { kind: "store"; storeId: string } | { kind: "scratch" } = { kind: "scratch" };
  if (formData.get("origin") === "store") {
    const storeId = z.uuid().safeParse(formData.get("store"));
    if (!storeId.success) return { status: "error", messages: ["Choose the store whose look it starts from."] };
    origin = { kind: "store", storeId: storeId.data };
  }
  const result = await createDesign(admin, { origin, details: details.details });
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`${designTabHref(result.id, "details")}?made=1${result.notes.length > 0 ? "&notes=1" : ""}`);
}

/** A design profile's details, saved as a draft (D177): stores see the published ones until Publish. */
export async function saveDesignDraftAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const result = await saveDesignDraft(admin, presetId, details.details);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Draft saved. Stores see the published details until you publish."] };
}

/** Replaces the profile's draft look with a store's look as it is now (D177). */
export async function copyStoreLookAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const storeId = z.uuid().safeParse(formData.get("store"));
  if (!storeId.success) return { status: "error", messages: ["Choose the store whose look it takes."] };
  if (formData.get("confirm") !== "on") return { status: "error", messages: ["Tick the box to confirm that the draft look is replaced."] };
  const result = await copyStoreLookToDraft(admin, presetId, storeId.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: withNotes("The draft look is the store's now. Stores keep the published profile until you publish.", result.notes) };
}

/** Publishes a design profile (D177): its draft details, and the look in its workspace as the snapshot stores apply. */
export async function publishDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await publishDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: withNotes("Published: every store can apply it as it is now. Stores that applied it before keep the look they got.", result.notes) };
}

/** Stops offering a design profile at once (D177). */
export async function unpublishDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await unpublishDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  const pending =
    result.pendingRequests > 0
      ? ` ${result.pendingRequests} pending ${result.pendingRequests === 1 ? "access request chose" : "access requests chose"} it: approved, ${result.pendingRequests === 1 ? "its store keeps" : "their stores keep"} the template's own design unless you choose another profile on the request.`
      : "";
  return { status: "ok", messages: [`Unpublished: no store can apply it now; stores that applied it keep their look.${pending}`] };
}

/** Archives a design profile (D177), and says which store templates recommended it (they recommend none now). */
export async function archiveDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await archiveDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  const cleared =
    result.clearedFrom.length > 0 ? ` It was the recommended profile of ${result.clearedFrom.join(", ")}, which ${result.clearedFrom.length === 1 ? "recommends" : "recommend"} none now.` : "";
  return { status: "ok", messages: [`Archived: it is under Archived now, and can be restored there.${cleared}`] };
}

/** Restores an archived design profile (D177), unpublished. */
export async function unarchiveDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await restoreDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: ["Restored, unpublished. Publish it when it is ready."] };
}

/** Deletes a design profile nothing used (D177), after the admin confirmed. */
export async function deleteDesignAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: ["Tick the box to confirm that it is deleted for good."] };
  const result = await deleteDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  redirect(`/admin/platform/design-profiles?deleted=1${result.clearedFrom.length > 0 ? `&cleared=${encodeURIComponent(result.clearedFrom.join(", "))}` : ""}`);
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
