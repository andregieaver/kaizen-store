import { describe, expect, it } from "vitest";

import { slugFor, styleCssBody, styleCssProblem, slugOfClass, starterSettings, stylesInMarkup, textStyleDeclarations, textStylesCss } from "./text-styles";

/** Text styles (D393): a gallery look is written by code; a style's own CSS is any CSS the site's own may hold. */
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

  it("draws a style's own CSS as it is written, any property and nested rules, refused only where the site's own CSS is", () => {
    const own = "padding: 5px 10px;\nborder-radius: 99px;\nborder: 2px solid #fff !important;\n&:hover { color: #1d4ed8; }\n@media (max-width: 600px) { padding: 2px; }";
    expect(styleCssProblem(own)).toBeNull();
    expect(textStylesCss([{ slug: "pill", kind: "custom", settings: {}, css: own }])).toBe(`.ts-pill{${own}}`);
    // A whole rule pasted is kept as its body; a declaration before a nested rule is a body, never unwrapped.
    expect(styleCssBody(".pill { border: 1px solid red; }")).toBe("border: 1px solid red;");
    expect(styleCssBody("color: red; &:hover { color: blue; }")).toBe("color: red; &:hover { color: blue; }");
    expect(styleCssBody("&:hover { color: blue; }")).toBe("&:hover { color: blue; }");
    // What would reach outside the rule, or load from elsewhere, is refused and never drawn.
    for (const bad of ["color: red}body{display:none", "color: red; </style>", "@import url(x.css);", "background: url(https://x.example/a.png)", ""]) {
      expect(styleCssProblem(bad), bad).not.toBeNull();
      expect(textStylesCss([{ slug: "bad", kind: "custom", settings: {}, css: bad }]), bad).toBe("");
    }
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
