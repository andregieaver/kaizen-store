"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useAdminText } from "@/components/admin/admin-text";

/**
 * Moving a window by its title bar and resizing it from any edge or corner: the builder's settings panel (`FloatingPanel`) and
 * every dialog on `Modal` (the media library, text styles, templates…) share it, so they all move and resize the same way.
 *
 * A window with no place of its own (`rect` null) sits where its CSS puts it (a dialog: centred); the first drag or resize takes
 * its place and size from where it is on the screen. A window given `remember` keeps its last place and size in the browser
 * under that name, kept inside the window it opens in.
 */

export type PanelRect = { x: number; y: number; w: number; h: number | null };

/** A window is never smaller than this, so its fields stay usable. */
export const PANEL_MIN = { w: 360, h: 240 } as const;
/** How much of the title bar stays in the window when it is dragged toward an edge. */
const GRIP = 96;
export const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type PanelEdge = (typeof EDGES)[number];

export type Viewport = { w: number; h: number };

/** Where a panel of this default width opens: centred, a little above the middle. */
export function defaultRect(view: Viewport, wide: boolean): PanelRect {
  const w = Math.min(wide ? 768 : 512, Math.max(PANEL_MIN.w, view.w - 32));
  return { x: Math.max(0, Math.round((view.w - w) / 2)), y: Math.max(8, Math.round(view.h * 0.06)), w, h: null };
}

/** The window kept inside the browser's: at least `PANEL_MIN` and no larger than it, its title bar always reachable. */
export function clampRect(rect: PanelRect, view: Viewport): PanelRect {
  const w = Math.max(Math.min(PANEL_MIN.w, view.w), Math.min(rect.w, view.w));
  const h = rect.h === null ? null : Math.max(Math.min(PANEL_MIN.h, view.h), Math.min(rect.h, view.h));
  const x = Math.min(Math.max(rect.x, GRIP - w), view.w - GRIP);
  const y = Math.min(Math.max(rect.y, 0), view.h - 48);
  return { x, y, w, h };
}

/** A drag of an edge or corner by (dx, dy) from the rectangle it began at: the opposite edge stays where it is. */
export function resizeRect(start: PanelRect & { h: number }, edge: PanelEdge, dx: number, dy: number, view: Viewport): PanelRect {
  let { x, y, w, h } = start;
  if (edge.includes("e")) w = Math.min(Math.max(start.w + dx, PANEL_MIN.w), view.w - start.x);
  if (edge.includes("s")) h = Math.min(Math.max(start.h + dy, PANEL_MIN.h), view.h - start.y);
  if (edge.includes("w")) {
    const right = start.x + start.w;
    w = Math.min(Math.max(start.w - dx, PANEL_MIN.w), right);
    x = right - w;
  }
  if (edge.includes("n")) {
    const bottom = start.y + start.h;
    h = Math.min(Math.max(start.h - dy, PANEL_MIN.h), bottom);
    y = bottom - h;
  }
  return { x, y, w, h };
}

/** The storage key a remembered window is kept under. The settings panel keeps the key it always had. */
const storageKey = (name: string) => (name === "settings-panel" ? "kaizen-builder-settings-panel" : `kaizen-window-${name}`);

export function readStoredRect(name: string): PanelRect | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(name)) ?? "null");
    if (value && ["x", "y", "w"].every((k) => Number.isFinite(value[k])) && (value.h === null || Number.isFinite(value.h))) return value as PanelRect;
  } catch {
    // Storage may be blocked or hold something else: the default place is used.
  }
  return null;
}

function writeStored(name: string | undefined, rect: PanelRect | null) {
  if (!name || !rect) return;
  try {
    window.localStorage.setItem(storageKey(name), JSON.stringify(rect));
  } catch {
    // Not remembered; the window works the same.
  }
}

const CURSORS: Record<PanelEdge, string> = {
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
  e: "cursor-ew-resize",
  w: "cursor-ew-resize",
  ne: "cursor-nesw-resize",
  sw: "cursor-nesw-resize",
  nw: "cursor-nwse-resize",
  se: "cursor-nwse-resize",
};
// Written out whole so Tailwind finds every class.
const HANDLES: Record<PanelEdge, string> = {
  n: "inset-x-3 -top-1 h-2",
  s: "inset-x-3 -bottom-1 h-2",
  e: "inset-y-3 -right-1 w-2",
  w: "inset-y-3 -left-1 w-2",
  ne: "-top-1 -right-1 size-4",
  nw: "-top-1 -left-1 size-4",
  se: "-bottom-1 -right-1 size-4",
  sw: "-bottom-1 -left-1 size-4",
};

/** The window's size; a typical one where there is no window (nothing is moved on the server). */
export const viewport = (): Viewport => (typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight });

type Gesture = { edge: PanelEdge | "move"; startX: number; startY: number; from: PanelRect & { h: number } };

/**
 * The state and handlers that make an element movable and resizable. Spread `bar` on its title bar, put `MoveButton` and
 * `ResizeHandles` in it, and `windowStyle(rect)` (or the panel's own) on the element.
 */
export function useMovable<T extends HTMLElement>({ remember, initial }: { remember?: string; initial?: () => PanelRect | null } = {}) {
  const ref = useRef<T>(null);
  const [rect, setRect] = useState<PanelRect | null>(() => (initial ? initial() : null));
  const rectRef = useRef(rect);
  const gesture = useRef<Gesture | null>(null);
  // When the last drag ended, so the click that ends it on a dialog's backdrop does not close the dialog.
  const lastGesture = useRef(0);

  const place = useCallback((next: PanelRect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  /** Back to the remembered place, else to where the CSS puts it: for a dialog that opens again. */
  const reset = useCallback(() => {
    const stored = remember ? readStoredRect(remember) : null;
    place(stored ? clampRect(stored, viewport()) : null);
  }, [place, remember]);

  // A smaller window pulls it back inside.
  useEffect(() => {
    const onResize = () => {
      if (rectRef.current) place(clampRect(rectRef.current, viewport()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  const begin = (event: PointerEvent<HTMLElement>) => {
    const element = ref.current;
    if (!element || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = element.getBoundingClientRect();
    // One with no place or height of its own takes the one it has now.
    gesture.current = {
      edge: (event.currentTarget.dataset.edge ?? "move") as PanelEdge | "move",
      startX: event.clientX,
      startY: event.clientY,
      from: { x: box.left, y: box.top, w: box.width, h: box.height },
    };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const view = viewport();
    place(
      g.edge === "move"
        ? clampRect({ x: g.from.x + dx, y: g.from.y + dy, w: g.from.w, h: rectRef.current?.h ?? null }, view)
        : resizeRect(g.from, g.edge, dx, dy, view),
    );
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current) return;
    gesture.current = null;
    lastGesture.current = Date.now();
    event.currentTarget.releasePointerCapture(event.pointerId);
    writeStored(remember, rectRef.current);
  };
  /** Arrow keys move it (Shift: resize it) from its move button, for people without a pointer. */
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 40 : 16;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    const box = ref.current?.getBoundingClientRect();
    if (!box || (dx === 0 && dy === 0)) return;
    event.preventDefault();
    const view = viewport();
    const next = event.shiftKey
      ? resizeRect({ x: box.left, y: box.top, w: box.width, h: box.height }, "se", dx, dy, view)
      : clampRect({ x: box.left + dx, y: box.top + dy, w: box.width, h: rectRef.current?.h ?? null }, view);
    place(next);
    writeStored(remember, next);
  };

  const pointer = { onPointerDown: begin, onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return {
    ref,
    rect,
    place,
    reset,
    /** On the title bar: dragging it moves the window. */
    bar: { "data-edge": "move", ...pointer },
    /** On each resize handle (`ResizeHandles` draws them). */
    pointer,
    keys,
    /** True for a click that only ends a drag, which must not count as a click on a dialog's backdrop. */
    justMoved: () => Date.now() - lastGesture.current < 300,
  };
}

export type Movable = ReturnType<typeof useMovable>;

/** Placement for a native `<dialog>` that has been moved or resized; nothing while it sits where its CSS puts it. */
export function dialogStyle(rect: PanelRect | null, tallest = "90dvh") {
  if (!rect) return undefined;
  return {
    margin: 0,
    left: rect.x,
    top: rect.y,
    right: "auto",
    bottom: "auto",
    width: rect.w,
    maxWidth: "100vw",
    ...(rect.h === null ? { maxHeight: tallest } : { height: rect.h, maxHeight: "100dvh" }),
  } as const;
}

/**
 * After `showModal()`: the browser focuses the first thing that takes focus, which is now the move button. Focus goes on to
 * the next one, as it did before the dialog had a move button.
 */
export function focusPastMoveButton(dialog: HTMLElement) {
  if (!document.activeElement?.hasAttribute("data-move-button")) return;
  const next = [...dialog.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].find(
    (element) => !element.hasAttribute("data-move-button") && !element.matches(":disabled") && element.offsetParent !== null,
  );
  next?.focus();
}

/** The eight places to resize from, on the edges and corners of the element they are in (which must be positioned). */
export function ResizeHandles({ movable }: { movable: Pick<Movable, "pointer"> }) {
  return EDGES.map((edge) => (
    <div key={edge} aria-hidden data-resize={edge} data-edge={edge} {...movable.pointer} className={`absolute z-10 touch-none ${HANDLES[edge]} ${CURSORS[edge]}`} />
  ));
}

/** The title bar's move button: arrow keys move the window, Shift and the arrow keys resize it. */
export function MoveButton({ movable }: { movable: Pick<Movable, "keys"> }) {
  const ui = useAdminText("common").ui;
  return (
    <button
      type="button"
      aria-label={ui.movePanel}
      data-move-button=""
      title={ui.movePanelHint}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={movable.keys}
      className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-sunken"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
      </svg>
    </button>
  );
}
