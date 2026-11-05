"use client";

import { useEffect, useRef, type RefObject } from "react";

import { composite, gradientStart, hex, opaque, type Rgba } from "@/lib/header-color";

/**
 * The phone browser's colour (`theme-color`) kept to the header's (see `src/lib/header-color.ts`): read where the header's top
 * edge is drawn, through every see-through layer down to the page, again when the page, its light or dark, the window or the
 * scroll changes it. While the header has slid away the colour it last had stays, so the bar does not flicker with the page.
 */

let canvas: CanvasRenderingContext2D | null | undefined;

/** Any colour the browser draws (oklch, color-mix, a name) as sRGB, by painting it. */
function toRgba(color: string): Rgba | null {
  if (!color || color === "transparent") return null;
  if (canvas === undefined) {
    const element = document.createElement("canvas");
    element.width = element.height = 1;
    canvas = element.getContext("2d", { willReadFrequently: true });
  }
  if (!canvas) return null;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = "#000";
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : { r, g, b, a: a / 255 };
}

/** What one element paints behind its content: its background colour over its gradient's first colour. */
function layersOf(element: Element): Rgba[] {
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.opacity === "0") return [];
  const layers: Rgba[] = [];
  const color = toRgba(style.backgroundColor);
  const start = gradientStart(style.backgroundImage);
  // A gradient is drawn over the element's background colour.
  const gradient = start ? toRgba(start) : null;
  if (gradient) layers.push(gradient);
  if (color) layers.push(color);
  return layers;
}

/** The page's own colour, under everything. */
function pageColor(): Rgba {
  for (const element of [document.body, document.documentElement]) {
    const color = element && toRgba(getComputedStyle(element).backgroundColor);
    if (color && opaque(color)) return color;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

/** The colour the header shows along its top edge, or null while it is out of view. */
function headerColor(header: HTMLElement): string | null {
  const box = header.getBoundingClientRect();
  if (box.bottom <= 1 || box.top >= window.innerHeight || box.width === 0) return null;
  const y = Math.max(box.top, 0) + 1;
  // Near the left edge, in the header's padding, away from the logo, buttons and menus.
  const x = Math.min(Math.max(box.left, 0) + 2, window.innerWidth - 1);
  const layers: Rgba[] = [];
  for (const element of document.elementsFromPoint(x, y)) {
    if (element === document.body || element === document.documentElement) break;
    const own = layersOf(element);
    layers.push(...own);
    if (own.some(opaque)) break;
  }
  return hex(composite(layers, pageColor()));
}

function themeColorMeta(): HTMLMetaElement {
  // One tag, without a `media`, so it holds in light and dark alike: the colour read is the one drawn now.
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  return meta;
}

/** Keeps `theme-color` to the header in `ref` while it is on the page. */
export function useHeaderThemeColor(ref: RefObject<HTMLElement | null>, on = true) {
  useEffect(() => {
    const header = ref.current;
    if (!on || !header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // A page Next keeps hidden (an earlier one) is not the one shown.
      if (!header.isConnected || header.closest("[hidden]")) return;
      // The header itself, not a notice over it (a store in preview or taking test payments says so in a strip above it).
      const color = headerColor(header.querySelector<HTMLElement>("header") ?? header);
      if (!color) return;
      const meta = themeColorMeta();
      if (meta.content !== color) meta.content = color;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    // Light or dark (D99), a header lying over the page (D80), a theme tried: all are marks on <html>.
    const marks = new MutationObserver(soon);
    marks.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-mode", "data-theme", "data-overlay-on", "data-overlay-live"] });
    // The header itself changing (its notice, its row's background, its see-through state).
    const own = new MutationObserver(soon);
    own.observe(header, { attributes: true, childList: true, subtree: true });
    // A navigation (the page under a see-through header changes) or a part streamed in. Not `usePathname()`, which would keep every
    // page with a header from being prerendered; the reading waits for the next frame, so a burst of changes costs one.
    const page = new MutationObserver(soon);
    page.observe(document.body, { childList: true, subtree: true });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", soon);
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    // Colours that fade (a header turning solid when the page scrolls) are read again once they have.
    header.addEventListener("transitionend", soon);
    // The page under a see-through header arrives after the header (a client navigation, a streamed part).
    const settle = window.setTimeout(soon, 300);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      marks.disconnect();
      own.disconnect();
      page.disconnect();
      scheme.removeEventListener("change", soon);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      header.removeEventListener("transitionend", soon);
    };
  }, [ref, on]);
}

/** For a header drawn on the server (the docs portal's): keeps `theme-color` to the element it is in. */
export function HeaderThemeColor() {
  const marker = useRef<HTMLSpanElement>(null);
  const header = useRef<HTMLElement | null>(null);
  // The element the marker lies in is the header; read before the effect that uses it.
  useEffect(() => {
    header.current = marker.current?.parentElement ?? null;
  });
  useHeaderThemeColor(header);
  return <span ref={marker} hidden />;
}
