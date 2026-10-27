import { describe, expect, it } from "vitest";

import { atomFeed, FEED_ENTRIES_MAX, type AtomEntry } from "./atom";
import { childText, childrenNamed, parseXml } from "./xml-tree.test-helper";

/** The Atom writer (D341): what it writes is a well-formed feed a reader can parse, with every text escaped. */

const entry = (n: number, o: Partial<AtomEntry> = {}): AtomEntry => ({
  id: `https://shop.example/blog/post-${n}`,
  title: `Post ${n}`,
  link: `https://shop.example/blog/post-${n}`,
  summary: `About post ${n}`,
  published: `2026-10-${String(10 + n).padStart(2, "0")}T08:00:00.000Z`,
  updated: `2026-10-${String(10 + n).padStart(2, "0")}T09:00:00.000Z`,
  author: "Kari",
  ...o,
});

const feed = (entries: AtomEntry[], o: Partial<Parameters<typeof atomFeed>[0]> = {}) =>
  atomFeed({
    id: "https://shop.example/blog",
    title: "News · Shop",
    link: "https://shop.example/blog",
    self: "https://shop.example/blog/feed.atom",
    lang: "nb-NO",
    author: "Shop",
    entries,
    fallbackUpdated: "2026-10-01T00:00:00.000Z",
    ...o,
  });

describe("an Atom feed of a blog", () => {
  it("parses as an Atom document with the feed's title, links, author and each entry", () => {
    const doc = parseXml(feed([entry(2), entry(1)]));
    expect(doc.name).toBe("feed");
    expect(doc.attributes.xmlns).toBe("http://www.w3.org/2005/Atom");
    expect(doc.attributes["xml:lang"]).toBe("nb-NO");
    expect(childText(doc, "title")).toBe("News · Shop");
    expect(childText(doc, "id")).toBe("https://shop.example/blog");
    const links = childrenNamed(doc, "link").map((l) => [l.attributes.rel, l.attributes.href]);
    expect(links).toEqual([
      ["alternate", "https://shop.example/blog"],
      ["self", "https://shop.example/blog/feed.atom"],
    ]);
    // The feed's own updated is its newest entry's.
    expect(childText(doc, "updated")).toBe("2026-10-12T09:00:00.000Z");
    const entries = childrenNamed(doc, "entry");
    expect(entries).toHaveLength(2);
    const first = entries[0];
    expect(childText(first, "title")).toBe("Post 2");
    expect(childText(first, "summary")).toBe("About post 2");
    expect(childText(first, "published")).toBe("2026-10-12T08:00:00.000Z");
    expect(childText(childrenNamed(first, "author")[0], "name")).toBe("Kari");
    expect(childrenNamed(first, "link")[0].attributes.href).toBe("https://shop.example/blog/post-2");
    expect(childrenNamed(first, "summary")[0].attributes.type).toBe("text");
  });

  it("escapes every text, drops characters XML forbids, and never writes HTML", () => {
    const xml = feed([entry(1, { title: `Tom & Jerry <script>alert("x")</script> 'quoted'`, summary: "a\u0001b < c > d & e", author: "" })]);
    const doc = parseXml(xml);
    const e = childrenNamed(doc, "entry")[0];
    expect(childText(e, "title")).toBe(`Tom & Jerry <script>alert("x")</script> 'quoted'`);
    expect(childText(e, "summary")).toBe("ab < c > d & e");
    // An entry with no author is the store's.
    expect(childText(childrenNamed(e, "author")[0], "name")).toBe("Shop");
    expect(xml).not.toContain("<script>");
  });

  it("is a valid feed with no entries, dated by its fallback", () => {
    const doc = parseXml(feed([]));
    expect(childrenNamed(doc, "entry")).toHaveLength(0);
    expect(childText(doc, "updated")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("lists at most the newest fifty and leaves an empty summary out", () => {
    const many = Array.from({ length: FEED_ENTRIES_MAX + 5 }, (_, i) => entry(1, { id: `id-${i}`, summary: "" }));
    const doc = parseXml(feed(many));
    expect(childrenNamed(doc, "entry")).toHaveLength(FEED_ENTRIES_MAX);
    expect(childrenNamed(childrenNamed(doc, "entry")[0], "summary")).toHaveLength(0);
  });

  it("is refused by the reader when it is not well formed (the reader is strict)", () => {
    expect(() => parseXml("<feed><title>a & b</title></feed>")).toThrow();
    expect(() => parseXml("<feed><title>a</feed>")).toThrow();
    expect(() => parseXml("<feed>a < b</feed>")).toThrow();
  });
});
