import { describe, expect, it } from "vitest";

import { parseDemoDetails, partsWords, presetRefusal } from "./demo-stores";

/** Demo stores' pure parts (D277): what a preset cannot hold, in words, and the details for *See it live*. */
describe("a demo store's look as a preset", () => {
  it("names the parts a preset cannot hold", () => {
    expect(partsWords([])).toBe("");
    expect(partsWords(["css"])).toBe("the CSS");
    expect(partsWords(["header", "footer", "productLayout", "css"])).toBe("the header, the footer, the product page and the CSS");
  });

  it("is refused only when one of them changed, offering a new theme instead", () => {
    expect(presetRefusal([])).toBeNull();
    expect(presetRefusal(["header", "css"])).toBe(
      "A preset holds colours, fonts, buttons and the other theme settings only, and this demo store changed the header and the CSS. Publish it as a new theme instead, or put those back as the theme placed them.",
    );
  });
});

describe("a demo store's details", () => {
  it("keeps its trade on one line and a picture on the site or over https", () => {
    expect(parseDemoDetails({ trade: "  Linen \n and   home goods ", pictureUrl: "" })).toEqual({ ok: true, details: { trade: "Linen and home goods", pictureUrl: null } });
    expect(parseDemoDetails({ trade: "", pictureUrl: "/demo/field.webp" })).toEqual({ ok: true, details: { trade: "", pictureUrl: "/demo/field.webp" } });
    expect(parseDemoDetails({ trade: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(parseDemoDetails({ pictureUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(parseDemoDetails({ pictureUrl: "//evil.example/x.png" })).toMatchObject({ ok: false });
  });
});
