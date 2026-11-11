"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { countAt, statText } from "@/lib/stats-count";

export type StatShown = { id: string; value: number; decimals: number; prefix: string; suffix: string; label: string };

/** Before the browser paints, so a figure that will count up never flashes its end first; on the server it does nothing. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Animated stats (D544, `src/lib/stats-count.ts`): each of the owner's figures counts up from zero, easing out, once it comes into view, and
 * rests on the figure as typed. The server's HTML holds the figures, so without scripts, for search engines and for visitors who prefer less
 * motion they are there as typed; a screen reader is given the figure, never the count.
 */
export function StatsView({ items, columns, duration }: { items: StatShown[]; columns: number; duration: number }) {
  const ref = useRef<HTMLUListElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [locale, setLocale] = useState("en");
  // Once: the figures go to zero before the first paint (unless the visitor prefers less motion), and count up when a third of them is in view.
  useBeforePaint(() => {
    setLocale(document.documentElement.lang || "en");
    const list = ref.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setProgress(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (at: number) => {
          const elapsed = at - start;
          if (elapsed < duration * 1000) {
            setProgress(elapsed);
            frame = requestAnimationFrame(tick);
          } else setProgress(null);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.3 },
    );
    observer.observe(list);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // The count is set up once, when the figures are first drawn in the browser.
  }, []);
  return (
    <ul
      ref={ref}
      className="grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-6 [--cols:min(2,var(--stat-cols))] md:[--cols:var(--stat-cols)]"
      style={{ "--stat-cols": columns } as CSSProperties}
      data-stats=""
    >
      {items.map((item) => {
        const shown = progress === null ? item.value : countAt(item.value, item.decimals, progress, duration * 1000);
        const figure = `${item.prefix}${statText(item.value, item.decimals, locale)}${item.suffix}`;
        return (
          <li key={item.id} className="flex flex-col items-center gap-1 text-center">
            <span className="text-4xl font-semibold tabular-nums">
              <span aria-hidden>{`${item.prefix}${statText(shown, item.decimals, locale)}${item.suffix}`}</span>
              <span className="sr-only">{figure}</span>
            </span>
            {item.label && (
              <span className="text-sm text-muted">
                {item.label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
