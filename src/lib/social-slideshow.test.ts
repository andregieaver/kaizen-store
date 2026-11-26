import { describe, expect, it } from "vitest";

import { containRect, coverRect, FADE_SECONDS, framesAt, SLIDE_SECONDS, slideshowSeconds, SLIDES_MAX, VIDEO_SIZE, ZOOM_TO } from "./social-slideshow";

describe("a post's slideshow video (D870 S2.5)", () => {
  it("lasts each photo's time with the fades overlapping, at most six photos", () => {
    expect(slideshowSeconds(0)).toBe(0);
    expect(slideshowSeconds(1)).toBe(SLIDE_SECONDS);
    expect(slideshowSeconds(3)).toBeCloseTo(3 * SLIDE_SECONDS - 2 * FADE_SECONDS);
    expect(slideshowSeconds(20)).toBe(slideshowSeconds(SLIDES_MAX));
    expect(slideshowSeconds(SLIDES_MAX)).toBeLessThan(16);
  });

  it("shows one photo zooming in, then the next fading in over it", () => {
    expect(framesAt(0, 3)).toEqual([{ index: 0, alpha: 1, scale: 1, driftX: -1, driftY: 0 }]);
    const step = SLIDE_SECONDS - FADE_SECONDS;
    const fading = framesAt(step + FADE_SECONDS / 2, 3);
    expect(fading.map((f) => f.index)).toEqual([0, 1]);
    expect(fading[1].alpha).toBeCloseTo(0.5);
    expect(fading[0].scale).toBeGreaterThan(1);
    expect(fading[0].scale).toBeLessThanOrEqual(ZOOM_TO);
    // The last photo holds to the very end.
    expect(framesAt(slideshowSeconds(3), 3)).toEqual([{ index: 2, alpha: 1, scale: ZOOM_TO, driftX: 0, driftY: 0 }]);
  });

  it("fills the frame without showing a photo's edge, however far it has zoomed and drifted", () => {
    const box = VIDEO_SIZE;
    for (const image of [{ width: 2000, height: 2000 }, { width: 1200, height: 1600 }, { width: 3000, height: 1000 }]) {
      for (const frame of [{ scale: 1, driftX: 0, driftY: 0 }, { scale: ZOOM_TO, driftX: 1, driftY: 0 }, { scale: ZOOM_TO, driftX: -1, driftY: -1 }]) {
        const r = coverRect(image, box, frame);
        expect(r.x).toBeLessThanOrEqual(0.001);
        expect(r.y).toBeLessThanOrEqual(0.001);
        expect(r.x + r.width).toBeGreaterThanOrEqual(box.width - 0.001);
        expect(r.y + r.height).toBeGreaterThanOrEqual(box.height - 0.001);
      }
    }
  });

  it("draws the post's own picture whole and centred, so its words are never cut", () => {
    const r = containRect({ width: 1080, height: 1350 }, VIDEO_SIZE, 1);
    expect(r.x).toBeGreaterThan(0);
    expect(r.x + r.width).toBeLessThan(VIDEO_SIZE.width);
    expect(r.width / r.height).toBeCloseTo(1080 / 1350);
  });
});
