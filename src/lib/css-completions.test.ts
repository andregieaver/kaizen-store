import { describe, expect, it } from "vitest";

import { THEME_VARIABLES, classNameStart, knownClassNames } from "./css-completions";
import { THEME_TEMPLATE_KEYS, templateSettings, themeCss } from "./theme";

describe("CSS editor completions", () => {
  it("offers only variables the theme writes, and every theme writes them", () => {
    for (const template of THEME_TEMPLATE_KEYS) {
      const css = themeCss(templateSettings(template), "html");
      for (const { name } of THEME_VARIABLES) expect(css, `${template} ${name}`).toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it("lists the page's classes and the text styles once, leaving out what is not a class name", () => {
    expect(knownClassNames(["hero  wide", undefined, "hero", "1bad x:y"], ["sunset"])).toEqual(["hero", "ts-sunset", "wide"]);
  });

  it("finds a class being typed, never a number's dot", () => {
    expect(classNameStart(".he")).toBe(0);
    expect(classNameStart("main .he")).toBe(5);
    expect(classNameStart("a, .")).toBe(3);
    expect(classNameStart("  padding: 0.5")).toBeNull();
    expect(classNameStart("1.")).toBeNull();
    expect(classNameStart("color: red")).toBeNull();
  });
});
