import {
  CUSTOM_BADGE_MAX,
  CUSTOM_BUTTON_MAX,
  CUSTOM_DETAIL_LABEL_MAX,
  CUSTOM_DETAIL_TEXT_MAX,
  CUSTOM_ITEMS_MAX,
  CUSTOM_PRICE_TEXT_MAX,
  customGridItemSchema,
  CUSTOM_TEXT_MAX,
  CUSTOM_TITLE_MAX,
  CUSTOM_ALT_MAX,
  GRID_COLUMNS_MAX,
  GRID_GAP_MAX,
  RADIUS_MAX,
  TILE_FIELDS_MAX,
  type Border,
  type ButtonSize,
  type ButtonShape,
  type ButtonVariant,
  type ContentGridBlock,
  type CustomGridItem,
  type GridColumns,
  type GridTile,
  type HeadingSize,
  type ImageShape,
  type Shadow,
} from "./page-content";
import { isSafeAddress } from "./field-parts";
import { menuLinkSchema } from "./navigation";
import { pageCount, tilesPerScreen, type CarouselSettings } from "./carousel-settings";
import { bottomOf, cssColour, hexOf, paints, px, rightOf, walk, type Box, type CaptureNode, type PageCapture, type SlideMark } from "./replicate-capture";
import { isTextList, wordsOf } from "./replicate-richtext";
import type { Decl } from "./replicate-styles";

/**
 * Repeated cards become one grid block of custom items (D155, C): detection of a group of the same card repeated, the
 * mapping of each card to an item (or the refusal to), the grid's look read from what the browser measured, and the lines the
 * report says about it. Pure: it reads the captured tree and nothing else, so it is tested with captured trees and no browser.
 *
 * The rule that rules the rest: **every word of an item is a word of the card it came from, and no word of a card is lost.**
 * An item holds a title, text, a link, a button's words, a badge, a price as text, a date and up to three detail lines; a card
 * that has more than that (a second button, text beyond what an item holds) keeps the whole group as columns, as before, and
 * says why. The converter never invents text, a label or a link, and a model never writes any of it.
 */

// ---------------------------------------------------------------------------
// What the converter hands in
// ---------------------------------------------------------------------------

/** What detection needs of the converter, passed in so this module stays free of it. */
export type GridEnv = {
  /** The pieces of content in a card, in reading order (the converter's own flattening of what a card holds). */
  leaves: (card: CaptureNode) => CaptureNode[];
  /** A node of the page at computers' width, and at phones' width (null without a phone capture), by its path. */
  getD: (path: string) => CaptureNode | null | undefined;
  getM: ((path: string) => CaptureNode | null | undefined) | null;
  /** The whole capture at each width, for what lies around a track (arrows and dots). */
  desktop: PageCapture;
  mobile: PageCapture | null;
};

/** Where in the page the group is: what hints say the cards are a menu, a footer's columns or part of a form. */
export type GridContext = { footer: boolean; nav: boolean };

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const HEADING = /^h[1-6]$/;
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const within = (value: number, around: number, share: number) => Math.abs(value - around) <= around * share;
const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Lines of text a text box holds. */
function linesOf(n: CaptureNode): number {
  const lh = px(n.s.lineHeight) ?? (px(n.s.fontSize) ?? 16) * 1.3;
  return Math.max(1, Math.round(n.box[3] / Math.max(1, lh)));
}
const oneLine = (n: CaptureNode) => linesOf(n) <= 1;
const sizeOf = (n: CaptureNode) => px(n.s.fontSize) ?? 16;

/** Words as compared: lower case, without the marks round them, so a colon or a full stop is not a word. */
export function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}$€£¥]+|[^\p{L}\p{N}$€£¥]+$/gu, ""))
    .filter((token) => token !== "");
}

/** Text cut at a limit on a word, never in the middle of one. */
export function cutOnWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.5 ? head.slice(0, space) : text.slice(0, max)).trimEnd();
}

// ---------------------------------------------------------------------------
// Prices and dates, by pattern
// ---------------------------------------------------------------------------

const CURRENCY = "(?:[$€£¥]|kr\\.?|nok|sek|dkk|eur|usd|gbp|chf|pln|czk|isk|huf|ron|bgn)";
const PRICE_BEFORE = new RegExp(`(?:^|[\\s(])${CURRENCY}\\s?\\d`, "i");
const PRICE_AFTER = new RegExp(`\\d[\\d\\s.,]*\\s?(?:${CURRENCY}(?![\\p{L}])|,-|:-)`, "iu");

/** Whether a short text is a price: a currency sign or code beside digits (`199 kr`, `$19.99`, `NOK 1 299`, `199,-`). */
export function isPriceText(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= CUSTOM_PRICE_TEXT_MAX && /\d/.test(t) && (PRICE_BEFORE.test(t) || PRICE_AFTER.test(t));
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, januari: 1,
  feb: 2, februar: 2, february: 2, februari: 2,
  mar: 3, mars: 3, march: 3, marts: 3,
  apr: 4, april: 4,
  mai: 5, maj: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8, augusti: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

/** The names of the weekdays in nb, sv, da and en, in full and abbreviated: the only words that may stand in front of a date. */
const WEEKDAYS = [
  "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag", "man", "tir", "ons", "tor", "fre", "lør", "søn",
  "måndag", "tisdag", "tors", "lördag", "söndag", "mån", "tis", "lör", "sön",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
].join("|");

/** Whether a text is a date written with a weekday in front (`tirsdag 12. mars 2024`): a date field cannot hold the weekday, so the text stays words. */
export const hasWeekday = (text: string): boolean => new RegExp(`^(?:${WEEKDAYS})\\.?,?\\s`, "iu").test(text.trim());

const dayOf = (year: number, month: number, day: number): string | null => {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
};

/**
 * A text that is nothing but a date, as `YYYY-MM-DD`, or null. Written as `2024-03-12`, `12.03.2024`, `12 March 2024`,
 * `March 12, 2024` (with the months of nb, sv, da and en), a weekday's name in front allowed (`tirsdag 12. mars 2024`, and no other word: `Published 12 March 2024`
 * is words with a date in them); `12/03/2024` only where one part is above 12 and says which is the day. A guess is never made: an ambiguous or odd date
 * stays text.
 */
export function parseDate(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(t);
  if (m) return dayOf(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) return dayOf(Number(m[3]), b, a);
    if (b > 12 && a <= 12) return dayOf(Number(m[3]), a, b);
    return null;
  }
  m = new RegExp(`^(?:(?:${WEEKDAYS})\\.?,?\\s)?(\\d{1,2})\\.?\\s([\\p{L}]+)\\.?,?\\s(\\d{4})$`, "iu").exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return dayOf(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /^([\p{L}]+)\.?\s(\d{1,2})(?:st|nd|rd|th)?,?\s(\d{4})$/u.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return dayOf(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  return null;
}

// ---------------------------------------------------------------------------
// Leaves and signatures
// ---------------------------------------------------------------------------

/**
 * What a piece of a card is, in a letter: P a picture, V a video or embed, C a form control, H a heading, B a button or link
 * of a few words, U a list of text, L a short label (a line), T a paragraph, S a painted shape.
 */
export type LeafKind = "P" | "V" | "C" | "H" | "B" | "U" | "L" | "T" | "S";

/**
 * A picture too small to be seen (a tracking pixel, a spacer): under 8 by 8 pixels as drawn. It is no picture of the card's, so it is never an item's picture,
 * never counts in the card's shape, and is not fetched. (A one-pixel file drawn large is a colour, which a card may show, so only the size drawn counts.)
 */
export function isTinyPicture(n: CaptureNode): boolean {
  return n.media?.kind === "img" && n.box[2] < 8 && n.box[3] < 8;
}

export function kindOf(n: CaptureNode): LeafKind {
  const media = n.media;
  if (media) {
    if (isTinyPicture(n)) return "S";
    if (media.kind === "img" || media.kind === "svg" || media.kind === "canvas") return "P";
    if (media.kind === "control") return "C";
    return "V";
  }
  if (isTextList(n)) return "U";
  if (n.runs !== undefined) {
    const words = wordsOf(n);
    if (HEADING.test(n.tag)) return "H";
    if (n.button) return "B";
    if (n.tag === "a" && n.href && words.length <= 40) return "B";
    return words.length <= 60 && oneLine(n) ? "L" : "T";
  }
  return "S";
}

const depthOf = (card: CaptureNode, leaf: CaptureNode) => leaf.p.split("/").length - card.p.split("/").length;

/**
 * The card's shape: its leaves' kinds in order, and how deep the ones that are not labels lie. A label may come and go (a badge), and a
 * card may hold more pictures or buttons than the others (an icon, a second button): the card's picture is its largest and its button
 * its first, so those are the shape, and the extras are what mapping says it cannot hold, with its own reason.
 */
function signatureOf(card: CaptureNode, leaves: CaptureNode[]): { kinds: string; depths: string } {
  const real = leaves.filter((leaf) => kindOf(leaf) !== "S");
  const pictures = real.filter((leaf) => kindOf(leaf) === "P").sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  const firstButton = real.find((leaf) => kindOf(leaf) === "B");
  const shape = real.filter((leaf) => (kindOf(leaf) === "P" ? leaf === pictures[0] : kindOf(leaf) === "B" ? leaf === firstButton : true));
  return { kinds: shape.map((leaf) => kindOf(leaf)).join(""), depths: shape.filter((leaf) => kindOf(leaf) !== "L").map((leaf) => depthOf(card, leaf)).join(",") };
}

/** The same shape, or one label more or less (a badge on some cards and not on others). */
function sameShape(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long[i] === "L" && long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Script sliders: the real slides, and the copies a library made to loop
// ---------------------------------------------------------------------------

/** What was read of a script slider's tiles: the real slides, and what was left out of them (D155, C2). */
export type SliderRead = {
  track: CaptureNode;
  /** The real slides in the slider's own order: copies are left out; slides out of view (hidden, or beyond the box) are in. */
  real: CaptureNode[];
  /** Tiles left out as copies, by how they were told: the library's marker, a number of its own seen again, content seen again. */
  clones: { markers: number; keys: number; hashes: number };
  /** Real slides that were not in view: hidden, see-through, or beyond the box that clips the track. */
  hidden: number;
  /** The words of those slides, so a slider kept as it was can say what the copy lacks. */
  hiddenWords: number;
  /** Slides the browser never read: past the most it reads of one track, or once the page's node budget was spent. */
  unread: number;
  /** Whether the slider loops: it had copies. */
  loop: boolean;
  /** The order was the slider's own numbers' (a loop's copies shuffle the page's), else where the slides stand in the page. */
  order: "page" | "numbers";
};

/** What a slide is as content: its words, pictures and where it links. Nothing to compare when it has no words or pictures. Two slides that say the same but go to different places are two slides. */
const contentOf = (mark: SlideMark): string => (mark.text === "" && mark.imgs.length === 0 ? "" : `${mark.text}\u0001${mark.imgs.join("|")}\u0001${(mark.links ?? []).join("|")}`);

/**
 * Whether the content of a track's tiles shows a loop's copies, without any marker: copies at both ends of the track (its first `head` tiles say what the last `head` of
 * the real ones say, and its last `tail` what the first `tail` of the real ones say: `[C' A B C A']`), or at one end as a run of two or more (a block that repeats the other
 * end's run). One tile repeated at one end alone is no evidence: a list that happens to end as it began (`A B C A`) is a list. Returns the copies at each end (the
 * fewest that fit, so the most real slides are kept), or null.
 */
export function loopedEnds(content: string[], start = -1): { head: number; tail: number } | null {
  const n = content.length;
  const same = (from: number, to: number, length: number) => {
    for (let i = 0; i < length; i++) if (content[from + i] === "" || content[from + i] !== content[to + i]) return false;
    return true;
  };
  let best: { head: number; tail: number } | null = null;
  const consider = (head: number, tail: number) => {
    const real = n - head - tail;
    if (real < Math.max(head, tail, 2)) return;
    // The head copies stand where the last `head` real slides do, the tail copies where the first `tail` do.
    if (head > 0 && !same(0, n - tail - head, head)) return;
    if (tail > 0 && !same(n - tail, head, tail)) return;
    // The fewest copies; of those, the first real slide is the first one in view (a slider opens on its first slide); then copies at both ends over one end alone;
    // then the most even between the two ends (a library clones as many at each end).
    const rank = (h: number, t: number) => [h + t, h === start ? 0 : 1, h > 0 && t > 0 ? 0 : 1, Math.abs(h - t)];
    const now = rank(head, tail);
    const before = best ? rank(best.head, best.tail) : null;
    const lower = !before || now.some((value, k) => now.slice(0, k).every((v, m) => v === before[m]) && value < before[k]);
    if (lower) best = { head, tail };
  };
  for (let head = 1; head * 2 < n; head++) for (let tail = 1; head + tail * 2 <= n; tail++) consider(head, tail);
  for (let run = 2; run * 2 <= n; run++) {
    consider(run, 0);
    consider(0, run);
  }
  return best;
}

const numberOf = (key: string | undefined): number | null => {
  if (key === undefined || !/^-?\d+$/.test(key.trim())) return null;
  return Number(key);
};

/**
 * The real slides of a script slider's track. Copies are told by the library's own marker (`swiper-slide-duplicate`, `slick-cloned`,
 * `splide__slide--clone`, `cloned`), then by a number of the slider's own seen again (`data-swiper-slide-index`, `data-slick-index`), and
 * as a last resort by content (the same words and pictures as a slide already kept); library names are hints, never what decides. Slides
 * are put in the order of the library's own numbers when every real slide has one, as a loop's copies change where the slides stand.
 */
export function readSlider(track: CaptureNode): SliderRead | null {
  if (!track.slider) return null;
  const clones = { markers: 0, keys: 0, hashes: 0 };
  const inView = (tile: CaptureNode) => tile.slide?.hide === undefined;
  let candidates = track.children.filter((tile) => {
    if (tile.slide?.clone === undefined) return true;
    clones.markers += 1;
    return false;
  });
  // A number of the library's own seen again is a copy: the slide in view is the real one when there is one, else the first.
  const byKey = new Map<string, CaptureNode[]>();
  for (const tile of candidates) {
    const key = tile.slide?.key;
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), tile]);
  }
  const sameKey = new Set<CaptureNode>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const keep = group.find(inView) ?? group[0];
    const kept = keep.slide ? contentOf(keep.slide) : "";
    for (const tile of group) {
      if (tile === keep) continue;
      // A number seen again is a copy only if it says what the first said: a page may number things (`data-index`) that are not slides' places.
      if ((tile.slide ? contentOf(tile.slide) : "") !== kept) continue;
      sameKey.add(tile);
      clones.keys += 1;
    }
  }
  candidates = candidates.filter((tile) => !sameKey.has(tile));
  // The same words, pictures and addresses as a slide already kept is a copy, as a last resort, and only where there is evidence of a loop: a marker or a
  // number of the library's own somewhere on the track, or copies standing at both ends of it. A loop's copies stand at both ends of the track, so the
  // real slides are those from the first one in view on, then what stands before it that is not repeated after it: the slider's own first slide is
  // the one it shows when the page is opened. Without that evidence a repeated slide is the slider's own slide (a list may end as it began).
  const content = candidates.map((tile) => (tile.slide ? contentOf(tile.slide) : ""));
  let real = candidates;
  const marked = clones.markers + clones.keys > 0;
  const ends = marked ? null : loopedEnds(content, Math.max(0, candidates.findIndex(inView)));
  if (marked && content.some((c, i) => c !== "" && content.indexOf(c) !== i)) {
    const start = Math.max(0, candidates.findIndex(inView));
    const seen = new Set<string>();
    const after: CaptureNode[] = [];
    const before: CaptureNode[] = [];
    const take = (i: number, into: CaptureNode[]) => {
      if (content[i] !== "" && seen.has(content[i])) {
        clones.hashes += 1;
        return;
      }
      if (content[i] !== "") seen.add(content[i]);
      into.push(candidates[i]);
    };
    for (let i = start; i < candidates.length; i++) take(i, after);
    for (let i = 0; i < start; i++) take(i, before);
    real = [...before, ...after];
  } else if (ends) {
    real = candidates.slice(ends.head, candidates.length - ends.tail);
    clones.hashes += ends.head + ends.tail;
  }
  let order: SliderRead["order"] = "page";
  const numbers = real.map((tile) => numberOf(tile.slide?.key));
  if (real.length > 1 && numbers.every((n) => n !== null) && new Set(numbers).size === numbers.length) {
    const sorted = [...real].sort((a, b) => numberOf(a.slide?.key)! - numberOf(b.slide?.key)!);
    if (sorted.some((tile, i) => tile !== real[i])) {
      real = sorted;
      order = "numbers";
    }
  }
  const out = real.filter((tile) => !inView(tile));
  return {
    track,
    real,
    clones,
    hidden: out.length,
    hiddenWords: out.reduce((n, tile) => n + tokensOf(tile.slide?.text ?? "").length, 0),
    unread: track.slider.unread ?? 0,
    loop: clones.markers + clones.keys + clones.hashes > 0,
    order,
  };
}

/** The box a track shows its slides through: the clipping box a script slider has, else the track's own. */
export const boxOfTrack = (track: CaptureNode): Box => track.slider?.clip ?? track.box;

/** Where each real slide of a script slider at computers' width stands at phones' (by its place among the real slides), by path. */
export function mobileTiles(desktop: SliderRead, mobile: SliderRead): Map<string, string> {
  const map = new Map<string, string>();
  const n = Math.min(desktop.real.length, mobile.real.length);
  for (let i = 0; i < n; i++) if (desktop.real[i].p !== mobile.real[i].p) map.set(desktop.real[i].p, mobile.real[i].p);
  return map;
}

/** Whether a node beside a track is one of its controls: by its class or words, or because it holds a button the browser found by label near the track. */
export function controlFor(track: CaptureNode, n: CaptureNode): boolean {
  if (controlLike(n)) return true;
  const found = controlsOf(track);
  if (!found || n.runs !== undefined || n.box[3] > 140) return false;
  const boxes: Box[] = [...found.arrows.map((a) => a.box), ...(found.dots ? [found.dots.box] : [])];
  return boxes.some((b) => b[0] >= n.box[0] - 2 && b[1] >= n.box[1] - 2 && rightOf(b) <= rightOf(n.box) + 2 && bottomOf(b) <= bottomOf(n.box) + 2);
}

// ---------------------------------------------------------------------------
// Detecting a group of the same card
// ---------------------------------------------------------------------------

export type CardGroup = {
  parent: CaptureNode;
  cards: CaptureNode[];
  leaves: CaptureNode[][];
  /** The cards in rows, top to bottom, each left to right. */
  rows: CaptureNode[][];
  /** The parent scrolls sideways by itself, or is a script slider's track: a track, not a grid that fits. */
  track: "static" | "scroller";
  /** A script slider's real slides and what was left out of them (copies made to loop); null for a native scroller or a static group. */
  slider: SliderRead | null;
};

export type Detection =
  | { kind: "none" }
  /** It looks like a grid of cards but is not one the converter will build; `noteworthy` when it is worth a line in the report. */
  | { kind: "refused"; reason: string; cards: number; noteworthy: boolean }
  | { kind: "group"; group: CardGroup };

const FOOTER = /(^|[.\-_#])footer([.\-_]|$)/i;
const MENU = /(^|[.\-_#])(nav|navbar|navigation|menu|menubar)([.\-_]|$)/i;

/** Hints that what a node holds is the site's footer or menu, from where it stands. */
export const contextOf = (parent: GridContext, node: CaptureNode): GridContext => ({
  footer: parent.footer || node.tag === "footer" || FOOTER.test(node.sel ?? ""),
  nav: parent.nav || node.tag === "nav" || MENU.test(node.sel ?? ""),
});

/** The previous and next buttons and dots the browser found round a track (a script slider's, or a sideways scroller's). */
const controlsOf = (track: CaptureNode): Pick<NonNullable<CaptureNode["slider"]>, "arrows" | "dots"> | undefined => track.slider ?? track.controls;

export function detectGroup(parent: CaptureNode, allKids: CaptureNode[], env: Pick<GridEnv, "leaves" | "desktop">, ctx: GridContext, read: SliderRead | null = null): Detection {
  // A bar fixed to the screen, or a sticky one across the box, is no card: it lies over the first of the boxes, which would make a page's
  // header, content and footer look side by side.
  const kids = allKids.filter((kid) => kid.s.position !== "fixed" && !(kid.s.position === "sticky" && kid.box[2] >= parent.box[2] * 0.8 && kid.box[3] <= 220));
  // Two boxes are cards in a track that scrolls sideways only with previous and next buttons beside it: two boxes with nothing to go to are a pair.
  const min = parent.scroll && arrowsNear(env.desktop.root, parent) ? 2 : 3;
  if (kids.length < min) return { kind: "none" };
  // Cards are boxes (or pictures on their own): words standing side by side are a menu or a line of text, not cards.
  if (kids.some((kid) => kid.runs !== undefined || kid.media?.kind === "control" || kid.media?.kind === "video" || kid.media?.kind === "embed")) return { kind: "none" };
  const widths = kids.map((kid) => kid.box[2]);
  const midWidth = median(widths);
  if (midWidth < 24) return { kind: "none" };
  if (!kids.every((kid) => within(kid.box[2], midWidth, 0.25))) return { kind: "none" };
  // Boxes one under another (a page's sections, a list) are not a group at this width, whatever they are built of.
  if (!parent.scroll && !kids.some((kid) => kid !== kids[0] && Math.abs(kid.box[1] - kids[0].box[1]) <= Math.max(8, kids[0].box[3] * 0.3))) return { kind: "none" };
  const like = kids.every((kid) => within(kid.box[2], midWidth, 0.1));
  const refuse = (reason: string, noteworthy = true): Detection => ({ kind: "refused", reason, cards: kids.length, noteworthy });

  const leaves = kids.map((kid) => env.leaves(kid));
  const real = leaves.map((list) => list.filter((leaf) => kindOf(leaf) !== "S"));
  if (real.some((list) => list.length === 0)) return { kind: "none" };

  // A footer's columns, a menu and a form are right to be refused: they are in the markdown report, not a problem of the copy.
  if (ctx.footer) return refuse("looks like a footer's columns, which keep their own handling", false);
  if (ctx.nav) return refuse("looks like a menu, which keeps its own handling", false);
  if (real.some((list) => list.some((leaf) => kindOf(leaf) === "C"))) return refuse("the boxes hold form fields, and a form needs its own block", false);
  const lists = real.flatMap((list) => list.filter((leaf) => kindOf(leaf) === "U" && leaf.children.length >= 3));
  if (lists.length > 0) {
    // Lists of links are a footer's columns (a menu's); lists of words (the bullets of a pricing column) are a list an item cannot show as one.
    const links = lists.every((leaf) => leaf.children.every((item) => (item.runs ?? []).some((run) => run.href) || item.href));
    return links ? refuse("each box holds a list of links, like a footer's columns of links", false) : refuse("each box holds a list of three or more lines, which an item shows as one run-on text");
  }
  if (!like) return refuse("the boxes are not the same width (within 10 %)");
  // One piece of text in each box is a menu or a row of words, unless the boxes are the slides of a slider that has slides out of view or copies
  // (a slider of plain quotes, with or without buttons or dots): then they are the slider's content, and a copy that kept only the slides in
  // view would lose the rest. A row of words that all show, in a box that merely clips, stays a row of words.
  const sliderControls = read !== null && (read.hidden > 0 || read.loop || (read.track.slider?.arrows.length ?? 0) > 0 || read.track.slider?.dots != null);
  if (!sliderControls && real.every((list) => list.length === 1 && kindOf(list[0]) !== "P")) return refuse("each box is one piece of text, like a menu or a row of words");

  // The same card: the same pieces in the same order and depth, but for one label.
  const signatures = kids.map((kid, i) => signatureOf(kid, real[i]));
  const tally = new Map<string, number>();
  for (const s of signatures) tally.set(`${s.kinds}|${s.depths}`, (tally.get(`${s.kinds}|${s.depths}`) ?? 0) + 1);
  const [reference] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const [refKinds, refDepths] = reference.split("|");
  const odd = signatures.map((s, i) => (sameShape(s.kinds, refKinds) && s.depths === refDepths ? -1 : i)).filter((i) => i >= 0);
  if (odd.length > 0) return refuse(`structurally different siblings (${plural(odd.length, "box", "boxes")} of ${kids.length} are built differently from the others)`, odd.length <= kids.length / 2);

  const rows = geometryOf(kids, parent);
  if (rows === null) return { kind: "none" };
  if (typeof rows === "string") return refuse(rows);
  // The cards stand in the order they are seen, row after row and left to right, whatever order the markup gives (CSS `order`, a row that is reversed, a right-to-left
  // page): the copy lists them as the original showed them. A script slider's slides are in the library's own order.
  const ordered = read ? kids : rows.flat();
  return { kind: "group", group: { parent, cards: ordered, leaves: ordered.map((card) => leaves[kids.indexOf(card)]), rows, track: parent.scroll ? "scroller" : "static", slider: read } };
}

/** The cards in rows if they are laid out evenly (same size within a margin, same gaps), what is uneven, or null when they are not side by side at all. */
function geometryOf(cards: CaptureNode[], parent: CaptureNode): CaptureNode[][] | string | null {
  const midHeight = median(cards.map((c) => c.box[3]));
  // Slides on top of each other: one place, so no rows, gaps or sides to compare; only their size.
  if (parent.slider?.kind === "stack") return cards.every((c) => within(c.box[3], midHeight, 0.2)) ? [cards] : "the slides differ in height by more than 20 %";
  const sorted = [...cards].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const rows: CaptureNode[][] = [];
  for (const card of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(card.box[1] - row[0].box[1]) <= Math.max(8, midHeight * 0.3)) row.push(card);
    else rows.push([card]);
  }
  for (const row of rows) row.sort((a, b) => a.box[0] - b.box[0]);
  // Boxes one under another (a page's sections, a list) are not a grid at this width, nor a track.
  if (rows[0].length < 2 && !parent.scroll) return null;
  if (!cards.every((c) => within(c.box[3], midHeight, 0.2))) return "the boxes are equal in width but differ in height by more than 20 %";
  if (parent.scroll && rows.length > 1) return "the track holds more than one row of cards";
  const perRow = rows[0].length;
  if (rows.some((row, i) => (i < rows.length - 1 ? row.length !== perRow : row.length > perRow))) return "the boxes do not make equal rows";
  const gaps: number[] = [];
  for (const row of rows) for (let i = 1; i < row.length; i++) gaps.push(row[i].box[0] - rightOf(row[i - 1].box));
  if (gaps.some((g) => g < -2)) return "the boxes overlap";
  if (gaps.length > 0 && Math.max(...gaps) - Math.min(...gaps) > 4) return "the gaps between the boxes are not equal";
  const lines: number[] = [];
  for (let i = 1; i < rows.length; i++) lines.push(rows[i][0].box[1] - Math.max(...rows[i - 1].map((c) => bottomOf(c.box))));
  if (lines.length > 0 && Math.max(...lines) - Math.min(...lines) > 4) return "the gaps between the rows are not equal";
  if (rows.some((row) => Math.abs(row[0].box[0] - rows[0][0].box[0]) > 4)) return "the rows do not start at the same place";
  return rows;
}

// ---------------------------------------------------------------------------
// Mapping a card to an item
// ---------------------------------------------------------------------------

/** What a card says, before the converter has the picture's copy in the library: its own words and addresses. */
export type ItemDraft = {
  card: string;
  title: string;
  text: string;
  /** `url` is the picture's address as the page has it, for an `img` and for a picture drawn as a box's background; empty for a graphic that is photographed. */
  picture: { url: string; alt: string; leaf: CaptureNode } | null;
  /** The card's one address, if it has one and an item may hold it. */
  link: string | null;
  buttonLabel: string;
  date: string | null;
  badge: string;
  priceText: string;
  details: { label: string; text: string }[];
  /** The leaves that stand for each part, to read the look from. */
  nodes: { title?: CaptureNode; text?: CaptureNode; button?: CaptureNode; badge?: CaptureNode; price?: CaptureNode; date?: CaptureNode; detail?: CaptureNode };
  /** The leaves whose words make the item's text, for how many lines it takes. */
  paragraphs: CaptureNode[];
  /** What the card has that an item does not hold, but that is no words: a second picture, an icon, a video. */
  unheld: string[];
  /** What the card's words had that an item's plain text does not keep: bold, italic, underline, a line break. The words are kept. */
  simplified: string[];
};

/** Why a card cannot be an item. `text`: it would lose words or change their order, so the whole group stays as columns. */
export type CardProblem = {
  kind:
    | "second-button"
    | "second-link"
    | "text-cut"
    | "second-picture"
    | "video"
    | "background-picture"
    | "link-unsafe"
    | "script-button"
    | "inline-link"
    | "generated-text"
    | "before-title"
    | "list";
  text: boolean;
};

const PROBLEM_WORDS: Record<CardProblem["kind"], string> = {
  "second-button": "hold a second button",
  "second-link": "hold a second link",
  "text-cut": "have more words than an item holds",
  "second-picture": "hold a second picture or an icon set",
  video: "hold a video",
  "background-picture": "paint a picture behind their words",
  "link-unsafe": "link to an address an item may not hold",
  "script-button": "hold a button that is not a link (it runs a script), which an item can only show as a line of text",
  "inline-link": "hold a link inside a sentence, which an item's plain text cannot keep",
  "generated-text": "have words that the page draws with CSS (::before or ::after), which no item can hold",
  "before-title": "have words above the title (a number, a label) that an item shows below it",
  list: "hold a list, which an item shows as one run-on text",
};

type Mapped = { draft: ItemDraft; problems: CardProblem[] };

/** The address a piece of a card goes to: its own, or that of a link that wraps it. */
function addressOf(anchors: CaptureNode[], leaf: CaptureNode): string | null {
  if (leaf.href) return leaf.href;
  const wrapper = anchors.find((a) => a !== leaf && (leaf.p === a.p || leaf.p.startsWith(`${a.p}/`)));
  return wrapper?.href ?? leaf.runs?.find((run) => run.href)?.href ?? null;
}

/**
 * The distinct addresses a card links to as a card: its own, its boxes', those of a link that is a whole piece of text (a heading that is a link); and, apart,
 * the addresses of words inside a sentence, which are part of the sentence and no link of the card's (an item's text is plain, so those links are lost).
 */
function linksOf(card: CaptureNode, leaves: CaptureNode[]): { all: string[]; inline: string[] } {
  const all = new Set<string>();
  const partial = new Set<string>();
  for (const n of walk(card)) if (n.href) all.add(n.href);
  for (const leaf of leaves) {
    const runs = isTextList(leaf) ? leaf.children.flatMap((child) => child.runs ?? []) : (leaf.runs ?? []);
    const worded = runs.filter((run) => !run.br && (run.t ?? "").trim() !== "");
    const linked = worded.filter((run) => run.href);
    if (linked.length === 0) continue;
    if (!isTextList(leaf) && linked.length === worded.length && new Set(linked.map((run) => run.href)).size === 1) all.add(linked[0].href!);
    else for (const run of linked) partial.add(run.href!);
  }
  return { all: [...all], inline: [...partial].filter((href) => !all.has(href)) };
}

/** The marks on a text's words that a plain text does not keep. */
function marksOf(leaf: CaptureNode, into: Set<string>) {
  const runs = isTextList(leaf) ? leaf.children.flatMap((child) => child.runs ?? []) : (leaf.runs ?? []);
  for (const run of runs) {
    if (run.br) into.add("line breaks");
    else if (run.b) into.add("bold");
    if (run.i) into.add("italic");
    if (run.u && !run.href) into.add("underline");
  }
}

/** Whether a line of detail fits an item's: a label and a text of the builder's limits. */
const fitsDetail = (label: string, text: string) => label.length <= CUSTOM_DETAIL_LABEL_MAX && text.length <= CUSTOM_DETAIL_TEXT_MAX;

/** The longest side, in pixels, of a picture that is an icon: decoration an item does not hold, and no reason to keep a group as columns. */
const ICON_MAX = 32;

/** Maps one card, or says what stops it. Every word it keeps is a word of the card. */
function mapCard(card: CaptureNode, leaves: CaptureNode[], slide?: SlideMark): Mapped {
  const problems: CardProblem[] = [];
  const problem = (kind: CardProblem["kind"], text: boolean) => {
    if (!problems.some((p) => p.kind === kind)) problems.push({ kind, text });
  };
  const draft: ItemDraft = { card: card.p, title: "", text: "", picture: null, link: null, buttonLabel: "", date: null, badge: "", priceText: "", details: [], nodes: {}, paragraphs: [], unheld: [], simplified: [] };
  const used = new Set<CaptureNode>();
  const real = leaves.filter((leaf) => kindOf(leaf) !== "S");
  const order = new Map(real.map((leaf, i) => [leaf, i]));
  const anchors = [...walk(card)].filter((n) => n.href);

  // The picture: the largest; any other picture or icon, and a video, is something the item does not hold.
  const pictures = real.filter((leaf) => kindOf(leaf) === "P").sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  if (pictures.length > 0) {
    const [first, ...rest] = pictures;
    used.add(first);
    const media = first.media!;
    draft.picture = { url: media.kind === "img" ? media.url : "", alt: media.kind === "img" ? media.alt.trim().slice(0, CUSTOM_ALT_MAX) : "", leaf: first };
    let icons = 0;
    for (const other of rest) {
      used.add(other);
      // A small icon (a review star, a heart, an arrow) is decoration, not a second picture: it is said to be left out, but it does not make the
      // card something an item cannot be (lampan.no: six icons on each of 24 product cards kept them all as columns, 48 blocks a row).
      if (other.box[2] <= ICON_MAX && other.box[3] <= ICON_MAX) {
        icons += 1;
        continue;
      }
      problem("second-picture", false);
      draft.unheld.push(`a second picture (${other.sel ?? other.tag})`);
    }
    if (icons > 0) draft.unheld.push(`${icons} small icon${icons === 1 ? "" : "s"} (stars, hearts, arrows)`);
  }
  for (const leaf of real.filter((l) => kindOf(l) === "V")) {
    used.add(leaf);
    problem("video", false);
    draft.unheld.push(`a video (${leaf.sel ?? leaf.tag})`);
  }
  // A picture drawn as a box's background (a thumbnail `div`) is the card's picture when it has no other; words over one are not held.
  const backs = [...walk(card)]
    .filter((n) => n !== card && (n.bg?.length ?? 0) > 0 && n.box[2] >= 24 && n.box[3] >= 24)
    .sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  for (const back of backs) {
    if ([...walk(back)].some((n) => n !== back && n.runs !== undefined)) {
      problem("background-picture", false);
      draft.unheld.push(`words over a picture drawn as a background (${back.sel ?? back.tag})`);
    } else if (!draft.picture) draft.picture = { url: back.bg![0], alt: "", leaf: back };
    else {
      problem("second-picture", false);
      draft.unheld.push(`a second picture (${back.sel ?? back.tag}, drawn as a background)`);
    }
  }
  if (card.s.backgroundImage && card.s.backgroundImage !== "none") {
    problem("background-picture", false);
    draft.unheld.push("a picture behind the card's words");
  }

  const textLeaves = real.filter((leaf) => !used.has(leaf));
  const picBox = draft.picture?.leaf.box ?? null;
  const overPicture = (leaf: CaptureNode) => {
    if (!picBox) return false;
    const w = Math.min(rightOf(leaf.box), rightOf(picBox)) - Math.max(leaf.box[0], picBox[0]);
    const h = Math.min(bottomOf(leaf.box), bottomOf(picBox)) - Math.max(leaf.box[1], picBox[1]);
    return w > 0 && h > 0 && w * h >= 0.5 * leaf.box[2] * leaf.box[3];
  };

  // A link of a few words is the card's button, unless it is the card's largest text and no heading names the card.
  const hasHeading = textLeaves.some((leaf) => kindOf(leaf) === "H");
  const biggest = Math.max(0, ...textLeaves.filter((leaf) => leaf.runs !== undefined).map(sizeOf));
  const isButton = (leaf: CaptureNode) => kindOf(leaf) === "B" && (leaf.button === true || hasHeading || sizeOf(leaf) < biggest || textLeaves.length <= 1);
  const buttons = textLeaves.filter(isButton);
  const links = linksOf(card, real);
  const hrefs = [...new Set(links.all)];
  if (links.inline.length > 0) {
    problem("inline-link", false);
    draft.unheld.push("a link inside a sentence (its words stay, the link does not)");
  }
  // A button is the item's button only if it is a link to the card's address; one with no address of its own (a script's) is a line of words, and said to be.
  const addressed = buttons.filter((b) => addressOf(anchors, b) !== null);
  const scripted = buttons.filter((b) => addressOf(anchors, b) === null);
  let link: string | null = null;
  if (hrefs.length > 0) {
    if (hrefs.length > 1) problem(addressed.length > 1 ? "second-button" : "second-link", true);
    link = hrefs[0];
    if (!isSafeAddress(link) || !menuLinkSchema.safeParse({ kind: "url", url: link }).success) {
      problem("link-unsafe", false);
      draft.unheld.push("a link to an address an item may not hold");
      link = null;
    }
  }
  if (scripted.length > 0) {
    problem("script-button", false);
    draft.unheld.push(`a button that is not a link (${wordsOf(scripted[0]).slice(0, 40)}), shown as a line of words`);
  }
  if (addressed.length > 1) problem("second-button", true);
  draft.link = link;
  if (addressed.length === 1 && link !== null && addressOf(anchors, addressed[0]) === link) {
    draft.buttonLabel = wordsOf(addressed[0]);
    draft.nodes.button = addressed[0];
    used.add(addressed[0]);
  }

  // The title: the first heading, else the largest short text.
  const rest = () => textLeaves.filter((leaf) => !used.has(leaf));
  let title = rest().find((leaf) => kindOf(leaf) === "H") ?? null;
  if (!title) {
    const candidates = rest().filter((leaf) => (kindOf(leaf) === "L" || kindOf(leaf) === "T" || kindOf(leaf) === "B") && wordsOf(leaf).length <= 80 && !isPriceText(wordsOf(leaf)) && parseDate(wordsOf(leaf)) === null);
    const top = Math.max(0, ...candidates.map(sizeOf));
    title = top > 0 ? (candidates.find((leaf) => sizeOf(leaf) === top) ?? null) : null;
  }
  if (title) {
    used.add(title);
    draft.title = wordsOf(title);
    draft.nodes.title = title;
  }
  const titleAt = title ? (order.get(title) ?? -1) : -1;

  // A price, a date and a badge, each by what it is; links and a second of any are lines of detail.
  const lines: { node: CaptureNode; text: string }[] = [];
  const aboveTitle = new Set<CaptureNode>();
  for (const leaf of rest()) {
    const words = wordsOf(leaf);
    const kind = kindOf(leaf);
    if (kind === "U") continue;
    if (kind === "B") {
      // A line of detail holds a short text; a longer one is a paragraph of the item's text.
      if (words.length <= CUSTOM_DETAIL_TEXT_MAX) {
        lines.push({ node: leaf, text: words });
        used.add(leaf);
      }
      continue;
    }
    if (draft.priceText === "" && kind !== "T" && isPriceText(words)) {
      draft.priceText = words;
      draft.nodes.price = leaf;
      used.add(leaf);
      continue;
    }
    // A date is nothing but a date: a weekday in front, or any other word, is words an item's date cannot hold.
    const day = draft.date === null && kind !== "T" && !hasWeekday(words) ? parseDate(words) : null;
    if (day) {
      draft.date = day;
      draft.nodes.date = leaf;
      used.add(leaf);
      continue;
    }
    // A short label over the picture or on a pill is the badge; so is the one a card puts above its title (a number, an eyebrow), which the badge draws above it too.
    const above = titleAt >= 0 && (order.get(leaf) ?? Infinity) < titleAt;
    if (draft.badge === "" && kind === "L" && words.length <= CUSTOM_BADGE_MAX && (overPicture(leaf) || paints(leaf.s.backgroundColor) || above)) {
      draft.badge = words;
      draft.nodes.badge = leaf;
      used.add(leaf);
    } else if (draft.badge !== "" && above && kind === "L" && draft.picture && !overPicture(leaf) && words.length <= CUSTOM_DETAIL_TEXT_MAX) {
      // A label between the picture and the title that is not on the picture (a brand above a product's name) is a line of detail, which the tile's rules put where
      // it stood (its order and the space above it are measured); the badge keeps the label that is on the picture.
      lines.push({ node: leaf, text: words });
      aboveTitle.add(leaf);
      used.add(leaf);
    } else if (draft.badge !== "" && above && kind === "L" && `${draft.badge} · ${words}`.length <= CUSTOM_BADGE_MAX) {
      // A second short label above the title (a campaign and a brand: "OKTOBERFEST", "Lucide") joins the first, in their order, so the cards stay an item each
      // instead of the whole group falling back to columns (seen on lampan.no: 24 cards as columns used up the page's blocks and style budget).
      draft.badge = `${draft.badge} · ${words}`;
      used.add(leaf);
    }
  }

  // What is left, in reading order: lines of detail (a short label and its value) and paragraphs.
  const remaining = rest().filter((leaf) => kindOf(leaf) !== "U");
  const details: { label: string; text: string; node: CaptureNode }[] = lines.map((line) => ({ label: "", text: line.text, node: line.node }));
  const sameLine = (a: CaptureNode, b: CaptureNode) => Math.min(bottomOf(a.box), bottomOf(b.box)) - Math.max(a.box[1], b.box[1]) > 0.5 * Math.min(a.box[3], b.box[3]);
  for (let i = 0; i < remaining.length; i++) {
    const leaf = remaining[i];
    const words = wordsOf(leaf);
    const next = remaining[i + 1];
    // Two pieces on one line with room between them are a label and its value; with no more than a word space between, they are one sentence set in two styles.
    if (kindOf(leaf) === "L" && next && kindOf(next) === "L" && sameLine(leaf, next) && leaf.box[0] < next.box[0] && next.box[0] - rightOf(leaf.box) >= Math.max(4, 0.3 * sizeOf(leaf)) && fitsDetail(words, wordsOf(next))) {
      details.push({ label: words, text: wordsOf(next), node: leaf });
      i += 1;
      continue;
    }
    const colon = /^([^:]{1,60}):\s+(.{1,120})$/.exec(words);
    if (kindOf(leaf) === "L" && colon && fitsDetail(colon[1], colon[2])) {
      details.push({ label: colon[1], text: colon[2], node: leaf });
      continue;
    }
    draft.paragraphs.push(leaf);
  }
  const kept = details.slice(0, TILE_FIELDS_MAX);
  draft.details = kept.map(({ label, text }) => ({ label, text }));
  if (kept.length > 0) draft.nodes.detail = kept[0].node;
  // Lines beyond three go in the text, in the card's order: nothing is left out for want of a line.
  const overflow = details.slice(TILE_FIELDS_MAX).map((d) => (d.label ? `${d.label}: ${d.text}` : d.text));
  const listLeaves = real.filter((l) => kindOf(l) === "U" && !used.has(l));
  const lists = listLeaves.map((l) => wordsOf(l));
  if (listLeaves.length > 0) problem("list", true);
  draft.text = cutOnWord([...draft.paragraphs.map((leaf) => wordsOf(leaf)), ...lists, ...overflow].filter(Boolean).join(" "), CUSTOM_TEXT_MAX);
  if (draft.paragraphs[0]) draft.nodes.text = draft.paragraphs[0];
  draft.title = cutOnWord(draft.title, CUSTOM_TITLE_MAX);
  draft.buttonLabel = cutOnWord(draft.buttonLabel, CUSTOM_BUTTON_MAX);
  draft.priceText = cutOnWord(draft.priceText, CUSTOM_PRICE_TEXT_MAX);

  // Words that stand above the title but would be drawn below it (an item is its title first) change the card's reading order.
  if (titleAt >= 0 && [...draft.paragraphs, ...details.map((d) => d.node).filter((n) => !aboveTitle.has(n))].some((leaf) => (order.get(leaf) ?? Infinity) < titleAt)) problem("before-title", true);
  // Words the page draws with CSS (a `::before` that says NEW) are in no text of the card: they cannot be copied, and are said to be left out.
  const generated = [...walk(card)].flatMap((n) => n.gen ?? []);
  if (generated.length > 0) {
    problem("generated-text", false);
    draft.unheld.push(`words the page draws with CSS (${generated.slice(0, 2).join(", ")})`);
  }
  // What an item's plain text does not keep of the words' look.
  const marks = new Set<string>();
  for (const leaf of [...(title ? [title] : []), ...draft.paragraphs, ...listLeaves]) marksOf(leaf, marks);
  draft.simplified = [...marks];

  // No word of the card is lost: every word of its text pieces is in the item (a date's words by the date it came to).
  const cardWords = real.filter((leaf) => leaf.runs !== undefined || isTextList(leaf)).flatMap((leaf) => tokensOf(wordsOf(leaf)));
  const have = new Map<string, number>();
  for (const token of [...itemTokens(draft), ...(draft.nodes.date ? tokensOf(wordsOf(draft.nodes.date)) : [])]) have.set(token, (have.get(token) ?? 0) + 1);
  let lost = 0;
  for (const token of cardWords) {
    const n = have.get(token) ?? 0;
    if (n > 0) have.set(token, n - 1);
    else lost += 1;
  }
  // A slide of a script slider was also read as words by the browser, whether it shows or not: words the page draws in it that the card's pieces do not hold are lost too.
  if (slide) {
    const held = new Map<string, number>();
    for (const token of cardWords) held.set(token, (held.get(token) ?? 0) + 1);
    for (const token of tokensOf(slide.text)) {
      const n = held.get(token) ?? 0;
      if (n > 0) held.set(token, n - 1);
      else lost += 1;
    }
  }
  if (lost > 0 && !problems.some((p) => p.text)) problem("text-cut", true);
  return { draft, problems };
}

/** Every word an item shows, as tokens. */
export function itemTokens(item: Pick<ItemDraft, "title" | "text" | "buttonLabel" | "badge" | "priceText" | "details">): string[] {
  return [item.title, item.text, item.buttonLabel, item.badge, item.priceText, ...item.details.flatMap((d) => [d.label, d.text])].flatMap(tokensOf);
}

// ---------------------------------------------------------------------------
// Planning the grid
// ---------------------------------------------------------------------------

export type GridVerdict =
  | { kind: "none" }
  | { kind: "kept"; reason: string; cards: number; noteworthy: boolean }
  | { kind: "grid"; plan: GridPlan };

export type GridPlan = {
  group: CardGroup;
  /** The cards that become items (at most `CUSTOM_ITEMS_MAX`), in order. */
  drafts: ItemDraft[];
  /** Cards beyond the most an item list holds, left out and counted. */
  cut: number;
  /** Slides of a script slider the browser never read (a track of thousands, or a page past its node budget), left out and counted. */
  unread: number;
  /** Cards that hold something an item does not (and no words): each with what it did not hold. */
  failed: { card: string; sel: string; y: number; what: string[] }[];
  /** What the cards' words had that an item's plain text does not keep (bold, a line break), by how many cards. The words are kept. */
  simplified: { what: string; cards: number }[];
  /** Where each of the item's parts is on the page, for the look. */
  carousel: CarouselRead | null;
  /** Lines of an item's text, the most over both widths. */
  lines: number;
};

/** What a carousel's settings were read as, and what the page showed. */
export type CarouselRead = {
  settings: CarouselSettings;
  perScreen: { desktop: number; phone: number | null };
  /** A grid at computers' width that scrolls sideways on phones only: a carousel from the phone's width down (`carouselOn: "phones"`). */
  phonesOnly?: true;
  arrows: boolean;
  dots: boolean;
  snap: "start" | "center" | "none";
  peek: boolean;
  /** Tiles dropped as clones of others (a script slider's copies); none for a native scroller. */
  clones: number;
  autoplay: "not observed" | { seconds: number };
  /** Going round: a slider that had copies is a carousel that goes back to its first tile. */
  rewind: boolean;
  /** What was read of a script slider's tiles; null for a native scroller. */
  script: { kind: "transform" | "flex" | "stack"; hints: string[]; hidden: number; hiddenWords: number; clonesBy: SliderRead["clones"]; order: SliderRead["order"] } | null;
  /** How long the track was watched for autoplay (null: not watched), what it did, and why it was not read as autoplay when it moved all the time or could not be watched. */
  watched: { ms: number; moves: number; basis: "interval" | "once" | null; why?: string } | null;
};

const MAX_LINES = 6;

/** The note a kept slider carries: what of it the copy does not hold, so the report is not kinder than the page. */
function leftOut(read: SliderRead | null): string {
  if (!read) return "";
  const parts: string[] = [];
  if (read.hidden > 0) parts.push(`the ${plural(read.hidden, "slide")} out of view (${plural(read.hiddenWords, "word")}) ${read.hidden === 1 ? "is" : "are"} not in the copy`);
  if (read.unread > 0) parts.push(`${plural(read.unread, "more slide")} ${read.unread === 1 ? "was" : "were"} never read (a track is read to its first ${TRACK_TILES_READ})`);
  return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

/** The most tiles of one track that the browser reads (`TILES_MAX` of the extractor). */
export const TRACK_TILES_READ = 200;

/** Whether two slides' skeletons are the same card: equal, or one text part more or less (a badge on some). */
export function sameSig(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long[i] === "T" && long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

/** An item as the builder will check it when the page is saved, from a draft (its picture is the library's copy, only known when the page is built). */
function itemOf(draft: ItemDraft, index: number) {
  return {
    id: `item${index}`,
    title: draft.title,
    text: draft.text,
    picture: null,
    link: draft.link ? { kind: "url" as const, url: draft.link } : null,
    buttonLabel: draft.buttonLabel,
    date: draft.date,
    badge: draft.badge,
    priceText: draft.priceText,
    details: draft.details.map((line, i) => ({ id: `d${i}`, label: line.label, text: line.text })),
  };
}

/** Decides whether a group becomes a grid, and what its items are. `read` is a script slider's real slides, which a track brings. */
export function planGrid(parent: CaptureNode, kids: CaptureNode[], env: GridEnv, ctx: GridContext, read: SliderRead | null = null): GridVerdict {
  const found = detectGroup(parent, kids, env, ctx, read);
  // A script slider is always worth a line: built as a grid, or kept as it was with the reason.
  if (found.kind === "none") return read ? { kind: "kept", reason: `the slides are not boxes of one kind of card${leftOut(read)}`, cards: kids.length, noteworthy: true } : { kind: "none" };
  if (found.kind === "refused") return { kind: "kept", reason: found.reason + leftOut(read), cards: found.cards, noteworthy: found.noteworthy || read !== null };
  const group = found.group;
  const total = group.cards.length;
  // The slides, hidden ones included, are built the same way: their skeletons are read from the elements, not the boxes, so a slide with no box has one.
  if (read) {
    const sigs = group.cards.map((card) => card.slide?.sig ?? "");
    const tally = new Map<string, number>();
    for (const sig of sigs) tally.set(sig, (tally.get(sig) ?? 0) + 1);
    const [top] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const odd = sigs.filter((sig) => !sameSig(sig, top)).length;
    if (odd > 0) return { kind: "kept", reason: `${odd} of ${total} slides are built differently from the others (the slides out of view counted)${leftOut(read)}`, cards: total, noteworthy: true };
  }
  const mapped = group.cards.map((card, i) => mapCard(card, group.leaves[i], read ? card.slide : undefined));

  // Words that would be lost, or moved, keep the whole group as columns.
  const losing = mapped.filter((m) => m.problems.some((p) => p.text));
  if (losing.length > 0) {
    const kinds = new Map<CardProblem["kind"], number>();
    for (const m of losing) for (const p of m.problems.filter((q) => q.text)) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    const [kind, n] = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0];
    return { kind: "kept", reason: `${n} of ${total} ${read ? "slides" : "cards"} ${PROBLEM_WORDS[kind]}${leftOut(read)}`, cards: total, noteworthy: true };
  }
  // Cards that hold something with no words an item cannot hold: a few are fine, many are not.
  const failing = mapped.filter((m) => m.problems.length > 0);
  if (failing.length > total * 0.2) {
    const kinds = new Map<CardProblem["kind"], number>();
    for (const m of failing) for (const p of m.problems) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    const [kind] = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0];
    return { kind: "kept", reason: `${failing.length} of ${total} ${read ? "slides" : "cards"} ${PROBLEM_WORDS[kind]}, more than a fifth${leftOut(read)}`, cards: total, noteworthy: true };
  }
  // Some buttons and some bare links: an item with a link and no words of its own would be drawn with words nobody wrote.
  const linked = mapped.filter((m) => m.draft.link !== null);
  if (linked.some((m) => m.draft.buttonLabel !== "") && linked.some((m) => m.draft.buttonLabel === "")) {
    return { kind: "kept", reason: `${linked.filter((m) => m.draft.buttonLabel === "").length} of ${total} ${read ? "slides" : "cards"} are linked but have no button while others do${leftOut(read)}`, cards: total, noteworthy: true };
  }
  // Text beyond what an item shows (six lines at either width) would be hidden, not copied.
  const lines = linesIn(mapped.map((m) => m.draft), env);
  if (lines > MAX_LINES) return { kind: "kept", reason: `the ${read ? "slides" : "cards"}' text runs to ${lines} lines, and an item shows six${leftOut(read)}`, cards: total, noteworthy: true };

  const keep = mapped.slice(0, CUSTOM_ITEMS_MAX);
  // The builder checks every item again when the page is saved, and one it would not accept fails the whole copy: so each is checked here, and a group with
  // one the builder would refuse stays as columns, with the builder's own words.
  for (const [i, m] of keep.entries()) {
    const checked = customGridItemSchema.safeParse(itemOf(m.draft, i));
    if (!checked.success) return { kind: "kept", reason: `${read ? "slide" : "card"} ${i + 1} of ${total} holds something the builder would not accept in an item (${checked.error.issues[0]?.message ?? "an invalid field"})${leftOut(read)}`, cards: total, noteworthy: true };
  }
  const carousel = group.track === "scroller" ? readCarousel(group, env) : phoneScroller(group, env) ? readPhoneCarousel(group, env) : null;
  const simplified = new Map<string, number>();
  for (const m of keep) for (const what of m.draft.simplified) simplified.set(what, (simplified.get(what) ?? 0) + 1);
  return {
    kind: "grid",
    plan: {
      group,
      drafts: keep.map((m) => m.draft),
      cut: Math.max(0, total - keep.length),
      unread: read?.unread ?? 0,
      failed: failing.map((m) => {
        const node = group.cards.find((c) => c.p === m.draft.card)!;
        return { card: m.draft.card, sel: node.sel ?? node.tag, y: Math.round(node.box[1]), what: m.draft.unheld };
      }),
      simplified: [...simplified.entries()].map(([what, cards]) => ({ what, cards })),
      carousel,
      lines,
    },
  };
}

/** The most lines of description a card has at either width: its paragraphs' lines added up. */
function linesIn(drafts: ItemDraft[], env: Pick<GridEnv, "getD" | "getM">): number {
  let most = 0;
  for (const draft of drafts) {
    for (const get of [env.getD, env.getM]) {
      if (!get) continue;
      const sum = draft.paragraphs.reduce((n, leaf) => n + (get(leaf.p) ? linesOf(get(leaf.p)!) : 0), 0);
      most = Math.max(most, sum);
    }
  }
  return most;
}

// ---------------------------------------------------------------------------
// Carousels: the arrows, dots and snap a track has
// ---------------------------------------------------------------------------

const ARROW_CLASS = /(prev|previous|next|arrow|chevron|swiper-button|slick-(?:prev|next)|carousel-control|slider-(?:prev|next)|glide__arrow|splide__arrow|flickity-prev-next-button|owl-(?:prev|next)|scroll-(?:left|right))/i;
const ARROW_TEXT = /^(?:[\s‹›<>←→«»❮❯❰❱⟨⟩‹›⬅➡]+|prev(?:ious)?|next|forrige|neste|föregående|nästa|forrige|næste|back|forward)$/i;

/** Whether a node is a previous or next button: small, a button, by its class, its words or its arrow sign. */
export function arrowLike(n: CaptureNode): boolean {
  if (n.box[2] > 96 || n.box[3] > 96 || n.box[2] < 12 || n.box[3] < 12) return false;
  if (n.media?.kind === "control") return false;
  const sel = n.sel ?? "";
  const words = n.runs !== undefined ? wordsOf(n) : "";
  if (words !== "" && ARROW_TEXT.test(words)) return true;
  return (n.tag === "button" || n.tag === "a" || n.tag === "div" || n.tag === "span") && ARROW_CLASS.test(sel);
}

/** Whether a node is a row of dots: two or more small equal boxes with no words, side by side. */
export function dotsRowLike(n: CaptureNode): boolean {
  if (n.children.length < 2 || n.children.length > 24 || n.runs !== undefined) return false;
  const kids = n.children;
  if (!kids.every((k) => k.box[2] >= 4 && k.box[2] <= 40 && k.box[3] >= 4 && k.box[3] <= 40 && k.runs === undefined)) return false;
  const tops = kids.map((k) => k.box[1]);
  return Math.max(...tops) - Math.min(...tops) <= 4;
}

/** What a carousel draws around its track with no words of its own: previous and next buttons, dots. */
export const controlLike = (n: CaptureNode): boolean => arrowLike(n) || dotsRowLike(n);

/** Whether previous and next buttons stand near a track: outside its tiles, within a hand's width of the box it shows its slides through. */
function arrowsNear(root: CaptureNode, track: CaptureNode): boolean {
  // Buttons the browser found by their label, role or class beside a script slider.
  if ((controlsOf(track)?.arrows.length ?? 0) > 0) return true;
  const inCards = new Set<string>();
  for (const tile of track.children) for (const n of walk(tile)) inCards.add(n.p);
  const reach = 90;
  const [x, y, w, h] = boxOfTrack(track);
  let found = 0;
  for (const n of walk(root)) {
    if (inCards.has(n.p) || n.p === track.p) continue;
    if (!arrowLike(n)) continue;
    const cx = n.box[0] + n.box[2] / 2;
    const cy = n.box[1] + n.box[3] / 2;
    if (cx >= x - reach && cx <= x + w + reach && cy >= y - reach && cy <= y + h + reach) found += 1;
  }
  return found >= 1;
}

/**
 * Whether a row of small equal buttons stands near a track, as many as there are pages: its dots. A script slider's dots are often one to a
 * slide, or one to each place it can rest, so those counts are taken too (and the pagination the browser found by name counts as it is).
 */
function dotsNear(root: CaptureNode, track: CaptureNode, counts: number[]): boolean {
  const wanted = new Set(counts.filter((n) => n >= 2));
  if (wanted.size === 0) return false;
  const named = controlsOf(track)?.dots;
  if (named && wanted.has(named.count)) return true;
  const [x, y, w, h] = boxOfTrack(track);
  for (const n of walk(root)) {
    if (n.p === track.p || !wanted.has(n.children.length)) continue;
    const kids = n.children;
    const small = kids.every((k) => k.box[2] >= 4 && k.box[2] <= 40 && k.box[3] >= 4 && k.box[3] <= 40 && k.runs === undefined);
    if (!small) continue;
    const tops = kids.map((k) => k.box[1]);
    if (Math.max(...tops) - Math.min(...tops) > 4) continue;
    const cx = n.box[0] + n.box[2] / 2;
    const cy = n.box[1] + n.box[3] / 2;
    const inX = cx >= x - 40 && cx <= x + w + 40;
    const inY = cy >= y - 80 && cy <= y + h + 100;
    if (inX && inY) return true;
  }
  return false;
}

/** Slides on top of each other show one at a time. */
const isStack = (track: CaptureNode) => track.slider?.kind === "stack";

/** The tiles a track shows at once at one width, and how much of the next one shows; `box` is what clips the track. */
function visibleTiles(cards: CaptureNode[], box: Box): { whole: number; partial: number } {
  const left = box[0] - 2;
  const right = rightOf(box) + 2;
  let whole = 0;
  let partial = 0;
  for (const card of cards) {
    if (card.box[0] >= left && rightOf(card.box) <= right) whole += 1;
    else if (card.box[0] < right && rightOf(card.box) > right) partial = Math.max(partial, (right - 2 - card.box[0]) / Math.max(1, card.box[2]));
  }
  return { whole: Math.max(1, whole), partial };
}

/** The phone's own box for a grid that lies still at computers' width but scrolls sideways on phones: its row of tiles, more than fit. */
function phoneScroller(group: CardGroup, env: GridEnv): CaptureNode | null {
  if (group.track !== "static" || !env.getM) return null;
  const track = env.getM(group.parent.p);
  if (!track?.scroll || isStack(track)) return null;
  const cards = group.cards.map((c) => env.getM!(c.p)).filter((c): c is CaptureNode => Boolean(c));
  // A track may hold only the tiles near the screen (a page that draws the rest when they scroll in): three of eight is a row that goes on.
  if (cards.length < 3) return null;
  // All in one row, some of them beyond what the box shows.
  const tops = cards.map((c) => c.box[1]);
  if (Math.max(...tops) - Math.min(...tops) > 4) return null;
  return visibleTiles(cards, boxOfTrack(track)).whole < cards.length ? track : null;
}

/** What a phone's sideways row of a grid that is static on computers does: read from the phone's capture alone. */
function readPhoneCarousel(group: CardGroup, env: GridEnv): CarouselRead {
  const track = phoneScroller(group, env)!;
  const cards = group.cards.map((c) => env.getM!(c.p)).filter((c): c is CaptureNode => Boolean(c));
  const seen = visibleTiles(cards, boxOfTrack(track));
  const arrows = env.mobile ? arrowsNear(env.mobile.root, track) : false;
  const snaps = (track.s.scrollSnapType ?? "none") !== "none";
  const align = cards[0].s.scrollSnapAlign ?? "none";
  const snap: "start" | "center" | "none" = !snaps || align === "none" ? "none" : align === "center" ? "center" : "start";
  const peek = seen.partial >= 0.15 && seen.partial <= 0.65;
  const settings: CarouselSettings = { ...(arrows ? {} : { arrows: false }), ...(snap !== "start" ? { snap } : {}) };
  return {
    settings,
    perScreen: { desktop: group.rows[0].length, phone: seen.whole },
    phonesOnly: true,
    arrows,
    dots: false,
    snap,
    peek,
    clones: 0,
    autoplay: "not observed",
    rewind: false,
    script: null,
    watched: null,
  };
}

function readCarousel(group: CardGroup, env: GridEnv): CarouselRead {
  const track = env.getD(group.parent.p) ?? group.parent;
  const cards = group.cards;
  const stack = isStack(track) || isStack(group.parent);
  const d = stack ? { whole: 1, partial: 0 } : visibleTiles(cards, boxOfTrack(track));
  const phoneTrack = env.getM ? env.getM(group.parent.p) : null;
  const phoneCards = env.getM ? cards.map((c) => env.getM!(c.p)).filter((c): c is CaptureNode => Boolean(c)) : [];
  const phone = phoneTrack && phoneCards.length > 0 ? (stack ? { whole: 1, partial: 0 } : visibleTiles(phoneCards, boxOfTrack(phoneTrack))) : null;
  const first = cards[0];
  const midWidth = median(cards.map((c) => c.box[2]));
  const gaps = cards.slice(1).map((c, i) => c.box[0] - rightOf(cards[i].box));
  const pitch = midWidth + (gaps.length > 0 && !stack ? median(gaps) : 0);
  const perScreen = stack ? 1 : tilesPerScreen({ width: boxOfTrack(track)[2], tiles: cards.length, tileWidth: midWidth, pitch });
  const pages = pageCount(cards.length, perScreen);
  const arrows = arrowsNear(env.desktop.root, track);
  const script = Boolean(group.slider);
  const dots = pages >= 2 && dotsNear(env.desktop.root, track, script ? [pages, cards.length, cards.length - perScreen + 1] : [pages]);
  // A script slider rests on its slides: the start of one. A native scroller says what it snaps to.
  const snaps = script || (track.s.scrollSnapType ?? "none") !== "none";
  const align = script ? "start" : (first.s.scrollSnapAlign ?? "none");
  const snap: "start" | "center" | "none" = !snaps || align === "none" ? "none" : align === "center" ? "center" : "start";
  const peek = d.partial >= 0.15 && d.partial <= 0.65;
  const rewind = Boolean(group.slider?.loop);
  // Autoplay is only ever what the watch saw: a track that moved by itself with nobody touching the page.
  const watch = track.watch ?? group.parent.watch;
  // A slider that fades (or swaps) its slides in one place has an effect the copy replaces with scrolling: its autoplay is not carried over with it, and the report says so.
  const autoplay: CarouselRead["autoplay"] = watch?.observed && !stack ? { seconds: watch.seconds } : "not observed";
  const settings: CarouselSettings = {
    ...(arrows ? {} : { arrows: false }),
    ...(dots ? { dots: true } : {}),
    ...(snap !== "start" ? { snap } : {}),
    ...(rewind ? { rewind: true } : {}),
    ...(autoplay !== "not observed" ? { autoplay } : {}),
  };
  const read = group.slider;
  return {
    settings,
    perScreen: { desktop: d.whole, phone: phone ? phone.whole : null },
    arrows,
    dots,
    snap,
    peek,
    clones: read ? read.clones.markers + read.clones.keys + read.clones.hashes : 0,
    autoplay,
    rewind,
    script: read && track.slider ? { kind: track.slider.kind, hints: track.slider.hints, hidden: read.hidden, hiddenWords: read.hiddenWords, clonesBy: read.clones, order: read.order } : null,
    watched: watch
      ? { ms: watch.watchedMs, moves: watch.observed ? watch.moves : 0, basis: watch.observed ? watch.basis : null, ...(!watch.observed && watch.why ? { why: watch.why } : watch.observed && stack ? { why: "it moved by itself, but its slides fade or swap in one place and the copy scrolls them, so its autoplay is not carried over" } : {}) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// The look of the grid, read from what was measured
// ---------------------------------------------------------------------------

export type GridStyle = {
  /** The block's own settings, to merge into a `ContentGridBlock`. */
  block: Pick<ContentGridBlock, "columns" | "gap" | "show" | "headingLevel" | "excerptLines" | "buttonLabel" | "emptyText"> &
    Partial<Pick<ContentGridBlock, "tile" | "imageShape" | "headingSize" | "button" | "display" | "carouselOn" | "peek" | "carousel" | "font" | "headingFont">>;
  /** Rules for the grid part, by suffix (the places the grid draws), for computers and phones. */
  rules: { suffix: string; desktop: Decl; mobile: Decl }[];
  notes: string[];
};

export type StyleEnv = {
  typeDecl: (n: CaptureNode) => Decl;
  fontOf: (n: CaptureNode) => { native?: string; css?: string };
  paintsBox: (n: CaptureNode) => boolean;
  borderOf: (n: CaptureNode, side: "Top" | "Right" | "Bottom" | "Left") => number;
};

/** The cards of a plan at one width, those the capture has. */
const at = (cards: CaptureNode[], get: ((path: string) => CaptureNode | null | undefined) | null) => (get ? cards.map((c) => get(c.p)).filter((c): c is CaptureNode => Boolean(c)) : []);

/** Cards in the first row of those given. */
function firstRow(cards: CaptureNode[]): number {
  if (cards.length === 0) return 0;
  const sorted = [...cards].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const limit = Math.min(...sorted.map((c) => c.box[3])) * 0.5;
  return sorted.filter((c) => Math.abs(c.box[1] - sorted[0].box[1]) <= limit).length;
}

const SHAPE_RATIOS: [Exclude<ImageShape, "circle">, number][] = [["landscape", 4 / 3], ["portrait", 3 / 4], ["panorama", 3], ["square", 1]];

/** The shape the pictures have, when they are all alike; `original` when they vary. */
function imageShapeOf(pictures: CaptureNode[]): { shape: ImageShape | "original"; ratio: number | null } {
  if (pictures.length === 0) return { shape: "original", ratio: null };
  const ratios = pictures.map((p) => p.box[2] / Math.max(1, p.box[3]));
  const mid = median(ratios);
  if (!ratios.every((r) => within(r, mid, 0.06))) return { shape: "original", ratio: null };
  const round = pictures.every((p) => {
    const radius = px((p.s.borderTopLeftRadius ?? "0px").split(" ")[0]) ?? 0;
    return radius >= Math.min(p.box[2], p.box[3]) * 0.45;
  });
  if (round && within(mid, 1, 0.06)) return { shape: "circle", ratio: 1 };
  const nearest = [...SHAPE_RATIOS].sort((a, b) => Math.abs(Math.log(a[1] / mid)) - Math.abs(Math.log(b[1] / mid)))[0];
  return within(mid, nearest[1], 0.06) ? { shape: nearest[0], ratio: mid } : { shape: "original", ratio: mid };
}

const headingSizeOf = (size: number): HeadingSize => (size <= 20 ? "sm" : size <= 26 ? "md" : size <= 34 ? "lg" : size <= 44 ? "xl" : "2xl");

function shadowOf(value: string | undefined): Shadow | null {
  if (!value || value === "none") return null;
  const blur = Number(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/.exec(value)?.[3] ?? NaN);
  if (!Number.isFinite(blur)) return "sm";
  return blur <= 4 ? "sm" : blur <= 14 ? "md" : blur <= 36 ? "lg" : "xl";
}

/** The box that paints the card: the card itself, or the one box in a chain of wrappers that fills it. */
function paintedBoxOf(card: CaptureNode, paintsBox: StyleEnv["paintsBox"]): CaptureNode | null {
  let current: CaptureNode = card;
  for (let guard = 0; guard < 6; guard++) {
    if (paintsBox(current)) return current;
    if (current.children.length !== 1) return null;
    const next = current.children[0];
    if (Math.abs(next.box[2] - current.box[2]) > 2 || Math.abs(next.box[3] - current.box[3]) > 2) return null;
    current = next;
  }
  return null;
}

const decl = (n: number) => `${round1(n)}px`;

/** The nodes from `from` (excluded) down to `to` (excluded), outermost first; null when `to` is not inside `from`. */
function between(from: CaptureNode, to: CaptureNode): CaptureNode[] | null {
  for (const child of from.children) {
    if (child === to) return [];
    const inner = between(child, to);
    if (inner) return [child, ...inner];
  }
  return null;
}

/**
 * The box a card's picture sits in when it does not fill it: the outermost box inside the card that spans the card's width and holds the picture with room round it
 * (lampan.no: a 313 x 375 panel holding a 190 x 285 product photo). The copy draws it as the picture's own box, with padding, so the words below start where they did.
 */
export function pictureFrameOf(card: CaptureNode, picture: CaptureNode): CaptureNode | null {
  const chain = between(card, picture);
  if (!chain) return null;
  const holds = (n: CaptureNode) => n.box[0] <= picture.box[0] + 1 && rightOf(n.box) >= rightOf(picture.box) - 1 && n.box[1] <= picture.box[1] + 1 && bottomOf(n.box) >= bottomOf(picture.box) - 1;
  // The panel holds the picture and what lies over it (a badge placed absolutely), not the card's words: the outermost box with only that in it.
  const onlyOverlays = (n: CaptureNode, over: boolean): boolean => (n.runs !== undefined ? over : n.children.every((c) => onlyOverlays(c, over || c.s.position === "absolute")));
  const frame = chain.find((n) => holds(n) && n.box[2] >= card.box[2] * 0.85 && (n.box[3] > picture.box[3] * 1.08 || n.box[2] > picture.box[2] * 1.08) && n.box[3] < card.box[3] * 0.98 && onlyOverlays(n, n.s.position === "absolute"));
  if (!frame) return null;
  // The room must be real on at least one axis, and the picture roughly centred across: a picture hugging one side is the card's picture, not framed.
  const left = picture.box[0] - frame.box[0];
  const right = rightOf(frame.box) - rightOf(picture.box);
  const roomy = frame.box[2] - picture.box[2] > 8 || frame.box[3] - picture.box[3] > 8;
  return roomy && Math.abs(left - right) <= Math.max(4, frame.box[2] * 0.04) ? frame : null;
}

export function styleGrid(plan: GridPlan, env: GridEnv, style: StyleEnv): GridStyle {
  const { group, drafts } = plan;
  const notes: string[] = [];
  const cardsD = group.cards;
  const cardsM = at(cardsD, env.getM);
  const first = drafts[0];
  const rules: GridStyle["rules"] = [];
  const rule = (suffix: string, desktop: Decl, mobile: Decl = {}) => {
    if (Object.keys(desktop).length === 0 && Object.keys(mobile).length === 0) return;
    rules.push({ suffix, desktop, mobile });
  };
  const exemplar = <K extends keyof ItemDraft["nodes"]>(key: K): CaptureNode | undefined => drafts.find((d) => d.nodes[key])?.nodes[key];
  const phoneOf = (n: CaptureNode | undefined) => (n && env.getM ? (env.getM(n.p) ?? undefined) : undefined);

  // Columns: the cards in a row at each width. A track's are the tiles in view.
  const track = group.track === "scroller";
  const phonesOnly = plan.carousel?.phonesOnly === true;
  const trackD = track ? (env.getD(group.parent.p) ?? group.parent) : null;
  const trackM = (track || phonesOnly) && env.getM ? env.getM(group.parent.p) : null;
  // Slides on top of each other show one at a time, whatever the box's width.
  const oneAtATime = isStack(group.parent) || (trackD !== null && isStack(trackD));
  const desktopCols = oneAtATime ? 1 : track ? visibleTiles(cardsD, boxOfTrack(trackD!)).whole : group.rows[0].length;
  const mobileMeasured = oneAtATime ? (cardsM.length > 0 ? 1 : null) : track || phonesOnly ? (trackM && cardsM.length > 0 ? visibleTiles(cardsM, boxOfTrack(trackM)).whole : null) : cardsM.length > 0 ? firstRow(cardsM) : null;
  const desktop = Math.min(GRID_COLUMNS_MAX.desktop, Math.max(1, desktopCols));
  if (desktopCols > GRID_COLUMNS_MAX.desktop) notes.push(`${desktopCols} to a row at computers' width, wrapped at the builder's most (${GRID_COLUMNS_MAX.desktop})`);
  const mobile = Math.min(GRID_COLUMNS_MAX.mobile, Math.max(1, mobileMeasured ?? 1));
  if (mobileMeasured !== null && mobileMeasured > GRID_COLUMNS_MAX.mobile) notes.push(`${mobileMeasured} to a row at phones' width, shown ${GRID_COLUMNS_MAX.mobile} to a row, the builder's most`);
  if (mobileMeasured === null) notes.push("no phone capture, so phones show one card to a row");
  // Tablets are not captured: between the two, never fewer than phones show.
  const tablet = Math.min(GRID_COLUMNS_MAX.tablet, Math.max(mobile, desktop <= 3 ? Math.min(desktop, 2) : Math.round(desktop / 2)));
  const columns: GridColumns = { mobile, tablet, desktop };
  notes.push("tablets' columns are estimated, as only computers' and phones' widths are captured");

  // The gap between cards.
  const gapsH: number[] = [];
  for (const row of group.rows) for (let i = 1; i < row.length; i++) gapsH.push(row[i].box[0] - rightOf(row[i - 1].box));
  const gapsV: number[] = [];
  for (let i = 1; i < group.rows.length; i++) gapsV.push(group.rows[i][0].box[1] - Math.max(...group.rows[i - 1].map((c) => bottomOf(c.box))));
  const gap = oneAtATime ? 0 : Math.min(GRID_GAP_MAX, Math.max(0, Math.round(gapsH.length > 0 ? median(gapsH) : gapsV.length > 0 ? median(gapsV) : 16)));
  const phoneGaps = oneAtATime ? [] : cardsM.slice(1).map((c, i) => (Math.abs(c.box[1] - cardsM[i].box[1]) < 8 ? c.box[0] - rightOf(cardsM[i].box) : c.box[1] - bottomOf(cardsM[i].box)));
  if (phoneGaps.length > 0 && Math.abs(median(phoneGaps) - gap) > 4) notes.push(`the gap between cards is ${gap}px at computers' width and about ${Math.round(median(phoneGaps))}px at phones'; one gap is kept`);

  // The tile: the box that paints a card.
  const boxes = cardsD.map((c) => paintedBoxOf(c, style.paintsBox));
  const painted = boxes[0];
  // A picture inside a panel of its own (a photo centred in a taller box): the panel is the picture's room.
  const frames = drafts.map((d, i) => (d.picture?.leaf.media ? pictureFrameOf(cardsD[i], d.picture.leaf) : null));
  const framed = frames.filter((f) => f !== null).length > drafts.length / 2;
  const tile: GridTile = {};
  const tileRules: Decl = {};
  const frame = painted ?? cardsD[0];
  if (painted) {
    const colour = cssColour(painted.s.backgroundColor);
    const opaque = hexOf(painted.s.backgroundColor);
    if (colour && opaque && (cssColour(painted.s.backgroundColor) ?? "").startsWith("rgb(")) tile.background = opaque;
    else if (colour) tileRules["background-color"] = colour;
    const widths = (["Top", "Right", "Bottom", "Left"] as const).map((side) => style.borderOf(painted, side));
    if (widths.some((w) => w > 0)) {
      const line = painted.s.borderTopStyle;
      tile.border = {
        width: { top: Math.min(20, Math.round(widths[0])), right: Math.min(20, Math.round(widths[1])), bottom: Math.min(20, Math.round(widths[2])), left: Math.min(20, Math.round(widths[3])) },
        color: hexOf(painted.s.borderTopColor) ?? hexOf(painted.s.borderLeftColor) ?? "#cccccc",
        style: line === "dashed" ? "dashed" : line === "dotted" ? "dotted" : "solid",
      } satisfies Border;
    }
    const radius = Math.round(px((painted.s.borderTopLeftRadius ?? "0px").split(" ")[0]) ?? 0);
    if (radius > 0) tile.radius = Math.min(RADIUS_MAX, radius);
    const shadow = shadowOf(painted.s.boxShadow);
    if (shadow) tile.shadow = shadow;
  }

  // The room inside a card: from the painted box (or the card) to its words and pictures.
  const sample = drafts.find((d) => d.nodes.title || d.nodes.text || d.picture) ?? first;
  const sampleCard = cardsD.find((c) => c.p === sample.card)!;
  const sampleLeaves = group.leaves[cardsD.indexOf(sampleCard)].filter((l) => kindOf(l) !== "S");
  const borderLeft = painted ? style.borderOf(painted, "Left") : 0;
  const borderRight = painted ? style.borderOf(painted, "Right") : 0;
  // The room each card leaves round its pieces; the least over the cards, so a card stretched to its row's height adds none of its own.
  const rooms = drafts.flatMap((d, i) => {
    const box = boxes[i] ?? cardsD[i];
    const leaves = group.leaves[i].filter((l) => kindOf(l) !== "S");
    if (leaves.length === 0) return [];
    const top = box.box[1] + (painted ? style.borderOf(box, "Top") : 0);
    const bottom = bottomOf(box.box) - (painted ? style.borderOf(box, "Bottom") : 0);
    const left = box.box[0] + (painted ? style.borderOf(box, "Left") : 0);
    const right = rightOf(box.box) - (painted ? style.borderOf(box, "Right") : 0);
    const picture = d.picture?.leaf ?? null;
    const frameNode = framed ? frames[i] : null;
    const boxOf = (l: CaptureNode): Box => (l === picture && frameNode ? frameNode.box : l.box);
    const others = leaves.filter((l) => l !== picture);
    const runs = Boolean(picture) && others.length > 0 && Math.abs(boxOf(picture!)[0] - left) <= 2 && Math.abs(rightOf(boxOf(picture!)) - right) <= 2;
    const side = runs ? others : leaves;
    return [
      {
        flush: runs,
        top: Math.max(0, Math.min(...leaves.map((l) => boxOf(l)[1])) - top),
        bottom: Math.max(0, bottom - Math.max(...leaves.map((l) => bottomOf(boxOf(l))))),
        left: Math.max(0, Math.min(...side.map((l) => l.box[0])) - left),
        right: Math.max(0, right - Math.max(...side.map((l) => rightOf(l.box)))),
      },
    ];
  });
  const flush = rooms.filter((r) => r.flush).length > rooms.length / 2;
  const alike = rooms.filter((r) => r.flush === flush);
  const least = (key: "top" | "bottom" | "left" | "right") => (alike.length > 0 ? Math.min(...alike.map((r) => r[key])) : 0);
  const pic = sample.picture?.leaf ?? null;
  const texts = sampleLeaves.filter((l) => l !== pic);
  // A painted box that says its padding says it exactly; otherwise it is read off where the pieces stand.
  const own = painted && !flush ? [px(painted.s.paddingTop) ?? 0, px(painted.s.paddingRight) ?? 0, px(painted.s.paddingBottom) ?? 0, px(painted.s.paddingLeft) ?? 0] : null;
  const [padTop, padRight, padBottom, padLeft] = own && own.some((v) => v > 0) ? own : [least("top"), least("right"), least("bottom"), least("left")];
  const li = " li[data-item-id]";
  if (flush) {
    // A picture to the card's edges with the words inset: no padding on the tile, the words carry the inset.
    const inset = texts.length > 0 ? Math.round(Math.min(padLeft, padRight > 0 ? padRight : padLeft)) : 0;
    tileRules["padding-top"] = "0px";
    tileRules["padding-left"] = "0px";
    tileRules["padding-right"] = "0px";
    tileRules["padding-bottom"] = decl(padBottom);
    rule(`${li} > *`, { "margin-left": decl(inset), "margin-right": decl(inset) });
    rule(`${li} > :first-child`, { "margin-left": "0px", "margin-right": "0px" });
    notes.push("a picture runs to the card's edges while the words are inset, drawn with margins on the words");
  } else {
    const pads = [padTop, padRight, padBottom, padLeft];
    if (Math.max(...pads) - Math.min(...pads) <= 3) {
      const pad = Math.round(median(pads));
      if (pad > 0) tile.padding = Math.min(240, pad);
    } else {
      tileRules["padding-top"] = decl(padTop);
      tileRules["padding-right"] = decl(padRight);
      tileRules["padding-bottom"] = decl(padBottom);
      tileRules["padding-left"] = decl(padLeft);
    }
  }

  // The space between the pieces of a card, and how its words are aligned.
  const stacked = sampleLeaves.slice(1).map((l, i) => l.box[1] - bottomOf(sampleLeaves[i].box)).filter((g) => g >= 0 && g < 120);
  // Where each piece of the sample card stands, in the order the original had them: the tile is a column, so each piece gets its order and the space above it.
  const flowAt = (card: CaptureNode, nodeFor: (n: CaptureNode) => CaptureNode | undefined | null) => {
    const parts: { key: string; sel: string; dom: number; top: number; bottom: number; extra: number }[] = [];
    const add = (key: string, sel: string, dom: number, node: CaptureNode | undefined | null, extra = 0) => {
      const n = node ? nodeFor(node) : null;
      if (n) parts.push({ key, sel, dom, top: n.box[1], bottom: bottomOf(n.box), extra });
    };
    const pic = sample.picture ? nodeFor(sample.picture.leaf) : null;
    if (pic) {
      const room = pic.media ? (pictureFrameOf(card, pic) ?? pic) : pic;
      parts.push({ key: "picture", sel: `${li} > :first-child`, dom: 0, top: room.box[1], bottom: bottomOf(room.box), extra: 0 });
    }
    add("title", `${li} > :is(h2,h3,h4,h5,h6)`, 2, sample.nodes.title);
    add("detail", `${li} > ul.text-muted`, 3, sample.nodes.detail);
    add("date", `${li} > time`, 4, sample.nodes.date);
    add("text", `${li} > p.text-muted`, 5, sample.nodes.text);
    add("price", `${li} > p.font-medium`, 6, sample.nodes.price);
    add("button", `${li} > .mt-auto`, 7, sample.nodes.button, 4);
    return parts.sort((a, b) => a.top - b.top || a.dom - b.dom);
  };
  const flowD = flowAt(sampleCard, (n) => n);
  const reordered = flowD.some((part, i) => i > 0 && part.dom < flowD[i - 1].dom);
  const useFlow = (framed || reordered) && flowD.length >= 2;
  if (useFlow) tileRules["row-gap"] = "0px";
  else if (stacked.length > 0) tileRules["row-gap"] = decl(median(stacked));
  const titleNode = exemplar("title");
  const textNode = exemplar("text");
  const alignOf = (n: CaptureNode | undefined) => (n ? (n.s.textAlign === "center" ? "center" : n.s.textAlign === "right" || n.s.textAlign === "end" ? "right" : "left") : null);
  const align = alignOf(titleNode) ?? alignOf(textNode);
  if (align && align !== "left") tileRules["text-align"] = align;
  const phoneAlign = alignOf(phoneOf(titleNode)) ?? alignOf(phoneOf(textNode));
  // A carousel's tiles at the width the phone drew them: the track's columns and peek only approximate it (lampan.no: 144 px tiles, two and a half in view).
  const phoneTileWidth = plan.carousel && cardsM.length > 0 ? median(cardsM.map((c) => c.box[2])) : 0;
  rule(li, tileRules, { ...(phoneAlign && phoneAlign !== align ? { "text-align": phoneAlign } : {}), ...(phoneTileWidth > 0 && plan.carousel?.phonesOnly ? { "flex-basis": decl(phoneTileWidth), "flex-grow": "0", "flex-shrink": "0" } : {}) });
  if (useFlow) {
    const cardM = env.getM ? env.getM(sampleCard.p) : null;
    const flowM = cardM ? flowAt(cardM, (n) => (env.getM ? env.getM(n.p) : null)) : [];
    const spaces = (parts: typeof flowD, cardNode: CaptureNode): Map<string, { order: number; margin: number }> => {
      const out = new Map<string, { order: number; margin: number }>();
      let edge = cardNode.box[1] + (painted ? style.borderOf(painted, "Top") : 0) + (flush ? 0 : padTop);
      parts.forEach((part, i) => {
        out.set(part.sel, { order: i, margin: Math.max(0, Math.round((part.top - edge - part.extra) * 10) / 10) });
        edge = Math.max(edge, part.bottom);
      });
      return out;
    };
    const desktopSpace = spaces(flowD, sampleCard);
    const phoneSpace = flowM.length === flowD.length && cardM ? spaces(flowM, cardM) : null;
    const inDomOrder = !reordered;
    for (const part of flowD) {
      const d = desktopSpace.get(part.sel)!;
      const m = phoneSpace?.get(part.sel);
      rule(part.sel, { ...(inDomOrder ? {} : { order: String(d.order) }), "margin-top": decl(d.margin) }, m ? { "margin-top": decl(m.margin) } : {});
    }
  }

  // Pictures: they fill the tile's width at the shape they have, as every copied picture is told to.
  const pictureLeaves = drafts.flatMap((d) => (d.picture ? [d.picture.leaf] : []));
  const shaped = imageShapeOf(pictureLeaves);
  const ratioOf = (r: number) => `${Math.round(r * 1000) / 1000} / 1`;
  if (pictureLeaves.length > 0) {
    // A picture that fills the card's room is told to; a smaller one (an icon, a logo) keeps its own width and its place across the card.
    const room = (frameWidth: number) => Math.max(1, frameWidth - (flush ? 0 : padLeft + padRight) - borderLeft - borderRight);
    const rule1 = (pics: CaptureNode[], frameWidth: number, frameLeft: number): Decl => {
      const width = median(pics.map((p) => p.box[2]));
      const out: Decl = { "object-fit": pics[0].s.objectFit && pics[0].s.objectFit !== "fill" ? pics[0].s.objectFit : "cover", "border-radius": (pics[0].s.borderTopLeftRadius ?? "0px").split(" ")[0], "background-color": "transparent" };
      const ratio = median(pics.map((p) => p.box[2] / Math.max(1, p.box[3])));
      const alike = pics.every((p) => within(p.box[2] / Math.max(1, p.box[3]), ratio, 0.06));
      const available = room(frameWidth);
      if (width >= available * 0.9) Object.assign(out, { width: "100%", height: "auto", "margin-left": "0px", "margin-right": "0px" });
      else {
        const left = pics[0].box[0] - (frameLeft + borderLeft + (flush ? 0 : padLeft));
        const right = frameLeft + frameWidth - borderRight - (flush ? 0 : padRight) - rightOf(pics[0].box);
        Object.assign(out, alike ? { width: decl(width), height: "auto" } : { width: "auto", "max-width": "100%", height: "auto" });
        if (left > 3 && Math.abs(left - right) <= 3) Object.assign(out, { "margin-left": "auto", "margin-right": "auto" });
        else if (left > 3 && right <= 3) Object.assign(out, { "margin-left": "auto", "margin-right": "0px" });
        else Object.assign(out, { "margin-left": left > 3 ? decl(left) : "0px", "margin-right": "0px" });
      }
      if (alike) out["aspect-ratio"] = ratioOf(ratio);
      return out;
    };
    const desktopPictures = pictureLeaves;
    const phonePictures = at(pictureLeaves, env.getM);
    const phoneFrame = env.getM ? env.getM(frame.p) : null;
    // A picture centred in a panel taller than it: the picture is the panel (its width, the panel's shape), with the room as padding in percent of the width.
    const panelRule = (pic: CaptureNode, panel: CaptureNode): Decl => {
      const w = Math.max(1, panel.box[2]);
      const pct = (v: number) => `${round1(Math.max(0, v) / w * 100)}%`;
      const corner = (panel.s.borderTopLeftRadius ?? pic.s.borderTopLeftRadius ?? "0px").split(" ")[0];
      return {
        width: "100%",
        height: "auto",
        "margin-left": "0px",
        "margin-right": "0px",
        "aspect-ratio": `${round1(panel.box[2] * 10) / 10} / ${round1(panel.box[3] * 10) / 10}`,
        // As the original drew it into its box: stretched to fill unless it said otherwise.
        "object-fit": pic.s.objectFit && /^(contain|cover|scale-down|none)$/.test(pic.s.objectFit) ? pic.s.objectFit : "fill",
        "background-color": "transparent",
        "padding-top": pct(pic.box[1] - panel.box[1]),
        "padding-right": pct(rightOf(panel.box) - rightOf(pic.box)),
        "padding-bottom": pct(bottomOf(panel.box) - bottomOf(pic.box)),
        "padding-left": pct(pic.box[0] - panel.box[0]),
        "border-radius": corner,
      };
    };
    const samplePic = sample.picture?.leaf ?? null;
    const samplePanel = framed && samplePic ? pictureFrameOf(sampleCard, samplePic) : null;
    if (samplePic && samplePanel) {
      const cardM = env.getM ? env.getM(sampleCard.p) : null;
      const picM = env.getM ? env.getM(samplePic.p) : null;
      const panelM = cardM && picM?.media ? pictureFrameOf(cardM, picM) : null;
      rule(`${li} img`, panelRule(samplePic, samplePanel), picM && panelM ? panelRule(picM, panelM) : {});
      notes.push("each picture sits in a panel taller than it, drawn as the picture's own box with padding");
    } else rule(`${li} img`, rule1(desktopPictures, frame.box[2], frame.box[0]), phonePictures.length > 0 && phoneFrame ? rule1(phonePictures, phoneFrame.box[2], phoneFrame.box[0]) : {});
    if (shaped.shape === "original" && shaped.ratio === null) notes.push("the pictures differ in shape, so each is drawn at its own");
  }

  // Type: the first card's pieces, as the rest are built the same way.
  const fonts: { native?: string; css?: string } = textNode ? style.fontOf(textNode) : {};
  const headFonts: { native?: string; css?: string } = titleNode ? style.fontOf(titleNode) : {};
  const typed = (n: CaptureNode | undefined, family: { native?: string; css?: string }): [Decl, Decl] => {
    if (!n) return [{}, {}];
    const phone = phoneOf(n);
    const withFamily = (d: Decl) => (family.css ? { ...d, "font-family": family.css } : d);
    return [withFamily(style.typeDecl(n)), phone ? withFamily(style.typeDecl(phone)) : {}];
  };
  const [titleD, titleM] = typed(titleNode, headFonts);
  rule(`${li} :is(h2,h3,h4,h5,h6)`, titleD, titleM);
  const [textD, textM] = typed(textNode, fonts);
  rule(`${li} p.text-muted`, textD, textM);
  const priceNode = exemplar("price");
  const [priceD, priceM] = typed(priceNode, fonts);
  rule(`${li} p.font-medium`, priceD, priceM);
  const dateNode = exemplar("date");
  const [dateD, dateM] = typed(dateNode, fonts);
  rule(`${li} time`, dateD, dateM);
  const detailNode = exemplar("detail");
  const [detailD, detailM] = typed(detailNode, fonts);
  rule(`${li} ul.text-muted`, detailD, detailM);
  const badgeNode = exemplar("badge");
  /** The picture's panel in a card (its frame, else the picture), at the width the card is read at. */
  const panelIn = (card: CaptureNode, pic: CaptureNode | null | undefined): CaptureNode | null => (pic ? (pic.media ? (pictureFrameOf(card, pic) ?? pic) : pic) : null);
  /** Where a badge stands against the picture's panel, as offsets of the box the tile draws it in (the picture's): from the edge it is nearer, past the panel when it is not on it. */
  const placeBadge = (badge: CaptureNode, panel: CaptureNode): Decl => {
    const [x, y, w, h] = badge.box;
    const [px0, py0, pw, ph] = panel.box;
    const insideY = y >= py0 - 2 && y + h <= py0 + ph + 2;
    const insideX = x >= px0 - 2 && x + w <= px0 + pw + 2;
    const bottom = insideY && y + h / 2 > py0 + ph / 2;
    const right = insideX && x + w / 2 > px0 + pw / 2;
    return {
      position: "absolute",
      ...(bottom ? { top: "auto", bottom: decl(py0 + ph - (y + h)) } : { top: decl(y - py0), bottom: "auto" }),
      ...(right ? { left: "auto", right: decl(px0 + pw - (x + w)) } : { left: decl(x - px0), right: "auto" }),
    };
  };
  if (badgeNode) {
    const [badgeD, badgeM] = typed(badgeNode, fonts);
    const paint: Decl = {};
    const bg = cssColour(badgeNode.s.backgroundColor);
    if (bg) paint["background-color"] = bg;
    paint["border-radius"] = (badgeNode.s.borderTopLeftRadius ?? "0px").split(" ")[0];
    // The tile draws a badge over the picture, from its top left corner: it is placed where the original had it, at each width.
    const panelD = panelIn(sampleCard, sample.picture?.leaf);
    const cardM = env.getM ? env.getM(sampleCard.p) : null;
    const badgeOnPhone = phoneOf(badgeNode);
    const panelM = cardM ? panelIn(cardM, phoneOf(sample.picture?.leaf)) : null;
    const placeD = panelD ? placeBadge(badgeNode, panelD) : {};
    const placeM = panelM && badgeOnPhone ? placeBadge(badgeOnPhone, panelM) : {};
    rule(`${li} span.bg-accent`, { ...badgeD, ...paint, ...placeD }, { ...badgeM, ...placeM });
  }

  // The button: its look, and its type and room.
  const buttonNode = exemplar("button");
  let button: GridStyle["block"]["button"];
  if (buttonNode) {
    const filled = paints(buttonNode.s.backgroundColor);
    const outlined = !filled && (["Top", "Right", "Bottom", "Left"] as const).some((side) => style.borderOf(buttonNode, side) > 0);
    const variant: ButtonVariant = filled ? "filled" : outlined ? "outline" : "text";
    const radius = px((buttonNode.s.borderTopLeftRadius ?? "0px").split(" ")[0]) ?? 0;
    const shape: ButtonShape = radius >= buttonNode.box[3] / 2 - 1 ? "pill" : radius <= 2 ? "square" : "rounded";
    const size: ButtonSize = buttonNode.box[3] < 36 ? "sm" : buttonNode.box[3] <= 48 ? "md" : "lg";
    button = { variant, size, shape, ...(filled && hexOf(buttonNode.s.backgroundColor) ? { fill: hexOf(buttonNode.s.backgroundColor)! } : {}), ...(hexOf(buttonNode.s.color) ? { textColor: hexOf(buttonNode.s.color)! } : {}) };
    const [buttonD, buttonM] = typed(buttonNode, fonts);
    const keep = (d: Decl): Decl => Object.fromEntries(Object.entries(d).filter(([k]) => ["font-size", "font-weight", "letter-spacing", "text-transform", "line-height", "font-family"].includes(k)));
    rule(`${li} .mt-auto a`, keep(buttonD), keep(buttonM));
  }

  const show: ContentGridBlock["show"] = {
    image: drafts.some((d) => d.picture !== null),
    heading: drafts.some((d) => d.title !== ""),
    excerpt: drafts.some((d) => d.text !== ""),
    price: drafts.some((d) => d.priceText !== ""),
    button: drafts.some((d) => d.link !== null && d.buttonLabel !== ""),
  };
  const titleTag = titleNode ? /^h([1-6])$/.exec(titleNode.tag) : null;
  const headingLevel = (titleTag ? Math.max(2, Number(titleTag[1])) : 3) as ContentGridBlock["headingLevel"];

  const block: GridStyle["block"] = {
    columns,
    gap,
    show,
    headingLevel,
    // One line of room beyond what was measured (up to the most an item shows): a wider face in the copy would otherwise cut the last words of a text that the data holds.
    excerptLines: Math.min(MAX_LINES, Math.max(1, plan.lines + 1)),
    buttonLabel: "",
    emptyText: "",
    ...(Object.keys(tile).length > 0 ? { tile } : {}),
    imageShape: shaped.shape,
    ...(titleNode ? { headingSize: headingSizeOf(sizeOf(titleNode)) } : {}),
    ...(button ? { button } : {}),
    ...(fonts.native ? { font: fonts.native } : {}),
    ...(headFonts.native ? { headingFont: headFonts.native } : {}),
    ...(plan.carousel ? { display: "carousel" as const, ...(plan.carousel.phonesOnly ? { carouselOn: "phones" as const } : {}), ...(plan.carousel.peek ? { peek: true } : {}), ...(Object.keys(plan.carousel.settings).length > 0 ? { carousel: plan.carousel.settings } : {}) } : {}),
  };
  return { block, rules, notes };
}

// ---------------------------------------------------------------------------
// The report's facts
// ---------------------------------------------------------------------------

export type GridBuilt = {
  path: string;
  sel: string;
  y: number;
  cards: number;
  items: number;
  /** Cards beyond the most an item list holds: left out, and counted. */
  cut: number;
  /** Slides of a script slider that were never read (past the most the browser reads of a track): left out, and counted. */
  unread?: number;
  fields: { pictures: number; titles: number; texts: number; links: number; buttons: number; badges: number; prices: number; dates: number; details: number };
  carousel: {
    arrows: boolean;
    dots: boolean;
    snap: string;
    perScreen: { desktop: number; phone: number | null };
    /** A carousel on phones only; computers show a grid with `perScreen.desktop` to a row. */
    phonesOnly?: true;
    autoplay: string;
    clones: number;
    /** Going round from the last tile to the first (a slider that had copies). */
    rewind?: boolean;
    /** What was read of a script slider (D155, C2); absent for a native scroller. */
    script?: NonNullable<CarouselRead["script"]>;
    /** How long the track was watched for autoplay, and what it did; absent when it was not watched. */
    watched?: NonNullable<CarouselRead["watched"]>;
  } | null;
  columns: GridColumns;
  /** Cards that hold something an item does not, with what, and no words lost. */
  failed: { sel: string; y: number; what: string[] }[];
  notes: string[];
  /** What the cards' words had that an item's plain text does not keep (bold, italic, a line break), by how many cards: the words are kept, the marks are not. */
  simplified?: { what: string; cards: number }[];
  /** The last pass named this grid among its weakest stretches under 60 %, and columns were not tried or did not do better: the grid stays and is said to be weak. */
  weak?: { match: number; pass: number };
  /** The grid was weak, the same cards were tried as columns, and the columns matched no better (`columns`, against the grid's own `grid`, over the same stretch): the grid stays. */
  tried?: { grid: number; columns: number; pass: number };
};
export type GridKept = {
  path: string;
  sel: string;
  y: number;
  cards: number;
  reason: string;
  /** A grid that was built, matched worse than the columns over its stretch, and was rebuilt as columns: how each matched there. */
  reverted?: { match: number; pass: number; columns?: number };
  /** The group is a script slider's slides. */
  slider?: boolean;
};
export type GridReport = {
  built: GridBuilt[];
  kept: GridKept[];
  /** Boxes that looked like cards and were right to be refused (a footer's columns, a menu, a form): in the markdown report only, no problem of the copy. */
  quiet?: GridKept[];
};

export const emptyGridReport = (): GridReport => ({ built: [], kept: [], quiet: [] });

export function builtOf(plan: GridPlan, items: CustomGridItem[], style: GridStyle): GridBuilt {
  const parent = plan.group.parent;
  const count = (test: (item: CustomGridItem) => boolean) => items.filter(test).length;
  return {
    path: parent.p,
    sel: parent.sel ?? parent.tag,
    y: Math.round(parent.box[1]),
    cards: plan.group.cards.length,
    items: items.length,
    cut: plan.cut,
    ...(plan.unread > 0 ? { unread: plan.unread } : {}),
    fields: {
      pictures: count((i) => i.picture !== null),
      titles: count((i) => i.title !== ""),
      texts: count((i) => i.text !== ""),
      links: count((i) => i.link !== null),
      buttons: count((i) => i.buttonLabel !== ""),
      badges: count((i) => i.badge !== ""),
      prices: count((i) => i.priceText !== ""),
      dates: count((i) => i.date !== null),
      details: count((i) => i.details.length > 0),
    },
    carousel: plan.carousel
      ? {
          arrows: plan.carousel.arrows,
          dots: plan.carousel.dots,
          snap: plan.carousel.snap,
          perScreen: plan.carousel.perScreen,
          ...(plan.carousel.phonesOnly ? { phonesOnly: true as const } : {}),
          autoplay: plan.carousel.autoplay === "not observed" ? "not observed" : `observed, ${plan.carousel.autoplay.seconds} s`,
          clones: plan.carousel.clones,
          ...(plan.carousel.rewind ? { rewind: true } : {}),
          ...(plan.carousel.script ? { script: plan.carousel.script } : {}),
          ...(plan.carousel.watched ? { watched: plan.carousel.watched } : {}),
        }
      : null,
    columns: style.block.columns,
    failed: plan.failed.map((f) => ({ sel: f.sel, y: f.y, what: f.what })),
    notes: style.notes,
    ...(plan.simplified.length > 0 ? { simplified: plan.simplified } : {}),
  };
}

/** What watching a carousel for autoplay showed, in words that say how long it was watched and never more than it saw. */
export function autoplayWords(c: NonNullable<GridBuilt["carousel"]>): string {
  const watched = c.watched;
  const seconds = watched ? (Math.round(watched.ms / 100) / 10).toString() : null;
  if (c.autoplay !== "not observed") {
    const period = /(\d+) s/.exec(c.autoplay)?.[1] ?? "?";
    if (watched?.basis === "once") return `autoplay observed (moved once in ${seconds} s, so at least ${period} s on each slide)`;
    return `autoplay observed (every ${period} s${watched ? `, ${plural(watched.moves, "move")} in ${seconds} s` : ""})`;
  }
  if (watched?.why) return `autoplay not observed (${watched.ms > 0 ? `watched ${seconds} s: ` : ""}${watched.why})`;
  return watched && watched.ms > 0 ? `autoplay not observed (watched ${seconds} s)` : "autoplay not observed";
}

/** The lines the summary and the report say about the grids, in plain facts. */
export function gridLines(report: GridReport): { well: string[]; problems: string[] } {
  const well: string[] = [];
  const problems: string[] = [];
  for (const g of report.built) {
    const parts = [
      g.fields.pictures > 0 ? plural(g.fields.pictures, "picture") : null,
      g.fields.titles > 0 ? plural(g.fields.titles, "title") : null,
      g.fields.texts > 0 ? plural(g.fields.texts, "text") : null,
      g.fields.links > 0 ? plural(g.fields.links, "link") : null,
      g.fields.badges > 0 ? plural(g.fields.badges, "badge") : null,
      g.fields.prices > 0 ? plural(g.fields.prices, "price text", "price texts") : null,
      g.fields.dates > 0 ? plural(g.fields.dates, "date") : null,
    ].filter(Boolean);
    const carousel = g.carousel?.phonesOnly
      ? `, as a carousel on phones only (${g.carousel.perScreen.phone ?? "?"} in view; computers show a grid of ${g.carousel.perScreen.desktop} to a row, ${g.carousel.arrows ? "arrows" : "no arrows"}, ${g.carousel.snap === "none" ? "free scrolling" : `rests at the ${g.carousel.snap} of a tile`})`
      : g.carousel
      ? `, as a carousel (${g.carousel.arrows ? "arrows" : "no arrows"}${g.carousel.dots ? ", dots" : ""}, ${g.carousel.snap === "none" ? "free scrolling" : `rests at the ${g.carousel.snap} of a tile`}${g.carousel.rewind ? ", goes back to the first tile after the last" : ""}, ${g.carousel.perScreen.desktop} in view at computers' width; ${autoplayWords(g.carousel)})`
      : "";
    const script = g.carousel?.script;
    well.push(`${plural(g.cards, script ? "slide" : "repeated card")} at ${g.sel} (${g.y}px down) became one grid of ${plural(g.items, "item")}${carousel}, with ${parts.join(", ") || "no fields"}.`);
    if (script) {
      const by = script.clonesBy;
      const total = by.markers + by.keys + by.hashes;
      const kind = script.kind === "stack" ? "a slider whose slides lie on top of each other, one showing" : script.kind === "transform" ? "a slider moved by script" : "a row clipped by its box";
      const how = [by.markers > 0 ? `${by.markers} by the library's marker` : null, by.keys > 0 ? `${by.keys} by a number seen again` : null, by.hashes > 0 ? `${by.hashes} by the same words, pictures and addresses at both ends of the track` : null].filter(Boolean).join(", ");
      well.push(`The slider at ${g.sel} is ${kind}${script.hints.length > 0 ? ` (${script.hints.slice(0, 3).join(", ")})` : ""}: ${total === 0 ? "it had no copies to leave out" : `${plural(total, "copy", "copies")} made to loop ${total === 1 ? "was" : "were"} left out (${how})`}${script.hidden > 0 ? `; ${plural(script.hidden, "slide")} out of view ${script.hidden === 1 ? "was" : "were"} read from the page's own text and pictures` : ""}.`);
      if (script.kind === "stack") problems.push(`The slider at ${g.sel} fades or swaps its slides in one place; as a carousel they scroll sideways instead, so the effect is not the original's${g.carousel?.watched?.why && g.carousel.watched.moves > 0 ? ", and its autoplay is not carried over" : ""}.`);
    }
    if (g.cut > 0) problems.push(`${plural(g.cut, "card")} beyond the ${CUSTOM_ITEMS_MAX} an item list holds ${g.cut === 1 ? "was" : "were"} left out of the grid at ${g.sel}.`);
    if (g.unread) problems.push(`${plural(g.unread, "slide")} of the slider at ${g.sel} ${g.unread === 1 ? "was" : "were"} never read (the browser reads a track's first ${TRACK_TILES_READ}) and ${g.unread === 1 ? "is" : "are"} not in the copy.`);
    if ((g.simplified ?? []).length > 0) problems.push(`The words of the grid at ${g.sel} are plain text in an item: ${g.simplified!.map((x) => `${x.what} in ${plural(x.cards, "card")}`).join(", ")} ${g.simplified!.length === 1 && g.simplified![0].cards === 1 ? "is" : "are"} not in the copy (the words are).`);
    if (g.failed.length > 0) problems.push(`${plural(g.failed.length, "card")} of the grid at ${g.sel} had something an item does not hold, left out: ${[...new Set(g.failed.flatMap((f) => f.what))].slice(0, 3).join("; ")}.`);
    if (g.tried) problems.push(`The grid at ${g.sel} (${g.y}px down) matched the original ${g.tried.grid}% over its stretch, under the 60% a grid should reach; the same cards as columns were tried and matched ${g.tried.columns}%, no better, so the grid stays.`);
    else if (g.weak) problems.push(`The grid at ${g.sel} (${g.y}px down) matched the original only ${g.weak.match}% on the last pass, under the 60% a grid should reach, and columns were not tried against it.`);
  }
  for (const k of report.kept) {
    if (k.reverted) problems.push(`The grid at ${k.sel} (${k.y}px down) was rebuilt as columns after pass ${k.reverted.pass}: it matched the original ${k.reverted.match}% over its stretch${k.reverted.columns === undefined ? "" : `, the columns ${k.reverted.columns}%`}.`);
    else problems.push(`${plural(k.cards, "box", "boxes")} at ${k.sel} (${k.y}px down) were kept as columns: ${k.reason}.`);
  }
  return { well, problems };
}

/** What a grid part says of where its cards stood in the original: the box at computers' width and at phones'. */
export type GridPart = { id: string; grid?: string; target: Box | null; targetM?: Box | null };

/**
 * The grids a pass's weakest stretches name under `limit` percent, at computers' width or at phones' (`width`: whose boxes and whose stretches). A stretch names a
 * grid when it covers at least half of the grid's height. This only says a grid is worth trying as columns: the columns are rebuilt and measured over the same
 * stretch, and the grid comes back unless they match better (`stretchesOf()`, `columnsBeatGrid()`).
 */
export function weakGrids(parts: GridPart[], weakest: { y: number; height: number; match: number }[], limit = 60, width: "desktop" | "phone" = "desktop"): { id: string; path: string; match: number }[] {
  const found: { id: string; path: string; match: number }[] = [];
  for (const part of parts) {
    const box = width === "desktop" ? part.target : (part.targetM ?? null);
    if (!part.grid || !box) continue;
    const top = box[1];
    const bottom = top + box[3];
    const named = weakest.filter((w) => w.match < limit).map((w) => ({ w, over: Math.min(bottom, w.y + w.height) - Math.max(top, w.y) })).filter((x) => x.over >= box[3] * 0.5);
    if (named.length > 0) found.push({ id: part.id, path: part.grid, match: Math.min(...named.map((x) => x.w.match)) });
  }
  return found;
}

/** The stretch of the page each grid's cards stood in, in the original: where its match is measured, as a grid and as columns. */
export type GridStretch = { path: string; desktop: { y: number; height: number } | null; phone: { y: number; height: number } | null };

export function stretchesOf(parts: GridPart[], paths: string[]): GridStretch[] {
  return paths.flatMap((path) => {
    const part = parts.find((p) => p.grid === path);
    if (!part) return [];
    const at = (box: Box | null | undefined) => (box ? { y: box[1], height: box[3] } : null);
    return [{ path, desktop: at(part.target), phone: at(part.targetM) }];
  });
}

/** The least the columns must beat the grid by, in points of match, to be kept: the diff's own margin is a point or two, and a grid is the better thing to edit. */
export const COLUMNS_MARGIN = 2;

/** How a grid and the same cards as columns matched over one stretch (the average of the widths measured), and whether the columns clearly did better. */
export function columnsBeatGrid(grid: { desktop: number | null; phone: number | null }, columns: { desktop: number | null; phone: number | null }): { grid: number | null; columns: number | null; columnsWin: boolean } {
  const both = (a: number | null, b: number | null) => (a !== null && b !== null ? [a, b] : null);
  const pairs = [both(grid.desktop, columns.desktop), both(grid.phone, columns.phone)].filter((x): x is number[] => x !== null);
  if (pairs.length === 0) return { grid: null, columns: null, columnsWin: false };
  const mean = (values: number[]) => Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  const g = mean(pairs.map((x) => x[0]));
  const c = mean(pairs.map((x) => x[1]));
  return { grid: g, columns: c, columnsWin: c > g + COLUMNS_MARGIN };
}
