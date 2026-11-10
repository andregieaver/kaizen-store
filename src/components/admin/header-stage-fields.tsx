"use client";

import { useId } from "react";

import { defaultGradient } from "@/lib/motion-edit";
import { HEADER_STAGES, headerStage, withHeaderStage, type HeaderStageName } from "@/lib/header-stages";
import { BACKDROP_BLUR_MAX, type HeaderOverlay, type HeaderStage } from "@/lib/page-content";

import { useAdminText } from "./admin-text";
import { Check, Choices, ColorField } from "./block-fields";
import { GradientFields } from "./gradient-fields";

/**
 * A header over the page, in its two stages (D533): at the top of the page, and when it comes back as the visitor scrolls.
 * Each stage starts as the header row has it, so Homer need change nothing; a background, a blur or a text colour of its
 * own is one choice away, and the colour's opacity and the gradient's every setting under it, for Lisa.
 */
export function HeaderStageFields({ value, onChange }: { value: HeaderOverlay; onChange: (overlay: HeaderOverlay) => void }) {
  const w = useAdminText("builder").editor.overlay.stages;
  return (
    <div className="flex flex-col gap-3" data-header-stages="">
      {HEADER_STAGES.map((stage) => (
        <StageFields
          key={stage}
          name={stage}
          title={stage === "top" ? w.top : w.revealed}
          hint={stage === "top" ? w.topHint : w.revealedHint}
          value={headerStage(value, stage)}
          onChange={(next) => onChange(withHeaderStage(value, stage, next))}
        />
      ))}
      <p className="text-xs text-muted">{w.fallback}</p>
    </div>
  );
}

type BackgroundChoice = "row" | "none" | "color" | "gradient";
type BlurChoice = "row" | "none" | "blur";

function StageFields({
  name,
  title,
  hint,
  value,
  onChange,
}: {
  name: HeaderStageName;
  title: string;
  hint: string;
  value: HeaderStage;
  onChange: (stage: HeaderStage) => void;
}) {
  const id = useId();
  const w = useAdminText("builder").editor.overlay.stages;
  const background = value.background;
  const backgroundChoice: BackgroundChoice = background?.type ?? "row";
  const blurChoice: BlurChoice = value.blur === undefined ? "row" : value.blur === 0 ? "none" : "blur";
  const opacity = background?.type === "color" ? (background.opacity ?? 100) : 100;
  const set = (patch: Partial<HeaderStage>) => {
    const next: HeaderStage = { ...value, ...patch };
    for (const key of Object.keys(patch) as (keyof HeaderStage)[]) if (patch[key] === undefined) delete next[key];
    onChange(next);
  };
  const setBackground = (choice: BackgroundChoice) => {
    if (choice === backgroundChoice) return;
    if (choice === "row") set({ background: undefined });
    else if (choice === "none") set({ background: { type: "none" } });
    else if (choice === "color") set({ background: { type: "color", color: "#ffffff", opacity: 80 } });
    else set({ background: defaultGradient("radial") });
  };
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-line p-3" data-header-stage-fields={name}>
      <legend className="px-1 text-sm font-medium text-ink">{title}</legend>
      <p className="-mt-2 text-xs text-muted">{hint}</p>
      <Choices
        legend={w.background}
        options={[
          { value: "row", label: w.fromRow },
          { value: "none", label: w.clear },
          { value: "color", label: w.colour },
          { value: "gradient", label: w.gradient },
        ]}
        value={backgroundChoice}
        onChange={setBackground}
      />
      {background?.type === "color" && (
        <div className="flex flex-wrap items-end gap-6 pl-1">
          <ColorField label={w.colourLabel} value={background.color} onChange={(color) => set({ background: { ...background, color } })} />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-opacity`} className="text-sm font-medium">
              {w.opacity}
            </label>
            <div className="flex min-h-10 items-center gap-3">
              <input
                id={`${id}-opacity`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={opacity}
                aria-valuetext={`${opacity}%`}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  const { opacity: _old, ...rest } = background;
                  void _old;
                  set({ background: next >= 100 ? rest : { ...rest, opacity: next } });
                }}
                className="w-40 accent-brand"
              />
              <output htmlFor={`${id}-opacity`} className="w-12 text-sm tabular-nums">
                {opacity}%
              </output>
            </div>
          </div>
        </div>
      )}
      {background?.type === "gradient" && (
        <div className="pl-1">
          <GradientFields value={background} onChange={(gradient) => set({ background: gradient })} />
        </div>
      )}
      <Choices
        legend={w.blur}
        hint={w.blurHint}
        options={[
          { value: "row", label: w.fromRow },
          { value: "none", label: w.noBlur },
          { value: "blur", label: w.ownBlur },
        ]}
        value={blurChoice}
        onChange={(choice) => set({ blur: choice === "row" ? undefined : choice === "none" ? 0 : (value.blur || 8) })}
      />
      {blurChoice === "blur" && (
        <div className="flex flex-col gap-1 pl-1">
          <label htmlFor={`${id}-blur`} className="text-sm font-medium">
            {w.blurAmount}
          </label>
          <div className="flex min-h-10 items-center gap-3">
            <input
              id={`${id}-blur`}
              type="range"
              min={1}
              max={BACKDROP_BLUR_MAX}
              step={1}
              value={value.blur ?? 8}
              aria-valuetext={`${value.blur ?? 8} px`}
              onChange={(event) => set({ blur: Number(event.target.value) })}
              className="w-40 accent-brand"
            />
            <output htmlFor={`${id}-blur`} className="w-12 text-sm tabular-nums">
              {value.blur} px
            </output>
          </div>
        </div>
      )}
      <Check
        label={w.ownText}
        hint={name === "top" ? w.ownTextTopHint : w.ownTextRevealedHint}
        checked={Boolean(value.textColor)}
        onChange={(on) => set({ textColor: on ? (name === "top" ? "#ffffff" : "#111111") : undefined })}
      />
      {value.textColor && (
        <div className="pl-7">
          <ColorField label={w.textColour} value={value.textColor} onChange={(textColor) => set({ textColor })} />
        </div>
      )}
    </fieldset>
  );
}
