/**
 * A web page read for the AI's research (D329, `docs/ai-autopilot.md` 13.3): its title, description and readable text, from the HTML
 * `safeFetch()` brought back. Pure: scripts, styles, navigation, headers, footers, forms and asides are left out, the main or article
 * part is preferred when there is one, entities are decoded and the text is cut at `PAGE_TEXT_MAX` characters. The text is other
 * people's words, given to the model as data.
 */

/** The largest page fetched. */
export const PAGE_MAX_BYTES = 2_000_000;
/** The most of a page's text the model is given. */
export const PAGE_TEXT_MAX = 12_000;
/** Pages a store's AI may read in 24 hours. */
export const PAGES_PER_DAY = 200;

export type PageText = { title: string; description: string; text: string; cut: boolean };

/** Whether a fetched file is one this reads: HTML or plain text. */
export const isReadableType = (contentType: string): boolean => /^(text\/html|application\/xhtml\+xml|text\/plain)$/i.test(contentType.trim());

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", euro: "€" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

const DROPPED = ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "form", "aside", "select", "button"];
const BLOCKS = /<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|dl|figure|figcaption)\b[^>]*>|<br\s*\/?>/gi;

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function metaContent(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"))?.[0];
  return tag ? clean(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
}

/** The page's title, description and readable text, cut at `max` characters on a word. */
export function pageText(body: string, contentType: string, max = PAGE_TEXT_MAX): PageText {
  if (/^text\/plain/i.test(contentType)) return cutText({ title: "", description: "", text: body.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() }, max);
  let html = body.replace(/<!--[\s\S]*?-->/g, " ");
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || metaContent(html, "og:title") || clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  html = html.replace(/<head[\s\S]*?<\/head>/i, " ");
  for (const tag of DROPPED) html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  const part = main && clean(main).length > 200 ? main : html;
  const text = part
    .replace(BLOCKS, "\n")
    .split("\n")
    .map((line) => clean(line))
    .filter((line) => line.length > 0)
    .join("\n");
  return cutText({ title: title.slice(0, 300), description: description.slice(0, 500), text }, max);
}

function cutText(page: Omit<PageText, "cut">, max: number): PageText {
  if (page.text.length <= max) return { ...page, cut: false };
  const head = page.text.slice(0, max);
  const at = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  return { ...page, text: `${head.slice(0, at > max * 0.8 ? at : max).trimEnd()} …`, cut: true };
}
