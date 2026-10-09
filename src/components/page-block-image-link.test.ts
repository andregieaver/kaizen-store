import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newPageContent, pageInput, type ImageBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import { PageBlockView } from "./page-block";

vi.mock("server-only", () => ({}));

/** A picture can lead somewhere. */

const picture = { url: "https://x.test/a.jpg", width: 800, height: 600, alt: "A lamp" };
const block = (extra: Partial<ImageBlock>): ImageBlock => ({ ...(newBlock("image", () => "i1") as ImageBlock), image: picture, ...extra });
const html = (b: ImageBlock) => renderToString(createElement(PageBlockView, { block: b } as never));

describe("a picture's link", () => {
  it("wraps the picture in a link, and says when it opens a new tab", () => {
    const out = html(block({ href: "/about", newTab: true }));
    expect(out).toMatch(/<a href="\/about"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(out).toContain("opens in a new tab");
    expect(html(block({ href: "https://x.test/y" }))).not.toContain("_blank");
  });

  it("is a plain picture without a link, or with one that is not an address", () => {
    expect(html(block({}))).not.toContain("<a ");
    expect(html(block({ href: "javascript:alert(1)" }))).not.toContain("<a ");
  });

  it("is checked when a page is saved", () => {
    const page = (href: string) =>
      pageInput.safeParse({ ...newPageContent(), title: "T", slug: "t", rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block({ href })] }] }] }).success;
    expect(page("/about")).toBe(true);
    expect(page("")).toBe(true);
    expect(page("javascript:alert(1)")).toBe(false);
  });
});
