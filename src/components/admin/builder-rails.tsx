"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The builder's two sidebars can be folded away to leave the canvas more room (D125): a slim rail with a button to open
 * one again; and an open one can be made wider or narrower by dragging its edge by the canvas (D262). Each side's choices
 * are kept in this browser, and only there; both start open at their usual width, and the page works the same where
 * storage is blocked (the choice then lasts until the page is left).
 */

export type RailSide = "left" | "right";

export const RAIL_KEYS: Record<RailSide, string> = {
  left: "kaizen_admin_builder_left",
  right: "kaizen_admin_builder_right",
};

/** Where an open sidebar's width is kept, in pixels; none is its usual share of the room. */
export const RAIL_WIDTH_KEYS: Record<RailSide, string> = {
  left: "kaizen_admin_builder_left_width",
  right: "kaizen_admin_builder_right_width",
};

/** How narrow and how wide a sidebar can be dragged, in pixels; the canvas keeps at least `CANVAS_MIN`. */
export const RAIL_WIDTH = { min: 240, max: 720 } as const;
export const CANVAS_MIN = 400;

/** The stored word for a folded sidebar; anything else, or nothing, is open. */
export const FOLDED = "folded";

const listeners = new Set<() => void>();
/** This page's own memory of the choices by key, for where storage is missing; a `storage` event from another tab clears it. */
const memory = new Map<string, string | null>();

/** Whether a stored value means folded. */
export const isFolded = (value: string | null): boolean => value === FOLDED;

/** A stored width as a width a sidebar can have, or null (its usual share). */
export function railWidthOf(value: string | null): number | null {
  const width = Math.round(Number(value));
  return value !== null && value !== "" && Number.isFinite(width) ? Math.min(Math.max(width, RAIL_WIDTH.min), RAIL_WIDTH.max) : null;
}

function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* kept for this page only */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // Another tab chose: what it stored is the truth again.
    if (event.key === null) memory.clear();
    else memory.delete(event.key);
    changed();
  };
  listeners.add(changed);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(changed);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Whether a sidebar is folded, and a way to change it. The server and the first draw in the browser show it open; the
 * browser's own choice follows at once after.
 */
export function useFolded(side: RailSide): [boolean, (folded: boolean) => void] {
  const folded = useSyncExternalStore(
    subscribe,
    () => isFolded(readStored(RAIL_KEYS[side])),
    () => false,
  );
  const set = useCallback((next: boolean) => writeStored(RAIL_KEYS[side], next ? FOLDED : null), [side]);
  return [folded, set];
}

/** An open sidebar's width in pixels (null: its usual share), and a way to change it; null again goes back to the usual. */
export function useRailWidth(side: RailSide): [number | null, (width: number | null) => void] {
  const width = useSyncExternalStore(
    subscribe,
    () => railWidthOf(readStored(RAIL_WIDTH_KEYS[side])),
    () => null,
  );
  const set = useCallback((next: number | null) => writeStored(RAIL_WIDTH_KEYS[side], next === null ? null : String(railWidthOf(String(next)))), [side]);
  return [width, set];
}

const ICONS = {
  left: { fold: PanelLeftClose, open: PanelLeftOpen },
  right: { fold: PanelRightClose, open: PanelRightOpen },
} as const;

/** The button in an open sidebar's header that folds it away. */
export function FoldButton({
  side,
  label,
  controls,
  onFold,
}: {
  side: RailSide;
  label: string;
  controls: string;
  onFold: () => void;
}) {
  const Icon = ICONS[side].fold;
  const text = `Hide ${label}`;
  return (
    <button
      type="button"
      onClick={onFold}
      aria-label={text}
      title={text}
      aria-expanded
      aria-controls={controls}
      className="flex size-9 shrink-0 items-center justify-center rounded-pill text-muted hover:bg-sunken hover:text-ink"
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}

/**
 * What stands in a sidebar's place while it is folded: a narrow bar down the side of the page, and on phones, where the
 * sidebars stack, a full-width button with its words.
 */
export function Rail({
  side,
  label,
  controls,
  onOpen,
  className = "",
}: {
  side: RailSide;
  label: string;
  controls: string;
  onOpen: () => void;
  className?: string;
}) {
  const Icon = ICONS[side].open;
  const text = `Show ${label}`;
  return (
    <div
      className={`rounded-panel border border-line bg-card lg:sticky lg:top-4 lg:flex lg:justify-center lg:py-1 ${className}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={text}
        title={text}
        aria-expanded={false}
        aria-controls={controls}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-sunken lg:size-9 lg:min-h-0 lg:w-auto lg:justify-center lg:rounded-md lg:px-0"
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        <span className="lg:hidden">{text}</span>
      </button>
    </div>
  );
}

/** The header of an open sidebar: what it is, and the button that folds it. */
export function RailHeader({
  side,
  label,
  controls,
  onFold,
}: {
  side: RailSide;
  label: string;
  controls: string;
  onFold: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs tracking-wide text-muted uppercase text-title text-ink">{label}</h2>
      <FoldButton side={side} label={label} controls={controls} onFold={onFold} />
    </div>
  );
}

/** The room between a sidebar and the canvas, which is also where its edge is dragged (`RailResizer`). */
export const RAIL_GAP = "1.5rem";

/**
 * The builder's columns on a computer (`grid-template-columns`): each sidebar, folded to a narrow column, at the width it was
 * dragged to, or at its usual share (the canvas has twice an open sidebar's); the canvas takes the rest; between them the room
 * where their edges are dragged.
 */
export function railTemplate(left: { folded: boolean; width: number | null }, right: { folded: boolean; width: number | null }): string {
  const side = ({ folded, width }: { folded: boolean; width: number | null }) => (folded ? "2.75rem" : width !== null ? `${width}px` : "minmax(0,1fr)");
  return `${side(left)} ${RAIL_GAP} minmax(0,2fr) ${RAIL_GAP} ${side(right)}`;
}

/** The width a sidebar is dragged to: within its limits, and leaving the canvas its room. */
export function draggedWidth(start: number, moved: number, side: RailSide, room: { total: number; other: number }): number | null {
  const wanted = start + (side === "left" ? moved : -moved);
  const most = Math.min(RAIL_WIDTH.max, room.total - room.other - CANVAS_MIN);
  if (most < RAIL_WIDTH.min) return null;
  return Math.round(Math.min(Math.max(wanted, RAIL_WIDTH.min), most));
}

/**
 * The edge between an open sidebar and the canvas (D262): dragged with the pointer, or moved with the arrow keys, to make the
 * sidebar wider or narrower; a double press, Enter or Home gives it back its usual share. On a phone, where the sidebars stack,
 * it is not there. Folded, the room stays and nothing can be dragged.
 */
export function RailResizer({
  side,
  label,
  folded,
  width,
  onWidth,
  measure,
}: {
  side: RailSide;
  label: string;
  folded: boolean;
  width: number | null;
  onWidth: (width: number | null) => void;
  /** The sidebar's width now, the other's, and the whole room, as drawn. */
  measure: () => { own: number; other: number; total: number } | null;
}) {
  // The room between the sidebar and the canvas; its half by the sidebar is what is dragged (the canvas reaches into the other half for its rows' tools).
  if (folded) return <div aria-hidden className="hidden lg:block" />;
  const step = (by: number) => {
    const room = measure();
    if (!room) return;
    const next = draggedWidth(width ?? room.own, by, side, room);
    if (next !== null) onWidth(next);
  };
  return (
    <div className={`hidden lg:flex ${side === "left" ? "justify-start" : "justify-end"}`}>
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Width of the ${label}`}
      aria-valuenow={width ?? undefined}
      aria-valuemin={RAIL_WIDTH.min}
      aria-valuemax={RAIL_WIDTH.max}
      aria-valuetext={width === null ? "Usual width" : `${width} pixels`}
      tabIndex={0}
      title={`Drag to make the ${label} wider or narrower. Double-click for the usual width.`}
      onPointerDown={(event) => {
        const room = measure();
        if (!room || event.button !== 0) return;
        event.preventDefault();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = room.own;
        const move = (moving: PointerEvent) => {
          const next = draggedWidth(startWidth, moving.clientX - startX, side, room);
          if (next !== null) onWidth(next);
        };
        const end = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", end);
          target.removeEventListener("pointercancel", end);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", end);
        target.addEventListener("pointercancel", end);
      }}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={(event) => {
        const by = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") step(side === "left" ? -by : by);
        else if (event.key === "ArrowRight") step(side === "left" ? by : -by);
        else if (event.key === "Enter" || event.key === "Home") onWidth(null);
        else return;
        event.preventDefault();
      }}
      className="group relative z-10 flex w-3 cursor-col-resize touch-none justify-center rounded-pill outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span
        aria-hidden
        className="my-auto h-16 w-1 rounded-pill bg-line transition-colors group-hover:bg-brand group-focus-visible:bg-brand group-active:bg-brand"
      />
    </div>
    </div>
  );
}

/**
 * The header of an open sidebar that holds more than one thing (the page builder's Building blocks and Theme): the
 * choices as tabs where its name would be, and the button that folds it. The panels are the caller's, each told by
 * `aria-controls`.
 */
export function RailTabsHeader<K extends string>({
  side,
  label,
  controls,
  onFold,
  tabs,
  value,
  onChange,
}: {
  side: RailSide;
  /** What the sidebar is called when it is folded or unfolded. */
  label: string;
  controls: string;
  onFold: () => void;
  tabs: readonly { key: K; label: string; panel: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.key);
    document.getElementById(`${controls}-head-${next.key}`)?.focus();
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div role="tablist" aria-label={label} className="flex items-center gap-4">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            id={`${controls}-head-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={value === tab.key}
            aria-controls={tab.panel}
            tabIndex={value === tab.key ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-9 border-b-2 border-transparent text-eyebrow text-muted uppercase aria-selected:border-brand aria-selected:text-ink"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <FoldButton side={side} label={label} controls={controls} onFold={onFold} />
    </div>
  );
}
