import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { contentPack } from "@/lib/content-packs";
import { LAUNCH_THEMES, type LaunchTheme } from "@/lib/launch-themes";
import type { PackPictureOf } from "@/lib/pack-designs";
import { savedPartInput, type SavedPart } from "@/lib/saved-parts";
import { siteUrl } from "@/lib/site";
import { isStorageUrl, leftoverStorageUrls, mapTemplateMedia, templateMediaUrls } from "@/lib/template-content";
import { themeSection, type SectionResult, type SectionTile, type ThemeSection, type ThemeSectionsOffer } from "@/lib/theme-sections";

import { audit, type Account } from "./auth";
import type { copyStoredFile } from "./media";
import { copyToLibrary, libraryFilesByUrl } from "./media-library";

/**
 * A theme's own sections in the page builder (D272, `docs/signature-themes.md` step 4): while a signature theme is live on a store (or on
 * Kaizena Flow's own site), its designed rows are offered on the Rows tab, with words written for any store and the pictures of the theme's
 * demo store (the photograph once made, else the theme's art). Placing one copies its pictures into the owner's library, as using a
 * template does (`applyTemplate()`), so the page never points at another store's files.
 */

type Row = Record<string, unknown>;

/** The launch theme live on a store, or on Kaizena Flow's site (null), when it offers sections. */
async function liveTheme(owner: string | null): Promise<LaunchTheme | null> {
  const [row] = owner
    ? await db().execute<Row>(sql`
        select p.launch_key from commerce.store_theme_installs i join commerce.design_presets p on p.id = i.preset_id
        where i.store_id = ${owner}::uuid and i.live
      `)
    : await db().execute<Row>(sql`
        select p.launch_key from commerce.platform_theme_installs i join commerce.design_presets p on p.id = i.preset_id where i.live
      `);
  const key = typeof row?.launch_key === "string" ? row.launch_key : null;
  return LAUNCH_THEMES.find((theme) => theme.key === key && theme.sections) ?? null;
}

/**
 * The pictures a theme's sections are made with: the theme's demo store's (`pack_pictures`, a photograph or the art placed there, in its
 * library) by slot, else the theme's art from the site's own files, as a full address the page can keep.
 */
async function sectionPictures(theme: LaunchTheme): Promise<{ sourceId: string | null; picture: PackPictureOf }> {
  const pack = contentPack(theme.listing.pack ?? "");
  const [row] = pack
    ? await db().execute<Row>(sql`select store_id, pack_pictures from commerce.store_starters where pack_key = ${pack.key}`)
    : [];
  const kept = row?.pack_pictures && typeof row.pack_pictures === "object" ? (row.pack_pictures as Record<string, { url?: unknown; width?: unknown; height?: unknown; alt?: unknown }>) : {};
  const picture: PackPictureOf = (slot) => {
    const made = kept[slot];
    if (made && typeof made.url === "string" && typeof made.width === "number" && typeof made.height === "number") {
      return { url: made.url, width: made.width, height: made.height, alt: typeof made.alt === "string" ? made.alt : "" };
    }
    const art = pack?.art?.[slot];
    return art ? { ...art, url: `${siteUrl()}${art.url}` } : null;
  };
  return { sourceId: row?.store_id ? String(row.store_id) : null, picture };
}

const tile = (section: ThemeSection, picture: PackPictureOf): SectionTile => ({
  key: section.key,
  name: section.name,
  description: section.description,
  thumb: section.thumb ? (picture(section.thumb)?.url ?? null) : null,
});

/** What the Rows tab offers from the live theme: its title and its sections, or null when it has none. */
export async function themeSectionsFor(owner: string | null): Promise<ThemeSectionsOffer> {
  const theme = await liveTheme(owner);
  if (!theme?.sections) return null;
  const { picture } = await sectionPictures(theme);
  return { theme: theme.title, sections: theme.sections(picture).map((section) => tile(section, picture)) };
}

/**
 * One of the live theme's sections, ready to place on a page of the owner's: a row with fresh words for any store, its pictures copied
 * from the theme's demo store into the owner's library (an art file of the site's own stays a full address), checked as a saved row is.
 * The owner is a store (`owner`) or Kaizena Flow's own site (null); the caller has checked the person may change its pages.
 */
export async function placeThemeSection(
  owner: string | null,
  account: Account,
  key: string,
  deps: { copyFile?: typeof copyStoredFile } = {},
): Promise<SectionResult> {
  const theme = await liveTheme(owner);
  if (!theme) return { ok: false, problem: "Your theme has no sections of its own." };
  const { sourceId, picture } = await sectionPictures(theme);
  const section = themeSection(theme.sections, key, picture);
  if (!section) return { ok: false, problem: "That section is no longer in your theme." };

  const wanted = sourceId ? templateMediaUrls("row", section.row).filter(isStorageUrl) : [];
  const files = await libraryFilesByUrl(sourceId, wanted);
  const replaced = new Map<string, string>();
  const copied = new Map<string, { url: string; thumbnailUrl: string | null }>();
  for (const url of wanted) {
    const file = files.get(url);
    if (!file) continue;
    let copy = copied.get(file.id);
    if (!copy) {
      copy = (await copyToLibrary({ storeId: owner, accountId: account.id }, file, deps.copyFile)) ?? undefined;
      if (!copy) continue;
      copied.set(file.id, copy);
    }
    replaced.set(url, url === file.thumbnailUrl && url !== file.url ? (copy.thumbnailUrl ?? copy.url) : copy.url);
  }
  const placed = mapTemplateMedia("row", section.row, (url) => (isStorageUrl(url) ? (replaced.get(url) ?? null) : url));
  const checked = savedPartInput.safeParse({ kind: "row", name: section.name, content: placed, sharing: "private" });
  // Nothing may still point into Storage but the copies just made.
  if (!checked.success || leftoverStorageUrls(checked.data.content, new Set(replaced.values())).length > 0) {
    return { ok: false, problem: "That section could not be made ready for your page." };
  }
  await audit(account.id, owner, owner ? "store.theme_section_used" : "platform.theme_section_used", {
    theme: theme.key,
    section: key,
    media: copied.size,
  });
  const part = {
    id: `theme-${theme.key}-${key}`,
    updatedAt: new Date().toISOString(),
    kind: checked.data.kind,
    name: checked.data.name,
    content: checked.data.content,
    global: false,
    translations: {},
    uses: 0,
    sharing: "private",
  } as SavedPart;
  return { ok: true, part };
}
