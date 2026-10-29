/**
 * Where the CSS panels sit and how big they are (D394): the page builder's panel is dragged wider or narrower by its left edge, the live
 * site's is moved by its title bar and resized from any edge or corner. Pure, so the panels and their tests read the same arithmetic;
 * what a person chose is kept in this browser only (`kaizen_admin_builder_css_width`, `kaizen_site_css_panel`, in `KNOWN_COOKIES`).
 */

export type PanelBox = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };
/** The edge or corner being dragged: n, s, e, w and the corners between them. */
export type PanelEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const PANEL_EDGES: readonly PanelEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** The builder panel's width: its usual one, and how narrow and how wide it can be made (it always leaves the page 240 px). */
export const BUILDER_PANEL = { usual: 448, min: 320, max: 1200, leave: 240 } as const;
/** The live site's panel: the smallest it can be made, and how far it keeps from the window's edges. */
export const SITE_PANEL = { minWidth: 300, minHeight: 220, margin: 8, usualWidth: 448 } as const;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** The builder panel's width within its limits for this window; null (or nothing sensible) is its usual width. */
export function builderPanelWidth(value: number | string | null, viewportWidth: number): number {
  const wanted = typeof value === "string" ? Number(value) : value;
  const most = Math.min(BUILDER_PANEL.max, viewportWidth - BUILDER_PANEL.leave);
  const width = wanted === null || !Number.isFinite(wanted) || (typeof value === "string" && value.trim() === "") ? BUILDER_PANEL.usual : Math.round(wanted);
  // On a narrow window the panel takes what there is (the CSS's `max-width: 100%` keeps it on the screen).
  return clamp(width, Math.min(BUILDER_PANEL.min, viewportWidth), most);
}

/** The live site's panel where it starts: at the window's right, from top to bottom. */
export function usualSiteBox(viewport: Viewport): PanelBox {
  const m = SITE_PANEL.margin * 2;
  const width = Math.min(SITE_PANEL.usualWidth, viewport.width - 2 * m);
  return fitBox({ x: viewport.width - width - m, y: m, width, height: viewport.height - 2 * m }, viewport);
}

/** A box kept whole inside the window, at least its smallest size where the window allows it. */
export function fitBox(box: PanelBox, viewport: Viewport): PanelBox {
  const m = SITE_PANEL.margin;
  const roomW = Math.max(viewport.width - 2 * m, 0);
  const roomH = Math.max(viewport.height - 2 * m, 0);
  const width = Math.round(clamp(box.width, Math.min(SITE_PANEL.minWidth, roomW), roomW));
  const height = Math.round(clamp(box.height, Math.min(SITE_PANEL.minHeight, roomH), roomH));
  return {
    x: Math.round(clamp(box.x, m, viewport.width - m - width)),
    y: Math.round(clamp(box.y, m, viewport.height - m - height)),
    width,
    height,
  };
}

/** The box moved by the pointer's travel, kept in the window. */
export function movedBox(start: PanelBox, dx: number, dy: number, viewport: Viewport): PanelBox {
  return fitBox({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
}

/**
 * The box with one edge or corner dragged by the pointer's travel: the opposite edges stay where they were, an edge stops at the window
 * and at the smallest size.
 */
export function resizedBox(start: PanelBox, edge: PanelEdge, dx: number, dy: number, viewport: Viewport): PanelBox {
  const m = SITE_PANEL.margin;
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (edge.includes("e")) width = clamp(start.width + dx, SITE_PANEL.minWidth, viewport.width - m - start.x);
  if (edge.includes("s")) height = clamp(start.height + dy, SITE_PANEL.minHeight, viewport.height - m - start.y);
  if (edge.includes("w")) {
    x = clamp(start.x + dx, m, right - SITE_PANEL.minWidth);
    width = right - x;
  }
  if (edge.includes("n")) {
    y = clamp(start.y + dy, m, bottom - SITE_PANEL.minHeight);
    height = bottom - y;
  }
  return fitBox({ x, y, width, height }, viewport);
}

/** A kept box read back, or null when it is not one. */
export function readBox(value: string | null): PanelBox | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PanelBox> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y, width, height } = parsed;
    return [x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: x!, y: y!, width: width!, height: height! } : null;
  } catch {
    return null;
  }
}
