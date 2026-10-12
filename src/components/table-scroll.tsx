"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { TableFixed } from "@/lib/page-content";

/** The least height worth a box of its own inside a pop-up, in pixels. */
const MIN_BOX = 280;

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
    const panel = element.closest<HTMLElement>(".page-modal-panel");
    const caption = element.querySelector("caption");
    const set = () => {
      // The first thing that is pinned: the title, else the header row when it is drawn (stacked on a phone it is not), else a section title.
      element.dataset.top = caption ? "caption" : head && head.getBoundingClientRect().height > 2 ? "head" : "section";
      element.style.setProperty("--kz-cap-h", `${caption ? caption.getBoundingClientRect().height : 0}px`);
      element.style.setProperty("--kz-head-h", `${head ? head.getBoundingClientRect().height : 0}px`);
    };
    // In a pop-up the table takes what the panel has left beside the rest of what it holds, so the panel itself never scrolls and the
    // header stays put whatever else (a title, a text, a button) is in the pop-up.
    // What the measuring leaves out (the panel's border, a rounding), learnt from the panel still scrolling after a fit.
    let slack = 0;
    const fit = () => {
      if (!panel) return;
      const room = parseFloat(getComputedStyle(panel).maxHeight);
      if (!Number.isFinite(room)) return;
      const others = panel.scrollHeight - element.offsetHeight;
      const free = Math.floor(room - others - slack);
      // With too little room beside the rest of the pop-up (a phone, a long text above), the table does not scroll in a box of its own
      // but the pop-up scrolls, and the header and titles stick to the pop-up's top: a box of a few lines would be of no use.
      if (free < MIN_BOX) {
        element.dataset.fit = "panel";
        element.style.setProperty("--kz-pad", getComputedStyle(panel).paddingTop);
        element.style.removeProperty("--kz-fit");
      } else {
        element.dataset.fit = "box";
        element.style.removeProperty("--kz-pad");
        element.style.setProperty("--kz-fit", `${free}px`);
        // A pop-up that still scrolls beside a table that scrolls would show two scrollbars: take what is over off the table.
        requestAnimationFrame(() => {
          if (element.dataset.fit !== "box") return;
          const over = panel.scrollHeight - panel.clientHeight;
          if (over > 0) {
            slack += over;
            fit();
          }
        });
      }
    };
    set();
    fit();
    window.addEventListener("resize", fit);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      set();
      fit();
    });
    if (head) watch?.observe(head);
    if (caption) watch?.observe(caption);
    if (panel) {
      watch?.observe(panel);
      // What else the pop-up holds can grow while the pop-up keeps its height (a font arriving, a picture loading).
      for (const child of Array.from(panel.children)) watch?.observe(child);
    }
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      window.removeEventListener("resize", fit);
      watch?.disconnect();
    };
  }, []);
  return (
    <div ref={box} className={sideways ? "kz-table-box overflow-x-auto" : "kz-table-box"} data-fixed={fixed} {...(maxHeight && { style: { "--kz-table-max": `${maxHeight}px` } as React.CSSProperties })}>
      {children}
    </div>
  );
}
