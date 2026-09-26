import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import type { CSSProperties } from "react";

import { db, readDb } from "@/db/client";
import {
  catalogFont,
  fontClass,
  fontSlug,
  fontStack,
  FONT_SUBSETS,
  installedStyles,
  siteFontFamilies,
  siteFontsSchema,
  type CatalogFont,
  type CatalogRow,
  type SiteFonts,
} from "@/lib/fonts";
import rows from "@/lib/fonts/google-fonts.json";

import { audit, type Account } from "./auth";

/**
 * Google Fonts, self-hosted (D59): the first time a site uses a family,
 * its files are downloaded from Google once and kept in the database; the
 * site then loads them from Kaizen's own address (`/api/fonts/…`), so
 * visitors' browsers never contact Google and pages need no extra
 * connection. Stylesheets and files are cached by the CDN for a year.
 */

type Row = Record<string, unknown>;

const CATALOG = (rows as CatalogRow[]).map(catalogFont);
const BY_FAMILY = new Map(CATALOG.map((font) => [font.family, font]));
const BY_SLUG = new Map(CATALOG.map((font) => [fontSlug(font.family), font]));

/** A family in the catalogue by its name, or null. */
export const findFont = (family: string): CatalogFont | null => BY_FAMILY.get(family) ?? null;
/** A family in the catalogue by its slug, or null. */
export const findFontBySlug = (slug: string): CatalogFont | null => BY_SLUG.get(slug) ?? null;

/** The catalogue for the font picker, as the script wrote it (most popular first). */
export const fontCatalog = (): CatalogRow[] => rows as CatalogRow[];

/** Google sends woff2 with `unicode-range` subsets only to browsers it knows do them. */
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GOOGLE_CSS = "https://fonts.googleapis.com/css2";
const MAX_FILE = 2_000_000;
const MAX_TOTAL = 20_000_000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Google's stylesheet address for a family's installed styles. */
export function googleCssUrl(font: CatalogFont): string {
  const { weights, italics } = installedStyles(font);
  const styles = [...weights.map((w) => `0,${w}`), ...italics.map((w) => `1,${w}`)].join(";");
  return `${GOOGLE_CSS}?family=${font.family.replaceAll(" ", "+")}:ital,wght@${styles}&display=swap`;
}

type FontFace = { subset: string; body: string; url: string };

/** Google's `@font-face` rules, each after a `/* subset *\/` comment, in the scripts Kaizen keeps. */
export function parseGoogleCss(css: string): FontFace[] {
  const faces: FontFace[] = [];
  for (const match of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const [, subset, body] = match;
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/.exec(body)?.[1];
    if (url && (FONT_SUBSETS as readonly string[]).includes(subset)) faces.push({ subset, body, url });
  }
  return faces;
}

const fileName = (data: Buffer) => `${createHash("sha256").update(data).digest("hex").slice(0, 32)}.woff2`;

/** Whether a family is installed. */
export async function fontInstalled(family: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select 1 from commerce.fonts where family = ${family}`);
  return Boolean(row);
}

/**
 * Makes a family ready to use on the sites: downloads its files from
 * Google (the styles `installedStyles` picks, in the EU's scripts), stores
 * them, and keeps a stylesheet pointing at Kaizen's copies. Does nothing
 * when it is installed already.
 */
export async function installFont(
  family: string,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true } | { ok: false; problem: string }> {
  const font = findFont(family);
  if (!font) return { ok: false, problem: "That font is not in Google Fonts." };
  if (await fontInstalled(family)) return { ok: true };
  try {
    const cssResponse = await fetcher(googleCssUrl(font), {
      headers: { "User-Agent": BROWSER },
      signal: AbortSignal.timeout(15_000),
    });
    if (!cssResponse.ok) throw new Error(`Google Fonts answered ${cssResponse.status}`);
    const faces = parseGoogleCss(await cssResponse.text());
    if (faces.length === 0) throw new Error("Google Fonts sent no files for it.");

    // Variable fonts use one file for several weights: fetch each once.
    const files = new Map<string, { name: string; data: Buffer }>();
    let total = 0;
    for (const url of new Set(faces.map((face) => face.url))) {
      const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Google Fonts answered ${response.status} for a file`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > MAX_FILE) throw new Error("A font file was empty or too large.");
      total += data.length;
      if (total > MAX_TOTAL) throw new Error("The font's files are too large together.");
      files.set(url, { name: fileName(data), data });
    }

    const rules = faces.map(({ subset, body, url }) => {
      const local = body.replace(url, `/api/fonts/files/${files.get(url)!.name}`).trim().replace(/\s*\n\s*/g, " ");
      return `/* ${subset} */\n@font-face { ${local} }`;
    });
    // The class covers headings inside the block too, over the site's heading font. A weight
    // the family lacks shows as its nearest real one, not thickened by the browser.
    const css = `${rules.join("\n")}\n.${fontClass(family)}, .${fontClass(family)} :where(h1, h2, h3, h4, h5, h6) { font-family: ${fontStack(family, font.category)}; font-synthesis-weight: none; }\n`;

    await db().transaction(async (tx) => {
      for (const { name, data } of new Map([...files.values()].map((file) => [file.name, file])).values()) {
        await tx.execute(sql`insert into commerce.font_files (name, data) values (${name}, ${data}) on conflict (name) do nothing`);
      }
      await tx.execute(sql`
        insert into commerce.fonts (family, slug, category, css, bytes)
        values (${family}, ${fontSlug(family)}, ${font.category}, ${css}, ${total})
        on conflict (family) do nothing
      `);
    });
    return { ok: true };
  } catch (error) {
    console.error(`[fonts] installing ${family} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, problem: `${family} could not be fetched from Google Fonts. Try again in a moment.` };
  }
}

/** Installs every family in a list, stopping at the first that fails. */
export async function installFonts(families: Iterable<string>): Promise<{ ok: true } | { ok: false; problem: string }> {
  for (const family of new Set(families)) {
    const result = await installFont(family);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export const fontTag = (slug: string) => `font:${slug}`;

/** An installed family's stylesheet by its slug, or null. */
export async function fontCss(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  cacheTag(fontTag(slug));
  const [row] = await readDb().execute<Row>(sql`select css from commerce.fonts where slug = ${slug}`);
  return row ? String(row.css) : null;
}

/** A font file by its name, or null. */
export async function fontFile(name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{32}\.woff2$/.test(name)) return null;
  const [row] = await readDb().execute<Row>(sql`select data from commerce.font_files where name = ${name}`);
  return row ? Buffer.from(row.data as Uint8Array) : null;
}

/**
 * A family's name drawn in itself, for the font picker: Google cuts a
 * file with just those letters, a few kilobytes, which Kaizen passes on so
 * the admin's browser does not contact Google either.
 */
export async function fontPreview(slug: string, fetcher: Fetcher = fetch): Promise<Buffer | null> {
  const font = findFontBySlug(slug);
  if (!font) return null;
  const weight = installedStyles(font).weights[0];
  const url = `${GOOGLE_CSS}?family=${font.family.replaceAll(" ", "+")}:wght@${weight}&text=${encodeURIComponent(font.family)}`;
  try {
    const css = await (await fetcher(url, { headers: { "User-Agent": BROWSER }, signal: AbortSignal.timeout(10_000) })).text();
    const file = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(css)?.[1];
    if (!file) return null;
    const response = await fetcher(file, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.length > 0 && data.length <= 200_000 ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A site's own fonts
// ---------------------------------------------------------------------------

/**
 * The style a site's `<body>` takes for its fonts (D59): the body font
 * itself, and the heading font as `--site-heading-font`, which globals.css
 * gives headings unless a block chooses its own.
 */
export function siteFontStyle(fonts: SiteFonts): CSSProperties | undefined {
  const stack = (family: string | undefined) => {
    const font = family ? findFont(family) : null;
    return font ? fontStack(font.family, font.category) : undefined;
  };
  const body = stack(fonts.body);
  const heading = stack(fonts.heading);
  if (!body && !heading) return undefined;
  return { ...(body && { fontFamily: body }), ...(heading && { "--site-heading-font": heading }) } as CSSProperties;
}

/** Saves a site's heading and body fonts (D59), Kaizen's with a null store, installing them first. */
export async function saveSiteFonts(
  account: Account,
  storeId: string | null,
  input: unknown,
): Promise<{ ok: true; fonts: SiteFonts } | { ok: false; problems: string[] }> {
  const parsed = siteFontsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const fonts = parsed.data;
  const missing = siteFontFamilies(fonts).filter((family) => !findFont(family));
  if (missing.length > 0) return { ok: false, problems: missing.map((family) => `${family} is not in Google Fonts.`) };
  const installed = await installFonts(siteFontFamilies(fonts));
  if (!installed.ok) return { ok: false, problems: [installed.problem] };
  const json = JSON.stringify(fonts);
  if (storeId === null) {
    await db().execute(sql`
      update commerce.platform_settings set fonts = ${json}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid
    `);
  } else {
    // A store's fonts are part of its theme (D60).
    await db().execute(sql`
      update commerce.stores
      set theme = jsonb_set(theme || jsonb_build_object('settings', coalesce(theme -> 'settings', '{}'::jsonb)), '{settings,fonts}', ${json}::jsonb)
      where id = ${storeId}::uuid
    `);
  }
  await audit(account.id, storeId, `${storeId === null ? "platform" : "store"}.fonts_updated`, fonts);
  return { ok: true, fonts };
}
