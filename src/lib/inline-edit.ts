import { HEADING_MAX, bindingOf, blockShowsUnbound, type PageBlock, type PageColumn, type PageContent, type PageRow, type RichTextDoc } from "./page-content";

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

// ---------------------------------------------------------------------------
// On the live site (D192)
// ---------------------------------------------------------------------------

/** The words changed in a component edited in place. */
export type BlockEdit = { kind: "heading"; text: string } | { kind: "richText"; doc: RichTextDoc };

/** Where a block is in a page. */
export type BlockPlace = { row: PageRow; column: PageColumn; block: PageBlock };

/** A block by its id, with its row and column. */
export function locateBlock(rows: readonly PageRow[], blockId: string): BlockPlace | null {
  for (const row of rows) {
    for (const column of row.columns) {
      const block = column.blocks.find((candidate) => candidate.id === blockId);
      if (block) return { row, column, block };
    }
  }
  return null;
}

/**
 * Whether a block's words are shared with other pages (a global part, D98): a part inside the use of a global is the global's own unless
 * it, or a part around it inside the use, is marked as the page's own (`local`).
 */
export function isSharedBlock({ row, column, block }: BlockPlace): boolean {
  let shared = false;
  for (const part of [row, column, block] as { global?: string; local?: true }[]) {
    if (part.global) shared = true;
    if (part.local) shared = false;
  }
  return shared;
}

/**
 * What the live site marks on a component so signed-in staff can edit its words there: a heading or a rich text with words of its own,
 * not shared with other pages, outside a modal. Null where it cannot be edited there (the page builder is the way).
 */
export function inlineMarkOf(place: BlockPlace, inModal: boolean): InlineKind | null {
  if (inModal) return null;
  const kind = inlineKindOf(place.block);
  return kind && !isSharedBlock(place) ? kind : null;
}

/** Why a block's words cannot be edited on the live site, or null: said to the person, in the words of the page builder. */
export function inlineProblem(rows: readonly PageRow[], blockId: string): string | null {
  const place = locateBlock(rows, blockId);
  if (!place) return "This text is no longer on the page. Reload the page.";
  if (!inlineKindOf(place.block)) return "This part of the page is edited in the page builder.";
  if (isSharedBlock(place)) return "This text is shared with other pages: change it in the page builder, where the pages it reaches are shown.";
  return null;
}

/**
 * The page with a block's words replaced, or why not. A heading or a text left with nothing to show would vanish from the page and could
 * not be pressed again, so that is refused (delete it in the page builder).
 */
export function applyBlockEdit(content: PageContent, blockId: string, edit: BlockEdit): { ok: true; content: PageContent } | { ok: false; problem: string } {
  const problem = inlineProblem(content.rows, blockId);
  if (problem) return { ok: false, problem };
  const place = locateBlock(content.rows, blockId)!;
  if (place.block.type !== edit.kind) return { ok: false, problem: "This text is not the kind of text that was edited. Reload the page." };
  const changed = (edit.kind === "heading" ? { ...place.block, text: edit.text } : { ...place.block, doc: edit.doc }) as PageBlock;
  if (!blockShowsUnbound(changed)) {
    return { ok: false, problem: edit.kind === "heading" ? "A heading cannot be empty. Delete it in the page builder if it should go." : "A text cannot be empty. Delete it in the page builder if it should go." };
  }
  return {
    ok: true,
    content: {
      ...content,
      rows: content.rows.map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.map((block) => (block.id === blockId ? changed : block)) })),
      })),
    },
  };
}

/** The words of a block as they are stored: what a revision and a comparison read. */
export function blockWords(block: PageBlock): string {
  return block.type === "heading" ? block.text : block.type === "richText" ? JSON.stringify(block.doc) : "";
}
