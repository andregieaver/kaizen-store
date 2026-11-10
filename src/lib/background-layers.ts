import { cleanHue, shiftHue } from "./hue";

/**
 * Layers over a row's or column's background (D534): a short list of things drawn over the background and under what the part holds,
 * each a real element in a frame of their own, so each can move by itself as the page scrolls. The background stays what it was (a
 * colour, a picture, a gradient, a video, or none); the layers are what makes a backdrop of it: a *glow* (one soft ellipse of colour,
 * placed), a *pattern* (a grid, dots or stars, fading where asked), a *horizon* (a dark disc with a lit rim, which a glow can set
 * behind) and a *picture* (D537: the owner's own, placed at a size or filling the part; one with a see-through background is what it is
 * for). `backgroundHue` on the part turns every colour of the background and its layers together; a picture is drawn as it is.
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

export const LAYER_KINDS = { glow: "Glow", pattern: "Pattern", horizon: "Horizon", picture: "Picture" } as const;
export type LayerKind = keyof typeof LAYER_KINDS;

/** How a picture sits (D537): placed at a width of its own, or cut to fill the whole part as a background picture is. */
export const PICTURE_FITS = { placed: "Placed", cover: "Fills the part" } as const;
export type PictureFit = keyof typeof PICTURE_FITS;
export const PICTURE_FIT_DEFAULT: PictureFit = "placed";
/** A placed picture's width, as a per cent of the part's. */
export const PICTURE_WIDTH_MIN = 5;
export const PICTURE_WIDTH_MAX = 300;
export const PICTURE_WIDTH_DEFAULT = 50;

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
/**
 * The owner's picture (D537): placed with its centre at `x`, `y` per cent of the part and `width` per cent wide (its height follows),
 * or cut to fill the part with `x`, `y` saying which part of it shows. `small` is the library's 480 px copy, set when the page is read
 * for the site (`withSmallCopies()`), never saved. Drawn as it is: the hue does not turn it.
 */
export type PictureLayer = LayerCommon & {
  type: "picture";
  image: { url: string; width: number; height: number; small?: string };
  fit?: PictureFit;
  x: number;
  y: number;
  width?: number;
  fade?: LayerFade;
};
/** A layer drawn in colours of its own, which the hue turns. */
export type ColourLayer = GlowLayer | PatternLayer | HorizonLayer;
/** A layer over a background; the first of a list is the lowest. */
export type BackgroundLayer = ColourLayer | PictureLayer;

/** A layer's own colour, for a swatch or for matching a theme; none for a picture. */
export const layerColour = (layer: BackgroundLayer): string | null => (layer.type === "picture" ? null : layer.color);

/** A picture's address as the page may draw it: the web's own, never a script's or a file's. */
const WEB_ADDRESS = /^https?:\/\/[^\s"'<>]+$/i;

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
  const style: Record<string, string | number> = {};
  const opacity = within(layer.opacity, 1, 100, 100);
  if (opacity < 100) style["--fx-o"] = opacity / 100;
  // Out of focus (D535): the layer is marked soft, and what draws inside it is blurred by this much.
  const blur = within(layer.blur, 0, LAYER_BLUR_MAX, 0);
  const soft: Record<string, string> = blur > 0 ? { "data-fx-soft": "" } : {};
  if (blur > 0) style["--fx-blur"] = `${blur}px`;
  if (layer.type === "picture") {
    // The picture itself is the element that draws (an `<img>`, `BackgroundLayers`): here only where it sits and how large.
    const image = layer.image;
    if (!image || typeof image.url !== "string" || !WEB_ADDRESS.test(image.url) || !(image.width > 0) || !(image.height > 0)) return null;
    const fit: PictureFit = layer.fit === "cover" ? "cover" : PICTURE_FIT_DEFAULT;
    style["--fx-x"] = `${within(layer.x, 0, 100, 50)}%`;
    style["--fx-y"] = `${within(layer.y, 0, 100, 50)}%`;
    if (fit === "placed") style["--fx-w"] = `${within(layer.width, PICTURE_WIDTH_MIN, PICTURE_WIDTH_MAX, PICTURE_WIDTH_DEFAULT)}cqw`;
    const inner: Record<string, string> = { "data-fx-pic": fit };
    if (layer.fade && layer.fade in LAYER_FADES) inner["data-fx-fade"] = layer.fade;
    return { attrs: { "data-fx-bglayer": "picture", ...soft }, style, inner };
  }
  const colour = (value: string | undefined) => (value && HEX.test(value) ? shiftHue(value.toLowerCase(), hue) : null);
  const main = colour(layer.color);
  if (!main) return null;
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

/** Whether a turn of the hue would show: a colour, a gradient, a colour over a picture or video, or a layer drawn in colours (a picture is not). */
export const backgroundHasHue = (background: Tinted | undefined, layers: readonly BackgroundLayer[] | undefined): boolean =>
  Boolean(layers?.some((layer) => layer.type !== "picture")) ||
  background?.type === "color" ||
  background?.type === "gradient" ||
  Boolean(background && "overlay" in background && background.overlay);

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** A new layer of a kind as it starts: white on nothing would not show on a light page, so each starts in a colour that shows on both. */
export function newLayer(kind: Exclude<LayerKind, "picture">, id: string): ColourLayer {
  if (kind === "glow") return { id, type: "glow", color: "#8b5cf6", x: 50, y: 50, width: 80, height: 60, opacity: 70 };
  if (kind === "pattern") return { id, type: "pattern", pattern: "grid", color: "#8b8b9a", opacity: 25, fade: "edges" };
  return { id, type: "horizon", color: "#d946ef", fill: "#07051a", y: 64 };
}

/** A new picture layer (D537) as it starts: the picture in the middle, half as wide as the part. */
export const newPictureLayer = (id: string, image: { url: string; width: number; height: number }): PictureLayer => ({
  id,
  type: "picture",
  image: { url: image.url, width: image.width, height: image.height },
  x: 50,
  y: 50,
  width: PICTURE_WIDTH_DEFAULT,
});

/** A picture layer set to sit another way: filling the part it has no width of its own. */
export function setPictureFit(layer: PictureLayer, fit: PictureFit): PictureLayer {
  const { fit: _fit, width, ...rest } = layer;
  void _fit;
  return fit === "cover" ? { ...rest, fit: "cover" } : { ...rest, width: width ?? PICTURE_WIDTH_DEFAULT };
}

/** The addresses of the layers' pictures, for their small copies and for copying a part to another store. */
export const layerPictureUrls = (layers: readonly BackgroundLayer[] | undefined): string[] =>
  (layers ?? []).flatMap((layer) => (layer.type === "picture" && layer.image?.url ? [layer.image.url] : []));

/**
 * The layers with each picture's address through `change`: another address (a copy in another store, with nothing left of the small
 * copy that went with the old one), or null to leave that layer out. The same list when nothing changes.
 */
export function mapLayerPictures(layers: readonly BackgroundLayer[] | undefined, change: (url: string) => string | null): BackgroundLayer[] | undefined {
  if (!layers) return undefined;
  let changed = false;
  const next = layers.flatMap((layer): BackgroundLayer[] => {
    if (layer.type !== "picture") return [layer];
    const url = change(layer.image.url);
    if (url === layer.image.url) return [layer];
    changed = true;
    if (url === null) return [];
    const { small: _small, ...image } = layer.image;
    void _small;
    return [{ ...layer, image: { ...image, url } }];
  });
  if (!changed) return [...layers];
  return next.length > 0 ? next : undefined;
}

/** The layers with each picture's small copy (`image.small`) where `lookup` has one; the same list when none is new. */
export function withLayerSmallCopies<L extends readonly BackgroundLayer[] | undefined>(layers: L, lookup: (url: string) => string | undefined): L {
  if (!layers) return layers;
  let changed = false;
  const next = layers.map((layer) => {
    if (layer.type !== "picture") return layer;
    const small = lookup(layer.image.url);
    if (!small || small === layer.image.url || layer.image.small === small) return layer;
    changed = true;
    return { ...layer, image: { ...layer.image, small } };
  });
  return (changed ? next : layers) as L;
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
