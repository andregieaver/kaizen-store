import { describe, expect, it } from "vitest";

import { headerStage, headerStageGradients, headerStageLook, stageIsEmpty, withHeaderStage } from "./header-stages";
import { defaultGradient } from "./motion-edit";
import { pageInput, type HeaderOverlay } from "./page-content";

const base: HeaderOverlay = { where: "everywhere", categories: [], tags: [] };

describe("a header's stages over the page (D533)", () => {
  it("leave a header no one has touched as it was: no hooks, so the rows' own settings draw it", () => {
    expect(headerStageLook(undefined)).toEqual({ attrs: {}, style: {} });
    expect(headerStageLook(base)).toEqual({ attrs: {}, style: {} });
    expect(stageIsEmpty(headerStage(base, "revealed"))).toBe(true);
  });

  it("read the top's text colour kept before the stages, and the stage's own over it", () => {
    const old: HeaderOverlay = { ...base, textColor: "#ffffff" };
    expect(headerStage(old, "top").textColor).toBe("#ffffff");
    expect(headerStage(old, "revealed").textColor).toBeUndefined();
    expect(headerStageLook(old).style).toEqual({ "--header-overlay-text": "#ffffff" });
    expect(headerStage({ ...old, top: { textColor: "#000000" } }, "top").textColor).toBe("#000000");
  });

  it("are written with no empty stage, and the top's text colour kept in the stage alone", () => {
    const old: HeaderOverlay = { ...base, textColor: "#ffffff" };
    const moved = withHeaderStage(old, "top", { ...headerStage(old, "top"), blur: 6 });
    expect(moved).toEqual({ ...base, top: { blur: 6, textColor: "#ffffff" } });
    expect(withHeaderStage(moved, "top", {})).toEqual(base);
    expect(withHeaderStage(base, "revealed", { blur: 99 }).revealed).toEqual({ blur: 20 });
    expect(withHeaderStage(base, "revealed", { blur: 0 }).revealed).toEqual({ blur: 0 });
  });

  it("say which settings each stage has and their values, for the stylesheet", () => {
    const overlay: HeaderOverlay = {
      ...base,
      top: { background: { type: "none" }, blur: 0 },
      revealed: { background: { type: "color", color: "#112233", opacity: 70 }, blur: 12, textColor: "#000000" },
    };
    const look = headerStageLook(overlay);
    expect(look.attrs).toEqual({
      "data-hs-top-bg": "none",
      "data-hs-top-blur": "",
      "data-hs-rev-bg": "color",
      "data-hs-rev-blur": "",
      "data-hs-rev-text": "",
    });
    expect(look.style).toEqual({
      "--hs-top-blur": "0px",
      "--hs-rev-bg": "color-mix(in srgb, #112233 70%, transparent)",
      "--hs-rev-blur": "12px",
      "--hs-rev-text": "#000000",
    });
    // A colour that is not `#rrggbb` is not written into the page's CSS.
    expect(headerStageLook({ ...base, revealed: { background: { type: "color", color: "red;x" }, textColor: "url(x)" } })).toEqual({ attrs: {}, style: {} });
  });

  it("lay a stage's gradient as a layer of its own", () => {
    const gradient = defaultGradient("radial");
    const overlay: HeaderOverlay = { ...base, revealed: { background: gradient } };
    expect(headerStageLook(overlay).attrs).toEqual({ "data-hs-rev-bg": "gradient" });
    expect(headerStageGradients(overlay)).toEqual([{ stage: "revealed", gradient }]);
    expect(headerStageGradients(base)).toEqual([]);
  });

  it("are what a header's schema keeps, and refuse what it cannot draw", () => {
    const page = { title: "Header", slug: "header", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [] };
    const header = (overlay: unknown) => pageInput.safeParse({ ...page, rows: [], overlay });
    const good = header({
      ...base,
      top: { background: { type: "none" } },
      revealed: { background: defaultGradient("shift"), blur: 8, textColor: "#000000" },
    });
    expect(good.success).toBe(true);
    // An empty stage is left out.
    const empty = header({ ...base, top: {} });
    expect(empty.success && empty.data.overlay?.top).toBeUndefined();
    expect(header({ ...base, top: { blur: 21 } }).success).toBe(false);
    expect(header({ ...base, top: { background: { type: "image" } } }).success).toBe(false);
    expect(header({ ...base, revealed: { textColor: "white" } }).success).toBe(false);
  });
});
