import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { keepDesignCard, type DesignCard } from "@/lib/design-presets";
import { platformEn } from "@/lib/messages/platform-en";
import { platformNb } from "@/lib/messages/platform-nb";

import { SignUpLooks } from "./sign-up-looks";

const calm: DesignCard = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Calm",
  summary: "Quiet and neutral, with room to breathe.",
  description: "A long description that only the theme's page needs.",
  pictureUrl: "/storage/calm.webp",
  previewHref: "/admin/account/themes/calm/preview",
  starterId: "11111111-1111-4111-8111-111111111111",
  demo: "Field & Fold, a demo fashion store",
  looks: [{ key: "sand", name: "Sand", trade: "Fashion", starterId: "22222222-2222-4222-8222-222222222222", demo: null, previewHref: "/p/sand" }],
};
const meridian: DesignCard = {
  id: "9b2e7c1a-5d4f-4e3b-8a6c-1f2d3e4c5b6a",
  title: "Meridian",
  summary: "A consultancy at ease in the boardroom.",
  description: "",
  pictureUrl: "/storage/meridian.webp",
  previewHref: "/admin/account/themes/meridian/preview",
  prices: [{ currency: "NOK", amountMinor: 349_000 }],
};

const draw = (props: Partial<Parameters<typeof SignUpLooks>[0]> = {}) =>
  renderToString(createElement(SignUpLooks, { cards: [keepDesignCard(), calm, meridian], legend: "Theme", words: platformEn.themeCards, ...props })).replaceAll(
    "<!-- -->",
    "",
  );
const inputs = (html: string) => html.match(/<input[^>]*>/g) ?? [];
const input = (html: string, value: string) => inputs(html).find((tag) => tag.includes(`value="${value}"`));

describe("sign-up's choice of look (D456)", () => {
  it("sends what the theme cards send: Standard as empty and chosen, a theme by its id, a preset as {id}:{key}", () => {
    const html = draw();
    expect(inputs(html).map((tag) => tag.match(/value="([^"]*)"/)?.[1])).toEqual(["", calm.id, `${calm.id}:sand`, meridian.id]);
    expect(inputs(html).every((tag) => tag.includes('name="design"') && tag.includes('type="radio"'))).toBe(true);
    expect(input(html, "")).toContain('checked=""');
    expect(input(html, calm.id)).not.toContain('checked=""');
  });

  it("chooses the look it is told to, and Standard for one it does not have", () => {
    expect(input(draw({ selected: `${calm.id}:sand` }), `${calm.id}:sand`)).toContain('checked=""');
    expect(input(draw({ selected: "gone" }), "")).toContain('checked=""');
  });

  it("names each choice and its preview for the summary and the Preview link, and keeps the demo store it starts with", () => {
    const html = draw();
    expect(input(html, calm.id)).toContain('data-label="Calm"');
    expect(input(html, calm.id)).toContain('data-preview="/admin/account/themes/calm/preview"');
    expect(input(html, calm.id)).toContain(`data-starter="${calm.starterId}"`);
    expect(input(html, `${calm.id}:sand`)).toContain('data-label="Calm · Sand"');
    expect(input(html, `${calm.id}:sand`)).toContain('data-preview="/p/sand"');
    expect(html).toContain("Starts with the demo store Field &amp; Fold, a demo fashion store");
    expect(html).toContain("Starts with the standard demo products");
  });

  it("shows pictures and short lines, not the long description, and a premium theme's price", () => {
    const html = draw();
    expect(html).toContain('src="/storage/calm.webp"');
    expect(html).not.toContain("A long description");
    expect(html).toContain("Premium:");
    expect(html).toContain("Nothing to pay now");
  });

  it("opens each theme's preview in a new window without giving it this page, and has none for Standard", () => {
    const links = draw().match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.includes('target="_blank"') && link.includes('rel="noopener"'))).toBe(true);
  });

  it("speaks the page's language", () => {
    const html = draw({ words: platformNb.themeCards });
    expect(html).toContain(platformNb.themeCards.variants);
    expect(html).toContain(platformNb.themeCards.preview);
    expect(html).not.toContain(platformEn.themeCards.variants);
  });
});
