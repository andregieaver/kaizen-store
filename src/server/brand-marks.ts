import "server-only";

import sharp from "sharp";

import {
  DEFAULT_MARK_FONT,
  ICON_SIZE,
  ICON_SMALL_SIZE,
  iconInk,
  iconSvg,
  LOGO_HEIGHT,
  LOGO_SMALL_HEIGHT,
  markColour,
  monogramOf,
  wordmarkSvg,
  type Box,
  type BrandMarksInput,
} from "@/lib/brand-marks";
import { parseStoreTheme, type ThemeSettings } from "@/lib/theme";

import { fontOutlines, type Fetcher } from "./font-outlines";
import { storageRefusal } from "./limits";
import { storePicture } from "./media-library";
import type { UploadResult } from "./media";
import { OwnerToolError } from "./owner-tool-error";
import { getPlatformTheme } from "./platform-navigation";
import type { Store } from "./stores";
import { liveLook } from "./theme-installs";

/**
 * The brand's logo and icon (D330 F2a, `docs/ai-autopilot.md` 14.3): the brand's name drawn in its own font's outlines, in the live theme's
 * colours, rendered to PNG and kept in the media library. Nothing here changes what visitors see: the owner puts a mark in place with
 * `set_header_footer`.
 */

export type MarksScope = { account: { id: string }; store: Store | null };

export type MarksDeps = {
  /** Google Fonts; `fetch` unless given (tests). */
  fetch?: Fetcher;
  /** Keeping a picture and its small copy in the library; `storePicture()` unless given (tests). */
  store?: (owner: { storeId: string | null; accountId: string }, image: File, thumbnail: File, details: { fileName: string; alt?: string }) => Promise<UploadResult>;
};

export type BrandMarks = { logo: string; logoDark: string; icon: string; text: string; letters: string; font: string; weight: number };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

async function liveSettings(scope: MarksScope): Promise<ThemeSettings> {
  if (!scope.store) return (await getPlatformTheme()).settings;
  return parseStoreTheme((await liveLook(scope.store.id))?.theme ?? {}).settings;
}

const boxOf = (b: { x1: number; y1: number; x2: number; y2: number }): Box => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });

/** An SVG of paths rendered to PNG at a height, sharp enough at that size. */
async function png(svg: string, height: number, viewHeight: number): Promise<Buffer> {
  const density = Math.min(2400, Math.max(72, Math.ceil((72 * height * 1.5) / viewHeight)));
  return sharp(Buffer.from(svg), { density }).resize({ height }).png().toBuffer();
}

const viewHeightOf = (svg: string) => Number(svg.match(/viewBox="[^"]*?\s([\d.]+)"/)?.[1] ?? 100);

export async function makeBrandMarks(scope: MarksScope, input: BrandMarksInput, deps: MarksDeps = {}): Promise<BrandMarks> {
  const settings = await liveSettings(scope);
  const text = (input.text ?? scope.store?.name ?? "Kaizena Flow").trim();
  const family = input.font ?? settings.fonts.heading ?? DEFAULT_MARK_FONT;
  const outlines = await fontOutlines(family, input.weight ?? 700, deps.fetch);
  if (!outlines.ok) return fail(outlines.problem);
  const font = outlines.font;
  const missing = [...new Set([...text].filter((c) => c.trim() && font.charToGlyph(c).index === 0))];
  if (missing.length) return fail(`${outlines.family} has no letters for ${missing.map((c) => `"${c}"`).join(", ")}: choose another font, or other words.`);
  const word = font.getPath(text, 0, 0, 100);
  const wordBox = boxOf(word.getBoundingBox());
  if (!(wordBox.x2 > wordBox.x1 && wordBox.y2 > wordBox.y1)) return fail("The words have nothing to draw.");
  const letters = (input.icon_letters ?? monogramOf(text)).toLocaleUpperCase();
  if (!letters) return fail("The icon needs a letter: give icon_letters.");
  const mono = font.getPath(letters, 0, 0, 100);
  const monoBox = boxOf(mono.getBoundingBox());
  if (!(monoBox.x2 > monoBox.x1)) return fail("The icon's letters have nothing to draw.");

  const light = wordmarkSvg(word.toPathData(2), wordBox, markColour(settings.light, settings.light.background, input.colour));
  const dark = wordmarkSvg(word.toPathData(2), wordBox, markColour(settings.dark, settings.dark.background, input.colour));
  const icon = iconSvg(mono.toPathData(2), monoBox, settings.light.accent, iconInk(settings.light), input.icon_shape);

  const files = {
    logo: [await png(light, LOGO_HEIGHT, viewHeightOf(light)), await png(light, LOGO_SMALL_HEIGHT, viewHeightOf(light))],
    logoDark: [await png(dark, LOGO_HEIGHT, viewHeightOf(dark)), await png(dark, LOGO_SMALL_HEIGHT, viewHeightOf(dark))],
    icon: [await png(icon, ICON_SIZE, ICON_SIZE), await png(icon, ICON_SMALL_SIZE, ICON_SIZE)],
  };
  const bytes = Object.values(files).flat().reduce((sum, b) => sum + b.length, 0);
  const full = await storageRefusal(scope.store?.id ?? null, bytes);
  if (full) return fail(full);

  const owner = { storeId: scope.store?.id ?? null, accountId: scope.account.id };
  const keep = deps.store ?? storePicture;
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
  const put = async (name: string, [big, small]: Buffer[], alt: string) => {
    const made = await keep(owner, new File([new Uint8Array(big)], `${name}.png`, { type: "image/png" }), new File([new Uint8Array(small)], `${name}-small.png`, { type: "image/png" }), {
      fileName: `${name}.png`,
      alt,
    });
    return made.ok ? made.url : fail(`The mark could not be kept in the media library: ${made.problem}`);
  };
  return {
    logo: await put(`${slug}-logo`, files.logo, `${text} logo`),
    logoDark: await put(`${slug}-logo-dark`, files.logoDark, `${text} logo for dark backgrounds`),
    icon: await put(`${slug}-icon`, files.icon, `${text} icon`),
    text,
    letters,
    font: outlines.family,
    weight: outlines.weight,
  };
}
