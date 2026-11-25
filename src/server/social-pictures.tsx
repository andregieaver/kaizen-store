import "server-only";

import { sql } from "drizzle-orm";
import { ImageResponse } from "next/og";
import { z } from "zod";

import { baseScheme } from "@/lib/color-mode";
import { publicEnv } from "@/lib/public-env";
import { PICTURE_SIZES, pictureFileName, pictureHeadline, POST_CHANNELS, type PostChannel } from "@/lib/social-posts";

import type { Membership } from "./auth";
import { listGridProducts } from "./catalog";
import { log } from "./log";
import { loadSharp } from "./sharp-load";
import { col, typedRows } from "./typed-rows";

/**
 * A social post's picture (D870 C2, `docs/social-manager.md` 3), composed by code, never by a picture model: the product's own photo in the
 * store's live colours (each pair already at 4.5:1, `themeWarnings()`), its title and the price line the post was written with, and the
 * store's name, in the channel's shape (`PICTURE_SIZES`). A post with no product shows its headline (`pictureHeadline()`) on the store's
 * accent. Made on request and never stored: the same post always gives the same picture.
 */

const POST = z.object({
  channel: z.enum(POST_CHANNELS),
  ref: col.text,
  product_id: z.string().nullable(),
  title: col.text,
  caption: col.text,
  price_line: col.textOrNull,
});

type Palette = { background: string; surface: string; text: string; accent: string; accentText: string };

const hex = (value: unknown, fallback: string) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);

/** The store's live colours, in the scheme it is shown in; plain black on white when the theme cannot be read. */
export function paletteOf(store: Pick<Membership["store"], "theme">): Palette {
  const settings = store.theme?.settings;
  const shown: Partial<Record<keyof Palette, unknown>> | undefined = settings ? settings[baseScheme(settings)] : undefined;
  return {
    background: hex(shown?.background, "#ffffff"),
    surface: hex(shown?.surface, "#f2f2f2"),
    text: hex(shown?.text, "#111111"),
    accent: hex(shown?.accent, "#111111"),
    accentText: hex(shown?.accentText, "#ffffff"),
  };
}

/**
 * The product's photo as a JPEG data address, fitted inside the box: only a file of the store's own (a path on this site, or Supabase
 * Storage's public files), read with a time limit and a size cap; null when there is none or it cannot be read, and the picture is drawn
 * without it.
 */
async function photoOf(url: string | null, origin: string, box: { width: number; height: number }, deps: { fetch?: typeof fetch } = {}): Promise<string | null> {
  if (!url) return null;
  let address: URL;
  try {
    address = new URL(url, origin);
  } catch {
    return null;
  }
  const own = address.origin === new URL(origin).origin || (address.origin === storageOrigin() && address.pathname.startsWith("/storage/v1/object/public/"));
  if (!own) return null;
  try {
    const response = await (deps.fetch ?? fetch)(address, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) return null;
    const sharp = await loadSharp();
    const jpeg = await sharp(bytes, { density: 300 }).flatten({ background: "#ffffff" }).resize(box.width, box.height, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (error) {
    log("warn", "social.picture_photo_unread", { host: address.host }, error);
    return null;
  }
}

/** Supabase Storage's origin, where the store's uploaded photos are; null where the public settings are missing (a test). */
function storageOrigin(): string | null {
  try {
    return new URL(publicEnv().NEXT_PUBLIC_SUPABASE_URL).origin;
  } catch {
    return null;
  }
}

export type PictureResult = { ok: true; response: ImageResponse; fileName: string } | { ok: false };

/** The picture of one of the store's posts, or not found. `origin` is the address the request came to, for the store's own files. */
export async function socialPicture(member: Membership, postId: string, origin: string, deps: { fetch?: typeof fetch } = {}): Promise<PictureResult> {
  if (!z.uuid().safeParse(postId).success) return { ok: false };
  const { store } = member;
  const [post] = await typedRows(
    POST,
    sql`select channel, ref, product_id, title, caption, price_line from commerce.social_posts where store_id = ${store.id}::uuid and id = ${postId}::uuid`,
  );
  if (!post) return { ok: false };
  const size = PICTURE_SIZES[post.channel as PostChannel];
  const palette = paletteOf(store);
  const market = store.markets[0];
  const product =
    post.product_id && market ? (await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 1, ids: [post.product_id] }))[0] ?? null : null;

  const pad = Math.round(size.width * 0.06);
  const band = Math.round(size.height * 0.24);
  const photoBox = { width: size.width - pad * 2, height: size.height - band - pad * 2 };
  const photo = product ? await photoOf(product.image?.url ?? null, origin, photoBox, deps) : null;
  const price = post.price_line && product ? post.price_line.slice(product.title.length).replace(/^\s*·\s*/, "") : null;
  const scale = size.width / 1080;
  const px = (n: number) => Math.round(n * scale);

  const element = product ? (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: palette.background, color: palette.text, padding: pad }}>
      <div style={{ display: "flex", width: photoBox.width, height: photoBox.height, background: palette.surface, borderRadius: px(28), overflow: "hidden" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page
          <img src={photo} width={photoBox.width} height={photoBox.height} alt="" style={{ objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: px(18), paddingTop: pad }}>
        <div style={{ display: "flex", fontSize: product.title.length > 28 ? px(62) : px(80), fontWeight: 700, lineHeight: 1.1 }}>{product.title.slice(0, 70)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: px(42), opacity: 0.85 }}>{store.name}</div>
          {price ? (
            <div style={{ display: "flex", background: palette.accent, color: palette.accentText, fontSize: px(48), fontWeight: 700, padding: `${px(16)}px ${px(34)}px`, borderRadius: px(999) }}>
              {price}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: palette.accent, color: palette.accentText, padding: pad * 1.5 }}>
      <div style={{ display: "flex", fontSize: px(44), opacity: 0.9 }}>{store.name}</div>
      <div style={{ display: "flex", fontSize: px(96), fontWeight: 700, lineHeight: 1.08 }}>{pictureHeadline(post)}</div>
      <div style={{ display: "flex", width: px(160), height: px(14), background: palette.accentText, borderRadius: px(7) }} />
    </div>
  );

  return {
    ok: true,
    fileName: pictureFileName(post.channel as PostChannel, post.ref),
    response: new ImageResponse(element, { width: size.width, height: size.height, headers: { "Cache-Control": "private, max-age=300" } }),
  };
}
