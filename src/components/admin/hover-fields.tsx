"use client";

import { useId } from "react";

import {
  BUTTON_HOVERS,
  HOVER_DURATION_DEFAULT,
  HOVER_DURATION_MAX,
  HOVER_EASES,
  type ButtonHover,
  type HoverEase,
  type HoverTiming,
} from "@/lib/hover-timing";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/**
 * How long hover changes take and their easing (D206): for the theme (the whole site) or one part (itself and what it
 * holds). Left empty, the theme's (or, in the theme, `HOVER_DURATION_DEFAULT` ms and Ease) applies, and the field says so.
 */
export function HoverTimingFields({
  value,
  onChange,
  inherited: asked,
}: {
  value: HoverTiming | undefined;
  onChange: (value: HoverTiming | undefined) => void;
  /** What applies when nothing is set here, in words. */
  inherited?: string;
}) {
  const id = useId();
  const w = useAdminText("blocks").hover;
  const inherited = asked ?? fillWords(w.inherited, { ms: HOVER_DURATION_DEFAULT });
  const fromTheme = asked === undefined || asked.startsWith("the theme");
  const set = (patch: Partial<HoverTiming>) => {
    const next = { ...value, ...patch };
    if (next.duration === undefined) delete next.duration;
    if (!next.ease) delete next.ease;
    onChange(next.duration !== undefined || next.ease ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-3" data-hover-timing="">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-ms`} className="text-sm font-medium">
          {w.time}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-ms`}
            type="number"
            inputMode="numeric"
            min={0}
            max={HOVER_DURATION_MAX}
            step={50}
            placeholder={String(HOVER_DURATION_DEFAULT)}
            value={value?.duration ?? ""}
            onChange={(event) => {
              const text = event.target.value.trim();
              const next = Number.parseInt(text, 10);
              set({ duration: text === "" || !Number.isFinite(next) ? undefined : Math.min(HOVER_DURATION_MAX, Math.max(0, next)) });
            }}
            className={`${FIELD} w-28`}
          />
          <span className="text-sm text-muted">{w.ms}</span>
        </div>
        <p className="text-xs text-muted">{fillWords(w.timeHint, { inherited })}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-ease`} className="text-sm font-medium">
          {w.easing}
        </label>
        <select
          id={`${id}-ease`}
          value={value?.ease ?? ""}
          onChange={(event) => set({ ease: (event.target.value || undefined) as HoverEase | undefined })}
          className={FIELD}
        >
          <option value="">{fromTheme ? w.themes : w.eases.ease}</option>
          {(Object.keys(HOVER_EASES) as HoverEase[]).map((ease) => (
            <option key={ease} value={ease}>
              {w.eases[ease] ?? HOVER_EASES[ease]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** How a button answers the pointer (D206): one of `BUTTON_HOVERS`, or, empty, the theme's choice (or Fade in the theme). */
export function ButtonHoverField({
  value,
  onChange,
  emptyLabel: asked,
}: {
  value: ButtonHover | undefined;
  onChange: (value: ButtonHover | undefined) => void;
  emptyLabel?: string;
}) {
  const id = useId();
  const w = useAdminText("blocks").hover;
  const emptyLabel = asked ?? w.themeChoice;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {w.effect}
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange((event.target.value || undefined) as ButtonHover | undefined)} className={FIELD}>
        <option value="">{emptyLabel}</option>
        {(Object.keys(BUTTON_HOVERS) as ButtonHover[]).map((hover) => (
          <option key={hover} value={hover}>
            {w.buttons[hover]?.label ?? BUTTON_HOVERS[hover].label}
          </option>
        ))}
      </select>
      {value && <p className="text-xs text-muted">{w.buttons[value]?.hint ?? BUTTON_HOVERS[value].hint}</p>}
    </div>
  );
}
