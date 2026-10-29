import { describe, expect, it } from "vitest";

import { cleanStyleDeclarations, slugFor, slugOfClass, starterSettings, stylesInMarkup, textStyleDeclarations, textStylesCss } from "./text-styles";

/** Text styles (D393): every declaration a style becomes is written by code or kept from a closed list. */
describe("text styles", () => {
  it("writes a gallery look's CSS from its checked settings only", () => {
    const css = textStylesCss([{ slug: "gradient-text", kind: "gradient", settings: { colors: ["#FF0000", "#0000ff"], angle: 45 }, css: null }]);
    expect(css).toBe(
      ".ts-gradient-text{color:#ff0000;background-image:linear-gradient(45deg, #ff0000, #0000ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;-webkit-box-decoration-break:clone;box-decoration-break:clone}",
    );
    // A value that is not a colour or out of range is the look's own default, never written as given.
    const odd = textStyleDeclarations({ kind: "glow", settings: { color: "red;}body{display:none" as string, size: 999 }, css: null });
    expect(odd).toEqual([["text-shadow", "0 0 30px #2563eb, 0 0 60px #2563eb"]]);
    expect(textStylesCss([{ slug: "Bad Slug", kind: "colour", settings: {}, css: null }])).toBe("");
  });

  it("keeps only text properties with safe values from a style's own CSS, and names the rest", () => {
    const { declarations, dropped } = cleanStyleDeclarations(
      "color: #1d4ed8;\nposition: absolute;\nbackground-image: url(https://x.example/a.png);\ntext-shadow: 0 2px 4px #0003 !important;\nbackground-image: linear-gradient(90deg, #fff, #000);\nfont-weight: 700}body{color:red",
    );
    expect(declarations).toEqual([
      ["color", "#1d4ed8"],
      ["text-shadow", "0 2px 4px #0003"],
      ["background-image", "linear-gradient(90deg, #fff, #000)"],
    ]);
    expect(dropped).toEqual(["position", "background-image", "font-weight"]);
  });

  it("makes slugs from names, unique, and reads a style's class", () => {
    expect(slugFor("Gradient text", [])).toBe("gradient-text");
    expect(slugFor("Gradient text", ["gradient-text"])).toBe("gradient-text-2");
    expect(slugFor("Blå glød!", [])).toBe("bla-glod");
    expect(slugFor("!!!", [])).toBe("style");
    expect(slugOfClass("ts-gradient-text")).toBe("gradient-text");
    expect(slugOfClass("green-text")).toBeNull();
    expect(stylesInMarkup('My <span class="big ts-glow">awesome</span> <span="ts-x">y</span>')).toEqual(["glow", "x"]);
  });

  it("starts each look from the theme's colours", () => {
    expect(starterSettings("gradient", { accent: "#123456", text: "#000000" }).colors?.[0]).toBe("#123456");
    expect(starterSettings("outline", { accent: "#123456", text: "#222222" }).color).toBe("#222222");
  });
});
