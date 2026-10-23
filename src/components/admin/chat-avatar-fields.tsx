"use client";

import { useId } from "react";

import { AVATAR_BORDER_MAX, AVATAR_FILLS, AVATAR_SHADOWS, DEFAULT_AVATAR_STYLE, isPlain, type AvatarFill, type AvatarShadow, type AvatarStyle } from "@/lib/chat-avatar";

import { useAdminText } from "./admin-text";
import { ColorField } from "./colour-field";

/**
 * How the chat agent's picture is framed on the site (D233): a background (a colour or a gradient, seen through a picture's see-through
 * parts and behind the chat icon when there is no picture), a border and a shadow. A style that changes nothing is kept as null.
 */
export function ChatAvatarFields({ value, onChange }: { value: AvatarStyle | null; onChange: (style: AvatarStyle | null) => void }) {
  const id = useId();
  const w = useAdminText("platformTools").chat.avatar;
  const FILL_WORDS: Record<AvatarFill, string> = w.fills;
  const SHADOW_WORDS: Record<AvatarShadow, string> = w.shadows;
  const style = value ?? DEFAULT_AVATAR_STYLE;
  const set = (patch: Partial<AvatarStyle>) => {
    const next = { ...style, ...patch };
    onChange(isPlain(next) ? null : next);
  };

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-body-strong text-ink">{w.frame}</legend>

      <div className="flex flex-col gap-2">
        <span id={`${id}-fill`} className="text-sm font-medium">
          {w.background}
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-fill`} className="flex flex-wrap gap-1">
          {AVATAR_FILLS.map((fill) => (
            <label key={fill} className="flex cursor-pointer items-center gap-2 rounded-pill border border-edge px-3 py-1.5 text-sm has-checked:bg-sunken">
              <input type="radio" name={`${id}-fill`} value={fill} checked={style.fill === fill} onChange={() => set({ fill })} className="size-4" />
              {FILL_WORDS[fill]}
            </label>
          ))}
        </div>
        {style.fill === "colour" && <ColorField label={w.colour} value={style.colour} onChange={(colour) => set({ colour })} noSwatches />}
        {style.fill === "gradient" && (
          <div className="flex flex-wrap items-end gap-4">
            <ColorField label={w.from} value={style.colour} onChange={(colour) => set({ colour })} noSwatches />
            <ColorField label={w.to} value={style.colour2} onChange={(colour2) => set({ colour2 })} noSwatches />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{w.direction}</span>
              <span className="flex items-center gap-2">
                <input type="range" min={0} max={360} step={15} value={style.angle} onChange={(event) => set({ angle: Number(event.target.value) })} aria-label={w.directionLabel} />
                <span className="w-12 text-sm tabular-nums">{style.angle}°</span>
              </span>
            </label>
          </div>
        )}
        <p className="text-caption text-muted">{w.showsThrough}</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{w.border}</span>
          <span className="flex items-center gap-2">
            <input type="range" min={0} max={AVATAR_BORDER_MAX} value={style.border} onChange={(event) => set({ border: Number(event.target.value) })} aria-label={w.borderLabel} />
            <span className="w-12 text-sm tabular-nums">{style.border ? `${style.border} px` : w.none}</span>
          </span>
        </label>
        {style.border > 0 && <ColorField label={w.borderColour} value={style.borderColour} onChange={(borderColour) => set({ borderColour })} noSwatches />}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{w.shadow}</span>
          <select value={style.shadow} onChange={(event) => set({ shadow: event.target.value as AvatarShadow })} className="min-h-10 rounded-md border border-line bg-card px-3 py-2">
            {AVATAR_SHADOWS.map((shadow) => (
              <option key={shadow} value={shadow}>
                {SHADOW_WORDS[shadow]}
              </option>
            ))}
          </select>
        </label>
        {style.shadow !== "none" && <ColorField label={w.shadowColour} value={style.shadowColour} onChange={(shadowColour) => set({ shadowColour })} noSwatches />}
      </div>

      {value && (
        <button type="button" onClick={() => onChange(null)} className="self-start text-sm text-muted underline">
          {w.standard}
        </button>
      )}
    </fieldset>
  );
}
