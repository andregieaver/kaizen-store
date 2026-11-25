import "server-only";

import { sql } from "drizzle-orm";
import { ImageResponse } from "next/og";
import { z } from "zod";

import { baseScheme } from "@/lib/color-mode";
import { HEADING_WEIGHTS } from "@/lib/theme";
import { parseNavigation } from "@/lib/navigation-schema";
import { publicEnv } from "@/lib/public-env";
import { PICTURE_SIZES, pictureFileName, pictureHeadline, POST_CHANNELS, type PostChannel } from "@/lib/social-posts";

import type { Membership } from "./auth";
import { listGridProducts } from "./catalog";
import { fontFile, type Fetcher } from "./font-outlines";
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
  page_id: z.string().nullable(),
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
 * A file of the store's own (a path on this site, or Supabase Storage's public files), read with a time limit and a size cap; null when it is
 * anywhere else or cannot be read, and the picture is drawn without it.
 */
async function ownFile(url: string | null, origin: string, deps: PictureDeps): Promise<Buffer | null> {
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
    return bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024 ? bytes : null;
  } catch (error) {
    log("warn", "social.picture_file_unread", { host: address.host }, error);
    return null;
  }
}

/** The product's photo as a JPEG data address, cut to fill the box. */
async function photoOf(url: string | null, origin: string, box: { width: number; height: number }, deps: PictureDeps): Promise<string | null> {
  const bytes = await ownFile(url, origin, deps);
  if (!bytes) return null;
  try {
    const sharp = await loadSharp();
    const jpeg = await sharp(bytes, { density: 300 }).flatten({ background: "#ffffff" }).resize(box.width, box.height, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (error) {
    log("warn", "social.picture_photo_unread", {}, error);
    return null;
  }
}

/** The store's logo as a PNG data address at the height given, with its width; transparent parts kept. */
async function logoOf(url: string | null, origin: string, height: number, deps: PictureDeps): Promise<{ src: string; width: number; height: number } | null> {
  const bytes = await ownFile(url, origin, deps);
  if (!bytes) return null;
  try {
    const sharp = await loadSharp();
    const { data, info } = await sharp(bytes, { density: 300 }).resize({ height, width: height * 6, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch (error) {
    log("warn", "social.picture_logo_unread", {}, error);
    return null;
  }
}

type PictureFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: "normal" };

/**
 * The store's heading font at its heading weight and its body font, as the picture's typefaces (Inter where the theme names none, as the
 * site's system font); none when Google Fonts cannot give them, and the picture is drawn in next/og's own font.
 */
async function fontsOf(store: Pick<Membership["store"], "theme">, deps: PictureDeps): Promise<{ heading: string | undefined; body: string | undefined; fonts: PictureFont[] }> {
  const settings = store.theme?.settings;
  const heading = settings?.fonts?.heading || "Inter";
  const body = settings?.fonts?.body || "Inter";
  const weight = HEADING_WEIGHTS[settings?.headings?.weight ?? "semibold"] ?? 600;
  const wanted = [
    { family: heading, weight, as: "heading" },
    { family: body, weight: 400, as: "body" },
    { family: body, weight: 700, as: "body" },
  ];
  const got = await Promise.all(wanted.map((w) => fontFile(w.family, w.weight, deps.fontFetch)));
  const fonts: PictureFont[] = [];
  got.forEach((file, i) => {
    if (file.ok) fonts.push({ name: wanted[i].as, data: file.data, weight: file.weight as PictureFont["weight"], style: "normal" });
  });
  const has = (name: string) => fonts.some((f) => f.name === name);
  return { heading: has("heading") ? "heading" : undefined, body: has("body") ? "body" : undefined, fonts };
}

type PictureDeps = { fetch?: typeof fetch; fontFetch?: Fetcher };

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
export async function socialPicture(member: Membership, postId: string, origin: string, deps: PictureDeps = {}): Promise<PictureResult> {
  if (!z.uuid().safeParse(postId).success) return { ok: false };
  const { store } = member;
  const [post] = await typedRows(
    POST,
    sql`select channel, ref, product_id, page_id, title, caption, price_line from commerce.social_posts where store_id = ${store.id}::uuid and id = ${postId}::uuid`,
  );
  if (!post) return { ok: false };
  const size = PICTURE_SIZES[post.channel as PostChannel];
  const palette = paletteOf(store);
  const market = store.markets[0];
  const found =
    post.product_id && market ? (await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 1, ids: [post.product_id] }))[0] ?? null : null;
  // What the picture shows: the product, or the page of the site (its title and its own picture, C1b); none, the headline alone.
  const [page] = post.page_id
    ? await typedRows(
        z.object({ title: col.text, picture: col.textOrNull }),
        sql`select coalesce(nullif(published ->> 'title', ''), slug) as title, published -> 'thumbnail' ->> 'url' as picture
          from commerce.pages where store_id = ${store.id}::uuid and id = ${post.page_id}::uuid and published is not null`,
      )
    : [];
  const product: { title: string; image: { url: string } | null } | null = found
    ? { title: found.title, image: found.image ? { url: found.image.url } : null }
    : page?.picture
      ? { title: page.title, image: { url: page.picture } }
      : null;

  const pad = Math.round(size.width * 0.06);
  const band = Math.round(size.height * 0.24);
  const photoBox = { width: size.width - pad * 2, height: size.height - band - pad * 2 };
  const scheme = store.theme?.settings ? baseScheme(store.theme.settings) : "light";
  const [nav] = await typedRows(z.object({ navigation: z.unknown() }), sql`select navigation from commerce.stores where id = ${store.id}::uuid`);
  const navigation = parseNavigation(nav?.navigation ?? null);
  const scaleOf = size.width / 1080;
  const [photo, logo, type] = await Promise.all([
    product ? photoOf(product.image?.url ?? null, origin, photoBox, deps) : Promise.resolve(null),
    // On the product picture the logo sits on the page's colour: the dark-background logo where the theme is dark (D60).
    product ? logoOf((scheme === "dark" ? navigation.logoDark ?? navigation.logo : navigation.logo)?.url ?? null, origin, Math.round(64 * scaleOf), deps) : Promise.resolve(null),
    fontsOf(store, deps),
  ]);
  const price = post.price_line && found ? post.price_line.slice(found.title.length).replace(/^\s*·\s*/, "") : null;
  const scale = scaleOf;
  const px = (n: number) => Math.round(n * scale);
  // A family only where it was loaded: next/og cannot read an empty one.
  const face = (family: string | undefined) => (family ? { fontFamily: family } : {});

  const element = product ? (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: palette.background, color: palette.text, padding: pad, ...face(type.body) }}>
      <div style={{ display: "flex", width: photoBox.width, height: photoBox.height, background: palette.surface, borderRadius: px(28), overflow: "hidden" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page
          <img src={photo} width={photoBox.width} height={photoBox.height} alt="" style={{ objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: px(18), paddingTop: pad }}>
        <div style={{ display: "flex", fontSize: product.title.length > 28 ? px(62) : px(80), ...face(type.heading), lineHeight: 1.1 }}>{product.title.slice(0, 70)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page
            <img src={logo.src} width={logo.width} height={logo.height} alt="" />
          ) : (
            <div style={{ display: "flex", fontSize: px(42), opacity: 0.85 }}>{store.name}</div>
          )}
          {price ? (
            <div style={{ display: "flex", background: palette.accent, color: palette.accentText, fontSize: px(48), fontWeight: 700, padding: `${px(16)}px ${px(34)}px`, borderRadius: px(999) }}>
              {price}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: palette.accent, color: palette.accentText, padding: pad * 1.5, ...face(type.body) }}>
      <div style={{ display: "flex", fontSize: px(44), opacity: 0.9 }}>{store.name}</div>
      <div style={{ display: "flex", fontSize: px(96), ...face(type.heading), lineHeight: 1.08 }}>{pictureHeadline(post)}</div>
      <div style={{ display: "flex", width: px(160), height: px(14), background: palette.accentText, borderRadius: px(7) }} />
    </div>
  );

  return {
    ok: true,
    fileName: pictureFileName(post.channel as PostChannel, post.ref),
    response: new ImageResponse(element, { width: size.width, height: size.height, ...(type.fonts.length > 0 ? { fonts: type.fonts } : {}), headers: { "Cache-Control": "private, max-age=300" } }),
  };
}
