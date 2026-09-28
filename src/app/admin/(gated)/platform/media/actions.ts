"use server";

import { z } from "zod";

import { requirePlatformAdmin } from "@/server/auth";
import { deleteMedia, describeMedia, measureMedia } from "@/server/media-library";

const id = z.uuid();
const KAIZEN = { storeId: null, storeSlug: null };

/** Changes a file's description in Kaizen's media library (D88). */
export async function describePlatformMediaAction(mediaId: string, alt: string): Promise<{ ok: boolean }> {
  const admin = await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success || typeof alt !== "string") return { ok: false };
  return { ok: await describeMedia(KAIZEN, admin.id, mediaId, alt) };
}

/** Deletes a file from Kaizen's media library and from Storage. */
export async function deletePlatformMediaAction(mediaId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const admin = await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  return deleteMedia(KAIZEN, admin.id, mediaId);
}

/** Keeps the width and height the library measured, for a file uploaded before the library. */
export async function measurePlatformMediaAction(mediaId: string, width: number, height: number): Promise<void> {
  await requirePlatformAdmin();
  if (!id.safeParse(mediaId).success) return;
  await measureMedia(KAIZEN, mediaId, width, height);
}
