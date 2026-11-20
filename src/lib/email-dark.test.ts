import { describe, expect, it } from "vitest";

import { darkPreview } from "./email-dark";

describe("an email seen as a mail app turns it dark (M3.4)", () => {
  it("reverses its colours and keeps its pictures, inside the head", () => {
    const out = darkPreview("<html><head><title>x</title></head><body><img src=a.png></body></html>");
    expect(out).toContain("filter:invert(1) hue-rotate(180deg)");
    expect(out.indexOf("data-dark-preview")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toMatch(/img,picture,video\{filter:invert\(1\)/);
  });

  it("is put first in an email without a head", () => {
    expect(darkPreview("<p>Hei</p>")).toMatch(/^<style data-dark-preview>.*<p>Hei<\/p>$/);
  });
});
