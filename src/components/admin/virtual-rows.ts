"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { visibleRange } from "@/lib/variant-grid";

/**
 * Draws only the rows on screen (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.4), for a list of thousands in the page's own scroll. Each row
 * is measured when it is drawn (and again when it changes size, a section opened inside it), rows not yet drawn count at `estimate` pixels,
 * and a spacer above and below keeps the scrollbar where it would be with every row drawn. Off (`enabled` false), every row is drawn.
 */
export function useVirtualRows({ keys, estimate, overscan = 600, enabled }: { keys: readonly string[]; estimate: number; overscan?: number; enabled: boolean }) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [view, setView] = useState({ top: 0, bottom: 1200 });

  // Where the list is on the screen: any scroll (the page's or a box's) or a resize can move it.
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      // A screenful from the list's top on screen; a list still below the screen draws its first screenful, so the keyboard reaches its rows.
      const top = Math.max(0, Math.round(-box.top));
      const bottom = top + window.innerHeight;
      setView((was) => (Math.abs(was.top - top) < 40 && Math.abs(was.bottom - bottom) < 40 ? was : { top, bottom }));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    document.addEventListener("scroll", soon, { capture: true, passive: true });
    window.addEventListener("resize", soon);
    return () => {
      document.removeEventListener("scroll", soon, { capture: true });
      window.removeEventListener("resize", soon);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  // One observer for every row drawn: a row that grows (its details opened) moves the rows below it.
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver((entries) => {
      const seen = entries.flatMap((entry) => {
        const key = (entry.target as HTMLElement).dataset.rowKey;
        const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).getBoundingClientRect().height);
        return key && height > 0 ? [[key, height] as const] : [];
      });
      setHeights((was) => {
        if (seen.every(([key, height]) => was.get(key) === height)) return was;
        const next = new Map(was);
        for (const [key, height] of seen) next.set(key, height);
        return next;
      });
    });
    return () => observer.current?.disconnect();
  }, [enabled]);

  /** The ref for the row with this key: measured while it is drawn. */
  const measure = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (!element || !enabled) return;
      element.dataset.rowKey = key;
      const watching = observer.current;
      watching?.observe(element);
      return () => watching?.unobserve(element);
    },
    [enabled],
  );

  const range = useMemo(() => {
    if (!enabled) return { start: 0, end: keys.length, before: 0, after: 0 };
    return visibleRange(keys.map((key) => heights.get(key) ?? estimate), view.top, view.bottom, overscan);
  }, [enabled, keys, estimate, overscan, view, heights]);

  /** The ref for the list's own element (the table), whose place on the screen says which rows are on it. */
  const container = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
  }, []);

  return { container, measure, ...range };
}
