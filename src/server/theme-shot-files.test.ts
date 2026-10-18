import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { pictureIsBlank, shotFiles } = await import("./theme-shot-files");

/** A made-up photograph: a band of colour at the top (what the card and share image show), white below. */
async function photograph(width: number, height: number): Promise<Buffer> {
  const band = await sharp({ create: { width, height: Math.min(300, height), channels: 3, background: "#225588" } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([{ input: band, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** The pictures cut from one look's photographs (`docs/theme-showcase-phase-2.md`, *Sizes*). */
describe("the pictures made from a look's photographs", () => {
  it("from a computer: the page and its first screen as WebP, an 800 × 600 card and a 1200 × 630 JPEG share image, cut from the top", async () => {
    const files = await shotFiles("computer", { full: await photograph(1440, 5000), screen: await photograph(1440, 900) });
    expect(files.map((f) => [f.kind, f.contentType, f.width, f.height])).toEqual([
      ["full", "image/webp", 1440, 5000],
      ["screen", "image/webp", 1440, 900],
      ["card", "image/webp", 800, 600],
      ["share", "image/jpeg", 1200, 630],
    ]);
    for (const file of files) expect((await sharp(file.bytes).metadata()).format).toBe(file.extension === "jpg" ? "jpeg" : "webp");
    // The card's top is the page's top: the band of colour, not the white below.
    const card = files.find((f) => f.kind === "card")!;
    const { data } = await sharp(card.bytes).extract({ left: 400, top: 10, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(100);
    expect(data[0]).toBeLessThan(80);
  });

  it("from a phone: the page and its first screen only, at their own sizes", async () => {
    const files = await shotFiles("phone", { full: await photograph(390, 3000), screen: await photograph(780, 1688) });
    expect(files.map((f) => [f.kind, f.width, f.height])).toEqual([
      ["full", 390, 3000],
      ["screen", 780, 1688],
    ]);
  });

  it("a page shorter than a card is still a whole card, never stretched out of shape", async () => {
    const files = await shotFiles("computer", { full: await photograph(1440, 700), screen: await photograph(1440, 700) });
    expect(files.find((f) => f.kind === "card")).toMatchObject({ width: 800, height: 600 });
  });
});

/** A page that had not drawn when it was photographed is one flat colour (D279): never kept as a look's photograph. */
describe("a blank photograph", () => {
  it("is one flat colour, white or any other", async () => {
    for (const background of ["#ffffff", "#0b1020"]) {
      expect(await pictureIsBlank(await sharp({ create: { width: 1440, height: 900, channels: 3, background } }).png().toBuffer())).toBe(true);
    }
  });

  it("is not a page with anything on it, even a little", async () => {
    expect(await pictureIsBlank(await photograph(1440, 900))).toBe(false);
    const line = await sharp({ create: { width: 200, height: 12, channels: 3, background: "#222222" } }).png().toBuffer();
    const almost = await sharp({ create: { width: 780, height: 1688, channels: 3, background: "#ffffff" } }).composite([{ input: line, top: 40, left: 24 }]).png().toBuffer();
    expect(await pictureIsBlank(almost)).toBe(false);
  });
});
