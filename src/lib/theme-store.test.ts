import { describe, expect, it } from "vitest";

import type { DesignSnapshot } from "./design-presets";
import { LAUNCH_THEMES } from "./launch-themes";
import type { ShotFile } from "./theme-shots";
import {
  cardPicture,
  filterThemes,
  madeScreens,
  OWN_SLOTS,
  parseListing,
  parseThemeFilter,
  readListing,
  readOwnPictures,
  showcasePack,
  shownLooks,
  showcaseTrades,
  themeLooks,
  suggestedSlug,
  themeChangelog,
  themeFeatures,
  themeFilterHref,
  sharePicture,
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
  madeCard: null,
  madeShare: null,
  presets: [],
  looks: [{ key: null, name: id, showcase: null }],
  listing: { kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} },
  features: [],
  swatch: { background: "#fff", surface: "#eee", text: "#000", accent: "#111", accentText: "#fff", heading: null },
  ...extra,
});

describe("a listing", () => {
  it("keeps only known kinds and styles, once, in their own order", () => {
    expect(readListing({ kinds: ["home", "nonsense", "food", "home"], styles: "bold" })).toEqual({ kinds: ["food", "home"], styles: ["bold"], pictures: [], pack: null, presetPacks: {} });
    expect(readListing(null)).toEqual({ kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} });
    // The pack each look is shown on (`docs/theme-showcase-phase-1.md` step 3): known packs only, preset keys as keys are written.
    expect(readListing({ pack: "food", presetPacks: { olive: "home", "Bad Key": "beauty", rose: "cars", blush: "beauty" } })).toMatchObject({
      pack: "food",
      presetPacks: { blush: "beauty", olive: "home" },
    });
    expect(readListing({ pack: "cars", presetPacks: ["home"] })).toMatchObject({ pack: null, presetPacks: {} });
    const listing = readListing({ pack: "fashion", presetPacks: { volt: "electronics" } });
    expect([showcasePack(listing, null), showcasePack(listing, "volt"), showcasePack(listing, "gone")]).toEqual(["fashion", "electronics", null]);
    expect(parseListing({ slug: "calm", pack: "", presetPacks: { sand: "beauty", ink: "" } })).toMatchObject({ ok: true, listing: { pack: null, presetPacks: { sand: "beauty" } } });
  });

  it("needs an address of the store's shape", () => {
    expect(parseListing({ slug: " Calm ", kinds: ["fashion"] })).toEqual({ ok: true, slug: "calm", listing: { kinds: ["fashion"], styles: [], pictures: [], pack: null, presetPacks: {} } });
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
    card("a", { listing: { kinds: ["food"], styles: ["warm"], pictures: [], pack: null, presetPacks: {} }, features: ["dark"] }),
    card("b", { listing: { kinds: [], styles: ["bold"], pictures: [], pack: null, presetPacks: {} }, features: [] }),
    card("c", { listing: { kinds: ["fashion"], styles: ["warm"], pictures: [], pack: null, presetPacks: {} }, features: ["dark"] }),
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
    expect(parseListing({ slug: "calm" })).toEqual({ ok: true, slug: "calm", listing: { kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} } });
  });
});

describe("the pictures a theme shows (docs/theme-showcase-phase-2.md step 1)", () => {
  const file = (name: string, width = 1440, height = 900): ShotFile => ({ path: `platform/theme-shots/${name}`, url: `https://x.test/${name}`, width, height, bytes: 1 });

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

  it("without pictures of its own, shows its shown looks' first screens: computers, then phones, each named for its look and store", () => {
    const fashion = { pack: "fashion" as const, trade: "Fashion", line: "Field & Fold, a demo fashion store", starterId: "f" };
    const looks = [
      { key: null, name: "Calm", showcase: fashion, shots: { computer: { screen: file("own-c") }, phone: { screen: file("own-p", 780, 1688) }, version: 2 } },
      { key: "sand", name: "Sand", showcase: { pack: "beauty" as const, trade: "Beauty", line: "Dune, a demo skin care store", starterId: "s" }, shots: { computer: { screen: file("sand-c") }, phone: null, version: 2 } },
      { key: "ink", name: "Ink", showcase: null, shots: null },
      // A look on no published demo store is never drawn, even with a set made before (D274: never the Standard store).
      { key: "sage", name: "Sage", showcase: null, shots: { computer: { screen: file("sage-c") }, phone: null, version: 1 } },
    ];
    expect(madeScreens({ title: "Calm", looks }).map((s) => [s.url, s.alt, s.kind])).toEqual([
      ["https://x.test/own-c", "Calm on a computer, on Field & Fold, a demo fashion store", "computer"],
      ["https://x.test/sand-c", "Calm, Sand on a computer, on Dune, a demo skin care store", "computer"],
      ["https://x.test/own-p", "Calm on a phone, on Field & Fold, a demo fashion store", "phone"],
    ]);
  });

  it("shows only looks on a published demo store, its own first (D274)", () => {
    const shown = { pack: "food" as const, trade: "Food and drink", line: "Harbour Pantry", starterId: "p" };
    expect(shownLooks([{ key: null, showcase: null }, { key: "olive", showcase: shown }, { key: "blush", showcase: null }]).map((l) => l.key)).toEqual(["olive"]);
    expect(shownLooks([{ key: null, showcase: shown }, { key: "olive", showcase: null }]).map((l) => l.key)).toEqual([null]);
  });
});

describe("a theme's looks and the stores they are shown on (docs/theme-showcase-phase-1.md step 3)", () => {
  const presets = [
    { key: "olive", name: "Olive" },
    { key: "blush", name: "Blush" },
  ];
  const listing = { pack: "food" as const, presetPacks: { olive: "home" as const, blush: "beauty" as const } };

  it("are its own look first, then its presets, each on its pack's store while that pack is published", () => {
    const looks = themeLooks("Hearth", presets, listing, new Map([["food", "starter-food"], ["home", "starter-home"]]));
    expect(looks.map((l) => [l.key, l.name, l.showcase?.starterId ?? null])).toEqual([
      [null, "Hearth", "starter-food"],
      ["olive", "Olive", "starter-home"],
      // Its pack is not published: shown nowhere until it is (D274), and a new store started from it gets the Standard store.
      ["blush", "Blush", null],
    ]);
    expect(looks[0].showcase).toMatchObject({ pack: "food", trade: "Food and drink", line: "Harbour Pantry, a demo food and drink store" });
    expect(showcaseTrades(looks)).toEqual(["Food and drink", "Home"]);
  });

  it("are all on the Standard store when no pack is named or published", () => {
    expect(themeLooks("Calm", [], { pack: null, presetPacks: {} }, new Map([["fashion", "x"]]))).toEqual([{ key: null, name: "Calm", showcase: null }]);
    expect(showcaseTrades(themeLooks("Hearth", presets, listing, new Map()))).toEqual([]);
  });
});
