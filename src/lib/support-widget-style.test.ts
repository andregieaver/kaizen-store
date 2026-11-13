import { describe, expect, it } from "vitest";

import { DEFAULT_STYLE, PANEL_WIDTH, readStyle, styleProblem, widgetCss, widgetStyleSchema } from "./support-widget-style";

describe("a chat widget's own look (D582)", () => {
  it("is the store's own chat until something is chosen", () => {
    expect(DEFAULT_STYLE).toMatchObject({ accent: null, background: null, text: null, corners: "store", side: "right", offsetX: 16, offsetY: 16, launcher: "icon", width: "standard", font: null, greeting: "", css: "" });
    expect(widgetCss(DEFAULT_STYLE, ".w")).toBe(".w {  }");
  });

  it("reads anything stored back to a style that draws, never failing", () => {
    expect(readStyle(null)).toEqual(DEFAULT_STYLE);
    expect(readStyle({ accent: "red", corners: "wobbly", offsetX: 9999, side: "top", width: 3 })).toEqual(DEFAULT_STYLE);
    expect(readStyle({ accent: "#ABC", offsetX: "40" })).toMatchObject({ accent: "#aabbcc", offsetX: 40 });
  });

  it("says what is wrong with what the owner sent", () => {
    expect(styleProblem({ accent: "#00ff00", background: "", text: "" })).toBeNull();
    expect(styleProblem({ accent: "green" })).toBe("colour");
    expect(styleProblem({ label: "x".repeat(41) })).toBe("label");
    expect(styleProblem({ greeting: "x".repeat(301) })).toBe("greeting");
    expect(styleProblem({ css: ".a { color: red" })).toBe("css");
    expect(styleProblem({ css: "</style><script>alert(1)</script>" })).toBe("css");
    expect(styleProblem({ css: "[data-chat-launcher] { box-shadow: none; }" })).toBeNull();
  });

  it("draws its colours on the chat, with readable text on the button and mixed shades for the rest", () => {
    const css = widgetCss(widgetStyleSchema.parse({ accent: "#ffcc00", background: "#101820", text: "#f0f0f0" }), ".kz-chat-widget");
    expect(css).toContain("--accent: #ffcc00; --accent-foreground: #000000");
    expect(css).toContain("--background: #101820");
    expect(css).toContain("--foreground: #f0f0f0");
    expect(css).toContain("--surface: color-mix(in oklab, var(--foreground) 7%, var(--background))");
    expect(css).toContain(".kz-chat-widget [data-chat-launcher] { background: var(--accent); color: var(--accent-foreground); }");
    expect(widgetCss(widgetStyleSchema.parse({ accent: "#1a237e" }), ".w")).toContain("--accent-foreground: #ffffff");
  });

  it("draws its corners and font, and leaves the store's where none is chosen", () => {
    const square = widgetCss(widgetStyleSchema.parse({ corners: "square" }), ".w", '"Inter", sans-serif');
    expect(square).toContain("--button-radius: 0; --radius-button: 0; --radius-lg: 0; --radius-md: 0");
    expect(square).toContain('font-family: "Inter", sans-serif');
    expect(square).toContain(".w [data-chat-launcher], .w [data-chat-launcher] [data-chat-avatar] { border-radius: 0; }");
    expect(widgetCss(widgetStyleSchema.parse({ corners: "store" }), ".w")).not.toContain("radius");
  });

  it("gives the open panel a width of its own on a large screen", () => {
    expect(PANEL_WIDTH).toEqual({ narrow: 320, standard: 384, wide: 448 });
  });
});
