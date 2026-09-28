"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { altTextsInput, altRunInput } from "@/lib/alt-text";
import { writeAltText, writeAltTexts, type AltResult, type AltRun } from "@/server/alt-texts";
import { audit, requireMember } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { deleteMedia, describeMedia, measureMedia } from "@/server/media-library";
import { pagesTag } from "@/server/pages";

const id = z.uuid();

/** The store's pages and catalogue show library alt texts (D89): their caches go when one changes. */
function altTextsChanged(storeId: string) {
  updateTag(catalogTag(storeId));
  updateTag(pagesTag(storeId));
}

/** Saves staff's alt texts for a file in the store's media library (D88, D89). */
export async function describeMediaAction(storeSlug: string, mediaId: string, texts: unknown): Promise<{ ok: boolean }> {
  const { account, store } = await requireMember(storeSlug);
  const parsed = altTextsInput.safeParse(texts);
  if (!id.safeParse(mediaId).success || !parsed.success) return { ok: false };
  const ok = await describeMedia({ storeId: store.id, storeSlug: store.slug }, account.id, mediaId, parsed.data);
  if (ok) altTextsChanged(store.id);
  return { ok };
}

/** Writes one picture's alt texts with the store's AI (D89), over staff's too: someone asked for it. */
export async function writeAltTextAction(storeSlug: string, mediaId: string): Promise<AltResult> {
  const { account, store } = await requireMember(storeSlug);
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
  const { account, store } = await requireMember(storeSlug);
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
