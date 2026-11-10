import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UploadedVideo } from "./video-view";

/** An uploaded video (D91, D536) as the server draws it, before any script runs. */
const draw = (props: Partial<Parameters<typeof UploadedVideo>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(UploadedVideo, {
      src: "https://e.com/page-videos/a.webm",
      poster: "https://e.com/a.webp",
      title: "Our logo",
      controls: true,
      autoplay: false,
      loop: false,
      style: { aspectRatio: "16 / 9" },
      ...props,
    }),
  );

describe("an uploaded video", () => {
  it("has its controls and its picture when the visitor starts it", () => {
    const html = draw();
    expect(html).toContain(" controls=");
    expect(html).toContain('poster="https://e.com/a.webp"');
    expect(html).not.toContain(" loop=");
    expect(html).toContain('aria-label="Our logo"');
  });

  it("starts by itself muted and looping, as it always did, and without controls when they are switched off", () => {
    const html = draw({ autoplay: true, controls: false });
    expect(html).toContain(" loop=");
    expect(html).toContain(" muted=");
    expect(html).not.toContain(" controls=");
    expect(html).toContain('poster="https://e.com/a.webp"');
  });

  it("set to play once has no loop, no controls and no picture to flash before its first frame", () => {
    const html = draw({ autoplay: true, controls: false, once: true });
    expect(html).not.toContain(" loop=");
    expect(html).not.toContain(" controls=");
    expect(html).not.toContain("poster=");
    expect(html).toContain(" muted=");
    expect(html).toContain(" playsInline=");
  });

  it("draws nothing behind the video, so a see-through one shows the page", () => {
    expect(draw()).not.toMatch(/bg-black|background/);
    expect(draw({ autoplay: true, once: true })).not.toMatch(/bg-black|background/);
  });
});
