import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LoopRow } from "@/lib/field-loop";
import type { LoopLayout } from "@/lib/page-content";

import { FieldLoopView } from "./field-loop-view";

/**
 * The field loop draws on the server (D120): every layout from the same rows, one link per card and never inside
 * another, nothing unsafe, nothing at all for no rows.
 */

const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich words" }] }] };
const rows: LoopRow[] = [
  {
    image: {
      url: "https://cdn.example.com/legs.webp",
      thumbnailUrl: "https://cdn.example.com/legs-s.webp",
      alt: "Legs",
    },
    title: "Legs",
    text: { kind: "plain", text: "Four solid legs" },
    badge: "New",
    link: { label: "Care guide", href: "/s/shop/no/care" },
  },
  {
    title: "Seat",
    text: { kind: "rich", doc: doc as never },
    link: { label: "Datasheet", href: "https://example.com/seat.pdf", newTab: true },
  },
  { link: { label: "Only a link", href: "/only" } },
];

const layouts: LoopLayout[] = ["cards", "list", "grid", "columns"];
const html = (over: Partial<Parameters<typeof FieldLoopView>[0]> = {}) =>
  renderToString(createElement(FieldLoopView, { rows, id: "loop-heading", ...over }));

describe("the field loop drawn on the site (D120)", () => {
  it.each(layouts)("draws every row in %s: picture, badge, title as the link, text", (layout) => {
    const out = html({ layout });
    expect(out).toContain('data-field-loop="' + layout + '"');
    expect(out.match(/<li/g)).toHaveLength(3);
    expect(out).toContain("Legs");
    expect(out).toContain("Four solid legs");
    expect(out).toContain("New");
    expect(out).toContain("Rich words");
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('alt="Legs"');
    // The title is the link (a page of the site through the router, another address a plain link in a new tab).
    expect(out).toMatch(/<a [^>]*href="\/s\/shop\/no\/care"[^>]*>Legs<\/a>/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/seat.pdf"[^>]*target="_blank"[^>]*>Seat<\/a>/);
    // A row with only a link draws the link's own words.
    expect(out).toMatch(/<a [^>]*href="\/only"[^>]*>Only a link<\/a>/);
  });

  it("uses the small picture in a list", () => {
    expect(html({ layout: "list" })).toContain("legs-s.webp");
    expect(html({ layout: "cards" })).toContain("legs.webp");
    expect(html({ layout: "cards" })).not.toContain("legs-s.webp");
  });

  it("follows the columns on larger screens for cards, grid and columns, one column for a list", () => {
    // By the store's screen sizes (D179 phase 3: the breakpoint classes, `BREAKPOINT_CLASSES`).
    expect(html({ layout: "grid", columns: 4 })).toContain("kzb-lg-cols-4");
    expect(html({ layout: "columns", columns: 2 })).toContain("kzb-md-cols-2");
    expect(html({ layout: "columns", columns: 2 })).not.toContain("kzb-lg-cols");
    expect(html({ layout: "list", columns: 4 })).not.toMatch(/grid-cols|kzb-\w+-cols/);
  });

  it("makes the whole card the link with one anchor stretched over it, never a link in a link", () => {
    const out = html({ linkWholeCard: true });
    expect(out.match(/after:absolute/g)).toHaveLength(3);
    // No anchor contains another; the rich text's own links stay outside the stretched one.
    for (const match of out.matchAll(/<a [^>]*>(.*?)<\/a>/g)) expect(match[1]).not.toContain("<a ");
    expect(html()).not.toContain("after:absolute");
  });

  it("puts the heading over the loop, and labels the list by it", () => {
    const out = html({ heading: "What is in it" });
    expect(out).toContain('<h2 id="loop-heading"');
    expect(out).toContain('aria-labelledby="loop-heading"');
    expect(out).toContain("<h3");
    expect(html()).not.toContain("aria-labelledby");
    expect(html()).toContain("<h2");
  });

  it("draws an unsafe link's words but not the link", () => {
    const out = html({ rows: [{ title: "Sneaky", link: { label: "x", href: "javascript:alert(1)" } }] });
    expect(out).toContain("Sneaky");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
  });

  it("escapes text: it is never read as HTML", () => {
    const out = html({
      rows: [{ title: "<img src=x onerror=alert(1)>", text: { kind: "plain", text: "<script>x</script>" } }],
    });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;img");
  });

  it("draws nothing for no rows", () => {
    expect(html({ rows: [] })).toBe("");
  });
});
