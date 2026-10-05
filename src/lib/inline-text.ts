import { isSafeAddress } from "./field-parts";

/**
 * Inline markup in the page builder's plain text fields (a heading, a button's
 * words, a caption, a tab's title…): a few tags an owner may write by hand,
 * such as `Brewing the future<span class="highlight-color">.</span>`, so a word
 * can take a class the page's own CSS styles, or be bold, or a line can break.
 *
 * The text is never HTML. It is read here into a small tree of allowed
 * elements and drawn as React elements (`<Inline>`); everything else, a tag that
 * is not listed, an attribute that is not listed, a script, stays what was typed
 * and is shown as text. A class is a name (letters, digits, `-`, `_`), a link an
 * address `isSafeAddress()` accepts, and nothing else is kept.
 */

/** The tags that may be written. A link only where `links` is on (never inside another link or a button). */
export const INLINE_TAGS = ["span", "strong", "b", "em", "i", "u", "s", "mark", "small", "sub", "sup", "a"] as const;
export type InlineTag = (typeof INLINE_TAGS)[number];

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "el"; tag: InlineTag; className?: string; href?: string; children: InlineNode[] };

/** How deep elements may nest, and how many class names one element takes. */
const MAX_DEPTH = 6;
const MAX_CLASSES = 8;
const CLASS_NAME = /^[A-Za-z_][\w-]{0,39}$/;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (text: string): string => (text.includes("&") ? text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]) : text);

// A tag: `<name>`, `<name attributes>`, `</name>`, `<br/>`, and the shorthand `<span="class names">`.
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s*=\s*"[^"<>]*"|\s*=\s*'[^'<>]*'|\s+[^<>]*?)?)\s*(\/?)>/g;
const ATTRIBUTE = /([A-Za-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function classesOf(value: string | undefined): string | undefined {
  const names = (value ?? "").split(/\s+/).filter((name) => CLASS_NAME.test(name));
  return names.length > 0 ? [...new Set(names)].slice(0, MAX_CLASSES).join(" ") : undefined;
}

/** An open element: the tag as written (what a closing tag names) and the one it is drawn as (a link with no safe address is only a span). */
type Open = { written: InlineTag | null; tag: InlineTag; className?: string; href?: string; children: InlineNode[] };

/** Reads a text into allowed elements and text; what is not allowed stays text. */
export function parseInline(source: string): InlineNode[] {
  if (!source.includes("<")) return source === "" ? [] : [{ type: "text", text: decode(source) }];
  const root: Open = { written: null, tag: "span", children: [] };
  const stack: Open[] = [root];
  const top = () => stack[stack.length - 1];
  const text = (value: string) => {
    if (value === "") return;
    const children = top().children;
    const last = children[children.length - 1];
    if (last?.type === "text") last.text += decode(value);
    else children.push({ type: "text", text: decode(value) });
  };

  let at = 0;
  for (const match of source.matchAll(TAG)) {
    const [whole, slash, rawName, rest, selfClose] = match;
    const index = match.index ?? 0;
    const name = rawName.toLowerCase();
    text(source.slice(at, index));
    at = index + whole.length;

    if (name === "br" && slash === "") {
      top().children.push({ type: "br" });
      continue;
    }
    if (!(INLINE_TAGS as readonly string[]).includes(name)) {
      text(whole);
      continue;
    }
    const tag = name as InlineTag;
    if (slash === "/") {
      // A closing tag closes the nearest open one of its name (and what was left open inside it); one with nothing to close is shown.
      const from = stack.map((open) => open.written).lastIndexOf(tag);
      if (from > 0) {
        while (stack.length > from) closeTop(stack);
      } else text(whole);
      continue;
    }
    // Attributes: `class` for all, `href` for a link; the shorthand `<span="names">` is a class.
    let className: string | undefined;
    let href: string | undefined;
    const shorthand = /^\s*=\s*(?:"([^"]*)"|'([^']*)')$/.exec(rest);
    if (shorthand) {
      if (tag === "span") className = classesOf(shorthand[1] ?? shorthand[2]);
    } else {
      for (const attribute of rest.matchAll(ATTRIBUTE)) {
        const key = attribute[1].toLowerCase();
        const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
        if (key === "class") className = classesOf(value);
        else if (key === "href" && tag === "a" && isSafeAddress(decode(value).trim())) href = decode(value).trim();
      }
    }
    if (tag === "a" && !href) {
      // A link without a safe address is only its words.
      if (selfClose !== "/" && stack.length <= MAX_DEPTH) stack.push({ written: "a", tag: "span", children: [] });
      continue;
    }
    if (stack.length > MAX_DEPTH) {
      text(whole);
      continue;
    }
    if (selfClose === "/") top().children.push({ type: "el", tag, className, href, children: [] });
    else stack.push({ written: tag, tag, className, href, children: [] });
  }
  text(source.slice(at));
  while (stack.length > 1) closeTop(stack);
  return root.children;
}

/** Closes the innermost open element: it joins its parent. An empty one is dropped; a span with nothing set only passes its words on. */
function closeTop(stack: Open[]): void {
  const open = stack.pop()!;
  const parent = stack[stack.length - 1];
  if (open.tag === "span" && !open.className) parent.children.push(...open.children);
  else if (open.children.length > 0) parent.children.push({ type: "el", tag: open.tag, className: open.className, href: open.href, children: open.children });
}

/** Whether a text holds anything to read as markup; the plain ones are drawn as they are. */
export const hasInline = (source: string): boolean => source.includes("<") || source.includes("&");

/** The words of a text without its markup (for search, excerpts, labels read aloud, the translator's checks). */
export function inlinePlain(source: string): string {
  if (!hasInline(source)) return source;
  const walk = (nodes: InlineNode[]): string =>
    nodes
      .map((node) => (node.type === "text" ? node.text : node.type === "br" ? " " : walk(node.children)))
      .join("");
  return walk(parseInline(source)).replace(/\s+/g, " ").trim();
}

/** What the editor tells an owner under a field that takes markup. */
export const INLINE_HINT = 'Inline tags work here: <strong>, <em>, <u>, <mark>, <br> and <span class="name"> (a class your CSS styles).';
