import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ShownField } from "@/lib/custom-fields";
import type { FieldDisplay } from "@/lib/page-content";

import { CustomFieldsList, CustomFieldView } from "./custom-fields-view";

/**
 * The site's renderer for custom fields draws on the server: every new type in every display, nested values by the
 * same code as top-level ones, and nothing at all for what has nothing safe to show.
 */

const shown = (over: Partial<ShownField> & Pick<ShownField, "id" | "type">): ShownField => ({
  name: over.id,
  label: over.id,
  value: "",
  text: "",
  ...over,
});

const text = (id: string, value: string): ShownField => shown({ id, label: id, type: "text", value, text: value });
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich words" }] }] };
const richText = shown({ id: "notes", label: "Notes", type: "richText", value: doc as never, text: "Rich words" });

const file = shown({
  id: "sheet",
  label: "Data sheet",
  type: "file",
  links: [
    {
      label: "sheet.pdf",
      href: "https://cdn.example.com/sheet.pdf",
      newTab: true,
      size: 1_258_291,
      contentType: "application/pdf",
    },
  ],
});
const webLink = shown({
  id: "more",
  label: "More",
  type: "link",
  text: "Read more",
  links: [{ label: "Read more", href: "https://example.com/more", newTab: true }],
});
const pageLink = shown({
  id: "guide",
  label: "Guide",
  type: "link",
  text: "Care guide",
  links: [{ label: "Care guide", href: "/s/shop/no/care" }],
});
const products = shown({
  id: "related",
  label: "Related",
  type: "product",
  text: "Chair, Table",
  links: [
    { label: "Chair", href: "/s/shop/no/products/chair", image: "https://cdn.example.com/chair.webp" },
    { label: "Table", href: "/s/shop/no/products/table" },
  ],
});
const pages = shown({
  id: "reading",
  label: "Reading",
  type: "page",
  text: "Story",
  links: [{ label: "Story", href: "/s/shop/no/blog/story" }],
});
const terms = shown({
  id: "cats",
  label: "Categories",
  type: "term",
  text: "Oak, Pine",
  links: [
    { label: "Oak", href: "/s/shop/no/category/oak" },
    { label: "Pine", href: "/s/shop/no/tag/pine" },
  ],
});
const group = shown({
  id: "size",
  label: "Size",
  type: "group",
  children: [text("width", "40 cm"), text("height", "90 cm"), richText],
});
const repeater = shown({
  id: "features",
  label: "Features",
  type: "repeater",
  rows: [[text("name", "Legs"), text("amount", "Four")], [text("name", "Seat"), richText], [text("amount", "Two")]],
});

const displays: FieldDisplay[] = ["table", "list", "cards"];
const html = (fields: ShownField[], display: FieldDisplay = "table", showLabel = true) =>
  renderToString(createElement(CustomFieldsList, { fields, display, showLabel }));

describe("custom fields drawn on the site (D118)", () => {
  it.each(displays)("draws a file as a download link with its kind and size, in %s", (display) => {
    const out = html([file], display);
    expect(out).toContain('href="https://cdn.example.com/sheet.pdf"');
    expect(out).toContain("download");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("sheet.pdf");
    expect(out).toContain("PDF · 1.2 MB");
  });

  it.each(displays)("draws a link, in a new tab only when asked, in %s", (display) => {
    const out = html([webLink, pageLink], display);
    expect(out).toContain('href="https://example.com/more"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('href="/s/shop/no/care"');
    expect(out.match(/target="_blank"/g)).toHaveLength(1);
    expect(out).toContain("Care guide");
  });

  it.each(displays)("draws related products and pages, with small pictures when there are any, in %s", (display) => {
    const out = html([products, pages], display);
    expect(out).toContain('href="/s/shop/no/products/chair"');
    expect(out).toContain('src="https://cdn.example.com/chair.webp"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain("Table");
    expect(out).toContain('href="/s/shop/no/blog/story"');
    // No pictures: only words, no image at all.
    expect(html([pages], display)).not.toContain("<img");
  });

  it.each(displays)("draws categories and tags as inline links, in %s", (display) => {
    const out = html([terms], display);
    expect(out).toContain('href="/s/shop/no/category/oak"');
    expect(out).toContain('href="/s/shop/no/tag/pine"');
  });

  it.each(displays)("draws a group's fields inside it, with its own label, in %s", (display) => {
    const out = html([group], display);
    expect(out).toContain("Size");
    expect(out).toContain("<dl");
    expect(out).toContain("40 cm");
    expect(out).toContain("90 cm");
    // A rich text field inside is drawn as elements by the same code as a top-level one.
    expect(out).toContain("<p");
    expect(out).toContain("Rich words");
  });

  it("draws a repeater as a table with a column per field and an empty cell where a row lacks one", () => {
    const out = html([repeater], "table");
    expect(out).toContain("<table");
    expect(out).toContain("overflow-x-auto");
    expect(out.match(/<th /g)).toHaveLength(3);
    for (const header of ["name", "amount", "Notes"]) expect(out).toContain(`>${header}</th>`);
    expect(out.match(/<tr/g)).toHaveLength(4);
    // Three rows of three cells: a missing field is an empty cell.
    expect(out.match(/<td /g)).toHaveLength(9);
    expect(out).toContain("Legs");
    expect(out).toContain("Rich words");
    expect(out).toContain("<p");
  });

  it("draws a repeater as blocks in a list and as cards", () => {
    const list = html([repeater], "list");
    expect(list).not.toContain("<table");
    expect(list.match(/<li/g)!.length).toBeGreaterThanOrEqual(4);
    expect(list).toContain("Legs");
    expect(list).toContain("Rich words");
    const cards = html([repeater], "cards");
    expect(cards).not.toContain("<table");
    expect(cards).toContain("rounded-lg border");
    expect(cards).toContain("Four");
  });

  it("drops an unsafe address, and draws nothing when nothing is left", () => {
    const bad = shown({
      id: "bad",
      label: "Bad",
      type: "link",
      links: [{ label: "Click", href: "javascript:alert(1)" }],
    });
    const out = html([bad, text("ok", "Fine")]);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("Click");
    expect(out).toContain("Fine");
    expect(html([bad])).toBe("");
    const mixed = shown({
      id: "mix",
      label: "Mix",
      type: "product",
      links: [
        { label: "Evil", href: "javascript:alert(1)" },
        { label: "Good", href: "/good" },
      ],
    });
    const mixedOut = html([mixed]);
    expect(mixedOut).not.toContain("Evil");
    expect(mixedOut).toContain("Good");
    // An unsafe picture is not drawn either.
    const badPicture = shown({
      id: "bp",
      label: "Bp",
      type: "page",
      links: [{ label: "Page", href: "/p", image: "javascript:alert(1)" }],
    });
    expect(html([badPicture])).not.toContain("javascript:");
    expect(html([badPicture])).not.toContain("<img");
  });

  it("draws null for things with nothing to show", () => {
    const empties: ShownField[] = [
      shown({ id: "a", type: "file", links: [] }),
      shown({ id: "b", type: "link" }),
      shown({ id: "c", type: "product", links: [] }),
      shown({ id: "d", type: "group", children: [] }),
      shown({ id: "e", type: "repeater", rows: [[], []] }),
      shown({ id: "f", type: "group", children: [text("blank", "  ")] }),
      shown({ id: "g", type: "repeater", rows: [[text("blank", "  ")]] }),
    ];
    for (const display of displays) expect(html(empties, display)).toBe("");
    for (const field of empties) {
      expect(renderToString(createElement(CustomFieldView, { field, id: "h" }))).toBe("");
    }
  });

  it("shows a repeater's or group's label over the field alone, with a heading only when one is written", () => {
    const out = renderToString(createElement(CustomFieldView, { field: repeater, heading: "What it has", id: "h" }));
    expect(out).toContain('<h2 id="h"');
    expect(out).toContain("What it has");
    expect(out).toContain("<table");
    const none = renderToString(createElement(CustomFieldView, { field: group, showLabel: false, id: "h" }));
    expect(none).not.toContain("<h2");
    expect(none).toContain("40 cm");
  });
});
