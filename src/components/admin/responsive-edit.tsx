"use client";

import { Eye, Laptop, Monitor, Smartphone, Tablet, X, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useId, useState, type ReactNode } from "react";

import {
  SIZES,
  SIZE_LABELS,
  TYPICAL_SCREENS,
  ZOOMS,
  clampWidth,
  fitZoom,
  sizeRange,
  typicalWidth,
  type Breakpoints,
  type Size,
} from "@/lib/breakpoints";
import { clearAt, sizeSource, visibilityPatch, type SizeField, type SizeSource } from "@/lib/responsive";
import type { Show } from "@/lib/visibility";

import { DisplayFields, showPatch, type DisplaySetup } from "./display-fields";
import type { SizeOverrides } from "@/lib/page-content";

/**
 * Responsive editing in the page builder (D179 phase 2, `docs/responsive-editing.md` 5), after Beaver Builder: the
 * builder is edited at one of the four screen sizes at a time. Outside responsive mode it is Extra large and the canvas
 * is as wide as it can be; in it, a bar over the canvas chooses the size, the canvas's width and height and a zoom, and
 * every field whose setting can differ by size has a device icon that switches the whole builder to another size. A field
 * edits the size chosen (`setAt()` in `src/lib/responsive.ts`), shows what it inherits greyed with where it is from, and
 * can give an override back.
 */

/** The size the builder edits, whether responsive mode is on, and how to switch (entering the mode at that size). */
export type SizeEdit = { size: Size; active: boolean; choose: (size: Size) => void };

export const SizeEditContext = createContext<SizeEdit>({ size: "xl", active: false, choose: () => {} });

export const useSizeEdit = (): SizeEdit => useContext(SizeEditContext);

/** Beaver's devices: a monitor, a laptop, a tablet and a phone. */
export const SIZE_ICONS: Record<Size, LucideIcon> = { xl: Monitor, lg: Laptop, md: Tablet, sm: Smartphone };

export function DeviceIcon({ size, className = "size-4" }: { size: Size; className?: string }) {
  const Icon = SIZE_ICONS[size];
  return <Icon aria-hidden className={className} strokeWidth={1.75} />;
}

/**
 * The device icon beside a field: the size being edited; pressed, it offers the four sizes, and choosing one switches the
 * whole builder (and its canvas) to that size.
 */
export function SizeSwitch({ label }: { label: string }) {
  const { size, choose } = useSizeEdit();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="inline-flex items-center gap-0.5" data-size-switch="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: edited at ${SIZE_LABELS[size]}. Choose a screen size`}
        title="Edit at a screen size"
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground aria-expanded:bg-surface aria-expanded:text-foreground"
      >
        <DeviceIcon size={size} />
      </button>
      {open && (
        <span id={id} role="group" aria-label="Screen sizes" className="inline-flex items-center gap-0.5 rounded border border-border bg-background p-0.5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === size}
              aria-label={SIZE_LABELS[s]}
              title={SIZE_LABELS[s]}
              onClick={() => {
                choose(s);
                setOpen(false);
              }}
              className="flex size-7 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground aria-pressed:bg-foreground aria-pressed:text-background"
            >
              <DeviceIcon size={s} />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** Where a field's value comes from at the size edited: set there, inherited from a larger size, or the default. */
export function sizeNote(source: SizeSource, size: Size): string {
  if (source.own) return `Set for ${SIZE_LABELS[size]}`;
  return source.from ? `From ${SIZE_LABELS[source.from]}` : "Default";
}

/** Classes that grey a field's value while it is only inherited at the size edited (its own once changed). */
export const inheritedClass = (source: SizeSource, size: Size): string =>
  size !== "xl" && !source.own ? "[&_input]:text-muted [&_label]:text-muted [&_output]:text-muted" : "";

/**
 * Beside a field's name: its device icon, and below Extra large where its value comes from ("From Large"), or the size's
 * own mark with a × that gives the override back.
 */
export function SizeMark({
  part,
  field,
  label,
  onPatch,
}: {
  part: { at?: SizeOverrides } & Record<string, unknown>;
  field: SizeField;
  /** The field's name, for the buttons' labels. */
  label: string;
  /** The part's change when the override is given back. */
  onPatch: (patch: { at: SizeOverrides | undefined }) => void;
}) {
  const { size } = useSizeEdit();
  const source = sizeSource(part, size, field);
  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle text-xs font-normal">
      <SizeSwitch label={label} />
      {size !== "xl" &&
        (source.own ? (
          <>
            <span data-size-own="" className="rounded bg-surface px-1.5 py-0.5 text-foreground">
              {sizeNote(source, size)}
            </span>
            <button
              type="button"
              onClick={() => onPatch(clearAt(part, size, field))}
              aria-label={`Clear ${label.toLowerCase()} for ${SIZE_LABELS[size]}, to take it from the larger sizes again`}
              title="Clear: take it from the larger sizes"
              className="flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </>
        ) : (
          <span data-size-from="" className="text-muted">
            {sizeNote(source, size)}
          </span>
        ))}
    </span>
  );
}

/** A field's own heading with its size mark, for fields that have none of their own (a number, a slider). */
export function SizeHeading({ children, mark }: { children: ReactNode; mark: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm font-medium">
      {children}
      {mark}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visibility (the Advanced tab)
// ---------------------------------------------------------------------------

/**
 * Where a part shows (Beaver's Advanced tab, Visibility): **Breakpoint**, the four sizes, each shown (pressed) or hidden.
 * Hidden at a size is CSS on the site; the canvas keeps the part, faded with a grey eye. `locked` says why a part cannot
 * be hidden (the withdrawal link, D153).
 */
export function VisibilityFields({
  part,
  onChange,
  locked,
  display,
}: {
  part: { visibility?: { hideAt?: Size[]; show?: Show } };
  onChange: (patch: { visibility: { hideAt?: Size[]; show?: Show } | undefined }) => void;
  locked?: string;
  /** Who sees the part (phase 4): the page's facts and the store's choices; `locked` says why it is always shown. Absent: no Display. */
  display?: { setup: DisplaySetup; locked?: string };
}) {
  const hidden = new Set(part.visibility?.hideAt ?? []);
  const hint = useId();
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
      <legend className="float-left mb-1 w-full font-medium">Visibility</legend>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id={`${hint}-label`}>
          Breakpoint
        </span>
        <div role="group" aria-labelledby={`${hint}-label`} aria-describedby={hint} className="flex flex-wrap gap-2">
          {SIZES.map((size) => {
            const shown = !hidden.has(size);
            return (
              <button
                key={size}
                type="button"
                aria-pressed={shown}
                disabled={Boolean(locked)}
                onClick={() => onChange(visibilityPatch(part, size, !shown))}
                title={`${SIZE_LABELS[size]}: ${shown ? "shown" : "hidden"}`}
                className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background disabled:opacity-50"
              >
                <DeviceIcon size={size} />
                <span>{SIZE_LABELS[size]}</span>
                <span className="sr-only">{shown ? ", shown" : ", hidden"}</span>
              </button>
            );
          })}
        </div>
        <p id={hint} className="text-xs text-muted">
          {locked ??
            "Pressed: shown at that screen size. A part hidden at a size is left out there on the site; the editor keeps it, faded, with a grey eye."}
        </p>
      </div>
      {/* Display (phase 4, docs/responsive-editing.md 6): always, never, signed in, signed out or by conditions, left out by the server. */}
      {display && (
        <DisplayFields
          show={part.visibility?.show}
          setup={display.setup}
          locked={display.locked}
          onChange={(show) => onChange(showPatch(part.visibility, show))}
        />
      )}
    </fieldset>
  );
}

/** The grey eye on a part of the canvas hidden at some sizes: shown (by the canvas's rules) only at those sizes. */
export function HiddenBadge({ hideAt }: { hideAt: Size[] | undefined }) {
  if (!hideAt || hideAt.length === 0) return null;
  const names = hideAt.map((size) => SIZE_LABELS[size]).join(", ");
  return (
    <span
      data-builder-hidden=""
      title={`Hidden on the site at: ${names}`}
      className="pointer-events-none absolute top-1 right-1 z-20 hidden items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted shadow-sm"
    >
      <Eye aria-hidden className="size-3.5" />
      <span>Hidden</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Responsive mode: the canvas at a size, and its bar
// ---------------------------------------------------------------------------

/** The canvas in responsive mode: the size edited, the canvas's width and height in CSS pixels, and its zoom in per cent. */
export type CanvasView = { size: Size; width: number; height: number; zoom: number };

/** The canvas's room around the page: its padding and border, for fitting it. */
export const CANVAS_GUTTER = 50;

/**
 * The builder's responsive mode: null outside it (Extra large, the canvas as wide as it can be). Choosing a size enters it
 * at that size's typical width and height, zoomed to fit `room()` until a zoom is chosen. Pure state; the builder draws it.
 */
export function useResponsiveMode(breakpoints: Breakpoints, room: () => number) {
  const [view, setView] = useState<CanvasView | null>(null);
  const [zoomChosen, setZoomChosen] = useState(false);
  const atSize = useCallback(
    (size: Size, previous: CanvasView | null, keepZoom: boolean): CanvasView => {
      const width = typicalWidth(breakpoints, size);
      return { size, width, height: TYPICAL_SCREENS[size].height, zoom: keepZoom && previous ? previous.zoom : fitZoom(room(), width + CANVAS_GUTTER) };
    },
    [breakpoints, room],
  );
  const choose = useCallback(
    (size: Size) => setView((previous) => (previous?.size === size ? previous : atSize(size, previous, zoomChosen))),
    [atSize, zoomChosen],
  );
  const exit = useCallback(() => {
    setView(null);
    setZoomChosen(false);
  }, []);
  const toggle = useCallback(() => {
    if (view) exit();
    else choose("md");
  }, [view, exit, choose]);
  return {
    view,
    choose,
    exit,
    toggle,
    setWidth: (width: number) => setView((v) => (v ? { ...v, width: clampWidth(breakpoints, v.size, width) } : v)),
    setHeight: (height: number) => setView((v) => (v ? { ...v, height: Math.min(4000, Math.max(320, Math.round(height) || v.height)) } : v)),
    setZoom: (zoom: number) => {
      setZoomChosen(true);
      setView((v) => (v ? { ...v, zoom } : v));
    },
  };
}

/** Whether a key press is in something that takes typing, where the builder's shortcuts stay out of the way. */
export function typingIn(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

/** Ctrl or Cmd, Shift and R: responsive mode on or off. */
export const isResponsiveShortcut = (event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "r";

const barField = "min-h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground";

/** A number typed and kept on leaving the field or Enter (kept within its range by the caller). */
function PixelsField({ label, value, onCommit, min, max }: { label: string; value: number; onCommit: (value: number) => void; min: number; max: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const wanted = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(wanted)) onCommit(wanted);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      className={`${barField} w-20 tabular-nums`}
    />
  );
}

/**
 * The bar over the canvas in responsive mode (Beaver's): the screen size, the canvas's width (within the size) × height in
 * pixels, the zoom, and Exit.
 */
export function ResponsiveBar({
  view,
  breakpoints,
  onSize,
  onWidth,
  onHeight,
  onZoom,
  onExit,
}: {
  view: CanvasView;
  breakpoints: Breakpoints;
  onSize: (size: Size) => void;
  onWidth: (width: number) => void;
  onHeight: (height: number) => void;
  onZoom: (zoom: number) => void;
  onExit: () => void;
}) {
  const range = sizeRange(breakpoints, view.size);
  const id = useId();
  return (
    <div
      role="toolbar"
      aria-label="Responsive editing"
      data-responsive-bar=""
      className="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background px-3 py-2 shadow-sm"
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <DeviceIcon size={view.size} />
        <span className="sr-only">Screen size</span>
        <select value={view.size} onChange={(event) => onSize(event.target.value as Size)} className={barField}>
          {SIZES.map((size) => {
            const r = sizeRange(breakpoints, size);
            return (
              <option key={size} value={size}>
                {SIZE_LABELS[size]} ({size === "xl" ? `${r.min} px and wider` : size === "sm" ? `under ${r.max + 1} px` : `${r.min}–${r.max} px`})
              </option>
            );
          })}
        </select>
      </label>
      <span className="flex items-center gap-1.5 text-sm" aria-describedby={`${id}-range`}>
        <PixelsField label="Width in pixels" value={view.width} min={range.min} max={range.max} onCommit={onWidth} />
        <span aria-hidden className="text-muted">
          ×
        </span>
        <PixelsField label="Height in pixels" value={view.height} min={320} max={4000} onCommit={onHeight} />
        <span className="text-muted">px</span>
      </span>
      <span id={`${id}-range`} className="sr-only">
        The width stays between {range.min} and {range.max} pixels for {SIZE_LABELS[view.size]}.
      </span>
      <label className="flex items-center gap-2 text-sm">
        Zoom
        <select value={view.zoom} onChange={(event) => onZoom(Number(event.target.value))} className={barField}>
          {(ZOOMS.includes(view.zoom as (typeof ZOOMS)[number]) ? ZOOMS : [...ZOOMS, view.zoom]).map((zoom) => (
            <option key={zoom} value={zoom}>
              {zoom} %
            </option>
          ))}
        </select>
      </label>
      <p className="hidden text-xs text-muted lg:block">Settings you change now are for {SIZE_LABELS[view.size]} and smaller.</p>
      <button
        type="button"
        onClick={onExit}
        aria-keyshortcuts="Control+Shift+R Meta+Shift+R"
        className="ml-auto min-h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface"
      >
        Exit
      </button>
    </div>
  );
}

/** The builder's toolbar button that turns responsive mode on and off. */
export function ResponsiveToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      aria-keyshortcuts="Control+Shift+R Meta+Shift+R"
      title="Responsive editing (Ctrl or ⌘ + Shift + R)"
      className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-surface aria-pressed:font-medium"
    >
      <span aria-hidden className="flex items-center gap-0.5">
        <Monitor className="size-4" strokeWidth={1.75} />
        <Smartphone className="size-3.5" strokeWidth={1.75} />
      </span>
      Responsive
    </button>
  );
}

/** The toolbar switch for parts hidden at the size shown: faded with an eye (the default), or left out as on the site. */
export function HiddenPartsToggle({ hide, onChange }: { hide: boolean; onChange: (hide: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hide}
      onClick={() => onChange(!hide)}
      title="Parts hidden at the size shown, never shown, or shown only to some visitors (by sign-in or conditions)"
      className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm aria-checked:border-foreground aria-checked:bg-surface aria-checked:font-medium"
    >
      <Eye aria-hidden className="size-4" strokeWidth={1.75} />
      {hide ? "Hidden parts left out" : "Hidden parts shown faded"}
    </button>
  );
}
