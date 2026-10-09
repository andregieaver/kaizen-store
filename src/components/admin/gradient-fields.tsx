"use client";

import { useId, useState } from "react";

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
  gradientHasAngle,
  gradientHasFlow,
  removeGradientColor,
  setBackgroundEffect,
  setBackgroundIntensity,
  setGradientAngle,
  setGradientColor,
  setGradientFlow,
  setGradientGrain,
  setGradientStyle,
} from "@/lib/motion-edit";
import type { GradientBackground } from "@/lib/page-content";
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
        label="Gradient"
        current={value}
        onPick={(saved) => {
          setRevision((n) => n + 1);
          onChange({
            type: "gradient",
            style: saved.style,
            colors: [...saved.colors],
            ...(saved.angle !== undefined && { angle: saved.angle }),
            ...(saved.flow !== undefined && { flow: saved.flow }),
            ...(saved.grain && { grain: true }),
            ...(value.opacity !== undefined && { opacity: value.opacity }),
            ...(value.overlay !== undefined && { overlay: value.overlay }),
          });
        }}
      />
      <Choices
        legend="Style"
        hint={GRADIENT_STYLES[value.style].hint}
        options={styles.map((style) => ({ value: style, label: GRADIENT_STYLES[style].label }))}
        value={value.style}
        onChange={(style) => onChange(setGradientStyle(value, style))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="float-left mb-2 w-full text-sm font-medium">
          Colours{" "}
          <span className="font-normal text-muted">
            ({GRADIENT_COLORS_MIN} to {GRADIENT_COLORS_MAX})
          </span>
        </legend>
        <ul className="flex flex-wrap items-end gap-4">
          {value.colors.map((color, index) => (
            // The colours have no ids and keep their order, so their place (and the revision) is their key.
            <li key={`${revision}-${index}`} className="flex items-end gap-2">
              <ColorField
                label={`Colour ${index + 1}`}
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
                aria-label={`Remove colour ${index + 1}`}
                className={smallButton}
              >
                Remove
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
            Add a colour
          </button>
        </div>
      </fieldset>
      {gradientHasAngle(value.style) && (
        <div className="flex flex-col gap-1">
          <label htmlFor={angleId} className="text-sm font-medium">
            Angle
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
      {gradientHasFlow(value.style) && (
        <Setting
          label="How it moves"
          value={value.flow ?? GRADIENT_FLOW_DEFAULT}
          options={GRADIENT_FLOWS}
          onChange={(flow) => onChange(setGradientFlow(value, flow))}
        />
      )}
      <Check
        label="Grain"
        hint="A fine noise over the colours, which softens the bands."
        checked={Boolean(value.grain)}
        onChange={(grain) => onChange(setGradientGrain(value, grain))}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={opacityId} className="text-sm font-medium">
          Gradient opacity
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
            className="w-48 accent-foreground"
          />
          <output htmlFor={opacityId} className="w-12 text-sm tabular-nums">
            {opacity}%
          </output>
        </div>
        <p className="text-xs text-muted">Less than 100 lets what is behind the gradient (a colour, the page) show through.</p>
      </div>
      <Check
        label="Colour over the gradient"
        hint="A colour laid over it, to calm it or make text on it easier to read."
        checked={Boolean(value.overlay)}
        onChange={(on) => onChange({ ...value, overlay: on ? { color: "#000000", opacity: 30 } : null })}
      />
      {value.overlay && (
        <div className="flex flex-wrap items-end gap-6 pl-7">
          <ColorField label="Overlay colour" value={value.overlay.color} onChange={(color) => onChange({ ...value, overlay: { color, opacity: value.overlay?.opacity ?? 30 } })} />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${opacityId}-overlay`} className="text-sm font-medium">
              Overlay opacity
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
                className="w-48 accent-foreground"
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
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <h4 className="text-sm font-semibold">Background motion</h4>
      <EffectPicker
        legend="Background effect"
        kind="background"
        target={target}
        groups={effectsFor(BACKGROUND_EFFECTS, target)}
        value={value?.effect ?? null}
        onChange={(effect) => onChange(setBackgroundEffect(value, effect))}
      />
      {value && (
        <Setting
          label="Intensity"
          value={value.intensity ?? INTENSITY_DEFAULT}
          options={MOTION_INTENSITIES}
          onChange={(intensity) => onChange(setBackgroundIntensity(value, intensity))}
        />
      )}
    </div>
  );
}
