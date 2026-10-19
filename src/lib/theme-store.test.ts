import { describe, expect, it } from "vitest";

import type { DesignSnapshot } from "./design-presets";
import { LAUNCH_THEMES, launchVariation } from "./launch-themes";
import {
  cardPicture,
  filterThemes,
  OWN_SLOTS,
  parseListing,
  parseThemeFilter,
  readListing,
  readOwnPictures,
  shownLooks,
  showcaseTrades,
  themeLooks,
  suggestedSlug,
  themeChangelog,
  themeFeatures,
  themeFilterHref,
  sharePicture,
  swatchOf,
  themeJsonLd,
  lookChoice,
  previewNeighbours,
  previewView,
  themePagePath,
  themePreviewPath,
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
  madeCard: null,
  madeShare: null,
  presets: [],
  looks: [{ key: null, name: id, showcase: null }],
  listing: { kinds: [], styles: [], pictures: [] },
  features: [],
  swatch: { background: "#fff", surface: "#eee", text: "#000", accent: "#111", accentText: "#fff", heading: null },
  ...extra,
});

describe("a listing", () => {
  it("keeps only known kinds and styles, once, in their own order", () => {
    expect(readListing({ kinds: ["home", "nonsense", "food", "home"], styles: "bold" })).toEqual({ kinds: ["food", "home"], styles: ["bold"], pictures: [] });
    expect(readListing(null)).toEqual({ kinds: [], styles: [], pictures: [] });
    // The pack and presets' packs a listing kept before D275 are no longer read: a theme's looks are shown on its own content.
    expect(readListing({ kinds: ["food"], pack: "food", presetPacks: { olive: "home" } })).toEqual({ kinds: ["food"], styles: [], pictures: [] });
    expect(parseListing({ slug: "calm", pack: "fashion" } as Parameters<typeof parseListing>[0])).toMatchObject({ ok: true, listing: { kinds: [], styles: [], pictures: [] } });
  });

  it("needs an address of the store's shape", () => {
    expect(parseListing({ slug: " Calm ", kinds: ["fashion"] })).toEqual({ ok: true, slug: "calm", listing: { kinds: ["fashion"], styles: [], pictures: [] } });
    expect(parseListing({ slug: "" }).ok).toBe(false);
    expect(parseListing({ slug: "-calm" }).ok).toBe(false);
    expect(parseListing({ slug: "calm theme" }).ok).toBe(false);
    expect(suggestedSlug("Høst & Vinter")).toBe("host-vinter");
  });

  it("keeps pictures on this site or https, once each, in order, at most six; and the form says what is wrong", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `/media/p${i}.webp`);
    expect(readListing({ pictures: ["/media/a.webp", "javascript:alert(1)", "http://x.test/a.png", "https://cdn.test/b.png", "/media/a.webp", "//evil.test/c.png"] }).pictures).toEqual([
      "/media/a.webp",
      "https://cdn.test/b.png",
    ]);
    expect(readListing({ pictures: seven }).pictures).toHaveLength(6);
    expect(parseListing({ slug: "calm", pictures: ["/media/a.webp", ""] })).toMatchObject({ ok: true, listing: { pictures: ["/media/a.webp"] } });
    expect(parseListing({ slug: "calm", pictures: ["http://x.test/a.png"] })).toMatchObject({ ok: false });
    expect(parseListing({ slug: "calm", pictures: seven })).toMatchObject({ ok: false, problems: ["A theme has at most 6 pictures beside its main one."] });
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
    card("a", { listing: { kinds: ["food"], styles: ["warm"], pictures: [] }, features: ["dark"] }),
    card("b", { listing: { kinds: [], styles: ["bold"], pictures: [] }, features: [] }),
    card("c", { listing: { kinds: ["fashion"], styles: ["warm"], pictures: [] }, features: ["dark"] }),
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

describe("the admin's own pictures in place of made ones (docs/theme-showcase-phase-2.md step 3)", () => {
  it("keeps known slots with an address on this site or https, and only when some are set", () => {
    expect(readOwnPictures({ share: "/media/s.jpg", devices: "https://cdn.test/d.png", collage: "javascript:alert(1)", closeup: "http://x.test/c.png", card: "/media/c.webp" })).toEqual({
      share: "/media/s.jpg",
      devices: "https://cdn.test/d.png",
    });
    expect(readOwnPictures(["/media/s.jpg"])).toEqual({});
    expect(readOwnPictures(null)).toEqual({});
    expect(readListing({ own: { collage: "/media/g.webp" } }).own).toEqual({ collage: "/media/g.webp" });
    expect(readListing({ own: {} })).not.toHaveProperty("own");
    expect([...OWN_SLOTS]).toEqual(["share", "devices", "collage", "closeup"]);
  });

  it("are kept by the listing form, which never sets them itself", () => {
    expect(parseListing({ slug: "calm", own: { share: "/media/s.jpg" } })).toMatchObject({ ok: true, listing: { own: { share: "/media/s.jpg" } } });
    expect(parseListing({ slug: "calm" })).toEqual({ ok: true, slug: "calm", listing: { kinds: [], styles: [], pictures: [] } });
  });
});

describe("the pictures a theme shows (docs/theme-showcase-phase-2.md step 1)", () => {
  it("cards and shares its own picture first, then what its photograph made, else (a card) its colours, never a picture by hand (D274)", () => {
    expect(cardPicture({ pictureUrl: "/own.webp", madeCard: "/made.webp" })).toBe("/own.webp");
    expect(cardPicture({ pictureUrl: null, madeCard: "/made.webp" })).toBe("/made.webp");
    expect(cardPicture({ pictureUrl: null, madeCard: null })).toBeNull();
    expect(sharePicture({ pictureUrl: null, madeShare: "/share.jpg" })).toBe("/share.jpg");
    expect(sharePicture({ pictureUrl: "/own.webp", madeShare: "/share.jpg" })).toBe("/own.webp");
  });

  it("shares the admin's own share image before anything else (step 3)", () => {
    const listing = readListing({ own: { share: "/media/share.jpg" } });
    expect(sharePicture({ pictureUrl: "/own.webp", madeShare: "/share.jpg", listing })).toBe("/media/share.jpg");
    expect(sharePicture({ pictureUrl: null, madeShare: "/share.jpg", listing: readListing({}) })).toBe("/share.jpg");
  });

  it("shows only looks on a published demo store, its own first (D274)", () => {
    const shown = { pack: "food" as const, trade: "Food and drink", line: "Harbour Pantry", starterId: "p" };
    expect(shownLooks([{ key: null, showcase: null }, { key: "olive", showcase: shown }, { key: "blush", showcase: null }]).map((l) => l.key)).toEqual(["olive"]);
    expect(shownLooks([{ key: null, showcase: shown }, { key: "olive", showcase: null }]).map((l) => l.key)).toEqual([null]);
  });
});

describe("a theme's looks, each on the theme's own content (D275)", () => {
  const presets = [
    { key: "olive", name: "Olive" },
    { key: "blush", name: "Blush" },
  ];
  const content = { starterId: "starter-food", pack: "food" as const, storeName: "Harbour Pantry" };

  it("are its own look first, then its presets, all on the theme's content", () => {
    const looks = themeLooks("Hearth", presets, content);
    expect(looks.map((l) => [l.key, l.name, l.showcase?.starterId ?? null])).toEqual([
      [null, "Hearth", "starter-food"],
      ["olive", "Olive", "starter-food"],
      ["blush", "Blush", "starter-food"],
    ]);
    expect(looks[0].showcase).toMatchObject({ pack: "food", trade: "Food and drink", line: "Harbour Pantry, a demo food and drink store" });
    expect(showcaseTrades(looks)).toEqual(["Food and drink"]);
  });

  it("name content of its own by its store, with no trade", () => {
    const looks = themeLooks("Calm", [], { starterId: "own", pack: null, storeName: "Calm's shop" });
    expect(looks[0].showcase).toEqual({ pack: null, trade: null, line: "Calm's shop", starterId: "own" });
    expect(showcaseTrades(looks)).toEqual([]);
  });

  it("are shown nowhere while the theme has no published content", () => {
    expect(themeLooks("Calm", [], null)).toEqual([{ key: null, name: "Calm", showcase: null }]);
    expect(shownLooks(themeLooks("Hearth", presets, null))).toEqual([]);
  });
});

describe("a theme's page and full-screen preview keep the look and the view in the address (D275)", () => {
  const looks = [{ key: null }, { key: "coast" }];

  it("takes a preset only when the theme has it", () => {
    expect(lookChoice(looks, "coast")).toBe("coast");
    expect(lookChoice(looks, "gone")).toBeNull();
    expect(lookChoice(looks, ["coast"])).toBeNull();
    expect(lookChoice(looks, undefined)).toBeNull();
  });

  it("reads Home or A product, and a computer or a phone, Home on a computer unless said", () => {
    expect(previewView({})).toEqual({ show: "home", device: "computer" });
    expect(previewView({ show: "product", device: "phone" })).toEqual({ show: "product", device: "phone" });
    expect(previewView({ show: "x", device: ["phone"] })).toEqual({ show: "home", device: "computer" });
  });

  it("writes only what differs from the defaults", () => {
    expect(themePreviewPath("calm")).toBe("/themes/calm/preview");
    expect(themePreviewPath("calm", "coast", { show: "product", device: "phone" })).toBe("/themes/calm/preview?preset=coast&show=product&device=phone");
    expect(themePreviewPath("calm", null, { show: "home", device: "computer" })).toBe("/themes/calm/preview");
    expect(themePagePath("calm")).toBe("/themes/calm");
    expect(themePagePath("calm", "coast")).toBe("/themes/calm?preset=coast");
  });
});

/** A look's swatch is drawn in the colours it is shown in (D280): its dark palette when it is always dark, else its light one. */
describe("a look's swatch", () => {
  it("of a theme always dark is its dark colours, of any other its light ones", () => {
    const theme = snap();
    theme.theme.settings.mode = "dark";
    expect(swatchOf(theme)).toMatchObject({ background: theme.theme.settings.dark.background, accent: theme.theme.settings.dark.accent });
    for (const mode of ["light", "auto"] as const) {
      theme.theme.settings.mode = mode;
      expect(swatchOf(theme)).toMatchObject({ background: theme.theme.settings.light.background, accent: theme.theme.settings.light.accent });
    }
  });

  it("of every launch theme's look is the palette it is shown in, and no two looks of a theme share one", () => {
    for (const launch of LAUNCH_THEMES) {
      const looks = [launch.snapshot, ...launch.presets.map((preset) => ({ ...launch.snapshot, theme: launchVariation(launch, preset).theme }))];
      const swatches = looks.map((look) => {
        const settings = look.theme.settings;
        const shown = settings.mode === "dark" ? settings.dark : settings.light;
        const swatch = swatchOf(look as DesignSnapshot);
        expect(swatch, launch.key).toMatchObject({ background: shown.background, surface: shown.surface, text: shown.text, accent: shown.accent });
        return `${swatch.background} ${swatch.accent}`;
      });
      // Presets that differ only in their dark colours (Orbit's Mars and Nebula) were drawn alike from the light ones.
      expect(new Set(swatches).size, launch.key).toBe(swatches.length);
    }
  });
});


describe("the previous and next theme in the full-screen preview (D285)", () => {
  const shown = { pack: null, trade: null, line: "", starterId: "s" };
  const card = (slug: string, previewable = true) => ({ slug, looks: [{ showcase: previewable ? shown : null }] });

  it("goes round the theme store's order, counting only themes with something to preview", () => {
    const cards = [card("a"), card("b", false), card("c"), card("d")];
    expect(previewNeighbours(cards, "a")).toMatchObject({ previous: { slug: "d" }, next: { slug: "c" } });
    expect(previewNeighbours(cards, "c")).toMatchObject({ previous: { slug: "a" }, next: { slug: "d" } });
    expect(previewNeighbours(cards, "d")).toMatchObject({ previous: { slug: "c" }, next: { slug: "a" } });
  });

  it("offers none when there is no other theme to preview, or the theme is not in the store", () => {
    expect(previewNeighbours([card("a"), card("b", false)], "a")).toBeNull();
    expect(previewNeighbours([card("a"), card("b")], "gone")).toBeNull();
    expect(previewNeighbours([card("a"), card("b")], "a")).toMatchObject({ previous: { slug: "b" }, next: { slug: "b" } });
  });
});
