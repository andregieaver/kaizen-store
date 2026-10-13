"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { altTextsInput, altRunInput } from "@/lib/alt-text";
import { CONTENT_TYPES } from "@/lib/taxonomy";
import { writeAltText, writeAltTexts, type AltResult, type AltRun } from "@/server/alt-texts";
import { audit } from "@/server/auth";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { compressibleMedia, pickerPictures, type MediaItem } from "@/server/media-library";
import { MEDIA_DELETE_MAX, deleteMedia, deleteMediaMany, describeMedia, measureMedia } from "@/server/media-library";
import { fieldsTag } from "@/server/custom-fields";
import type { VideoUpload } from "@/server/media";
import { replacePicture, replaceVideo, startVideoReplacement, type CompressOutcome } from "@/server/media-compress";
import { pagesTag } from "@/server/pages";
import { storeTag } from "@/server/stores";
import { termsTag } from "@/server/taxonomy";

const id = z.uuid();

/** The store's pages and catalogue show library alt texts (D89): their caches go when one changes. */
function altTextsChanged(storeId: string) {
  updateTag(catalogTag(storeId));
  updateTag(pagesTag(storeId));
}

/** Saves staff's alt texts for a file in the store's media library (D88, D89). */
export async function describeMediaAction(storeSlug: string, mediaId: string, texts: unknown): Promise<{ ok: boolean }> {
  const { account, store } = await requirePermission(storeSlug, "website:write");
  const parsed = altTextsInput.safeParse(texts);
  if (!id.safeParse(mediaId).success || !parsed.success) return { ok: false };
  const ok = await describeMedia({ storeId: store.id, storeSlug: store.slug }, account.id, mediaId, parsed.data);
  if (ok) altTextsChanged(store.id);
  return { ok };
}

/** Writes one picture's alt texts with the store's AI (D89), over staff's too: someone asked for it. */
export async function writeAltTextAction(storeSlug: string, mediaId: string): Promise<AltResult> {
  const { account, store } = await requirePermission(storeSlug, "website:write");
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  const result = await writeAltText({ storeId: store.id, storeSlug: store.slug }, mediaId, { replace: true });
  if (result.ok) {
    await audit(account.id, store.id, "store.media_alt_written", { mediaId, count: 1 });
    altTextsChanged(store.id);
  }
  return result;
}

/** Writes a batch of the store's missing (or, asked, the AI's earlier) alt texts; the library calls it until none remain. */
export async function writeAltTextsAction(storeSlug: string, run: unknown): Promise<AltRun> {
  const { account, store } = await requirePermission(storeSlug, "website:write");
  const parsed = altRunInput.safeParse(run);
  if (!parsed.success) return { written: 0, failed: 0, remaining: 0, problem: "Start the run again." };
  const result = await writeAltTexts({ storeId: store.id, storeSlug: store.slug }, { since: new Date(parsed.data.since), rewrite: parsed.data.rewrite });
  if (result.written > 0) {
    await audit(account.id, store.id, "store.media_alt_written", { count: result.written });
    altTextsChanged(store.id);
  }
  return result;
}

/** Deletes a file from the store's media library and from Storage. */
export async function deleteMediaAction(storeSlug: string, mediaId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return { ok: false, problem: NO_ACCESS };
  const { account, store } = held;
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  return deleteMedia({ storeId: store.id, storeSlug: store.slug }, account.id, mediaId);
}

/** Deletes several files from the store's media library and from Storage (the library's bulk delete; at most `MEDIA_DELETE_MAX` a call). */
export async function deleteManyMediaAction(storeSlug: string, mediaIds: unknown): Promise<{ deleted: number; kept: number; problem?: string }> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return { deleted: 0, kept: 0, problem: NO_ACCESS };
  const parsed = z.array(id).min(1).max(MEDIA_DELETE_MAX).safeParse(mediaIds);
  if (!parsed.success) return { deleted: 0, kept: 0, problem: "Choose between 1 and 100 files." };
  const { account, store } = held;
  const result = await deleteMediaMany({ storeId: store.id, storeSlug: store.slug }, account.id, parsed.data);
  if (result.deleted > 0) altTextsChanged(store.id);
  return result;
}

/** Keeps the width and height the library measured, for a file uploaded before the library. */
export async function measureMediaAction(storeSlug: string, mediaId: string, width: number, height: number): Promise<void> {
  const { store } = await requirePermission(storeSlug, "website:write");
  if (!id.safeParse(mediaId).success) return;
  await measureMedia({ storeId: store.id, storeSlug: store.slug }, mediaId, width, height);
}

/** The store's pictures for an editor's picker (D88): choosing one needs only that the person can read the website. */
export async function pickMediaAction(storeSlug: string, query: { q: string; limit: number }) {
  const { store } = await requirePermission(storeSlug, "website:read");
  return pickerPictures({ storeId: store.id, storeSlug: store.slug }, { q: String(query?.q ?? ""), limit: Number(query?.limit) });
}

/** Every cache a compressed file's new address can be in (D213): the catalogue, pages, the store's settings, fields and terms. */
function addressesMoved(store: { id: string; slug: string }) {
  altTextsChanged(store.id);
  updateTag(storeTag(store.slug));
  updateTag(fieldsTag(store.id));
  for (const contentType of CONTENT_TYPES) updateTag(termsTag({ storeId: store.id, contentType }));
}

/** A picture the library compressed in the browser takes the original's place (D213). */
export async function compressPictureAction(storeSlug: string, mediaId: string, formData: FormData): Promise<CompressOutcome> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return { ok: false, problem: NO_ACCESS };
  const image = formData.get("image");
  const thumbnail = formData.get("thumbnail");
  if (!id.safeParse(mediaId).success || !(image instanceof File) || !(thumbnail instanceof File)) return { ok: false, problem: "Compress it again." };
  const owner = { storeId: held.store.id, storeSlug: held.store.slug };
  const outcome = await replacePicture(owner, held.account.id, mediaId, image, thumbnail);
  if (outcome.ok) addressesMoved(held.store);
  return outcome;
}

const videoFile = z.object({ type: z.literal("video/mp4"), size: z.number().int().positive() });

/** Starts the upload of a video the library compressed, beside the original (D213). */
export async function startCompressedVideoAction(storeSlug: string, mediaId: string, file: unknown): Promise<VideoUpload> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return { ok: false, problem: NO_ACCESS };
  const parsed = videoFile.safeParse(file);
  if (!id.safeParse(mediaId).success || !parsed.success) return { ok: false, problem: "Compress it again." };
  return startVideoReplacement({ storeId: held.store.id, storeSlug: held.store.slug }, mediaId, parsed.data);
}

/** The compressed video, uploaded, takes the original's place (D213). */
export async function finishCompressedVideoAction(storeSlug: string, mediaId: string, path: unknown): Promise<CompressOutcome> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return { ok: false, problem: NO_ACCESS };
  const parsed = z.string().min(3).max(300).safeParse(path);
  if (!id.safeParse(mediaId).success || !parsed.success) return { ok: false, problem: "Compress it again." };
  const outcome = await replaceVideo({ storeId: held.store.id, storeSlug: held.store.slug }, held.account.id, mediaId, parsed.data);
  if (outcome.ok) addressesMoved(held.store);
  return outcome;
}

/** The store's files that wait for Compress (D213), the largest first. */
export async function compressibleMediaAction(storeSlug: string): Promise<MediaItem[]> {
  const held = await checkPermission(storeSlug, "website:write");
  if (!held) return [];
  return compressibleMedia({ storeId: held.store.id, storeSlug: held.store.slug });
}
