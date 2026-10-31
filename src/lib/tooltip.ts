/**
 * The admin's tooltips (PSI UX-10): an element's `title` shown in a styled tip on hover and on keyboard focus, which a native title never
 * is, dismissed with Escape and kept while the pointer is over it (WCAG 2.2 1.4.13). The placement and the attributes are pure; the
 * listeners are `AdminTooltips` (`src/components/admin/tooltips.tsx`).
 */

/** How long the pointer rests on an element before its tip shows (keyboard focus shows it at once). */
export const TIP_DELAY_MS = 350;
/** The gap between the element and its tip, and the tip's distance from the window's edges, in pixels. */
export const TIP_GAP = 6;
export const TIP_MARGIN = 8;

type Box = { top: number; left: number; width: number; height: number };

/**
 * Where the tip goes: under the element, centred on it, or above when there is no room below; never past the window's edges. Returns the
 * tip's top-left corner and the side it took.
 */
export function placeTip(target: Box, tip: { width: number; height: number }, view: { width: number; height: number }): { top: number; left: number; side: "below" | "above" } {
  const below = target.top + target.height + TIP_GAP;
  const fitsBelow = below + tip.height <= view.height - TIP_MARGIN;
  const above = target.top - TIP_GAP - tip.height;
  const side = fitsBelow || above < TIP_MARGIN ? "below" : "above";
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.max(TIP_MARGIN, Math.min(centred, view.width - TIP_MARGIN - tip.width));
  return { top: Math.round(side === "below" ? below : above), left: Math.round(left), side };
}

/**
 * Whether an element already has a name of its own, so its title only describes it: an `aria-label`, an `aria-labelledby` or text inside.
 * When it has none, the title was its name, and the tip keeps that name as an `aria-label` while the title is moved out.
 */
export function hasOwnName(el: { getAttribute(name: string): string | null; textContent: string | null }): boolean {
  return Boolean(el.getAttribute("aria-label")?.trim() || el.getAttribute("aria-labelledby")?.trim() || el.textContent?.trim());
}

/** A title's words for a tip, on one line; null when there are none. */
export function tipText(title: string | null): string | null {
  const text = title?.replace(/\s+/g, " ").trim() ?? "";
  return text === "" ? null : text;
}
