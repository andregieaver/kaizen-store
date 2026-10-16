import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { parseDesignSnapshot, type DesignSnapshot } from "@/lib/design-presets";
import { PACK_KEYS } from "@/lib/content-packs";
import { variationsOf } from "@/lib/design-variations";
import { launchShotFor } from "@/lib/launch-themes";
import {
  readListing,
  swatchOf,
  themeChangelog,
  themeFeatures,
  themeLooks,
  themeSectionStyles,
  type ChangelogEntry,
  type ThemeStoreCard,
  type ThemeVersion,
} from "@/lib/theme-store";

import { DESIGNS_TAG } from "./design-presets";
import { STARTERS_TAG } from "./store-starters";

/**
 * The theme store's reads (phase 3 of `docs/theme-store.md`, `docs/theme-phase-3.md`): published, unarchived themes that have an
 * address and a readable snapshot, in the platform's order. Cached under `DESIGNS_TAG`, which every publish, unpublish, archive and listing
 * change refreshes. Only what a visitor may see: no workspace, no store, no counts of who uses a theme.
 */

type Row = Record<string, unknown>;

const cardOf = (row: Row, snapshot: DesignSnapshot, packs: ReadonlyMap<string, string>): ThemeStoreCard => {
  const presets = variationsOf(snapshot).map((v) => ({ key: v.key, name: v.name }));
  const listing = readListing(row.listing);
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    pictureUrl: row.picture_url ? String(row.picture_url) : null,
    shotUrl: launchShotFor(row.launch_key ? String(row.launch_key) : null),
    presets,
    looks: themeLooks(String(row.title), presets, listing, packs),
    listing,
    features: themeFeatures(snapshot),
    swatch: swatchOf(snapshot),
  };
};

/**
 * The content packs whose store templates are published (`docs/theme-showcase-phase-1.md` step 3), pack to template: the stores a theme's
 * looks are shown on. Read inside the cached reads below, which therefore also carry `STARTERS_TAG` (publishing a template refreshes them).
 */
async function publishedPacks(): Promise<Map<string, string>> {
  const rows = await readDb().execute<Row>(sql`
    select id, pack_key from commerce.store_starters
    where pack_key = any(${`{${PACK_KEYS.join(",")}}`}::text[]) and published and archived_at is null
  `);
  return new Map(rows.map((row) => [String(row.pack_key), String(row.id)]));
}

/** Every theme in the store, as the list shows them. */
export async function themeStoreCards(): Promise<ThemeStoreCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  const packs = await publishedPacks();
  const rows = await readDb().execute<Row>(sql`
    select id, slug, title, summary, picture_url, launch_key, listing, snapshot from commerce.design_presets
    where published and archived_at is null and slug is not null
    order by position, lower(title), id
  `);
  return rows.flatMap((row) => {
    const snapshot = parseDesignSnapshot(row.snapshot);
    return snapshot ? [cardOf(row, snapshot, packs)] : [];
  });
}

export type ThemeStorePage = ThemeStoreCard & {
  description: string;
  sectionStyles: string[];
  changelog: ChangelogEntry[];
  /** The latest version's number and date, for the page and the sitemap. */
  version: number | null;
  updatedAt: string | null;
};

/** One theme's page, by its address; null when it is not in the store. */
export async function themeStorePage(slug: string): Promise<ThemeStorePage | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  const [row] = await readDb().execute<Row>(sql`
    select id, slug, title, summary, description, picture_url, launch_key, listing, snapshot, published_at from commerce.design_presets
    where slug = ${slug} and published and archived_at is null
  `);
  const snapshot = row ? parseDesignSnapshot(row.snapshot) : null;
  if (!row || !snapshot) return null;
  const versionRows = await readDb().execute<Row>(sql`
    select number, published_at, notes, snapshot from commerce.design_preset_versions where preset_id = ${String(row.id)}::uuid order by number
  `);
  const versions: ThemeVersion[] = versionRows.flatMap((v) => {
    const shot = parseDesignSnapshot(v.snapshot);
    return shot ? [{ number: Number(v.number), publishedAt: new Date(String(v.published_at)).toISOString(), notes: v.notes ? String(v.notes) : null, snapshot: shot }] : [];
  });
  const latest = versions.at(-1) ?? null;
  return {
    ...cardOf(row, snapshot, await publishedPacks()),
    description: String(row.description ?? ""),
    sectionStyles: themeSectionStyles(snapshot),
    changelog: themeChangelog(versions),
    version: latest?.number ?? null,
    updatedAt: latest?.publishedAt ?? (row.published_at ? new Date(String(row.published_at)).toISOString() : null),
  };
}
