import "server-only";

import sanitizeHtml from "sanitize-html";

/**
 * An email's own HTML block (email plan M4.1, for Lisa), cleaned before it is sent or shown: only what mail apps draw and nothing that
 * runs. Kept: text, headings, lists, tables, links and pictures, with inline styles limited to look (colour, size, spacing, borders,
 * alignment). Removed: scripts, styles, forms, frames, objects, event handlers, classes and ids, and every link that is not https, mailto
 * or tel (a store path such as /products is written as a full address). A picture keeps only an https address; the send check asks it be
 * the store's own library's, as any picture in an email (`emailPictureProblem()`). The text version is the words with the links' addresses.
 */

const COLOUR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i];
const LENGTH = [/^-?\d+(\.\d+)?(px|em|rem|%)?$/i, /^(-?\d+(\.\d+)?(px|em|rem|%)?\s*){1,4}$/i, /^auto$/i];
const BORDER = [/^[\w\s#.,%()-]{1,60}$/];

const STYLES: Record<string, RegExp[]> = {
  color: COLOUR,
  "background-color": COLOUR,
  "font-size": LENGTH,
  "font-weight": [/^(normal|bold|[1-9]00)$/i],
  "font-style": [/^(normal|italic)$/i],
  "line-height": LENGTH,
  "text-align": [/^(left|right|center|justify)$/i],
  "text-decoration": [/^(none|underline|line-through)$/i],
  "vertical-align": [/^(top|middle|bottom|baseline)$/i],
  padding: LENGTH,
  "padding-top": LENGTH,
  "padding-right": LENGTH,
  "padding-bottom": LENGTH,
  "padding-left": LENGTH,
  margin: LENGTH,
  "margin-top": LENGTH,
  "margin-bottom": LENGTH,
  width: LENGTH,
  "max-width": LENGTH,
  height: LENGTH,
  border: BORDER,
  "border-top": BORDER,
  "border-bottom": BORDER,
  "border-radius": LENGTH,
  "border-collapse": [/^(collapse|separate)$/i],
  display: [/^(block|inline|inline-block|none)$/i],
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "span", "div", "blockquote",
    "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "center",
  ],
  allowedAttributes: {
    "*": ["style", "align"],
    a: ["href", "title", "target"],
    img: ["src", "alt", "width", "height"],
    table: ["width", "cellpadding", "cellspacing", "border", "role", "bgcolor"],
    td: ["width", "colspan", "rowspan", "valign", "bgcolor"],
    th: ["width", "colspan", "rowspan", "valign", "bgcolor", "scope"],
  },
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedStyles: { "*": STYLES },
  disallowedTagsMode: "discard",
  // Words inside a removed <script>, <style> or <textarea> are dropped too, never shown as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
  transformTags: {
    // A link or picture keeps only a full address of an allowed kind: a relative one (`/products`, `x`) is dropped with the rest.
    a: (tagName, attribs) => {
      const { href, ...rest } = attribs;
      return { tagName, attribs: { ...rest, ...(href && /^(https:\/\/|mailto:|tel:)/i.test(href.trim()) ? { href: href.trim(), target: "_blank" } : {}) } };
    },
    img: (tagName, attribs) => {
      const { src, ...rest } = attribs;
      return { tagName, attribs: { ...rest, ...(src && /^https:\/\//i.test(src.trim()) ? { src: src.trim() } : {}) } };
    },
  },
};

export type CleanHtml = { html: string; text: string; pictures: string[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** The block's HTML as it may be sent, its text version, and the addresses of its pictures. */
export function cleanEmailHtml(raw: string): CleanHtml {
  const pictures: string[] = [];
  const links: string[] = [];
  const html = sanitizeHtml(raw, {
    ...OPTIONS,
    exclusiveFilter: (frame) => {
      if (frame.tag === "img") {
        if (!frame.attribs.src) return true;
        pictures.push(frame.attribs.src);
      }
      if (frame.tag === "a" && frame.attribs.href) links.push(`${frame.text.trim() || frame.attribs.href}: ${frame.attribs.href}`);
      return false;
    },
  }).trim();
  const words = sanitizeHtml(html.replace(/<(br|\/p|\/h[1-4]|\/li|\/tr|\/div|hr)[^>]*>/gi, "$&\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html, text: [words, ...links].filter(Boolean).join("\n"), pictures };
}
