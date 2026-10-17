import { SHOT_HEIGHT_MAX } from "./replicate-capture";

/**
 * The photographs of a theme's looks (`docs/theme-showcase-phase-2.md` step 1): what is wanted, how each width is photographed, the pictures
 * cut from a photograph, and the stored record read back. Pure, so the job, the readers and the tests share it; the browser's part is
 * `theme-shoot.ts`, the cutting `src/server/theme-shot-files.ts`, the queue and the job `src/server/theme-shots.ts`.
 */

/** The widths a look is photographed at. */
export const SHOT_KINDS = ["computer", "phone"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

/** A unit of work: a width photographed, or the theme's highlights composed from its own look's two (step 2). */
export type UnitKind = ShotKind | "highlights";

/** Each width's screen: its size in CSS pixels and how many pixels a CSS pixel is in its first-screen photograph. */
export const SHOT_SCREENS: Record<ShotKind, { width: number; height: number; scale: number }> = {
  computer: { width: 1440, height: 900, scale: 1 },
  phone: { width: 390, height: 844, scale: 2 },
};

/** A photograph's length is cut at this, so a very long page stays one file of a sensible size. */
export const SHOT_LENGTH_MAX = SHOT_HEIGHT_MAX;

/** The pictures cut from a computer's photograph: the theme store's card (4:3, as the launch photographs) and the share image. */
export const CARD_SIZE = { width: 800, height: 600 } as const;
export const SHARE_SIZE = { width: 1200, height: 630 } as const;

/**
 * The kinds of picture a unit makes: the page at full length and its first screen at both widths; from a computer a card, a share image and
 * the product part at twice the pixels (`detail`, when the page has one); the three highlights from a `highlights` unit.
 */
export const SHOT_PICTURES = ["full", "screen", "card", "share", "detail", "devices", "collage", "closeup"] as const;
export type ShotPictureKind = (typeof SHOT_PICTURES)[number];

/** Which pictures a unit makes (`detail` only where the page has a product). */
export const picturesOf = (kind: UnitKind): readonly ShotPictureKind[] =>
  kind === "computer" ? ["full", "screen", "card", "share", "detail"] : kind === "phone" ? ["full", "screen"] : ["devices", "collage", "closeup"];

/** One stored picture. */
export type ShotFile = { path: string; url: string; width: number; height: number; bytes: number };
export type ShotPictures = Partial<Record<ShotPictureKind, ShotFile>>;

/** Where a unit's files are kept, in the public `product-media` bucket: under the platform's own folder, per theme and unit. */
export const SHOTS_FOLDER = "platform/theme-shots";
export const shotFolder = (presetId: string, shotId: string): string => `${SHOTS_FOLDER}/${presetId}/${shotId}`;

/** A rectangle of a photograph, in its own pixels. */
export type Rect = { left: number; top: number; width: number; height: number };

/**
 * The top of a photograph `width` wide and `height` tall, as wide as it is and as tall as `ratio` (width over height) asks, or less where
 * the page is shorter. The card and the share image are cut so: what a visitor sees first.
 */
export function topCrop(width: number, height: number, ratio: number): Rect {
  const wanted = Math.round(width / ratio);
  return { left: 0, top: 0, width, height: Math.max(1, Math.min(height, wanted)) };
}

/** A box measured on the page (CSS pixels from the page's top). */
export type ShotBox = { top: number; height: number };

/** The page's parts as measured when it was photographed, which step 2 cuts by: the header, the front page's rows, the product, the footer. */
export type ShotParts = { length: number; header: ShotBox | null; rows: ShotBox[]; product: ShotBox | null; footer: ShotBox | null };

const isBox = (value: unknown): value is ShotBox =>
  typeof value === "object" && value !== null && Number.isFinite((value as ShotBox).top) && Number.isFinite((value as ShotBox).height) && (value as ShotBox).height >= 0;

/** A unit's stored parts; null when there are none or they cannot be read. */
export function readShotParts(value: unknown): ShotParts | null {
  if (typeof value !== "object" || value === null) return null;
  const parts = value as Record<string, unknown>;
  const length = Number(parts.length);
  if (!Number.isFinite(length) || length <= 0) return null;
  const box = (key: string) => (isBox(parts[key]) ? (parts[key] as ShotBox) : null);
  return { length, header: box("header"), rows: Array.isArray(parts.rows) ? parts.rows.filter(isBox) : [], product: box("product"), footer: box("footer") };
}

const isFile = (value: unknown): value is ShotFile => {
  if (typeof value !== "object" || value === null) return false;
  const file = value as ShotFile;
  return (
    typeof file.path === "string" &&
    file.path.startsWith(`${SHOTS_FOLDER}/`) &&
    typeof file.url === "string" &&
    /^https?:\/\//.test(file.url) &&
    Number.isInteger(file.width) &&
    Number.isInteger(file.height) &&
    file.width > 0 &&
    file.height > 0 &&
    Number.isInteger(file.bytes)
  );
};

/** A unit's stored pictures, each checked; what cannot be read is left out. */
export function readShotPictures(value: unknown): ShotPictures {
  if (typeof value !== "object" || value === null) return {};
  const out: ShotPictures = {};
  for (const kind of SHOT_PICTURES) {
    const file = (value as Record<string, unknown>)[kind];
    if (isFile(file)) out[kind] = file;
  }
  return out;
}

/** Every stored file of a unit, to remove with it. */
export const shotPaths = (pictures: ShotPictures): string[] => Object.values(pictures).flatMap((file) => (file ? [file.path] : []));

/** One unit of work: a look of a theme's version, on the store it is shown on, at one width (or its highlights). */
export type WantedShot = { presetId: string; version: number; variation: string | null; starterId: string | null; showcaseStoreId: string; kind: UnitKind };

/** A unit's identity (the table's unique key). */
export const shotKey = (shot: Pick<WantedShot, "presetId" | "version" | "variation" | "showcaseStoreId" | "kind">): string =>
  [shot.presetId, shot.version, shot.variation ?? "", shot.showcaseStoreId, shot.kind].join("|");

/** A look's identity across versions and showcases: which pictures stand for the same thing on the theme store. */
export const lookKey = (shot: Pick<WantedShot, "presetId" | "variation" | "kind">): string => [shot.presetId, shot.variation ?? "", shot.kind].join("|");

/** A published theme as the queue needs it: its latest version, and each of its looks with the demo store it is shown on (null: none published). */
export type ShotTheme = { id: string; version: number; looks: { variation: string | null; starterId: string | null }[] };

/**
 * Every unit that should exist now: each look of each theme at its latest version, on the store its showcase draws (`storeOf`: a demo
 * store's published copy; a look on none, or whose store cannot be found, is left out, D274: never the Standard store), at both widths; and
 * the theme's highlights from its own look (step 2), composed once that look's two are made.
 */
export function wantedShots(themes: readonly ShotTheme[], storeOf: (starterId: string | null) => string | null): WantedShot[] {
  return themes.flatMap((theme) =>
    theme.looks.flatMap((look) => {
      const showcaseStoreId = storeOf(look.starterId);
      if (!showcaseStoreId) return [];
      const kinds: UnitKind[] = look.variation === null ? [...SHOT_KINDS, "highlights"] : [...SHOT_KINDS];
      return kinds.map((kind) => ({ presetId: theme.id, version: theme.version, variation: look.variation, starterId: look.starterId, showcaseStoreId, kind }));
    }),
  );
}

/** A stored unit, as the queue weighs it. */
export type StoredShot = WantedShot & { id: string; status: "waiting" | "running" | "done" | "failed" | "superseded" };

/**
 * The units to set aside (`superseded`) now that `wanted` is what is wanted: one not done that is no longer wanted, and a done one no longer
 * wanted once its look has a done set that is (until then it is the best picture there is), or whose look is not wanted at all (a preset
 * taken out, a theme no longer published).
 */
export function supersededShots(stored: readonly StoredShot[], wanted: readonly WantedShot[]): string[] {
  const wantedKeys = new Set(wanted.map(shotKey));
  const wantedLooks = new Set(wanted.map(lookKey));
  const doneLooks = new Set(stored.filter((s) => s.status === "done" && wantedKeys.has(shotKey(s))).map(lookKey));
  return stored
    .filter((shot) => {
      if (shot.status === "superseded" || wantedKeys.has(shotKey(shot))) return false;
      if (shot.status !== "done") return true;
      return doneLooks.has(lookKey(shot)) || !wantedLooks.has(lookKey(shot));
    })
    .map((shot) => shot.id);
}

/** The units wanted that are not stored yet. */
export const missingShots = (stored: readonly Pick<StoredShot, "presetId" | "version" | "variation" | "showcaseStoreId" | "kind">[], wanted: readonly WantedShot[]): WantedShot[] => {
  const have = new Set(stored.map(shotKey));
  return wanted.filter((shot) => !have.has(shotKey(shot)));
};

/** How many tries a unit gets before it is `failed`. */
export const SHOT_TRIES = 3;

/** A look's pictures as the theme store reads them: its latest done set at each width, and (its own look's) highlights. */
export type LookShots = { computer: ShotPictures | null; phone: ShotPictures | null; highlights?: ShotPictures | null; version: number | null };
