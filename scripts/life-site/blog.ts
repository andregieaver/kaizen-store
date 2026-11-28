/**
 * Kaizena Life's blog (D916, `docs/life-site-move.md`): its published articles, read at import time from kaizenalife.com while it still
 * serves them (the RSS feed lists them; each article's page has its body, picture, author and AI disclosure). Each becomes a draft article
 * of the store, its body read with the builder's `htmlToRichText()`. Life writes its articles in English only, so they have no translations.
 */
import { htmlToRichText } from "@/lib/html-rich-text";

import { APP_TITLE, LIFE, column, doc, row, text, type Json } from "./kit";

export const LIFE_SITE = "https://kaizenalife.com";

export type LifeArticle = {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  published: string;
  thumbnail: { url: string; width: number; height: number; alt: string } | null;
  rows: Json[];
  picturesLeftOut: number;
};

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (xml: string, name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? "");

/** The element that starts at `from` with its whole inside, by counting the `div`s opened and closed after it. */
function divAt(html: string, from: number): string {
  const open = html.indexOf(">", from) + 1;
  const pattern = /<div\b|<\/div>/g;
  pattern.lastIndex = open;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(open, match.index);
  }
  throw new Error("An article's body has no end.");
}

/** A picture's size from its first bytes (PNG, JPEG or WebP), so a picture kept at Life's address has its width and height. */
export function pictureSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.subarray(1, 4).toString("latin1") === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    const kind = bytes.subarray(12, 16).toString("latin1");
    if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at < bytes.length - 9; ) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

async function text200(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

/** Every published article on Life's blog, newest first, as the feed lists them, each read from its page. */
export async function lifeArticles(only: string[] | null = null): Promise<LifeArticle[]> {
  const feed = await text200(`${LIFE_SITE}/blog/rss.xml`);
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const out: LifeArticle[] = [];
  for (const item of items) {
    const link = tag(item, "link");
    const slug = link.split("/blog/")[1]?.replace(/\/$/, "") ?? "";
    if (!slug || (only && !only.includes(slug))) continue;
    const html = await text200(link);
    const start = html.indexOf('class="blog-prose');
    if (start < 0) throw new Error(`${link}: no article body`);
    const body = divAt(html, html.lastIndexOf("<div", start));
    const disclosure = decode(/text-\[12px\] text-muted-foreground">([^<]+)</.exec(html)?.[1] ?? "").trim();
    const author = decode(/<span>([^<]{2,60})<\/span><span>·<\/span>/.exec(html)?.[1] ?? "").trim();
    const pictureUrl = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? null;
    let thumbnail: LifeArticle["thumbnail"] = null;
    if (pictureUrl && pictureUrl.includes("/storage/")) {
      const bytes = Buffer.from(await (await fetch(pictureUrl)).arrayBuffer());
      const size = pictureSize(bytes);
      if (size) thumbnail = { url: pictureUrl, ...size, alt: tag(item, "title") };
    }
    const read = htmlToRichText(body);
    // Each article is a page of its own, so its parts' ids need only differ within it.
    const id = "post";
    out.push({
      slug,
      title: tag(item, "title"),
      excerpt: tag(item, "description"),
      author: author || APP_TITLE,
      published: tag(item, "pubDate"),
      thumbnail,
      picturesLeftOut: read.picturesLeftOut,
      rows: [
        row(id, [column(`${id}-col`, [...(disclosure ? [text(`${id}-ai`, doc(disclosure), { typography: { text: { color: LIFE.muted, size: { value: 12, unit: "px" } } } })] : []), text(`${id}-body`, read.doc, { typography: { text: { size: { value: 16, unit: "px" } } } })])], {
          width: 768,
          top: 8,
          bottom: 64,
        }),
      ],
    });
  }
  return out;
}
