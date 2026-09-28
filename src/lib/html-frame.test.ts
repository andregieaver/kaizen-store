import { describe, expect, it } from "vitest";

import { cssValue, FRAME_HEIGHT_MAX, FRAME_SANDBOX, frameDocument, frameHeight } from "./html-frame";

describe("the HTML component's frame", () => {
  it("is its own origin: scripts run, but the site's cookies and storage are out of reach", () => {
    const flags = FRAME_SANDBOX.split(" ");
    expect(flags).toContain("allow-scripts");
    expect(flags).not.toContain("allow-same-origin");
    expect(flags).not.toContain("allow-top-navigation");
  });

  it("holds the owner's HTML with the script that reports its height", () => {
    const html = '<form><input name="email"></form><script>document.title = "x"</script>';
    const document = frameDocument(html);
    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain(html);
    expect(document).toContain("kaizen:html-height");
    expect(document.indexOf(html)).toBeLessThan(document.lastIndexOf("<script>"));
  });

  it("takes only a reasonable height", () => {
    expect(frameHeight(240.2)).toBe(241);
    expect(frameHeight(1e9)).toBe(FRAME_HEIGHT_MAX);
    expect(frameHeight(-1)).toBeNull();
    expect(frameHeight("300")).toBeNull();
    expect(frameHeight(Number.NaN)).toBeNull();
  });

  it("keeps the page's styles to what CSS values hold", () => {
    expect(cssValue('"Inter", system-ui, sans-serif')).toBe('"Inter", system-ui, sans-serif');
    expect(cssValue("red;}</style><script>")).toBe("red/stylescript");
  });
});
