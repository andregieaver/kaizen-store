"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { CONTENT_MAX_MAX, CONTENT_MAX_MIN } from "@/lib/page-content";
import { MIN_SHARE, dragWidth, moveEdge, sharesOf } from "@/lib/resize";

/**
 * Dragging on the page builder's canvas, after Beaver Builder's: a row's side edges change how wide its content may be,
 * and the edge between two columns changes how the row's width is shared. Both work at the screen size being edited, from
 * the keyboard too (the arrow keys), and a double press gives the layout's own back. What they change is written by the
 * builder (`onWidth`, `onShares`); the arithmetic is `src/lib/resize.ts`. The handles show while the row is pointed at
 * (`[data-resize-handle]` in globals.css).
 */

/** How far the pointer has moved since the drag began, in the page's own pixels (the canvas can be zoomed). */
function scaleOf(element: HTMLElement): number {
  const width = element.offsetWidth;
  return width > 0 ? element.getBoundingClientRect().width / width : 1;
}

const handleClass =
  "absolute z-20 flex touch-none items-center justify-center rounded-full bg-blue-600 text-white shadow outline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * A row's two side edges. `inset` is the room between the frame they sit in and the content (its padding), so the handles
 * sit on the content's edges. Each moves both edges, as the content stays in the middle.
 */
export function RowWidthHandles({
  inset,
  value,
  label,
  onWidth,
  onReset,
}: {
  inset: number;
  /** The width the row sets at this size, in pixels; null when it takes the theme's. */
  value: number | null;
  label: string;
  /** The width, in pixels, as it is dragged or stepped. */
  onWidth: (px: number) => void;
  /** Takes the row's own width away. */
  onReset: () => void;
}) {
  const [reading, setReading] = useState<number | null>(null);
  const start = useRef<{ x: number; px: number; scale: number; side: 1 | -1; room: number } | null>(null);

  const begin = (side: 1 | -1) => (event: PointerEvent<HTMLElement>) => {
    const frame = event.currentTarget.offsetParent as HTMLElement | null;
    if (!frame || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = scaleOf(frame);
    const room = frame.parentElement ? frame.parentElement.clientWidth - 0 : frame.offsetWidth;
    start.current = { x: event.clientX, px: frame.offsetWidth - 2 * inset, scale, side, room };
    setReading(Math.round(start.current.px));
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = start.current;
    if (!g) return;
    // Both edges move together, so the pointer's distance counts twice.
    const next = dragWidth(g.px + (((event.clientX - g.x) / g.scale) * g.side * 2), { free: event.shiftKey, room: Math.max(g.room - 2 * inset, g.px) });
    setReading(next);
    onWidth(next);
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (!start.current) return;
    start.current = null;
    setReading(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const frame = event.currentTarget.offsetParent as HTMLElement | null;
    if (!frame) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onReset();
      return;
    }
    const step = event.shiftKey ? 1 : 16;
    const grow = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (grow === 0) return;
    event.preventDefault();
    const current = value ?? frame.offsetWidth - 2 * inset;
    onWidth(dragWidth(current + grow * step, { free: true }));
  };

  const side = (name: "left" | "right", sign: 1 | -1) => (
    <div
      role="slider"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={`${label}, ${name} edge`}
      aria-valuemin={CONTENT_MAX_MIN}
      aria-valuemax={CONTENT_MAX_MAX}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value ? `${value} pixels` : "The theme's content width"}
      title="Drag to change the content width; Shift for free steps; double-click for the theme's"
      data-resize-handle="row-width"
      data-active={reading !== null ? "" : undefined}
      onPointerDown={begin(sign)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={keys}
      style={{ [name]: Math.max(0, inset - 6) }}
      className={`${handleClass} top-1/2 h-14 w-3 -translate-y-1/2 cursor-ew-resize`}
    >
      <span aria-hidden className="h-6 w-0.5 rounded bg-white/80" />
    </div>
  );
  return (
    <>
      {side("left", -1)}
      {side("right", 1)}
      {reading !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 left-1/2 z-30 -translate-x-1/2 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow"
        >
          {reading} px
        </div>
      )}
    </>
  );
}

/**
 * The edges between a row's side-by-side columns, drawn as the last children of the grid that holds them. Their places are measured from the columns
 * (the grid's own tracks), so they follow whatever the columns come to; a drag gives every column a share of 100.
 */
export function ColumnDividers({
  count,
  signature,
  label,
  onShares,
  onReset,
}: {
  count: number;
  /** Changes when the columns' shares do, so the edges are measured again. */
  signature: string;
  label: string;
  /** Every column's share of 100 as it is dragged or stepped. */
  onShares: (shares: number[]) => void;
  /** Gives the layout's shares back. */
  onReset: () => void;
}) {
  const [measured, setMeasured] = useState<{ lefts: number[]; shares: number[] }>({ lefts: [], shares: [] });
  const [reading, setReading] = useState<{ edge: number; shares: number[] } | null>(null);
  const drag = useRef<{ x: number; total: number; shares: number[]; edge: number } | null>(null);

  // The grid is this component's parent: it is found through a marker of its own, as the grid's ref is not set yet when this first runs.
  const anchor = useRef<HTMLSpanElement>(null);
  const columns = (): HTMLElement[] => {
    const grid = anchor.current?.parentElement;
    return grid ? ([...grid.children] as HTMLElement[]).filter((child) => child.dataset.builderItem === "column") : [];
  };

  useLayoutEffect(() => {
    const element = anchor.current?.parentElement;
    if (!element || count < 2) return;
    const measure = () => {
      const kids = columns();
      const box = element.getBoundingClientRect();
      const scale = scaleOf(element);
      setMeasured({
        lefts: kids.slice(0, -1).map((kid, i) => {
          const a = kid.getBoundingClientRect();
          const b = kids[i + 1].getBoundingClientRect();
          return ((a.right + b.left) / 2 - box.left) / scale;
        }),
        shares: sharesOf(kids.map((kid) => kid.getBoundingClientRect().width)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const kid of columns()) observer.observe(kid);
    return () => observer.disconnect();
    // The columns are the grid's children; they are measured again when their number or shares change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, signature]);

  const marker = <span ref={anchor} className="hidden" aria-hidden />;
  if (count < 2 || measured.lefts.length !== count - 1) return marker;
  const measure = () => {
    const widths = columns().map((kid) => kid.getBoundingClientRect().width);
    return { widths, shares: sharesOf(widths) };
  };

  const begin = (edge: number) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { widths, shares } = measure();
    drag.current = { x: event.clientX, total: widths.reduce((sum, width) => sum + width, 0), shares, edge };
    setReading({ edge, shares });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || g.total <= 0) return;
    const next = moveEdge(g.shares, g.edge, ((event.clientX - g.x) / g.total) * 100);
    setReading({ edge: g.edge, shares: next });
    onShares(next);
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setReading(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keys = (edge: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onReset();
      return;
    }
    const move = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (move === 0) return;
    event.preventDefault();
    onShares(moveEdge(measure().shares, edge, move * (event.shiftKey ? 5 : 1)));
  };

  return (
    <>
      {marker}
      {measured.lefts.map((left, edge) => {
        const shares = reading?.edge === edge ? reading.shares : null;
        return (
          <div
            key={edge}
            role="slider"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={`${label}, edge between column ${edge + 1} and ${edge + 2}`}
            aria-valuemin={MIN_SHARE}
            aria-valuemax={100 - MIN_SHARE}
            aria-valuenow={measured.shares[edge]}
            aria-valuetext={`${measured.shares[edge]} percent for the column before it. Arrow keys move it by one percent, with Shift by five; Delete gives back the layout's widths`}
            title="Drag to share the row's width; double-click for the layout's"
            data-resize-handle="column"
            data-active={shares ? "" : undefined}
            onPointerDown={begin(edge)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={onReset}
            onKeyDown={keys(edge)}
            style={{ left: left - 6 }}
            className={`${handleClass} top-1/2 z-30 h-14 w-3 -translate-y-1/2 cursor-col-resize`}
          >
            <span aria-hidden className="h-6 w-0.5 rounded bg-white/80" />
            {shares && (
              <span
                role="status"
                className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow"
              >
                {shares[edge]}% | {shares[edge + 1]}%
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
