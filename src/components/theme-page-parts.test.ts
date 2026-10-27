import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ThemeStorePage } from "@/server/theme-store";

vi.mock("@/server/demo-stores", () => ({ liveDemosOf: async () => [] }));

const { ThemeDetailsPart, ThemeFeaturesPart, ThemeHighlightsPart, ThemePicturesPart } = await import("./theme-page-parts");

/**
 * The parts of a theme's page (D285): the standard page's words unless the page built in the page builder gives its own, an empty heading
 * none, and nothing at all for a theme the part has nothing for.
 */
const theme = (extra: Partial<ThemeStorePage> = {}): ThemeStorePage => ({
  id: "t1",
  slug: "harbour",
  title: "Harbour",
  summary: "Calm and clear.",
  pictureUrl: null,
  madeCard: null,
  madeShare: null,
  presets: [],
  looks: [{ key: null, name: "Harbour", showcase: null } as ThemeStorePage["looks"][number]],
  listing: { kinds: [], styles: [], pictures: [] },
  features: ["header"],
  swatch: { background: "#ffffff", surface: "#eeeeee", text: "#111111", accent: "#222222", accentText: "#ffffff", heading: null },
  description: "A quiet theme.",
  sectionStyles: ["Plain"],
  sectionStyleNames: ["plain"],
  changelog: [],
  version: 1,
  updatedAt: "2026-10-19T08:00:00Z",
  author: null,
  stores: 0,
  ...extra,
});
const draw = <P extends object>(type: (props: P) => ReactElement | null, props: P) => renderToStaticMarkup(createElement(type, props)).replaceAll("<!-- -->", "");
const highlight = { kind: "devices" as const, url: "https://x.example/devices.webp", width: 1600, height: 1000, alt: "", title: "On every screen", text: null };

describe("a theme's page's parts", () => {
  it("draw nothing for a theme they have nothing for", () => {
    expect(draw(ThemeHighlightsPart, { theme: theme() })).toBe("");
    expect(draw(ThemePicturesPart, { theme: theme() })).toBe("");
    expect(draw(ThemeFeaturesPart, { theme: theme({ features: [] }) })).toBe("");
  });

  it("take the standard page's words, or the page's own, and an empty heading draws none but keeps the section named", () => {
    expect(draw(ThemeHighlightsPart, { theme: theme({ highlights: [highlight] }) })).toContain(">Highlights</h2>");
    const own = draw(ThemeHighlightsPart, { theme: theme({ highlights: [highlight] }), heading: "Why it works" });
    expect(own).toContain('data-kz-text="title">Why it works</h2>');
    const none = draw(ThemeHighlightsPart, { theme: theme({ highlights: [highlight] }), heading: "" });
    expect(none).not.toContain("<h2");
    expect(none).toContain('aria-label="Highlights"');
    expect(none).toContain('src="https://x.example/devices.webp"');
  });

  it("put the theme's name where the line says {theme}", () => {
    const html = draw(ThemeFeaturesPart, { theme: theme(), heading: "Inside", text: "Everything {theme} includes." });
    expect(html).toContain(">Inside</h2>");
    expect(html).toContain("Everything Harbour includes.");
    expect(draw(ThemeFeaturesPart, { theme: theme() })).toContain("Your words, pictures and products stay as they are when you switch.");
  });

  it("name who made a theme and how many stores use it (D344)", () => {
    expect(draw(ThemeDetailsPart, { theme: theme() })).toContain('<dd data-theme-author="">Kaizena Flow&#x27;s own</dd>');
    expect(draw(ThemeDetailsPart, { theme: theme() })).toContain("<dd>No stores yet</dd>");
    const outside = draw(ThemeDetailsPart, { theme: theme({ author: "Ada Lovelace", stores: 3 }) });
    expect(outside).toContain('<dd data-theme-author="">Ada Lovelace</dd>');
    expect(outside).toContain("<dd>3 stores</dd>");
    expect(draw(ThemeDetailsPart, { theme: theme({ author: "Ada", stores: 1 }), lang: "nb" })).toContain("<dd>1 butikk</dd>");
  });

  it("fold the details under the page's own word for them", () => {
    expect(draw(ThemeDetailsPart, { theme: theme() })).toMatch(/<summary[^>]*><span data-kz-text="title">Details<\/span>/);
    expect(draw(ThemeDetailsPart, { theme: theme(), heading: "More about it" })).toContain(">More about it</span>");
    expect(draw(ThemeDetailsPart, { theme: theme() })).toContain("A quiet theme.");
  });
});
