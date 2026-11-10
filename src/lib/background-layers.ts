import { cleanHue, shiftHue } from "./hue";

/**
 * Layers over a row's or column's background (D534): a short list of things drawn over the background and under what the part holds,
 * each a real element in a frame of their own, so each can move by itself as the page scrolls. The background stays what it was (a
 * colour, a picture, a gradient, a video, or none); the layers are what makes a backdrop of it: a *glow* (one soft ellipse of colour,
 * placed), a *pattern* (a grid, dots or stars, fading where asked) and a *horizon* (a dark disc with a lit rim, which a glow can set
 * behind). `backgroundHue` on the part turns every colour of the background and its layers together.
 *
 * A layer can be blurred (`blur`, D535): out of focus, as what is far away or very close is, which with its travel is what gives a
 * backdrop depth. The blur is drawn on the layer's inner element, so the browser paints it once and the layer that travels only moves
 * the result.
 *
 * What an owner keeps is only names from the lists below, `#rrggbb` colours and a few whole numbers inside limits, checked by
 * `background-layers-schema.ts`; they reach the page as `data-fx-*` attributes and `--fx-*` custom properties (`layerDraw()`, and
 * `layerFx()` in `motion-attrs.ts` for how a layer moves), drawn by `motion.css`. Nothing an owner types becomes CSS. Pure, no zod: the
 * site draws with it.
 */

/** How many layers one background takes: each is a surface the browser keeps while the page scrolls. */
export const LAYERS_MAX = 6;

export const LAYER_KINDS = { glow: "Glow", pattern: "Pattern", horizon: "Horizon" } as const;
export type LayerKind = keyof typeof LAYER_KINDS;

export const LAYER_PATTERNS = { grid: "Grid", dots: "Dots", stars: "Stars" } as const;
export type LayerPattern = keyof typeof LAYER_PATTERNS;
/** A pattern's size in pixels: a grid's square, the room between dots, how far apart stars are sown. */
export const PATTERN_SIZES: Record<LayerPattern, { min: number; max: number; start: number }> = {
  grid: { min: 12, max: 200, start: 52 },
  dots: { min: 8, max: 120, start: 24 },
  stars: { min: 80, max: 400, start: 200 },
};

/** Where a pattern fades away; it covers the whole part unless one is set. */
export const LAYER_FADES = { edges: "Towards the edges", down: "Towards the bottom", up: "Towards the top" } as const;
export type LayerFade = keyof typeof LAYER_FADES;

/** How a layer moves by itself. */
export const LAYER_AMBIENTS = { twinkle: "Twinkle", breathe: "Breathe" } as const;
export type LayerAmbient = keyof typeof LAYER_AMBIENTS;

export const HORIZON_CURVES = { flat: "Flat", gentle: "Gentle", round: "Round" } as const;
export type HorizonCurve = keyof typeof HORIZON_CURVES;
/** The disc's width for each curve, as a per cent of the part's width: the wider the disc, the flatter the arc that shows. */
export const HORIZON_WIDTHS: Record<HorizonCurve, number> = { flat: 420, gentle: 250, round: 150 };
export const HORIZON_CURVE_DEFAULT: HorizonCurve = "gentle";

/** A layer's travel against the page: -100 (far away: slower than the page) to 100 (close: faster); 0 moves with the page. */
export const LAYER_SCROLL_MAX = 100;
/** How soft a layer may be drawn, in pixels (D535). */
export const LAYER_BLUR_MAX = 40;
/** A glow's width and height, as a per cent of the part's. */
export const GLOW_SIZE_MIN = 10;
export const GLOW_SIZE_MAX = 300;

type LayerCommon = {
  id: string;
  /** Switched off: kept in the list, not drawn. */
  hidden?: boolean;
  /** How solid it is, 1 to 100; solid unless set. */
  opacity?: number;
  /** How soft it is drawn, in pixels up to `LAYER_BLUR_MAX` (D535): out of focus, for depth. Sharp unless set. */
  blur?: number;
  /** How it travels against the page as it scrolls (`LAYER_SCROLL_MAX`); with the page unless set. */
  scroll?: number;
  /** How it moves by itself. */
  ambient?: LayerAmbient;
};

/** One soft ellipse of colour: `color` at its heart, `outer` around it (the same unless set), its centre at `x`, `y` and its `width` and `height` in per cent of the part. */
export type GlowLayer = LayerCommon & { type: "glow"; color: string; outer?: string; x: number; y: number; width: number; height: number };
/** A grid, dots or stars in one colour, over the whole part or fading where `fade` says. */
export type PatternLayer = LayerCommon & { type: "pattern"; pattern: LayerPattern; color: string; size?: number; fade?: LayerFade };
/** A disc filled with `fill` whose top edge, lit in `color`, shows as an arc `y` per cent down the part. */
export type HorizonLayer = LayerCommon & { type: "horizon"; color: string; fill: string; y: number; curve?: HorizonCurve };
/** A layer over a background; the first of a list is the lowest. */
export type BackgroundLayer = GlowLayer | PatternLayer | HorizonLayer;

const HEX = /^#[0-9a-f]{6}$/i;

/** A number held inside its limits as a whole one; `otherwise` for anything that is not a number. */
const within = (value: unknown, min: number, max: number, otherwise: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : otherwise;

/** A colour with how solid it is, as `#rrggbbaa`. */
const withAlpha = (colour: string, alpha: number) =>
  `${colour}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** A colour mixed towards white, for a lit edge. */
const lightened = (colour: string, by: number) =>
  `#${[1, 3, 5]
    .map((i) => {
      const c = Number.parseInt(colour.slice(i, i + 2), 16);
      return Math.round(c + (255 - c) * by)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;

/** A layer's travel as the stylesheet takes it: -1 (far) to 1 (close), 0 for none. */
export const layerTravel = (scroll: number | undefined): number => within(scroll, -LAYER_SCROLL_MAX, LAYER_SCROLL_MAX, 0) / LAYER_SCROLL_MAX;

/** A pattern's size in pixels: its own inside the pattern's limits, else the pattern's. */
export function patternSize(layer: Pick<PatternLayer, "pattern" | "size">): number {
  const limits = PATTERN_SIZES[layer.pattern] ?? PATTERN_SIZES.grid;
  return within(layer.size, limits.min, limits.max, limits.start);
}

/** A layer as it is written: the element that travels (`attrs`, `style`) and the one inside it that draws (`inner`). */
export type LayerDraw = { attrs: Record<string, string>; style: Record<string, string | number>; inner: Record<string, string> };

/**
 * What a layer's elements carry: its kind as attributes, and its colours (turned by the part's `hue`), place, size and blur as custom
 * properties, each remade here from what is kept (a colour that is not `#rrggbb` leaves the layer out, a number is held inside its
 * limits). The custom properties are on the layer, which the element that draws inherits them from. Null for a layer that is switched
 * off or cannot be drawn.
 */
export function layerDraw(layer: BackgroundLayer, hue?: number): LayerDraw | null {
  if (layer.hidden) return null;
  const colour = (value: string | undefined) => (value && HEX.test(value) ? shiftHue(value.toLowerCase(), hue) : null);
  const main = colour(layer.color);
  if (!main) return null;
  const style: Record<string, string | number> = {};
  const opacity = within(layer.opacity, 1, 100, 100);
  if (opacity < 100) style["--fx-o"] = opacity / 100;
  // Out of focus (D535): the layer is marked soft, and what draws inside it is blurred by this much.
  const blur = within(layer.blur, 0, LAYER_BLUR_MAX, 0);
  const soft: Record<string, string> = blur > 0 ? { "data-fx-soft": "" } : {};
  if (blur > 0) style["--fx-blur"] = `${blur}px`;
  if (layer.type === "glow") {
    style["--fx-lc1"] = main;
    // Half as solid where the heart ends, so one colour fades evenly and two blend into each other.
    style["--fx-lc2"] = withAlpha(colour(layer.outer) ?? main, 0.54);
    // Its place in per cent of the layer (where it swells from), and again with its size in the frame's own measures, which its gradient is drawn in.
    const x = within(layer.x, 0, 100, 50);
    const y = within(layer.y, 0, 100, 50);
    style["--fx-x"] = `${x}%`;
    style["--fx-y"] = `${y}%`;
    style["--fx-gx"] = `${x}cqw`;
    style["--fx-gy"] = `${y}cqh`;
    style["--fx-w"] = `${within(layer.width, GLOW_SIZE_MIN, GLOW_SIZE_MAX, 60)}cqw`;
    style["--fx-h"] = `${within(layer.height, GLOW_SIZE_MIN, GLOW_SIZE_MAX, 60)}cqh`;
    return { attrs: { "data-fx-bglayer": "glow", ...soft }, style, inner: { "data-fx-glow": "" } };
  }
  if (layer.type === "pattern") {
    if (!(layer.pattern in LAYER_PATTERNS)) return null;
    style["--fx-lc1"] = main;
    style["--fx-size"] = `${patternSize(layer)}px`;
    const inner: Record<string, string> = { "data-fx-pattern": layer.pattern };
    if (layer.fade && layer.fade in LAYER_FADES) inner["data-fx-fade"] = layer.fade;
    return { attrs: { "data-fx-bglayer": "pattern", ...soft }, style, inner };
  }
  if (layer.type === "horizon") {
    const fill = colour(layer.fill);
    if (!fill) return null;
    // The rim's glow, the disc, the thin lit edge, and the haze above it.
    style["--fx-lc1"] = withAlpha(main, 0.82);
    style["--fx-lc2"] = fill;
    style["--fx-lc3"] = lightened(main, 0.78);
    style["--fx-lc4"] = withAlpha(main, 0.5);
    style["--fx-x"] = "50%";
    style["--fx-y"] = `${within(layer.y, 0, 100, 64)}%`;
    // The disc's radius: half its width, in the frame's width.
    style["--fx-r"] = `${(HORIZON_WIDTHS[layer.curve ?? HORIZON_CURVE_DEFAULT] ?? HORIZON_WIDTHS[HORIZON_CURVE_DEFAULT]) / 2}cqw`;
    return { attrs: { "data-fx-bglayer": "horizon", ...soft }, style, inner: { "data-fx-disc": "" } };
  }
  return null;
}

/** Whether any layer that is drawn travels with the scroll, which browsers without CSS scroll timelines need the motion runtime for. */
export const layersScroll = (layers: readonly BackgroundLayer[] | undefined): boolean =>
  Boolean(layers?.some((layer) => !layer.hidden && layerTravel(layer.scroll) !== 0));

/** Whether any layer is drawn. */
export const layersShow = (layers: readonly BackgroundLayer[] | undefined): boolean => Boolean(layers?.some((layer) => layerDraw(layer) !== null));

// ---------------------------------------------------------------------------
// The hue of the whole background
// ---------------------------------------------------------------------------

type Overlay = { color: string; opacity: number } | null;
/** The parts of a background that hold a colour (`Background` and `VideoBackground` of `page-content.ts`). */
type Tinted =
  | { type: "color"; color: string }
  | { type: "gradient"; colors: string[]; overlay?: Overlay }
  | { type: "image"; overlay: Overlay }
  | { type: "video"; overlay: Overlay };

const huedOverlay = <O extends Overlay | undefined>(overlay: O, hue: number): O =>
  (overlay ? { ...overlay, color: shiftHue(overlay.color, hue) } : overlay) as O;

/**
 * A background with every colour it holds turned by `hue`: a colour, a gradient's colours, and the colour laid over a gradient, picture
 * or video. The picture and the video are drawn as they are. The same background when there is no turn.
 */
export function huedBackground<B extends Tinted>(background: B, hue: number | undefined): B;
export function huedBackground<B extends Tinted>(background: B | undefined, hue: number | undefined): B | undefined;
export function huedBackground<B extends Tinted>(background: B | undefined, hue: number | undefined): B | undefined {
  const turn = cleanHue(hue);
  if (!background || turn === undefined) return background;
  const b = background as Tinted;
  if (b.type === "color") return { ...b, color: shiftHue(b.color, turn) } as B;
  if (b.type === "gradient")
    return { ...b, colors: b.colors.map((c) => shiftHue(c, turn)), ...(b.overlay !== undefined && { overlay: huedOverlay(b.overlay, turn) }) } as B;
  return { ...b, overlay: huedOverlay(b.overlay, turn) } as B;
}

/** Whether a turn of the hue would show: a colour, a gradient, a colour over a picture or video, or a layer. */
export const backgroundHasHue = (background: Tinted | undefined, layers: readonly BackgroundLayer[] | undefined): boolean =>
  Boolean(layers?.length) || background?.type === "color" || background?.type === "gradient" || Boolean(background && "overlay" in background && background.overlay);

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** A new layer of a kind as it starts: white on nothing would not show on a light page, so each starts in a colour that shows on both. */
export function newLayer(kind: LayerKind, id: string): BackgroundLayer {
  if (kind === "glow") return { id, type: "glow", color: "#8b5cf6", x: 50, y: 50, width: 80, height: 60, opacity: 70 };
  if (kind === "pattern") return { id, type: "pattern", pattern: "grid", color: "#8b8b9a", opacity: 25, fade: "edges" };
  return { id, type: "horizon", color: "#d946ef", fill: "#07051a", y: 64 };
}

/** The layers with one more on top; the same list once it is full. */
export const addLayer = (layers: readonly BackgroundLayer[], layer: BackgroundLayer): BackgroundLayer[] =>
  layers.length >= LAYERS_MAX ? [...layers] : [...layers, layer];

export const removeLayer = (layers: readonly BackgroundLayer[], id: string): BackgroundLayer[] => layers.filter((layer) => layer.id !== id);

/** The layers with one moved a place up (`1`, towards the top) or down (`-1`); the same order at either end. */
export function moveLayer(layers: readonly BackgroundLayer[], id: string, by: 1 | -1): BackgroundLayer[] {
  const from = layers.findIndex((layer) => layer.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layers.length) return [...layers];
  const next = [...layers];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The layers with one changed; a key set to `undefined` is taken away, so the page keeps only what is set. */
export function patchLayer(layers: readonly BackgroundLayer[], id: string, patch: Record<string, unknown>): BackgroundLayer[] {
  return layers.map((layer) => {
    if (layer.id !== id) return layer;
    const next: Record<string, unknown> = { ...layer, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    return next as BackgroundLayer;
  });
}

/** A pattern changed to another: its size was the old pattern's, so it starts at the new one's. */
export function setPattern(layer: PatternLayer, pattern: LayerPattern): PatternLayer {
  const { size: _size, ...rest } = layer;
  void _size;
  return { ...rest, pattern };
}

/** A list as a part keeps it: none at all when it is empty. */
export const keptLayers = (layers: readonly BackgroundLayer[]): BackgroundLayer[] | undefined => (layers.length > 0 ? [...layers] : undefined);

/** The layers as copies with ids of their own (a ready-made backdrop put on a part). */
export const copiedLayers = (layers: readonly BackgroundLayer[], newId: () => string): BackgroundLayer[] =>
  layers.map((layer) => ({ ...layer, id: newId() }));
