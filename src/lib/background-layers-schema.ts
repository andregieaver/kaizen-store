import { z } from "zod";

import {
  GLOW_SIZE_MAX,
  GLOW_SIZE_MIN,
  HORIZON_CURVES,
  LAYERS_MAX,
  LAYER_AMBIENTS,
  LAYER_BLUR_MAX,
  LAYER_FADES,
  LAYER_PATTERNS,
  LAYER_SCROLL_MAX,
  PATTERN_SIZES,
  PICTURE_FITS,
  PICTURE_WIDTH_MAX,
  PICTURE_WIDTH_MIN,
  type HorizonCurve,
  type LayerAmbient,
  type LayerFade,
  type LayerPattern,
  type PictureFit,
} from "./background-layers";
import { HUE_MAX } from "./hue";

/**
 * The layers over a background and the hue of the whole (D534), as a page stores them: names from the lists, `#rrggbb` colours and
 * whole numbers inside their limits. Shared by the browser and the server, so nothing an owner types reaches a style.
 */

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Part of the page could not be read. Reload the page and try again.");
const percent = z.number().int().min(0).max(100);

const keys = <K extends string>(record: Record<K, unknown>) => Object.keys(record) as [K, ...K[]];

const common = {
  id,
  hidden: z.boolean().optional(),
  opacity: z.number().int().min(1).max(100).optional(),
  blur: z.number().int().min(1).max(LAYER_BLUR_MAX).optional(),
  scroll: z.number().int().min(-LAYER_SCROLL_MAX).max(LAYER_SCROLL_MAX).optional(),
  ambient: z.enum(keys<LayerAmbient>(LAYER_AMBIENTS)).optional(),
};

const glowSize = z.number().int().min(GLOW_SIZE_MIN).max(GLOW_SIZE_MAX);

const glowLayer = z.object({ ...common, type: z.literal("glow"), color: colour, outer: colour.optional(), x: percent, y: percent, width: glowSize, height: glowSize });

const patternLayer = z
  .object({
    ...common,
    type: z.literal("pattern"),
    pattern: z.enum(keys<LayerPattern>(LAYER_PATTERNS)),
    color: colour,
    size: z.number().int().optional(),
    fade: z.enum(keys<LayerFade>(LAYER_FADES)).optional(),
  })
  .refine((layer) => layer.size === undefined || (layer.size >= PATTERN_SIZES[layer.pattern].min && layer.size <= PATTERN_SIZES[layer.pattern].max), {
    message: "A background pattern's size is outside what its kind takes.",
  });

const horizonLayer = z.object({
  ...common,
  type: z.literal("horizon"),
  color: colour,
  fill: colour,
  y: percent,
  curve: z.enum(keys<HorizonCurve>(HORIZON_CURVES)).optional(),
});

/** The owner's picture as a layer (D537). Its small copy is never kept: it is found again each time the page is read. */
const pictureLayer = z.object({
  ...common,
  type: z.literal("picture"),
  image: z.object({
    url: z.url({ protocol: /^https?$/, error: "A background layer's picture has an invalid address." }).max(1000),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
  }),
  fit: z.enum(keys<PictureFit>(PICTURE_FITS)).optional(),
  x: percent,
  y: percent,
  width: z.number().int().min(PICTURE_WIDTH_MIN).max(PICTURE_WIDTH_MAX).optional(),
  fade: z.enum(keys<LayerFade>(LAYER_FADES)).optional(),
});

/** One layer over a background. */
export const backgroundLayerSchema = z.union([glowLayer, patternLayer, horizonLayer, pictureLayer], {
  error: "A background layer is a glow, a pattern, a horizon or a picture.",
});

/** A row's or column's layers; an empty list is left out. */
export const backgroundLayersSchema = z
  .array(backgroundLayerSchema)
  .max(LAYERS_MAX, `A background takes at most ${LAYERS_MAX} layers.`)
  .refine((layers) => new Set(layers.map((layer) => layer.id)).size === layers.length, { message: "Part of the page could not be read. Reload the page and try again." })
  .optional()
  .transform((layers) => (layers && layers.length > 0 ? layers : undefined));

/** How far every colour of a background and its layers is turned, in degrees; no turn is left out. */
export const backgroundHueSchema = z
  .number()
  .int()
  .min(-HUE_MAX)
  .max(HUE_MAX)
  .optional()
  .transform((hue) => (hue ? hue : undefined));
