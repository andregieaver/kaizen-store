import { EMPTY_DOC, type BlockNode, type InlineNode, type ListItemNode, type RichTextDoc } from "./page-content";

/**
 * Plain text as a rich-text document (D92): what the site's AI writes for
 * a text block, read as paragraphs (a blank line between), lists (lines
 * starting "- " or "1. "), **bold** and [links](/address). A link whose
 * address `allowLink` refuses keeps its words without the link, so the AI
 * links only where the site has a page. Nothing else is read as markup:
 * the words are kept as text, never as HTML.
 */
export function textToRichText(text: string, allowLink: (href: string) => boolean = () => false): RichTextDoc {
  const content: BlockNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const words = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (words) content.push({ type: "paragraph", content: inline(words, allowLink) });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0) {
      const items: ListItemNode[] = list.items.map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(item, allowLink) }] }));
      content.push(list.ordered ? { type: "orderedList", content: items } : { type: "bulletList", content: items });
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const numbered = line.match(/^\d{1,2}[.)]\s+(.+)$/);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      // A heading marker is not the page's heading: its words stay a paragraph.
      paragraph.push(line.replace(/^#{1,6}\s+/, ""));
    }
  }
  flushParagraph();
  flushList();
  return content.length > 0 ? { type: "doc", content } : EMPTY_DOC;
}

/** A line's words with **bold** and [links](address). */
function inline(text: string, allowLink: (href: string) => boolean): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) nodes.push({ type: "text", text: text.slice(at, match.index) });
    if (match[1] !== undefined) nodes.push({ type: "text", text: match[1], marks: [{ type: "bold" }] });
    else if (allowLink(match[3])) nodes.push({ type: "text", text: match[2], marks: [{ type: "link", attrs: { href: match[3] } }] });
    else nodes.push({ type: "text", text: match[2] });
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push({ type: "text", text: text.slice(at) });
  // Stray markers left over are dropped, not shown.
  return nodes
    .map((node) => (node.type === "text" ? { ...node, text: node.text.replace(/\*\*/g, "") } : node))
    .filter((node) => node.type !== "text" || node.text.length > 0);
}
