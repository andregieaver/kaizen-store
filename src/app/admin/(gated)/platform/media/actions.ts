"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { altTextsInput, altRunInput } from "@/lib/alt-text";
import { writeAltText, writeAltTexts, type AltResult, type AltRun } from "@/server/alt-texts";
import { audit, requirePlatformAdmin } from "@/server/auth";
import { pickerPictures } from "@/server/media-library";
import { MEDIA_DELETE_MAX, deleteMedia, deleteMediaMany, describeMedia, measureMedia } from "@/server/media-library";
import { pagesTag } from "@/server/pages";

const id = z.uuid();
const KAIZEN = { storeId: null, storeSlug: null };

/** Saves staff's alt texts for a file in Kaizen's media library (D88, D89). */
export async function describePlatformMediaAction(mediaId: string, texts: unknown): Promise<{ ok: boolean }> {
  const admin = await requirePlatformAdmin();
  const parsed = altTextsInput.safeParse(texts);
  if (!id.safeParse(mediaId).success || !parsed.success) return { ok: false };
  const ok = await describeMedia(KAIZEN, admin.id, mediaId, parsed.data);
  if (ok) updateTag(pagesTag(null));
  return { ok };
}

/** Writes one picture's alt text with Kaizen's AI (D89). */
export async function writePlatformAltTextAction(mediaId: string): Promise<AltResult> {
  const admin = await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  const result = await writeAltText(KAIZEN, mediaId, { replace: true });
  if (result.ok) {
    await audit(admin.id, null, "platform.media_alt_written", { mediaId, count: 1 });
    updateTag(pagesTag(null));
  }
  return result;
}

/** Writes a batch of Kaizen's missing (or, asked, the AI's earlier) alt texts. */
export async function writePlatformAltTextsAction(run: unknown): Promise<AltRun> {
  const admin = await requirePlatformAdmin();
  const parsed = altRunInput.safeParse(run);
  if (!parsed.success) return { written: 0, failed: 0, remaining: 0, problem: "Start the run again." };
  const result = await writeAltTexts(KAIZEN, { since: new Date(parsed.data.since), rewrite: parsed.data.rewrite });
  if (result.written > 0) {
    await audit(admin.id, null, "platform.media_alt_written", { count: result.written });
    updateTag(pagesTag(null));
  }
  return result;
}

/** Deletes a file from Kaizen's media library and from Storage. */
export async function deletePlatformMediaAction(mediaId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const admin = await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  return deleteMedia(KAIZEN, admin.id, mediaId);
}

/** Deletes several files from Kaizen's media library and from Storage (the library's bulk delete). */
export async function deleteManyPlatformMediaAction(mediaIds: unknown): Promise<{ deleted: number; kept: number; problem?: string }> {
  const admin = await requirePlatformAdmin();
  const parsed = z.array(id).min(1).max(MEDIA_DELETE_MAX).safeParse(mediaIds);
  if (!parsed.success) return { deleted: 0, kept: 0, problem: "Choose between 1 and 100 files." };
  const result = await deleteMediaMany(KAIZEN, admin.id, parsed.data);
  if (result.deleted > 0) updateTag(pagesTag(null));
  return result;
}

/** Keeps the width and height the library measured, for a file uploaded before the library. */
export async function measurePlatformMediaAction(mediaId: string, width: number, height: number): Promise<void> {
  await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success) return;
  await measureMedia(KAIZEN, mediaId, width, height);
}

/** Kaizen's pictures for an editor's picker (D88). */
export async function pickPlatformMediaAction(query: { q: string; limit: number }) {
  await requirePlatformAdmin();
  return pickerPictures(KAIZEN, { q: String(query?.q ?? ""), limit: Number(query?.limit) });
}
