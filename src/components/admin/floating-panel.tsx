"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * The settings panel of a row, column or component in the page builder: a floating, non-modal panel the editor can move
 * by its title bar and resize from any edge or corner, while the page behind it stays in use (clicking another part
 * opens that part's settings in it). Its place and size are remembered in the browser, kept inside the window, and
 * given back to the default one when the window cannot hold them.
 *
 * Same props as `Modal`; Escape or Close closes it, and focus returns to where it was.
 */

export type PanelRect = { x: number; y: number; w: number; h: number | null };

/** The panel is never smaller than this, so its fields stay usable. */
export const PANEL_MIN = { w: 360, h: 240 } as const;
/** How much of the title bar stays in the window when the panel is dragged toward an edge. */
const GRIP = 96;
const STORAGE_KEY = "kaizen-builder-settings-panel";
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type PanelEdge = (typeof EDGES)[number];

type Viewport = { w: number; h: number };

/** Where a panel of this default width opens: centred, a little above the middle. */
export function defaultRect(view: Viewport, wide: boolean): PanelRect {
  const w = Math.min(wide ? 768 : 512, Math.max(PANEL_MIN.w, view.w - 32));
  return { x: Math.max(0, Math.round((view.w - w) / 2)), y: Math.max(8, Math.round(view.h * 0.06)), w, h: null };
}

/** The panel kept inside the window: at least `PANEL_MIN` and no larger than the window, its title bar always reachable. */
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

function readStored(): PanelRect | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && ["x", "y", "w"].every((k) => Number.isFinite(value[k])) && (value.h === null || Number.isFinite(value.h))) return value as PanelRect;
  } catch {
    // Storage may be blocked or hold something else: the default place is used.
  }
  return null;
}

function writeStored(rect: PanelRect) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
  } catch {
    // Not remembered; the panel works the same.
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

/** The window's size; a typical one where there is no window (the server draws a panel only if one is open at first, which none is). */
const viewport = (): Viewport => (typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight });

export function FloatingPanel(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Made when it opens, so its place is worked out from the window as it is then, never on the server.
  return props.open ? <PlacedPanel {...props} /> : null;
}

function PlacedPanel({
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Where it was last left (kept inside this window), else its default place.
  const [rect, setRect] = useState<PanelRect>(() => {
    const view = viewport();
    return clampRect(readStored() ?? defaultRect(view, wide), view);
  });
  const rectRef = useRef(rect);
  const gesture = useRef<{ edge: PanelEdge | "move"; startX: number; startY: number; from: PanelRect & { h: number } } | null>(null);

  const place = useCallback((next: PanelRect) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  // Focus is in the panel while it is open and goes back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // As a dialog did: the first field to write in, else the panel itself.
    const first = ref.current?.querySelector<HTMLElement>('[data-panel-body] :is(input:not([type="hidden"], [type="color"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable="true"])');
    (first ?? ref.current)?.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, []);

  // A smaller window pulls the panel back inside it.
  useEffect(() => {
    const onResize = () => place(clampRect(rectRef.current, viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  const begin = (event: PointerEvent<HTMLElement>) => {
    const panel = ref.current;
    if (!panel || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = panel.getBoundingClientRect();
    // A panel with no height of its own takes the one it has now when it is first resized.
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
        ? clampRect({ x: g.from.x + dx, y: g.from.y + dy, w: g.from.w, h: rectRef.current.h }, view)
        : resizeRect(g.from, g.edge, dx, dy, view),
    );
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current) return;
    gesture.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    writeStored(rectRef.current);
  };
  /** Arrow keys move the panel (Shift: resize it) from its move button, for people without a pointer. */
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
      : clampRect({ x: box.left + dx, y: box.top + dy, w: box.width, h: rectRef.current.h }, view);
    place(next);
    writeStored(next);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-settings-panel=""
      onKeyDown={(event) => {
        // A dialog opened from inside the panel (a picker) takes its own Escape.
        if (event.key === "Escape" && !event.defaultPrevented && !(event.target as HTMLElement).closest("dialog")) onClose();
      }}
      style={{ left: rect.x, top: rect.y, width: rect.w, ...(rect.h !== null && { height: rect.h }), maxHeight: rect.h === null ? "90dvh" : undefined }}
      className="fixed z-50 flex max-w-[100vw] flex-col rounded-lg border border-border bg-background text-foreground shadow-2xl outline-none"
    >
      <div
        data-edge="move"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="flex cursor-move touch-none items-center justify-between gap-4 rounded-t-lg border-b border-border px-5 py-3 select-none"
      >
        <h2 id={titleId} className="font-medium">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Move the panel"
            title="Focus this and press the arrow keys to move the panel; Shift and the arrow keys resize it"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={keys}
            className="flex size-9 items-center justify-center rounded-full hover:bg-surface"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
            </svg>
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full hover:bg-surface"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div data-panel-body="" className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      {EDGES.map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-resize={edge}
          data-edge={edge}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className={`absolute z-10 touch-none ${HANDLES[edge]} ${CURSORS[edge]}`}
        />
      ))}
    </div>
  );
}
