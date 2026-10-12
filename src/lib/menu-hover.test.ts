import { describe, expect, it } from "vitest";

import { isCurrentPath, menuHoverStyle } from "./menu-hover";
import { menuHoverSchema } from "./menu-hover-schema";
import { pageInput } from "./page-content";

describe("menu hover (D207)", () => {
  it("draws nothing of its own without an effect", () => {
    expect(menuHoverStyle(undefined)).toBeNull();
  });

  it("writes a line's edge, thickness and colour, and marks the page shown unless told not to", () => {
    const style = menuHoverStyle({ kind: "line", edge: "both", thickness: 3, color: "#112233", textColor: "#ffffff" })!;
    expect(style.attrs).toEqual({ "data-mh": "line", "data-mh-travel": "grow", "data-mh-edge": "both", "data-mh-text": "", "data-mh-active": "" });
    expect(style.style).toMatchObject({ "--mh-fill": "linear-gradient(#112233, #112233)", "--mh-thick": "3px", "--mh-radius": "0px", "--mh-text": "#ffffff" });
    expect(menuHoverStyle({ kind: "line", active: false })!.attrs["data-mh-active"]).toBeUndefined();
  });

  it("fills a background with its gradient, gliding when asked, the theme's accent unless set", () => {
    const style = menuHoverStyle({ kind: "background", travel: "slide", gradient: { colors: ["#000000", "#ffffff"], angle: 90 } })!;
    expect(style.attrs["data-mh-travel"]).toBe("slide");
    expect(style.attrs["data-mh-edge"]).toBeUndefined();
    expect(style.style["--mh-fill"]).toBe("linear-gradient(90deg, #000000, #ffffff)");
    expect(style.style["--mh-radius"]).toBe("6px");
    expect(menuHoverStyle({ kind: "background" })!.style["--mh-fill"]).toBe("linear-gradient(var(--accent), var(--accent))");
  });

  it("keeps only checked colours and sizes", () => {
    expect(menuHoverSchema.safeParse({ kind: "line", color: "red; x: y" }).success).toBe(false);
    expect(menuHoverSchema.safeParse({ kind: "line", thickness: 40 }).success).toBe(false);
    expect(menuHoverSchema.safeParse({ kind: "glow" }).success).toBe(false);
    expect(menuHoverSchema.parse({ kind: "background", color: "#ABCDEF" })!.color).toBe("#abcdef");
  });

  it("is saved with a menu component", () => {
    const content = {
      title: "Side", slug: "side", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [],
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "m1", type: "menu", itemHover: { kind: "line", travel: "slide" } }] }] }],
    };
    const parsed = pageInput.safeParse(content);
    expect(parsed.success).toBe(true);
  });

  it("knows the link of the page shown", () => {
    expect(isCurrentPath("/s/butikk/no/om", "/s/butikk/no/om/")).toBe(true);
    expect(isCurrentPath("/s/butikk/no/om", "/s/butikk/no/om-oss")).toBe(false);
    expect(isCurrentPath("https://example.com/om", "/om", "https://example.com")).toBe(true);
    expect(isCurrentPath("https://other.com/om", "/om", "https://example.com")).toBe(false);
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/", "/om")).toBe(false);
  });
});
