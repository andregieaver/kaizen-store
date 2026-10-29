/**
 * The rich-text editor's HTML view (D393, `docs/text-styles.md` 4): what of a person's HTML the editor cannot hold, named before it is read
 * back into the editor's parts, which keep only what a rich text may (`cleanRichText()` checks it again on the server). Runs in the browser
 * (`DOMParser`); `formatHtml()` lays the editor's HTML out a block a line, so it can be read and edited.
 */

/** The elements a rich text holds, and the attributes each may keep. */
const KEPT: Record<string, readonly string[]> = {
  p: [],
  h2: [],
  h3: [],
  h4: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  hr: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  a: ["href", "target", "rel"],
  span: ["class", "data-color", "data-opacity", "style"],
};

const STYLE_CLASS = /^ts-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** What would be left out of the HTML: other elements by tag, other attributes, other classes and a style not the colour's own. */
export function htmlLeftOut(html: string, known: ReadonlySet<string> = new Set()): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = new Set<string>();
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    const allowed = KEPT[tag];
    if (!allowed) {
      out.add(tag === "h1" || tag === "h5" || tag === "h6" ? `<${tag}> (made a paragraph)` : `<${tag}>`);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!allowed.includes(name)) out.add(`${name}="…"`);
      else if (name === "class") {
        for (const value of attribute.value.split(/\s+/).filter(Boolean)) {
          if (!STYLE_CLASS.test(value)) out.add(`class "${value}"`);
          else if (known.size > 0 && !known.has(value.slice(3))) out.add(`class "${value}" (no such style)`);
        }
      } else if (name === "style" && !element.hasAttribute("data-color")) out.add('style="…"');
    }
  }
  return [...out];
}

/** The editor's HTML with each block on a line of its own, as a person reads it. */
export function formatHtml(html: string): string {
  return html.replace(/(<\/(?:p|h[2-4]|li|blockquote|ul|ol)>|<hr\s*\/?>)/g, "$1\n").replace(/(<(?:ul|ol)>)/g, "$1\n").trim();
}
