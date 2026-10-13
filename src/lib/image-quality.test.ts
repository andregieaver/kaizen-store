import { describe, expect, it } from "vitest";

import { likeness, looksTheSame, lowestPassing, savingWords, type Pixels } from "./image-quality";
import { videoTarget } from "./video-compress";

/** A picture drawn by a function of x and y giving RGBA. */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 4);
  return { data, width, height };
}

/** A photo-like picture: soft gradients with fine detail on top. */
const scene = (x: number, y: number): [number, number, number, number] => [
  (x * 3 + 40 * Math.sin(y / 7)) & 255,
  (y * 2 + 30 * Math.cos(x / 5)) & 255,
  (128 + 60 * Math.sin((x + y) / 9)) & 255,
  255,
];

/** Repeatable noise of a given strength. */
function noisy(source: Pixels, strength: number): Pixels {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const data = Uint8ClampedArray.from(source.data, (value, i) => (i % 4 === 3 ? value : value + random() * strength));
  return { ...source, data };
}

describe("whether a compressed picture looks the same (D213)", () => {
  const original = picture(64, 48, scene);

  it("finds a picture the same as itself", () => {
    const same = likeness(original, original);
    expect(same.luma).toBeCloseTo(1, 6);
    expect(same.chroma).toBeCloseTo(1, 6);
    expect(looksTheSame(same)).toBe(true);
  });

  it("lets a trace of change through, and not a visible one", () => {
    expect(looksTheSame(likeness(original, noisy(original, 1)))).toBe(true);
    expect(looksTheSame(likeness(original, noisy(original, 40)))).toBe(false);
  });

  it("is not fooled by a small damaged part in a calm picture", () => {
    const calm = picture(64, 64, () => [120, 140, 160, 255]);
    const damaged = picture(64, 64, (x, y) => (x < 8 && y < 8 ? [255, 0, 0, 255] : [120, 140, 160, 255]));
    const measured = likeness(calm, damaged);
    expect(measured.luma).toBeGreaterThan(0.9);
    expect(looksTheSame(measured)).toBe(false);
  });

  it("counts a change in what is see-through", () => {
    const solid = picture(32, 32, () => [200, 50, 50, 255]);
    const faded = picture(32, 32, () => [200, 50, 50, 120]);
    expect(looksTheSame(likeness(solid, faded))).toBe(false);
  });

  it("notices colour that moved while brightness stayed", () => {
    const red = picture(32, 32, (x) => [180, 60 + x, 60, 255]);
    const swapped = picture(32, 32, (x) => [60, 60 + x + 50, 180, 255]);
    expect(likeness(red, swapped).chroma).toBeLessThan(0.97);
  });

  it("refuses pictures of different sizes", () => {
    expect(() => likeness(original, picture(10, 10, scene))).toThrow();
  });
});

describe("the lowest setting that passes", () => {
  it("halves its way to the lowest passing setting", async () => {
    const tried: number[] = [];
    const found = await lowestPassing(0.5, 0.95, 6, async (q) => (tried.push(q), q), (q) => q >= 0.8);
    expect(found.setting).toBeGreaterThanOrEqual(0.8);
    expect(found.setting).toBeLessThan(0.83);
    expect(tried.length).toBeLessThanOrEqual(7);
  });

  it("falls back to the highest setting when nothing lower passes", async () => {
    const found = await lowestPassing(0.5, 0.95, 4, async (q) => q, () => false);
    expect(found.setting).toBe(0.95);
  });
});

describe("what a saving says", () => {
  it("says the bytes and the share saved", () => {
    expect(savingWords(5_000_000, 900_000)).toBe("Saved 4.1 MB (82%)");
    expect(savingWords(10_000, 4_000)).toBe("Saved 6.0 kB (60%)");
  });

  it("says nothing when nothing was saved", () => {
    expect(savingWords(1000, 1000)).toBeNull();
    expect(savingWords(1000, 1200)).toBeNull();
    expect(savingWords(0, 0)).toBeNull();
  });
});

describe("the size a video is made at", () => {
  it("keeps 1080p and smaller as they are", () => {
    expect(videoTarget(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(videoTarget(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("brings 4K down to 1080p, upright too, in even numbers", () => {
    expect(videoTarget(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(videoTarget(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(videoTarget(3001, 1999)).toEqual({ width: 1622, height: 1080 });
  });
});
