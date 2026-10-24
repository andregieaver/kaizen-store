import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandsView } from "@/components/brands-view";
import { brandColumns } from "./brands";
import { blockStyle } from "./part-css";
import { newBlock } from "./page-rows";
import { pageBlockSchema, type BrandsBlock } from "./page-content";

const logo = { url: "https://example.com/a.webp", width: 200, height: 80 };
const block = (patch: Partial<BrandsBlock> = {}): BrandsBlock => ({
  ...(newBlock("brands", () => "b1") as BrandsBlock),
  items: [{ id: "i1", name: "Acme", picture: logo }, { id: "i2", name: "Globex", picture: logo }, { id: "i3", name: "", picture: null }],
  ...patch,
});

describe("Brands (D204)", () => {
  it("shows five logos on computers, four on Medium and two on Small until set", () => {
    const b = block();
    expect([brandColumns(b, "xl"), brandColumns(b, "lg"), brandColumns(b, "md"), brandColumns(b, "sm")]).toEqual([5, 5, 4, 2]);
    const set = block({ columns: 6, at: { md: { columns: 3 } } });
    expect([brandColumns(set, "xl"), brandColumns(set, "lg"), brandColumns(set, "md"), brandColumns(set, "sm")]).toEqual([6, 6, 3, 3]);
  });

  it("writes the logos in view per screen size as rules", () => {
    const css = JSON.stringify(blockStyle(block({ at: { sm: { columns: 1 } } }), "site").rules);
    expect(css).toContain("--brand-cols");
  });

  it("draws a grid with names, leaving out a brand with neither logo nor name", () => {
    const html = renderToStaticMarkup(createElement(BrandsView, { block: block() }));
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("Acme");
    expect(html).toContain('alt=""');
    expect(html).toContain("--brand-h:64px");
  });

  it("gives a logo its name as alternative text when names are off", () => {
    const html = renderToStaticMarkup(createElement(BrandsView, { block: block({ showNames: false }) }));
    expect(html).toContain('alt="Acme"');
    expect(html).not.toContain("<figcaption");
  });

  it("draws a keeps-moving carousel with a second, hidden copy and the speed", () => {
    const html = renderToStaticMarkup(createElement(BrandsView, { block: block({ view: "carousel", speed: 6 }) }));
    expect(html).toContain("kz-brands-marquee");
    expect(html).toContain('aria-hidden="true"');
    // Two brands repeated four times, 6 seconds each.
    expect(html).toContain("animation-duration:48s");
  });

  it("checks the limits when saved", () => {
    expect(pageBlockSchema.safeParse(block({ logoHeight: 80, speed: 10, interval: 4, view: "carousel", movement: "snap" })).success).toBe(true);
    expect(pageBlockSchema.safeParse(block({ logoHeight: 5000 })).success).toBe(false);
    expect(pageBlockSchema.safeParse(block({ view: "carousel", movement: "snap", interval: 0 })).success).toBe(false);
  });

  it("links a brand when it has an address, and the hidden copy of a moving strip cannot be reached", () => {
    const linked = block({ items: [{ id: "i1", name: "Acme", picture: logo, href: "https://acme.example" }] });
    expect(renderToStaticMarkup(createElement(BrandsView, { block: linked }))).toContain('href="https://acme.example"');
    const moving = renderToStaticMarkup(createElement(BrandsView, { block: { ...linked, view: "carousel" } }));
    expect(moving).toMatch(/ inert[ =>]/);
    expect(pageBlockSchema.safeParse(block({ items: [{ id: "i1", name: "A", picture: null, href: "javascript:alert(1)" }] })).success).toBe(false);
  });

  it("draws greys, with colour on hover when asked, arrows when visitors move it, and a Pause button when it moves by itself", () => {
    expect(renderToStaticMarkup(createElement(BrandsView, { block: block({ greyscale: true }) }))).toContain('data-grey="always"');
    expect(renderToStaticMarkup(createElement(BrandsView, { block: block({ greyscale: true, colourOnHover: true }) }))).toContain('data-grey="hover"');
    const still = renderToStaticMarkup(createElement(BrandsView, { block: block({ view: "carousel", movement: "none" }) }));
    expect(still.match(/kz-brands-arrow/g)).toHaveLength(2);
    expect(still).not.toContain("kz-brands-marquee");
    expect(still).not.toContain("aria-pressed");
    // A strip that moves by itself can be stopped for good (WCAG 2.2.2, PSI 2026-10-24 ACC-06).
    expect(renderToStaticMarkup(createElement(BrandsView, { block: block({ view: "carousel" }) }))).toContain('aria-pressed="false"');
  });
});
