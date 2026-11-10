"use client";

import { useId, useState, type ReactNode } from "react";

import { PartBackground } from "@/components/page-parts";
import { fillWords } from "@/lib/admin-fill";
import { BACKDROPS, BACKDROP_IDS, BACKDROP_WORDS, accentOf, backdropPatch, mainColour, themeHue, type BackdropPatch, type BackdropWords } from "@/lib/backdrops";
import {
  GLOW_SIZE_MAX,
  GLOW_SIZE_MIN,
  HORIZON_CURVES,
  HORIZON_CURVE_DEFAULT,
  LAYERS_MAX,
  LAYER_AMBIENTS,
  LAYER_BLUR_MAX,
  LAYER_FADES,
  LAYER_KINDS,
  LAYER_PATTERNS,
  LAYER_SCROLL_MAX,
  PATTERN_SIZES,
  addLayer,
  backgroundHasHue,
  keptLayers,
  moveLayer,
  newLayer,
  patchLayer,
  patternSize,
  removeLayer,
  setPattern,
  type BackgroundLayer,
  type LayerKind,
} from "@/lib/background-layers";
import { HUE_MAX, cleanHue, shiftHue } from "@/lib/hue";
import type { RowBackground } from "@/lib/page-content";

import { useHandedText } from "./admin-text";
import { Choices, ColorField, smallButton } from "./block-fields";
import { useColourSwatches } from "./colour-field";

/**
 * Backdrops in the builder (D534): what `BackgroundFields` adds to a row's or column's background. For Homer, `BackdropPicker`: a
 * ready-made backdrop in one press, then one slider that turns the hue of every colour of it. For Lisa, `LayerFields`: the layers
 * themselves, one deliberate press away, each with its colours, place, fade and how it moves. Loaded when a background's settings
 * are first opened, so the builder's first scripts do not carry it.
 */

/** The words in the account's language: the page hands them down (`backdrops`, D312), else `backdrops.ts`'s English. */
const useWords = (): BackdropWords => useHandedText("backdrops") ?? BACKDROP_WORDS;

/** An id for a new layer: it only has to differ from the few others on its part. */
const layerId = () => `l${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}°`;

/** A slider with its value written beside it. */
function Slider({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  shown,
  onChange,
  ends,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  shown: string;
  onChange: (value: number) => void;
  /** Words under the two ends of the slider. */
  ends?: [string, string];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={shown}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-48 accent-brand"
        />
        <output htmlFor={id} className="min-w-12 text-sm tabular-nums">
          {shown}
        </output>
      </div>
      {ends && (
        <div aria-hidden className="flex w-48 justify-between text-xs text-muted">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A ready-made backdrop drawn small: at four times the tile's size and scaled back, so its grid, stars and rim keep the proportions
 * they have on a row. Still, as a picture of it.
 */
function BackdropTile({ background, layers, hue }: { background: RowBackground | undefined; layers: readonly BackgroundLayer[]; hue?: number }) {
  return (
    <span aria-hidden className="relative block aspect-[16/9] w-full overflow-hidden rounded-md border border-line">
      <span className="absolute top-0 left-0 isolate block h-[400%] w-[400%] origin-top-left scale-25">
        <PartBackground background={background} layers={layers} hue={hue} stillLayers />
      </span>
    </span>
  );
}

/**
 * Homer's part: the ready-made backdrops, and the hue of the whole background once there is a colour to turn. A backdrop replaces
 * the background and its layers (the builder's undo brings the old one back).
 */
export function BackdropPicker({
  background,
  layers,
  hue,
  onBackdrop,
  onHue,
}: {
  background: RowBackground | undefined;
  layers: readonly BackgroundLayer[] | undefined;
  hue: number | undefined;
  onBackdrop: (patch: BackdropPatch) => void;
  onHue: (hue: number | undefined) => void;
}) {
  const w = useWords();
  const id = useId();
  return (
    <div className="flex flex-col gap-4" data-backdrops="">
      <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
        <legend className="float-left mb-1 w-full text-sm font-medium">{w.readyMade}</legend>
        <p id={`${id}-hint`} className="text-xs text-muted">
          {w.readyMadeHint}
        </p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BACKDROP_IDS.map((key) => {
            const words = w.presets[key];
            return (
              <li key={key}>
                <button
                  type="button"
                  data-backdrop={key}
                  title={words.hint}
                  aria-label={fillWords(w.use, { name: words.name })}
                  onClick={() => onBackdrop(backdropPatch(key, layerId))}
                  className="flex w-full flex-col gap-1 rounded-md text-left text-xs hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <BackdropTile background={BACKDROPS[key].background} layers={BACKDROPS[key].layers} />
                  <span className="truncate">{words.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {backgroundHasHue(background, layers) && <HueField background={background} layers={layers} hue={hue} onHue={onHue} />}
    </div>
  );
}

/** How far the hue is turned, a step at a time. */
const HUE_STEP = 5;

/**
 * The hue of the whole background: one slider. The strip under it shows the colour the background's main colour becomes at each place
 * along the slider, so there is nothing to work out. "Match my theme" turns it to the theme's accent where the theme has a hue.
 */
function HueField({
  background,
  layers,
  hue,
  onHue,
}: {
  background: RowBackground | undefined;
  layers: readonly BackgroundLayer[] | undefined;
  hue: number | undefined;
  onHue: (hue: number | undefined) => void;
}) {
  const w = useWords();
  const id = useId();
  const value = hue ?? 0;
  const main = mainColour(background, layers);
  const match = cleanHue(themeHue(background, layers, accentOf(useColourSwatches())) ?? undefined);
  const stops = main ? Array.from({ length: 13 }, (_, i) => shiftHue(main, -HUE_MAX + i * 30)).join(", ") : null;
  return (
    <div className="flex flex-col gap-1" data-hue-field="">
      <label htmlFor={id} className="text-sm font-medium">
        {w.hue}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <div className="flex w-full max-w-xs flex-col gap-1">
          <input
            id={id}
            type="range"
            min={-HUE_MAX}
            max={HUE_MAX}
            step={HUE_STEP}
            value={value}
            aria-valuetext={signed(value)}
            aria-describedby={`${id}-hint`}
            onChange={(event) => onHue(cleanHue(Number(event.target.value)))}
            className="w-full accent-brand"
          />
          {stops && <span aria-hidden className="block h-1.5 rounded-pill" style={{ backgroundImage: `linear-gradient(to right, ${stops})` }} />}
        </div>
        <output htmlFor={id} className="w-12 text-sm tabular-nums">
          {signed(value)}
        </output>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">
        {w.hueHint}
        {hue ? ` ${w.hueNote}` : ""}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onHue(undefined)} disabled={!hue} className={smallButton}>
          {w.hueOriginal}
        </button>
        {match !== undefined && match !== hue && (
          <button type="button" onClick={() => onHue(match)} className={smallButton}>
            {w.hueMatch}
          </button>
        )}
      </div>
    </div>
  );
}

/** Each layer's name in the list: its kind, a pattern by its own name, and a number after the first of the same name. */
function layerNames(layers: readonly BackgroundLayer[], w: BackdropWords): Map<string, string> {
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const layer of layers) {
    const base = layer.type === "pattern" ? (w.patterns[layer.pattern] ?? w.kinds.pattern) : w.kinds[layer.type];
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    names.set(layer.id, count > 1 ? `${base} ${count}` : base);
  }
  return names;
}

/**
 * Lisa's part: the layers over the background, behind one press. The list shows the top layer first, as it is seen; each layer can be
 * switched off, moved, taken away, and opened for its settings.
 */
export function LayerFields({
  layers,
  hue,
  onLayers,
}: {
  layers: readonly BackgroundLayer[] | undefined;
  /** The part's turn of the hue: each layer's dot in the list is the colour the page draws. */
  hue?: number;
  onLayers: (layers: BackgroundLayer[] | undefined) => void;
}) {
  const w = useWords();
  const list = layers ?? [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const names = layerNames(list, w);
  const full = list.length >= LAYERS_MAX;
  const change = (next: BackgroundLayer[]) => onLayers(keptLayers(next));
  const top = list.length - 1;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4" data-layer-fields="">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${smallButton} self-start`}>
        <span aria-hidden className="mr-2 inline-block w-3 text-muted">
          {open ? "▾" : "▸"}
        </span>
        {list.length > 0 ? fillWords(w.customise, { n: list.length }) : w.addFirst}
      </button>
      {open && (
        <fieldset className="flex flex-col gap-3">
          <legend className="float-left mb-1 w-full text-sm font-medium">{w.layers}</legend>
          <p className="text-xs text-muted">{w.layersHint}</p>
          {list.length > 0 && (
            <ul className="flex flex-col gap-2">
              {[...list].reverse().map((layer) => {
                const index = list.indexOf(layer);
                const name = names.get(layer.id) ?? w.kinds[layer.type];
                const isOpen = editing === layer.id;
                const patch = (values: Record<string, unknown>) => change(patchLayer(list, layer.id, values));
                return (
                  <li key={layer.id} className="rounded-md border border-line" data-layer={layer.type}>
                    <div className="flex flex-wrap items-center gap-2 p-2">
                      <span aria-hidden className="size-4 shrink-0 rounded-full border border-line" style={{ backgroundColor: shiftHue(layer.color, hue) }} />
                      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${layer.hidden ? "text-muted line-through" : ""}`}>{name}</span>
                      <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs">
                        {/* Named with its layer, as the list holds several. */}
                        <input
                          type="checkbox"
                          aria-label={`${w.shown}: ${name}`}
                          checked={!layer.hidden}
                          onChange={(event) => patch({ hidden: event.target.checked ? undefined : true })}
                          className="size-4 accent-brand"
                        />
                        {w.shown}
                      </label>
                      <button type="button" onClick={() => change(moveLayer(list, layer.id, 1))} disabled={index === top} aria-label={fillWords(w.moveUp, { name })} className={smallButton}>
                        ↑
                      </button>
                      <button type="button" onClick={() => change(moveLayer(list, layer.id, -1))} disabled={index === 0} aria-label={fillWords(w.moveDown, { name })} className={smallButton}>
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? w.close : w.settings}: ${name}`}
                        onClick={() => setEditing(isOpen ? null : layer.id)}
                        className={smallButton}
                      >
                        {isOpen ? w.close : w.settings}
                      </button>
                      <button type="button" onClick={() => change(removeLayer(list, layer.id))} aria-label={fillWords(w.remove, { name })} className={`${smallButton} text-danger-text`}>
                        ×
                      </button>
                    </div>
                    {isOpen && (
                      <div className="flex flex-col gap-4 border-t border-line p-3">
                        <OneLayer layer={layer} w={w} patch={patch} replace={(next) => change(list.map((l) => (l.id === next.id ? next : l)))} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{w.add}</span>
            {(Object.keys(LAYER_KINDS) as LayerKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={full}
                title={w.kindHints[kind]}
                data-add-layer={kind}
                onClick={() => {
                  const layer = newLayer(kind, layerId());
                  change(addLayer(list, layer));
                  setEditing(layer.id);
                }}
                className={smallButton}
              >
                {w.kinds[kind]}
              </button>
            ))}
          </div>
          {full && <p className="text-xs text-muted">{fillWords(w.full, { max: LAYERS_MAX })}</p>}
        </fieldset>
      )}
    </div>
  );
}

/** A list's choices, each with its word in the account's language. */
function choices<K extends string>(words: { [key in NoInfer<K>]: string }, list: { readonly [key in K]: unknown }) {
  return (Object.keys(list) as K[]).map((value) => ({ value, label: words[value] }));
}

/** One layer's settings: its own by kind, then what every layer has (how solid and how soft it is, and how it moves). */
function OneLayer({
  layer,
  w,
  patch,
  replace,
}: {
  layer: BackgroundLayer;
  w: BackdropWords;
  patch: (values: Record<string, unknown>) => void;
  replace: (layer: BackgroundLayer) => void;
}) {
  let own: ReactNode = null;
  if (layer.type === "glow") {
    own = (
      <>
        <div className="flex flex-wrap items-end gap-6">
          <ColorField label={w.colour} value={layer.color} onChange={(color) => patch({ color })} />
          <ColorField label={w.outer} value={layer.outer} placeholder={w.outerSame} onChange={(outer) => patch({ outer })} onClear={() => patch({ outer: undefined })} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Slider label={w.across} min={0} max={100} value={layer.x} shown={`${layer.x}%`} onChange={(x) => patch({ x })} />
          <Slider label={w.down} min={0} max={100} value={layer.y} shown={`${layer.y}%`} onChange={(y) => patch({ y })} />
          <Slider label={w.width} min={GLOW_SIZE_MIN} max={GLOW_SIZE_MAX} step={5} value={layer.width} shown={`${layer.width}%`} onChange={(width) => patch({ width })} />
          <Slider label={w.height} min={GLOW_SIZE_MIN} max={GLOW_SIZE_MAX} step={5} value={layer.height} shown={`${layer.height}%`} onChange={(height) => patch({ height })} />
        </div>
      </>
    );
  } else if (layer.type === "pattern") {
    const limits = PATTERN_SIZES[layer.pattern];
    const size = patternSize(layer);
    own = (
      <>
        <Choices legend={w.pattern} options={choices(w.patterns, LAYER_PATTERNS)} value={layer.pattern} onChange={(pattern) => replace(setPattern(layer, pattern))} />
        <ColorField label={w.colour} value={layer.color} onChange={(color) => patch({ color })} />
        <Slider label={w.size} min={limits.min} max={limits.max} value={size} shown={`${size} px`} onChange={(next) => patch({ size: next === limits.start ? undefined : next })} />
        <Choices
          legend={w.fade}
          options={[{ value: "none" as const, label: w.fades.none }, ...choices(w.fades, LAYER_FADES)]}
          value={layer.fade ?? "none"}
          onChange={(fade) => patch({ fade: fade === "none" ? undefined : fade })}
        />
      </>
    );
  } else {
    own = (
      <>
        <div className="flex flex-wrap items-end gap-6">
          <ColorField label={w.rim} value={layer.color} onChange={(color) => patch({ color })} />
          <ColorField label={w.fill} value={layer.fill} onChange={(fill) => patch({ fill })} />
        </div>
        <p className="text-xs text-muted">{w.fillHint}</p>
        <Slider label={w.arc} min={0} max={100} value={layer.y} shown={`${layer.y}%`} onChange={(y) => patch({ y })} />
        <Choices
          legend={w.curve}
          options={choices(w.curves, HORIZON_CURVES)}
          value={layer.curve ?? HORIZON_CURVE_DEFAULT}
          onChange={(curve) => patch({ curve: curve === HORIZON_CURVE_DEFAULT ? undefined : curve })}
        />
      </>
    );
  }
  const opacity = layer.opacity ?? 100;
  const blur = layer.blur ?? 0;
  const scroll = layer.scroll ?? 0;
  return (
    <>
      {own}
      <Slider label={w.opacity} min={1} max={100} value={opacity} shown={`${opacity}%`} onChange={(next) => patch({ opacity: next >= 100 ? undefined : next })} />
      <Slider label={w.blur} hint={w.blurHint} min={0} max={LAYER_BLUR_MAX} value={blur} shown={`${blur} px`} onChange={(next) => patch({ blur: next > 0 ? next : undefined })} />
      <Slider
        label={w.scroll}
        hint={w.scrollHint}
        min={-LAYER_SCROLL_MAX}
        max={LAYER_SCROLL_MAX}
        step={5}
        value={scroll}
        shown={scroll === 0 ? w.withPage : `${scroll < 0 ? w.far : w.near} ${Math.abs(scroll)}`}
        ends={[w.far, w.near]}
        onChange={(next) => patch({ scroll: next === 0 ? undefined : next })}
      />
      <Choices
        legend={w.ambient}
        options={[{ value: "none" as const, label: w.ambients.none }, ...choices(w.ambients, LAYER_AMBIENTS)]}
        value={layer.ambient ?? "none"}
        onChange={(ambient) => patch({ ambient: ambient === "none" ? undefined : ambient })}
      />
    </>
  );
}
