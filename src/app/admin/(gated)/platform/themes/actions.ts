"use server";

import { platformActionWords } from "@/server/platform-site-words";
import { countWords, fillWords } from "@/lib/admin-fill";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { designChoice, designTabHref, parseDesignDetails } from "@/lib/design-presets";
import { presetChoice } from "@/lib/design-variations";
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
  saveThemeListing,
  saveThemeOwnPicture,
  unpublishDesign,
} from "@/server/design-presets";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";
import { parseListing, type OwnSlot } from "@/lib/theme-store";
import { syncLaunchThemes } from "@/server/launch-themes";
import { STARTERS_TAG, giveThemeContent, joinStarter, publishStarter, themeContentOf } from "@/server/store-starters";
import { getStore } from "@/server/stores";
import { retryThemeShots } from "@/server/theme-shots";
import { planCurrencies } from "@/server/billing";
import { parseThemePricesForm, setThemePrices } from "@/server/theme-prices";
import { suggestHighlightWords, type HighlightSuggestion } from "@/server/theme-highlight-words";

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
    if (!storeId.success) return { status: "error", messages: [(await platformActionWords()).chooseStoreFrom] };
    origin = { kind: "store", storeId: storeId.data };
  }
  const result = await createDesign(admin, { origin, details: details.details });
  if (!result.ok) return { status: "error", messages: result.problems };
  // Its own content (D275): a copy of the content chosen; a theme can be given it later on its Content tab, so a failure keeps the theme.
  const source = formData.get("content");
  if (typeof source === "string" && source !== "") {
    const given = await giveThemeContent(admin, result.id, source);
    if (given.ok) updateTag(STARTERS_TAG);
    else redirect(`${designTabHref(result.id, "content")}?made=1&nocontent=1`);
  }
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
  return { status: "ok", messages: [(await platformActionWords()).draftSaved] };
}

/** Replaces the profile's draft look with a store's look as it is now (D177). */
export async function copyStoreLookAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const storeId = z.uuid().safeParse(formData.get("store"));
  if (!storeId.success) return { status: "error", messages: [(await platformActionWords()).chooseStoreTakes] };
  if (formData.get("confirm") !== "on") return { status: "error", messages: [(await platformActionWords()).confirmReplace] };
  const result = await copyStoreLookToDraft(admin, presetId, storeId.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: withNotes((await platformActionWords()).lookTaken, result.notes) };
}

/** Publishes a design profile (D177): its draft details, and the look in its workspace as the snapshot stores apply. */
export async function publishDesignAction(presetId: string, _state?: FormState, formData?: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const notes = formData?.get("notes");
  const result = await publishDesign(admin, presetId, typeof notes === "string" ? notes : null);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: withNotes((await platformActionWords()).themePublished, result.notes) };
}

/** Stops offering a design profile at once (D177). */
export async function unpublishDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await unpublishDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  const a = await platformActionWords();
  const pending = result.pendingRequests > 0 ? ` ${countWords(result.pendingRequests, a.themePending, { count: result.pendingRequests })}` : "";
  return { status: "ok", messages: [`${a.themeUnpublished}${pending}`] };
}

/** Archives a theme (D177). */
export async function archiveDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await archiveDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: [(await platformActionWords()).themeArchived] };
}

/** Restores an archived design profile (D177), unpublished. */
export async function unarchiveDesignAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await restoreDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  return { status: "ok", messages: [(await platformActionWords()).restored] };
}

/** Deletes a design profile nothing used (D177), after the admin confirmed. */
export async function deleteDesignAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (formData.get("confirm") !== "on") return { status: "error", messages: [(await platformActionWords()).confirmDelete] };
  const result = await deleteDesign(admin, presetId);
  if (!result.ok) return { status: "error", messages: result.problems };
  offeredChanged();
  redirect(`${THEMES_ADMIN}?deleted=1`);
}

/** Moves a design profile up or down in the order stores see. */
export async function moveDesignAction(presetId: string, direction: "up" | "down"): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await moveDesign(admin, presetId, direction === "up" ? "up" : "down");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).moved] };
}

/** A platform admin applies a design profile to any store from its page on the platform (D176), a store template included. */
export async function applyDesignToStoreAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const store = await getStore(storeSlug);
  const presetId = designChoice(formData.get("design"));
  if (!store) return { status: "error", messages: [(await platformActionWords()).storeGone] };
  if (!presetId) return { status: "error", messages: [(await platformActionWords()).chooseTheme] };
  // A premium theme applied by Kaizena Flow is given, never charged to the store (D286).
  const result = await applyDesignPreset(store.id, presetId, admin.id, {}, presetChoice(formData.get("preset")), "grant");
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(store)) updateTag(tag);
  refresh();
  return { status: "ok", messages: withNotes(fillWords((await platformActionWords()).applied, { previous: result.previous }), result.notes) };
}

/** Puts back the look a store had before its latest design profile, from its page on the platform. */
export async function restoreDesignForStoreAction(storeSlug: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const store = await getStore(storeSlug);
  if (!store) return { status: "error", messages: [(await platformActionWords()).storeGone] };
  const result = await restoreDesignLook(store.id, admin.id);
  if (!result.ok) return { status: "error", messages: result.problems };
  for (const tag of designTags(store)) updateTag(tag);
  refresh();
  return { status: "ok", messages: [fillWords((await platformActionWords()).lookBack, { title: result.presetTitle })] };
}

/** Adds Kaizena Flow's launch themes not there yet and publishes newer versions of those that are (D246, `syncLaunchThemes()`). */
export async function syncLaunchThemesAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await syncLaunchThemes(admin);
  if (result.made.length + result.updated.length > 0) offeredChanged();
  const a = await platformActionWords();
  const said = [
    result.made.length > 0 && fillWords(a.launchAdded, { list: result.made.join(", ") }),
    result.updated.length > 0 && fillWords(a.launchUpdated, { list: result.updated.join(", ") }),
    result.made.length + result.updated.length === 0 && result.problems.length === 0 && a.launchCurrent,
    result.skipped.length > 0 && fillWords(a.launchSkipped, { list: result.skipped.join(", ") }),
  ].filter((line): line is string => typeof line === "string");
  if (result.problems.length > 0) return { status: "error", messages: [...said, ...result.problems] };
  return { status: "ok", messages: said };
}

/** Saves a theme's listing in the theme store (`docs/theme-phase-3.md`): its address, kinds of store, styles and highlight words. Shown at once while published. */
export async function saveThemeListingAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  // The highlights' words (`docs/theme-showcase-phase-2.md` step 2): `highlight:{kind}:title` and `highlight:{kind}:text`.
  const highlights: Record<string, Record<string, unknown>> = {};
  // Its words in the site's other languages (D312 P3): `words:{lang}:summary`, `…:description` and `…:highlight:{kind}:title|text`.
  const words: Record<string, { summary?: unknown; description?: unknown; highlights: Record<string, Record<string, unknown>> }> = {};
  for (const [name, value] of formData.entries()) {
    const [prefix, kind, field] = name.split(":");
    if (prefix === "highlight" && kind && (field === "title" || field === "text")) (highlights[kind] ??= {})[field] = value;
    if (prefix === "words" && kind) {
      const [, , part, highlight, line] = name.split(":");
      const entry = (words[kind] ??= { highlights: {} });
      if (part === "summary" || part === "description") entry[part] = value;
      else if (part === "highlight" && highlight && (line === "title" || line === "text")) (entry.highlights[highlight] ??= {})[line] = value;
    }
  }
  const parsed = parseListing({
    slug: formData.get("slug"),
    kinds: formData.getAll("kinds"),
    styles: formData.getAll("styles"),
    pictures: formData.getAll("pictures"),
    highlights,
    words,
  });
  if (!parsed.ok) return { status: "error", messages: parsed.problems };
  const result = await saveThemeListing(admin, presetId, parsed.slug, parsed.listing);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).listingSaved] };
}

/**
 * A theme's price (D286): Free, or Premium with a price in every currency stores are billed in. Saved at once; the theme store, the
 * choices and Design settings show it straight away. Stores that have the theme when it gets its first price keep it free.
 */
export async function saveThemePricesAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const parsed = parseThemePricesForm(formData, await planCurrencies());
  if (!parsed.ok) return { status: "error", messages: parsed.problems };
  const result = await setThemePrices(admin, presetId, parsed.prices);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  const a = await platformActionWords();
  const note =
    parsed.prices.length === 0
      ? `${a.free}${result.cancelled ? ` ${countWords(result.cancelled, a.freeCancelled, { count: result.cancelled })}` : ""}`
      : `${a.premium}${result.granted ? ` ${countWords(result.granted, a.premiumGranted, { count: result.granted })}` : ""}`;
  return { status: "ok", messages: [note] };
}

/**
 * A theme's own content (D275): a copy of the published content chosen (`giveThemeContent()`), replacing what it had, which is said first
 * in the form. Unpublished until the theme or *Publish the content* publishes it.
 */
export async function giveThemeContentAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const source = formData.get("source");
  const result = await giveThemeContent(admin, presetId, typeof source === "string" ? source : "");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).contentCopied] };
}

/** Publishes a theme's own content now (D275, `publishStarter()`): its frozen copy is what the preview, photographs and new stores read. */
export async function publishThemeContentAction(presetId: string, _state: FormState): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const content = await themeContentOf(presetId);
  if (!content) return { status: "error", messages: [(await platformActionWords()).noContent] };
  const result = await publishStarter(admin, content.starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [(await platformActionWords()).contentPublished, ...result.notes] };
}

/** Opens a theme's own content in its store admin (D275): the platform admin is made its owner if they were not (`joinStarter()`). */
export async function openThemeContentAction(presetId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const content = await themeContentOf(presetId);
  if (!content) return { status: "error", messages: [(await platformActionWords()).noContent] };
  const joined = await joinStarter(admin, content.starterId);
  if (!joined.ok) return { status: "error", messages: joined.problems };
  redirect(`/admin/${joined.slug}`);
}

/** *Try again* on a theme's photographs that could not be made (`docs/theme-showcase-phase-2.md` step 1): the job takes them again. */
export async function retryThemeShotsAction(presetId: string, _state: FormState): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const count = await retryThemeShots(admin, presetId);
  refresh();
  return count > 0
    ? { status: "ok", messages: [countWords(count, (await platformActionWords()).waitingAgain, { count })] }
    : { status: "ok", messages: [(await platformActionWords()).nothingWaiting] };
}

/** *Suggest words* for a theme's highlights: the text model's suggestion, put in the fields unsaved (`suggestHighlightWords()`). */
export async function suggestHighlightWordsAction(presetId: string): Promise<HighlightSuggestion> {
  const admin = await requirePlatformAdmin();
  return suggestHighlightWords(admin, presetId);
}

/** A platform admin's own picture in place of a made one, or none to show the made one again (`saveThemeOwnPicture()`). */
export async function saveThemeOwnPictureAction(presetId: string, slot: OwnSlot, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const url = String(formData.get("pictureUrl") ?? "").trim() || null;
  const result = await saveThemeOwnPicture(admin, presetId, slot, url);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [url ? (await platformActionWords()).ownSaved : (await platformActionWords()).madeAgain] };
}
