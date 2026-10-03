import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GridData } from "@/lib/content-grid";
import { customGridData } from "@/lib/custom-grid";
import { CUSTOM_ITEMS_MAX, type ContentGridBlock, type CustomGridItem } from "@/lib/page-content";
import { priceView } from "@/lib/pricing";
import { newBlock } from "@/lib/page-rows";

import { ContentGridView } from "./content-grid";

/**
 * A grid of custom items as the site and the canvas draw it (D155): the badge over the picture, the price text as plain
 * words (no Price component, no VAT label), detail lines, links by slug, and the right words on the button.
 */

const item = (over: Partial<CustomGridItem> = {}): CustomGridItem => ({
  id: "i1",
  title: "Fjord tour",
  text: "A day on the water.",
  picture: null,
  link: null,
  buttonLabel: "",
  date: null,
  badge: "",
  priceText: "",
  details: [],
  ...over,
});
const grid = (over: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
  source: { type: "custom" },
  limit: CUSTOM_ITEMS_MAX,
  ...over,
});
const draw = (block: ContentGridBlock, lang = "en", base: string | null = "/s/demo/no") => {
  const data: GridData = customGridData(block, { base, lang, locale: lang === "nb" ? "nb-NO" : "en-GB" });
  return renderToString(createElement(ContentGridView, { block, data })).replace(/<!-- -->/g, "");
};
const picture = { url: "/demo/boat.webp", width: 640, height: 480, alt: "A boat" };

describe("a grid of custom items, drawn", () => {
  it("draws each item's title, text, date and detail lines in order", () => {
    const out = draw(
      grid({
        items: [
          item({ id: "a", title: "First", details: [{ id: "d1", label: "Length", text: "6 hours" }, { id: "d2", label: "", text: "Lunch included" }], date: "2026-05-17" }),
          item({ id: "b", title: "Second", text: "" }),
        ],
      }),
    );
    expect(out.indexOf("First")).toBeLessThan(out.indexOf("Second"));
    expect(out).toContain("A day on the water.");
    expect(out).toContain("Length:");
    expect(out).toContain("6 hours");
    expect(out).toContain("Lunch included");
    expect(out).toContain('<time dateTime="2026-05-17"');
    expect(out).toContain("17 May 2026");
    expect(out.match(/data-item-id=/g)).toHaveLength(2);
  });

  it("skips an item with nothing to show, and draws no gap for it", () => {
    const out = draw(grid({ items: [item({ id: "a" }), item({ id: "b", title: "", text: "", badge: "New" })] }));
    expect(out.match(/data-item-id=/g)).toHaveLength(1);
    expect(out).not.toContain("New");
  });

  it("draws the badge over the picture, or above the title when there is no picture", () => {
    const over = draw(grid({ items: [item({ badge: "-20 %", picture })] }));
    expect(over).toContain("-20 %");
    expect(over).toMatch(/absolute top-2 left-2[^>]*>-20 %/);
    expect(over.indexOf("<img")).toBeLessThan(over.indexOf("-20 %"));
    const above = draw(grid({ items: [item({ badge: "New" })] }));
    expect(above).toContain("New");
    expect(above).not.toContain("absolute top-2 left-2");
    expect(above.indexOf("New")).toBeLessThan(above.indexOf("Fjord tour"));
  });

  it("draws the price text as plain words: no Price, no VAT label, no reference price, no cart", () => {
    const out = draw(grid({ items: [item({ priceText: "From 199 kr" })] }));
    expect(out).toContain("From 199 kr");
    expect(out).toMatch(/<p class="font-medium">From 199 kr<\/p>/);
    for (const forbidden of ["VAT", "mva", "for-private", "for-business", "line-through", "Add to cart", "<form", "<button"]) {
      expect(out, forbidden).not.toContain(forbidden);
    }
  });

  it("shows the price text only while the grid's price element is on", () => {
    const off = draw(grid({ show: { image: true, heading: true, excerpt: true, price: false, button: true }, items: [item({ priceText: "From 199 kr" })] }));
    expect(off).not.toContain("From 199 kr");
  });

  it("draws every word as text, never as HTML", () => {
    const out = draw(grid({ items: [item({ title: "<script>alert(1)</script>", badge: "<b>x</b>", priceText: "<i>1</i>", details: [{ id: "d1", label: "<u>", text: "<img src=x onerror=1>" }] })] }));
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>x</b>");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;");
  });

  it("clamps the text to the grid's lines", () => {
    expect(draw(grid({ excerptLines: 2, items: [item()] }))).toContain("-webkit-line-clamp:2");
  });
});

describe("a custom item's picture and links", () => {
  it("is a picture with its own size and alt text when the item has no link, or decoration when the alt is empty", () => {
    const out = draw(grid({ items: [item({ id: "a", picture }), item({ id: "b", picture: { ...picture, alt: "" } })] }));
    expect(out).toContain('alt="A boat"');
    expect(out).toContain('width="640"');
    expect(out).toContain('height="480"');
    expect(out.match(/alt=""/g)).toHaveLength(1);
  });

  it("is the pointing link for a linked item, with the heading and button the links for keyboards", () => {
    const out = draw(grid({ items: [item({ link: { kind: "page", slug: "om-oss" }, picture })] }));
    expect(out).toMatch(/<a href="\/s\/demo\/no\/om-oss" tabindex="-1" aria-hidden="true"[^>]*><img[^>]*alt=""/);
    expect(out).toMatch(/<h3[^>]*><a href="\/s\/demo\/no\/om-oss"[^>]*>Fjord tour<\/a><\/h3>/);
    expect(out.match(/href="\/s\/demo\/no\/om-oss"/g)).toHaveLength(3);
  });

  it("has no link, no button and a plain heading without one", () => {
    const out = draw(grid({ items: [item()] }));
    expect(out).not.toContain("<a ");
    expect(out).toMatch(/<h3[^>]*>Fjord tour<\/h3>/);
    expect(out).not.toContain("Read more");
  });

  it("marks a link to another website, and links within the site by slug in the market", () => {
    const out = draw(grid({ items: [item({ id: "a", link: { kind: "url", url: "https://example.com/x" } }), item({ id: "b", link: { kind: "product", handle: "kopp" } })] }));
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('href="/s/demo/no/p/kopp"');
  });

  it("links from Kaizen's pages to its own pages and drops a store's products", () => {
    const out = draw(grid({ items: [item({ id: "a", link: { kind: "page", slug: "pricing" } }), item({ id: "b", title: "Shop", link: { kind: "product", handle: "kopp" } })] }), "en", null);
    expect(out).toContain('href="/pricing"');
    expect(out).not.toContain("/p/kopp");
  });
});

describe("a custom item's button", () => {
  const linked = (over: Partial<CustomGridItem>, block: Partial<ContentGridBlock> = {}, lang = "en") =>
    draw(grid({ items: [item({ link: { kind: "page", slug: "x" }, ...over })], ...block }), lang);

  it("reads the item's text, else the grid's, else “Read more” in the language, never “View product”", () => {
    expect(linked({ buttonLabel: "Book now" }, { buttonLabel: "Grid text" })).toMatch(/>Book now<\/a>/);
    expect(linked({}, { buttonLabel: "Grid text" })).toMatch(/>Grid text<\/a>/);
    expect(linked({})).toMatch(/>Read more<\/a>/);
    expect(linked({}, {}, "nb")).toMatch(/>Les mer<\/a>/);
    expect(linked({})).not.toContain("View product");
  });

  it("is named with the item, so several are told apart", () => {
    expect(linked({ buttonLabel: "Book" })).toContain('aria-label="Book: Fjord tour"');
  });

  it("is off when the grid's button is off", () => {
    const out = linked({}, { show: { image: true, heading: true, excerpt: true, price: true, button: false } });
    expect(out).not.toContain("Read more");
  });
});

describe("a grid of custom items as a carousel", () => {
  const items = [item({ id: "a", title: "One" }), item({ id: "b", title: "Two" }), item({ id: "c", title: "Three" })];

  it("is the carousel of the other grids: a track with every item in the HTML, and arrows", () => {
    const out = draw(grid({ display: "carousel", items }));
    expect(out).toContain("data-carousel-track");
    expect(out).toContain('aria-roledescription="Carousel"');
    for (const word of ["One", "Two", "Three"]) expect(out).toContain(word);
    expect(out.match(/data-item-id=/g)).toHaveLength(3);
  });

  it("is a grid of columns when it is not one", () => {
    const out = draw(grid({ items }));
    expect(out).not.toContain("data-carousel-track");
    expect(out).toContain("grid-cols-");
  });
});

describe("the other sources, unchanged", () => {
  it("still draw a product's price with its VAT label and “View product”", () => {
    const block = { ...(newBlock("contentGrid", () => "g1") as ContentGridBlock), source: { type: "products" as const } };
    const data: GridData = {
      lang: "en",
      locale: "en-GB",
      items: [{ id: "p1", href: "/s/demo/no/p/kopp", title: "Kopp", excerpt: "", image: null, price: { view: priceView(19900, "NOK", null, { rate: 0.25, shown: "incl" }), from: false } }],
    };
    const out = renderToString(createElement(ContentGridView, { block, data }));
    expect(out).toContain("View product");
    expect(out).toContain("incl. VAT");
  });

  it("still draw a page's tile with its link, picture link and Read more", () => {
    const block = newBlock("contentGrid", () => "g1") as ContentGridBlock;
    const data: GridData = { lang: "en", locale: "en-GB", items: [{ id: "p1", href: "/s/demo/no/om", title: "About", excerpt: "Us", image: { url: "https://example.com/a.webp", alt: "" }, price: null }] };
    const out = renderToString(createElement(ContentGridView, { block, data })).replace(/<!-- -->/g, "");
    expect(out).toMatch(/<a href="\/s\/demo\/no\/om" tabindex="-1" aria-hidden="true" class="relative z-\[2\] block">/);
    expect(out).toContain("Read more");
    expect(out).toContain('width="800"');
    // No wrapper is added around a picture without a badge.
    expect(out).not.toContain('<div class="relative"><a');
  });
});

describe("a linked item with no heading or button to link (a logo strip, picture-only cards)", () => {
  const off = { image: true, heading: false, excerpt: false, price: false, button: false };
  const logo = (over: Partial<CustomGridItem> = {}) =>
    item({ id: "a", title: "", text: "", picture: { ...picture, alt: "ACME" }, link: { kind: "url", url: "https://acme.example" }, ...over });

  it("makes the picture the link: reachable by keyboard, named by its description, not hidden", () => {
    const out = draw(grid({ show: off, items: [logo()] }));
    expect(out).toMatch(/<a href="https:\/\/acme\.example"[^>]*><img[^>]*alt="ACME"/);
    expect(out).not.toContain('aria-hidden="true"');
    expect(out).not.toContain('tabindex="-1"');
    expect(out).toContain('rel="noopener noreferrer"');
    // One link, with a name: the owner's own description of the picture.
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).not.toContain('aria-label=');
  });

  it("names the link from the title, else the button's words, when the picture has no description", () => {
    expect(draw(grid({ show: off, items: [logo({ picture: { ...picture, alt: "" }, title: "ACME Ltd" })] }))).toMatch(/<a [^>]*aria-label="ACME Ltd"/);
    // A title that is not shown as a heading still names the link.
    expect(draw(grid({ show: off, items: [logo({ picture: { ...picture, alt: "" }, buttonLabel: "Visit ACME" })] }))).toMatch(/<a [^>]*aria-label="Visit ACME"/);
    expect(draw(grid({ show: off, items: [logo({ picture: { ...picture, alt: "" } })] }))).toMatch(/<a [^>]*aria-label="Read more"/);
  });

  it("also does when the title is empty and the heading is on but the button is off", () => {
    const out = draw(grid({ show: { ...off, heading: true }, items: [logo()] }));
    expect(out).toMatch(/<a href="https:\/\/acme\.example"[^>]*><img[^>]*alt="ACME"/);
    expect(out).not.toContain('aria-hidden="true"');
  });

  it("leaves the picture as decoration where the heading or the button is the link", () => {
    // A title and the heading on: the heading links.
    const titled = draw(grid({ show: { ...off, heading: true }, items: [logo({ title: "ACME Ltd" })] }));
    expect(titled).toMatch(/<a href="https:\/\/acme\.example" tabindex="-1" aria-hidden="true"[^>]*><img[^>]*alt=""/);
    expect(titled).toMatch(/<h3[^>]*><a href="https:\/\/acme\.example"/);
    // The button on: the button links.
    const button = draw(grid({ show: { ...off, button: true }, items: [logo()] }));
    expect(button).toMatch(/aria-hidden="true"/);
    expect(button).toMatch(/class="[^"]*"[^>]*>Read more<\/a>/);
  });

  it("names a button with no title by what the picture shows, so the buttons are still told apart", () => {
    const out = draw(grid({ show: { ...off, button: true }, items: [logo()] }));
    expect(out).toContain('aria-label="Read more: ACME"');
    // With no picture shown there is nothing to name it by: the button's own words.
    const bare = draw(grid({ show: { ...off, image: false, button: true }, items: [logo({ text: "Words" })] }));
    expect(bare).not.toContain("aria-label");
  });

  it("does nothing different for an item with no link", () => {
    const out = draw(grid({ show: off, items: [logo({ link: null })] }));
    expect(out).not.toContain("<a ");
    expect(out).toContain('alt="ACME"');
  });
});
