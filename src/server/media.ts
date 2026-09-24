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
