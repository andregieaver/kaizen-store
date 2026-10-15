import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pageRowSchema, type PageBlock, type PageRow } from "./page-content";
import { CORE_SECTION_STYLES, SECTION_STYLES_MAX, sectionElements, sectionStyleChoices, sectionStyleLabel } from "./section-styles";
import { parseStoreTheme, templateSettings, themeTabValue, withThemeTab } from "./theme";
import { layerElement, sectionStylesSchema, themedRows, type ThemeElements } from "./theme-elements";
import { detachThemeValues } from "./theme-detach";
import { typographyAt } from "./typography";

/**
 * Section styles (D242, docs/theme-phase-2.md step 1): a row naming a style is drawn with the style's elements over the site's, its own
 * settings winning over both; a theme without that style gives its Plain; a row naming none is drawn as before.
 */

const heading = (extra: Record<string, unknown> = {}): PageBlock => ({ id: "h", type: "heading", text: "Hello", level: 2, ...extra }) as PageBlock;
const rowOf = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }], ...extra });
const text = (row: PageRow) => typographyAt(row.columns[0].blocks[0] as never, "text", "xl");

const site: ThemeElements = { h2: { typography: { text: { color: "#111111", weight: 700 } } }, row: { radius: 4 } };
const sections = {
  hero: { h2: { typography: { text: { color: "#ffffff" } } }, row: { background: { type: "color" as const, color: "#000000" } } },
  plain: { h2: { typography: { text: { color: "#333333" } } } },
};

describe("section styles (D242)", () => {
  it("lay a style's elements over the site's for the rows that name it, the row's own settings winning", () => {
    const [hero] = themedRows([rowOf([heading()], { sectionStyle: "hero" })], site, sections);
    expect(text(hero)).toMatchObject({ color: "#ffffff", weight: 700 });
    expect(hero.radius).toBe(4);
    expect(hero.background).toEqual({ type: "color", color: "#000000" });
    const [own] = themedRows([rowOf([heading({ typography: { text: { color: "#00ff00" } } })], { sectionStyle: "hero" })], site, sections);
    expect(text(own).color).toBe("#00ff00");
  });

  it("give Plain for a style the theme does not have, and the site's for a row naming none", () => {
    const [unknown] = themedRows([rowOf([heading()], { sectionStyle: "banner" })], site, sections);
    expect(text(unknown).color).toBe("#333333");
    const [none] = themedRows([rowOf([heading()])], site, sections);
    expect(text(none).color).toBe("#111111");
    // A theme with neither the style nor Plain: the site's own elements.
    const [bare] = themedRows([rowOf([heading()], { sectionStyle: "banner" })], site, { hero: sections.hero });
    expect(text(bare).color).toBe("#111111");
  });

  it("draw pages that name no style exactly as before", () => {
    const rows = [rowOf([heading()]), rowOf([heading({ level: 1 })], { id: "r2" })];
    expect(themedRows(rows, site, sections)).toEqual(themedRows(rows, site));
    expect(themedRows(rows, undefined, undefined)).toBe(rows);
  });

  it("lay a style over the site's element keeping the row's widths from either", () => {
    expect(layerElement({ radius: 2 } as never, { width: "full", radius: 8 } as never)).toMatchObject({ radius: 2, width: "full" });
    expect(sectionElements(site, sections, "hero", layerElement)?.row).toMatchObject({ radius: 4, background: { color: "#000000" } });
  });

  it("are names only, of a fixed shape, at most twelve, kept with the Theme tab and in the theme", () => {
    expect(pageRowSchema.safeParse({ ...rowOf([]), sectionStyle: "hero" }).success).toBe(true);
    expect(pageRowSchema.safeParse({ ...rowOf([]), sectionStyle: "Hero; color: red" }).success).toBe(false);
    expect(sectionStylesSchema.safeParse({ "bad name": {} }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: SECTION_STYLES_MAX + 1 }, (_, i) => [`s${i}`, { row: { radius: 1 } }]));
    expect(sectionStylesSchema.safeParse(many).success).toBe(false);
    // A style that says nothing is left out.
    expect(sectionStylesSchema.parse({ hero: {} })).toBeUndefined();

    const settings = templateSettings("minimal");
    const tab = themeTabValue(settings);
    const next = withThemeTab(settings, { ...tab, sections: { hero: sections.hero, empty: {} } });
    expect(next.sectionStyles).toEqual({ hero: sections.hero });
    expect(themeTabValue(next).sections).toEqual({ hero: sections.hero });
    expect(parseStoreTheme({ base: "minimal", savedId: null, settings: next }).settings.sectionStyles).toEqual({ hero: sections.hero });
    expect(withThemeTab(next, { ...themeTabValue(next), sections: {} }).sectionStyles).toBeUndefined();
  });

  it("are offered core first, then the theme's own, with labels", () => {
    expect(sectionStyleChoices({ banner: {} })).toEqual([...CORE_SECTION_STYLES, "banner"]);
    expect(sectionStyleLabel("hero")).toBe("Hero");
    expect(sectionStyleLabel("big-banner")).toBe("Big banner");
  });

  it("are what the page migration compares against, so a setting a style gives follows it", () => {
    const rows = [rowOf([heading({ typography: { text: { color: "#ffffff" } } })], { sectionStyle: "hero" })];
    const result = detachThemeValues(rows, site, sections);
    expect(result.followed).toBe(1);
    expect(themedRows(result.rows, site, sections)).toEqual(themedRows(rows, site, sections));
  });
});
