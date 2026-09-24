import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";

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

export type UploadResult =
  | { ok: true; url: string; thumbnailUrl: string }
  | { ok: false; problem: string };

/**
 * Stores a product picture and its thumbnail (both already shrunk by the
 * browser) in the store's folder of the public bucket.
 */
export async function uploadProductImage(
  storeId: string,
  image: File,
  thumbnail: File,
): Promise<UploadResult> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return { ok: false, problem: "Picture uploads are not set up on this server." };
  for (const file of [image, thumbnail]) {
    if (!TYPES.has(file.type)) return { ok: false, problem: "Use a JPEG, PNG, WebP or AVIF picture." };
    if (file.size === 0 || file.size > MAX_BYTES) {
      return { ok: false, problem: "That picture is too large. Use one under 4 MB." };
    }
  }

  const env = publicEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
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
    return { ok: false, problem: "The picture could not be uploaded. Try again." };
  }
  return {
    ok: true,
    url: storage.getPublicUrl(paths.image).data.publicUrl,
    thumbnailUrl: storage.getPublicUrl(paths.thumbnail).data.publicUrl,
  };
}

// ---------------------------------------------------------------------------
// Digital files (D24)
// ---------------------------------------------------------------------------

const FILES_BUCKET = "digital-files";

function storageAdmin() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secret, {
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
  const storage = storageAdmin();
  if (!storage) return { ok: false, problem: "File uploads are not set up on this server." };
  const path = `${storeId}/${randomUUID()}/${safeFileName(fileName)}`;
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error || !data) return { ok: false, problem: "The upload could not be started. Try again." };
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
