import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BACKDROPS } from "@/lib/backdrops";
import type { BackgroundLayer } from "@/lib/background-layers";
import { DEFAULT_BREAKPOINTS } from "@/lib/breakpoints";
import { colourCss } from "@/lib/colour";
import { motionNeeds } from "@/lib/motion-attrs";
import { backgroundImageUrls, withSmallCopies } from "@/lib/page-images";
import { newPageContent, pageInput, type PageBlock, type PageContent, type PageRow } from "@/lib/page-content";
import { blockStyle, partCss } from "@/lib/part-css";
import { partStyleAt } from "@/lib/part-css.testing";
import { mapTemplateMedia } from "@/lib/template-content";

import { PageArticle } from "./page-article";
import { BlockBackground, blockBox } from "./page-parts";
import { SettingsMemoryContext, SettingsTabs, settingsMemoryStore } from "./admin/page-builder-fields";

vi.mock("server-only", () => ({}));
vi.mock("@/server/place-lang", () => ({ placeLang: async () => "nb" }));

const NO_THEME = { elements: undefined, sections: undefined };
const glow: BackgroundLayer = { id: "g", type: "glow", color: "#d946ef", outer: "#7c3aed", x: 50, y: 63, width: 150, height: 40, scroll: -100 };
const picture = { url: "https://example.com/card.webp", width: 1600, height: 900 };

const heading = (extra: Partial<PageBlock> = {}): PageBlock => ({ id: "h1", type: "heading", text: "On its own background", level: 2, ...extra }) as PageBlock;
const row = (block: PageBlock): PageRow => ({ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] });
const page = (block: PageBlock): PageContent => ({ ...newPageContent(), title: "Card", slug: "card", rows: [row(block)] });
const draw = (content: PageContent) =>
  renderToString(createElement(PageArticle, { content, place: { pageId: "p", owner: null, theme: NO_THEME }, inAdmin: true })).replace(/<!-- -->/g, "");

describe("a component's own background (D538)", () => {
  it("is kept through a save, every kind a column takes, with its layers, hue, motion and blur behind", () => {
    const block = heading({
      background: { type: "image", image: picture, overlay: { color: "#000000", opacity: 40 } },
      backgroundLayers: [glow],
      backgroundHue: 30,
      backgroundMotion: { effect: "ken-burns" },
    } as Partial<PageBlock>);
    const parsed = pageInput.parse(page(block));
    expect(parsed.rows[0].columns[0].blocks[0]).toMatchObject({ background: { type: "image" }, backgroundLayers: [{ id: "g" }], backgroundHue: 30 });
    const glass = pageInput.parse(page(heading({ background: { type: "color", color: "#ffffff", opacity: 40 }, backdropBlur: 12 } as Partial<PageBlock>)));
    expect(glass.rows[0].columns[0].blocks[0]).toMatchObject({ backdropBlur: 12 });
    // A video is a row's alone.
    expect(() => pageInput.parse(page(heading({ background: { type: "video", video: { url: "https://example.com/a.mp4" }, poster: null } } as unknown as Partial<PageBlock>)))).toThrow();
  });

  it("draws a colour from the part stylesheet, see-through and with what is behind blurred", () => {
    const block = heading({ background: { type: "color", color: "#1d1250", opacity: 60 }, backdropBlur: 8 } as Partial<PageBlock>);
    const style = partStyleAt(partCss([row(block)], "site", DEFAULT_BREAKPOINTS), blockStyle(block, "site").className.split(" "), 1400);
    expect(style["background-color"]).toBe(colourCss("#1d1250", 60));
    expect(style["backdrop-filter"]).toBe("blur(8px)");
    // A colour needs no frame of its own behind the text, and the text reads in the colours made for a dark surface (D390).
    expect(blockBox(block, "site").className).not.toContain("isolate");
    expect(blockBox(block, "site").className).toContain("kz-on-dark");
  });

  it("draws a picture, gradient or layers behind what the component holds, as a column's, and only then", () => {
    const block = heading({ background: BACKDROPS.horizon.background, backgroundLayers: [glow] } as Partial<PageBlock>);
    expect(blockBox(block, "site").className).toContain("relative isolate");
    const out = draw(page(block));
    expect(out).toContain('data-fx-bglayer="glow"');
    expect(out.indexOf("data-fx-bgroot")).toBeLessThan(out.indexOf("On its own background"));
    expect(renderToStaticMarkup(createElement(BlockBackground, { block: heading() }))).toBe("");
  });

  it("gives its picture to the phone's small copies, to copies between stores, and its scrolling layers to the runtime", () => {
    const block = heading({ background: { type: "image", image: picture, overlay: null }, backgroundLayers: [glow] } as Partial<PageBlock>);
    const content = page(block);
    expect(backgroundImageUrls(content)).toEqual([picture.url]);
    const small = withSmallCopies(content, () => "https://example.com/card-480.webp");
    expect(small.rows[0].columns[0].blocks[0].background).toMatchObject({ image: { small: "https://example.com/card-480.webp" } });
    expect(motionNeeds(content.rows).js).toBe(true);
    const copied = mapTemplateMedia("block", block, (url) => url.replace("example.com", "copy.example"));
    expect((copied as PageBlock).background).toMatchObject({ image: { url: "https://copy.example/card.webp" } });
    // A picture left out takes the background with it, and its motion.
    const dropped = mapTemplateMedia("block", { ...block, backgroundMotion: { effect: "ken-burns" } } as PageBlock, () => null) as PageBlock;
    expect(dropped.background).toBeUndefined();
    expect(dropped.backgroundMotion).toBeUndefined();
  });
});

describe("a settings dialog's tab, kept from part to part (D538)", () => {
  const panels = { general: "General panel", style: "Style panel", motion: "Motion panel", advanced: "Advanced panel" };
  const drawTabs = (store: ReturnType<typeof settingsMemoryStore> | null) =>
    renderToStaticMarkup(createElement(SettingsMemoryContext.Provider, { value: store }, createElement(SettingsTabs, panels)));

  it("opens on the tab the last part's dialog showed, and on General when the builder kept none", () => {
    const store = settingsMemoryStore();
    expect(drawTabs(store)).toContain("General panel");
    store.write({ tab: "advanced", scroll: 420 });
    const out = drawTabs(store);
    expect(out).toContain("Advanced panel");
    expect(out).not.toContain("General panel");
    expect(store.read()).toEqual({ tab: "advanced", scroll: 420 });
    store.reset();
    expect(drawTabs(store)).toContain("General panel");
    expect(drawTabs(null)).toContain("General panel");
  });
});
