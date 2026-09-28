"use server";

import { z } from "zod";

import { requireMember } from "@/server/auth";
import { deleteMedia, describeMedia, measureMedia } from "@/server/media-library";

const id = z.uuid();

/** Changes a file's description in the store's media library (D88). */
export async function describeMediaAction(storeSlug: string, mediaId: string, alt: string): Promise<{ ok: boolean }> {
  const { account, store } = await requireMember(storeSlug);
  if (!id.safeParse(mediaId).success || typeof alt !== "string") return { ok: false };
  return { ok: await describeMedia({ storeId: store.id, storeSlug: store.slug }, account.id, mediaId, alt) };
}

/** Deletes a file from the store's media library and from Storage. */
export async function deleteMediaAction(storeSlug: string, mediaId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const { account, store } = await requireMember(storeSlug);
  if (!id.safeParse(mediaId).success) return { ok: false, problem: "That file is no longer in the library." };
  return deleteMedia({ storeId: store.id, storeSlug: store.slug }, account.id, mediaId);
}

/** Keeps the width and height the library measured, for a file uploaded before the library. */
export async function measureMediaAction(storeSlug: string, mediaId: string, width: number, height: number): Promise<void> {
  const { store } = await requireMember(storeSlug);
  if (!id.safeParse(mediaId).success) return;
  await measureMedia({ storeId: store.id, storeSlug: store.slug }, mediaId, width, height);
}
