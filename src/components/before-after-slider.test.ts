import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BeforeAfterSlider } from "./before-after-slider";

/** Before and after (D413) as the server draws it, before any script runs. */
const draw = (props: Partial<Parameters<typeof BeforeAfterSlider>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(BeforeAfterSlider, {
      before: createElement("img", { alt: "Before it", src: "/a.webp" }),
      after: createElement("img", { alt: "After it", src: "/b.webp" }),
      start: 50,
      ...props,
    }),
  );

describe("a Before and after's slider", () => {
  it("is the browser's own range input, named, at its start, with the after picture shown right of it", () => {
    const html = draw({ start: 30 });
    expect(html).toMatch(/<input type="range" min="0" max="100" step="1" aria-label="Compare before and after" aria-valuetext="30 % before, 70 % after"[^>]*value="30"/);
    expect(html).toContain("clip-path:inset(0 0 0 30%)");
    expect(html).toContain("left:30%");
    expect(html).toContain('alt="Before it"');
    expect(html).toContain('alt="After it"');
  });

  it("says Before and After unless the owner wrote words of their own, and none when they are hidden", () => {
    expect(draw()).toMatch(/>Before<\/span>.*>After<\/span>/);
    expect(draw({ beforeLabel: "Old", afterLabel: "New" })).toMatch(/>Old<\/span>.*>New<\/span>/);
    expect(draw({ hideLabels: true })).not.toContain('data-kz-text="caption"');
  });
});
