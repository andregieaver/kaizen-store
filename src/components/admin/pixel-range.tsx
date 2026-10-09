"use client";

import { useState } from "react";

/**
 * A slider for a field in pixels, beside its number field: a bubble over the thumb says the value while it is pointed at, focused
 * or dragged, and a value typed beyond the slider's reach (the number field's own limits) puts the thumb at its end and is still
 * the one written. The number field is the field; this only moves it (D183).
 */
export function PixelRange({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  disabled = false,
  unit = "px",
  className = "",
}: {
  value: number;
  min: number;
  /** The slider's end; the field it moves may allow more. */
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** What the slider moves, for people who cannot see it. */
  label: string;
  disabled?: boolean;
  unit?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const clamped = Math.min(Math.max(value, min), max);
  const share = max > min ? (clamped - min) / (max - min) : 0;
  return (
    <span
      className={`relative flex min-h-6 w-full min-w-16 items-center ${className}`}
      onPointerEnter={() => setShown(true)}
      onPointerLeave={() => setShown(false)}
    >
      <input
        type="range"
        aria-label={label}
        aria-valuetext={`${value} ${unit}`}
        min={min}
        max={max}
        step={step}
        value={clamped}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        className="w-full accent-foreground disabled:opacity-50"
      />
      <output
        aria-hidden
        data-pixel-tooltip=""
        // The bubble follows the thumb, which keeps half its own width from each end of the track.
        style={{ left: `calc(${share * 100}% + ${(0.5 - share) * 16}px)` }}
        className={`pointer-events-none absolute -top-6 z-20 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-xs whitespace-nowrap text-background tabular-nums shadow transition-opacity ${
          shown && !disabled ? "opacity-100" : "opacity-0"
        }`}
      >
        {value}
        {unit}
      </output>
    </span>
  );
}
