/**
 * An Atom feed (RFC 4287) of a blog's published articles (wave 7 unit G, D341): pure, so a test parses what it writes. Every text is
 * escaped as XML and stripped of characters XML 1.0 forbids; the summary is plain text, never HTML.
 */

export type AtomEntry = {
  /** A stable id: the article's address (it is the same while the article stays where it is). */
  id: string;
  title: string;
  link: string;
  summary: string;
  /** When it first appeared, and when it last changed (ISO 8601). */
  published: string;
  updated: string;
  author: string;
};

export type AtomFeed = {
  /** The blog's own address, which is also its id. */
  id: string;
  title: string;
  /** The blog's page, and the feed's own address. */
  link: string;
  self: string;
  /** The language of its words (`nb-NO`). */
  lang: string;
  /** Who writes it when an entry names nobody: the store. */
  author: string;
  entries: readonly AtomEntry[];
  /** The newest change, else when the feed is made (a feed with no entries still needs one). */
  fallbackUpdated: string;
};

/** Articles a feed lists, newest first. */
export const FEED_ENTRIES_MAX = 50;

// XML 1.0 allows tab, newline, carriage return and everything from space on, except the surrogates and U+FFFE/U+FFFF.
const NOT_XML = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;

export const xmlText = (value: string): string =>
  value.replace(NOT_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const newest = (dates: readonly string[], fallback: string) => dates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a), dates[0] ?? fallback);

/** The feed's XML. */
export function atomFeed(feed: AtomFeed): string {
  const entries = feed.entries.slice(0, FEED_ENTRIES_MAX);
  const updated = newest(entries.map((e) => e.updated), feed.fallbackUpdated);
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xmlText(feed.lang)}">`,
    `<id>${xmlText(feed.id)}</id>`,
    `<title>${xmlText(feed.title)}</title>`,
    `<link rel="alternate" type="text/html" href="${xmlText(feed.link)}"/>`,
    `<link rel="self" type="application/atom+xml" href="${xmlText(feed.self)}"/>`,
    `<updated>${xmlText(new Date(updated).toISOString())}</updated>`,
    `<author><name>${xmlText(feed.author)}</name></author>`,
    ...entries.map((e) =>
      [
        "<entry>",
        `<id>${xmlText(e.id)}</id>`,
        `<title>${xmlText(e.title)}</title>`,
        `<link rel="alternate" type="text/html" href="${xmlText(e.link)}"/>`,
        `<published>${xmlText(new Date(e.published).toISOString())}</published>`,
        `<updated>${xmlText(new Date(e.updated).toISOString())}</updated>`,
        `<author><name>${xmlText(e.author || feed.author)}</name></author>`,
        e.summary ? `<summary type="text">${xmlText(e.summary)}</summary>` : "",
        "</entry>",
      ]
        .filter(Boolean)
        .join(""),
    ),
    "</feed>",
  ];
  return `${lines.join("\n")}\n`;
}
