"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { TableFixed } from "@/lib/page-content";

/**
 * The box a table scrolls in (D203, rules in `globals.css`): its header and section titles are kept in view by CSS, and this tells the
 * section titles how tall the header is, so they stop right under it. Without scripts they stop at the top, under the header.
 */
export function TableScroll({ fixed, maxHeight, sideways, children }: { fixed: TableFixed; maxHeight?: number; sideways?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    const head = element?.querySelector("thead");
    if (!element) return;
    const set = () => element.style.setProperty("--kz-head-h", `${head ? head.getBoundingClientRect().height : 0}px`);
    set();
    if (!head || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(set);
    watch.observe(head);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={box} className={sideways ? "kz-table-box overflow-x-auto" : "kz-table-box"} data-fixed={fixed} {...(maxHeight && { style: { "--kz-table-max": `${maxHeight}px` } as React.CSSProperties })}>
      {children}
    </div>
  );
}
