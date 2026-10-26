import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { publicEnv } from "@/lib/env";
import { pictureIdOfFile, picturePaths } from "@/lib/review-pictures";
import type { ReviewPictureType } from "@/lib/review-status";
import { supabaseKeyKind } from "@/lib/supabase-key";

type Row = Record<string, unknown>;

/**
 * The files of reviews' pictures (D301 G4, `docs/wave-5-marketing.md` 9.7): the private bucket `review-pictures`, written, read and emptied
 * only here with the secret key. A file is named by its picture's id (`picturePaths()`), so the rows say which files there are; files a
 * write left behind (a write that failed after its upload, a review gone with its product) are swept by `pruneReviewPictureFiles()`.
 */

export const REVIEW_PICTURES_BUCKET = "review-pictures";

export type StoredFile = { name: string; createdAt: string | null };

export type ReviewPictureStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<boolean>;
  /** Up to `limit` names in a folder (the bucket's root lists its stores' folders), from `offset`. */
  list(folder: string, limit: number, offset: number): Promise<StoredFile[] | null>;
};

/** The bucket behind the secret key, or null when this server has none (no picture can then be added, and none is shown). */
export function reviewPictureStorage(): ReviewPictureStorage | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(REVIEW_PICTURES_BUCKET);
  return {
    async upload(path, bytes, contentType) {
      const { error } = await bucket.upload(path, bytes, { contentType, cacheControl: "0", upsert: false });
      if (error) console.error("[reviews] a picture could not be stored:", error.message);
      return !error;
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket.remove(paths);
      if (error) console.error("[reviews] pictures could not be removed:", error.message);
      return !error;
    },
    async list(folder, limit, offset) {
      const { data, error } = await bucket.list(folder, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !data) return null;
      return data.map((f) => ({ name: f.name, createdAt: (f.created_at as string | null) ?? null }));
    },
  };
}

export type StoredPicture = { id: string; type: ReviewPictureType };

/** The paths of pictures' files and small copies. */
export const filesOf = (storeId: string, pictures: readonly StoredPicture[]): string[] =>
  pictures.flatMap((p) => {
    const paths = picturePaths(storeId, p.id, p.type);
    return [paths.full, paths.thumb];
  });

/** Removes pictures' files after their rows went; a failure is left to the daily sweep. */
export async function removePictureFiles(storeId: string, pictures: readonly StoredPicture[], storage: ReviewPictureStorage | null = reviewPictureStorage()): Promise<void> {
  if (!storage || pictures.length === 0) return;
  try {
    await storage.remove(filesOf(storeId, pictures));
  } catch (error) {
    console.error("[reviews] pictures' files are left for the daily sweep", error);
  }
}

/** A file this young may belong to a write still running, so the sweep leaves it. */
const SWEEP_AFTER_MS = 60 * 60 * 1000;
const PAGE = 1000;

/**
 * The daily sweep (9.7): every file in the bucket whose picture has no row (its write failed after the upload, or its review went with its
 * product or customer) is removed, store folder by store folder, leaving files younger than an hour. Stops at `deadline`.
 */
export async function pruneReviewPictureFiles({
  deadline = Date.now() + 60_000,
  storage = reviewPictureStorage(),
  now = Date.now(),
}: { deadline?: number; storage?: ReviewPictureStorage | null; now?: number } = {}): Promise<{ removed: number }> {
  if (!storage) return { removed: 0 };
  let removed = 0;
  const folders: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await storage.list("", PAGE, offset);
    if (!page) return { removed };
    folders.push(...page.map((f) => f.name).filter((n) => /^[0-9a-f-]{36}$/.test(n)));
    if (page.length < PAGE) break;
  }
  for (const store of folders) {
    if (Date.now() > deadline) break;
    const stale: { name: string; id: string }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await storage.list(store, PAGE, offset);
      if (!page) break;
      for (const f of page) {
        const id = pictureIdOfFile(f.name);
        const old = f.createdAt === null || now - new Date(f.createdAt).getTime() > SWEEP_AFTER_MS;
        if (old) stale.push({ name: f.name, id: id ?? "" });
      }
      if (page.length < PAGE) break;
    }
    if (stale.length === 0) continue;
    const ids = [...new Set(stale.map((s) => s.id).filter(Boolean))];
    const rows = ids.length
      ? await db().execute<Row>(sql`
          select id from commerce.review_pictures
          where store_id = ${store}::uuid and id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)
        `)
      : [];
    const kept = new Set(rows.map((r) => String(r.id)));
    const gone = stale.filter((s) => !kept.has(s.id)).map((s) => `${store}/${s.name}`);
    for (let i = 0; i < gone.length; i += 100) {
      if (await storage.remove(gone.slice(i, i + 100))) removed += gone.slice(i, i + 100).length;
    }
  }
  return { removed };
}

export type PictureFile = { bytes: Uint8Array; type: ReviewPictureType; shown: boolean };

/**
 * A picture's file for the public route (9.7): shown to everyone while its review is published, the picture not hidden and the store taking
 * reviews (`shown`), else only to its author (`isAuthor` asks the store's signed-in customer, only when needed). Null: there is none for them.
 */
export async function pictureForVisitor(
  pictureId: string,
  small: boolean,
  isAuthor: (storeId: string, buyerKey: string) => Promise<boolean>,
  storage: ReviewPictureStorage | null = reviewPictureStorage(),
): Promise<PictureFile | null> {
  if (!storage) return null;
  const [row] = await db().execute<Row>(sql`
    select p.store_id, p.type, r.buyer_key,
      (r.status = 'published' and p.hidden_at is null and commerce.feature_on(s.id, 'reviews') and commerce.store_is_active(s.id)
        and not (s.is_template or s.starter)) as shown
    from commerce.review_pictures p
    join commerce.product_reviews r on r.store_id = p.store_id and r.id = p.review_id
    join commerce.stores s on s.id = p.store_id
    where p.id = ${pictureId}::uuid
  `);
  if (!row) return null;
  const storeId = String(row.store_id);
  const shown = Boolean(row.shown);
  if (!shown && !(row.buyer_key && (await isAuthor(storeId, String(row.buyer_key))))) return null;
  return fileOf(storage, storeId, pictureId, row.type as ReviewPictureType, small, shown);
}

/** A picture's file for the store's staff (9.7), whatever its review's state, only of that store. */
export async function pictureForStaff(storeId: string, pictureId: string, small: boolean, storage: ReviewPictureStorage | null = reviewPictureStorage()): Promise<PictureFile | null> {
  if (!storage) return null;
  const [row] = await db().execute<Row>(sql`select type from commerce.review_pictures where store_id = ${storeId}::uuid and id = ${pictureId}::uuid`);
  return row ? fileOf(storage, storeId, pictureId, row.type as ReviewPictureType, small, false) : null;
}

async function fileOf(storage: ReviewPictureStorage, storeId: string, id: string, type: ReviewPictureType, small: boolean, shown: boolean): Promise<PictureFile | null> {
  const paths = picturePaths(storeId, id, type);
  const bytes = await storage.download(small ? paths.thumb : paths.full).catch(() => null);
  return bytes ? { bytes, type, shown } : null;
}
