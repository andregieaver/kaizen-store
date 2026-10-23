"use server";

import { platformActionWords } from "@/server/platform-site-words";
import { countWords, fillWords } from "@/lib/admin-fill";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import type { PackPictureResult } from "@/components/admin/pack-pictures";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";
import { requirePlatformAdmin } from "@/server/auth";
import {
  askForPackPictures,
  askToRemakePackPicture,
  putBackPackPicture,
  refreshPackStores,
  runPackPictures,
  stopPackPictures,
  syncContentPacks,
} from "@/server/content-packs";
import { DESIGNS_TAG } from "@/server/design-presets";
import { STARTERS_TAG, archiveStarter, deleteStarter, joinStarter, publishStarter, restoreStarter, setStarterFeatures, unpublishStarter } from "@/server/store-starters";

/** What owners are offered changed (D273): the theme cards (sign-up, Create a store) and the theme store's showcases are read again. */
function offeredChanged() {
  updateTag(STARTERS_TAG);
  updateTag(DESIGNS_TAG);
  refresh();
}

/**
 * Publishes a demo store (D177, D273): its store frozen into the copy new stores are made from. Changes made in its store after this reach
 * no new store until it is published again.
 */
export async function publishStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await publishStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return {
    status: "ok",
    messages: [[fillWords((await platformActionWords()).starterPublished, { slug: result.copySlug }), ...result.notes].join(" ")],
  };
}

/** Stops offering a demo store at once (D177): looks shown on it start new stores from the Standard store until it is published again. */
export async function unpublishStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await unpublishStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  const a = await platformActionWords();
  const pending = result.pendingRequests > 0 ? ` ${countWords(result.pendingRequests, a.starterPending, { count: result.pendingRequests })}` : "";
  return { status: "ok", messages: [`${a.starterUnpublished}${pending}`] };
}

/** Archives a demo store (D177): unpublished and out of the list until restored. */
export async function archiveStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await archiveStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: [(await platformActionWords()).starterArchived] };
}

/** Restores an archived demo store (D177), unpublished. */
export async function restoreStarterAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await restoreStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: [(await platformActionWords()).restored] };
}

/** Deletes a demo store nothing used (D177), after the admin confirmed; its stores are closed and kept. */
export async function deleteStarterAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: [(await platformActionWords()).confirmDelete] };
  const result = await deleteStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  redirect(`${THEMES_ADMIN}?deleted=content#starting-content`);
}

/** Opens the demo store's admin, making the platform admin an owner of it first if they are not a member yet. */
export async function openStarterAdminAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await joinStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${result.slug}`);
}

/**
 * The features a demo store switches on (D178 step 6): its store's features, set as a whole through `setFeatures()`. Reaches new stores on
 * the next Publish. A switch off with something to know (`featureWarnings()`) needs the form's tick, as on the Features page.
 */
export async function setStarterFeaturesAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const target = formData.getAll("features").map(String);
  const result = await setStarterFeatures(admin, starterId, target, { confirmed: formData.get("confirm") === "on" });
  if (!result.ok) {
    return {
      status: "error",
      messages: "needsConfirmation" in result ? [...result.warnings, (await platformActionWords()).switchOffConfirm] : result.problems,
    };
  }
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).featuresSaved] };
}

/**
 * Sets up the demo stores (`docs/theme-showcase-phase-1.md` step 2): each content pack's store made the first time and written again when
 * the code has a newer version. Unpublished until the admin publishes each.
 */
export async function syncContentPacksAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await syncContentPacks(admin);
  refreshPackStores(result.stores);
  refresh();
  const said = [
    result.made.length > 0 && fillWords((await platformActionWords()).packsMade, { list: result.made.join(", ") }),
    result.updated.length > 0 && fillWords((await platformActionWords()).packsUpdated, { list: result.updated.join(", ") }),
    result.made.length + result.updated.length === 0 && result.problems.length === 0 && (await platformActionWords()).packsCurrent,
  ].filter((line): line is string => typeof line === "string");
  if (result.problems.length > 0) return { status: "error", messages: [...said, ...result.problems] };
  return { status: "ok", messages: said };
}

/**
 * *Make the pictures* (D271): asks the job to make the pictures the packs named lack, and starts on them at once instead of waiting for the
 * job's next minute. The page need not stay open.
 */
export async function askPackPicturesAction(keys: string[]): Promise<PackPictureResult> {
  const admin = await requirePlatformAdmin();
  const asked = await askForPackPictures(admin, keys);
  if (!asked.ok) return asked;
  after(async () => {
    const result = await runPackPictures(Date.now() + 120_000);
    refreshPackStores(result.stores);
  });
  refresh();
  return { ok: true };
}

/**
 * *Make again* (D283): one of a pack's pictures made again by the job, from the brief as the person left it, starting at once as *Make the
 * pictures* does. The picture shown stays until the new one is made.
 */
export async function remakePackPictureAction(key: string, slot: string, brief: string): Promise<PackPictureResult> {
  const admin = await requirePlatformAdmin();
  const asked = await askToRemakePackPicture(admin, String(key), String(slot), typeof brief === "string" ? brief : null);
  if (!asked.ok) return asked;
  after(async () => {
    const result = await runPackPictures(Date.now() + 120_000);
    refreshPackStores(result.stores);
  });
  refresh();
  return { ok: true };
}

/** *Put back the one before* (D283): the picture a remake replaced is used again, everywhere it was. */
export async function putBackPackPictureAction(key: string, slot: string): Promise<PackPictureResult> {
  const admin = await requirePlatformAdmin();
  const result = await putBackPackPicture(admin, String(key), String(slot));
  if (!result.ok) return result;
  refreshPackStores([result.store]);
  refresh();
  return { ok: true };
}

/** *Stop*: no more of the pack's pictures are made; one being made is finished and kept. */
export async function stopPackPicturesAction(key: string): Promise<PackPictureResult> {
  const admin = await requirePlatformAdmin();
  const stopped = await stopPackPictures(admin, key);
  if (!stopped.ok) return stopped;
  refresh();
  return { ok: true };
}
