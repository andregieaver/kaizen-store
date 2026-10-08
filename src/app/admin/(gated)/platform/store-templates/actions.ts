"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { parseStarterDetails } from "@/lib/store-starters";
import { requirePlatformAdmin } from "@/server/auth";
import { DESIGNS_TAG } from "@/server/design-presets";
import {
  STARTERS_TAG,
  archiveStarter,
  createStarter,
  deleteStarter,
  joinStarter,
  moveStarter,
  publishStarter,
  restoreStarter,
  saveStarterDraft,
  setStarterFeatures,
  unpublishStarter,
} from "@/server/store-starters";

/** The store template form's fields, as the server reads them; the recommended design profile only where the form has the field. */
const detailsOf = (formData: FormData) =>
  parseStarterDetails({
    title: formData.get("title"),
    summary: formData.get("summary"),
    description: formData.get("description"),
    category: formData.get("category"),
    pictureUrl: formData.get("pictureUrl"),
    ...(formData.has("design") && { recommendedDesign: formData.get("design") }),
  });

/** What owners are offered changed: the cards (sign-up, Create a store) and the design recommendations (D176) are read again. */
function offeredChanged() {
  updateTag(STARTERS_TAG);
  updateTag(DESIGNS_TAG);
  refresh();
}

/** A new store template (D175): its store is copied from the default template, with the admin as owner; unpublished until they say. */
export async function createStarterAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase() || suggestSlug(details.details.title);
  const result = await createStarter(admin, { slug, details: details.details });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [`${details.details.title} is made, unpublished. Set it up in its admin (${result.slug}), then publish it.`],
  };
}

/** A store template's details, saved as a draft (D177): owners see the published ones until Publish. */
export async function saveStarterDraftAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const result = await saveStarterDraft(admin, starterId, details.details);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Draft saved. Owners see the published details until you publish."] };
}

/**
 * Publishes a store template (D177): its draft details, and its store frozen into the copy new stores are made from. Changes made in its
 * store after this reach no new store until it is published again.
 */
export async function publishStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await publishStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return {
    status: "ok",
    messages: [[`Published: new stores are copied from its store as it is now (kept as /s/${result.copySlug}), and owners preview that.`, ...result.notes].join(" ")],
  };
}

/** Stops offering a store template at once (D177). */
export async function unpublishStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await unpublishStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  const pending =
    result.pendingRequests > 0
      ? ` ${result.pendingRequests} pending ${result.pendingRequests === 1 ? "access request chose" : "access requests chose"} it: approved, ${result.pendingRequests === 1 ? "it gets" : "they get"} the Standard store unless you choose another template on the request.`
      : "";
  return { status: "ok", messages: [`Unpublished: no new store starts from it; stores made from it keep what they got.${pending}`] };
}

/** Archives a store template (D177): unpublished and out of every list but Archived. */
export async function archiveStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await archiveStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: ["Archived: it is under Archived now, and can be restored there."] };
}

/** Restores an archived store template (D177), unpublished. */
export async function restoreStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await restoreStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: ["Restored, unpublished. Publish it when it is ready."] };
}

/** Deletes a store template nothing used (D177), after the admin confirmed; its stores are closed and kept. */
export async function deleteStarterAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: ["Tick the box to confirm that it is deleted for good."] };
  const result = await deleteStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  redirect("/admin/platform/store-templates?deleted=1");
}

/** Moves a store template up or down in the order owners see. */
export async function moveStarterAction(starterId: string, direction: "up" | "down"): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await moveStarter(admin, starterId, direction === "up" ? "up" : "down");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: ["Moved."] };
}

/** Opens the template's store admin, making the platform admin an owner of it first if they are not a member yet. */
export async function openStarterAdminAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await joinStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${result.slug}`);
}

/**
 * The features a store template switches on (D178 step 6): its store's features, set as a whole through `setFeatures()`. Reaches new stores on
 * the next Publish. A switch off with something to know (`featureWarnings()`) needs the form's tick, as on the Features page.
 */
export async function setStarterFeaturesAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const target = formData.getAll("features").map(String);
  const result = await setStarterFeatures(admin, starterId, target, { confirmed: formData.get("confirm") === "on" });
  if (!result.ok) {
    return {
      status: "error",
      messages: "needsConfirmation" in result ? [...result.warnings, "Tick “Switch off what I left out” to go on."] : result.problems,
    };
  }
  refresh();
  return { status: "ok", messages: ["Saved. New stores get these features once you publish the template again."] };
}
