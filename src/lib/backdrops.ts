import { copiedLayers, layerColour, type BackgroundLayer } from "./background-layers";
import { hueBetween } from "./hue";
import type { Background, PageColumn, PageRow, RowBackground } from "./page-content";

/**
 * Ready-made backdrops (D534): a background with layers over it (`background-layers.ts`), put on a row or column in one press. Each is
 * plain page content, so what an owner gets is theirs to change layer by layer afterwards; nothing refers back to this list. A backdrop
 * comes in its own colours; the part's hue (`backgroundHue`) then turns them all together, and `themeHue()` finds the turn that takes a
 * backdrop to the theme's accent.
 *
 * The builder's words for backdrops, layers and the hue are re-exported here (`BACKDROP_WORDS`, written in `backdrop-words.ts`): the builder draws from this module anyway, so
 * the area is server-only in the admin's catalogue (`admin-messages/backdrops.en.ts`) and nothing is added to other screens' first
 * scripts.
 */

export type Backdrop = {
  /** The background under the layers: a colour or a gradient, never a file to load. */
  background: Extract<Background, { type: "color" | "gradient" }>;
  /** Its layers, the lowest first. */
  layers: BackgroundLayer[];
  /** Its main colour: the one whose hue a theme's accent is matched to. */
  accent: string;
  /** Whether it is dark (light text reads on it) or light. */
  tone: "dark" | "light";
};

export const BACKDROPS = {
  horizon: {
    tone: "dark",
    accent: "#d946ef",
    background: { type: "gradient", style: "radial", colors: ["#1d1250", "#0c0828", "#07051a"], focus: { x: 50, y: 0 }, flow: "still", grain: true },
    // The stars lie under the horizon, so they rise from behind it and never cross the disc.
    layers: [
      { id: "grid", type: "pattern", pattern: "grid", color: "#ffffff", opacity: 9, fade: "edges", scroll: -22 },
      { id: "stars", type: "pattern", pattern: "stars", color: "#ffffff", opacity: 90, fade: "edges", scroll: 60, ambient: "twinkle" },
      { id: "haze", type: "glow", color: "#3b5bff", x: 50, y: 72, width: 220, height: 34, opacity: 70, scroll: -100 },
      { id: "glow", type: "glow", color: "#d946ef", outer: "#7c3aed", x: 50, y: 63, width: 150, height: 40, opacity: 95, scroll: -100, ambient: "breathe" },
      { id: "horizon", type: "horizon", color: "#d946ef", fill: "#07051a", y: 64, scroll: -40 },
    ],
  },
  grid: {
    tone: "dark",
    accent: "#3b82f6",
    background: { type: "gradient", style: "radial", colors: ["#13203f", "#0a0f1e", "#070a14"], focus: { x: 50, y: 0 }, flow: "still" },
    layers: [
      { id: "grid", type: "pattern", pattern: "grid", color: "#ffffff", opacity: 10, size: 44, fade: "down", scroll: -25 },
      { id: "glow", type: "glow", color: "#3b82f6", outer: "#1d4ed8", x: 50, y: 0, width: 130, height: 100, opacity: 60, scroll: -70 },
    ],
  },
  starfield: {
    tone: "dark",
    accent: "#6366f1",
    background: { type: "gradient", style: "radial", colors: ["#1a1f4d", "#0b0d24", "#05060f"], focus: { x: 50, y: 100 }, flow: "still" },
    layers: [
      { id: "glow", type: "glow", color: "#6366f1", outer: "#312e81", x: 50, y: 100, width: 170, height: 90, opacity: 55, scroll: -60, ambient: "breathe" },
      { id: "far", type: "pattern", pattern: "stars", color: "#c7d2fe", size: 130, opacity: 60, scroll: -35 },
      // The near stars are out of focus (D535): with their travel, that is what sets them in front of the far ones.
      { id: "near", type: "pattern", pattern: "stars", color: "#ffffff", size: 260, opacity: 95, blur: 2, scroll: 55, ambient: "twinkle" },
    ],
  },
  dots: {
    tone: "light",
    accent: "#8b5cf6",
    background: { type: "gradient", style: "radial", colors: ["#ffffff", "#f5f3ff"], focus: { x: 50, y: 0 }, flow: "still" },
    layers: [
      { id: "glow-a", type: "glow", color: "#c4b5fd", x: 88, y: 8, width: 90, height: 100, opacity: 65, scroll: -55 },
      { id: "glow-b", type: "glow", color: "#f9a8d4", x: 8, y: 96, width: 90, height: 90, opacity: 50, scroll: -30 },
      { id: "dots", type: "pattern", pattern: "dots", color: "#6d5bd0", opacity: 28, size: 22, fade: "edges", scroll: -15 },
    ],
  },
  sunrise: {
    tone: "light",
    accent: "#fb923c",
    background: { type: "gradient", style: "radial", colors: ["#fff7ed", "#ffedd5", "#fde8d0"], focus: { x: 50, y: 0 }, flow: "still" },
    layers: [
      { id: "glow", type: "glow", color: "#fb923c", outer: "#f472b6", x: 50, y: 66, width: 140, height: 44, opacity: 80, scroll: -100, ambient: "breathe" },
      { id: "horizon", type: "horizon", color: "#fb923c", fill: "#fffaf5", y: 66, scroll: -40 },
    ],
  },
} as const satisfies Record<string, Backdrop>;

export type BackdropId = keyof typeof BACKDROPS;
export const BACKDROP_IDS = Object.keys(BACKDROPS) as BackdropId[];

/** What a part takes when a backdrop is put on it: its background and layers as its own, in the backdrop's own colours, and nothing left of what moved or blurred the old background. */
export type BackdropPatch = Pick<PageRow & PageColumn, "background" | "backgroundLayers" | "backgroundHue" | "backgroundMotion" | "backdropBlur">;

export function backdropPatch(id: BackdropId, newId: () => string): BackdropPatch {
  const backdrop: Backdrop = BACKDROPS[id];
  return {
    background: structuredCloneOf(backdrop.background),
    backgroundLayers: copiedLayers(backdrop.layers, newId),
    backgroundHue: undefined,
    backgroundMotion: undefined,
    backdropBlur: undefined,
  };
}

/** A copy that shares nothing with the list, so editing a part never changes a ready-made backdrop. */
const structuredCloneOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The colour a background is known by, for matching a theme: the topmost glow's or horizon's, else the topmost coloured layer's,
 * else a gradient's first colour or the colour itself. None for a picture or video alone, as a background or as a layer.
 */
export function mainColour(background: RowBackground | undefined, layers: readonly BackgroundLayer[] | undefined): string | null {
  const shown = (layers ?? []).filter((layer) => !layer.hidden && layer.type !== "picture");
  const lit = shown.findLast((layer) => layer.type === "glow" || layer.type === "horizon") ?? shown.at(-1);
  const colour = lit ? layerColour(lit) : null;
  if (colour) return colour;
  if (background?.type === "gradient") return background.colors[0] ?? null;
  if (background?.type === "color") return background.color;
  return null;
}

/** The theme's accent among a colour field's swatches (`themeSwatches()`: the light set's where both are offered), or none. */
export const accentOf = (swatches: readonly { name: string; colour: string }[]): string | undefined =>
  (swatches.find((swatch) => swatch.name === "Accent" || swatch.name === "Accent (light)") ?? swatches.find((swatch) => swatch.name === "Accent (dark)"))?.colour;

/**
 * The turn of the hue that takes a background's main colour to the theme's accent, or null where there is none to take: no main
 * colour, or either of the two is a grey (a black-and-white theme has no hue to match).
 */
export function themeHue(background: RowBackground | undefined, layers: readonly BackgroundLayer[] | undefined, accent: string | undefined): number | null {
  const main = mainColour(background, layers);
  if (!main || !accent) return null;
  return hueBetween(main, accent);
}

// ---------------------------------------------------------------------------
// The builder's words: `backdrop-words.ts` (bloat review step 2.50)
// ---------------------------------------------------------------------------

export { BACKDROP_WORDS, type BackdropWords } from "./backdrop-words";

