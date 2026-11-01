import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { IconListBlock, TimelineBlock } from "@/lib/page-content";

import { IconListView } from "./icon-list-view";
import { TimelineView } from "./timeline-view";

/** A timeline and an icon list's descriptions (D414) as the site draws them, with no script. */
const timeline = (extra: Partial<TimelineBlock> = {}): TimelineBlock => ({
  id: "tl",
  type: "timeline",
  items: [
    { id: "a", date: "1998", title: "Founded", text: "In a garage." },
    { id: "b", date: "", title: "", text: "" },
    { id: "c", date: "2024", title: "Second shop", text: "", icon: "house" },
  ],
  ...extra,
});

describe("a timeline on the site", () => {
  it("is an ordered list of the events that have words, in order, each with its date, title and words", () => {
    const html = renderToStaticMarkup(createElement(TimelineView, { block: timeline() }));
    expect(html.startsWith("<ol")).toBe(true);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("Founded")).toBeLessThan(html.indexOf("Second shop"));
    expect(html).toContain('data-kz-text="meta" class="text-sm font-medium text-muted">1998');
    expect(html).toContain('data-kz-text="body"');
    // A dot where no icon is chosen, the icon where one is; both hidden from screen readers.
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).not.toMatch(/<span(?![^>]*aria-hidden)[^>]*rounded-full bg-current/);
  });

  it("alternates sides from the md width when asked, and draws nothing without an event", () => {
    const alternate = renderToStaticMarkup(createElement(TimelineView, { block: timeline({ layout: "alternate" }) }));
    expect(alternate).toContain('data-timeline="alternate"');
    expect(alternate).toContain("md:left-1/2");
    expect(alternate).toContain("md:ml-auto");
    expect(renderToStaticMarkup(createElement(TimelineView, { block: timeline() }))).not.toContain("md:ml-auto");
    expect(renderToStaticMarkup(createElement(TimelineView, { block: timeline({ items: [{ id: "x", date: "1998", title: "", text: "" }] }) }))).toBe("");
  });

  it("takes the colour chosen for its line and dots, else the theme's accent", () => {
    expect(renderToStaticMarkup(createElement(TimelineView, { block: timeline({ markerColor: "#ff0000" }) }))).toContain("color:#ff0000");
    expect(renderToStaticMarkup(createElement(TimelineView, { block: timeline() }))).toContain("text-accent");
  });
});

describe("an icon list line's description", () => {
  it("shows under the line's words, and lines with descriptions start at the top", () => {
    const block: IconListBlock = { id: "il", type: "iconList", layout: "row", items: [{ id: "l", icon: "check", text: "Free delivery", href: "", description: "Over 500 kr." }] };
    const html = renderToStaticMarkup(createElement(IconListView, { block }));
    expect(html.indexOf("Free delivery")).toBeLessThan(html.indexOf("Over 500 kr."));
    expect(html).toContain('data-kz-text="body"');
    expect(html).toContain("items-start");
    const plain = renderToStaticMarkup(createElement(IconListView, { block: { ...block, items: [{ ...block.items[0], description: undefined }] } }));
    expect(plain).not.toContain('data-kz-text="body"');
    expect(plain).toContain("items-center");
  });
});
