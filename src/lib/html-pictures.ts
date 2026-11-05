/**
 * A page's HTML split at its pictures (D446 step 3, also for Shopify's pages), pure: the words before, between and after each `<img>`, so
 * the words become the editor's text blocks (`htmlToRichText()`) and each picture an image block of its own, in their order. A picture
 * inside a paragraph or a link ends the words there and starts again after it; a `figure`'s caption stays with the words after it. An
 * address that is not a web picture (`data:`, `javascript:`, none) is left out. Relative addresses are read against the page's site.
 */

export type HtmlPart = { kind: "html"; html: string } | { kind: "picture"; src: string; alt: string };

/** The most pictures one page brings (the rest are left, counted by the caller). */
export const PAGE_PICTURES_MAX = 20;

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
};

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The HTML's parts; `base` is the site the page is on (`https://myshop.com`), for an address like `/wp-content/…`. */
export function splitPictures(html: string, base: string | null = null): { parts: HtmlPart[]; leftOut: number } {
  const parts: HtmlPart[] = [];
  let leftOut = 0;
  let pictures = 0;
  let last = 0;
  const words = (text: string) => {
    if (text.replace(/<[^>]*>/g, "").trim() !== "" || /<hr\b/i.test(text)) parts.push({ kind: "html", html: text });
  };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    words(html.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    // The largest of a responsive picture's sizes when it says one, else its own address.
    const set = attr(m[0], "srcset");
    const largest = set
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .filter((c) => c[0])
      .sort((a, b) => (parseInt(b[1] ?? "0", 10) || 0) - (parseInt(a[1] ?? "0", 10) || 0))[0]?.[0];
    let src = decode(largest || attr(m[0], "src") || attr(m[0], "data-src"));
    try {
      src = new URL(src, base ?? undefined).toString();
    } catch {
      src = "";
    }
    if (!/^https?:\/\//i.test(src) || pictures >= PAGE_PICTURES_MAX) {
      leftOut += 1;
      continue;
    }
    pictures += 1;
    parts.push({ kind: "picture", src, alt: decode(attr(m[0], "alt")).slice(0, 300) });
  }
  words(html.slice(last));
  return { parts, leftOut };
}
