import { INLINE_TAGS, parseInline, type InlineNode, type InlineTag } from "./inline-text";

/**
 * Inline markup (D191, `src/lib/inline-text.ts`) as an editor's document and back (D393, `docs/text-styles.md` 2): a heading's or a plain
 * field's words edited where they stand show their marks as they look (a text style among them) and are written back as the same markup
 * `<Inline>` draws. Each element is a mark of its own (`m_strong`, `m_span` with its class, `m_a` with its address), so `<b>` stays `<b>`.
 * Pure: the editor (`src/components/inline-edit/markup-editor.tsx`) builds its schema from `INLINE_TAGS` in `MARK_ORDER`, which is also
 * the order marks are written in, outermost first.
 */

export type MarkupMark = { type: `m_${InlineTag}`; attrs?: { className?: string | null; href?: string | null } };
export type MarkupInline = { type: "text"; text: string; marks?: MarkupMark[] } | { type: "hardBreak" };
export type MarkupDoc = { type: "doc"; content?: MarkupInline[] };

/** The marks' order, outermost first: a link around everything, then a class, then the rest. */
export const MARK_ORDER: readonly InlineTag[] = ["a", "span", ...INLINE_TAGS.filter((tag) => tag !== "a" && tag !== "span")];

const markType = (tag: InlineTag) => `m_${tag}` as const;
const tagOf = (type: string): InlineTag | null => {
  const tag = type.startsWith("m_") ? type.slice(2) : "";
  return (INLINE_TAGS as readonly string[]).includes(tag) ? (tag as InlineTag) : null;
};

/** Inline markup as an editor's document; an element inside one of the same tag merges into it (a span's classes join). */
export function markupToDoc(source: string): MarkupDoc {
  const content: MarkupInline[] = [];
  const walk = (nodes: InlineNode[], marks: MarkupMark[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        if (node.text) content.push(marks.length > 0 ? { type: "text", text: node.text, marks: [...marks] } : { type: "text", text: node.text });
      } else if (node.type === "br") content.push({ type: "hardBreak" });
      else {
        const type = markType(node.tag);
        const outer = marks.find((m) => m.type === type);
        const attrs = {
          ...(node.tag === "span" && { className: [...new Set([...(outer?.attrs?.className ?? "").split(/\s+/), ...(node.className ?? "").split(/\s+/)].filter(Boolean))].join(" ") || null }),
          ...(node.tag !== "span" && node.className && { className: node.className }),
          ...(node.tag === "a" && { href: node.href ?? null }),
        };
        const mark: MarkupMark = Object.keys(attrs).length > 0 ? { type, attrs } : { type };
        walk(node.children, [...marks.filter((m) => m.type !== type), mark]);
      }
    }
  };
  walk(parseInline(source), []);
  return content.length > 0 ? { type: "doc", content } : { type: "doc" };
}

const ENTITY_LIKE = /&(?=(?:amp|lt|gt|quot|#39|nbsp);)/g;
/** Text as written back: only what could be read as markup is escaped, so plain words stay as they were typed. */
const escapeText = (text: string) => text.replace(ENTITY_LIKE, "&amp;").replace(/<(?=[A-Za-z/])/g, "&lt;");
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const sameMark = (a: MarkupMark, b: MarkupMark) =>
  a.type === b.type && (a.attrs?.className ?? null) === (b.attrs?.className ?? null) && (a.attrs?.href ?? null) === (b.attrs?.href ?? null);

const openTag = (mark: MarkupMark): string => {
  const tag = tagOf(mark.type)!;
  const cls = mark.attrs?.className ? ` class="${escapeAttr(mark.attrs.className)}"` : "";
  const href = tag === "a" && mark.attrs?.href ? ` href="${escapeAttr(mark.attrs.href)}"` : "";
  return `<${tag}${href}${cls}>`;
};

const ordered = (marks: readonly MarkupMark[] = []) =>
  marks.filter((m) => tagOf(m.type) && (tagOf(m.type) !== "span" || m.attrs?.className)).sort((a, b) => MARK_ORDER.indexOf(tagOf(a.type)!) - MARK_ORDER.indexOf(tagOf(b.type)!));

/** An editor's document as inline markup: marks kept open across neighbouring text that shares them, outermost first. */
export function docToMarkup(doc: MarkupDoc): string {
  let out = "";
  const open: MarkupMark[] = [];
  const closeTo = (keep: number) => {
    while (open.length > keep) out += `</${tagOf(open.pop()!.type)}>`;
  };
  for (const node of doc.content ?? []) {
    if (node.type === "hardBreak") {
      closeTo(0);
      out += "<br>";
      continue;
    }
    const marks = ordered(node.marks);
    let shared = 0;
    while (shared < open.length && shared < marks.length && sameMark(open[shared], marks[shared])) shared++;
    closeTo(shared);
    for (const mark of marks.slice(shared)) {
      out += openTag(mark);
      open.push(mark);
    }
    out += escapeText(node.text);
  }
  closeTo(0);
  return out;
}

/** A span's classes with a text style put on (or taken off, null): the style's class replaces another style's, the rest stay. */
export function withStyleClass(className: string | null | undefined, styleClass: string | null): string | null {
  const kept = (className ?? "").split(/\s+/).filter((name) => name && !name.startsWith("ts-"));
  const next = styleClass ? [...kept, styleClass] : kept;
  return next.length > 0 ? next.join(" ") : null;
}
