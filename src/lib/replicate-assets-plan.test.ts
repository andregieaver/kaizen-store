import { describe, expect, it } from "vitest";

import { PICTURES_MAX, fontFamilies, pictureAddresses, videoAddresses } from "./replicate-assets-plan";
import type { CaptureNode, PageCapture } from "./replicate-capture";

const node = (tag: string, extra: Partial<CaptureNode> = {}, children: CaptureNode[] = []): CaptureNode => ({ p: "", tag, box: [0, 0, 100, 100], s: { display: "block" }, children, ...extra });
const page = (children: CaptureNode[], fonts: PageCapture["fonts"] = []): PageCapture => ({
  viewport: { w: 1440, h: 900 },
  url: "https://example.com/",
  title: "",
  lang: "",
  description: "",
  docWidth: 1440,
  docHeight: 1000,
  background: "rgb(255, 255, 255)",
  root: node("body", {}, children),
  fonts,
  left: { fixed: [], hidden: 0, capped: false },
});

describe("what a page needs downloaded", () => {
  it("lists pictures in the order the page shows them, once each, from both widths", () => {
    const desktop = page([
      node("img", { media: { kind: "img", url: "https://example.com/a.jpg", width: 10, height: 10, alt: "" } }),
      node("section", { bg: ["https://example.com/hero.jpg"], s: { display: "block", backgroundImage: 'url("https://example.com/hero.jpg"), linear-gradient(red, blue)' } }),
      node("video", { media: { kind: "video", url: "https://example.com/v.mp4", poster: "https://example.com/poster.jpg", autoplay: true, loop: true, muted: true, controls: false } }),
      node("img", { media: { kind: "img", url: "https://example.com/a.jpg", width: 10, height: 10, alt: "again" } }),
    ]);
    const mobile = page([node("img", { media: { kind: "img", url: "https://example.com/small.jpg", width: 10, height: 10, alt: "" } })]);
    const { urls, over } = pictureAddresses([desktop, mobile, null]);
    expect(urls).toEqual(["https://example.com/a.jpg", "https://example.com/hero.jpg", "https://example.com/poster.jpg", "https://example.com/small.jpg"]);
    expect(over).toBe(0);
  });

  it("keeps to the limit and says how many were left out", () => {
    const many = page(Array.from({ length: PICTURES_MAX + 7 }, (_, i) => node("img", { media: { kind: "img", url: `https://example.com/${i}.jpg`, width: 1, height: 1, alt: "" } })));
    const { urls, over } = pictureAddresses([many]);
    expect(urls).toHaveLength(PICTURES_MAX);
    expect(over).toBe(7);
  });

  it("lists video files, not embeds", () => {
    const desktop = page([
      node("video", { media: { kind: "video", url: "https://example.com/a.mp4", poster: null, autoplay: false, loop: false, muted: false, controls: true } }),
      node("video", { media: { kind: "video", url: null, poster: null, autoplay: false, loop: false, muted: false, controls: true } }),
      node("iframe", { media: { kind: "embed", url: "https://www.youtube.com/embed/abcdefghijk", title: "" } }),
    ]);
    expect(videoAddresses([desktop, null])).toEqual(["https://example.com/a.mp4"]);
  });

  it("names the typefaces to install, most used first, and not the ones every browser has", () => {
    const capture = page([], [
      { family: "Arial", weight: "400", style: "normal", chars: 900 },
      { family: "Inter", weight: "400", style: "normal", chars: 500 },
      { family: "Inter", weight: "700", style: "normal", chars: 200 },
      { family: "Gotham Rounded", weight: "700", style: "normal", chars: 300 },
      { family: "Georgia", weight: "400", style: "italic", chars: 50 },
    ]);
    const { wanted, system } = fontFamilies(capture);
    expect(wanted).toEqual(["Inter", "Gotham Rounded"]);
    expect(system).toEqual(["Arial", "Georgia"]);
  });
});
