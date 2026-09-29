import type { FieldType, ShownField, ShownGroup } from "./custom-fields";
import { drawable, linksOf, pictureOf } from "./field-parts";
import {
  BUTTON_LABEL_MAX,
  HEADING_MAX,
  RICH_TEXT_MAX,
  bindingOf,
  cleanRichText,
  richTextIsEmpty,
  type BlockNode,
  type InlineNode,
  type PageBlock,
  type PageColumn,
  type PageContent,
  type PageRow,
  type RichTextDoc,
} from "./page-content";

/**
 * Blocks that take their content from a custom field (D118, phase 2): a
 * heading's text, a rich text's words, a picture, a button's address, from a
 * public field of the thing the page belongs to (a product in a product
 * layout, the page or article itself). This is the builder's answer to ACF's
 * dynamic tags. Pure: the site reads the thing's fields (`shownFieldsFor()`,
 * only public ones with a value) and hands them to `bindPage()`, which gives
 * the page back with each bound block showing the field's value, so the
 * renderers know nothing of fields.
 *
 * - A field that is missing, empty, or of a kind the block cannot take leaves
 *   the block out (its row and column keep their place), unless the block
 *   keeps its own content when the field is empty (`bind.fallback`).
 * - A bound block that is drawn has no `bind` left, so it is drawn as any
 *   other. Where no fields are read (headers, footers, Kaizen's own pages,
 *   previews) a bound block still holding `bind` follows the same rule with
 *   no fields (`blockShowsUnbound()`).
 * - Never HTML: a field's words are text, its rich text is checked again,
 *   and its addresses are those `linksOf()` and `pictureOf()` allow.
 */

/** The field types each kind of block can take. */
const TEXT_TYPES: readonly FieldType[] = [
  "text",
  "textarea",
  "number",
  "measurement",
  "select",
  "radio",
  "buttons",
  "date",
  "datetime",
  "time",
  "email",
  "phone",
];
const BINDABLE: Partial<Record<PageBlock["type"], readonly FieldType[]>> = {
  heading: TEXT_TYPES,
  richText: ["richText", "text", "textarea"],
  image: ["image"],
  button: ["link", "file"],
};

/** Whether a kind of block can take its content from a field of this type (for the builder's picker). */
export function bindable(blockType: string, fieldType: FieldType): boolean {
  return (BINDABLE[blockType as PageBlock["type"]] ?? []).includes(fieldType);
}

/** Whether the block kind can be bound at all. */
export const canBind = (blockType: string): boolean => blockType in BINDABLE;

/**
 * Whether any block takes its content from a field of the store itself
 * (D120): only then are the store's fields read, and a header or footer has
 * no others to take.
 */
export const hasStoreBindings = (content: Pick<PageContent, "rows">): boolean =>
  eachBlock(content, (block) => bindingOf(block)?.source === "store");

function eachBlock(content: Pick<PageContent, "rows">, visit: (block: PageBlock) => boolean): boolean {
  return content.rows.some((row) => row.columns.some((column) => column.blocks.some(visit)));
}

/** Whether any block of the page takes its content from a field: only then are the thing's fields read. */
export const hasBindings = (content: Pick<PageContent, "rows">): boolean =>
  eachBlock(content, (block) => bindingOf(block) !== undefined);

function mapBlocks<T extends Pick<PageContent, "rows">>(content: T, change: (block: PageBlock) => PageBlock | null): T {
  const column = (c: PageColumn): PageColumn => ({ ...c, blocks: c.blocks.flatMap((b) => change(b) ?? []) });
  const row = (r: PageRow): PageRow => ({ ...r, columns: r.columns.map(column) });
  return { ...content, rows: content.rows.map(row) };
}

/** Takes the binding off a block, keeping what it holds. */
function unbound(block: PageBlock): PageBlock {
  if (bindingOf(block) === undefined) return block;
  const rest: Record<string, unknown> = { ...block };
  delete rest.bind;
  return rest as PageBlock;
}

/** The page with no binding left, each block showing its own content: what the builder's canvas and previews draw. */
export function withoutBindings<T extends Pick<PageContent, "rows">>(content: T): T {
  return hasBindings(content) ? mapBlocks(content, unbound) : content;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A field's text as one line, at most `max` characters. */
const oneLine = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Plain text as a rich text: a paragraph for each blank-line-separated part, a line break for each new line. Never markup. */
export function textToDoc(text: string): RichTextDoc {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[^\S\n]*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const content: BlockNode[] = paragraphs.map((part) => {
    const inline: InlineNode[] = [];
    part.split("\n").forEach((line, index) => {
      if (index > 0) inline.push({ type: "hardBreak" });
      if (line.trim() !== "") inline.push({ type: "text", text: line.trim() });
    });
    return { type: "paragraph", content: inline };
  });
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** A rich text field's document as the page's rich text can hold it, checked again; null when it holds nothing. */
function docOf(field: ShownField): RichTextDoc | null {
  const value = field.value;
  if (field.type === "richText") {
    const cleaned = cleanRichText(value);
    return cleaned.ok && !richTextIsEmpty(cleaned.doc) ? cleaned.doc : null;
  }
  if (field.type === "text" || field.type === "textarea") {
    const cleaned = cleanRichText(textToDoc(field.text.slice(0, RICH_TEXT_MAX)));
    return cleaned.ok && !richTextIsEmpty(cleaned.doc) ? cleaned.doc : null;
  }
  return null;
}

/** The field a block names among the groups' own fields, if it is one of a kind the block can take and has a value. */
function fieldFor(block: PageBlock, groups: readonly ShownGroup[], storeGroups: readonly ShownGroup[]): ShownField | null {
  const bind = bindingOf(block);
  if (!bind) return null;
  for (const group of bind.source === "store" ? storeGroups : groups) {
    const field = group.fields.find((f) => f.id === bind.fieldId);
    if (field) return bindable(block.type, field.type) && drawable(field) ? field : null;
  }
  return null;
}

/** The block with the field's value in place of its own content, or null when the field gives it nothing. */
function filled(block: PageBlock, field: ShownField): PageBlock | null {
  switch (block.type) {
    case "heading": {
      const text = oneLine(field.text, HEADING_MAX);
      return text ? { ...block, text } : null;
    }
    case "richText": {
      const doc = docOf(field);
      return doc ? { ...block, doc } : null;
    }
    case "image": {
      const picture = pictureOf(field.value);
      // A library picture's size is not known here; the picture is drawn at its own shape, the size only reserves room.
      return picture ? { ...block, image: { url: picture.url, width: 1600, height: 1200, alt: picture.alt } } : null;
    }
    case "button": {
      const link = linksOf(field)[0];
      if (!link) return null;
      const label = block.label.trim() || oneLine(link.label, BUTTON_LABEL_MAX);
      return { ...block, label, href: link.href, newTab: link.newTab ?? block.newTab };
    }
    default:
      return null;
  }
}

/** One block: bound ones show their field's value; else, if they keep their own content, that; else they are left out. */
function bindBlock(block: PageBlock, groups: readonly ShownGroup[], storeGroups: readonly ShownGroup[]): PageBlock | null {
  const bind = bindingOf(block);
  if (!bind) return block;
  try {
    const field = fieldFor(block, groups, storeGroups);
    const value = field ? filled(block, field) : null;
    if (value) return unbound(value);
  } catch {
    // A value that cannot be read is as good as none.
  }
  return bind.fallback ? unbound(block) : null;
}

/**
 * The page with every bound block showing the value of its field among
 * `groups` (the thing's public fields in the shopper's language). Only the
 * groups' own top-level fields are used, so a private field is never
 * available. A block bound to a field of the store itself (`bind.source`
 * "store", D120) looks among `storeGroups`, the store's public fields, and a
 * block bound to the thing's own never does. Immutable; a page with no bound
 * block is returned as it is.
 */
export function bindPage<T extends Pick<PageContent, "rows">>(
  content: T,
  groups: readonly ShownGroup[],
  storeGroups: readonly ShownGroup[] = [],
): T {
  if (!hasBindings(content)) return content;
  return mapBlocks(content, (block) => bindBlock(block, groups, storeGroups));
}
