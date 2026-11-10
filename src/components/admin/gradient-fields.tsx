"use client";

import { useId, useState, type PointerEvent } from "react";

import {
  BACKGROUND_EFFECTS,
  GRADIENT_COLORS_MAX,
  GRADIENT_COLORS_MIN,
  GRADIENT_FLOWS,
  GRADIENT_STYLES,
  MOTION_INTENSITIES,
  effectsFor,
  type BackgroundMotion,
  type GradientStyle,
} from "@/lib/motion";
import {
  GRADIENT_ANGLE_DEFAULT,
  GRADIENT_FLOW_DEFAULT,
  INTENSITY_DEFAULT,
  addGradientColor,
  gradientFocus,
  gradientHasAngle,
  gradientHasFlow,
  gradientHasFocus,
  removeGradientColor,
  setBackgroundEffect,
  setBackgroundIntensity,
  setGradientAngle,
  setGradientColor,
  setGradientFlow,
  setGradientFocus,
  setGradientGrain,
  setGradientStyle,
} from "@/lib/motion-edit";
import type { GradientBackground } from "@/lib/page-content";
import { radialGradient } from "@/lib/colour-library";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Check, ColorField, Choices, smallButton } from "./block-fields";
import { SavedGradients } from "./colour-library";
import { EffectPicker, Setting } from "./motion-fields";

/**
 * The controls of a gradient background (D128): its style, two to four colours, an angle for the shifting kind, how it
 * flows and a grain; and, for any picture, video or gradient background, how it moves.
 */

export function GradientFields({
  value,
  onChange,
}: {
  value: GradientBackground;
  onChange: (gradient: GradientBackground) => void;
}) {
  const angleId = useId();
  // A colour field keeps what is typed in it, so when colours are added or taken away the fields start again, in step with the colours.
  const [revision, setRevision] = useState(0);
  const angle = value.angle ?? GRADIENT_ANGLE_DEFAULT;
  const styles = Object.keys(GRADIENT_STYLES) as GradientStyle[];
  const opacityId = useId();
  const all = useAdminText("blocks");
  const w = all.gradient;
  const t = all.typo;
  const term = (english: string) => (all.motion.terms as Record<string, string>)[english] ?? english;
  const opacity = value.opacity ?? 100;
  const setOpacity = (next: number) => {
    const { opacity: _old, ...rest } = value;
    void _old;
    onChange(next >= 100 ? rest : { ...rest, opacity: Math.max(0, Math.round(next)) });
  };
  return (
    <div className="flex flex-col gap-4">
      {/* The store's saved gradients (D183): using one copies it in, keeping this one's overlay and opacity. */}
      <SavedGradients
        label={w.gradient}
        current={value}
        onPick={(saved) => {
          setRevision((n) => n + 1);
          onChange({
            type: "gradient",
            style: saved.style,
            colors: [...saved.colors],
            ...(saved.angle !== undefined && { angle: saved.angle }),
            ...(saved.focus !== undefined && { focus: { ...saved.focus } }),
            ...(saved.flow !== undefined && { flow: saved.flow }),
            ...(saved.grain && { grain: true }),
            ...(value.opacity !== undefined && { opacity: value.opacity }),
            ...(value.overlay !== undefined && { overlay: value.overlay }),
          });
        }}
      />
      <Choices
        legend={w.style}
        hint={term(GRADIENT_STYLES[value.style].hint)}
        options={styles.map((style) => ({ value: style, label: term(GRADIENT_STYLES[style].label) }))}
        value={value.style}
        onChange={(style) => onChange(setGradientStyle(value, style))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="float-left mb-2 w-full text-sm font-medium">
          {w.colours}{" "}
          <span className="font-normal text-muted">{fillWords(w.range, { min: GRADIENT_COLORS_MIN, max: GRADIENT_COLORS_MAX })}</span>
        </legend>
        <ul className="flex flex-wrap items-end gap-4">
          {value.colors.map((color, index) => (
            // The colours have no ids and keep their order, so their place (and the revision) is their key.
            <li key={`${revision}-${index}`} className="flex items-end gap-2">
              <ColorField
                label={fillWords(t.colourN, { n: index + 1 })}
                value={color}
                onChange={(next) => onChange(setGradientColor(value, index, next))}
              />
              <button
                type="button"
                onClick={() => {
                  setRevision((n) => n + 1);
                  onChange(removeGradientColor(value, index));
                }}
                disabled={value.colors.length <= GRADIENT_COLORS_MIN}
                aria-label={fillWords(t.removeColour, { n: index + 1 })}
                className={smallButton}
              >
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
        <div>
          <button
            type="button"
            onClick={() => {
              setRevision((n) => n + 1);
              onChange(addGradientColor(value));
            }}
            disabled={value.colors.length >= GRADIENT_COLORS_MAX}
            className={smallButton}
          >
            {t.addColour}
          </button>
        </div>
      </fieldset>
      {gradientHasAngle(value.style) && (
        <div className="flex flex-col gap-1">
          <label htmlFor={angleId} className="text-sm font-medium">
            {t.angle}
          </label>
          <div className="flex min-h-10 items-center gap-3">
            <input
              id={angleId}
              type="range"
              min={0}
              max={360}
              step={5}
              value={angle}
              onChange={(event) => onChange(setGradientAngle(value, Number(event.target.value)))}
              className="w-48"
            />
            <output htmlFor={angleId} className="w-12 text-sm tabular-nums">
              {angle}°
            </output>
          </div>
        </div>
      )}
      {gradientHasFocus(value.style) && <FocusFields value={value} onChange={onChange} />}
      {gradientHasFlow(value.style) && (
        <Setting
          label={w.flow}
          value={value.flow ?? GRADIENT_FLOW_DEFAULT}
          options={GRADIENT_FLOWS}
          onChange={(flow) => onChange(setGradientFlow(value, flow))}
        />
      )}
      <Check
        label={w.grain}
        hint={w.grainHint}
        checked={Boolean(value.grain)}
        onChange={(grain) => onChange(setGradientGrain(value, grain))}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={opacityId} className="text-sm font-medium">
          {w.opacity}
        </label>
        <div className="flex min-h-10 items-center gap-3">
          <input
            id={opacityId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={opacity}
            aria-valuetext={`${opacity}%`}
            onChange={(event) => setOpacity(Number(event.target.value))}
            className="w-48 accent-brand"
          />
          <output htmlFor={opacityId} className="w-12 text-sm tabular-nums">
            {opacity}%
          </output>
        </div>
        <p className="text-xs text-muted">{w.opacityHint}</p>
      </div>
      <Check
        label={w.overlay}
        hint={w.overlayHint}
        checked={Boolean(value.overlay)}
        onChange={(on) => onChange({ ...value, overlay: on ? { color: "#000000", opacity: 30 } : null })}
      />
      {value.overlay && (
        <div className="flex flex-wrap items-end gap-6 pl-7">
          <ColorField label={w.overlayColour} value={value.overlay.color} onChange={(color) => onChange({ ...value, overlay: { color, opacity: value.overlay?.opacity ?? 30 } })} />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${opacityId}-overlay`} className="text-sm font-medium">
              {w.overlayOpacity}
            </label>
            <div className="flex min-h-10 items-center gap-3">
              <input
                id={`${opacityId}-overlay`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={value.overlay.opacity}
                aria-valuetext={`${value.overlay.opacity}%`}
                onChange={(event) => onChange({ ...value, overlay: { color: value.overlay?.color ?? "#000000", opacity: Number(event.target.value) } })}
                className="w-48 accent-brand"
              />
              <output htmlFor={`${opacityId}-overlay`} className="w-12 text-sm tabular-nums">
                {value.overlay.opacity}%
              </output>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A radial blur's focal point (D531): press or drag in a small picture of the gradient to place it anywhere in the row or
 * column, the way Homer would; two sliders set the same point by the percent, from the keyboard, for Lisa and for anyone
 * who cannot drag. The picture itself is left out for screen readers, as the sliders say all it does.
 */
function FocusFields({ value, onChange }: { value: GradientBackground; onChange: (gradient: GradientBackground) => void }) {
  const w = useAdminText("blocks").gradient;
  const id = useId();
  const focus = gradientFocus(value);
  const colors = value.colors.filter((c) => HEX.test(c));
  const centred = value.focus === undefined;
  const place = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    onChange(
      setGradientFocus(value, {
        x: ((event.clientX - box.left) / box.width) * 100,
        y: ((event.clientY - box.top) / box.height) * 100,
      }),
    );
  };
  const slider = (axis: "x" | "y", label: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${axis}`} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <input
          id={`${id}-${axis}`}
          type="range"
          min={0}
          max={100}
          step={1}
          value={focus[axis]}
          aria-valuetext={`${focus[axis]}%`}
          onChange={(event) => onChange(setGradientFocus(value, { ...focus, [axis]: Number(event.target.value) }))}
          className="w-32 accent-brand"
        />
        <output htmlFor={`${id}-${axis}`} className="w-10 text-sm tabular-nums">
          {focus[axis]}%
        </output>
      </div>
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`} data-gradient-focus="">
      <legend className="float-left mb-2 w-full text-sm font-medium">{w.focus}</legend>
      <div
        aria-hidden
        data-focus-pad=""
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          place(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) place(event);
        }}
        className="relative aspect-video w-full max-w-xs cursor-crosshair touch-none overflow-hidden rounded-md border border-line shadow-sm select-none"
        style={colors.length >= 2 ? { backgroundImage: radialGradient(colors, focus) } : undefined}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/50"
          style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">
        {w.focusHint}
      </p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        {slider("x", w.focusAcross)}
        {slider("y", w.focusDown)}
        <button
          type="button"
          onClick={() => onChange(setGradientFocus(value, { x: 50, y: 50 }))}
          disabled={centred}
          className={`${smallButton} mb-2`}
        >
          {w.focusCentre}
        </button>
      </div>
    </fieldset>
  );
}

/** How a picture, video or gradient background moves (`backgroundMotion`); none takes the key away. */
export function BackgroundMotionFields({
  target,
  value,
  onChange,
}: {
  target: "row" | "column";
  value: BackgroundMotion | undefined;
  onChange: (motion: BackgroundMotion | undefined) => void;
}) {
  const w = useAdminText("blocks").gradient;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h4 className="text-sm font-medium">{w.motion}</h4>
      <EffectPicker
        legend={w.effect}
        kind="background"
        target={target}
        groups={effectsFor(BACKGROUND_EFFECTS, target)}
        value={value?.effect ?? null}
        onChange={(effect) => onChange(setBackgroundEffect(value, effect))}
      />
      {value && (
        <Setting
          label={w.intensity}
          value={value.intensity ?? INTENSITY_DEFAULT}
          options={MOTION_INTENSITIES}
          onChange={(intensity) => onChange(setBackgroundIntensity(value, intensity))}
        />
      )}
    </div>
  );
}
