import { isLinkAddress, type BlockNode, type InlineNode, type ListItemNode, type Mark, type RichTextDoc } from "./page-content";
import { type CaptureNode, type Run, runsText } from "./replicate-capture";

/**
 * A copied page's text as the builder's rich text (D150): a text element's runs become a paragraph, a heading, a list
 * or a quotation, with bold, italic, underline and links kept (a link only to an address the builder allows). Nothing
 * is ever HTML; the text is data in the document and `<RichText>` draws it as elements.
 */

/** The marks of a run. */
function marksOf(run: Run): Mark[] | undefined {
  const marks: Mark[] = [];
  if (run.b) marks.push({ type: "bold" });
  if (run.i) marks.push({ type: "italic" });
  if (run.u && !run.href) marks.push({ type: "underline" });
  if (run.href && isLinkAddress(run.href)) marks.push({ type: "link", attrs: { href: run.href } });
  return marks.length > 0 ? marks : undefined;
}

/** A text element's runs as the inline nodes of a paragraph (a `br` is a hard break); neighbours with the same marks join. */
export function inlineOf(runs: Run[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const run of runs) {
    if (run.br) {
      if (out.length > 0 && out[out.length - 1].type !== "hardBreak") out.push({ type: "hardBreak" });
      continue;
    }
    if (run.t === "") continue;
    const marks = marksOf(run);
    const last = out[out.length - 1];
    if (last && last.type === "text" && JSON.stringify(last.marks ?? null) === JSON.stringify(marks ?? null)) last.text += run.t;
    else out.push(marks ? { type: "text", text: run.t, marks } : { type: "text", text: run.t });
  }
  while (out.length > 0 && out[out.length - 1].type === "hardBreak") out.pop();
  while (out.length > 0 && out[0].type === "hardBreak") out.shift();
  return out;
}

/** The node a text element makes in rich text: a paragraph, or a quotation for `blockquote`. */
function textNode(node: CaptureNode): BlockNode | null {
  const inline = inlineOf(node.runs ?? []);
  if (inline.length === 0) return null;
  if (node.tag === "blockquote") return { type: "blockquote", content: [{ type: "paragraph", content: inline }] };
  return { type: "paragraph", content: inline };
}

/** A list element (`ul`, `ol`) whose items are text elements as a list node; null if it has no text. */
export function listNode(list: CaptureNode): BlockNode | null {
  const items: ListItemNode[] = [];
  for (const item of list.children) {
    const inline = inlineOf(item.runs ?? []);
    if (inline.length > 0) items.push({ type: "listItem", content: [{ type: "paragraph", content: inline }] });
  }
  if (items.length === 0) return null;
  return list.tag === "ol" ? { type: "orderedList", content: items } : { type: "bulletList", content: items };
}

/** Whether an element is a list of text items (every child text, at least one). */
export const isTextList = (node: CaptureNode): boolean =>
  (node.tag === "ul" || node.tag === "ol") && node.children.length > 0 && node.children.every((child) => child.tag === "li" && child.runs !== undefined);

/** A document of text elements, each a paragraph, quotation or list, in order. */
export function docOf(nodes: CaptureNode[]): RichTextDoc {
  const content: BlockNode[] = [];
  for (const node of nodes) {
    const block = isTextList(node) ? listNode(node) : textNode(node);
    if (block) content.push(block);
  }
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** The words of a text element, for headings and buttons and for counting. */
export const wordsOf = (node: CaptureNode): string => (isTextList(node) ? node.children.map((item) => runsText(item.runs)).join(" ") : runsText(node.runs));
