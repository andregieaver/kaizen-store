import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { RECORDING_BUCKET, recordingFolder } from "@/lib/recording";
import { supabaseKeyKind } from "@/lib/supabase-key";

import { log } from "./log";

/**
 * The files of recordings of visits (D656, `docs/heatmaps-and-recordings.md` 6.4): the private bucket `recordings`, written, read and
 * emptied only here with the secret key. A segment is `{storeId}/{id}/{seq}.gz`, a sealed recording `{storeId}/{id}/all.gz`; the row says
 * which exist (`pathsOf()` in `src/lib/recording.ts`). A file is never overwritten (`upsert: false`): a segment sent twice is "exists".
 */

export type UploadAnswer = "ok" | "exists" | "failed";

export type RecordingFiles = {
  upload(path: string, bytes: Uint8Array): Promise<UploadAnswer>;
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<boolean>;
  /** Every file name in one recording's folder (at most 201). */
  list(storeId: string, id: string): Promise<string[] | null>;
};

/** Whether a storage error says the file is already there. */
export function alreadyThere(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
  return e.statusCode === "409" || e.statusCode === 409 || e.status === 409 || (typeof e.message === "string" && /already exists|duplicate/i.test(e.message));
}

/** The bucket behind the secret key, or null when this server has none (no recording is then kept, and none removed). */
export function recordingFiles(): RecordingFiles | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(RECORDING_BUCKET);
  return {
    async upload(path, bytes) {
      const { error } = await bucket.upload(path, bytes, { contentType: "application/gzip", cacheControl: "0", upsert: false });
      if (!error) return "ok";
      if (alreadyThere(error)) return "exists";
      log("error", "recordings.store_failed", {}, error);
      return "failed";
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket.remove(paths);
      if (error) log("error", "recordings.remove_failed", {}, error);
      return !error;
    },
    async list(storeId, id) {
      const folder = recordingFolder(storeId, id).slice(0, -1);
      const { data, error } = await bucket.list(folder, { limit: 201, offset: 0, sortBy: { column: "name", order: "asc" } });
      if (error || !data) return null;
      return data.map((f) => `${folder}/${f.name}`);
    },
  };
}
