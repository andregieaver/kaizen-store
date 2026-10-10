"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { barPosition } from "@/lib/inline-edit";

/**
 * A bar floating over a text edited in place (D191), outside whatever clips the text (a row's rounded corners): fixed on the screen,
 * above the text where there is room and else under it, following it as the page scrolls. Pressing its dead space keeps the focus in
 * the text; a field in it (a link's address) takes the focus as any field does.
 */
export function FloatingBar({
  anchor,
  barRef,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  barRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const ref = barRef ?? own;
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const move = () => {
      const target = anchor.current;
      const bar = ref.current;
      if (!target || !bar) return;
      const size = bar.getBoundingClientRect();
      const next = barPosition(target.getBoundingClientRect(), { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight });
      setPlace((current) => (current && current.left === next.left && current.top === next.top ? current : next));
    };
    move();
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    const observer = new ResizeObserver(move);
    if (anchor.current) observer.observe(anchor.current);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      observer.disconnect();
    };
  }, [anchor, ref]);

  return createPortal(
    <div
      ref={ref}
      data-inline-bar=""
      style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
      className="z-[1000] w-max max-w-[calc(100vw-1rem)] rounded-md border border-border bg-background text-foreground shadow-lg"
      onMouseDown={(event) => {
        // A press on the bar's own space must not take the focus from the text.
        if (!(event.target instanceof HTMLElement && event.target.closest("input, select, textarea"))) event.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
