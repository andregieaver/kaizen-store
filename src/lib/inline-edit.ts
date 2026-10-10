import { HEADING_MAX, bindingOf, type PageBlock } from "./page-content";

/**
 * Editing a page's words where they are (D191, D192): the page builder's canvas and, for signed-in staff, the live site. Only the two
 * components whose content is words: a heading (plain text with inline markup) and rich text (Tiptap's JSON). Pure parts, for the
 * browser and the server.
 */

/** The kinds of component edited in place. */
export type InlineKind = "heading" | "richText";

/** What a component is edited in place as, or null: its words must be its own, not taken from a custom field (D118). */
export function inlineKindOf(block: PageBlock): InlineKind | null {
  if (block.type !== "heading" && block.type !== "richText") return null;
  return bindingOf(block) ? null : block.type;
}

/** A heading's text as typed in place: one line (a pasted line break is a space), without control characters, held to the limit. */
export function cleanHeadingText(text: string): string {
  const flat = text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return flat.length > HEADING_MAX ? flat.slice(0, HEADING_MAX) : flat;
}

/** A box on the screen, as the browser measures it. */
type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Where the floating bar over a text edited in place goes: above the text where there is room, else under it, in line with the text's
 * left edge but kept on the screen. Fixed positions, in the viewport's pixels.
 */
export function barPosition(
  anchor: Rect,
  bar: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { left: number; top: number } {
  const above = anchor.top - bar.height - gap >= gap;
  const top = above ? anchor.top - bar.height - gap : Math.min(anchor.bottom + gap, Math.max(gap, viewport.height - bar.height - gap));
  const left = Math.max(gap, Math.min(anchor.left, viewport.width - bar.width - gap));
  return { left, top };
}
