import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { parseDesignSnapshot, type DesignSnapshot } from "@/lib/design-presets";
import { variationSnapshot, variationsOf } from "@/lib/design-variations";
import {
  readListing,
  shownLooks,
  swatchOf,
  themeChangelog,
  themeFeatures,
  themeLooks,
  themeSectionStyles,
  type ChangelogEntry,
  type ThemeContent,
  previewNeighbours,
  type ThemeStoreCard,
  type ThemeVersion,
} from "@/lib/theme-store";
import { themeHighlights } from "@/lib/theme-highlights";
import type { LookShots } from "@/lib/theme-shots";
import type { ThemePrice } from "@/lib/theme-prices";

import { DESIGNS_TAG } from "./design-presets";
import { STARTERS_TAG, publishedContents } from "./store-starters";
import { lookOf, themeShotsFor } from "./theme-shots";
import { themePrices } from "./theme-prices";

/**
 * The theme store's reads (phase 3 of `docs/theme-store.md`, `docs/theme-phase-3.md`): published, unarchived themes that have an
 * address and a readable snapshot, in the platform's order. Cached under `DESIGNS_TAG`, which every publish, unpublish, archive and listing
 * change refreshes. Only what a visitor may see: no workspace, no store, no counts of who uses a theme.
 */

type Row = Record<string, unknown>;

const cardOf = (
  row: Row,
  snapshot: DesignSnapshot,
  contents: ReadonlyMap<string, ThemeContent>,
  shots: ReadonlyMap<string, LookShots>,
  prices: ReadonlyMap<string, ThemePrice[]>,
): ThemeStoreCard => {
  const presets = variationsOf(snapshot).map((v) => ({ key: v.key, name: v.name }));
  const listing = readListing(row.listing);
  const id = String(row.id);
  // Its looks' photographs (`docs/theme-showcase-phase-2.md` step 1), each on the theme's own content (D275) once it is published: the first
  // with a photograph at a computer's width gives the card and the share image, and the highlights are its own look's.
  // Each look in its own colours (D275): the swatch its preset is chosen by.
  const looks = themeLooks(String(row.title), presets, contents.get(id) ?? null).map((look) => ({
    ...look,
    shots: look.showcase ? (shots.get(lookOf(id, look.key)) ?? null) : null,
    swatch: swatchOf(variationSnapshot(snapshot, look.key) ?? snapshot),
  }));
  const lead = shownLooks(looks).find((look) => look.shots?.computer)?.shots?.computer ?? null;
  return {
    id,
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    pictureUrl: row.picture_url ? String(row.picture_url) : null,
    madeCard: lead?.card?.url ?? null,
    madeShare: lead?.share?.url ?? null,
    highlights: themeHighlights(String(row.title), looks[0]?.showcase ? looks[0].shots?.highlights : undefined, listing.highlights, listing.own),
    presets,
    looks,
    listing,
    features: themeFeatures(snapshot),
    swatch: swatchOf(snapshot),
    prices: prices.get(id) ?? [],
  };
};

/** Every theme in the store, as the list shows them. */
export async function themeStoreCards(): Promise<ThemeStoreCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  return loadCards();
}

/**
 * The themes before and after one in the full-screen preview (D285, `previewNeighbours()`), by their address and name; cached per theme
 * as its page is, so a theme published later has them on its first visit.
 */
export async function themePreviewNeighbours(slug: string): Promise<{ previous: { slug: string; title: string }; next: { slug: string; title: string } } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(DESIGNS_TAG, STARTERS_TAG);
  const around = previewNeighbours(await loadCards(), slug);
  return around && { previous: { slug: around.previous.slug, title: around.previous.title }, next: { slug: around.next.slug, title: around.next.title } };
}

async function loadCards(): Promise<ThemeStoreCard[]> {
  const contents = await publishedContents();
  const rows = await readDb().execute<Row>(sql`
    select id, slug, title, summary, picture_url, listing, snapshot from commerce.design_presets
    where published and archived_at is null and slug is not null
    order by position, lower(title), id
  `);
  const ids = rows.map((row) => String(row.id));
  const [shots, prices] = await Promise.all([themeShotsFor(ids), themePrices(ids)]);
  return rows.flatMap((row) => {
    const snapshot = parseDesignSnapshot(row.snapshot);
    return snapshot ? [cardOf(row, snapshot, contents, shots, prices)] : [];
  });
}

export type ThemeStorePage = ThemeStoreCard & {
  description: string;
  sectionStyles: string[];
  /** Its section styles by their own names, for a page in another language to name the core ones in it (D312 P3). */
  sectionStyleNames: string[];
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
    select id, slug, title, summary, description, picture_url, listing, snapshot, published_at from commerce.design_presets
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
    ...cardOf(row, snapshot, await publishedContents(), await themeShotsFor([String(row.id)]), await themePrices([String(row.id)])),
    description: String(row.description ?? ""),
    sectionStyles: themeSectionStyles(snapshot),
    sectionStyleNames: Object.keys(snapshot.theme.settings.sectionStyles ?? {}),
    changelog: themeChangelog(versions),
    version: latest?.number ?? null,
    updatedAt: latest?.publishedAt ?? (row.published_at ? new Date(String(row.published_at)).toISOString() : null),
  };
}
