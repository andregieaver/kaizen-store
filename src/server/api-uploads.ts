import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { UPLOAD_MAX_BYTES, UPLOAD_SECONDS } from "@/lib/admin-api-catalogue";

import { shrinkPicture } from "./ai-pictures";
import { dataStorage, IMPORTS_BUCKET, type DataStorage } from "./data-job-store";
import { storageRefusal } from "./limits";
import { log } from "./log";
import { describeMedia, storePicture } from "./media-library";
import { pictureKind } from "./replicate-images";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Pictures sent over the Admin API (wave 14 unit C1, D440): the only writer of `commerce.api_uploads`. `POST /media/uploads` keeps a row and
 * gives a one-time signed address in the private `imports` bucket (`{store}/api-uploads/{id}`); `POST /media` claims the row once, reads the
 * file there and checks it as the media library checks an upload (D88): a JPEG, PNG, WebP or AVIF read from its own bytes, shrunk as the
 * admin's browser shrinks pictures (D213: WebP, at most 1600 pixels wide, and a 480-pixel copy), counted against the store's storage, and
 * kept by `storePicture()`, the library's own writer. The file it was sent as is removed then; a row and its file go a day after they end.
 */

export type UploadStarted = { ok: true; id: string; url: string; expiresAt: string } | { ok: false; code: "invalid" | "failed"; problem: string };

/** The formats a picture may be, read from its bytes (sharp names AVIF `heif`). */
const FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

/** Where a signed upload is sent: the address Storage gave, or the one its token makes (also the product file's, D165). */
export function uploadUrl(path: string, started: { token: string; url?: string }): string {
  if (started.url) return started.url;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/upload/sign/${IMPORTS_BUCKET}/${path}?token=${encodeURIComponent(started.token)}`;
}

/** Starts an upload for a token: its row and a one-time address, for `UPLOAD_SECONDS`. */
export async function startUpload(
  owner: { storeId: string; tokenId: string },
  input: { contentType: string; sizeBytes: number },
  storage: DataStorage | null = dataStorage(),
): Promise<UploadStarted> {
  if (!storage) return { ok: false, code: "failed", problem: "Uploads are not set up on this server." };
  const full = await storageRefusal(owner.storeId, input.sizeBytes);
  if (full) return { ok: false, code: "invalid", problem: full };
  const id = randomUUID();
  const path = `${owner.storeId}/api-uploads/${id}`;
  const started = await storage.signedUpload(path);
  if (!started) return { ok: false, code: "failed", problem: "The upload could not be started. Try again." };
  const row = await typedRow(
    z.object({ expires_at: col.timestamp }),
    sql`
      insert into commerce.api_uploads (id, store_id, token_id, path, content_type, size_bytes, expires_at)
      values (${id}::uuid, ${owner.storeId}::uuid, ${owner.tokenId}::uuid, ${path}, ${input.contentType}, ${input.sizeBytes}, now() + make_interval(secs => ${UPLOAD_SECONDS}))
      returning expires_at
    `,
  );
  return { ok: true, id, url: uploadUrl(path, started), expiresAt: row!.expires_at };
}

export type UploadKept = { ok: true; mediaId: string } | { ok: false; code: "not_found" | "invalid" | "conflict" | "failed"; problem: string };

/**
 * Keeps the file sent to an upload's address in the library, once: the row is claimed first (a second call finds it used), and let go again
 * when the file is missing or cannot be kept, so the caller can send it and try again before the address ends.
 */
export async function keepUpload(
  owner: { storeId: string; tokenId: string; accountId: string },
  input: { uploadId: string; fileName?: string; alt?: string },
  storage: DataStorage | null = dataStorage(),
): Promise<UploadKept> {
  if (!storage) return { ok: false, code: "failed", problem: "Uploads are not set up on this server." };
  const claimed = await typedRow(
    z.object({ path: col.text }),
    sql`
      update commerce.api_uploads set used_at = now()
      where store_id = ${owner.storeId}::uuid and id = ${input.uploadId}::uuid and token_id = ${owner.tokenId}::uuid and used_at is null and expires_at > now()
      returning path
    `,
  );
  if (!claimed) {
    const seen = await typedRow(
      z.object({ used: col.bool }),
      sql`select used_at is not null as used from commerce.api_uploads where store_id = ${owner.storeId}::uuid and id = ${input.uploadId}::uuid and token_id = ${owner.tokenId}::uuid`,
    );
    if (!seen) return { ok: false, code: "not_found", problem: "No such upload for this token." };
    return seen.used ? { ok: false, code: "conflict", problem: "This upload was used already." } : { ok: false, code: "invalid", problem: "This upload's address has ended. Start another." };
  }
  const release = async (outcome: UploadKept) => {
    await db().execute(sql`update commerce.api_uploads set used_at = null where store_id = ${owner.storeId}::uuid and id = ${input.uploadId}::uuid and media_id is null`);
    return outcome;
  };
  const bytes = await storage.download(IMPORTS_BUCKET, claimed.path);
  if (!bytes || bytes.byteLength === 0) return release({ ok: false, code: "invalid", problem: "No file was sent to the upload's address yet." });
  if (bytes.byteLength > UPLOAD_MAX_BYTES) return release({ ok: false, code: "invalid", problem: `The file is larger than ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.` });
  const kind = await pictureKind(bytes);
  if (!kind || !FORMATS.has(kind.format)) return release({ ok: false, code: "invalid", problem: "Use a JPEG, PNG, WebP or AVIF picture." });
  let shrunk: Awaited<ReturnType<typeof shrinkPicture>>;
  try {
    shrunk = await shrinkPicture(bytes);
  } catch {
    return release({ ok: false, code: "invalid", problem: "The picture could not be read." });
  }
  const full = await storageRefusal(owner.storeId, shrunk.image.byteLength + shrunk.thumbnail.byteLength);
  if (full) return release({ ok: false, code: "invalid", problem: full });
  const base = (input.fileName?.trim() || "picture").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const stored = await storePicture(
    { storeId: owner.storeId, accountId: owner.accountId },
    new File([new Uint8Array(shrunk.image)], `${base}.webp`, { type: "image/webp" }),
    new File([new Uint8Array(shrunk.thumbnail)], `${base}-480.webp`, { type: "image/webp" }),
    { fileName: `${base}.webp`, compressed: true },
  );
  if (!stored.ok) return release({ ok: false, code: "invalid", problem: stored.problem });
  if (!stored.id) return release({ ok: false, code: "failed", problem: "The picture was stored but could not be kept in the library." });
  // Words a person gave are staff's (the AI never writes over them); left out, the library's AI writes them (D89).
  if (input.alt?.trim()) await describeMedia({ storeId: owner.storeId, storeSlug: null }, owner.accountId, stored.id, { alt: input.alt, translations: {} });
  await db().execute(sql`update commerce.api_uploads set media_id = ${stored.id}::uuid where store_id = ${owner.storeId}::uuid and id = ${input.uploadId}::uuid`);
  await storage.remove(IMPORTS_BUCKET, [claimed.path]).catch(() => false);
  return { ok: true, mediaId: stored.id };
}

/** Uploads a day past their end, used or not: their files (if still there) and rows go. The data jobs' daily run calls it. */
export async function pruneApiUploads(storage: DataStorage | null = dataStorage()): Promise<number> {
  if (!storage) return 0;
  const old = await typedRows(
    z.object({ id: col.uuid, path: col.text }),
    sql`select id, path from commerce.api_uploads where expires_at < now() - interval '1 day' order by expires_at limit 500`,
  );
  if (old.length === 0) return 0;
  if (!(await storage.remove(IMPORTS_BUCKET, old.map((r) => r.path)).catch(() => false))) {
    log("warn", "api_uploads.prune_failed", { rows: old.length });
    return 0;
  }
  await db().execute(sql`delete from commerce.api_uploads where id = any(${`{${old.map((r) => r.id).join(",")}}`}::uuid[])`);
  return old.length;
}
