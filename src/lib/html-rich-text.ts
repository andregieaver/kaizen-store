/**
 * HTML read into a rich-text document (D445 step 5, for the pages and blog posts of a shop that moves in), pure and without a DOM: what the
 * editor's text block can hold is kept (paragraphs, headings 2 to 4, bold, italic, underline, links, bullet and numbered lists, quotes,
 * lines, line breaks), everything else is reduced to its words (a `div`, a `span`, a table's cells) or left out (scripts, styles, frames,
 * pictures, forms). Nothing is ever kept as HTML: the result is `RichTextDoc`, and `cleanRichText()` (the editor's one check) is the last
 * word on it. An `h1` is a level-2 heading, since the page's title is its one `h1`; `h5` and `h6` are level 4. A link to an address the
 * editor does not take (`javascript:`, a relative one without `/`) keeps its words without the link.
 */
import { EMPTY_DOC, cleanRichText, isLinkAddress, type BlockNode, type InlineNode, type ListItemNode, type Mark, type RichTextDoc } from "./page-content";

const SKIP = new Set(["script", "style", "iframe", "noscript", "svg", "template", "object", "embed", "form", "select", "button", "video", "audio", "canvas", "head", "title"]);
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area", "base", "track", "param"]);
/** Elements that end a paragraph where they start and where they end. */
const BREAKING = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "pre", "address", "dl", "dt", "dd", "tr", "table", "center"]);
const HEADINGS: Record<string, 2 | 3 | 4> = { h1: 2, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", euro: "€", aelig: "æ", oslash: "ø", aring: "å", AElig: "Æ", Oslash: "Ø", Aring: "Å", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é" };

/** Character references decoded; an unknown named one is left as it is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole;
  });
}

type Token = { kind: "text"; text: string } | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean } | { kind: "close"; name: string };

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The HTML's tokens: text, start tags with their attributes, end tags. Comments, doctypes and processing instructions are left out. */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ kind: "text", text: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: "text", text: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      tokens.push({ kind: "text", text: html.slice(lt) });
      break;
    }
    const inner = html.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith("!") || inner.startsWith("?")) continue;
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim().split(/\s/)[0].toLowerCase();
      if (name) tokens.push({ kind: "close", name });
      continue;
    }
    const match = /^([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*)$/.exec(inner);
    if (!match) {
      tokens.push({ kind: "text", text: `<${inner}>` });
      continue;
    }
    const name = match[1].toLowerCase();
    const rest = match[2];
    const attrs: Record<string, string> = {};
    for (const a of rest.matchAll(ATTR)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    tokens.push({ kind: "open", name, attrs, selfClosing: /\/\s*$/.test(rest) || VOID.has(name) });
  }
  return tokens;
}

type Container = { kind: "doc" | "blockquote" | "listItem"; content: BlockNode[] } | { kind: "list"; ordered: boolean; start: number | null; items: ListItemNode[] };

/** The marks of the inline elements open now, outermost first. */
type OpenMark = { name: string; mark: Mark | null };

/** HTML as a rich-text document the editor takes, and how many pictures were left out. Empty HTML is an empty document. */
export function htmlToRichText(html: string): { doc: RichTextDoc; picturesLeftOut: number } {
  const tokens = tokenize(String(html ?? "").slice(0, 400_000));
  const root: Container = { kind: "doc", content: [] };
  const stack: Container[] = [root];
  const marks: OpenMark[] = [];
  let inline: InlineNode[] = [];
  let heading: 2 | 3 | 4 | null = null;
  let skipping: string | null = null;
  let skipDepth = 0;
  let pictures = 0;

  const blocksOf = (): BlockNode[] | null => {
    const top = stack[stack.length - 1];
    if (top.kind === "list") return null;
    return top.content;
  };
  /** The current list, when text arrives directly inside it (no `li`): an item is opened for it. */
  const ensureBlockTarget = (): BlockNode[] => {
    const top = stack[stack.length - 1];
    if (top.kind !== "list") return top.content;
    const item: Container = { kind: "listItem", content: [] };
    stack.push(item);
    return item.content;
  };
  const trimInline = (nodes: InlineNode[]): InlineNode[] => {
    const out = [...nodes];
    while (out.length && out[0].type === "hardBreak") out.shift();
    while (out.length && out[out.length - 1].type === "hardBreak") out.pop();
    if (out.length && out[0].type === "text") out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
    const last = out[out.length - 1];
    if (last && last.type === "text") out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
    return out.filter((n) => n.type !== "text" || n.text !== "");
  };
  const flush = () => {
    const content = trimInline(inline);
    inline = [];
    const level = heading;
    if (content.length === 0) return;
    const target = ensureBlockTarget();
    target.push(level ? { type: "heading", attrs: { level }, content } : { type: "paragraph", content });
  };
  const closeTop = (kind: Container["kind"]) => {
    const index = stack.map((c) => c.kind).lastIndexOf(kind);
    if (index <= 0) return;
    // An item opened for text straight in a list is closed with it.
    while (stack.length - 1 > index) closeTop(stack[stack.length - 1].kind);
    const node = stack.pop()!;
    const parent = stack[stack.length - 1];
    if (node.kind === "listItem") {
      const item: ListItemNode = { type: "listItem", content: node.content.length ? node.content : [{ type: "paragraph" }] };
      if (parent.kind === "list") parent.items.push(item);
      else parent.content.push(...item.content);
    } else if (node.kind === "list") {
      if (node.items.length === 0) return;
      const list: BlockNode = node.ordered ? { type: "orderedList", ...(node.start && node.start > 1 ? { attrs: { start: node.start } } : {}), content: node.items } : { type: "bulletList", content: node.items };
      if (parent.kind === "list") {
        // A list straight inside a list (no `li`) belongs to the last item.
        const last = parent.items[parent.items.length - 1];
        if (last) last.content.push(list);
        else parent.items.push({ type: "listItem", content: [list] });
      } else parent.content.push(list);
    } else if (node.kind === "blockquote" && node.content.length > 0) {
      const target = parent.kind === "list" ? null : parent.content;
      if (target) target.push({ type: "blockquote", content: node.content });
    }
  };
  const currentMarks = (): Mark[] => {
    const seen = new Set<string>();
    const out: Mark[] = [];
    for (const m of marks) {
      if (!m.mark || seen.has(m.mark.type)) continue;
      seen.add(m.mark.type);
      out.push(m.mark);
    }
    return out;
  };

  for (const token of tokens) {
    if (skipping) {
      if (token.kind === "open" && token.name === skipping && !token.selfClosing) skipDepth += 1;
      if (token.kind === "close" && token.name === skipping) {
        skipDepth -= 1;
        if (skipDepth === 0) skipping = null;
      }
      continue;
    }
    if (token.kind === "text") {
      const text = decodeEntities(token.text).replace(/[\s ]+/g, " ");
      if (text === "" || (text === " " && inline.length === 0)) continue;
      const m = currentMarks();
      inline.push(m.length ? { type: "text", text, marks: m } : { type: "text", text });
      continue;
    }
    const name = token.name;
    if (token.kind === "open") {
      if (SKIP.has(name)) {
        if (!token.selfClosing) {
          skipping = name;
          skipDepth = 1;
        }
        continue;
      }
      if (name === "img") {
        pictures += 1;
        continue;
      }
      if (name === "br") {
        inline.push({ type: "hardBreak" });
        continue;
      }
      if (name === "hr") {
        flush();
        const blocks = blocksOf();
        if (blocks) blocks.push({ type: "horizontalRule" });
        continue;
      }
      if (name in HEADINGS) {
        flush();
        heading = HEADINGS[name];
        continue;
      }
      if (BREAKING.has(name)) {
        flush();
        continue;
      }
      if (name === "td" || name === "th") {
        if (inline.length) inline.push({ type: "text", text: " " });
        continue;
      }
      if (name === "ul" || name === "ol") {
        flush();
        const start = Number.parseInt(token.attrs.start ?? "", 10);
        stack.push({ kind: "list", ordered: name === "ol", start: Number.isFinite(start) ? start : null, items: [] });
        continue;
      }
      if (name === "li") {
        flush();
        if (stack[stack.length - 1].kind === "listItem") closeTop("listItem");
        if (stack[stack.length - 1].kind !== "list") stack.push({ kind: "list", ordered: false, start: null, items: [] });
        stack.push({ kind: "listItem", content: [] });
        continue;
      }
      if (name === "blockquote") {
        flush();
        stack.push({ kind: "blockquote", content: [] });
        continue;
      }
      if (token.selfClosing) continue;
      const mark: Mark | null =
        name === "b" || name === "strong"
          ? { type: "bold" }
          : name === "i" || name === "em"
            ? { type: "italic" }
            : name === "u" || name === "ins"
              ? { type: "underline" }
              : name === "a" && token.attrs.href && isLinkAddress(token.attrs.href.trim())
                ? { type: "link", attrs: { href: token.attrs.href.trim() } }
                : null;
      marks.push({ name, mark });
      continue;
    }
    // A closing tag.
    if (name in HEADINGS) {
      flush();
      heading = null;
      continue;
    }
    if (BREAKING.has(name)) {
      flush();
      continue;
    }
    if (name === "li") {
      flush();
      closeTop("listItem");
      continue;
    }
    if (name === "ul" || name === "ol") {
      flush();
      closeTop("list");
      continue;
    }
    if (name === "blockquote") {
      flush();
      closeTop("blockquote");
      continue;
    }
    const at = marks.map((m) => m.name).lastIndexOf(name);
    if (at >= 0) marks.splice(at, 1);
  }
  flush();
  while (stack.length > 1) closeTop(stack[stack.length - 1].kind);
  const content = root.kind === "doc" ? root.content : [];
  const doc: RichTextDoc = content.length === 0 ? EMPTY_DOC : { type: "doc", content };
  const checked = cleanRichText(doc);
  return { doc: checked.ok ? checked.doc : EMPTY_DOC, picturesLeftOut: pictures };
}
