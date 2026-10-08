"use client";

import { X } from "lucide-react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";

import { HEX6, type ColourSwatch } from "@/lib/colour";

/**
 * The one colour field (D180, `docs/text-colour.md`), after Beaver Builder's: a swatch that opens the browser's picker, the
 * colour typed as `#rrggbb`, a × that takes it away (where the caller allows none), an optional opacity slider (0–100, solid
 * unless set), and the theme's colours as swatches beneath (`ColourSwatches`, given by the page editor: the store theme's,
 * or Kaizen's own on Kaizen's pages). The stored value is always `#rrggbb` (lower case) and a whole number.
 */

const Swatches = createContext<readonly ColourSwatch[]>([]);

/** The theme's colours every colour field inside offers. */
export function ColourSwatches({ value, children }: { value: readonly ColourSwatch[]; children?: ReactNode }) {
  return <Swatches.Provider value={value}>{children}</Swatches.Provider>;
}

export const useColourSwatches = () => useContext(Swatches);

type Common = {
  label: string;
  /** After the label: a setting that can differ by screen size has its device icon (D179). */
  mark?: ReactNode;
  /** Classes that grey an inherited value. */
  muted?: string;
  /** Leave out the theme's swatches (a field that is not about the site's colours). */
  noSwatches?: boolean;
  /** The opacity slider: its value (undefined is solid) and what it changes; left out, no slider. */
  opacity?: { value: number | undefined; onChange: (opacity: number | undefined) => void; mark?: ReactNode; muted?: string };
};

/** A colour that is always set. */
type Always = Common & { value: string; onChange: (colour: string) => void; onClear?: undefined; placeholder?: undefined };
/** A colour that may be none (inherited, the site's): empty until chosen, with a × to take it away. */
type Maybe = Common & { value: string | undefined; onChange: (colour: string) => void; onClear: () => void; placeholder?: string };

export function ColorField(props: Always | Maybe) {
  const { label, value, onChange, mark, muted = "", noSwatches, opacity } = props;
  const id = useId();
  const swatches = useContext(Swatches);
  // What is being typed, until it is a colour (kept apart per value shown, so a swatch or the picker replaces it).
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const key = value ?? "";
  const text = draft?.key === key ? draft.text : (value ?? "");
  const set = (next: string) => {
    setDraft(null);
    onChange(next.toLowerCase());
  };
  const invalid = text !== "" && !HEX6.test(text);
  return (
    <div className={`flex flex-col gap-1 ${muted}`} data-colour-field="">
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {mark}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: choose`}
          value={value ?? "#000000"}
          onChange={(event) => set(event.target.value)}
          className="h-10 w-14 cursor-pointer rounded-md border border-border bg-background p-1"
        />
        <input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          placeholder={props.placeholder ?? "#rrggbb"}
          aria-invalid={invalid}
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft({ key, text: next });
            if (HEX6.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
          className="min-h-10 w-28 rounded-md border border-border bg-background px-2 font-mono text-sm aria-invalid:border-red-700"
        />
        {props.onClear && value !== undefined && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              props.onClear?.();
            }}
            aria-label={`Clear ${label.toLowerCase()}`}
            title="Clear"
            className="flex size-8 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {opacity && <OpacitySlider label={label} colour={value} {...opacity} />}
      {!noSwatches && swatches.length > 0 && (
        <div role="group" aria-label={`${label}: the theme's colours`} className="flex flex-wrap gap-1.5 pt-1">
          {swatches.map((swatch) => (
            <button
              key={`${swatch.name}${swatch.colour}`}
              type="button"
              onClick={() => set(swatch.colour)}
              aria-label={`${swatch.name} (${swatch.colour})`}
              aria-pressed={value?.toLowerCase() === swatch.colour}
              title={`${swatch.name} ${swatch.colour}`}
              className="size-6 rounded-full border border-border shadow-sm aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-foreground"
              // The swatch shows the theme's own colour: data, not the admin's look.
              style={{ backgroundColor: swatch.colour }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** How solid a colour is, 0 to 100: a slider and the number; solid (100) is no setting. Off while there is no colour. */
function OpacitySlider({
  label,
  colour,
  value,
  onChange,
  mark,
  muted = "",
}: {
  label: string;
  colour: string | undefined;
  value: number | undefined;
  onChange: (opacity: number | undefined) => void;
  mark?: ReactNode;
  muted?: string;
}) {
  const id = useId();
  const shown = value ?? 100;
  const set = (next: number) => onChange(next >= 100 ? undefined : Math.max(0, Math.round(next)));
  return (
    <div className={`flex flex-col gap-1 pt-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          Opacity
        </label>
        {mark}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={shown}
          disabled={colour === undefined}
          aria-valuetext={`${shown}%`}
          aria-describedby={`${id}-note`}
          onChange={(event) => set(Number(event.target.value))}
          className="w-40 accent-foreground disabled:opacity-50"
        />
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={shown}
          disabled={colour === undefined}
          aria-label={`${label}: opacity in per cent`}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(next)) set(Math.min(100, Math.max(0, next)));
          }}
          className="min-h-10 w-20 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
        />
        <span className="text-sm text-muted">%</span>
      </div>
      <span id={`${id}-note`} className="text-xs text-muted">
        {colour === undefined ? "Choose a colour first." : "100 is solid."}
      </span>
    </div>
  );
}
