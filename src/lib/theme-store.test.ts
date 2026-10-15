import { describe, expect, it } from "vitest";

import type { DesignSnapshot } from "./design-presets";
import { LAUNCH_THEMES } from "./launch-themes";
import {
  filterThemes,
  parseListing,
  parseThemeFilter,
  readListing,
  suggestedSlug,
  themeChangelog,
  themeFeatures,
  themeFilterHref,
  themeJsonLd,
  type ThemeStoreCard,
} from "./theme-store";

/** The theme store's pure rules (`docs/theme-phase-3.md` step 1). */

const snap = () => structuredClone(LAUNCH_THEMES[0].snapshot) as DesignSnapshot;
const card = (id: string, extra: Partial<ThemeStoreCard> = {}): ThemeStoreCard => ({
  id,
  slug: id,
  title: id,
  summary: "",
  pictureUrl: null,
  listing: { kinds: [], styles: [] },
  features: [],
  swatch: { background: "#fff", surface: "#eee", text: "#000", accent: "#111", accentText: "#fff", heading: null },
  ...extra,
});

describe("a listing", () => {
  it("keeps only known kinds and styles, once, in their own order", () => {
    expect(readListing({ kinds: ["home", "nonsense", "food", "home"], styles: "bold" })).toEqual({ kinds: ["food", "home"], styles: ["bold"] });
    expect(readListing(null)).toEqual({ kinds: [], styles: [] });
  });

  it("needs an address of the store's shape", () => {
    expect(parseListing({ slug: " Calm ", kinds: ["fashion"] })).toEqual({ ok: true, slug: "calm", listing: { kinds: ["fashion"], styles: [] } });
    expect(parseListing({ slug: "" }).ok).toBe(false);
    expect(parseListing({ slug: "-calm" }).ok).toBe(false);
    expect(parseListing({ slug: "calm theme" }).ok).toBe(false);
    expect(suggestedSlug("Høst & Vinter")).toBe("host-vinter");
  });
});

describe("what a theme includes", () => {
  it("is worked out from the version, never typed in", () => {
    const shot = snap();
    expect(themeFeatures(shot)).toContain("dark");
    expect(themeFeatures(shot)).not.toContain("header");
    shot.theme.settings.mode = "light";
    shot.theme.settings.visitorSwitch = false;
    shot.header = { rows: [], css: "", menus: {} };
    shot.theme.settings.sectionStyles = { ...shot.theme.settings.sectionStyles, banner: { row: { radius: 4 } } };
    const features = themeFeatures(shot);
    expect(features).not.toContain("dark");
    expect(features).toEqual(expect.arrayContaining(["header", "sections"]));
  });
});

describe("the list's filters", () => {
  const cards = [
    card("a", { listing: { kinds: ["food"], styles: ["warm"] }, features: ["dark"] }),
    card("b", { listing: { kinds: [], styles: ["bold"] }, features: [] }),
    card("c", { listing: { kinds: ["fashion"], styles: ["warm"] }, features: ["dark"] }),
  ];

  it("reads the address and ignores what it does not know", () => {
    expect(parseThemeFilter({ kind: "food", style: ["warm", "bold"], feature: "x" })).toEqual({ kind: "food", style: "warm", feature: null });
  });

  it("keeps a theme listed for no kind of store under every kind", () => {
    expect(filterThemes(cards, { kind: "food", style: null, feature: null }).map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterThemes(cards, { kind: null, style: "warm", feature: "dark" }).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("builds each filter's address, and the plain list without any", () => {
    const filter = { kind: "food" as const, style: null, feature: null };
    expect(themeFilterHref(filter, { style: "warm" })).toBe("/themes?kind=food&style=warm");
    expect(themeFilterHref(filter, { kind: null })).toBe("/themes");
  });
});

describe("the changelog", () => {
  it("says what each version changed, newest first, with the theme's own note", () => {
    const first = snap();
    const second = snap();
    second.theme.settings.light = { ...second.theme.settings.light, accent: "#0a0a0a" };
    const log = themeChangelog([
      { number: 2, publishedAt: "2026-10-16T09:00:00Z", notes: "A deeper accent.", snapshot: second },
      { number: 1, publishedAt: "2026-10-15T09:00:00Z", notes: null, snapshot: first },
    ]);
    expect(log.map((e) => e.number)).toEqual([2, 1]);
    expect(log[0].lines).toEqual(["A deeper accent.", "New colours."]);
    expect(log[1]).toEqual({ number: 1, date: "2026-10-15", lines: ["The first version."] });
  });
});

describe("structured data", () => {
  it("is a free creative work with no price", () => {
    const data = themeJsonLd({ title: "Calm", summary: "Quiet.", pictureUrl: null }, "https://kaizenaflow.com/themes/calm", "Kaizena Flow");
    expect(data).toMatchObject({ "@type": "CreativeWork", name: "Calm", isAccessibleForFree: true });
    expect(JSON.stringify(data)).not.toMatch(/price|offers/i);
  });
});
