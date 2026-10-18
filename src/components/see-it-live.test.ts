import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LiveDemo } from "@/lib/demo-stores";

import { SeeItLive } from "./see-it-live";

/** *See it live* on a theme's page (D277): a card per published demo store wearing one of its looks, nothing when there is none. */
const swatch = { background: "#fafafa", surface: "#ffffff", text: "#111111", accent: "#0a5c7a", accentText: "#ffffff", heading: null };
const looks = [
  { key: null, name: "Harbour", swatch },
  { key: "coast", name: "Coast", swatch: { ...swatch, accent: "#7a2e0a" } },
];
const demo = (extra: Partial<LiveDemo> = {}): LiveDemo => ({
  id: "d1",
  name: "Field and Fold",
  trade: "Linen and home goods",
  pictureUrl: null,
  variation: null,
  href: "https://field.kaizenstore.site",
  ...extra,
});
const render = (demos: LiveDemo[]) => renderToStaticMarkup(createElement(SeeItLive, { title: "Harbour", demos, looks }));

describe("See it live", () => {
  it("draws nothing without a demo store", () => {
    expect(render([])).toBe("");
  });

  it("opens each demo store at its address, with its name, trade and the look it wears", () => {
    const html = render([demo(), demo({ id: "d2", name: "Salt", trade: "", variation: "coast", href: "https://salt.kaizenstore.site", pictureUrl: "https://x.example/salt.webp" })]);
    expect(html).toContain('<h2 id="see-it-live"');
    expect(html).toContain('href="https://field.kaizenstore.site"');
    expect(html).toContain("Field and Fold");
    expect(html).toContain("Linen and home goods");
    expect(html).toContain("Wears Harbour<");
    expect(html).toContain("Wears Harbour · Coast");
    expect(html).toContain('src="https://x.example/salt.webp"');
    // Without a picture, the look's own colours.
    expect(html).toContain("background:#0a5c7a");
  });

  it("names the theme's own look for a preset the theme no longer has", () => {
    const html = render([demo({ variation: "gone" })]);
    expect(html).toContain("Wears Harbour<");
    expect(html).not.toContain("gone");
  });
});
