import "server-only";

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";

import { db } from "@/db/client";
import { webpHasXmp, withWebpXmp } from "@/lib/webp-xmp";

import { aiSourceXmp, type AiSource } from "./ai-pictures";
import { log } from "./log";
import { downloadStoredFile, overwriteStoredFile } from "./media";
import { col, typedRows } from "./typed-rows";

/**
 * The AI pictures made before their files were marked (AI Act Art. 50(2), `docs/ai-act.md`): each is given IPTC's digital source type in
 * its XMP, the picture's bytes untouched (`withWebpXmp()`: chunks rearranged, never re-encoded), written back at its own path so no page's
 * address changes, and recorded in `media.ai_marked_at`. A file that already carries the packet is only recorded. Ten a run of the
 * five-minute dispatcher; one that fails is logged and tried again next run. New pictures are marked when they are made and never come here.
 */

/** How many pictures one run marks. */
export const MARKS_PER_RUN = 10;

type Storage = {
  read: (bucket: string, path: string) => Promise<Uint8Array | null>;
  write: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>;
};
const STORAGE: Storage = { read: downloadStoredFile, write: overwriteStoredFile };

/** One file marked, or found marked already; null when it could not be read or written. */
async function markFile(storage: Storage, bucket: string, path: string, source: AiSource): Promise<"marked" | "found" | null> {
  const bytes = await storage.read(bucket, path);
  if (!bytes) return null;
  if (webpHasXmp(bytes)?.includes("DigitalSourceType")) return "found";
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return null;
  const marked = withWebpXmp(bytes, aiSourceXmp(source), { width: meta.width, height: meta.height, alpha: Boolean(meta.hasAlpha) });
  return (await storage.write(bucket, path, marked, "image/webp")) ? "marked" : null;
}

/** Marks up to `MARKS_PER_RUN` unmarked AI pictures. Returns how many were marked, found marked, and failed. */
export async function markAiPictures(deps: { storage?: Storage; limit?: number } = {}): Promise<{ marked: number; found: number; failed: number }> {
  const storage = deps.storage ?? STORAGE;
  const rows = await typedRows(
    z.object({ id: col.uuid, bucket: col.text, path: col.text, thumbnail_path: col.textOrNull, made_by: col.text }),
    sql`
      select id, bucket, path, thumbnail_path, made_by from commerce.media
      where made_by in ('ai_made', 'ai_edited') and ai_marked_at is null and kind = 'image' and content_type = 'image/webp'
      order by created_at, id
      limit ${deps.limit ?? MARKS_PER_RUN}
    `,
  );
  const counts = { marked: 0, found: 0, failed: 0 };
  for (const row of rows) {
    const source: AiSource = row.made_by === "ai_edited" ? "edited" : "made";
    try {
      const files = [row.path, ...(row.thumbnail_path ? [row.thumbnail_path] : [])];
      const outcomes = [];
      for (const path of files) outcomes.push(await markFile(storage, row.bucket, path, source));
      if (outcomes.some((outcome) => outcome === null)) {
        counts.failed += 1;
        log("warn", "ai_pictures.mark_failed", { mediaId: row.id });
        continue;
      }
      await db().execute(sql`update commerce.media set ai_marked_at = now() where id = ${row.id}::uuid and ai_marked_at is null`);
      if (outcomes.every((outcome) => outcome === "found")) counts.found += 1;
      else counts.marked += 1;
    } catch (error) {
      counts.failed += 1;
      log("error", "ai_pictures.mark_failed", { mediaId: row.id }, error);
    }
  }
  if (rows.length > 0) log("info", "ai_pictures.marked", counts);
  return counts;
}
