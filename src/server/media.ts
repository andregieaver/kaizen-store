import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { supabaseKeyKind } from "@/lib/supabase-key";

const BUCKET = "product-media";
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);

/**
 * Uploads need Supabase's secret key, which lives only in the server
 * environment. Without it, the editor asks for picture addresses instead.
 */
export function uploadsEnabled(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

/**
 * The secret key, or why uploads cannot work. Storage treats the
 * publishable key as an anonymous visitor and refuses every upload, so
 * that mistake is named rather than reported as a failed upload.
 */
function secretKey(): { key: string } | { problem: string } {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return { problem: "Uploads are not set up on this server." };
  if (supabaseKeyKind(key) === "publishable") {
    console.error("[media] SUPABASE_SECRET_KEY holds the publishable key; Storage refuses its uploads.");
    return {
      problem:
        "Uploads are set up with Supabase's publishable key. The platform needs the secret key (sb_secret_…) in SUPABASE_SECRET_KEY.",
    };
  }
  return { key };
}

export type UploadResult =
  | { ok: true; url: string; thumbnailUrl: string }
  | { ok: false; problem: string };

/** Where an uploaded picture lies in Storage, for the media library (D88). */
export type StoredImage = { bucket: string; path: string; thumbnailPath: string };

/**
 * Stores a product picture and its thumbnail (both already shrunk by the
 * browser) in the store's folder of the public bucket.
 */
export async function uploadProductImage(
  storeId: string,
  image: File,
  thumbnail: File,
): Promise<UploadResult | { ok: true; url: string; thumbnailUrl: string; stored: StoredImage }> {
  const secret = secretKey();
  if ("problem" in secret) return { ok: false, problem: secret.problem };
  for (const file of [image, thumbnail]) {
    if (!TYPES.has(file.type)) return { ok: false, problem: "Use a JPEG, PNG, WebP or AVIF picture." };
    if (file.size === 0 || file.size > MAX_BYTES) {
      return { ok: false, problem: "That picture is too large. Use one under 4 MB." };
    }
  }

  const env = publicEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const name = randomUUID();
  const extension = (file: File) => file.type.split("/")[1];
  const paths = {
    image: `${storeId}/${name}.${extension(image)}`,
    thumbnail: `${storeId}/${name}-480.${extension(thumbnail)}`,
  };
  const storage = supabase.storage.from(BUCKET);
  const options = (file: File) => ({
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  const [big, small] = await Promise.all([
    storage.upload(paths.image, image, options(image)),
    storage.upload(paths.thumbnail, thumbnail, options(thumbnail)),
  ]);
  if (big.error || small.error) {
    console.error("[media] picture upload failed:", (big.error ?? small.error)?.message);
    return { ok: false, problem: "The picture could not be uploaded. Try again." };
  }
  return {
    ok: true,
    url: storage.getPublicUrl(paths.image).data.publicUrl,
    thumbnailUrl: storage.getPublicUrl(paths.thumbnail).data.publicUrl,
    stored: { bucket: BUCKET, path: paths.image, thumbnailPath: paths.thumbnail },
  };
}

/** Removes a library item's files from their public bucket (D88); false if Storage refused. */
export async function removeStoredFiles(bucket: string, paths: string[]): Promise<boolean> {
  if (![BUCKET, VIDEOS_BUCKET].includes(bucket) || paths.length === 0) return false;
  const secret = secretKey();
  if ("problem" in secret) return false;
  const storage = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(bucket);
  const { error } = await storage.remove(paths);
  if (error) console.error("[media] files could not be removed:", error.message);
  return !error;
}

/**
 * Copies a file inside one of the public media buckets, in Storage itself (nothing is downloaded): a template's
 * picture or video into the store that uses it (D125). The new file's public address, or null if it could not be copied.
 */
export async function copyStoredFile(bucket: string, from: string, to: string): Promise<string | null> {
  if (![BUCKET, VIDEOS_BUCKET].includes(bucket)) return null;
  const secret = secretKey();
  if ("problem" in secret) return null;
  const storage = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(bucket);
  const { error } = await storage.copy(from, to);
  if (error) {
    console.error("[media] file could not be copied:", error.message);
    return null;
  }
  return storage.getPublicUrl(to).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Background videos for page rows
// ---------------------------------------------------------------------------

const VIDEOS_BUCKET = "page-videos";
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };

export type VideoUpload =
  | { ok: true; path: string; token: string; bucket: string; url: string }
  | { ok: false; problem: string };

/**
 * Lets the owner's browser upload a row's background video straight to the
 * public bucket (videos are far larger than a server request allows): a
 * signed upload for one new path in the owner's folder, and the address the
 * video will have. The bucket itself refuses other types and larger files.
 */
export async function startVideoUpload(folder: string, file: { type: string; size: number }): Promise<VideoUpload> {
  const extension = VIDEO_TYPES[file.type];
  if (!extension) return { ok: false, problem: "Use an MP4 or WebM video." };
  if (!(file.size > 0) || file.size > VIDEO_MAX_BYTES) {
    return { ok: false, problem: "That video is too large. Use one under 50 MB." };
  }
  const secret = secretKey();
  if ("problem" in secret) return { ok: false, problem: secret.problem };
  const storage = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(VIDEOS_BUCKET);
  const path = `${folder}/${randomUUID()}.${extension}`;
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[media] video upload could not start:", error?.message);
    return { ok: false, problem: "The upload could not be started. Try again." };
  }
  return { ok: true, path, token: data.token, bucket: VIDEOS_BUCKET, url: storage.getPublicUrl(path).data.publicUrl };
}

// ---------------------------------------------------------------------------
// Files for custom fields (D118)
// ---------------------------------------------------------------------------

const FIELD_FILES_BUCKET = "field-files";
/** What a custom field may offer for download, by type: documents and archives, never a page a browser would run. */
const FIELD_FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const FIELD_FILE_ACCEPT = Object.values(FIELD_FILE_TYPES).map((ext) => `.${ext}`).join(",");

export type FieldFileUpload =
  | { ok: true; path: string; token: string; bucket: string; url: string; name: string }
  | { ok: false; problem: string };

/**
 * Lets the owner's browser upload a file for a custom field straight to the
 * public bucket, in the store's own folder: a signed upload for one new path,
 * and the address the file will have. The bucket refuses other types and files
 * over 50 MB as well.
 */
export async function startFieldFileUpload(storeId: string, file: { name: string; type: string; size: number }): Promise<FieldFileUpload> {
  const extension = FIELD_FILE_TYPES[file.type];
  if (!extension) return { ok: false, problem: "Use a PDF, Word, Excel or PowerPoint file, a text or CSV file, or a zip." };
  if (!(file.size > 0) || file.size > VIDEO_MAX_BYTES) return { ok: false, problem: "That file is too large. Use one under 50 MB." };
  const secret = secretKey();
  if ("problem" in secret) return { ok: false, problem: secret.problem };
  const storage = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(FIELD_FILES_BUCKET);
  const base = safeFileName(file.name).replace(/\.[A-Za-z0-9]+$/, "") || "file";
  const path = `${storeId}/${randomUUID()}-${base}.${extension}`;
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[media] file upload could not start:", error?.message);
    return { ok: false, problem: "The upload could not be started. Try again." };
  }
  return { ok: true, path, token: data.token, bucket: FIELD_FILES_BUCKET, url: storage.getPublicUrl(path).data.publicUrl, name: safeFileName(file.name) };
}

/** Whether an address is a file kept for this store's custom fields (a value must not point into another store's folder). */
export function isOwnFieldFile(storeId: string, url: string): boolean {
  try {
    const base = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, "public", { auth: { persistSession: false } }).storage
      .from(FIELD_FILES_BUCKET)
      .getPublicUrl(`${storeId}/`).data.publicUrl;
    return url.startsWith(base) && !url.slice(base.length).includes("/") && !url.includes("..");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Digital files (D24)
// ---------------------------------------------------------------------------

const FILES_BUCKET = "digital-files";

function storageAdmin() {
  const secret = secretKey();
  if ("problem" in secret) return null;
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(FILES_BUCKET);
}

/** A file name safe for a storage path, keeping its extension. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(-120) || "file";
}

export type FileUpload =
  | { ok: true; path: string; token: string; bucket: string }
  | { ok: false; problem: string };

/**
 * Lets the owner's browser upload a download file straight to the private
 * bucket (files can be far larger than a server request allows): a signed
 * upload for one new path in the store's folder.
 */
export async function startFileUpload(storeId: string, fileName: string): Promise<FileUpload> {
  const secret = secretKey();
  const storage = storageAdmin();
  if ("problem" in secret || !storage) {
    return { ok: false, problem: "problem" in secret ? secret.problem : "Uploads are not set up on this server." };
  }
  const path = `${storeId}/${randomUUID()}/${safeFileName(fileName)}`;
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[media] file upload could not start:", error?.message);
    return { ok: false, problem: "The upload could not be started. Try again." };
  }
  return { ok: true, path, token: data.token, bucket: FILES_BUCKET };
}

/** The file's size and type as stored, to check what the browser reports. */
export async function storedFileInfo(path: string): Promise<{ size: number; type: string } | null> {
  const storage = storageAdmin();
  if (!storage) return null;
  const slash = path.lastIndexOf("/");
  const { data } = await storage.list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  const file = data?.[0];
  if (!file?.metadata) return null;
  return { size: Number(file.metadata.size), type: String(file.metadata.mimetype ?? "application/octet-stream") };
}

/** A link that downloads the file for the next minute, under its own name. */
export async function signedDownloadUrl(path: string, name: string): Promise<string | null> {
  const storage = storageAdmin();
  if (!storage) return null;
  const { data } = await storage.createSignedUrl(path, 60, { download: name });
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Profile pictures (D97)
// ---------------------------------------------------------------------------

const AVATARS_BUCKET = "avatars";
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg" };

export type AvatarUpload = { ok: true; path: string } | { ok: false; reason: "off" | "invalid" | "failed" };

function avatarStorage() {
  const secret = secretKey();
  if ("problem" in secret) return null;
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(AVATARS_BUCKET);
}

/**
 * Stores a profile picture (already cropped to a small square by the
 * browser) under a new name in `folder` of the public avatars bucket.
 */
export async function uploadAvatarFile(folder: string, file: File): Promise<AvatarUpload> {
  const extension = AVATAR_TYPES[file.type];
  if (!extension || file.size === 0 || file.size > AVATAR_MAX_BYTES) return { ok: false, reason: "invalid" };
  const storage = avatarStorage();
  if (!storage) return { ok: false, reason: "off" };
  const path = `${folder}/${randomUUID()}.${extension}`;
  const { error } = await storage.upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("[media] profile picture upload failed:", error.message);
    return { ok: false, reason: "failed" };
  }
  return { ok: true, path };
}

/** Removes profile pictures no longer used; a failure only leaves a file behind. */
export async function removeAvatarFiles(paths: string[]): Promise<void> {
  const storage = paths.length > 0 ? avatarStorage() : null;
  if (!storage) return;
  const { error } = await storage.remove(paths);
  if (error) console.error("[media] profile pictures could not be removed:", error.message);
}
