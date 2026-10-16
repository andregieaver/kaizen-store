import { blend } from "./colour";
import type { ShotBox, ShotParts, ShotPictures } from "./theme-shots";

/**
 * A theme's three highlights (`docs/theme-showcase-phase-2.md` step 2): pictures composed by code from its own look's photographs (a
 * computer and two phones, a collage of the page's sections, a close-up of its product page), on a backdrop of the theme's own colours,
 * with words a person writes or accepts. Pure: the layout and the words; the drawing is `src/server/theme-highlights.ts`.
 */

export const HIGHLIGHT_KINDS = ["devices", "collage", "closeup"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

/** Every highlight is this size: wide enough for a page's width, short enough to sit beside its words. */
export const HIGHLIGHT_SIZE = { width: 1600, height: 1000 } as const;

/** A highlight's words: a title and a line, as a person wrote or accepted them. */
export const HIGHLIGHT_WORDS_MAX = { title: 60, text: 160 } as const;
export type HighlightLine = { title: string; text: string };
export type HighlightWords = Partial<Record<HighlightKind, HighlightLine>>;

/** What each highlight shows, for the admin's fields and a picture's alt text when it has no words. */
export const HIGHLIGHT_NAMES: Record<HighlightKind, string> = {
  devices: "On a computer and two phones",
  collage: "The page, section by section",
  closeup: "The product page up close",
};

const clean = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A theme's highlight words from its listing: each kind with a title (a line alone is not kept), cut to its limits. */
export function readHighlightWords(value: unknown): HighlightWords {
  if (typeof value !== "object" || value === null) return {};
  const out: HighlightWords = {};
  for (const kind of HIGHLIGHT_KINDS) {
    const entry = (value as Record<string, unknown>)[kind];
    if (typeof entry !== "object" || entry === null) continue;
    const title = clean((entry as Record<string, unknown>).title, HIGHLIGHT_WORDS_MAX.title);
    const text = clean((entry as Record<string, unknown>).text, HIGHLIGHT_WORDS_MAX.text);
    if (title) out[kind] = { title, text };
  }
  return out;
}

/** A highlight's alt text: what it shows, named for the theme (its words are its caption, so they are not said twice). */
export const highlightAlt = (theme: string, kind: HighlightKind): string => `${theme}: ${HIGHLIGHT_NAMES[kind].toLowerCase()}`;

/** A rectangle on the highlight's canvas. */
export type Place = { left: number; top: number; width: number; height: number };

/** The devices: a computer with its base, and two phones beside it, the second a little lower. */
export const DEVICES = {
  computer: { left: 60, top: 120, width: 940, height: 600, radius: 22, screen: { left: 80, top: 140, width: 900, height: 560, radius: 6 } },
  base: { lip: { left: 20, top: 716, width: 1020, height: 20, radius: 10 }, foot: [[40, 736], [1020, 736], [990, 752], [70, 752]] as [number, number][] },
  phones: [
    { left: 960, top: 250, width: 290, height: 600, radius: 44, screen: { left: 971, top: 261, width: 268, height: 578, radius: 34 } },
    { left: 1240, top: 330, width: 290, height: 600, radius: 44, screen: { left: 1251, top: 341, width: 268, height: 578, radius: 34 } },
  ],
} as const;

/** Where the second phone looks: the product on the page, else its second row, else just below its first screen. */
export function phoneDetailTop(parts: ShotParts | null, screenHeight = 844): number {
  if (!parts) return screenHeight;
  const top = parts.product?.top ?? parts.rows[1]?.top ?? screenHeight;
  return Math.max(0, Math.min(top, Math.max(0, parts.length - screenHeight)));
}

/** A section shorter than this is not worth a tile in the collage; a taller one is cut at the second number. */
const SECTION_MIN = 160;
const SECTION_MAX = 900;

/** The sections of a page the collage shows: its rows, product and footer, each tall enough, at most `max`, in the page's order. */
export function collageSections(parts: ShotParts | null, max = 5): ShotBox[] {
  if (!parts) return [];
  const all = [...parts.rows, ...(parts.product ? [parts.product] : []), ...(parts.footer ? [parts.footer] : [])]
    .filter((box) => box.height >= SECTION_MIN && box.top < parts.length)
    .sort((a, b) => a.top - b.top)
    .map((box) => ({ top: box.top, height: Math.min(box.height, SECTION_MAX, parts.length - box.top) }));
  if (all.length <= max) return all;
  // The first (the page's opening) and the others spread evenly over the rest.
  const picked = [all[0]];
  for (let i = 1; i < max; i++) picked.push(all[Math.round((i * (all.length - 1)) / (max - 1))]);
  return picked;
}

const GAP = 40;
const MARGIN = { top: 70, bottom: 70 };

/**
 * The collage's tiles: two columns, each section in turn going to the shorter one, the second column starting lower; the columns as wide as
 * lets the taller one fill the canvas (between 520 and 700 wide), centred. A tile past the bottom is cut by the drawing.
 */
export function collageLayout(sections: readonly ShotBox[], pageWidth: number): (Place & { section: ShotBox })[] {
  const stagger = 100;
  // Columns by height at the page's own width: each section to the shorter column.
  const columns: { sections: ShotBox[]; height: number; offset: number }[] = [
    { sections: [], height: 0, offset: 0 },
    { sections: [], height: 0, offset: stagger },
  ];
  for (const section of sections) {
    const column = columns[0].height + columns[0].offset <= columns[1].height + columns[1].offset ? columns[0] : columns[1];
    column.sections.push(section);
    column.height += section.height;
  }
  const room = HIGHLIGHT_SIZE.height - MARGIN.top - MARGIN.bottom;
  const scaleFor = (column: (typeof columns)[number]) =>
    column.sections.length === 0 ? Infinity : (room - column.offset - GAP * (column.sections.length - 1)) / column.height;
  const width = Math.round(Math.max(520, Math.min(700, Math.min(...columns.map(scaleFor)) * pageWidth)));
  const left = Math.round((HIGHLIGHT_SIZE.width - (columns[1].sections.length > 0 ? width * 2 + 60 : width)) / 2);
  const out: (Place & { section: ShotBox })[] = [];
  columns.forEach((column, index) => {
    let top = MARGIN.top + column.offset;
    for (const section of column.sections) {
      const height = Math.round((section.height * width) / pageWidth);
      if (top < HIGHLIGHT_SIZE.height - GAP) out.push({ left: left + index * (width + 60), top, width, height, section });
      top += height + GAP;
    }
  });
  // A short collage sits in the middle of the canvas, not at its top.
  const bottom = Math.max(0, ...out.map((tile) => tile.top + tile.height));
  const shift = Math.max(0, Math.floor((HIGHLIGHT_SIZE.height - MARGIN.bottom - bottom) / 2));
  return out.map((tile) => ({ ...tile, top: tile.top + shift }));
}

/**
 * The close-up's frame: the detail fitted inside the canvas with room around it, never enlarged past `maxScale` (1 for a detail
 * photographed at twice the pixels, a little more for one cut from the page itself, so it stays sharp).
 */
export function closeupPlace(width: number, height: number, maxScale = 1): Place {
  const room = { width: HIGHLIGHT_SIZE.width - 240, height: HIGHLIGHT_SIZE.height - 180 };
  const scale = Math.min(room.width / width, room.height / height, maxScale);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { left: Math.round((HIGHLIGHT_SIZE.width - w) / 2), top: Math.round((HIGHLIGHT_SIZE.height - h) / 2), width: w, height: h };
}

/** The backdrop: the theme's surface tinted with its accent, lighter at the top left. */
export const backdropColours = (palette: { surface: string; accent: string }): { from: string; to: string } => ({
  from: blend(palette.accent, 10, palette.surface),
  to: blend(palette.accent, 30, palette.surface),
});

/** A highlight as the theme page shows it: its picture and its words (a title and a line, or none), and its alt text. */
export type ThemeHighlight = { kind: HighlightKind; url: string; width: number; height: number; alt: string; title: string | null; text: string | null };

/** A theme's highlights in their order, those made, each with its words where written. */
export function themeHighlights(theme: string, pictures: ShotPictures | null | undefined, words: HighlightWords = {}): ThemeHighlight[] {
  if (!pictures) return [];
  return HIGHLIGHT_KINDS.flatMap((kind) => {
    const file = pictures[kind];
    if (!file) return [];
    const line = words[kind];
    return [{ kind, url: file.url, width: file.width, height: file.height, alt: highlightAlt(theme, kind), title: line?.title ?? null, text: line?.text || null }];
  });
}
